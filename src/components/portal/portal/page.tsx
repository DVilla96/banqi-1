

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Handshake, Send, Hourglass, Loader2, CheckCircle, PiggyBank, FileCheck2, AlertCircle, XCircle, Check, CheckCheck, CalendarDays, DollarSign, ListChecks, TestTube2, User, FileWarning, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { db, storage } from '@/lib/firebase';
import { collection, query, where, DocumentData, doc, updateDoc, getDoc, onSnapshot, runTransaction, addDoc, serverTimestamp, getDocs, limit, orderBy, writeBatch, deleteDoc } from 'firebase/firestore';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import type { Loan, Investment, LoanDetails, PaymentBreakdown } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import PendingConfirmations from '@/components/portal/pending-confirmations';
import InvestorActivity from '@/components/portal/investor-activity';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { calculateLoanPayment, calculateTotalPayoff, calculateOverduePayment, OverduePaymentBreakdown, calculatePaymentBreakdown, CalculationDetails } from '@/lib/financial-utils';
import { Separator } from '@/components/ui/separator';
import { addDays, addMonths, format, setDate, differenceInDays, startOfDay, parseISO, fromUnixTime } from 'date-fns';
import { es } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RepaymentModal from '@/components/portal/repayment-modal';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';


type ActiveLoanRequest = Loan & {
  id: string;
};

const formatCurrency = (value: number, decimals = 0) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
};

const BANQI_FEE_INVESTOR_ID = 'banqi_platform_fee';


export default function PortalPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [activeLoan, setActiveLoan] = useState<ActiveLoanRequest | null>(null);
  const [computedLoanStatus, setComputedLoanStatus] = useState<Loan['status'] | null>(null);
  const [loanInvestments, setLoanInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundingQueueSize, setFundingQueueSize] = useState(3);
  const [acceptedCommitment, setAcceptedCommitment] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPaymentDay, setSelectedPaymentDay] = useState<string>('');
  const [totalPayoffAmount, setTotalPayoffAmount] = useState(0);
  const [overduePaymentAmount, setOverduePaymentAmount] = useState(0);
  const [extraPaymentAmount, setExtraPaymentAmount] = useState<string>('');
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown | null>(null);
  const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);
  const [nextLoanInQueue, setNextLoanInQueue] = useState<Loan | null>(null);
  const [processingPayment, setProcessingPayment] = useState<Investment | null>(null);
  const [simulationDate, setSimulationDate] = useState<Date | null>(null);
  const [bankersForModal, setBankersForModal] = useState<Investment[]>([]);
  const { toast } = useToast();
  
  useEffect(() => {
    const simDateParam = searchParams.get('simDate');
    if (simDateParam) {
        const date = parseISO(simDateParam);
        const correctedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
        setSimulationDate(correctedDate);
    } else {
        setSimulationDate(null);
    }
  }, [searchParams]);

  const simulationDateForInput = useMemo(() => {
    if (!simulationDate) return '';
    // Format the date to YYYY-MM-DD for the input value
    return simulationDate.toISOString().split('T')[0];
  }, [simulationDate]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
        setLoading(false);
        return;
    }

    setLoading(true);

    const fetchConfig = async () => {
        try {
            const configRef = doc(db, 'settings', 'platformConfig');
            const configSnap = await getDoc(configRef);
            if (configSnap.exists()) {
                setFundingQueueSize(configSnap.data().fundingQueueSize || 3);
            }
        } catch (error) {
            console.error("Error fetching config: ", error);
        }
    };

    fetchConfig();
    
    // Listener for payments in process (pending or disputed) initiated by this user
    const processingQuery = query(
        collection(db, "investments"),
        where("payerId", "==", user.uid),
        where("status", "in", ["disputed", "pending-confirmation"]),
        limit(1)
    );
    const unsubscribeProcessing = onSnapshot(processingQuery, (snapshot) => {
        if (!snapshot.empty) {
            const docSnap = snapshot.docs[0];
            setProcessingPayment({ id: docSnap.id, ...docSnap.data() } as Investment);
        } else {
            setProcessingPayment(null);
        }
    });


    const q = query(
      collection(db, "loanRequests"),
      where("requesterId", "==", user.uid),
      where("status", "in", ["pending", "pre-approved", "approved", "funding-active", "funded", "pending-review", "rejected", "rejected-docs", "repayment-active", "repayment-overdue"])
    );

    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            const loanData = { id: docSnap.id, ...docSnap.data() } as ActiveLoanRequest;
            
            const investmentsQuery = query(
                collection(db, 'investments'),
                where('loanId', '==', loanData.id),
                where('status', '==', 'confirmed')
            );
            const investmentsSnapshot = await getDocs(investmentsQuery);
            const tempInvestments = investmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Investment ));
            
            setActiveLoan(loanData);
            setLoanInvestments(tempInvestments);

        } else {
            setActiveLoan(null);
        }
        setLoading(false);
    }, (error) => {
        console.error("Error with real-time loan listener:", error);
        setLoading(false);
    });

    return () => {
        unsubscribe();
        unsubscribeProcessing();
    };

  }, [user, authLoading]);

  // This useEffect specifically handles the dynamic status and payment calculations
  useEffect(() => {
    if (!activeLoan || !activeLoan.paymentDay || loanInvestments.length === 0 || !['repayment-active', 'repayment-overdue'].includes(activeLoan.status)) {
        setComputedLoanStatus(activeLoan?.status || null);
        return;
    }

    const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());
    console.log(`[PORTAL_CALC] Running check for loan ${activeLoan.id} on simulated date:`, today);
    
    const paymentDetails = calculateLoanPayment(activeLoan, loanInvestments, simulationDate || undefined);
    
    if (paymentDetails) {
        console.log(`[PORTAL_CALC] Base payment details calculated. Cuota: ${paymentDetails.finalPayment}`);

        let lastDueDate = setDate(today, activeLoan.paymentDay);
        if (today < lastDueDate) {
            lastDueDate = addMonths(lastDueDate, -1);
        }
        lastDueDate = startOfDay(lastDueDate);
        
        console.log(`[PORTAL_CALC] Last due date was:`, lastDueDate);
        console.log(`[PORTAL_CALC] First possible payment date:`, paymentDetails.firstPaymentDate);


        if (today >= paymentDetails.firstPaymentDate) {
            console.log(`[PORTAL_CALC] Condition MET. Loan is overdue.`);
            setComputedLoanStatus('repayment-overdue');
            
            const daysOverdue = differenceInDays(today, startOfDay(lastDueDate));

            const overduePayload = {
                loanDetails: activeLoan,
                dailyInterestRate: paymentDetails.dailyInterestRate,
                basePayment: paymentDetails.creditPaymentPart,
                firstMonthPayment: paymentDetails.finalPayment,
                daysOverdue: daysOverdue > 0 ? daysOverdue : 0, // Ensure daysOverdue is not negative
            };
            console.log("[PORTAL_CALC] Calculating overdue breakdown with payload:", overduePayload);
            const overdueResult = calculateOverduePayment(overduePayload);
            console.log("[PORTAL_CALC] Overdue breakdown result:", overdueResult);
            setOverduePaymentAmount(overdueResult.finalTotal);

        } else {
            console.log(`[PORTAL_CALC] Condition NOT met. Loan is active, not overdue.`);
            setComputedLoanStatus('repayment-active');
            setOverduePaymentAmount(paymentDetails.finalPayment || 0);
        }

        // Always calculate total payoff
        const payoffDetails = calculateTotalPayoff(activeLoan, loanInvestments, paymentDetails.dailyInterestRate, simulationDate || undefined);
        if (payoffDetails) {
            setTotalPayoffAmount(payoffDetails.totalPayoff);
        }
    } else {
        setComputedLoanStatus(activeLoan.status);
    }
  }, [activeLoan, loanInvestments, simulationDate]);
  
  const fundedPercentage = activeLoan?.fundedPercentage || 0;
  const committedPercentage = activeLoan?.committedPercentage || 0;
  const pendingPercentage = Math.max(0, committedPercentage - fundedPercentage);
  const fundedAmount = (activeLoan?.amount || 0) * (fundedPercentage / 100);

  const handlePaymentClick = async (amount: number) => {
    
    if (!activeLoan || !loanInvestments.length) {
        toast({ title: "Error", description: "Datos del préstamo no disponibles.", variant: "destructive" });
        return;
    }
    setActionLoading(true);

    try {
        // 1. Fetch the next loan in the queue
        const nextLoanQuery = query(
            collection(db, 'loanRequests'),
            where('status', '==', 'funding-active'),
            where('committedPercentage', '<', 100),
            orderBy('fundingOrder', 'asc'),
            limit(1)
        );
        const nextLoanSnapshot = await getDocs(nextLoanQuery);

        if (nextLoanSnapshot.empty) {
            toast({ title: "No hay préstamos en cola", description: "No hay préstamos disponibles para recibir fondos en este momento. Inténtalo más tarde.", variant: 'destructive'});
            setActionLoading(false);
            return;
        }

        const nextLoanDoc = nextLoanSnapshot.docs[0];
        const nextLoanData = { id: nextLoanDoc.id, ...nextLoanDoc.data() } as Loan;

        // Enrich the next loan with its user data (for bank details)
        let enrichedNextLoan: Loan = nextLoanData;
        if (nextLoanData.requesterId) {
            const userRef = doc(db, 'users', nextLoanData.requesterId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data() as UserProfile;
                enrichedNextLoan = {
                    ...nextLoanData,
                    requesterFirstName: userData.firstName,
                    requesterLastName: userData.lastName,
                    bankName: userData.bankName,
                    accountType: userData.accountType,
                    accountNumber: userData.accountNumber,
                };
            }
        }
        
        setNextLoanInQueue(enrichedNextLoan);

        // 2. Calculate the payment breakdown
        const today = simulationDate || new Date();
        const paymentCalcDetails = calculateLoanPayment(activeLoan, loanInvestments, today);
        if (!paymentCalcDetails) {
            throw new Error("Could not calculate payment details.");
        }
        
        const breakdownDetails = {
            loanDetails: activeLoan,
            investments: loanInvestments,
            paymentDate: today,
            basePayment: amount,
            pvBreakdown: paymentCalcDetails.presentValueBreakdown,
        };
        const breakdown = calculatePaymentBreakdown(breakdownDetails);
        setPaymentBreakdown({ ...breakdown, details: breakdownDetails});

        // 3. Enrich the original investors (bankers) to show in the modal
        const enrichedBankers = await Promise.all(
            loanInvestments.map(async (inv) => {
                let name = 'Banquero Anónimo';
                if (inv.investorId === BANQI_FEE_INVESTOR_ID) {
                    name = 'Banqi (Plataforma)';
                } else if (inv.investorId) {
                    const userRef = doc(db, 'users', inv.investorId);
                    const userSnap = await getDoc(userRef);
                    if (userSnap.exists()) {
                        const data = userSnap.data();
                        name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
                    }
                }
                return { ...inv, investorName: name };
            })
        );
        setBankersForModal(enrichedBankers);
        
        setIsRepaymentModalOpen(true);

    } catch (error) {
         toast({ title: "Error", description: (error as Error).message || "No se pudo preparar el pago. Revisa la consola.", variant: "destructive" });
         console.error("Error preparing payment:", error);
    } finally {
        setActionLoading(false);
    }
  }
  
  const confirmRepayment = async (proofFile: File) => {
    if (!user || !activeLoan || !nextLoanInQueue || !paymentBreakdown) {
      toast({ title: 'Error', description: 'Faltan datos para procesar el pago.', variant: 'destructive' });
      return;
    }
  
    try {
      // 1. Upload proof to storage
      const proofRef = ref(storage, `repayment-proofs/${activeLoan.id}/${user.uid}-${Date.now()}`);
      const uploadResult = await uploadBytes(proofRef, proofFile);
      const proofUrl = await getDownloadURL(uploadResult.ref);
  
      // 2. Run Firestore transaction
      await runTransaction(db, async (transaction) => {
        const receivingLoanRef = doc(db, 'loanRequests', nextLoanInQueue.id);
        const receivingLoanDoc = await transaction.get(receivingLoanRef);
  
        if (!receivingLoanDoc.exists()) {
          throw new Error('El préstamo receptor ya no existe.');
        }
  
        const receivingLoanData = receivingLoanDoc.data();
        const amountToFund = receivingLoanData.amount * (1 - (receivingLoanData.committedPercentage || 0) / 100);
        
        if (paymentBreakdown.total > amountToFund) {
            throw new Error("El monto disponible para fondear en el préstamo receptor ha cambiado. Inténtalo de nuevo.");
        }

        const feeProportion = (loanInvestments.find(i => i.investorId === BANQI_FEE_INVESTOR_ID)?.amount || 0) / activeLoan.amount;
        const feeInvestmentAmount = paymentBreakdown.total * feeProportion;
        const capitalPaymentForInvestors = paymentBreakdown.total - feeInvestmentAmount;


        // --- Logic to distribute the payment to original investors and create new investments ---
        const primaryInvestmentData: Omit<Investment, 'id'> = {
            loanId: nextLoanInQueue.id,
            investorId: user.uid,
            borrowerId: nextLoanInQueue.requesterId,
            amount: capitalPaymentForInvestors,
            totalPaymentAmount: paymentBreakdown.total,
            status: 'pending-confirmation',
            paymentProofUrl: proofUrl,
            createdAt: serverTimestamp(),
            payerId: user.uid,
        };
        const newInvestmentRef = doc(collection(db, 'investments'));
        transaction.set(newInvestmentRef, primaryInvestmentData);

        if (feeInvestmentAmount > 0) {
            const feeInvestmentData: Omit<Investment, 'id'> = {
                 loanId: nextLoanInQueue.id,
                 investorId: BANQI_FEE_INVESTOR_ID,
                 borrowerId: nextLoanInQueue.requesterId,
                 amount: feeInvestmentAmount,
                 status: 'confirmed',
                 paymentProofUrl: 'internal_repayment_fee',
                 createdAt: serverTimestamp(),
                 confirmedAt: serverTimestamp(),
                 payerId: user.uid,
            };
            transaction.set(doc(collection(db, 'investments')), feeInvestmentData);
        }

        // 3. Update receiving loan's committed percentage
        const newCommittedAmount = (receivingLoanData.committedPercentage / 100 * receivingLoanData.amount) + paymentBreakdown.total;
        const newCommittedPercentage = Math.min(100, (newCommittedAmount / receivingLoanData.amount) * 100);
        transaction.update(receivingLoanRef, { committedPercentage: newCommittedPercentage });
      });
  
      toast({
        title: 'Pago Enviado para Confirmación',
        description: 'Tu pago ha sido registrado y está esperando la confirmación del destinatario.',
      });
  
    } catch (error) {
      console.error('Error confirming repayment:', error);
      toast({
        title: 'Error al Procesar el Pago',
        description: (error as Error).message || 'No se pudo registrar tu pago. Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
        setIsRepaymentModalOpen(false);
        setPaymentBreakdown(null);
        setNextLoanInQueue(null);
    }
  };

   const handleRevertPayment = async (paymentToRevert: Investment) => {
    if (!user) return;
    setActionLoading(true);
    try {
        await runTransaction(db, async (transaction) => {
            const loanRef = doc(db, 'loanRequests', paymentToRevert.loanId);
            const loanDoc = await transaction.get(loanRef);

            if (!loanDoc.exists()) {
                throw new Error("El préstamo receptor ya no existe.");
            }

            const loanData = loanDoc.data();
            const totalRevertedAmount = paymentToRevert.totalPaymentAmount || paymentToRevert.amount;
            
            // Revert committed percentage
            const currentCommitted = loanData.amount * (loanData.committedPercentage || 0) / 100;
            const newTotalCommitted = Math.max(0, currentCommitted - totalRevertedAmount);
            const newCommittedPercentage = (newTotalCommitted / loanData.amount) * 100;
            
            transaction.update(loanRef, { committedPercentage: newCommittedPercentage });

            // Delete the primary investment document
            const primaryInvestmentRef = doc(db, 'investments', paymentToRevert.id);
            transaction.delete(primaryInvestmentRef);

            // Find and delete the associated fee investment
            const feeInvestmentQuery = query(
                collection(db, 'investments'),
                where('loanId', '==', paymentToRevert.loanId),
                where('payerId', '==', paymentToRevert.payerId),
                where('investorId', '==', BANQI_FEE_INVESTOR_ID),
                where('createdAt', '==', paymentToRevert.createdAt) // Match by timestamp
            );
            const feeInvestmentsSnapshot = await getDocs(feeInvestmentQuery);
            if (!feeInvestmentsSnapshot.empty) {
                const feeInvestmentDoc = feeInvestmentsSnapshot.docs[0];
                transaction.delete(feeInvestmentDoc.ref);
            }
        });

        toast({
            title: "Pago Revertido",
            description: "La transacción ha sido eliminada y el cupo restaurado.",
        });
    } catch (error) {
        console.error("Error reverting payment:", error);
        toast({ title: "Error", description: (error as Error).message, variant: "destructive" });
    } finally {
        setActionLoading(false);
    }
};


  const handleWithdraw = async () => {
      if (!activeLoan || !user) return;
      setLoading(true);
      const requestRef = doc(db, 'loanRequests', activeLoan.id);
      try {
          await updateDoc(requestRef, { status: 'withdrawn', withdrawnAt: new Date() });
          setActiveLoan(null);
      } catch (error) {
          console.error("Error withdrawing request: ", error);
      } finally {
          setLoading(false);
      }
  }

  const handlePublishLoan = async () => {
    if (!activeLoan || !user || typeof activeLoan.disbursementFee === 'undefined') {
        toast({ title: 'Error', description: 'No se encontró el cargo por desembolso.', variant: 'destructive'});
        return;
    };
    setActionLoading(true);
    
    try {
        await runTransaction(db, async (transaction) => {
            const loanRef = doc(db, 'loanRequests', activeLoan.id);
            const loanDoc = await transaction.get(loanRef);

            if (!loanDoc.exists()) {
                throw new Error("El préstamo ya no existe.");
            }
            
            const disbursementFee = activeLoan.disbursementFee || 0;

            // 1. Create the initial fee investment
            const feeInvestmentData = {
                loanId: activeLoan.id,
                investorId: BANQI_FEE_INVESTOR_ID,
                borrowerId: activeLoan.requesterId,
                amount: disbursementFee,
                status: 'confirmed', // Auto-confirmed
                paymentProofUrl: 'internal_transaction',
                createdAt: serverTimestamp(),
                confirmedAt: serverTimestamp(),
            };
            const investmentCollectionRef = collection(db, 'investments');
            transaction.set(doc(investmentCollectionRef), feeInvestmentData);

            // 2. Update the loan document
            const newFundedPercentage = (disbursementFee / activeLoan.amount) * 100;
            transaction.update(loanRef, {
                status: 'funding-active',
                publishedAt: new Date(),
                fundedPercentage: newFundedPercentage,
                committedPercentage: newFundedPercentage,
            });
        });

        toast({
            title: '¡Préstamo Publicado!',
            description: 'Tu préstamo ahora es visible para los inversionistas.',
        });
        // The real-time listener will update the UI

    } catch (error) {
        console.error("Error publishing loan and creating fee investment:", error);
        toast({
            title: 'Error al Publicar',
            description: (error as Error).message || 'No se pudo publicar el préstamo.',
            variant: 'destructive',
        });
    } finally {
        setActionLoading(false);
    }
  }

   const handleSetPaymentDay = async () => {
    if (!activeLoan || !selectedPaymentDay) {
        toast({ title: 'Error', description: 'Por favor, selecciona un día de pago.', variant: 'destructive'});
        return;
    }
    setActionLoading(true);
    try {
        const loanRef = doc(db, 'loanRequests', activeLoan.id);
        await updateDoc(loanRef, {
            paymentDay: parseInt(selectedPaymentDay, 10),
            status: 'repayment-active', // New status indicating payments will start
        });
        toast({
            title: '¡Fecha de Pago Guardada!',
            description: `Tu fecha de pago mensual ha sido establecida para el día ${selectedPaymentDay} de cada mes.`,
        });
    } catch (error) {
        console.error("Error setting payment day:", error);
        toast({ title: 'Error', description: 'No se pudo guardar la fecha de pago.', variant: 'destructive'});
    } finally {
        setActionLoading(false);
    }
  };

  const handleExtraPaymentAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, ''); // Allow only numbers
    const numValue = Number(value);

    if (numValue > totalPayoffAmount) {
        setExtraPaymentAmount(String(Math.floor(totalPayoffAmount)));
    } else {
        setExtraPaymentAmount(value);
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dateValue = e.target.value;
    const newParams = new URLSearchParams(searchParams.toString());

    if (dateValue) {
      const date = parseISO(dateValue);
      const correctedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
      setSimulationDate(correctedDate);
      newParams.set('simDate', dateValue);
    } else {
      setSimulationDate(null);
      newParams.delete('simDate');
    }
    router.push(`${pathname}?${newParams.toString()}`);
  };

  const paymentDayOptions = useMemo(() => {
    if (!activeLoan || loanInvestments.length === 0) return [];

    const lastDisbursementDate = loanInvestments
        .map(inv => fromUnixTime(inv.createdAt.seconds))
        .reduce((max, date) => (date > max ? date : max), new Date(0));

    const options: { value: string, label: string }[] = [];
    const uniqueDays = new Set<string>();

    // Start from the day after the last disbursement
    for (let i = 1; i <= 31; i++) {
        const dateOption = addDays(lastDisbursementDate, i);
        const day = dateOption.getDate();
        const dayString = String(day);

        if (day <= 28 && !uniqueDays.has(dayString)) {
            options.push({
                value: dayString,
                label: format(dateOption, "EEEE, dd 'de' MMMM", { locale: es }),
            });
            uniqueDays.add(dayString);
        }
    }
    return options;
  }, [activeLoan, loanInvestments]);

  // All hooks must be called before this conditional return
  function renderLoanCard() {
    if (processingPayment) {
        const isDisputed = processingPayment.status === 'disputed';
        const title = isDisputed ? "Pago en Revisión" : "Pago en Proceso";
        const description = isDisputed 
            ? "Tu último pago está siendo revisado por el destinatario. No puedes realizar nuevos pagos hasta que se resuelva."
            : "Tu pago está pendiente de confirmación. No podrás realizar nuevos pagos hasta que el destinatario confirme la recepción.";
        
        return {
            icon: isDisputed ? <FileWarning className="h-10 w-10 text-destructive" /> : <Hourglass className="h-10 w-10 text-amber-500" />,
            title: title,
            description: description,
            content: (
                <div className='w-full text-left space-y-4'>
                    <div className="p-4 border rounded-md bg-muted/50">
                        <p className="text-sm font-semibold">Detalles del Pago en Proceso:</p>
                        <Separator className='my-2' />
                        <div className='flex justify-between text-sm'>
                            <span className='text-muted-foreground'>Monto Pagado:</span>
                            <span className='font-bold'>{formatCurrency(processingPayment.totalPaymentAmount || processingPayment.amount)}</span>
                        </div>
                         <div className='flex justify-between text-sm'>
                            <span className='text-muted-foreground'>Fecha:</span>
                            <span className='font-medium'>{processingPayment.createdAt ? format(processingPayment.createdAt.toDate(), 'dd MMM yyyy', {locale: es}) : 'N/A'}</span>
                        </div>
                    </div>
                     <Button asChild className='w-full' variant='outline'>
                        <Link href="/support">Contactar a Soporte</Link>
                    </Button>
                    <Button onClick={() => handleRevertPayment(processingPayment)} variant="destructive" className="w-full" disabled={actionLoading}>
                        {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                        Revertir Pago (Prueba)
                    </Button>
                </div>
            )
        }
    }


    if (!activeLoan || !computedLoanStatus) return null; // Guard clause if loan data isn't ready
    const status = computedLoanStatus;

    if (status === 'pre-approved') {
      return {
        icon: <CheckCircle className="h-10 w-10 text-accent" />,
        title: "¡Crédito Pre-aprobado!",
        description: "Tu oferta de crédito está lista. Revísala y acéptala para continuar.",
        content: (
            <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                <Link href={`/approval/${activeLoan.id}`}>Revisar mi Oferta</Link>
            </Button>
        )
      }
    }
    
    if (status === 'approved') {
        const isVisibleInQueue = typeof activeLoan.fundingOrder === 'number' && activeLoan.fundingOrder < fundingQueueSize;

        if (isVisibleInQueue) {
             return {
                icon: <PiggyBank className="h-10 w-10 text-primary" />,
                title: "¡Tu Crédito está Aprobado!",
                content: (
                    <div className='w-full text-left space-y-4'>
                        <Alert variant="default" className="bg-green-50 border-green-200 text-green-900">
                            <AlertTitle className='font-bold'>Un Acto de Confianza</AlertTitle>
                            <AlertDescription>
                              En Banqi, tu préstamo es financiado por personas de la comunidad que confían en ti. Cada peso que recibes representa los ahorros y la confianza de alguien más. Tu compromiso es la base de esta comunidad.
                            </AlertDescription>
                        </Alert>
                        <div className="space-y-4 p-4 border rounded-md">
                             <p className='text-sm text-muted-foreground'>Para publicar tu solicitud y empezar a recibir fondos, por favor, confirma tu compromiso:</p>
                            <div className="flex items-center space-x-2">
                                <Checkbox id="commitment" onCheckedChange={(checked) => setAcceptedCommitment(Boolean(checked))} />
                                <label
                                    htmlFor="commitment"
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    Entiendo y acepto revisar mi cuenta y confirmar con honestidad cada pago que reciba.
                                </label>
                            </div>
                            <Button className="w-full" onClick={handlePublishLoan} disabled={!acceptedCommitment || actionLoading}>
                                 {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                                Aceptar y Publicar Mi Préstamo
                            </Button>
                        </div>
                    </div>
                )
            };
        } else {
            const positionsAway = ((activeLoan.fundingOrder || 0) + 1) - fundingQueueSize;
            return {
                icon: <Hourglass className="h-10 w-10 text-primary" />,
                title: "¡Aprobado y en Fila!",
                description: positionsAway > 0 
                    ? `Estás a solo ${positionsAway} ${positionsAway === 1 ? 'posición' : 'posiciones'} de que tu préstamo sea visible para los inversionistas.`
                    : "Tu crédito está casi listo para ser visible.",
                content: <p className="font-semibold text-lg text-primary">Tu crédito está casi listo para ser visible.</p>
            };
        }
    }
      
    if (status === 'funding-active') {
        const detailLinkHref = `/my-loan/${activeLoan.id}${simulationDate ? `?simDate=${simulationDate.toISOString().split('T')[0]}` : ''}`;
        return {
           icon: <PiggyBank className="h-10 w-10 text-green-600" />,
           title: "¡Tu Crédito está Activo!",
           content: (
               <div className='w-full text-left space-y-4'>
                   <p className="text-sm text-muted-foreground text-center">Tu solicitud ya es visible. ¡Mantente atento para confirmar los fondos que recibas!</p>
                   <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <h4 className="font-semibold text-muted-foreground">Progreso de Fondeo</h4>
                            <span className="font-semibold text-primary">{committedPercentage.toFixed(2)}%</span>
                        </div>
                         <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                            <div className="absolute h-full bg-green-500" style={{ width: `${fundedPercentage}%` }}></div>
                            <div className="absolute h-full bg-primary/30" style={{ left: `${fundedPercentage}%`, width: `${pendingPercentage}%` }}></div>
                        </div>
                        <p className='text-xs text-muted-foreground text-right'>
                            Confirmado: <span className='font-medium text-foreground'>{formatCurrency(fundedAmount)} de {formatCurrency(activeLoan.amount)}</span>
                        </p>
                    </div>
                    <Button asChild className='w-full' variant='outline'>
                        <Link href={detailLinkHref}>
                            <ListChecks className='mr-2 h-4 w-4' />
                            Ver Detalle del Préstamo
                        </Link>
                    </Button>
                    {user && <PendingConfirmations loanId={activeLoan.id} borrowerId={user.uid} />}
               </div>
           )
       };
    }

    if (status === 'funded') {
        const detailLinkHref = `/my-loan/${activeLoan.id}${simulationDate ? `?simDate=${simulationDate.toISOString().split('T')[0]}` : ''}`;
        return {
           icon: <CheckCheck className="h-10 w-10 text-green-600" />,
           title: "¡Préstamo 100% Fondeado!",
           description: "¡Felicidades! Has recibido todos los fondos para tu crédito. El siguiente paso es definir cuándo harás tus pagos mensuales.",
           content: (
               <div className='w-full text-left space-y-4'>
                    <Button asChild className='w-full' variant='outline'>
                        <Link href={detailLinkHref}>
                            <ListChecks className='mr-2 h-4 w-4' />
                            Ver Detalle del Préstamo
                        </Link>
                    </Button>
                    <div className="space-y-2">
                        <label htmlFor="payment-day" className="font-semibold">Elige tu día de pago mensual</label>
                         <Select onValueChange={setSelectedPaymentDay} value={selectedPaymentDay}>
                            <SelectTrigger id="payment-day" className="w-full">
                                <SelectValue placeholder="Selecciona un día..." />
                            </SelectTrigger>
                            <SelectContent>
                                {paymentDayOptions.map(option => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label} (Día {option.value})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">Te recomendamos elegir un día cercano a tu fecha de quincena o pago de nómina.</p>
                    </div>
                    <Button onClick={handleSetPaymentDay} className="w-full bg-green-600 hover:bg-green-700 text-white" disabled={actionLoading || !selectedPaymentDay}>
                        {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                        Confirmar Fecha de Pago
                    </Button>
               </div>
           )
       };
    }

    if (status === 'repayment-active' || status === 'repayment-overdue') {
        const detailLinkHref = `/my-loan/${activeLoan.id}${simulationDate ? `?simDate=${simulationDate.toISOString().split('T')[0]}` : ''}`;
        let nextPaymentDateStr = 'Próximamente';
        let paymentButtonTitle = 'Próxima Cuota Mensual';
        let paymentButtonClass = 'w-full h-auto py-2 flex flex-col items-center text-center';
        let daysOverdue = 0;
        
        const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());
        
        if (activeLoan.paymentDay) {
            let paymentDateThisMonth = setDate(today, activeLoan.paymentDay);
            let nextPaymentDate = paymentDateThisMonth;
             let lastDueDate = paymentDateThisMonth;

            if (today.getTime() > paymentDateThisMonth.getTime()) {
                // We are past this month's payment day.
                nextPaymentDate = addMonths(paymentDateThisMonth, 1);
            } else {
                lastDueDate = addMonths(paymentDateThisMonth, -1);
            }

            if (status === 'repayment-overdue') {
                daysOverdue = differenceInDays(today, startOfDay(lastDueDate));
                paymentButtonTitle = `Pagar Cuota Vencida (${daysOverdue} día${daysOverdue !== 1 ? 's' : ''} de mora)`;
                paymentButtonClass += ' bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive-emphasis';
                nextPaymentDateStr = format(lastDueDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
            } else { // repayment-active
                nextPaymentDateStr = format(nextPaymentDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
            }
        }
        
        return {
           icon: <DollarSign className="h-10 w-10 text-primary" />,
           title: status === 'repayment-overdue' ? 'Pago Vencido' : 'Gestiona tu Próximo Pago',
           description: `Tu fecha máxima de pago es el ${nextPaymentDateStr}.`,
           content: (
               <div className='w-full text-left space-y-4'>
                    <Button asChild className='w-full' variant='outline'>
                        <Link href={detailLinkHref}>
                            <ListChecks className='mr-2 h-4 w-4' />
                            Ver Detalle del Préstamo
                        </Link>
                    </Button>
                    <div className='space-y-4'>
                         <Button variant="outline" className={paymentButtonClass} onClick={() => handlePaymentClick(overduePaymentAmount)} disabled={actionLoading}>
                           {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                           <span className='text-sm'>{paymentButtonTitle}</span>
                           <span className='text-2xl font-bold text-foreground'>{formatCurrency(overduePaymentAmount, 2)}</span>
                        </Button>
                        <Button variant="outline" className='w-full h-auto py-2 flex flex-col items-center text-center bg-green-600/10 text-green-700 hover:bg-green-600/20 hover:text-green-800' onClick={() => handlePaymentClick(totalPayoffAmount)} disabled={actionLoading}>
                           {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                           <span className='text-sm'>Saldo Total a Hoy</span>
                           <span className='text-2xl font-bold'>{formatCurrency(totalPayoffAmount, 2)}</span>
                        </Button>
                        <Card className="p-4">
                            <Label htmlFor="extra-payment" className="font-semibold text-base mb-2 block text-center">Realizar un Abono Extra</Label>
                            <div className="flex items-center gap-2">
                                <div className='relative w-full'>
                                     <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                                     <Input
                                        id="extra-payment"
                                        type="text"
                                        inputMode='numeric'
                                        value={extraPaymentAmount ? new Intl.NumberFormat('es-CO').format(Number(extraPaymentAmount)) : ''}
                                        onChange={handleExtraPaymentAmountChange}
                                        placeholder="Ingresa un monto"
                                        className="pl-6 text-center font-semibold text-lg h-11"
                                    />
                                </div>
                                <Button disabled={!extraPaymentAmount || Number(extraPaymentAmount) === 0 || actionLoading} onClick={() => handlePaymentClick(Number(extraPaymentAmount))}>
                                    {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Pagar Abono
                                </Button>
                            </div>
                             <p className='text-xs text-muted-foreground text-center mt-2'>
                                Máximo: {formatCurrency(totalPayoffAmount)}
                            </p>
                        </Card>
                    </div>
               </div>
           )
       };
    }

    if (status === 'pending-review') {
        return {
          icon: <FileCheck2 className="h-10 w-10 text-primary" />,
          title: "Revisión Final",
          description: "Hemos recibido tus documentos y están en la revisión final por parte de nuestro equipo.",
          content: <p className="font-semibold text-lg text-primary">Pronto tendrás noticias</p>
        }
      }

    if (status === 'pending') {
       return {
        icon: <Hourglass className="h-10 w-10 text-primary" />,
        title: "Solicitud en Estudio",
        description: "Tu solicitud de crédito está siendo evaluada por nuestro equipo.",
        content: <p className="font-semibold text-lg text-primary">Pronto tendrás noticias</p>
      }
    }

    if (status === 'rejected-docs') {
      return {
       icon: <AlertCircle className="h-10 w-10 text-orange-500" />,
       title: "Problema con Documentos",
       description: "Hubo un problema con los documentos que subiste. Por favor, corrígelos.",
       content: (
            <div className='flex gap-2'>
              <Button asChild size="lg" className="bg-orange-500 text-white hover:bg-orange-600">
                  <Link href={`/approval/${activeLoan.id}`}>Corregir Documentos</Link>
              </Button>
              <Button onClick={handleWithdraw} size="lg" variant="outline">
                  Desistir
              </Button>
            </div>
       )
     }
   }
   
   if (status === 'rejected') {
     return {
      icon: <XCircle className="h-10 w-10 text-destructive" />,
      title: "Solicitud Rechazada",
      description: "Lamentablemente, tu solicitud no pudo ser aprobada en este momento.",
      content: (
           <Button onClick={handleWithdraw} size="lg" variant="destructive">
               Entendido
           </Button>
      )
    }
  }


    return null; // Return null if there's no active loan, we'll handle this case below
  }
  
  const loanCardData = renderLoanCard();

  if (authLoading || loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">Verificando estado...</p>
      </div>
    );
  }
  

  return (
    <>
    <div className="flex flex-col items-center justify-start min-h-[calc(100vh-10rem)] bg-background p-4">
        <Card className="w-full max-w-sm p-4 mb-8 bg-muted/50 border-dashed">
            <Label htmlFor="simulation-date" className='flex items-center gap-2 font-semibold text-muted-foreground'>
                <TestTube2 className='h-5 w-5 text-primary' />
                Simulador de Tiempo (Pruebas)
            </Label>
            <Input 
                id="simulation-date"
                type="date"
                value={simulationDateForInput}
                onChange={handleDateChange}
                className="mt-2"
            />
        </Card>
        <div className="text-center mb-12">
            <h1 className="text-4xl font-bold tracking-tight">Bienvenido a Banqi</h1>
            <p className="text-xl text-muted-foreground mt-2">¿Qué te gustaría hacer hoy?</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
            {/* Main Action Card */}
            <div className="flex flex-col text-center items-center justify-center p-8 rounded-lg border bg-card text-card-foreground shadow-sm transition-all hover:shadow-xl hover:scale-105">
                {loanCardData ? (
                    <>
                        <CardHeader>
                            <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                                {loanCardData.icon}
                            </div>
                            <CardTitle className="text-2xl mt-4">{loanCardData.title}</CardTitle>
                            {loanCardData.description && <CardDescription>{loanCardData.description}</CardDescription>}
                        </CardHeader>
                        <CardContent className="w-full flex-grow flex items-center justify-center">
                            {loanCardData.content}
                        </CardContent>
                    </>
                ) : (
                    <>
                        <CardHeader>
                            <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                                <Send className="h-10 w-10 text-primary" />
                            </div>
                            <CardTitle className="text-2xl mt-4">Quiero un Préstamo</CardTitle>
                            <CardDescription>Solicita un crédito de forma rápida y sencilla.</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                                <Link href="/request">Solicitar Ahora</Link>
                            </Button>
                        </CardContent>
                    </>
                )}
            </div>

            {/* Investor Card */}
             <div className="flex flex-col text-center items-center justify-center p-8 rounded-lg border bg-card text-card-foreground shadow-sm transition-all hover:shadow-xl hover:scale-105">
                <InvestorActivity />
            </div>
        </div>
    </div>
    {isRepaymentModalOpen && paymentBreakdown && nextLoanInQueue && user && (
        <RepaymentModal
            isOpen={isRepaymentModalOpen}
            onClose={() => setIsRepaymentModalOpen(false)}
            payingLoanBreakdown={paymentBreakdown}
            receivingLoan={nextLoanInQueue}
            onConfirm={(proofFile) => confirmRepayment(proofFile)}
            bankers={bankersForModal}
        />
    )}
    </>
  );
}

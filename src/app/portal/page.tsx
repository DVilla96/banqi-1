

'use client';

import { useState, useEffect, useMemo, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Handshake, Send, Hourglass, Loader2, CheckCircle, PiggyBank, FileCheck2, AlertCircle, XCircle, Check, CheckCheck, CalendarDays, DollarSign, ListChecks, TestTube2, User, FileWarning, RotateCcw, Timer } from 'lucide-react';
import Link from 'next/link';
import { db, storage, rtdb } from '@/lib/firebase';
import { ref as rtdbRef, onValue } from 'firebase/database';
import { collection, query, where, DocumentData, doc, updateDoc, getDoc, onSnapshot, runTransaction, addDoc, serverTimestamp, getDocs, limit, orderBy, writeBatch, deleteDoc, Timestamp } from 'firebase/firestore';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import type { Loan, Investment, ReinvestmentSource, Payment, PaymentBreakdown } from '@/lib/types';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import PendingConfirmations from '@/components/portal/pending-confirmations';
import InvestorActivity from '@/components/portal/investor-activity';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { generatePreciseAmortizationSchedule, calculatePrecisePaymentBreakdown, calculatePayoffBalance } from '@/lib/financial-utils';
import { Separator } from '@/components/ui/separator';
import { addDays, addMonths, format, setDate, differenceInDays, startOfDay, parseISO, fromUnixTime } from 'date-fns';
import { es } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RepaymentModal, { type BankerReinvestAmount } from '@/components/portal/repayment-modal';
import CelebrationCard from '@/components/portal/celebration-card';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { SimulationContext } from '@/hooks/use-simulation-date';
import { BANQI_FEE_INVESTOR_ID } from '@/lib/constants';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';

// Tipo para distribución de pago entre múltiples préstamos
export type LoanPaymentDistribution = {
    loan: Loan;
    amount: number;
    proofFile?: File;
};

type ActiveLoanRequest = Loan & {
    id: string;
};

const formatCurrency = (value: number, decimals = 2) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals,
    }).format(value);
};


export default function PortalPage() {
    const { user, profile, loading: authLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { simulationDate, setSimulationDate } = useContext(SimulationContext);

    const [activeLoan, setActiveLoan] = useState<ActiveLoanRequest | null>(null);
    const [computedLoanStatus, setComputedLoanStatus] = useState<Loan['status'] | null>(null);
    const [loanInvestments, setLoanInvestments] = useState<Investment[]>([]);
    const [loanPayments, setLoanPayments] = useState<Payment[]>([]);
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
    const [isPaymentAmountModalOpen, setIsPaymentAmountModalOpen] = useState(false);
    const [selectedPaymentAmount, setSelectedPaymentAmount] = useState<number>(0);
    const [loansInQueue, setLoansInQueue] = useState<Loan[]>([]); // Múltiples préstamos en cola
    const [paymentDistribution, setPaymentDistribution] = useState<LoanPaymentDistribution[]>([]); // Distribución del pago
    const [processingPayment, setProcessingPayment] = useState<Investment | null>(null);
    const [bankersForModal, setBankersForModal] = useState<Investment[]>([]);
    const [hasActiveReservation, setHasActiveReservation] = useState(false); // Para mostrar indicador en card
    const [reservationTimeRemaining, setReservationTimeRemaining] = useState(0);
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
    }, [searchParams, setSimulationDate]);

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
            where("status", "in", ["pending", "pre-approved", "approved", "funding-active", "funded", "pending-review", "rejected", "rejected-docs", "repayment-active", "repayment-overdue", "completed"])
        );

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                const loanData = { id: docSnap.id, ...docSnap.data() } as ActiveLoanRequest;

                // Listen to investments
                const investmentsQuery = query(
                    collection(db, 'investments'),
                    where('loanId', '==', loanData.id),
                    where('status', '==', 'confirmed')
                );
                const investmentsSnapshot = await getDocs(investmentsQuery);
                const tempInvestments = investmentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Investment));

                // Listen to payments
                const paymentsQuery = query(
                    collection(db, 'payments'),
                    where('loanId', '==', loanData.id),
                    orderBy('loanId') // Avoid composite index
                );
                onSnapshot(paymentsQuery, (paymentsSnapshot) => {
                    const tempPayments = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Payment));
                    // Sort manually
                    tempPayments.sort((a, b) => b.paymentDate.seconds - a.paymentDate.seconds);
                    setLoanPayments(tempPayments);
                });

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
        if (!activeLoan || !activeLoan.paymentDay || loanInvestments.length === 0 || !['repayment-active', 'repayment-overdue', 'completed'].includes(activeLoan.status)) {
            setComputedLoanStatus(activeLoan?.status || null);
            return;
        }

        const scheduleResult = generatePreciseAmortizationSchedule(activeLoan, loanInvestments, loanPayments, simulationDate);
        if (!scheduleResult) return;
        const { schedule } = scheduleResult;

        const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

        const overdueInstallments = schedule.filter(row => row.type === 'payment' && row.isOverdue);
        const totalOverdueAmount = overdueInstallments.reduce((sum, row) => sum + row.flow, 0);

        if (totalOverdueAmount > 0) {
            setOverduePaymentAmount(totalOverdueAmount);
        } else {
            const nextDueInstallment = schedule.find(row => row.isNextDue);
            setOverduePaymentAmount(nextDueInstallment?.flow || 0);
        }

        // Calcular el saldo total a hoy usando valor focal (intereses acumulados desde cada inversión)
        // PASAMOS "schedule" para que el cálculo sea consistente con la tabla de amortización
        const payoffBalance = calculatePayoffBalance(activeLoan, loanInvestments, loanPayments, today, schedule);
        setTotalPayoffAmount(payoffBalance);

        if (payoffBalance <= 100) {
            // Si el saldo es prácticamente cero, el préstamo está completado
            setComputedLoanStatus('completed');
        } else if (overdueInstallments.length > 0) {
            setComputedLoanStatus('repayment-overdue');
        } else {
            setComputedLoanStatus('repayment-active');
        }

    }, [activeLoan, loanInvestments, loanPayments, simulationDate]);

    // 🔥 Escuchar MIS reservaciones activas en RTDB para mostrar indicador en card
    // Solo escuchar los préstamos que están en la distribución actual
    useEffect(() => {
        if (!user || paymentDistribution.length === 0) {
            setHasActiveReservation(false);
            setReservationTimeRemaining(0);
            return;
        }

        console.log('[Portal RTDB] Setting up listeners for', paymentDistribution.length, 'loans');
        const unsubscribers: (() => void)[] = [];

        paymentDistribution.forEach(dist => {
            const reservationRef = rtdbRef(rtdb, `loanReservations/${dist.loan.id}/${user.uid}`);

            const unsub = onValue(reservationRef, (snapshot) => {
                const now = Date.now();

                if (snapshot.exists()) {
                    const myReservation = snapshot.val();
                    console.log('[Portal RTDB] Found my reservation:', myReservation);

                    if (myReservation.expiresAt > now) {
                        console.log('[Portal RTDB] Reservation is ACTIVE!');
                        setHasActiveReservation(true);
                        setReservationTimeRemaining(Math.max(0, Math.floor((myReservation.expiresAt - now) / 1000)));
                    } else {
                        console.log('[Portal RTDB] Reservation EXPIRED');
                    }
                }
            }, (error) => {
                console.error('[Portal RTDB] Error listening:', error);
            });

            unsubscribers.push(unsub);
        });

        return () => {
            unsubscribers.forEach(unsub => unsub());
        };
    }, [user, paymentDistribution]);

    // Timer para actualizar el tiempo restante cada segundo
    useEffect(() => {
        if (!hasActiveReservation || reservationTimeRemaining <= 0) return;

        const interval = setInterval(() => {
            setReservationTimeRemaining(prev => {
                if (prev <= 1) {
                    setHasActiveReservation(false);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [hasActiveReservation, reservationTimeRemaining]);

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
            // 1. Fetch ALL loans in the queue (no limit)
            const nextLoanQuery = query(
                collection(db, 'loanRequests'),
                where('status', '==', 'funding-active'),
                where('committedPercentage', '<', 100),
                orderBy('fundingOrder', 'asc')
            );
            const nextLoanSnapshot = await getDocs(nextLoanQuery);

            if (nextLoanSnapshot.empty) {
                toast({ title: "No hay préstamos en cola", description: "No hay préstamos disponibles para recibir fondos en este momento. Inténtalo más tarde.", variant: 'destructive' });
                setActionLoading(false);
                return;
            }

            // 2. Enrich all loans with user data (for bank details)
            const enrichedLoans: Loan[] = await Promise.all(
                nextLoanSnapshot.docs.map(async (loanDoc) => {
                    const loanData = { id: loanDoc.id, ...loanDoc.data() } as Loan;
                    if (loanData.requesterId) {
                        const userRef = doc(db, 'users', loanData.requesterId);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const userData = userSnap.data() as UserProfile;
                            return {
                                ...loanData,
                                requesterFirstName: userData.firstName,
                                requesterLastName: userData.lastName,
                                bankName: userData.bankName,
                                accountType: userData.accountType,
                                accountNumber: userData.accountNumber,
                            };
                        }
                    }
                    return loanData;
                })
            );

            setLoansInQueue(enrichedLoans);

            // 3. Distribute the payment amount across available loans
            let remainingAmount = amount;
            const distribution: LoanPaymentDistribution[] = [];

            for (const loan of enrichedLoans) {
                if (remainingAmount <= 0) break;

                // Calculate how much this loan can receive
                const amountAvailable = loan.amount * (1 - (loan.committedPercentage || 0) / 100);

                if (amountAvailable > 0) {
                    const amountForThisLoan = Math.min(remainingAmount, amountAvailable);
                    distribution.push({
                        loan,
                        amount: amountForThisLoan,
                    });
                    remainingAmount -= amountForThisLoan;
                }
            }

            // Check if we could distribute the full amount
            if (remainingAmount > 0) {
                const totalAvailable = enrichedLoans.reduce((sum, loan) => {
                    return sum + loan.amount * (1 - (loan.committedPercentage || 0) / 100);
                }, 0);
                toast({
                    title: "Monto excede disponibilidad",
                    description: `Solo hay ${formatCurrency(totalAvailable, 0)} disponibles en los préstamos en cola. Reduce el monto del pago.`,
                    variant: 'destructive'
                });
                setActionLoading(false);
                return;
            }

            setPaymentDistribution(distribution);

            // 4. Calculate the PRECISE payment breakdown
            const scheduleResult = generatePreciseAmortizationSchedule(activeLoan, loanInvestments, loanPayments, simulationDate);
            if (!scheduleResult) throw new Error("No se pudo generar el plan de pagos para el desglose.");

            const breakdown = calculatePrecisePaymentBreakdown(amount, scheduleResult.schedule, activeLoan, simulationDate, loanInvestments);
            setPaymentBreakdown(breakdown);

            // 5. Enrich the original investors (bankers) to show in the modal
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

    const confirmRepayment = async (proofFiles: Map<string, File>, finalDistribution?: LoanPaymentDistribution[], bankerReinvestAmounts?: BankerReinvestAmount[]) => {
        // Usar la distribución final (redistribuida) si se proporciona, sino usar la original
        const distributionToUse = finalDistribution && finalDistribution.length > 0 ? finalDistribution : paymentDistribution;

        if (!user || !activeLoan || distributionToUse.length === 0 || !paymentBreakdown) {
            toast({ title: 'Error', description: 'Faltan datos para procesar el pago.', variant: 'destructive' });
            return;
        }

        try {
            // 1. PRIMERO: Subir todos los comprobantes ANTES de la transacción
            const uploadedProofs: Map<string, string> = new Map();
            for (const dist of distributionToUse) {
                const proofFile = proofFiles.get(dist.loan.id);
                if (!proofFile) {
                    throw new Error(`Falta el comprobante para el préstamo de ${dist.loan.requesterFirstName}`);
                }

                const proofRef = ref(storage, `repayment-proofs/${dist.loan.id}/${user.uid}-${Date.now()}`);
                const uploadResult = await uploadBytes(proofRef, proofFile);
                const proofUrl = await getDownloadURL(uploadResult.ref);
                uploadedProofs.set(dist.loan.id, proofUrl);
            }

            // 2. Ahora ejecutar la transacción de Firestore (solo lecturas primero, luego escrituras)
            await runTransaction(db, async (transaction) => {
                // FASE DE LECTURAS: Verificar disponibilidad de todos los préstamos
                const verifiedLoans: { dist: LoanPaymentDistribution, loanData: any }[] = [];

                for (const dist of distributionToUse) {
                    const receivingLoanRef = doc(db, 'loanRequests', dist.loan.id);
                    const receivingLoanDoc = await transaction.get(receivingLoanRef);

                    if (!receivingLoanDoc.exists()) {
                        throw new Error(`El préstamo de ${dist.loan.requesterFirstName} ya no existe.`);
                    }

                    const receivingLoanData = receivingLoanDoc.data();
                    const amountAvailableToFund = receivingLoanData.amount * (1 - (receivingLoanData.committedPercentage || 0) / 100);

                    if (dist.amount > amountAvailableToFund + 1) { // +1 para tolerancia de redondeo
                        throw new Error(`El monto disponible en el préstamo de ${dist.loan.requesterFirstName} ha cambiado. Inténtalo de nuevo.`);
                    }

                    verifiedLoans.push({ dist, loanData: receivingLoanData });
                }

                // FASE DE ESCRITURAS: Crear las inversiones y actualizar préstamos
                // Generar un ID único para agrupar todas las inversiones de este pago
                const paymentGroupId = `pg_${user.uid}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const totalInGroup = verifiedLoans.length;

                for (const { dist, loanData } of verifiedLoans) {
                    const proofUrl = uploadedProofs.get(dist.loan.id)!;

                    // Calcular breakdown para esta porción del pago
                    const portionRatio = dist.amount / paymentBreakdown.total;

                    // Usar los montos exactos de reinversión por banquero (calculados en el modal)
                    // Si no se proporcionan, usar el cálculo proporcional simple como fallback
                    let sourceBreakdown: ReinvestmentSource[];
                    if (bankerReinvestAmounts && bankerReinvestAmounts.length > 0) {
                        // Calcular el total de reinversión para obtener proporción
                        const totalReinvest = bankerReinvestAmounts.reduce((acc, b) => acc + b.amount, 0);
                        sourceBreakdown = bankerReinvestAmounts.map(banker => ({
                            investorId: banker.investorId,
                            // Proporcionar el monto proporcional a esta distribución específica
                            amount: dist.amount * (banker.amount / totalReinvest)
                        }));
                    } else {
                        // Fallback: cálculo simple proporcional al monto invertido
                        sourceBreakdown = bankersForModal.map(banker => ({
                            investorId: banker.investorId || '',
                            amount: dist.amount * (banker.amount / activeLoan.amount)
                        }));
                    }

                    // Crear el breakdown específico para esta inversión
                    const portionBreakdown = {
                        total: dist.amount,
                        capital: paymentBreakdown.capital * portionRatio,
                        interest: paymentBreakdown.interest * portionRatio,
                        technologyFee: paymentBreakdown.technologyFee * portionRatio,
                        lateFee: (paymentBreakdown.lateFee || 0) * portionRatio, // Fix: Add lateFee
                    };

                    // Usar la fecha simulada si existe, sino la fecha actual
                    const paymentDate = simulationDate ? Timestamp.fromDate(simulationDate) : Timestamp.now();

                    const investmentData: Omit<Investment, 'id'> = {
                        loanId: dist.loan.id,
                        payingLoanId: activeLoan.id,
                        payerId: user.uid,
                        borrowerId: dist.loan.requesterId || '', // Fix: Add fallback
                        amount: dist.amount,
                        status: 'pending-confirmation',
                        paymentProofUrl: proofUrl,
                        createdAt: paymentDate,
                        isRepayment: true,
                        sourceBreakdown: sourceBreakdown,
                        paymentBreakdown: portionBreakdown,
                        paymentGroupId: paymentGroupId, // Para agrupar pagos que van a múltiples préstamos
                        totalInGroup: totalInGroup, // Cuántas confirmaciones se necesitan
                    };

                    transaction.set(doc(collection(db, 'investments')), investmentData);

                    // Actualizar el préstamo receptor
                    const receivingLoanRef = doc(db, 'loanRequests', dist.loan.id);
                    const newCommittedAmount = (loanData.committedPercentage / 100 * loanData.amount) + dist.amount;
                    const newCommittedPercentage = Math.min(100, (newCommittedAmount / loanData.amount) * 100);

                    transaction.update(receivingLoanRef, {
                        committedPercentage: newCommittedPercentage,
                    });
                }
            });

            toast({
                title: 'Pago Enviado para Confirmación',
                description: distributionToUse.length > 1
                    ? `Tus ${distributionToUse.length} pagos han sido registrados. Los destinatarios deben confirmar las transferencias.`
                    : 'Tu pago ha sido registrado. El destinatario debe confirmar la transferencia.',
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
            setPaymentDistribution([]);
            setLoansInQueue([]);
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
                const totalRevertedAmount = paymentToRevert.amount;

                const currentCommitted = loanData.amount * (loanData.committedPercentage || 0) / 100;
                const newTotalCommitted = Math.max(0, currentCommitted - totalRevertedAmount);
                const newCommittedPercentage = (newTotalCommitted / loanData.amount) * 100;

                transaction.update(loanRef, { committedPercentage: newCommittedPercentage });

                const investmentRef = doc(db, 'investments', paymentToRevert.id);
                transaction.delete(investmentRef);
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
            toast({ title: 'Error', description: 'No se encontró el cargo por desembolso.', variant: 'destructive' });
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
            toast({ title: 'Error', description: 'Por favor, selecciona un día de pago.', variant: 'destructive' });
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
            toast({ title: 'Error', description: 'No se pudo guardar la fecha de pago.', variant: 'destructive' });
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
            const title = isDisputed ? "Pago en revisión" : "Pago en proceso";
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
                                <span className='font-bold'>{formatCurrency(processingPayment.amount)}</span>
                            </div>
                            <div className='flex justify-between text-sm'>
                                <span className='text-muted-foreground'>Fecha:</span>
                                <span className='font-medium'>{processingPayment.createdAt ? format(processingPayment.createdAt.toDate(), 'dd MMM yyyy', { locale: es }) : 'N/A'}</span>
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
                title: "¡Crédito pre-aprobado!",
                description: "Tu oferta de crédito está lista. Revísala y acéptala para continuar.",
                content: (
                    <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                        <Link href={`/approval/${activeLoan.id}`}>Revisar mi oferta</Link>
                    </Button>
                )
            }
        }

        if (status === 'approved') {
            const isVisibleInQueue = typeof activeLoan.fundingOrder === 'number' && activeLoan.fundingOrder < fundingQueueSize;

            if (isVisibleInQueue) {
                return {
                    icon: <PiggyBank className="h-10 w-10 text-primary" />,
                    title: "¡Tu crédito está aprobado!",
                    content: (
                        <div className='w-full text-left space-y-4'>
                            <Alert variant="default" className="bg-green-50 border-green-200 text-green-900">
                                <AlertTitle className='font-bold'>Un acto de confianza</AlertTitle>
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
                                    Aceptar y publicar mi préstamo
                                </Button>
                            </div>
                        </div>
                    )
                };
            } else {
                const positionsAway = ((activeLoan.fundingOrder || 0) + 1) - fundingQueueSize;
                return {
                    icon: <Hourglass className="h-10 w-10 text-primary" />,
                    title: "¡Aprobado y en fila!",
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
                title: "¡Tu crédito está activo!",
                content: (
                    <div className='w-full text-left space-y-4'>
                        <p className="text-sm text-muted-foreground text-center">Tu solicitud ya es visible. ¡Mantente atento para confirmar los fondos que recibas!</p>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm">
                                <h4 className="font-semibold text-muted-foreground">Progreso de fondeo</h4>
                                <span className="font-semibold text-primary">{committedPercentage.toFixed(2)}%</span>
                            </div>
                            <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                                <div className="absolute h-full bg-green-500" style={{ width: `${fundedPercentage}%` }}></div>
                                <div className="absolute h-full bg-primary/30" style={{ left: `${fundedPercentage}%`, width: `${pendingPercentage}%` }}></div>
                            </div>
                            <p className='text-xs text-muted-foreground text-right'>
                                Confirmado: <span className='font-medium text-foreground'>{formatCurrency(fundedAmount, 0)} de {formatCurrency(activeLoan.amount, 0)}</span>
                            </p>
                        </div>
                        <Button asChild className='w-full' variant='outline'>
                            <Link href={detailLinkHref}>
                                <ListChecks className='mr-2 h-4 w-4' />
                                Ver detalle del préstamo
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
                title: "¡Préstamo 100% fondeado!",
                description: "¡Felicidades! Has recibido todos los fondos para tu crédito. El siguiente paso es definir cuándo harás tus pagos mensuales.",
                content: (
                    <div className='w-full text-left space-y-4'>
                        <Button asChild className='w-full' variant='outline'>
                            <Link href={detailLinkHref}>
                                <ListChecks className='mr-2 h-4 w-4' />
                                Ver detalle del préstamo
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
                            Confirmar fecha de pago
                        </Button>
                    </div>
                )
            };
        }

        if (status === 'repayment-active' || status === 'repayment-overdue') {
            const detailLinkHref = `/my-loan/${activeLoan.id}${simulationDate ? `?simDate=${simulationDate.toISOString().split('T')[0]}` : ''}`;
            let nextPaymentDateStr = 'Próximamente';
            let daysOverdue = 0;

            const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

            if (activeLoan.paymentDay) {
                let paymentDateThisMonth = setDate(today, activeLoan.paymentDay);
                let nextPaymentDate = paymentDateThisMonth;
                let lastDueDate = paymentDateThisMonth;

                if (today.getTime() > paymentDateThisMonth.getTime()) {
                    nextPaymentDate = addMonths(paymentDateThisMonth, 1);
                } else {
                    lastDueDate = addMonths(paymentDateThisMonth, -1);
                }

                if (status === 'repayment-overdue' && overduePaymentAmount > 0) {
                    daysOverdue = differenceInDays(today, startOfDay(lastDueDate));
                    nextPaymentDateStr = format(lastDueDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
                } else {
                    nextPaymentDateStr = format(nextPaymentDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
                }
            }

            return {
                icon: <DollarSign className="h-10 w-10 text-primary" />,
                title: overduePaymentAmount > 0 ? 'Pago vencido' : 'Préstamo activo',
                description: `Tu fecha de pago es el ${activeLoan.paymentDay} de cada mes. Próxima fecha: ${nextPaymentDateStr}.`,
                content: (
                    <div className='w-full text-left space-y-4'>
                        {/* Indicador de pago en proceso - basado en reserva activa en RTDB */}
                        {hasActiveReservation && (
                            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                <Timer className="h-5 w-5 text-amber-600 animate-pulse" />
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-amber-800">Pago en proceso</p>
                                    <p className="text-xs text-amber-600">
                                        Tienes una reserva activa. {reservationTimeRemaining > 0 && (
                                            <span className="font-semibold">
                                                {Math.floor(reservationTimeRemaining / 60)}:{(reservationTimeRemaining % 60).toString().padStart(2, '0')} restantes
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-amber-300 text-amber-700 hover:bg-amber-100"
                                    onClick={() => setIsRepaymentModalOpen(true)}
                                >
                                    Continuar
                                </Button>
                            </div>
                        )}

                        <Button asChild className='w-full' variant='outline'>
                            <Link href={detailLinkHref}>
                                <ListChecks className='mr-2 h-4 w-4' />
                                Ver detalle del préstamo
                            </Link>
                        </Button>

                        {/* Sección de pago compacta */}
                        {(() => {
                            // Calcular cuota de tecnología mínima acumulada hasta hoy
                            const dailyTechFee = ((activeLoan.technologyFee || 8000) * 12) / 365;
                            const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

                            // Encontrar la fecha del último evento (última inversión o último pago)
                            let lastEventDate = today;
                            if (loanInvestments && loanInvestments.length > 0) {
                                const sortedInvestments = [...loanInvestments].sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
                                lastEventDate = startOfDay(fromUnixTime(sortedInvestments[0].createdAt.seconds));
                            }
                            // TODO: También considerar último pago si existe

                            const daysAccumulated = Math.max(1, differenceInDays(today, lastEventDate));
                            const minPayment = Math.ceil(dailyTechFee * daysAccumulated); // Tech fee acumulado
                            const maxPayment = totalPayoffAmount; // Saldo total EXACTO con decimales
                            const sliderMax = Math.ceil(maxPayment); // Máximo del slider (redondeado hacia arriba)

                            // isMaxSelected solo si el slider está exactamente en el tope
                            const isMaxSelected = selectedPaymentAmount === sliderMax;
                            // Si el input está vacío (0 o undefined), usar 0 para el efectivo
                            const effectivePaymentAmount = isMaxSelected ? maxPayment : (selectedPaymentAmount ?? 0);
                            const isValidPayment = effectivePaymentAmount >= minPayment;

                            return (
                                <div className='w-full border rounded-lg p-3 space-y-3'>
                                    {/* Montos - clickeables */}
                                    <div className="flex items-center justify-between text-sm">
                                        <button
                                            type="button"
                                            onClick={() => setSelectedPaymentAmount(Math.ceil(overduePaymentAmount))}
                                            className="text-left hover:bg-muted/50 rounded p-1 -m-1 transition-colors"
                                        >
                                            <p className="text-xs text-muted-foreground">Cuota</p>
                                            <p className="font-semibold">{formatCurrency(overduePaymentAmount, 0)}</p>
                                        </button>
                                        <Separator orientation="vertical" className="h-8" />
                                        <button
                                            type="button"
                                            onClick={() => setSelectedPaymentAmount(sliderMax)}
                                            className="text-right hover:bg-muted/50 rounded p-1 -m-1 transition-colors"
                                        >
                                            <p className="text-xs text-muted-foreground">Saldo total</p>
                                            <p className="font-semibold text-green-600">{formatCurrency(totalPayoffAmount, 2)}</p>
                                        </button>
                                    </div>

                                    {/* Selector de monto */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">$</span>
                                            <Input
                                                type="text"
                                                inputMode="numeric"
                                                value={selectedPaymentAmount === sliderMax
                                                    ? new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(maxPayment)
                                                    : selectedPaymentAmount !== undefined && selectedPaymentAmount !== null
                                                        ? new Intl.NumberFormat('es-CO').format(selectedPaymentAmount)
                                                        : ''
                                                }
                                                onChange={(e) => {
                                                    const value = e.target.value.replace(/\D/g, '');
                                                    if (value === '') {
                                                        setSelectedPaymentAmount(0);
                                                    } else {
                                                        const numValue = parseInt(value) || 0;
                                                        setSelectedPaymentAmount(Math.min(numValue, sliderMax));
                                                    }
                                                }}
                                                className="h-8 text-center text-sm font-medium"
                                                placeholder="0"
                                            />
                                        </div>
                                        <Slider
                                            value={[selectedPaymentAmount || 0]}
                                            onValueChange={(value) => setSelectedPaymentAmount(value[0])}
                                            min={0}
                                            max={sliderMax}
                                            step={1000}
                                            className="w-full"
                                        />
                                        <p className="text-xs text-muted-foreground text-center">
                                            Mín: {formatCurrency(minPayment, 0)} (tech fee {daysAccumulated} días)
                                        </p>
                                    </div>

                                    {/* Botón pagar */}
                                    <Button
                                        className='w-full h-9 text-sm'
                                        onClick={() => handlePaymentClick(effectivePaymentAmount)}
                                        disabled={actionLoading || !isValidPayment}
                                    >
                                        {actionLoading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}
                                        Pagar {effectivePaymentAmount > 0 ? formatCurrency(effectivePaymentAmount, isMaxSelected ? 2 : 0) : '$0'}
                                    </Button>
                                </div>
                            );
                        })()}
                    </div>
                )
            };
        }

        if (status === 'pending-review') {
            return {
                icon: <FileCheck2 className="h-10 w-10 text-primary" />,
                title: "Revisión final",
                description: "Hemos recibido tus documentos y están en la revisión final por parte de nuestro equipo.",
                content: <p className="font-semibold text-lg text-primary">Pronto tendrás noticias</p>
            }
        }

        if (status === 'pending') {
            return {
                icon: <Hourglass className="h-10 w-10 text-primary" />,
                title: "Solicitud en estudio",
                description: "Tu solicitud de crédito está siendo evaluada por nuestro equipo.",
                content: <p className="font-semibold text-lg text-primary">Pronto tendrás noticias</p>
            }
        }

        if (status === 'rejected-docs') {
            return {
                icon: <AlertCircle className="h-10 w-10 text-orange-500" />,
                title: "Problema con documentos",
                description: "Hubo un problema con los documentos que subiste. Por favor, corrígelos.",
                content: (
                    <div className='flex gap-2'>
                        <Button asChild size="lg" className="bg-orange-500 text-white hover:bg-orange-600">
                            <Link href={`/approval/${activeLoan.id}`}>Corregir documentos</Link>
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
                title: "Solicitud rechazada",
                description: "Lamentablemente, tu solicitud no pudo ser aprobada en este momento.",
                content: (
                    <Button onClick={handleWithdraw} size="lg" variant="destructive">
                        Entendido
                    </Button>
                )
            }
        }

        if (status === 'completed') {
            // Calcular estadísticas para la tarjeta de celebración

            // 1. Intereses Totales Pagados
            const totalInterestPaid = loanPayments.reduce((sum, p) => sum + (p.interest || 0), 0);

            // 2. Duración (Fecha Inicio vs Fecha Final/Hoy)
            let startDate = activeLoan.startDate ? new Date(activeLoan.startDate) : null;
            if (!startDate && loanInvestments.length > 0) {
                // Fallback: usar la fecha de la primera inversión confirmada
                const sorted = [...loanInvestments].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);
                startDate = new Date(sorted[0].createdAt.seconds * 1000);
            }

            const endDate = simulationDate || new Date();
            let durationStr = 'N/A';

            if (startDate) {
                const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays > 60) {
                    const months = Math.floor(diffDays / 30);
                    durationStr = `${months} meses`;
                } else {
                    durationStr = `${diffDays} días`;
                }
            }

            return {
                icon: null, // Icon handled inside the component
                title: '', // Title handled inside component
                description: '',
                content: <CelebrationCard
                    loanAmount={activeLoan.amount}
                    duration={durationStr}
                    interestPaid={totalInterestPaid}
                    onViewDetails={() => router.push(`/my-loan/${activeLoan.id}`)}
                />,
                isFullCustom: true
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


    // --- TESTING TOOLS ---
    const handleResetFunding = async () => {
        if (!activeLoan) return;
        if (!confirm("¿Estás seguro de eliminar todas las inversiones (excepto la comisión)? Esto reiniciará el progreso.")) return;

        setActionLoading(true);
        try {
            await runTransaction(db, async (transaction) => {
                // 1. Get all investments for this loan
                const q = query(collection(db, 'investments'), where('loanId', '==', activeLoan.id));
                const querySnapshot = await getDocs(q);

                let totalDeleted = 0;
                let feeAmount = 0;

                // 2. Delete investor investments, keep Banqi Fee
                for (const docSnapshot of querySnapshot.docs) {
                    const inv = docSnapshot.data() as Investment;
                    if (inv.investorId !== BANQI_FEE_INVESTOR_ID) {
                        transaction.delete(docSnapshot.ref);
                        totalDeleted += inv.amount;
                    } else {
                        feeAmount += inv.amount;
                    }
                }

                // 3. Update Loan
                const loanRef = doc(db, 'loanRequests', activeLoan.id);
                const newFundedPercentage = (feeAmount / activeLoan.amount) * 100;

                transaction.update(loanRef, {
                    fundedPercentage: newFundedPercentage,
                    committedPercentage: newFundedPercentage,
                    status: 'funding-active' // Ensure it goes back to funding status
                });
            });

            toast({ title: "Fondeo Reiniciado", description: "Se han eliminado las inversiones de prueba." });
        } catch (error) {
            console.error("Error resetting funding:", error);
            toast({ title: "Error", description: "No se pudo reiniciar el fondeo.", variant: "destructive" });
        } finally {
            setActionLoading(false);
        }
    };

    const handleIncreaseLoanAmount = async () => {
        if (!activeLoan) return;
        setActionLoading(true);
        try {
            await runTransaction(db, async (transaction) => {
                const loanRef = doc(db, 'loanRequests', activeLoan.id);
                const loanDoc = await transaction.get(loanRef);
                if (!loanDoc.exists()) throw new Error("Loan not found");

                const currentAmount = loanDoc.data().amount;
                const newAmount = currentAmount + 500000;

                // Recalculate percentages based on new amount
                // We need current funded amount to do this correctly
                // Let's assume current funded percentage is correct relative to OLD amount
                const currentFundedAmount = (loanDoc.data().fundedPercentage / 100) * currentAmount;
                const newFundedPercentage = (currentFundedAmount / newAmount) * 100;
                const currentCommittedAmount = (loanDoc.data().committedPercentage / 100) * currentAmount;
                const newCommittedPercentage = (currentCommittedAmount / newAmount) * 100;

                transaction.update(loanRef, {
                    amount: newAmount,
                    fundedPercentage: newFundedPercentage,
                    committedPercentage: newCommittedPercentage
                });
            });
            toast({ title: "Monto Aumentado", description: "Se agregaron $500.000 al monto del préstamo." });
        } catch (error) {
            console.error("Error increasing amount:", error);
            toast({ title: "Error", description: "Fallo al aumentar monto.", variant: "destructive" });
        } finally {
            setActionLoading(false);
        }
    };


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
                        className="mt-2 text-xs" // Reduced size
                    />
                    {activeLoan && (
                        <div className="flex gap-2 mt-4 pt-4 border-t border-dashed">
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-xs h-8 border-destructive/50 text-destructive hover:bg-destructive/10"
                                onClick={handleResetFunding}
                                disabled={actionLoading}
                            >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Reset Fondeo
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-xs h-8"
                                onClick={handleIncreaseLoanAmount}
                                disabled={actionLoading}
                            >
                                <DollarSign className="h-3 w-3 mr-1" />
                                +500k Monto
                            </Button>
                        </div>
                    )}
                </Card>
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold tracking-tight">Bienvenido a Banqi</h1>
                    <p className="text-xl text-muted-foreground mt-2">¿Qué te gustaría hacer hoy?</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
                    {/* Main Action Card */}
                    <div className={`flex flex-col text-center items-center justify-center transition-all ${loanCardData?.isFullCustom
                        ? 'w-full'
                        : 'p-8 rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-xl hover:scale-105'
                        }`}>
                        {loanCardData ? (
                            loanCardData.isFullCustom ? (
                                loanCardData.content
                            ) : (
                                <>
                                    <CardHeader>
                                        {loanCardData.icon && (
                                            <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                                                {loanCardData.icon}
                                            </div>
                                        )}
                                        <CardTitle className="text-2xl mt-4">{loanCardData.title}</CardTitle>
                                        {loanCardData.description && <CardDescription>{loanCardData.description}</CardDescription>}
                                    </CardHeader>
                                    <CardContent className="w-full">
                                        {loanCardData.content}
                                    </CardContent>
                                </>
                            )
                        ) : (
                            <>
                                <CardHeader>
                                    <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                                        <Send className="h-10 w-10 text-primary" />
                                    </div>
                                    <CardTitle className="text-2xl mt-4">Quiero un préstamo</CardTitle>
                                    <CardDescription>Solicita un crédito de forma rápida y sencilla.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                                        <Link href="/request">Solicitar ahora</Link>
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
            {isRepaymentModalOpen && paymentBreakdown && paymentDistribution.length > 0 && user && activeLoan && (
                <RepaymentModal
                    isOpen={isRepaymentModalOpen}
                    onClose={() => setIsRepaymentModalOpen(false)}
                    payingLoan={activeLoan}
                    payingLoanBreakdown={paymentBreakdown}
                    paymentDistribution={paymentDistribution}
                    onConfirm={(proofFiles, finalDistribution, bankerReinvestAmounts) => confirmRepayment(proofFiles, finalDistribution, bankerReinvestAmounts)}
                    bankers={bankersForModal}
                    loansInQueue={loansInQueue}
                />
            )}
        </>
    );
}

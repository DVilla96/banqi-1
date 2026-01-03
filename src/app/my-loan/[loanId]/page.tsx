

'use client';

import { useState, useEffect, useMemo, useContext } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import { Loader2, FileSignature, Landmark, Percent, Calendar, Eye, CalendarDays, Calculator, Info, Wallet, HandCoins } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import Link from 'next/link';
import { format, parseISO, differenceInDays, startOfDay, setDate, addMonths, fromUnixTime } from 'date-fns';
import { es } from 'date-fns/locale';
import PromissoryNoteModal from '@/components/portal/promissory-note-modal';
import { Investment, Loan, Payment, CalculationDetails } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import AmortizationTable from '@/components/loans/amortization-table';
import { SimulationContext } from '@/hooks/use-simulation-date';
import { generatePreciseAmortizationSchedule } from '@/lib/financial-utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';


type ConfirmedInvestment = Investment & {
    id: string;
    amount: number;
    createdAt: Timestamp;
    confirmedAt: Timestamp;
    investorName: string;
    paymentProofUrl: string;
    investorFirstName?: string;
    investorLastName?: string;
}

const formatCurrency = (value: number, decimals = 0) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value);
};

const formatPercent = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

const formatDate = (date: Date | null | undefined) => {
    if (!date) return "Pendiente";
    // No manual timezone adjustment needed if server and client handle dates correctly.
    return format(date, 'dd MMM yyyy', { locale: es });
}

const BANQI_FEE_INVESTOR_ID = 'banqi_platform_fee';


export default function MyLoanDetailPage() {
    const { loanId } = useParams();
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { simulationDate, setSimulationDate } = useContext(SimulationContext);

    const [loan, setLoan] = useState<Loan | null>(null);
    const [investments, setInvestments] = useState<ConfirmedInvestment[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedInvestment, setSelectedInvestment] = useState<ConfirmedInvestment | null>(null);
    
    useEffect(() => {
        const simDateParam = searchParams.get('simDate');
        if (simDateParam) {
            const date = parseISO(simDateParam);
            const correctedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60 * 1000);
            if (!simulationDate || simulationDate.getTime() !== correctedDate.getTime()) {
                setSimulationDate(correctedDate);
            }
        }
    }, [searchParams, simulationDate, setSimulationDate]);

    useEffect(() => {
        const fetchLoanDetails = async () => {
            if (!user || !loanId) return;
            setLoading(true);

            try {
                const loanRef = doc(db, 'loanRequests', loanId as string);
                const loanSnap = await getDoc(loanRef);

                if (!loanSnap.exists() || loanSnap.data().requesterId !== user.uid) {
                    router.push('/portal');
                    return;
                }

                const loanData = { id: loanSnap.id, ...loanSnap.data() } as Loan;
                setLoan(loanData);
                
                const investmentsQuery = query(
                    collection(db, 'investments'),
                    where('loanId', '==', loanId),
                    where('status', '==', 'confirmed'),
                    orderBy('createdAt', 'asc')
                );

                const paymentsQuery = query(
                    collection(db, 'payments'),
                    where('loanId', '==', loanId),
                    orderBy('paymentDate', 'asc')
                );

                const [investmentsSnapshot, paymentsSnapshot] = await Promise.all([
                    getDocs(investmentsQuery),
                    getDocs(paymentsQuery)
                ]);

                const confirmedInvestments: ConfirmedInvestment[] = [];
                for (const investDoc of investmentsSnapshot.docs) {
                     const data = investDoc.data();
                    let investorFirstName = 'Inversionista';
                    let investorLastName = '';
                    let investorName = 'Inversionista Anónimo';

                    if (data.investorId === BANQI_FEE_INVESTOR_ID) {
                        investorName = 'Banqi (Plataforma)';
                    } else if (data.investorId) {
                        const investorRef = doc(db, 'users', data.investorId);
                        const investorSnap = await getDoc(investorRef);
                        if (investorSnap.exists()) {
                            const investorData = investorSnap.data() as UserProfile;
                            investorFirstName = investorData.firstName || '';
                            investorLastName = investorData.lastName || '';
                            investorName = `${investorFirstName} ${investorLastName}`.trim();
                        }
                    }
                    
                    confirmedInvestments.push({
                        id: investDoc.id,
                        ...(data as Investment),
                        investorName: investorName,
                        investorFirstName,
                        investorLastName,
                    } as ConfirmedInvestment);
                }
                
                const fetchedPayments: Payment[] = paymentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()} as Payment));
                
                setInvestments(confirmedInvestments);
                setPayments(fetchedPayments);

            } catch (error) {
                console.error("Error fetching loan details:", error);
                router.push('/portal');
            } finally {
                setLoading(false);
            }
        };

        if (!authLoading) {
            fetchLoanDetails();
        }
    }, [loanId, user, authLoading, router]);

    const totalFunded = useMemo(() => investments.reduce((acc, inv) => acc + inv.amount, 0), [investments]);
    
    const { netDisbursement, amortizationDetails, participationData } = useMemo(() => {
        if (!loan) return { netDisbursement: 0, amortizationDetails: null, participationData: [] };
        
        const details = generatePreciseAmortizationSchedule(loan, investments, payments, simulationDate);
        
        // --- Correct Participation Calculation ---
        let participationData: {id: string, participation: number}[] = [];
        if (investments.length > 0 && loan.interestRate) {
            const dailyRate = Math.pow(1 + (loan.interestRate / 100), 1 / 30.4167) - 1;
            const focalDate = startOfDay(fromUnixTime(investments[0].createdAt.seconds));

            const presentValues = investments.map(inv => {
                const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
                const daysDiff = differenceInDays(invDate, focalDate);
                const pv = inv.amount / Math.pow(1 + dailyRate, daysDiff);
                return { id: inv.id, pv };
            });
            
            const totalPresentValue = presentValues.reduce((acc, val) => acc + val.pv, 0);

            if (totalPresentValue > 0) {
                participationData = presentValues.map(item => ({
                    id: item.id,
                    participation: item.pv / totalPresentValue
                }));
            }
        }
        
        return {
            netDisbursement: Math.max(0, totalFunded - (loan.disbursementFee || 0)),
            amortizationDetails: details,
            participationData
        };
    }, [loan, investments, payments, simulationDate, totalFunded]);


    const isFullyFunded = useMemo(() => {
        if (!loan) return false;
        return totalFunded >= loan.amount;
    }, [loan, totalFunded]);
    
    const portalLinkHref = useMemo(() => {
        let href = '/portal';
        if (simulationDate) {
            href += `?simDate=${simulationDate.toISOString().split('T')[0]}`;
        }
        return href;
    }, [simulationDate]);


    const handleViewPromissory = (investment: ConfirmedInvestment) => {
        setSelectedInvestment(investment);
    }
    
    const firstPaymentRow = useMemo(() => amortizationDetails?.schedule.find(row => row.type === 'payment'), [amortizationDetails]);

    if (loading || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Cargando detalles de tu préstamo...</p>
            </div>
        );
    }
    
    if (!loan) {
        return <div className="text-center">No se pudo cargar la información del préstamo.</div>;
    }
    
    const showDisbursementInfo = ['funding-active', 'funded', 'repayment-active', 'repayment-overdue', 'completed'].includes(loan.status);

    return (
        <div className="space-y-8">
            <div className='flex items-center justify-between'>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Detalle de mi Préstamo</h1>
                </div>
                <Button asChild variant='outline'>
                    <Link href={portalLinkHref}>Volver al Portal</Link>
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Monto Total</CardTitle>
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatCurrency(loan.amount, 0)}</div>
                    </CardContent>
                 </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Tasa E.M.</CardTitle>
                        <Percent className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loan.interestRate}%</div>
                    </CardContent>
                 </Card>
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Plazo</CardTitle>
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loan.term} meses</div>
                    </CardContent>
                 </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Recibido (Neto)</CardTitle>
                        <Landmark className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{formatCurrency(netDisbursement, 0)}</div>
                         <p className="text-xs text-muted-foreground">{`Fondeado: ${formatCurrency(totalFunded)} - Costo: ${formatCurrency(loan.disbursementFee || 0)}`}</p>
                    </CardContent>
                 </Card>
                 {firstPaymentRow && (
                     <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Cuota Mensual</CardTitle>
                            <Calculator className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-primary">{formatCurrency(firstPaymentRow.flow, 0)}</div>
                            <p className="text-xs text-muted-foreground">Tecnología: {formatCurrency(firstPaymentRow.technologyFee)}</p>
                        </CardContent>
                     </Card>
                 )}
            </div>
            
             {showDisbursementInfo && (
                 <Accordion type="single" collapsible className="w-full" defaultValue="item-1">
                    <AccordionItem value="item-1">
                        <AccordionTrigger>
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <HandCoins className="h-5 w-5 text-primary" />
                                Desembolsos Recibidos y Pagarés
                            </h2>
                        </AccordionTrigger>
                        <AccordionContent>
                             <Card>
                                <CardContent className='p-0'>
                                     <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead>Banquero</TableHead>
                                                <TableHead className='text-right'>Participación</TableHead>
                                                <TableHead className='text-right'>Monto</TableHead>
                                                <TableHead className='text-right'>Pagaré</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {investments.map((investment) => {
                                                const participationInfo = participationData.find(p => p.id === investment.id);
                                                const participation = participationInfo ? participationInfo.participation : 0;
                                                return (
                                                    <TableRow key={investment.id}>
                                                        <TableCell>{formatDate(fromUnixTime(investment.createdAt.seconds))}</TableCell>
                                                        <TableCell>{investment.investorName}</TableCell>
                                                        <TableCell className="text-right font-mono">{formatPercent(participation)}</TableCell>
                                                        <TableCell className="text-right font-medium">{formatCurrency(investment.amount, 0)}</TableCell>
                                                        <TableCell className="text-right">
                                                            <Button variant='ghost' size='sm' onClick={() => handleViewPromissory(investment)}>
                                                                <FileSignature className='h-4 w-4 mr-2'/> Ver
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}

            <AmortizationTable loan={loan} investments={investments} payments={payments} simulationDate={simulationDate}/>
            
            {selectedInvestment && (
                 <PromissoryNoteModal
                    isOpen={!!selectedInvestment}
                    onClose={() => setSelectedInvestment(null)}
                    investment={selectedInvestment}
                    bankers={[{...selectedInvestment}]}
                    isReadOnly
                />
            )}
        </div>
    );
}

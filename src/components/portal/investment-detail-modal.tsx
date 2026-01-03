

'use client';

import { useState, useEffect, useMemo, useRef, useContext } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Handshake, User, FileSignature, FileText, Wallet, Calendar, Percent, Download, Loader2, TrendingUp, HandCoins, Banknote, CalendarCheck, AlertCircle, CheckCircle } from 'lucide-react';
import type { Investment, Loan, Payment, UserProfile } from '@/lib/types';
import InvestmentDetail from './investment-detail';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import Link from 'next/link';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { differenceInMonths, parseISO, differenceInYears, addMonths, startOfDay, differenceInDays, fromUnixTime, format as formatDateFns } from 'date-fns';
import PromissoryNoteModal from '@/components/portal/promissory-note-modal';
import { collection, onSnapshot, orderBy, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { generatePreciseAmortizationSchedule } from '@/lib/financial-utils';
import { Badge } from '../ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { es } from 'date-fns/locale';
import { SimulationContext } from '@/hooks/use-simulation-date';


type InvestmentDetailModalProps = {
    isOpen: boolean;
    onClose: () => void;
    investment: Investment;
    loan: Loan;
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


const borrowerName = (loan?: Loan) => {
    if (!loan) return 'Deudor';
    const firstName = (loan.requesterFirstName || '').split(' ').map(n => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()).join(' ');
    const lastName = (loan.requesterLastName || '').split(' ').map(n => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()).join(' ');
    return `${firstName} ${lastName}`.trim() || 'Deudor';
}

const getInitials = (loan?: Loan) => {
    if (!loan) return '..';
    const first = (loan.requesterFirstName || '').split(' ')[0];
    const last = (loan.requesterLastName || '').split(' ')[0];
    return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
}


export default function InvestmentDetailModal({ isOpen, onClose, investment, loan }: InvestmentDetailModalProps) {
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [allLoanInvestments, setAllLoanInvestments] = useState<Investment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const { simulationDate } = useContext(SimulationContext);
  
  useEffect(() => {
    if (!isOpen) return;

    const investmentsQuery = query(collection(db, 'investments'), where('loanId', '==', loan.id), where('status', '==', 'confirmed'));
    const paymentsQuery = query(collection(db, 'payments'), where('loanId', '==', loan.id), orderBy('paymentDate', 'asc'));

    const unsubInvestments = onSnapshot(investmentsQuery, (snapshot) => {
        const invs: Investment[] = [];
        snapshot.forEach(doc => invs.push({ id: doc.id, ...doc.data() } as Investment));
        setAllLoanInvestments(invs);
    });

    const unsubPayments = onSnapshot(paymentsQuery, (snapshot) => {
        const pays: Payment[] = [];
        snapshot.forEach(doc => pays.push({ id: doc.id, ...doc.data() } as Payment));
        setPayments(pays);
    });

    Promise.all([
        getDocs(investmentsQuery),
        getDocs(paymentsQuery)
    ]).then(() => setLoading(false)).catch(() => setLoading(false));

    return () => {
        unsubInvestments();
        unsubPayments();
    };
}, [isOpen, loan.id]);


  const firstName = useMemo(() => {
    return (loan.requesterFirstName || '').split(' ')[0] || 'El solicitante';
  }, [loan.requesterFirstName]);

  const workNarrative = useMemo(() => {
    if (!loan.employerName || !loan.position || !loan.startDate) {
      return null;
    }
    try {
        const startDate = parseISO(loan.startDate);
        const now = new Date();
        const totalMonths = differenceInMonths(now, startDate);
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;

        let tenureString = '';
        if (years > 0) {
            tenureString = `hace ${years} año${years > 1 ? 's' : ''}`;
            if (months > 0) {
                tenureString += ` y ${months} mes${months > 1 ? 'es' : ''}`;
            }
        } else if (months >= 0) {
            tenureString = `hace ${months} mes${months > 1 ? 'es' : ''}`;
        }
        
        return `${firstName} trabaja en ${loan.employerName} como ${loan.position} desde ${tenureString}.`;
    } catch (e) {
        console.error("Error parsing start date:", e);
        return null;
    }
  }, [loan.employerName, loan.position, loan.startDate, firstName]);
  
  const investorInterestRate = useMemo(() => {
    if (!loan.interestRate) return 0;
    // Investor gets 70% of the interest
    return (loan.interestRate * 0.7).toFixed(2);
  }, [loan.interestRate]);

  const { totalGains, loanStatus, currentValue } = useMemo(() => {
    const initialReturn = { totalGains: 0, loanStatus: { status: loan.status, label: 'Calculando...' }, currentValue: investment.amount };

    if (loading || allLoanInvestments.length === 0) {
        return initialReturn;
    }

    const scheduleResult = generatePreciseAmortizationSchedule(loan, allLoanInvestments, payments, simulationDate);
    if (!scheduleResult) return initialReturn;
    
    const { schedule } = scheduleResult;

    const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

    let status = loan.status;
    const overdueInstallments = schedule.filter(row => row.type === 'payment' && row.isOverdue);
    if (overdueInstallments.length > 0) {
        status = 'repayment-overdue';
    }

    const fundedPercentage = loan.fundedPercentage || 0;
    const statusMap = {
        'funding-active': `En fondeo (${fundedPercentage.toFixed(2)}%)`,
        'funded': 'Fondeado',
        'repayment-active': 'Activo',
        'repayment-overdue': 'En mora',
        'completed': 'Completado'
    };

    const statusLabel = statusMap[status as keyof typeof statusMap] || status;
    
    // Placeholder for more precise calculations
    const investorMonthlyRate = (loan.interestRate / 100) * 0.7;
    const investorDailyInterestRate = Math.pow(1 + investorMonthlyRate, 1 / 30.4167) - 1;
    const investmentDate = fromUnixTime(investment.createdAt.seconds);
    const days = differenceInDays(today, startOfDay(investmentDate));
    const currentVal = investment.amount * Math.pow(1 + investorDailyInterestRate, days);
    const generatedGains = currentVal - investment.amount;

    return {
        totalGains: generatedGains,
        loanStatus: { status: status, label: statusLabel },
        currentValue: currentVal,
    };
  }, [loading, allLoanInvestments, payments, loan, investment, simulationDate]);


  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
           <div className="flex flex-col items-center justify-center text-center">
             <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
                <Handshake className="h-7 w-7" />
            </div>
            <DialogTitle className="text-xl">Detalle de inversión</DialogTitle>
            <DialogDescription>
              Aquí puedes ver el estado actual y los detalles de tu inversión en el préstamo de {borrowerName(loan)}.
            </DialogDescription>
          </div>
        </DialogHeader>
        
        <div className="my-2 max-h-[60vh] overflow-y-auto p-1 space-y-4">

           <Card className="overflow-hidden">
                <CardHeader className="flex-row items-center gap-4 p-4 bg-muted/20">
                    <Avatar className="h-14 w-14 border">
                        <AvatarImage src={loan.requesterPhotoUrl} alt={borrowerName(loan)} />
                        <AvatarFallback>{getInitials(loan)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-1">
                        <p className="text-lg font-bold leading-tight">{borrowerName(loan)}</p>
                    </div>
                     <Button size="sm" variant="outline" onClick={() => setIsNoteOpen(true)}>
                        <FileSignature className="mr-1.5 h-4 w-4" /> Ver pagaré
                    </Button>
                </CardHeader>
                <CardContent className='p-4 space-y-3'>
                    {workNarrative && <p className="text-sm text-muted-foreground italic">{workNarrative}</p>}
                    <div className='flex items-center gap-4 pt-1'>
                        {loan.workCertificateUrl && (
                             <Button asChild variant="ghost" className='h-auto p-1 text-xs text-muted-foreground hover:text-primary'>
                                <Link href={loan.workCertificateUrl} target="_blank" rel="noopener noreferrer">
                                    <FileText className="mr-1 h-3 w-3" /> Cert. Laboral
                                </Link>
                            </Button>
                        )}
                         {loan.bankCertificateUrl && (
                            <Button asChild variant="ghost" className='h-auto p-1 text-xs text-muted-foreground hover:text-primary'>
                                <Link href={loan.bankCertificateUrl} target="_blank" rel="noopener noreferrer">
                                    <FileText className="mr-1 h-3 w-3" /> Cert. Bancario
                                </Link>
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
            
            <div className="border rounded-lg p-4 space-y-3">
                <div className='flex justify-end'>
                    <Badge variant={loanStatus.status === 'repayment-overdue' ? 'destructive' : 'secondary'}>
                        {loanStatus.status === 'repayment-overdue' ? <AlertCircle className="h-3 w-3 mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                        {loanStatus.label}
                    </Badge>
                </div>
                <div className="grid grid-cols-3 gap-x-4 text-center">
                    <div>
                        <p className='text-sm text-muted-foreground'>Inversión</p>
                        <p className="font-bold text-lg text-primary">{formatCurrency(investment.amount)}</p>
                    </div>
                     <div>
                        <p className='text-sm text-muted-foreground'>Valor actual</p>
                        <p className="font-bold text-lg text-primary">{formatCurrency(currentValue)}</p>
                    </div>
                     <div>
                        <p className='text-sm text-muted-foreground'>Ganancia</p>
                        <p className="font-bold text-lg text-green-600">{formatCurrency(totalGains)}</p>
                    </div>
                </div>
            </div>

            <Card>
                <CardHeader className='p-4 pb-2'>
                    <CardTitle className='text-base'>Condiciones del crédito</CardTitle>
                </CardHeader>
                 <CardContent className='p-4 pt-0 text-sm space-y-2'>
                    {investment.createdAt && (
                        <div className="flex justify-between">
                            <span className='text-muted-foreground flex items-center gap-1.5'><CalendarCheck className="h-4 w-4"/> Fecha de inversión:</span> 
                            <span className='font-bold'>{formatDateFns(fromUnixTime(investment.createdAt.seconds), "dd 'de' MMMM yyyy", { locale: es })}</span>
                        </div>
                    )}
                    <div className="flex justify-between">
                        <span className='text-muted-foreground flex items-center gap-1.5'><Wallet className="h-4 w-4"/> Monto total:</span> 
                        <span className='font-bold'>{formatCurrency(loan.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className='text-muted-foreground flex items-center gap-1.5'><Calendar className="h-4 w-4"/> Plazo:</span> 
                        <span className='font-bold'>{loan.term} meses</span>
                    </div>
                    <div className="flex justify-between">
                        <span className='text-muted-foreground flex items-center gap-1.5'><Percent className="h-4 w-4"/> Tu rentabilidad E.M.:</span> 
                        <span className='font-bold text-primary'>{investorInterestRate}%</span>
                    </div>
                    {loan.paymentDay && (
                        <div className="flex justify-between">
                            <span className='text-muted-foreground flex items-center gap-1.5'><CalendarCheck className="h-4 w-4"/> Fecha máxima de próximo pago:</span>
                            <span className='font-bold'>{formatDateFns(addMonths(new Date(), 1), `'${loan.paymentDay} de' MMMM`, { locale: es })}</span>
                        </div>
                    )}
                </CardContent>
            </Card>
            
           {allLoanInvestments.length > 0 && (
            <InvestmentDetail investment={investment} loan={loan} allLoanInvestments={allLoanInvestments} payments={payments} />
           )}
        </div>

      </DialogContent>
    </Dialog>

    {isNoteOpen && loan.requesterId && (
       <PromissoryNoteModal
            isOpen={isNoteOpen}
            onClose={() => setIsNoteOpen(false)}
            investment={{...investment, investorId: investment.investorId || ''}}
            bankers={[{...investment, investorId: investment.investorId || ''}]}
            isReadOnly
        />
    )}
    </>
  );
}

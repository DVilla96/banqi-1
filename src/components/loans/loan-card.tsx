
'use client';

import type { Investment, Loan } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useMemo, useState, useEffect } from 'react';
import { differenceInMonths, parseISO, differenceInYears } from 'date-fns';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import InvestorKycModal from './investor-kyc-modal';
import InvestmentModal from './investment-modal';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Badge } from '../ui/badge';

type LoanCardProps = {
  loan: Loan;
};

const formatCurrency = (value: number) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

export default function LoanCard({ loan }: LoanCardProps) {
  const { user, profile } = useAuth();
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);
  const [isInvestmentModalOpen, setIsInvestmentModalOpen] = useState(false);
  const [userInvestments, setUserInvestments] = useState<Investment[]>([]);

  useEffect(() => {
    if (!user) return;
    
    // Simplified query to avoid composite index requirement.
    // We will sort the results on the client side.
    const q = query(
        collection(db, 'investments'),
        where('investorId', '==', user.uid),
        where('loanId', '==', loan.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const investments: Investment[] = [];
        snapshot.forEach(doc => {
            investments.push({ id: doc.id, ...doc.data() } as Investment);
        });
        
        // Sort manually on the client
        investments.sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return dateB - dateA;
        });

        setUserInvestments(investments.filter(inv => inv.isRepayment !== true));
    });

    return () => unsubscribe();
  }, [user, loan.id]);
  
  const { totalUserInvestment, confirmedAmount, pendingAmount, disputedAmount, rejectedAmount } = useMemo(() => {
    return userInvestments.reduce(
        (acc, inv) => {
            // Only add to the total if it's not a rejected investment
            if (inv.status !== 'rejected_by_admin') {
                acc.totalUserInvestment += inv.amount;
            }

            if (inv.status === 'confirmed') {
                acc.confirmedAmount += inv.amount;
            } else if (inv.status === 'pending-confirmation') {
                acc.pendingAmount += inv.amount;
            } else if (inv.status === 'disputed') {
                acc.disputedAmount += inv.amount;
            } else if (inv.status === 'rejected_by_admin') {
                acc.rejectedAmount += inv.amount;
            }
            return acc;
        },
        { totalUserInvestment: 0, confirmedAmount: 0, pendingAmount: 0, disputedAmount: 0, rejectedAmount: 0 }
    );
  }, [userInvestments]);

  const fundedPercentage = loan.fundedPercentage || 0;
  const committedPercentage = loan.committedPercentage || 0;
  const pendingPercentage = Math.max(0, committedPercentage - fundedPercentage);

  const requesterName = useMemo(() => {
    const first = (loan.requesterFirstName || '').split(' ')[0];
    const last = (loan.requesterLastName || '').split(' ')[0];
    return first && last ? `${first} ${last}` : 'Solicitante';
  }, [loan.requesterFirstName, loan.requesterLastName]);

  const firstName = useMemo(() => {
    return (loan.requesterFirstName || '').split(' ')[0] || 'El solicitante';
  }, [loan.requesterFirstName]);
  
  const age = useMemo(() => {
    if (!loan.dateOfBirth) return null;
    try {
        const birthDate = parseISO(loan.dateOfBirth);
        const ageValue = differenceInYears(new Date(), birthDate);
        return `${ageValue} años`;
    } catch (e) {
        console.error("Error parsing date of birth:", e);
        return null;
    }
  }, [loan.dateOfBirth]);


  const getInitials = () => {
    const first = (loan.requesterFirstName || '').split(' ')[0];
    const last = (loan.requesterLastName || '').split(' ')[0];
    return `${first?.[0] || ''}${last?.[0] || ''}`.toUpperCase();
  }

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

  const amountToFund = useMemo(() => {
    if (!loan.amount) return 0;
    return loan.amount * (1 - (committedPercentage / 100));
  }, [loan.amount, committedPercentage]);

  const fundedAmount = useMemo(() => {
    if (!loan.amount) return 0;
    return loan.amount * (fundedPercentage / 100);
  }, [loan.amount, fundedPercentage]);

  const pendingAmountGlobal = useMemo(() => {
      if (!loan.amount) return 0;
      const committedAmountValue = loan.amount * (committedPercentage / 100);
      const fundedAmountValue = loan.amount * (fundedPercentage / 100);
      return Math.max(0, committedAmountValue - fundedAmountValue);
  }, [loan.amount, committedPercentage, fundedPercentage]);


  const investorInterestRate = useMemo(() => {
    if (!loan.interestRate) return 0;
    return (loan.interestRate * 0.7).toFixed(2);
  }, [loan.interestRate]);

  const handleInvestClick = () => {
    if (!profile?.idNumber) {
        setIsKycModalOpen(true);
    } else {
        setIsInvestmentModalOpen(true);
    }
  }

  const getStatusBadge = (status: Investment['status']) => {
    switch (status) {
        case 'confirmed':
            return <Badge className="bg-green-100 text-green-800 border-green-200">Confirmado</Badge>;
        case 'pending-confirmation':
            return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pendiente</Badge>;
        case 'disputed':
            return <Badge variant="destructive">En Disputa</Badge>;
        case 'rejected_by_admin':
            return <Badge variant="destructive">Rechazado</Badge>;
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
  }

  return (
    <>
    <Card className="flex w-full flex-col overflow-hidden transition-shadow hover:shadow-xl">
        <CardHeader className="flex-row items-start gap-4 p-6 bg-muted/20">
            <Avatar className="h-20 w-20 border-2 border-background shadow-md">
              <AvatarImage src={loan.requesterPhotoUrl} alt={`Foto de ${requesterName}`} className="object-cover" />
              <AvatarFallback className="text-2xl">{getInitials()}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <CardTitle className="text-xl font-bold">{requesterName}</CardTitle>
              {age && <p className="text-sm text-muted-foreground">{age}</p>}
              {loan.requesterEmail && <p className="text-xs text-muted-foreground">{loan.requesterEmail}</p>}
            </div>
        </CardHeader>
        
        <CardContent className="flex-grow space-y-6 p-6">
             <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                    <p className="text-sm text-muted-foreground">Monto Total</p>
                    <p className="text-2xl font-bold text-primary">{formatCurrency(loan.amount)}</p>
                </div>
                 <div>
                    <p className="text-sm text-muted-foreground">Rentabilidad E.M.</p>
                    <p className="text-2xl font-bold">{investorInterestRate}%</p>
                </div>
                 <div>
                    <p className="text-sm text-muted-foreground">Plazo</p>
                    <p className="text-2xl font-bold">{loan.term} meses</p>
                </div>
            </div>
            
            <Separator />
            
            <div className='space-y-2'>
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
            </div>

        </CardContent>
       
        <CardFooter className="flex-col items-stretch gap-4 p-6 pt-4 bg-muted/30">
             <div className="space-y-2">
                <div className="flex justify-between items-center text-sm">
                    <h4 className="font-semibold text-muted-foreground">Progreso de Fondeo</h4>
                    <span className="font-semibold text-primary">{committedPercentage.toFixed(2)}%</span>
                </div>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div className="absolute h-full bg-green-500" style={{ width: `${fundedPercentage}%` }}></div>
                    <div className="absolute h-full bg-primary/30" style={{ left: `${fundedPercentage}%`, width: `${pendingPercentage}%` }}></div>
                </div>
                 <div className='text-xs text-muted-foreground space-y-1 mt-2'>
                    <div className='flex items-center justify-between'>
                        <span className='flex items-center gap-1.5'><div className='h-2 w-2 rounded-full bg-green-500'></div>Confirmado:</span>
                        <span className='font-medium text-foreground'>{formatCurrency(fundedAmount)}</span>
                    </div>
                     <div className='flex items-center justify-between'>
                        <span className='flex items-center gap-1.5'><div className='h-2 w-2 rounded-full bg-primary/30'></div>Pendiente:</span>
                        <span className='font-medium text-foreground'>{formatCurrency(pendingAmountGlobal)}</span>
                    </div>
                     <div className='flex items-center justify-between'>
                        <span className='flex items-center gap-1.5'><div className='h-2 w-2 rounded-full bg-secondary'></div>Disponible:</span>
                        <span className='font-medium text-foreground'>{formatCurrency(amountToFund)}</span>
                    </div>
                </div>
            </div>
            
            {userInvestments.length > 0 && (
                <div className="p-3 bg-background rounded-lg border mt-2">
                    <div>
                        <p className="font-semibold text-sm leading-tight">Tu Inversión Total</p>
                        <p className="font-bold text-lg text-primary">{formatCurrency(totalUserInvestment)}</p>
                    </div>
                    <Separator className='my-2'/>
                     <div className='text-xs text-muted-foreground space-y-1'>
                        {confirmedAmount > 0 && (
                            <div className='flex items-center justify-between'>
                                <span className='flex items-center gap-1.5 text-green-600'><div className='h-2 w-2 rounded-full bg-green-500'></div>Confirmado:</span>
                                <span className='font-medium text-foreground'>{formatCurrency(confirmedAmount)}</span>
                            </div>
                        )}
                        {pendingAmount > 0 && (
                            <div className='flex items-center justify-between'>
                                <span className='flex items-center gap-1.5 text-yellow-600'><div className='h-2 w-2 rounded-full bg-yellow-400'></div>Pendiente:</span>
                                <span className='font-medium text-foreground'>{formatCurrency(pendingAmount)}</span>
                            </div>
                        )}
                         {disputedAmount > 0 && (
                            <div className='flex items-center justify-between'>
                                <span className='flex items-center gap-1.5 text-red-600'><div className='h-2 w-2 rounded-full bg-red-500'></div>En Disputa:</span>
                                <span className='font-medium text-foreground'>{formatCurrency(disputedAmount)}</span>
                            </div>
                        )}
                        {rejectedAmount > 0 && (
                             <div className='flex items-center justify-between'>
                                <span className='flex items-center gap-1.5 text-destructive'><div className='h-2 w-2 rounded-full bg-destructive'></div>Rechazado:</span>
                                <span className='font-medium text-foreground'>{formatCurrency(rejectedAmount)}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {amountToFund > 0 && (
                <div className="text-center mt-2">
                    <Button size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={handleInvestClick}>Invertir</Button>
                </div>
            )}
        </CardFooter>
    </Card>
    {isKycModalOpen && user && (
        <InvestorKycModal 
            isOpen={isKycModalOpen}
            onClose={() => setIsKycModalOpen(false)}
            userId={user.uid}
            initialFirstName={profile?.firstName || user.displayName?.split(' ')[0] || ''}
            initialLastName={profile?.lastName || user.displayName?.split(' ').slice(1).join(' ') || ''}
        />
    )}
    {isInvestmentModalOpen && user && (
        <InvestmentModal
            isOpen={isInvestmentModalOpen}
            onClose={() => setIsInvestmentModalOpen(false)}
            loan={loan}
            investorId={user.uid}
        />
    )}
    </>
  );
}
    

    
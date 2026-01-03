'use client';

import type { Investment, Loan } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useMemo, useState } from 'react';
import { differenceInMonths, parseISO, differenceInYears } from 'date-fns';
import { Separator } from '../ui/separator';
import Link from 'next/link';
import { FileText, Eye } from 'lucide-react';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import InvestmentDetailModal from '../portal/investment-detail-modal';


type EnrichedInvestment = Investment & {
  loan?: Loan & UserProfile;
};

type InvestmentCardProps = {
  investment: EnrichedInvestment;
};

const formatCurrency = (value: number) => {
    if (!value || isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

export default function InvestmentCard({ investment }: InvestmentCardProps) {
  const { user } = useAuth();
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  
  const loan = investment.loan;
  if (!loan) return null;


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
        
        return `${firstName.toUpperCase()} trabaja en ${loan.employerName} como ${loan.position} desde ${tenureString}.`;
    } catch (e) {
        console.error("Error parsing start date:", e);
        return null;
    }
  }, [loan.employerName, loan.position, loan.startDate, firstName]);


  const investorInterestRate = useMemo(() => {
    if (!loan.interestRate) return 0;
    return (loan.interestRate * 0.7).toFixed(2);
  }, [loan.interestRate]);


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
            <div className="border rounded-lg p-3 bg-background">
                <p className="text-sm font-semibold leading-tight text-center">Tu Inversión en este Préstamo</p>
                <p className="font-bold text-2xl text-primary text-center">{formatCurrency(investment.amount)}</p>
            </div>
            <Button size="lg" onClick={() => setIsDetailModalOpen(true)}>
                <Eye className='mr-2 h-4 w-4' />
                Ver Detalle de Inversión
            </Button>
        </CardFooter>
    </Card>
     {isDetailModalOpen && (
        <InvestmentDetailModal
            isOpen={isDetailModalOpen}
            onClose={() => setIsDetailModalOpen(false)}
            investment={investment}
            loan={loan}
        />
    )}
    </>
  );
}

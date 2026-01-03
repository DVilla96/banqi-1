
'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '../ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const MONTHLY_INTEREST_RATE = 0.021;
const TECHNOLOGY_FEE = 8000;
const DISBURSEMENT_FEE = 25000;

export default function LoanSimulator() {
  const [amount, setAmount] = useState(1000000);
  const [term, setTerm] = useState(12);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const router = useRouter();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    if (!user) {
        toast({
            title: 'Error de autenticación',
            description: 'Debes iniciar sesión para solicitar un préstamo.',
            variant: 'destructive',
        });
        setLoading(false);
        return;
    }

    try {
        const loanRequestData = {
          requesterId: user.uid, 
          amount,
          term,
          status: 'pending',
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, "loanRequests"), loanRequestData);

        toast({
            title: 'Solicitud Enviada',
            description: 'Tu solicitud de crédito ha sido enviada para revisión.',
        });

        router.push('/portal');
        router.refresh();

    } catch (error: any) {
        console.error("Error submitting loan request:", error);
        toast({
            title: 'Error en la solicitud',
            description: 'No se pudo enviar tu solicitud. Verifica tus permisos o inténtalo más tarde.',
            variant: 'destructive',
        });
    } finally {
        setLoading(false);
    }
  };


  const { monthlyPayment, netDisbursement, annualInterestRate } = useMemo(() => {
    const principal = amount;
    const i = MONTHLY_INTEREST_RATE;
    const n = term;

    if (principal === 0 || i === 0 || n === 0) {
      return { monthlyPayment: 0, netDisbursement: 0, totalCost: 0, annualInterestRate: 0, totalInterestPaid: 0, totalTechnologyFee: 0 };
    }

    const interestPaymentPart = principal * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
    const totalMonthlyPayment = interestPaymentPart + TECHNOLOGY_FEE;
    const netDisbursementAmount = principal - DISBURSEMENT_FEE;
    
    const annualRate = Math.pow(1 + i, 12) - 1;

    return {
      monthlyPayment: totalMonthlyPayment,
      netDisbursement: netDisbursementAmount,
      annualInterestRate: annualRate,
    };
  }, [amount, term]);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-6">
        <div>
          <div className="flex justify-between items-center mb-2">
            <Label htmlFor="amount-slider" className="text-lg font-medium">Monto a Solicitar</Label>
            <span className="text-xl font-bold text-accent">{formatCurrency(amount)}</span>
          </div>
          <Slider
            id="amount-slider"
            min={100000}
            max={10000000}
            step={100000}
            value={[amount]}
            onValueChange={(value) => setAmount(value[0])}
            disabled={loading}
          />
           <div className="flex justify-between text-sm text-muted-foreground mt-1">
            <span>$100.000</span>
            <span>$10.000.000</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <Label htmlFor="term-slider" className="text-lg font-medium">Plazo</Label>
            <span className="text-xl font-bold text-accent">{term} meses</span>
          </div>
          <Slider
            id="term-slider"
            min={3}
            max={48}
            step={1}
            value={[term]}
            onValueChange={(value) => setTerm(value[0])}
            disabled={loading}
          />
           <div className="flex justify-between text-sm text-muted-foreground mt-1">
            <span>3 meses</span>
            <span>48 meses</span>
          </div>
        </div>
      </div>

      <Separator />
      
       <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
           <Card className="text-center">
              <CardHeader className='p-3 pb-2'>
                  <CardTitle className="text-sm font-medium text-muted-foreground">Tasa E.M.</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                  <p className="text-lg font-bold">{(MONTHLY_INTEREST_RATE * 100).toFixed(1)}%</p>
                  <p className="text-xs text-muted-foreground">E.A. {(annualInterestRate * 100).toFixed(2)}%</p>
              </CardContent>
          </Card>
          <Card className="text-center">
              <CardHeader className='p-3 pb-2'>
                <CardTitle className="text-sm font-medium text-muted-foreground">Cuota Tecnología (Mensual)</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                  <p className="text-lg font-bold">{formatCurrency(TECHNOLOGY_FEE)}</p>
              </CardContent>
          </Card>
           <Card className="text-center">
              <CardHeader className='p-3 pb-2'>
                <CardTitle className="text-sm font-medium text-muted-foreground">Estudio de Crédito (Única vez)</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                  <p className="text-lg font-bold">{formatCurrency(DISBURSEMENT_FEE)}</p>
              </CardContent>
          </Card>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="text-center bg-accent text-accent-foreground">
                <CardHeader className='p-4 pb-2'>
                    <CardTitle className="text-base text-accent-foreground/80">Pagarás cada mes</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                    <p className="text-4xl font-bold">{formatCurrency(monthlyPayment)}</p>
                </CardContent>
            </Card>
             <Card className="text-center bg-primary/10 border-primary">
                <CardHeader className='p-4 pb-2'>
                    <CardTitle className="text-base text-muted-foreground">Recibirás en tu cuenta</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                    <p className="text-4xl font-bold text-primary">{formatCurrency(netDisbursement)}</p>
                </CardContent>
            </Card>
        </div>
         <div className="text-xs text-muted-foreground text-center pt-2">
            Los valores mostrados son un estimado. Banqi confirmará la oferta final al revisar tu solicitud.
        </div>
      </div>

       <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" size="lg" disabled={loading || !user}>
        {loading ? (
            <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Enviando...
            </>
        ) : (
            'Solicitar Crédito'
        )}
        </Button>
    </form>
  );
}

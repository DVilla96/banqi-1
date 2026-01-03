

'use client';

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ReceiptText, Check, Landmark, User, UploadCloud, Users, Percent, Wallet, Sparkles } from 'lucide-react';
import type { PaymentBreakdown, Loan, Investment } from '@/lib/types';
import { Separator } from '../ui/separator';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { startOfDay, fromUnixTime, differenceInDays } from 'date-fns';

type EnrichedBanker = Investment & { investorName?: string };

type RepaymentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  payingLoan: Loan;
  payingLoanBreakdown: PaymentBreakdown;
  receivingLoan: Loan;
  onConfirm: (proofFile: File) => Promise<void>;
  bankers: EnrichedBanker[];
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 2,
    }).format(value);
};

const formatPercent = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

const BANQI_FEE_INVESTOR_ID = 'banqi_platform_fee';
const PLATFORM_COMMISSION_RATE = 0.30; // 30%

export default function RepaymentModal({ isOpen, onClose, payingLoan, payingLoanBreakdown, receivingLoan, onConfirm, bankers }: RepaymentModalProps) {
    const { user } = useAuth();
    const [isConfirming, setIsConfirming] = useState(false);
    const [paymentProof, setPaymentProof] = useState<File | null>(null);
    const { toast } = useToast();

    const handleConfirmClick = async () => {
        if (!paymentProof || !user) {
            toast({ title: "Falta el Comprobante", description: "Por favor, adjunta el comprobante de pago.", variant: "destructive" });
            return;
        }
        setIsConfirming(true);
        await onConfirm(paymentProof);
        setIsConfirming(false);
    }
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setPaymentProof(e.target.files[0]);
        }
    };
    
    // Calcular el desglose EXACTO por banquero usando la misma lógica que la tabla de amortización
    const bankerBreakdowns = useMemo(() => {
        if (bankers.length === 0 || !payingLoan.interestRate) {
            return [];
        }
        
        // Tasa diaria usando la misma fórmula que amortization-table y investment-detail
        const monthlyRate = payingLoan.interestRate / 100;
        const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;
        
        // Tasa diaria para cálculo de participación (igual que investment-detail.tsx)
        const dailyRateForParticipation = Math.pow(1 + monthlyRate, 1 / 30.4167) - 1;
        
        const sortedInvestments = [...bankers].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);
        if (sortedInvestments.length === 0) return [];
        
        // Fecha focal = PRIMERA inversión (igual que investment-detail.tsx)
        const focalDate = startOfDay(fromUnixTime(sortedInvestments[0].createdAt.seconds));
        
        // USAR LA FECHA DE PAGO DEL BREAKDOWN (que viene de calculatePrecisePaymentBreakdown)
        // Si no hay paymentDate en el breakdown, usar la fecha calculada manualmente
        let paymentDate: Date;
        if (payingLoanBreakdown.paymentDate) {
            paymentDate = startOfDay(new Date(payingLoanBreakdown.paymentDate));
        } else {
            // Fallback: calcular manualmente como antes
            const lastInvestmentDate = startOfDay(fromUnixTime(sortedInvestments[sortedInvestments.length - 1].createdAt.seconds));
            const paymentDay = payingLoan.paymentDay || 6;
            const lastInvMonth = lastInvestmentDate.getMonth();
            const lastInvYear = lastInvestmentDate.getFullYear();
            const lastInvDay = lastInvestmentDate.getDate();
            
            if (lastInvDay < paymentDay) {
                paymentDate = new Date(lastInvYear, lastInvMonth, paymentDay);
            } else {
                paymentDate = new Date(lastInvYear, lastInvMonth + 1, paymentDay);
            }
            paymentDate = startOfDay(paymentDate);
        }
        
        // Calcular participación usando VALOR PRESENTE (igual que investment-detail.tsx)
        const presentValues = sortedInvestments.map(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
            const daysDiff = differenceInDays(invDate, focalDate);
            const pv = inv.amount / Math.pow(1 + dailyRateForParticipation, daysDiff);
            return { id: inv.id, pv };
        });
        
        const totalPresentValue = presentValues.reduce((acc, val) => acc + val.pv, 0);
        
        console.log(`[MODAL] Payment Date from breakdown: ${payingLoanBreakdown.paymentDate}`);
        console.log(`[MODAL] Using payment date: ${paymentDate.toISOString()}`);
        
        // Calcular el desglose para cada inversor
        const breakdowns = sortedInvestments.map(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
            
            // Participación usando valor presente (igual que investment-detail.tsx)
            const thisInvestorPV = presentValues.find(p => p.id === inv.id)?.pv || 0;
            const participation = totalPresentValue > 0 ? thisInvestorPV / totalPresentValue : 0;
            
            // Días desde la inversión hasta la fecha de pago (usando paymentDate del breakdown)
            const daysToPayment = differenceInDays(paymentDate, invDate);
            
            // Interés = Capital × ((1 + tasa_diaria)^días - 1)
            const interestForInvestor = inv.amount * (Math.pow(1 + dailyRate, daysToPayment) - 1);
            
            // La cuota del inversor (sin tech fee) = (capital global + interés global) * participación
            const totalInstallmentExclTechFee = payingLoanBreakdown.capital + payingLoanBreakdown.interest;
            const installmentForInvestor = totalInstallmentExclTechFee * participation;
            
            // Capital = Cuota del Inversor - Interés del Inversor
            const capitalForInvestor = installmentForInvestor - interestForInvestor;
            
            const isBanqi = inv.investorId === BANQI_FEE_INVESTOR_ID;
            
            console.log(`[MODAL] Banker ${inv.investorId?.substring(0,8)}:`, {
                amount: inv.amount,
                participation: (participation * 100).toFixed(2) + '%',
                daysToPayment,
                interest: interestForInvestor.toFixed(2),
                installment: installmentForInvestor.toFixed(2),
                capital: capitalForInvestor.toFixed(2)
            });
            
            return {
                id: inv.id,
                investorId: inv.investorId,
                investorName: (inv as EnrichedBanker).investorName || 'Banquero',
                isBanqi,
                participation,
                capital: capitalForInvestor,
                interest: interestForInvestor,
                installment: installmentForInvestor,
                daysToPayment
            };
        });
        
        return breakdowns;
    }, [bankers, payingLoan.interestRate, payingLoan.paymentDay, payingLoanBreakdown.capital, payingLoanBreakdown.interest, payingLoanBreakdown.paymentDate]);
    
    // Participación para compatibilidad (se usa en los cálculos de comisión)
    const participationData = useMemo(() => {
        return bankerBreakdowns.map(b => ({
            id: b.id,
            participation: b.participation
        }));
    }, [bankerBreakdowns]);


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
           <div className="flex justify-center">
             <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <ReceiptText className="h-7 w-7" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Confirmar Pago y Reinversión</DialogTitle>
          <DialogDescription className="text-center max-w-xl mx-auto">
            Estás a punto de pagar tu cuota. Este pago se usará para fondear al siguiente préstamo en la cola, manteniendo el dinero en la comunidad.
          </DialogDescription>
        </DialogHeader>
        
        <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[50vh] overflow-y-auto">
            {/* Left Side - Your Payment & Recipient*/}
            <div className='space-y-4'>
                <div className="p-4 bg-muted rounded-lg border">
                    <h3 className='font-bold text-lg mb-2 text-center'>Tu Pago</h3>
                    <div className="flex justify-between items-baseline p-3 bg-background rounded-lg">
                        <span className="text-muted-foreground">Pago Total:</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(payingLoanBreakdown.total)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="space-y-1 text-sm p-3">
                        <div className="flex justify-between">
                            <span>Cuota de Tecnología:</span>
                            <span className="font-medium">{formatCurrency(payingLoanBreakdown.technologyFee)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Intereses Corrientes:</span>
                            <span className="font-medium">{formatCurrency(payingLoanBreakdown.interest)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                            <span>Abono a Capital:</span>
                            <span className="">{formatCurrency(payingLoanBreakdown.capital)}</span>
                        </div>
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="payment-proof" className="font-semibold text-base flex items-center gap-2">
                        <UploadCloud className="h-5 w-5 text-primary"/>
                        Adjunta tu Comprobante de Pago
                    </Label>
                    <Input 
                        id="payment-proof" 
                        name="paymentProof" 
                        type="file" 
                        accept="image/*,application/pdf" 
                        onChange={handleFileChange} 
                        className='file:text-primary file:font-semibold' 
                    />
                </div>
                 <Alert className='border-primary/50'>
                    <Landmark className="h-4 w-4" />
                    <AlertTitle className="font-bold">Transferir a:</AlertTitle>
                    <AlertDescription className='space-y-1 pt-2'>
                        <div className="flex justify-between">
                            <span className='flex items-center gap-2'><User className="h-4 w-4"/> Nombre:</span>
                            <span className="font-medium">{receivingLoan.requesterFirstName} {receivingLoan.requesterLastName}</span>
                        </div>
                        <div className="flex justify-between"><span>Banco:</span> <span className="font-medium">{receivingLoan.bankName || 'N/A'}</span></div>
                        <div className="flex justify-between"><span>Tipo de Cuenta:</span> <span className="font-medium">{receivingLoan.accountType || 'N/A'}</span></div>
                        <div className="flex justify-between"><span>Número de Cuenta:</span> <span className="font-medium">{receivingLoan.accountNumber || 'N/A'}</span></div>
                    </AlertDescription>
                </Alert>
            </div>

            {/* Right Side - Banker Breakdown */}
             <div className="space-y-4">
                 <Card>
                    <CardHeader>
                        <CardTitle className='flex items-center gap-2'>
                            <Users className="h-5 w-5 text-primary" />
                            Desglose por Banquero
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                            Así se distribuye tu pago entre tus banqueros para que ellos fondeen al siguiente deudor.
                        </p>
                    </CardHeader>
                    <CardContent>
                        <Accordion type='single' collapsible className='w-full'>
                            {(() => {
                                // LOGS DE VERIFICACIÓN MATEMÁTICA
                                let sumaTotalDesgloses = 0;
                                let sumaIntereses = 0;
                                let sumaCapital = 0;
                                console.log('=== VERIFICACIÓN MATEMÁTICA DEL DESGLOSE (CORREGIDO) ===');
                                console.log('Pago Total esperado:', payingLoanBreakdown.total);
                                console.log('  - Capital:', payingLoanBreakdown.capital);
                                console.log('  - Intereses:', payingLoanBreakdown.interest);
                                console.log('  - Cuota Tecnología:', payingLoanBreakdown.technologyFee);
                                console.log('');
                                console.log('Banqueros:', bankerBreakdowns.length);
                                console.log('');
                                
                                bankerBreakdowns.forEach(breakdown => {
                                    const commission = breakdown.isBanqi ? 0 : breakdown.interest * PLATFORM_COMMISSION_RATE;
                                    const netInterest = breakdown.interest - commission;
                                    let totalToReinvest = breakdown.capital + netInterest;
                                    
                                    if (breakdown.isBanqi) {
                                        // Banqi recibe comisiones de otros + tech fee
                                        const totalCommissionFromOthers = bankerBreakdowns
                                            .filter(b => !b.isBanqi)
                                            .reduce((acc, other) => acc + (other.interest * PLATFORM_COMMISSION_RATE), 0);
                                        totalToReinvest += totalCommissionFromOthers + payingLoanBreakdown.technologyFee;
                                    }
                                    
                                    sumaTotalDesgloses += totalToReinvest;
                                    sumaIntereses += breakdown.interest;
                                    sumaCapital += breakdown.capital;
                                    
                                    console.log(`Banquero: ${breakdown.investorName} (${breakdown.isBanqi ? 'BANQI' : 'Normal'})`);
                                    console.log(`  - Días desde inversión: ${breakdown.daysToPayment}`);
                                    console.log(`  - Participación: ${(breakdown.participation * 100).toFixed(4)}%`);
                                    console.log(`  - Capital: ${breakdown.capital.toFixed(2)}`);
                                    console.log(`  - Interés (calculado por días): ${breakdown.interest.toFixed(2)}`);
                                    console.log(`  - Comisión Banqi (30%): ${commission.toFixed(2)}`);
                                    console.log(`  - Interés Neto (70%): ${netInterest.toFixed(2)}`);
                                    console.log(`  - Total a Reinvertir: ${totalToReinvest.toFixed(2)}`);
                                });
                                
                                console.log('');
                                console.log('=== SUMAS ===');
                                console.log('Suma Capital por banquero:', sumaCapital.toFixed(2), '| Esperado:', payingLoanBreakdown.capital.toFixed(2));
                                console.log('Suma Interés por banquero:', sumaIntereses.toFixed(2), '| Esperado:', payingLoanBreakdown.interest.toFixed(2));
                                console.log('');
                                console.log('=== RESULTADO ===');
                                console.log('Suma de Desgloses:', sumaTotalDesgloses.toFixed(2));
                                console.log('Pago Total:', payingLoanBreakdown.total.toFixed(2));
                                const diferencia = Math.abs(payingLoanBreakdown.total - sumaTotalDesgloses);
                                console.log('Diferencia:', diferencia.toFixed(2));
                                console.log('¿Cuadra?:', diferencia < 1 ? '✅ SÍ (tolerancia <$1)' : '❌ NO');
                                console.log('=================================');
                                
                                return null;
                            })()}
                            {bankerBreakdowns.map(breakdown => {
                                const commission = breakdown.isBanqi ? 0 : breakdown.interest * PLATFORM_COMMISSION_RATE;
                                const netInterest = breakdown.interest - commission;
                                
                                let totalToReinvest = breakdown.capital + netInterest;
                                let totalCommissionFromOthers = 0;

                                if (breakdown.isBanqi) {
                                    totalCommissionFromOthers = bankerBreakdowns
                                        .filter(b => !b.isBanqi)
                                        .reduce((acc, other) => acc + (other.interest * PLATFORM_COMMISSION_RATE), 0);
                                    totalToReinvest += totalCommissionFromOthers + payingLoanBreakdown.technologyFee;
                                }

                                return (
                                    <AccordionItem value={breakdown.id} key={breakdown.id}>
                                        <AccordionTrigger className='text-sm hover:no-underline'>
                                            <div className='flex-1 text-left space-y-1'>
                                                <p className='font-bold'>{breakdown.investorName}</p>
                                                <p className='font-mono text-primary font-semibold'>{formatCurrency(totalToReinvest)}</p>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className='space-y-2 pt-2 pr-4'>
                                             <div className="flex justify-between text-xs items-center">
                                                <span className='text-muted-foreground flex items-center gap-1'><Percent className="h-3 w-3" /> Participación:</span>
                                                <span className="font-mono font-semibold text-primary">{formatPercent(breakdown.participation)}</span>
                                            </div>
                                            <Separator className='my-1' />
                                             <div className="flex justify-between text-xs items-center">
                                                <span className='text-muted-foreground flex items-center gap-1'><Wallet className="h-3 w-3" /> Capital Devuelto:</span>
                                                <span className="font-mono">{formatCurrency(breakdown.capital)}</span>
                                            </div>
                                             <div className="flex justify-between text-xs items-center">
                                                <span className='text-muted-foreground flex items-center gap-1'><Sparkles className="h-3 w-3" /> Interés Generado:</span>
                                                <span className="font-mono">{formatCurrency(breakdown.interest)}</span>
                                            </div>
                                            {breakdown.isBanqi ? (
                                                <>
                                                    <div className="flex justify-between text-xs items-center pl-4">
                                                        <span className='text-muted-foreground'>↳ Comisión de Intereses:</span>
                                                        <span className="font-mono text-green-600">+ {formatCurrency(totalCommissionFromOthers)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-xs items-center pl-4">
                                                        <span className='text-muted-foreground'>↳ Cuota de Tecnología:</span>
                                                        <span className="font-mono text-green-600">+ {formatCurrency(payingLoanBreakdown.technologyFee)}</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="flex justify-between text-xs items-center pl-4">
                                                        <span className='text-muted-foreground'>↳ Comisión Banqi (30%):</span>
                                                        <span className="font-mono text-red-600">- {formatCurrency(commission)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-xs items-center pl-4 font-bold">
                                                        <span className='text-muted-foreground'>↳ Interés Neto (70%):</span>
                                                        <span className="font-mono text-green-600">{formatCurrency(netInterest)}</span>
                                                    </div>
                                                </>
                                            )}
                                        </AccordionContent>
                                    </AccordionItem>
                                )
                            })}
                        </Accordion>
                    </CardContent>
                 </Card>
             </div>
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isConfirming}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleConfirmClick} disabled={isConfirming || !paymentProof}>
            {isConfirming ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                </>
            ) : (
                <>
                    <Check className="mr-2 h-4 w-4" />
                    He Realizado el Pago
                </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, writeBatch, runTransaction, orderBy, updateDoc, getDoc, addDoc, Timestamp } from 'firebase/firestore';
import type { Investment, ReinvestmentSource, Payment, Loan } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, BadgeCheck, BadgeX, Eye, Clock, AlertCircle, Scale } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { Separator } from '../ui/separator';
import React from 'react';
import { format, fromUnixTime } from 'date-fns';
import { es } from 'date-fns/locale';
import PromissoryNoteModal from './promissory-note-modal';
import { Badge } from '../ui/badge';
import { BANQI_FEE_INVESTOR_ID } from '@/lib/constants';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"


type PendingConfirmationsProps = {
    loanId: string;
    borrowerId: string;
};

type EnrichedInvestment = Investment & {
    investorFirstName?: string;
    investorLastName?: string;
    investorName?: string;
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

export default function PendingConfirmations({ loanId, borrowerId }: PendingConfirmationsProps) {
    const [pendingInvestments, setPendingInvestments] = useState<EnrichedInvestment[]>([]);
    const [disputedInvestments, setDisputedInvestments] = useState<EnrichedInvestment[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [selectedInvestment, setSelectedInvestment] = useState<EnrichedInvestment | null>(null);
    const [bankersForModal, setBankersForModal] = useState<EnrichedInvestment[]>([]);
    const { toast } = useToast();

    useEffect(() => {
        // Query para pendientes
        const pendingQuery = query(
            collection(db, 'investments'),
            where('loanId', '==', loanId),
            where('borrowerId', '==', borrowerId),
            where('status', '==', 'pending-confirmation'),
            orderBy('createdAt', 'asc')
        );
        
        // Query para disputadas
        const disputedQuery = query(
            collection(db, 'investments'),
            where('loanId', '==', loanId),
            where('borrowerId', '==', borrowerId),
            where('status', '==', 'disputed'),
            orderBy('createdAt', 'asc')
        );

        const enrichInvestments = async (docs: any[]): Promise<EnrichedInvestment[]> => {
            const investments: EnrichedInvestment[] = [];
            for (const investmentDoc of docs) {
                const data = investmentDoc.data() as Investment;
                console.log("[PendingConfirmations] Investment loaded:", investmentDoc.id, {
                    isRepayment: data.isRepayment,
                    sourceBreakdown: data.sourceBreakdown,
                    sourceBreakdownLength: Array.isArray(data.sourceBreakdown) ? data.sourceBreakdown.length : 'not array'
                });
                let investorFirstName = 'Inversionista';
                let investorLastName = '';
                let investorName = 'Inversionista Anónimo';

                if (data.payerId) {
                    try {
                        const userRef = doc(db, 'users', data.payerId);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const userData = userSnap.data();
                            investorFirstName = (userData.firstName || '').split(' ')[0];
                            investorLastName = (userData.lastName || '').split(' ')[0];
                            investorName = `${investorFirstName} ${investorLastName}`.trim();
                        }
                    } catch (e) {
                        console.error(`Failed to fetch payer name for ID ${data.payerId}:`, e)
                    }
                } else if (data.investorId) {
                    try {
                        const userRef = doc(db, 'users', data.investorId);
                        const userSnap = await getDoc(userRef);
                        if (userSnap.exists()) {
                            const userData = userSnap.data();
                            investorFirstName = (userData.firstName || '').split(' ')[0];
                            investorLastName = (userData.lastName || '').split(' ')[0];
                            investorName = `${investorFirstName} ${investorLastName}`.trim();
                        }
                    } catch (e) {
                        console.error(`Failed to fetch investor name for ID ${data.investorId}:`, e)
                    }
                }
                
                investments.push({ id: investmentDoc.id, ...data, investorFirstName, investorLastName, investorName });
            }
            return investments;
        };

        const unsubscribePending = onSnapshot(pendingQuery, async (snapshot) => {
            setLoading(true);
            const investments = await enrichInvestments(snapshot.docs);
            setPendingInvestments(investments);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching pending investments:", error);
            setLoading(false);
        });
        
        const unsubscribeDisputed = onSnapshot(disputedQuery, async (snapshot) => {
            const investments = await enrichInvestments(snapshot.docs);
            setDisputedInvestments(investments);
        }, (error) => {
            console.error("Error fetching disputed investments:", error);
        });

        return () => {
            unsubscribePending();
            unsubscribeDisputed();
        };
    }, [loanId, borrowerId]);
    
   const handleConfirm = async (investment: EnrichedInvestment) => {
    setActionLoading(investment.id);
    try {
        await runTransaction(db, async (transaction) => {
            const loanRef = doc(db, 'loanRequests', investment.loanId);
            const pendingInvestmentRef = doc(db, 'investments', investment.id);

            // === FASE DE LECTURAS (todas las lecturas primero) ===
            const loanDoc = await transaction.get(loanRef);
            if (!loanDoc.exists()) {
                throw new Error("El préstamo ya no existe.");
            }

            // Si es un repago, también necesitamos leer el préstamo del pagador
            let payingLoanDoc = null;
            let payingLoanRef = null;
            if (investment.isRepayment && investment.payingLoanId) {
                payingLoanRef = doc(db, 'loanRequests', investment.payingLoanId);
                payingLoanDoc = await transaction.get(payingLoanRef);
            }

            // === FASE DE ESCRITURAS (todas las escrituras después) ===
            const loanData = loanDoc.data();
            const amountToConfirm = investment.amount;
            const currentFunded = loanData.amount * ((loanData.fundedPercentage || 0) / 100);
            const newTotalFunded = currentFunded + amountToConfirm;
            let newFundedPercentage = (newTotalFunded / loanData.amount) * 100;
            newFundedPercentage = Math.min(100, newFundedPercentage);

            // If it's a repayment, we create new confirmed investments for each banker AND a payment record
            if (investment.isRepayment && investment.sourceBreakdown) {
                // 1. Create a payment record for the original borrower
                if (investment.payerId && investment.paymentBreakdown && investment.payingLoanId) {
                    const paymentData: Omit<Payment, 'id'> = {
                        loanId: investment.payingLoanId,
                        payerId: investment.payerId,
                        paymentDate: investment.createdAt, // Use the payment date from when the repayment was made (supports simulation date)
                        amount: investment.paymentBreakdown.total,
                        capital: investment.paymentBreakdown.capital,
                        interest: investment.paymentBreakdown.interest,
                        technologyFee: investment.paymentBreakdown.technologyFee,
                        lateFee: investment.paymentBreakdown.lateFee || 0,
                    };
                    transaction.set(doc(collection(db, 'payments')), paymentData);
                    
                    // Update the paying loan status if it was overdue (ya lo leímos arriba)
                    if (payingLoanDoc && payingLoanDoc.exists() && payingLoanDoc.data().status === 'repayment-overdue' && payingLoanRef) {
                        transaction.update(payingLoanRef, { status: 'repayment-active' });
                    }

                } else {
                     console.error("Original loan for payment record not found!");
                }
                
                // 2. Create new confirmed investments for each banker in the new loan
                for (const source of investment.sourceBreakdown) {
                    const newInvestmentData: Omit<Investment, 'id'> = {
                        loanId: investment.loanId,
                        investorId: source.investorId,
                        borrowerId: investment.borrowerId,
                        amount: source.amount,
                        status: 'confirmed',
                        paymentProofUrl: investment.paymentProofUrl, // Reuse the proof
                        createdAt: investment.createdAt, // Keep original timestamp
                        confirmedAt: Timestamp.now(),
                    };
                    const newInvestmentRef = doc(collection(db, 'investments'));
                    transaction.set(newInvestmentRef, newInvestmentData);
                }
                // 3. Delete the temporary pending investment document
                transaction.delete(pendingInvestmentRef);
            } else {
                // It's a direct investment, just confirm it
                transaction.update(pendingInvestmentRef, {
                    status: 'confirmed',
                    confirmedAt: Timestamp.now(),
                });
            }
            
            // Update loan status
            const updatePayload: any = { fundedPercentage: newFundedPercentage };
            if (newFundedPercentage >= 100) {
                updatePayload.status = 'funded';
            }
            transaction.update(loanRef, updatePayload);
        });

        toast({
            title: '¡Pagarés Aceptados!',
            description: 'Has confirmado la recepción de los fondos. Tu progreso ha sido actualizado.',
        });
        setSelectedInvestment(null);

    } catch (error) {
        console.error("Error confirming investment:", error);
        toast({
            title: 'Error en la Confirmación',
            description: (error as Error).message,
            variant: 'destructive',
        });
    } finally {
        setActionLoading(null);
    }
}
    
    const handleDispute = async (investmentId: string) => {
        setActionLoading(investmentId);
        try {
            const investmentRef = doc(db, 'investments', investmentId);
            await updateDoc(investmentRef, {
                status: 'disputed',
                disputedAt: new Date(),
            });
            toast({
                title: 'Disputa Iniciada',
                description: 'La transacción ha sido marcada como "en disputa". Nuestro equipo la revisará pronto.',
            });
        } catch (error) {
            console.error("Error starting dispute:", error);
             toast({
                title: 'Error',
                description: 'No se pudo iniciar la disputa. Inténtalo de nuevo.',
                variant: 'destructive',
            });
        } finally {
            setActionLoading(null);
        }
    }

    const openConfirmationModal = async (investment: EnrichedInvestment) => {
        console.log("[PendingConfirmations] Opening modal for:", investment.id);
        console.log("[PendingConfirmations] isRepayment:", investment.isRepayment);
        console.log("[PendingConfirmations] sourceBreakdown (raw):", investment.sourceBreakdown);
        
        // Normalizar sourceBreakdown: Firebase a veces devuelve objetos en lugar de arrays
        let sourceBreakdown: ReinvestmentSource[] = [];
        if (investment.sourceBreakdown) {
            if (Array.isArray(investment.sourceBreakdown)) {
                sourceBreakdown = investment.sourceBreakdown;
            } else if (typeof investment.sourceBreakdown === 'object') {
                // Convertir objeto a array si Firebase lo devuelve como objeto
                sourceBreakdown = Object.values(investment.sourceBreakdown);
            }
        }
        console.log("[PendingConfirmations] sourceBreakdown (normalized):", JSON.stringify(sourceBreakdown));
        
        // If it's a reinvestment, we need to fetch the underlying bankers
        if (investment.isRepayment && sourceBreakdown.length > 0) {
            console.log("[PendingConfirmations] ✅ Using sourceBreakdown to build bankers list");
            const enrichedBankers = await Promise.all(
                sourceBreakdown.map(async (source: ReinvestmentSource) => {
                    let name = 'Banquero Anónimo';
                    let firstName = '';
                    let lastName = '';
                    if (source.investorId === BANQI_FEE_INVESTOR_ID) {
                        name = 'Banqi (Plataforma)';
                    } else {
                         const userRef = doc(db, 'users', source.investorId);
                         const userSnap = await getDoc(userRef);
                         if (userSnap.exists()) {
                            const data = userSnap.data();
                            firstName = data.firstName;
                            lastName = data.lastName;
                            name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
                         }
                    }
                    console.log("[PendingConfirmations] Enriched banker:", source.investorId, name, source.amount);
                    return { ...source, investorFirstName: firstName, investorLastName: lastName, investorName: name, id: source.investorId, loanId: investment.loanId } as EnrichedInvestment
                })
            );
            console.log("[PendingConfirmations] Final bankers:", enrichedBankers.map(b => ({ id: b.investorId, name: b.investorName, amount: b.amount })));
            setBankersForModal(enrichedBankers);
        } else {
            console.log("[PendingConfirmations] ❌ NOT using sourceBreakdown - using investment itself");
            setBankersForModal([investment]); // For direct investments, the banker is the investor
        }

        setSelectedInvestment(investment);
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-4">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span>Buscando...</span>
            </div>
        );
    }
    
    if (pendingInvestments.length === 0 && disputedInvestments.length === 0) {
        return null;
    }


    return (
        <>
        {pendingInvestments.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
            <CardHeader className='pb-4'>
                <CardTitle className="flex items-center gap-2 text-primary text-base">
                    <AlertTriangle className='h-5 w-5' />
                    Confirmaciones Pendientes
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <TooltipProvider>
                         {pendingInvestments.map((investment) => {
                             const investmentDate = (() => {
                                if (!investment.createdAt?.seconds) {
                                    return 'Fecha no disponible';
                                }
                                // Usar fromUnixTime para convertir correctamente el timestamp
                                const date = fromUnixTime(investment.createdAt.seconds);
                                return format(date, 'dd MMM yyyy', { locale: es });
                            })();

                             return (
                                <div key={investment.id} className="p-3 bg-background rounded-lg border">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className='flex-1 space-y-0.5'>
                                            <p className="font-semibold text-sm leading-tight">{investment.isRepayment ? `Pago de ${investment.investorName}` : `Inversión de ${investment.investorName}`}</p>
                                            <p className="text-muted-foreground font-semibold text-sm leading-tight">{formatCurrency(investment.amount)}</p>
                                            <p className="text-muted-foreground text-xs leading-tight">{investmentDate}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button asChild variant="ghost" size="icon" className='h-7 w-7 text-muted-foreground'>
                                                        <Link href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                                                            <Eye className="h-4 w-4" />
                                                        </Link>
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Ver Comprobante</TooltipContent>
                                            </Tooltip>
                                            
                                            <AlertDialog>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className='h-7 w-7 text-destructive' disabled={!!actionLoading}>
                                                                {actionLoading === investment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeX className="h-4 w-4" />}
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Disputar</TooltipContent>
                                                </Tooltip>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>¿Estás seguro que quieres disputar esta transacción?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Esta acción marcará la transacción para que nuestro equipo la revise manualmente. El administrador se pondrá en contacto contigo y con el inversionista para mediar. Usa esta opción solo si has revisado tu cuenta bancaria y estás seguro de que no has recibido los fondos.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDispute(investment.id)} className="bg-destructive hover:bg-destructive/90">
                                                            Sí, Disputar
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button variant="ghost" size="icon" className='h-7 w-7 text-green-600' onClick={() => openConfirmationModal(investment)} disabled={!!actionLoading}>
                                                        {actionLoading === investment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Confirmar Recepción</TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </TooltipProvider>
                </div>
            </CardContent>
        </Card>
        )}

        {disputedInvestments.length > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/30">
            <CardHeader className='pb-4'>
                <CardTitle className="flex items-center gap-2 text-amber-600 text-base">
                    <Scale className='h-5 w-5' />
                    Transacciones en Disputa
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2">
                    <TooltipProvider>
                         {disputedInvestments.map((investment) => {
                             const investmentDate = (() => {
                                if (!investment.createdAt?.seconds) {
                                    return 'Fecha no disponible';
                                }
                                // Usar fromUnixTime para convertir correctamente el timestamp
                                const date = fromUnixTime(investment.createdAt.seconds);
                                return format(date, 'dd MMM yyyy', { locale: es });
                            })();                            return (
                                <div key={investment.id} className="p-3 bg-background rounded-lg border border-amber-500/30">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className='flex-1 space-y-0.5'>
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-sm leading-tight">{investment.isRepayment ? `Pago de ${investment.investorName}` : `Inversión de ${investment.investorName}`}</p>
                                                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                                                    En revisión
                                                </Badge>
                                            </div>
                                            <p className="text-muted-foreground font-semibold text-sm leading-tight">{formatCurrency(investment.amount)}</p>
                                            <p className="text-muted-foreground text-xs leading-tight">{investmentDate}</p>
                                            <p className="text-amber-600 text-xs mt-1">
                                                <AlertCircle className="h-3 w-3 inline mr-1" />
                                                El equipo de Banqi está revisando esta transacción
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button asChild variant="ghost" size="icon" className='h-7 w-7 text-muted-foreground'>
                                                        <Link href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                                                            <Eye className="h-4 w-4" />
                                                        </Link>
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>Ver Comprobante</TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </TooltipProvider>
                </div>
            </CardContent>
        </Card>
        )}

        {selectedInvestment && (
            <PromissoryNoteModal
                isOpen={!!selectedInvestment}
                onClose={() => setSelectedInvestment(null)}
                investment={selectedInvestment}
                bankers={bankersForModal}
                onConfirm={handleConfirm}
                isConfirming={!!actionLoading}
            />
        )}

        </>
    );
}

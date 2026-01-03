
'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { LoanRequest } from './loan-requests-table';
import { Loader2, AlertTriangle, BadgeCheck, BadgeX, Eye, FileWarning, Phone, User } from 'lucide-react';
import Link from 'next/link';
import { Separator } from '../ui/separator';
import { useToast } from '@/hooks/use-toast';
import { collection, deleteDoc, doc, onSnapshot, query, runTransaction, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Investment } from '@/lib/types';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type DisputeModalProps = {
    isOpen: boolean;
    onClose: () => void;
    request: LoanRequest;
}

type EnrichedInvestment = Investment & {
    investorName?: string;
    investorPhoneNumber?: string;
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const BANQI_FEE_INVESTOR_ID = 'banqi_platform_fee';


export default function DisputeModal({ isOpen, onClose, request }: DisputeModalProps) {
    const [disputedInvestments, setDisputedInvestments] = useState<EnrichedInvestment[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!isOpen) return;

        const q = query(
            collection(db, 'investments'),
            where('loanId', '==', request.id),
            where('status', 'in', ['disputed', 'pending-confirmation'])
        );

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            setLoading(true);
            const investments: EnrichedInvestment[] = [];
            for (const investmentDoc of snapshot.docs) {
                const data = investmentDoc.data() as Investment;
                let investorName = 'Inversionista';
                let investorPhoneNumber = 'No disponible';

                if (data.investorId) {
                    try {
                        const userRef = doc(db, 'users', data.investorId);
                        const userSnap = await runTransaction(db, async (t) => t.get(userRef));
                        if (userSnap.exists()) {
                            const userData = userSnap.data();
                            investorName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
                            investorPhoneNumber = userData.phoneNumber || 'No disponible';
                        }
                    } catch (e) { console.error(e); }
                }
                investments.push({ id: investmentDoc.id, ...data, investorName, investorPhoneNumber });
            }
            setDisputedInvestments(investments);
            if (investments.length === 0) {
                onClose(); // Auto-close if there are no more disputes
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching disputed investments:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [request.id, isOpen, onClose]);
    
    const handleApprove = async (investment: EnrichedInvestment) => {
        setActionLoading(investment.id);
        try {
            await runTransaction(db, async (transaction) => {
                const loanRef = doc(db, 'loanRequests', investment.loanId);
                const investmentRef = doc(db, 'investments', investment.id);

                const loanDoc = await transaction.get(loanRef);
                if (!loanDoc.exists()) throw new Error("El préstamo ya no existe.");

                const loanData = loanDoc.data();
                const amountToConfirm = investment.totalPaymentAmount || investment.amount;
                const currentFunded = loanData.amount * ((loanData.fundedPercentage || 0) / 100);
                const newTotalFunded = currentFunded + amountToConfirm;
                let newFundedPercentage = Math.min(100, (newTotalFunded / loanData.amount) * 100);

                transaction.update(investmentRef, { status: 'confirmed', confirmedAt: new Date() });
                
                const updatePayload: any = { fundedPercentage: newFundedPercentage };
                if (newFundedPercentage >= 100) {
                    updatePayload.status = 'funded';
                }
                transaction.update(loanRef, updatePayload);
            });
            toast({ title: 'Inversión Aprobada', description: 'La inversión ha sido confirmada y el fondeo actualizado.' });
        } catch (error) {
            console.error("Error approving investment:", error);
            toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        } finally {
            setActionLoading(null);
        }
    }
    
    const handleReject = async (investment: EnrichedInvestment) => {
        setActionLoading(investment.id);
        try {
            await runTransaction(db, async (transaction) => {
                const loanRef = doc(db, 'loanRequests', investment.loanId);
                const investmentRef = doc(db, 'investments', investment.id);
                
                const loanDoc = await transaction.get(loanRef);
                if (!loanDoc.exists()) throw new Error("El préstamo ya no existe.");
                
                const loanData = loanDoc.data();
                const amountToRevert = investment.totalPaymentAmount || investment.amount;
                const currentCommitted = loanData.amount * ((loanData.committedPercentage || 0) / 100);
                const newTotalCommitted = currentCommitted - amountToRevert;
                let newCommittedPercentage = (newTotalCommitted / loanData.amount) * 100;
                newCommittedPercentage = Math.max(0, newCommittedPercentage);

                transaction.update(investmentRef, { status: 'rejected_by_admin', rejectedAt: new Date() });
                transaction.update(loanRef, { committedPercentage: newCommittedPercentage });
            });
            toast({ title: 'Inversión Rechazada', description: 'La inversión ha sido rechazada y el monto comprometido revertido.', variant: 'destructive' });
        } catch (error) {
            console.error("Error rejecting investment:", error);
            toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        } finally {
            setActionLoading(null);
        }
    }


    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <div className='flex items-center gap-3'>
                        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                            <FileWarning className="h-6 w-6" />
                        </div>
                        <div>
                            <DialogTitle>Resolver Disputas de Inversión</DialogTitle>
                             <DialogDescription>
                                Inversión de {disputedInvestments[0]?.investorName} para el préstamo de {request.userName}.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="py-4 max-h-[60vh] overflow-y-auto">
                    {loading ? (
                         <div className="flex items-center justify-center p-4">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            <span>Buscando disputas...</span>
                        </div>
                    ) : disputedInvestments.length > 0 ? (
                        <div className="space-y-3">
                             {disputedInvestments.map((investment) => {
                                const investmentDate = investment.createdAt?.seconds 
                                    ? format(new Date(investment.createdAt.seconds * 1000), 'dd MMM yyyy, h:mm a', { locale: es })
                                    : 'Fecha no disponible';
                                
                                const isDisputed = investment.status === 'disputed';

                                 return (
                                    <div key={investment.id} className={`p-4 rounded-lg border ${isDisputed ? 'bg-red-50' : 'bg-muted/50'}`}>
                                        
                                        <div className='grid grid-cols-2 gap-4 mb-4'>
                                            <div className='p-3 border-l-4 rounded-r-md bg-background'>
                                                <p className='font-semibold flex items-center gap-2'><User className='h-4 w-4 text-muted-foreground' /> Inversionista:</p>
                                                <p className='text-base'>{investment.investorName}</p>
                                                <p className='text-sm text-muted-foreground flex items-center gap-2'><Phone className='h-3 w-3'/> {investment.investorPhoneNumber || 'Teléfono no disponible'}</p>
                                            </div>
                                             <div className='p-3 border-l-4 rounded-r-md bg-background'>
                                                <p className='font-semibold flex items-center gap-2'><User className='h-4 w-4 text-muted-foreground' /> Deudor:</p>
                                                <p className='text-base'>{request.userName}</p>
                                                <p className='text-sm text-muted-foreground flex items-center gap-2'><Phone className='h-3 w-3'/> {request.userPhoneNumber || 'Teléfono no disponible'}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between gap-4">
                                            <div className='flex-1 space-y-1'>
                                                <p className="font-semibold text-lg leading-tight">{formatCurrency(investment.totalPaymentAmount || investment.amount)}</p>
                                                <p className="text-muted-foreground text-sm leading-tight">Enviado en: {investmentDate}</p>
                                            </div>
                                            <div className="flex flex-col items-stretch gap-2">
                                                <Button asChild variant="outline" size="sm">
                                                    <Link href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                                                        <Eye className="mr-2 h-4 w-4" /> Ver Comprobante
                                                    </Link>
                                                </Button>
                                                <div className="flex items-center gap-2">
                                                    <Button variant="destructive" size="sm" onClick={() => handleReject(investment)} disabled={!!actionLoading}>
                                                        {actionLoading === investment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeX className="h-4 w-4" />}
                                                        Rechazar
                                                    </Button>
                                                    <Button variant="secondary" className='bg-green-600 hover:bg-green-700 text-white' size="sm" onClick={() => handleApprove(investment)} disabled={!!actionLoading}>
                                                        {actionLoading === investment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                                                        Aprobar
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                         <div className="py-8 text-center text-muted-foreground">
                            No hay disputas activas para esta solicitud.
                        </div>
                    )}
                </div>
                
                <Separator />
                
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cerrar</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

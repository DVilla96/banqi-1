
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, orderBy, writeBatch, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { Loader2, ArrowUp, ArrowDown, Lock, Save, Eye, List } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loan } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type UserData = {
    [uid: string]: {
        firstName: string;
        lastName: string;
        email: string;
    }
}

type EnrichedLoan = Loan & {
    userName?: string;
    userEmail?: string;
}

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};


export default function FundingQueuePage() {
    const [allLoans, setAllLoans] = useState<EnrichedLoan[]>([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const [fundingQueueSize, setFundingQueueSize] = useState(3);
    const [newQueueSize, setNewQueueSize] = useState<number | ''>(3);
    const [configLoading, setConfigLoading] = useState(true);

    useEffect(() => {
        const configRef = doc(db, 'settings', 'platformConfig');
        const unsubscribeConfig = onSnapshot(configRef, (docSnap) => {
            if (docSnap.exists()) {
                const size = docSnap.data().fundingQueueSize;
                setFundingQueueSize(size || 3);
                setNewQueueSize(size || 3);
            } else {
                setFundingQueueSize(3);
                setNewQueueSize(3);
            }
            setConfigLoading(false);
        }, (error) => {
            console.error("Error fetching funding queue config, using default.", error);
            setFundingQueueSize(3);
            setNewQueueSize(3);
            setConfigLoading(false);
        });

        return () => unsubscribeConfig();
    }, []);

    useEffect(() => {
        if (configLoading) return;

        const q = query(
            collection(db, 'loanRequests'),
            where('status', 'in', ['approved', 'funding-active']),
            orderBy('fundingOrder', 'asc')
        );

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
            setLoading(true);
            const loans: EnrichedLoan[] = [];
            querySnapshot.forEach((doc) => {
                loans.push({ id: doc.id, ...(doc.data() as Omit<Loan, 'id'>) });
            });

            const userIds = [...new Set(loans.map(loan => loan.requesterId))].filter(Boolean);
            const users: UserData = {};

            if (userIds.length > 0) {
                const userDocsQuery = query(collection(db, 'users'), where('uid', 'in', userIds));
                const usersSnapshot = await getDocs(userDocsQuery);
                usersSnapshot.forEach(doc => {
                    const userData = doc.data();
                    users[doc.id] = {
                        firstName: userData.firstName,
                        lastName: userData.lastName,
                        email: userData.email,
                    }
                });
            }

            const enrichedLoans = loans.map(loan => ({
                ...loan,
                userName: users[loan.requesterId] ? `${users[loan.requesterId].firstName} ${users[loan.requesterId].lastName}` : 'N/A',
                userEmail: users[loan.requesterId] ? users[loan.requesterId].email : 'N/A',
            }));

            setAllLoans(enrichedLoans);
            setLoading(false);

        }, (error) => {
            console.error("Error fetching funding queue:", error);
            setLoading(false);
        });

        return () => unsubscribe();

    }, [fundingQueueSize, configLoading]);

    const handleMove = async (currentIndex: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        
        const currentItem = allLoans[currentIndex];
        const targetItem = allLoans[newIndex];

        if (!targetItem || targetItem.status === 'funding-active' || currentItem.status === 'funding-active') {
             // Cannot swap with or move a funding-active loan
            return;
        }

        const newFullQueue = Array.from(allLoans);
        // Swap fundingOrder values
        const tempOrder = newFullQueue[currentIndex].fundingOrder;
        newFullQueue[currentIndex].fundingOrder = newFullQueue[newIndex].fundingOrder;
        newFullQueue[newIndex].fundingOrder = tempOrder;

        // Sort by the new order to reflect the change immediately
        newFullQueue.sort((a,b) => a.fundingOrder - b.fundingOrder);
        
        // Optimistically update the state for the UI
        setAllLoans(newFullQueue);

        try {
            const batch = writeBatch(db);
            const item1Ref = doc(db, 'loanRequests', newFullQueue[newIndex].id);
            const item2Ref = doc(db, 'loanRequests', newFullQueue[currentIndex].id);
            batch.update(item1Ref, { fundingOrder: newFullQueue[newIndex].fundingOrder });
            batch.update(item2Ref, { fundingOrder: newFullQueue[currentIndex].fundingOrder });

            await batch.commit();
            toast({
                title: 'Cola Actualizada',
                description: 'El orden de fondeo ha sido guardado.',
            });
        } catch (error) {
            console.error("Error updating funding order:", error);
            toast({
                title: 'Error',
                description: 'No se pudo actualizar el orden de la cola.',
                variant: 'destructive',
            });
            // Revert to original order if fails
            const originalOrder = Array.from(allLoans);
            setAllLoans(originalOrder);
        }
    };
    
    const handleSaveQueueSize = async () => {
        const size = Number(newQueueSize);
        if (isNaN(size) || size <= 0) {
            toast({ title: 'Valor inválido', description: 'El tamaño de la cola debe ser un número mayor a cero.', variant: 'destructive'});
            return;
        }

        const activeLoanCount = allLoans.filter(l => l.status === 'funding-active').length;
        if (size < activeLoanCount) {
             toast({
                title: 'Tamaño de Cola Inválido',
                description: `El tamaño no puede ser menor que el número de préstamos ya activos (${activeLoanCount}).`,
                variant: 'destructive'
            });
            return;
        }
        
        try {
            const configRef = doc(db, 'settings', 'platformConfig');
            await setDoc(configRef, { fundingQueueSize: size }, { merge: true });
            
            toast({
                title: 'Configuración Guardada',
                description: 'El tamaño de la cola visible ha sido actualizado.',
            });
        } catch (error) {
            console.error("Error saving queue size:", error);
            toast({
                title: 'Error',
                description: 'No se pudo guardar la configuración. Verifique los permisos.',
                variant: 'destructive',
            });
        }
    }
    
    const visibleQueue = allLoans.slice(0, fundingQueueSize);
    const waitingQueue = allLoans.slice(fundingQueueSize);

    const LoanCardItem = ({ loan, index, isVisible }: { loan: EnrichedLoan, index: number, isVisible: boolean }) => {
        const isLocked = loan.status === 'funding-active' || (loan.fundedPercentage || 0) > 0;
        const canMoveUp = index > 0 && !isLocked && allLoans[index-1]?.status !== 'funding-active';
        const canMoveDown = index < allLoans.length - 1 && !isLocked;

        return (
             <Card key={loan.id} className="transition-all shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            {isLocked ? (
                                <div className="flex flex-col items-center justify-center h-full w-12 text-muted-foreground">
                                    <Lock className="h-5 w-5" />
                                </div>
                            ) : (
                                <>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'up')} disabled={!canMoveUp}>
                                        <ArrowUp className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleMove(index, 'down')} disabled={!canMoveDown}>
                                        <ArrowDown className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>
                        <div>
                            <p className="font-semibold">{loan.purpose}</p>
                            <p className="text-sm text-muted-foreground">
                                <span className='font-medium text-foreground'>{loan.userName} ({loan.userEmail})</span> | Monto: {formatCurrency(loan.amount)} | Plazo: {loan.term} meses
                            </p>
                        </div>
                    </div>
                     <div className='flex items-center gap-4'>
                         {loan.status === 'funding-active' && <Badge variant="secondary" className='bg-yellow-100 text-yellow-800'>Fondeando ({loan.fundedPercentage || 0}%)</Badge>}
                         {isVisible && <Badge variant="default" className="bg-accent text-accent-foreground">Visible</Badge>}
                         {!isVisible && <Badge variant="secondary">Posición: {index - fundingQueueSize + 1}</Badge>}
                    </div>
                </CardContent>
            </Card>
        )
    };


    if (loading || configLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Cargando cola de fondeo...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Cola de Fondeo</h1>
                <p className="text-muted-foreground">Gestiona los préstamos visibles para inversionistas y prioriza los que están en espera.</p>
            </div>

            <Card className='max-w-md'>
                 <CardHeader>
                    <CardTitle>Configuración de la Cola</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                    <Label htmlFor="queue-size" className='font-semibold'>Tamaño de la Cola Visible</Label>
                    <div className='flex items-center gap-2'>
                        <Input 
                            id="queue-size"
                            type="number"
                            value={newQueueSize === '' ? '' : String(newQueueSize)}
                            onChange={(e) => setNewQueueSize(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                            min="1"
                        />
                        <Button onClick={handleSaveQueueSize}>
                            <Save className='h-4 w-4'/>
                            <span className="ml-2">Guardar</span>
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Visible Loans Section */}
            <div className="space-y-4">
                 <div className='flex items-center gap-3'>
                    <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                        <Eye className="h-6 w-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Préstamos Visibles</h2>
                        <p className="text-muted-foreground">Estos préstamos están activos y visibles para los inversionistas.</p>
                    </div>
                </div>
                <Separator />
                {visibleQueue.length > 0 ? visibleQueue.map((loan, index) => (
                    <LoanCardItem key={loan.id} loan={loan} index={index} isVisible={true} />
                )) : (
                     <div className="text-center py-6">
                        <p className="text-muted-foreground">No hay préstamos visibles en este momento.</p>
                    </div>
                )}
            </div>

            {/* Waiting Queue Section */}
            <div className="space-y-4">
                <div className='flex items-center gap-3'>
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <List className="h-6 w-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight">Cola de Espera</h2>
                        <p className="text-muted-foreground">Usa las flechas para priorizar los créditos que entrarán a fondeo.</p>
                    </div>
                </div>
                 <Separator />
                {waitingQueue.length > 0 ? waitingQueue.map((loan, index) => (
                    <LoanCardItem key={loan.id} loan={loan} index={index + fundingQueueSize} isVisible={false} />
                )) : (
                     <div className="text-center py-6">
                        <p className="text-muted-foreground">La cola de espera está vacía.</p>
                    </div>
                )}
                
                {allLoans.length === 0 && (
                    <div className="text-center py-10">
                        <h3 className="text-xl font-semibold">La cola de fondeo está vacía</h3>
                        <p className="text-muted-foreground">Aprueba nuevas solicitudes para que aparezcan aquí.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

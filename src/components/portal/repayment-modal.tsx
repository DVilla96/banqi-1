'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ReceiptText, Check, Landmark, User, UploadCloud, Users, Percent, Wallet, Sparkles, Timer, ArrowRight } from 'lucide-react';
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
import { rtdb, db } from '@/lib/firebase';
import { ref as rtdbRef, set, remove, onValue } from 'firebase/database';
import { doc, onSnapshot } from 'firebase/firestore';
import { BANQI_FEE_INVESTOR_ID } from '@/lib/constants';

type EnrichedBanker = Investment & { investorName?: string };

export type LoanPaymentDistribution = {
    loan: Loan;
    amount: number;
    proofFile?: File;
};

// Monto exacto a reinvertir por cada banquero (usado para sourceBreakdown)
export type BankerReinvestAmount = {
    investorId: string;
    amount: number; // Monto total a reinvertir (capital + interés neto + comisiones si es Banqi)
};

type RepaymentModalProps = {
    isOpen: boolean;
    onClose: () => void;
    payingLoan: Loan;
    payingLoanBreakdown: PaymentBreakdown;
    paymentDistribution: LoanPaymentDistribution[]; // Distribución inicial
    loansInQueue: Loan[]; // TODOS los préstamos disponibles para redistribuir
    onConfirm: (proofFiles: Map<string, File>, finalDistribution: LoanPaymentDistribution[], bankerReinvestAmounts: BankerReinvestAmount[]) => Promise<void>;
    bankers: EnrichedBanker[];
};

type ReservationStatus = 'idle' | 'reserving' | 'reserved' | 'confirming' | 'confirmed' | 'error';

type LoanReservation = {
    odeinvId: string; // ID del deudor que está pagando
    amount: number;
    reservedAt: number;
    expiresAt: number;
};

type AllReservations = {
    [odeinvId: string]: LoanReservation;
};

const formatCurrency = (value: number, forceDecimals: boolean = true) => {
    if (isNaN(value)) return '$0';
    // Si forceDecimals es false y el valor es entero, no mostrar decimales
    const hasDecimals = value % 1 !== 0;
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: forceDecimals || hasDecimals ? 2 : 0,
        maximumFractionDigits: forceDecimals || hasDecimals ? 2 : 0,
    }).format(value);
};

const formatPercent = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

const PLATFORM_COMMISSION_RATE = 0.30; // 30%
const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

export default function RepaymentModal({ isOpen, onClose, payingLoan, payingLoanBreakdown, paymentDistribution, loansInQueue, onConfirm, bankers }: RepaymentModalProps) {
    const { user } = useAuth();
    const [isConfirming, setIsConfirming] = useState(false);
    // Map de loanId -> File para comprobantes de cada préstamo
    const [proofFiles, setProofFiles] = useState<Map<string, File>>(new Map());
    const { toast } = useToast();

    // Reservation states
    const [reservationStatus, setReservationStatus] = useState<ReservationStatus>('idle');
    const [myReservations, setMyReservations] = useState<Map<string, LoanReservation>>(new Map()); // loanId -> reservation
    const [otherReservationsTotal, setOtherReservationsTotal] = useState<Map<string, number>>(new Map()); // loanId -> total otros reservado
    const [timeRemaining, setTimeRemaining] = useState<number>(0);

    // 🔒 DISTRIBUCIÓN CONGELADA: Una vez reservado, estos montos NO cambian
    const [frozenDistribution, setFrozenDistribution] = useState<LoanPaymentDistribution[] | null>(null);

    const payerId = user?.uid || '';

    // Estado local para los préstamos con datos actualizados en tiempo real
    const [liveLoans, setLiveLoans] = useState<Map<string, Loan>>(new Map());

    // Referencia estable a los IDs de TODOS los préstamos en cola (para listeners)
    const allLoanIds = useMemo(() => loansInQueue.map(l => l.id), [loansInQueue]);

    // Total del pago a distribuir
    const totalPaymentAmount = useMemo(() =>
        paymentDistribution.reduce((sum, d) => sum + d.amount, 0),
        [paymentDistribution]
    );

    // Distribución RECALCULADA con datos en tiempo real de Firestore Y reservas RTDB
    // Ahora considera TODOS los préstamos en cola, no solo los inicialmente asignados
    const livePaymentDistribution = useMemo(() => {
        // Usar TODOS los préstamos en cola para redistribuir
        const allLoansWithAvailability = loansInQueue.map(loan => {
            const liveLoan = liveLoans.get(loan.id) || loan;
            const othersReserved = otherReservationsTotal.get(loan.id) || 0;
            const baseAvailable = liveLoan.amount * (1 - (liveLoan.committedPercentage || 0) / 100);
            const liveAvailable = Math.max(0, baseAvailable - othersReserved);

            // Buscar si este préstamo tenía monto asignado originalmente
            const originalDist = paymentDistribution.find(d => d.loan.id === loan.id);
            const originalAmount = originalDist?.amount || 0;

            return {
                loan: liveLoan,
                liveAvailable,
                originalAmount,
                amount: 0, // Se calcula abajo
                hasChanged: false,
            };
        });

        // Redistribuir el pago entre TODOS los préstamos disponibles en cola
        let remainingAmount = totalPaymentAmount;
        const redistributed = allLoansWithAvailability.map(dist => {
            if (remainingAmount <= 0) {
                const hasChanged = dist.originalAmount > 0;
                return { ...dist, amount: 0, hasChanged };
            }

            const amountForThisLoan = Math.min(remainingAmount, dist.liveAvailable);
            remainingAmount -= amountForThisLoan;

            const hasChanged = Math.abs(amountForThisLoan - dist.originalAmount) > 1; // tolerancia $1

            return {
                ...dist,
                amount: amountForThisLoan,
                hasChanged
            };
        });

        console.log(`[LiveDist] Total needed: ${totalPaymentAmount}, Remaining: ${remainingAmount}`);
        redistributed.filter(d => d.amount > 0 || d.originalAmount > 0).forEach(d => {
            console.log(`  Loan ${d.loan.id}: available=${d.liveAvailable}, assigned=${d.amount}, original=${d.originalAmount}, changed=${d.hasChanged}`);
        });

        // Solo retornar préstamos con monto > 0 o que tenían monto original
        return redistributed.filter(d => d.amount > 0 || d.originalAmount > 0).map(d => ({
            ...d,
            undistributedAmount: remainingAmount
        }));
    }, [loansInQueue, paymentDistribution, totalPaymentAmount, liveLoans, otherReservationsTotal]);

    // 🔒 DISTRIBUCIÓN EFECTIVA: Usa la congelada si está reservado, si no la live
    const effectiveDistribution = useMemo(() => {
        if (frozenDistribution && (reservationStatus === 'reserved' || reservationStatus === 'confirming')) {
            return frozenDistribution.map(d => ({ ...d, liveAvailable: d.amount, hasChanged: false, originalAmount: d.amount, undistributedAmount: 0 }));
        }
        return livePaymentDistribution;
    }, [frozenDistribution, reservationStatus, livePaymentDistribution]);

    // Número de préstamos que recibirán fondos (basado en distribución efectiva)
    const numberOfLoans = useMemo(() =>
        effectiveDistribution.filter(d => d.amount > 0).length,
        [effectiveDistribution]
    );

    // El total que no se pudo redistribuir (solo relevante si NO está reservado)
    const undistributedAmount = useMemo(() => {
        if (frozenDistribution && (reservationStatus === 'reserved' || reservationStatus === 'confirming')) {
            return 0; // Ya está congelado, no hay problema
        }
        const totalAssigned = livePaymentDistribution.reduce((sum, d) => sum + d.amount, 0);
        return Math.max(0, totalPaymentAmount - totalAssigned);
    }, [totalPaymentAmount, livePaymentDistribution, frozenDistribution, reservationStatus]);

    // Solo hay problema si NO pudimos distribuir todo el monto Y NO está reservado
    const distributionHasProblems = undistributedAmount > 1 && reservationStatus !== 'reserved' && reservationStatus !== 'confirming';

    // La distribución cambió pero sigue siendo válida (solo mostrar si NO está reservado)
    const distributionChanged = useMemo(() => {
        if (reservationStatus === 'reserved' || reservationStatus === 'confirming') return false;
        return livePaymentDistribution.some(d => d.hasChanged) && !distributionHasProblems;
    }, [livePaymentDistribution, distributionHasProblems, reservationStatus]);

    console.log(`[Distribution] Problems: ${distributionHasProblems}, Changed: ${distributionChanged}, Undistributed: ${undistributedAmount}`);


    // Verificar si tenemos todos los comprobantes necesarios (solo para préstamos con monto > 0)
    const allProofsUploaded = useMemo(() => {
        const loansWithAmount = livePaymentDistribution.filter(d => d.amount > 0);
        return loansWithAmount.every(dist => proofFiles.has(dist.loan.id));
    }, [livePaymentDistribution, proofFiles]);

    // 🔥 LISTENER DE FIRESTORE: Escuchar cambios en TODOS los préstamos de la cola
    useEffect(() => {
        if (!isOpen || allLoanIds.length === 0) return;

        const unsubscribers: (() => void)[] = [];

        allLoanIds.forEach(loanId => {
            const loanRef = doc(db, 'loanRequests', loanId);

            const unsubscribe = onSnapshot(loanRef, (snapshot) => {
                if (snapshot.exists()) {
                    const loanData = { id: snapshot.id, ...snapshot.data() } as Loan;
                    console.log(`[Firestore Repayment] Loan ${loanId} updated:`, loanData.committedPercentage);

                    setLiveLoans(prev => {
                        const newMap = new Map(prev);
                        newMap.set(loanId, loanData);
                        return newMap;
                    });
                }
            }, (error) => {
                console.error(`[Firestore Repayment] Error listening to loan ${loanId}:`, error);
            });

            unsubscribers.push(unsubscribe);
        });

        return () => unsubscribers.forEach(unsub => unsub());
    }, [isOpen, allLoanIds]);

    // Escuchar TODAS las reservas en tiempo real para TODOS los préstamos (RTDB)
    useEffect(() => {
        if (!isOpen || !payerId || allLoanIds.length === 0) return;

        console.log('[RTDB Repayment] Setting up listeners for loans:', allLoanIds);
        const unsubscribers: (() => void)[] = [];

        allLoanIds.forEach(loanId => {
            const reservationsRef = rtdbRef(rtdb, `loanReservations/${loanId}`);

            const unsubscribe = onValue(reservationsRef, (snapshot) => {
                const allData = snapshot.val() as AllReservations | null;
                console.log(`[RTDB Repayment] Reservations for ${loanId}:`, allData);

                const now = Date.now();
                let myRes: LoanReservation | null = null;
                let totalOthers = 0;

                if (allData) {
                    for (const [odeinvId, reservation] of Object.entries(allData)) {
                        if (reservation.expiresAt < now) {
                            const expiredRef = rtdbRef(rtdb, `loanReservations/${loanId}/${odeinvId}`);
                            remove(expiredRef);
                            continue;
                        }

                        if (odeinvId === payerId) {
                            myRes = reservation;
                        } else {
                            totalOthers += reservation.amount;
                            console.log(`[RTDB Repayment] Found OTHER reservation: ${odeinvId} for ${reservation.amount}`);
                        }
                    }
                }

                setMyReservations(prev => {
                    const newMap = new Map(prev);
                    if (myRes) {
                        newMap.set(loanId, myRes);
                    } else {
                        newMap.delete(loanId);
                    }
                    return newMap;
                });

                setOtherReservationsTotal(prev => {
                    const newMap = new Map(prev);
                    newMap.set(loanId, totalOthers);
                    return newMap;
                });
            });

            unsubscribers.push(unsubscribe);
        });

        return () => unsubscribers.forEach(unsub => unsub());
    }, [isOpen, payerId, allLoanIds]);

    // Actualizar estado de reserva basado en si tenemos reservas para préstamos con monto > 0
    useEffect(() => {
        if (reservationStatus === 'confirming' || reservationStatus === 'confirmed') return;

        // Solo necesitamos reservas para préstamos que tienen monto asignado
        const loansWithAmount = livePaymentDistribution.filter(d => d.amount > 0);
        const allReserved = loansWithAmount.every(dist => myReservations.has(dist.loan.id));

        if (allReserved && loansWithAmount.length > 0) {
            setReservationStatus('reserved');
        } else if (reservationStatus === 'reserved') {
            setReservationStatus('idle');
        }
    }, [myReservations, livePaymentDistribution, reservationStatus]);

    // Limpiar MIS reservas al cerrar el modal
    useEffect(() => {
        if (!isOpen && reservationStatus === 'reserved' && payerId) {
            paymentDistribution.forEach(dist => {
                const myReservationRef = rtdbRef(rtdb, `loanReservations/${dist.loan.id}/${payerId}`);
                remove(myReservationRef);
            });
            setReservationStatus('idle');
        }
    }, [isOpen, paymentDistribution, reservationStatus, payerId]);

    // Contador regresivo para MIS reservas (usa la que expira primero)
    useEffect(() => {
        if (reservationStatus !== 'reserved' || myReservations.size === 0) {
            setTimeRemaining(0);
            return;
        }

        const updateTimer = () => {
            const now = Date.now();
            // Encontrar la reserva que expira primero
            let minExpiration = Infinity;
            myReservations.forEach(res => {
                if (res.expiresAt < minExpiration) {
                    minExpiration = res.expiresAt;
                }
            });

            const remaining = Math.max(0, Math.floor((minExpiration - now) / 1000));
            setTimeRemaining(remaining);

            if (remaining <= 0) {
                setReservationStatus('idle');
                toast({
                    title: 'Reserva expirada',
                    description: 'Tu reserva de 5 minutos ha expirado. Puedes intentar reservar de nuevo.',
                    variant: 'destructive'
                });
            }
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);

        return () => clearInterval(interval);
    }, [reservationStatus, myReservations, toast]);

    // Formatear tiempo restante
    const formatTimeRemaining = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Reservar cupo en TODOS los préstamos
    const handleReserveAmount = async () => {
        if (!payerId) {
            toast({ title: 'Error', description: 'Usuario no autenticado.', variant: 'destructive' });
            return;
        }

        // Solo reservar en préstamos que tienen monto asignado
        const loansToReserve = livePaymentDistribution.filter(d => d.amount > 0);

        if (loansToReserve.length === 0) {
            toast({ title: 'Error', description: 'No hay préstamos disponibles para reservar.', variant: 'destructive' });
            return;
        }

        setReservationStatus('reserving');

        try {
            const now = Date.now();

            // 🔒 CONGELAR LA DISTRIBUCIÓN ANTES DE RESERVAR
            // Convertir a LoanPaymentDistribution[] limpio
            const distributionToFreeze: LoanPaymentDistribution[] = loansToReserve.map(d => ({
                loan: d.loan,
                amount: d.amount,
            }));
            setFrozenDistribution(distributionToFreeze);

            // Reservar en los préstamos de la distribución RECALCULADA
            await Promise.all(loansToReserve.map(async (dist) => {
                const existingReservation = myReservations.get(dist.loan.id);
                const reservationRef = rtdbRef(rtdb, `loanReservations/${dist.loan.id}/${payerId}`);

                const reservationData: LoanReservation = {
                    odeinvId: payerId,
                    amount: dist.amount,
                    reservedAt: existingReservation?.reservedAt || now,
                    expiresAt: now + RESERVATION_TIMEOUT_MS,
                };

                await set(reservationRef, reservationData);
            }));

            setReservationStatus('reserved');
            toast({
                title: '¡Cupo reservado!',
                description: loansToReserve.length > 1
                    ? `Has reservado ${formatCurrency(payingLoanBreakdown.total)} en ${loansToReserve.length} préstamos. Tienes 5 minutos para completar los pagos.`
                    : `Has reservado ${formatCurrency(payingLoanBreakdown.total)}. Tienes 5 minutos para completar el pago.`
            });
        } catch (error) {
            console.error('[RTDB Repayment] Error reserving:', error);
            setReservationStatus('error');
            setFrozenDistribution(null); // Limpiar si falla
            toast({
                title: 'Error al reservar',
                description: 'No se pudo reservar el cupo. Intenta de nuevo.',
                variant: 'destructive'
            });
        }
    };

    // Cancelar reserva en TODOS los préstamos que tengo reservados
    const handleCancelReservation = async () => {
        if (!payerId) return;

        try {
            // Cancelar todas mis reservas activas
            const reservedLoanIds = Array.from(myReservations.keys());
            await Promise.all(reservedLoanIds.map(async (loanId) => {
                const reservationRef = rtdbRef(rtdb, `loanReservations/${loanId}/${payerId}`);
                await remove(reservationRef);
            }));
            setReservationStatus('idle');
            setFrozenDistribution(null); // 🔓 DESCONGELAR al cancelar
            toast({ title: 'Reserva cancelada', description: 'Tu reserva ha sido cancelada.' });
        } catch (error) {
            console.error('[RTDB Repayment] Error canceling:', error);
        }
    };

    const handleConfirmClick = async () => {
        if (reservationStatus !== 'reserved') {
            toast({
                title: "Debes reservar primero",
                description: "Por favor reserva tu cupo antes de confirmar el pago.",
                variant: "destructive"
            });
            return;
        }
        if (!allProofsUploaded || !user) {
            const missingCount = paymentDistribution.filter(d => !proofFiles.has(d.loan.id)).length;
            toast({
                title: "Faltan Comprobantes",
                description: `Por favor, adjunta los ${missingCount} comprobante(s) de pago faltantes.`,
                variant: "destructive"
            });
            return;
        }

        setReservationStatus('confirming');
        setIsConfirming(true);

        try {
            // 🔒 Usar la distribución CONGELADA (effectiveDistribution) al confirmar
            const finalDistribution: LoanPaymentDistribution[] = effectiveDistribution
                .filter(d => d.amount > 0)
                .map(d => ({
                    loan: d.loan,
                    amount: d.amount,
                    proofFile: proofFiles.get(d.loan.id)
                }));

            // Pasar los montos exactos de reinversión por banquero
            await onConfirm(proofFiles, finalDistribution, bankerReinvestAmounts);
            setReservationStatus('confirmed');
            // Limpiar reservas después de confirmar
            await Promise.all(effectiveDistribution.map(async (dist) => {
                const reservationRef = rtdbRef(rtdb, `loanReservations/${dist.loan.id}/${payerId}`);
                await remove(reservationRef);
            }));
            setFrozenDistribution(null); // Limpiar después de confirmar
        } catch (error) {
            setReservationStatus('reserved');
        } finally {
            setIsConfirming(false);
        }
    }

    const handleFileChange = (loanId: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setProofFiles(prev => {
                const newMap = new Map(prev);
                newMap.set(loanId, e.target.files![0]);
                return newMap;
            });
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
        console.log(`[MODAL] Breakdown - Capital: ${payingLoanBreakdown.capital}, Interest: ${payingLoanBreakdown.interest}, TechFee: ${payingLoanBreakdown.technologyFee}`);

        // PASO 1: Calcular el interés TOTAL teórico de todos los inversores
        let totalTheoreticalInterest = 0;
        const investorTheoreticalData = sortedInvestments.map(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
            const daysToPayment = differenceInDays(paymentDate, invDate);
            const theoreticalInterest = inv.amount * (Math.pow(1 + dailyRate, daysToPayment) - 1);
            totalTheoreticalInterest += theoreticalInterest;
            return {
                id: inv.id,
                theoreticalInterest,
                daysToPayment,
                invDate
            };
        });

        // PASO 2: Calcular qué proporción del interés total se está pagando
        const interestPaymentRatio = totalTheoreticalInterest > 0
            ? Math.min(1, payingLoanBreakdown.interest / totalTheoreticalInterest)
            : 0;

        console.log(`[MODAL] Total Theoretical Interest: ${totalTheoreticalInterest.toFixed(2)}`);
        console.log(`[MODAL] Interest Being Paid: ${payingLoanBreakdown.interest.toFixed(2)}`);
        console.log(`[MODAL] Interest Payment Ratio: ${(interestPaymentRatio * 100).toFixed(2)}%`);

        // PASO 3: Calcular el desglose para cada inversor
        const breakdowns = sortedInvestments.map(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));

            // Participación usando valor presente (igual que investment-detail.tsx)
            const thisInvestorPV = presentValues.find(p => p.id === inv.id)?.pv || 0;
            const participation = totalPresentValue > 0 ? thisInvestorPV / totalPresentValue : 0;

            // Datos teóricos del inversor
            const investorData = investorTheoreticalData.find(d => d.id === inv.id);
            const theoreticalInterest = investorData?.theoreticalInterest || 0;
            const daysToPayment = investorData?.daysToPayment || 0;

            // Interés REAL que recibe
            // Si es la primera cuota (period === 1), usamos el teórico (días exactos).
            // Si es cuota 2+, usamos proporcional directo (interés global * participación).
            const periodNum = payingLoanBreakdown.period ? Number(payingLoanBreakdown.period) : 1;
            const isFirstPeriod = periodNum === 1;
            const useProportionalInterest = !isFirstPeriod; // Cuota 2+ usa proporcional
            
            // DEBUG - this appears in browser console
            console.log('[MODAL BANKER] RAW payingLoanBreakdown.period:', payingLoanBreakdown.period, 'type:', typeof payingLoanBreakdown.period);
            console.log(`[MODAL BANKER] Period check: periodNum=${periodNum}, isFirstPeriod=${isFirstPeriod}, useProportionalInterest=${useProportionalInterest}`);

            const actualInterestForInvestor = useProportionalInterest
                ? payingLoanBreakdown.interest * participation
                : theoreticalInterest * interestPaymentRatio;

            // Capital: Simplemente proporcional al capital global
            let actualCapitalForInvestor: number;
            let installmentForInvestor: number;

            if (payingLoanBreakdown.capital <= 0) {
                // Sin capital, solo interés
                actualCapitalForInvestor = 0;
                installmentForInvestor = actualInterestForInvestor;
            } else {
                // Capital del inversor = Capital global * participación
                actualCapitalForInvestor = payingLoanBreakdown.capital * participation;
                // Cuota del inversor = Capital + Interés
                installmentForInvestor = actualCapitalForInvestor + actualInterestForInvestor;
            }

            const isBanqi = inv.investorId === BANQI_FEE_INVESTOR_ID;

            console.log(`[MODAL] Banker ${inv.investorId?.substring(0, 8)}:`, {
                amount: inv.amount,
                participation: (participation * 100).toFixed(2) + '%',
                daysToPayment,
                theoreticalInterest: theoreticalInterest.toFixed(2),
                actualInterest: actualInterestForInvestor.toFixed(2),
                actualCapital: actualCapitalForInvestor.toFixed(2),
                installment: installmentForInvestor.toFixed(2),
                period: payingLoanBreakdown.period,
                method: useProportionalInterest ? 'Proportional' : 'TimeBased'
            });

            return {
                id: inv.id,
                investorId: inv.investorId,
                investorName: (inv as EnrichedBanker).investorName || 'Banquero',
                isBanqi,
                participation,
                capital: actualCapitalForInvestor,
                interest: actualInterestForInvestor,
                installment: installmentForInvestor,
                daysToPayment
            };
        });

        return breakdowns;
    }, [bankers, payingLoan.interestRate, payingLoan.paymentDay, payingLoanBreakdown.capital, payingLoanBreakdown.interest, payingLoanBreakdown.paymentDate, payingLoanBreakdown.period]);

    // Calcular los montos exactos a reinvertir por cada banquero (para sourceBreakdown)
    const bankerReinvestAmounts: BankerReinvestAmount[] = useMemo(() => {
        return bankerBreakdowns.map(breakdown => {
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

            return {
                investorId: breakdown.investorId || '',
                amount: totalToReinvest
            };
        });
    }, [bankerBreakdowns, payingLoanBreakdown.technologyFee]);

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
                                <span className="text-2xl font-bold text-primary">{formatCurrency(payingLoanBreakdown.total, payingLoanBreakdown.total % 1 !== 0)}</span>
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
                                {numberOfLoans > 1 && (
                                    <div className="pt-2 border-t mt-2">
                                        <p className="text-xs text-muted-foreground text-center">
                                            Este pago se distribuirá en {numberOfLoans} préstamos diferentes
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Alerta si NO hay suficiente disponibilidad total */}
                        {distributionHasProblems && (
                            <Alert className="border-destructive bg-destructive/10">
                                <Loader2 className="h-4 w-4 text-destructive animate-spin" />
                                <AlertTitle className="font-bold text-destructive">¡No hay suficiente disponibilidad!</AlertTitle>
                                <AlertDescription className="text-destructive">
                                    Otros usuarios reservaron mientras estabas aquí. Faltan {formatCurrency(undistributedAmount)} por distribuir. Cierra y vuelve a intentar con un monto menor.
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Alerta informativa si la distribución cambió pero sigue válida */}
                        {distributionChanged && !distributionHasProblems && (
                            <Alert className="border-yellow-500 bg-yellow-50">
                                <ArrowRight className="h-4 w-4 text-yellow-600" />
                                <AlertTitle className="font-bold text-yellow-700">Distribución actualizada</AlertTitle>
                                <AlertDescription className="text-yellow-700">
                                    La disponibilidad cambió, pero tu pago aún cabe. Revisa la nueva distribución abajo.
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Solo mostrar cuentas y comprobantes DESPUÉS de reservar */}
                        {reservationStatus === 'reserved' || reservationStatus === 'confirming' ? (
                            <div className="space-y-4">
                                {effectiveDistribution.filter(d => d.amount > 0).map((dist, index, filteredArray) => {
                                    const hasIssue = false; // Ya no hay issue individual si pasó la redistribución

                                    return (
                                        <div key={dist.loan.id} className="space-y-3">
                                            {filteredArray.length > 1 && (
                                                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs">
                                                        {index + 1}
                                                    </span>
                                                    <span>Transferencia {index + 1} de {filteredArray.length}</span>
                                                    <ArrowRight className="h-4 w-4" />
                                                    <span className="font-bold">{formatCurrency(dist.amount)}</span>
                                                </div>
                                            )}
                                            <Alert className="border-green-500 bg-green-50">
                                                <Landmark className="h-4 w-4 text-green-600" />
                                                <AlertTitle className="font-bold text-green-700">
                                                    Transferir {formatCurrency(dist.amount)} a:
                                                </AlertTitle>
                                                <AlertDescription className="space-y-1 pt-2 text-green-800">
                                                    <div className="flex justify-between">
                                                        <span className='flex items-center gap-2'><User className="h-4 w-4" /> Nombre:</span>
                                                        <span className="font-medium">{dist.loan.requesterFirstName} {dist.loan.requesterLastName}</span>
                                                    </div>
                                                    <div className="flex justify-between"><span>Banco:</span> <span className="font-medium">{dist.loan.bankName || 'N/A'}</span></div>
                                                    <div className="flex justify-between"><span>Tipo de Cuenta:</span> <span className="font-medium">{dist.loan.accountType || 'N/A'}</span></div>
                                                    <div className="flex justify-between"><span>Número de Cuenta:</span> <span className="font-medium">{dist.loan.accountNumber || 'N/A'}</span></div>
                                                </AlertDescription>
                                            </Alert>
                                            <div className="space-y-2">
                                                <Label htmlFor={`payment-proof-${dist.loan.id}`} className="font-semibold text-base flex items-center gap-2">
                                                    <UploadCloud className="h-5 w-5 text-primary" />
                                                    {filteredArray.length > 1 ? `Comprobante de ${formatCurrency(dist.amount)}` : 'Adjunta tu Comprobante de Pago'}
                                                    {proofFiles.has(dist.loan.id) && <Check className="h-4 w-4 text-green-600" />}
                                                </Label>
                                                <Input
                                                    id={`payment-proof-${dist.loan.id}`}
                                                    name={`paymentProof-${dist.loan.id}`}
                                                    type="file"
                                                    accept="image/*,application/pdf"
                                                    onChange={(e) => handleFileChange(dist.loan.id, e)}
                                                    className='file:text-primary file:font-semibold'
                                                />
                                            </div>
                                            {index < filteredArray.length - 1 && <Separator />}
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            /* Antes de reservar: solo mostrar mensaje si hay problemas de distribución */
                            distributionHasProblems ? (
                                <Alert className="border-destructive bg-destructive/10">
                                    <Loader2 className="h-4 w-4 text-destructive" />
                                    <AlertTitle className="font-bold text-destructive">
                                        Faltan {formatCurrency(undistributedAmount)} por distribuir
                                    </AlertTitle>
                                    <AlertDescription className="text-destructive text-xs">
                                        No hay suficiente disponibilidad. Cierra y reduce el monto del pago.
                                    </AlertDescription>
                                </Alert>
                            ) : null
                        )}
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

                {/* Reservation Status & Timer */}
                {reservationStatus === 'reserved' && timeRemaining > 0 && (
                    <Alert className="border-primary bg-primary/10">
                        <Timer className="h-4 w-4" />
                        <AlertTitle className="font-bold flex items-center justify-between">
                            <span>Cupo reservado</span>
                            <span className="text-lg font-mono text-primary">{formatTimeRemaining(timeRemaining)}</span>
                        </AlertTitle>
                        <AlertDescription>
                            Tienes {formatTimeRemaining(timeRemaining)} para completar {numberOfLoans > 1 ? 'los pagos' : 'el pago'}. Adjunta {numberOfLoans > 1 ? 'los comprobantes' : 'el comprobante'} y confirma.
                        </AlertDescription>
                    </Alert>
                )}

                <DialogFooter className="pt-4 flex-col sm:flex-row gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={isConfirming || reservationStatus === 'confirming'}>
                        Cancelar
                    </Button>

                    {reservationStatus === 'idle' && (
                        <Button
                            type="button"
                            onClick={handleReserveAmount}
                            disabled={!payerId || distributionHasProblems}
                            variant={distributionHasProblems ? "destructive" : "default"}
                        >
                            {distributionHasProblems ? (
                                'Disponibilidad cambió - Cierra y reintenta'
                            ) : (
                                <>
                                    <Timer className="mr-2 h-4 w-4" />
                                    Reservar Cupo{numberOfLoans > 1 ? ` en ${numberOfLoans} préstamos` : ''} (5 min)
                                </>
                            )}
                        </Button>
                    )}

                    {reservationStatus === 'reserving' && (
                        <Button type="button" disabled>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Reservando...
                        </Button>
                    )}

                    {reservationStatus === 'reserved' && (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCancelReservation}
                                disabled={isConfirming}
                            >
                                Cancelar Reserva
                            </Button>
                            <Button
                                type="button"
                                onClick={handleConfirmClick}
                                disabled={isConfirming || !allProofsUploaded || distributionHasProblems}
                                className="bg-green-600 hover:bg-green-700"
                            >
                                {isConfirming ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Procesando...
                                    </>
                                ) : distributionHasProblems ? (
                                    'Disponibilidad cambió'
                                ) : (
                                    <>
                                        <Check className="mr-2 h-4 w-4" />
                                        {numberOfLoans > 1
                                            ? `He Realizado los ${numberOfLoans} Pagos (${formatTimeRemaining(timeRemaining)})`
                                            : `He Realizado el Pago (${formatTimeRemaining(timeRemaining)})`
                                        }
                                    </>
                                )}
                            </Button>
                        </>
                    )}

                    {reservationStatus === 'confirming' && (
                        <Button type="button" disabled>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Confirmando {numberOfLoans > 1 ? 'pagos' : 'pago'}...
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
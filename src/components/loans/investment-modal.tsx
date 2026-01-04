

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Info, Landmark, ShieldCheck, FileText, Lock, CheckCircle2, AlertTriangle, Timer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { collection, addDoc, doc, updateDoc, serverTimestamp, runTransaction, getDoc, Timestamp } from 'firebase/firestore';
import { db, storage, rtdb } from '@/lib/firebase';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ref as rtdbRef, set, remove, onValue, get } from 'firebase/database';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import type { Loan } from '@/lib/types';
import { Separator } from '../ui/separator';
import { Card, CardContent, CardHeader } from '../ui/card';
import { parseISO } from 'date-fns';

type InvestmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  loan: Loan;
  investorId: string;
};

type ReservationStatus = 'idle' | 'reserving' | 'reserved' | 'confirming' | 'confirmed' | 'error';

type LoanReservation = {
  investorId: string;
  amount: number;
  reservedAt: number;
  expiresAt: number;
};

type AllReservations = {
  [investorId: string]: LoanReservation;
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos para completar la inversión


export default function InvestmentModal({ isOpen, onClose, loan, investorId }: InvestmentModalProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | string>('');
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [investmentDate, setInvestmentDate] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Reservation states
  const [reservationStatus, setReservationStatus] = useState<ReservationStatus>('idle');
  const [myReservation, setMyReservation] = useState<LoanReservation | null>(null);
  const [otherReservations, setOtherReservations] = useState<LoanReservation[]>([]);
  const [reservedAmount, setReservedAmount] = useState<number>(0);
  const [timeRemaining, setTimeRemaining] = useState<number>(0); // en segundos para MI reserva
  const [totalOthersReserved, setTotalOthersReserved] = useState<number>(0);
  const [othersTimeRemaining, setOthersTimeRemaining] = useState<{amount: number, timeRemaining: number}[]>([]); // tiempo de cada reserva
  
  // Calcular el monto disponible considerando TODAS las reservas activas de otros
  const amountToFund = useMemo(() => {
    if (!loan.amount) return 0;
    const baseAmount = loan.amount * (1 - (loan.committedPercentage || 0) / 100);
    // Restar todas las reservas de otros inversionistas
    const availableAfterReservations = baseAmount - totalOthersReserved;
    // Redondear a entero para evitar problemas con decimales
    return Math.max(0, Math.round(availableAfterReservations));
  }, [loan.amount, loan.committedPercentage, totalOthersReserved]);
  
  // Escuchar TODAS las reservas en tiempo real
  useEffect(() => {
    if (!isOpen || !loan.id) return;
    
    const reservationsRef = rtdbRef(rtdb, `loanReservations/${loan.id}`);
    
    const unsubscribe = onValue(reservationsRef, (snapshot) => {
      const allData = snapshot.val() as AllReservations | null;
      console.log('[RTDB] All reservations:', allData, 'Current investorId:', investorId);
      
      const now = Date.now();
      let myRes: LoanReservation | null = null;
      const othersRes: LoanReservation[] = [];
      let totalOthers = 0;
      
      if (allData) {
        // Iterar sobre todas las reservas
        for (const [odeinvId, reservation] of Object.entries(allData)) {
          // Verificar si la reserva expiró
          if (reservation.expiresAt < now) {
            // Reserva expirada, limpiar
            console.log('[RTDB] Reservation expired for:', odeinvId);
            const expiredRef = rtdbRef(rtdb, `loanReservations/${loan.id}/${odeinvId}`);
            remove(expiredRef);
            continue;
          }
          
          if (odeinvId === investorId) {
            // Es nuestra reserva
            myRes = reservation;
          } else {
            // Reserva de otro inversionista activa
            othersRes.push(reservation);
            totalOthers += reservation.amount;
          }
        }
      }
      
      // Actualizar estados
      setMyReservation(myRes);
      setOtherReservations(othersRes);
      setTotalOthersReserved(totalOthers);
      
      if (myRes) {
        setReservedAmount(myRes.amount);
        if (reservationStatus !== 'confirmed' && reservationStatus !== 'confirming') {
          setReservationStatus('reserved');
        }
      } else if (reservationStatus === 'reserved') {
        // Nuestra reserva desapareció
        setReservationStatus('idle');
        setReservedAmount(0);
      }
    });
    
    return () => unsubscribe();
  }, [isOpen, loan.id, investorId]);
  
  // Limpiar MI reserva al cerrar el modal
  useEffect(() => {
    if (!isOpen && reservationStatus === 'reserved') {
      const myReservationRef = rtdbRef(rtdb, `loanReservations/${loan.id}/${investorId}`);
      remove(myReservationRef);
      setReservationStatus('idle');
      setReservedAmount(0);
    }
  }, [isOpen, loan.id, reservationStatus, investorId]);
  
  // Contador regresivo para MI reserva
  useEffect(() => {
    if (reservationStatus !== 'reserved' || !myReservation) {
      setTimeRemaining(0);
      return;
    }
    
    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((myReservation.expiresAt - now) / 1000));
      setTimeRemaining(remaining);
      
      if (remaining <= 0) {
        // Reserva expiró
        setReservationStatus('idle');
        setReservedAmount(0);
        toast({ 
          title: 'Reserva expirada', 
          description: 'Tu reserva de 5 minutos ha expirado. Puedes intentar reservar de nuevo.',
          variant: 'destructive'
        });
      }
    };
    
    // Actualizar inmediatamente
    updateTimer();
    
    // Actualizar cada segundo
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [reservationStatus, myReservation, toast]);
  
  // Contador regresivo para reservas de OTROS (FOMO effect)
  useEffect(() => {
    if (otherReservations.length === 0) {
      setOthersTimeRemaining([]);
      return;
    }
    
    const updateOthersTimer = () => {
      const now = Date.now();
      // Calcular tiempo restante para CADA reserva
      const timers = otherReservations
        .map(r => ({
          amount: r.amount,
          timeRemaining: Math.max(0, Math.floor((r.expiresAt - now) / 1000))
        }))
        .sort((a, b) => a.timeRemaining - b.timeRemaining); // ordenar por tiempo (menor primero)
      setOthersTimeRemaining(timers);
    };
    
    updateOthersTimer();
    const interval = setInterval(updateOthersTimer, 1000);
    
    return () => clearInterval(interval);
  }, [otherReservations]);
  
  // Formatear tiempo restante
  const formatTimeRemaining = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
        setAmount('');
        return;
    }
    // Solo permitir números enteros (sin decimales)
    const intValue = Math.floor(Number(value.replace(/[^0-9]/g, '')));
    if (!isNaN(intValue) && intValue > 0 && intValue <= amountToFund) {
      setAmount(intValue);
    } else if (intValue > amountToFund) {
      setAmount(amountToFund); // amountToFund ya está redondeado
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setPaymentProof(e.target.files[0]);
    }
  };
  
  // Paso 1: Reservar el cupo (MÚLTIPLES reservas permitidas simultáneamente)
  const handleReserveAmount = async () => {
    if (!amount || Number(amount) <= 0) {
      toast({ title: 'Monto inválido', description: 'Por favor ingresa un monto válido.', variant: 'destructive' });
      return;
    }
    
    // Validar que el monto no exceda lo disponible (basado en el estado local que ya considera otras reservas)
    if (Number(amount) > amountToFund) {
      toast({ 
        title: 'Monto excede disponible', 
        description: `El máximo disponible es ${formatCurrency(amountToFund)}. Por favor ajusta tu monto.`, 
        variant: 'destructive' 
      });
      return;
    }
    
    setReservationStatus('reserving');
    
    try {
      // Referencia a MI reserva específica (las reglas solo permiten escribir aquí)
      const myReservationRef = rtdbRef(rtdb, `loanReservations/${loan.id}/${investorId}`);
      
      const now = Date.now();
      const requestedAmount = Number(amount);
      
      // Crear/actualizar mi reserva directamente
      const reservationData: LoanReservation = {
        investorId,
        amount: requestedAmount,
        reservedAt: myReservation?.reservedAt || now,
        expiresAt: now + RESERVATION_TIMEOUT_MS,
      };
      
      await set(myReservationRef, reservationData);
      
      setReservedAmount(requestedAmount);
      setReservationStatus('reserved');
      toast({ 
        title: '¡Cupo reservado!', 
        description: `Has reservado ${formatCurrency(requestedAmount)}. Tienes 5 minutos para completar la inversión.` 
      });
      
    } catch (error) {
      console.error('Error reserving amount:', error);
      setReservationStatus('idle');
      toast({ 
        title: 'Error', 
        description: 'No se pudo reservar el cupo. Intenta de nuevo.', 
        variant: 'destructive' 
      });
    }
  };

  const handleSubmit = async () => {
    if (!amount || !paymentProof || !loan.requesterId) {
        toast({ title: 'Datos incompletos', description: 'Por favor, ingresa un monto y sube el comprobante.', variant: 'destructive'});
        return;
    }
    
    if (reservationStatus !== 'reserved') {
      toast({ title: 'Reserva requerida', description: 'Debes reservar el cupo antes de confirmar la inversión.', variant: 'destructive'});
      return;
    }
    
    setReservationStatus('confirming');
    setLoading(true);

    try {
        const loanRef = doc(db, 'loanRequests', loan.id);
        // Usar la referencia a MI reserva específica
        const myReservationRef = rtdbRef(rtdb, `loanReservations/${loan.id}/${investorId}`);
        
        // Verificar que nuestra reserva sigue activa
        const reservationSnap = await get(myReservationRef);
        const reservationData = reservationSnap.val() as LoanReservation | null;
        
        if (!reservationData) {
          throw new Error('Tu reserva ha expirado. Por favor, intenta de nuevo.');
        }
        
        if (Date.now() > reservationData.expiresAt) {
          await remove(myReservationRef);
          throw new Error('Tu reserva ha expirado. Por favor, intenta de nuevo.');
        }
        
        const proofStorageRef = storageRef(storage, `investment-proofs/${loan.id}/${investorId}-${Date.now()}`);
        const uploadResult = await uploadBytes(proofStorageRef, paymentProof, { contentType: paymentProof.type });
        const proofUrl = await getDownloadURL(uploadResult.ref);

        // Si hay una fecha de inversión seleccionada (modo admin), usar esa fecha con la hora actual
        let createdAtTimestamp: Timestamp;
        if (investmentDate) {
            const now = new Date();
            // parseISO interpreta la fecha en zona horaria local, no UTC
            const selectedDate = parseISO(investmentDate);
            selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
            createdAtTimestamp = Timestamp.fromDate(selectedDate);
        } else {
            createdAtTimestamp = Timestamp.now();
        }

        const investmentData = {
            loanId: loan.id,
            investorId,
            borrowerId: loan.requesterId,
            amount: Number(amount),
            status: 'pending-confirmation',
            paymentProofUrl: proofUrl,
            paymentProofContentType: paymentProof.type,
            createdAt: createdAtTimestamp,
        };
        
        await runTransaction(db, async (transaction) => {
            const loanDoc = await transaction.get(loanRef);
            if (!loanDoc.exists()) {
                throw new Error("El préstamo ya no existe.");
            }

            const loanData = loanDoc.data();
            const currentAmountToFund = loanData.amount * (1 - (loanData.committedPercentage || 0) / 100);

            // Validación estricta: el monto no puede exceder lo disponible
            if (Number(amount) > currentAmountToFund + 0.01) { // +0.01 para tolerancia de redondeo
                throw new Error("El monto disponible para invertir ha cambiado. Por favor, intenta de nuevo.");
            }
            
            const currentCommitted = loanData.amount * ((loanData.committedPercentage || 0) / 100);
            const newTotalCommitted = currentCommitted + Number(amount);
            let newCommittedPercentage = (newTotalCommitted / loanData.amount) * 100;
            
            // Validación adicional: nunca permitir más del 100%
            if (newCommittedPercentage > 100.01) { // +0.01 para tolerancia de redondeo
                throw new Error("Este préstamo ya está completamente financiado.");
            }
            
            newCommittedPercentage = Math.min(100, newCommittedPercentage);
            
            const investmentRef = doc(collection(db, 'investments'));
            transaction.set(investmentRef, investmentData);

            transaction.update(loanRef, { committedPercentage: newCommittedPercentage });
        });
        
        // Limpiar MI reserva después de éxito
        await remove(myReservationRef);
        
        setReservationStatus('confirmed');

        toast({
            title: '¡Comprobante Enviado!',
            description: 'Tu inversión está pendiente de confirmación por parte del solicitante. Te notificaremos cuando sea aceptada.',
        });
        onClose();

    } catch(error) {
        console.error("Error creating investment:", error);
        setReservationStatus('reserved'); // Volver a estado reservado para reintentar
        toast({ title: "Error", description: (error as Error).message || "No se pudo procesar tu inversión. Inténtalo de nuevo.", variant: "destructive"});
    } finally {
        setLoading(false);
    }
  };
  
  const handleCancelReservation = async () => {
    try {
      // Cancelar MI reserva específica
      const myReservationRef = rtdbRef(rtdb, `loanReservations/${loan.id}/${investorId}`);
      await remove(myReservationRef);
      setReservationStatus('idle');
      setReservedAmount(0);
      toast({ title: 'Reserva cancelada', description: 'Has liberado el cupo para otros inversionistas.' });
    } catch (error) {
      console.error('Error canceling reservation:', error);
    }
  };

  const investorInterestRate = useMemo(() => {
    if (!loan.interestRate) return 0;
    return (loan.interestRate * 0.7).toFixed(2);
  }, [loan.interestRate]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && reservationStatus === 'reserved') {
        handleCancelReservation();
      }
      onClose();
    }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Invertir en Préstamo</DialogTitle>
          <DialogDescription>
            Sigue los pasos para completar tu inversión en el préstamo para "{loan.purpose}".
          </DialogDescription>
        </DialogHeader>
        
        {/* Información de otras reservas activas con contador FOMO */}
        {otherReservations.length > 0 && totalOthersReserved > 0 && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-300 rounded-lg p-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-orange-800 text-sm">
                  🔥 {otherReservations.length === 1 ? '1 inversionista' : `${otherReservations.length} inversionistas`} reservando
                </p>
                <p className="text-xs text-orange-700 mt-0.5">
                  Disponible para ti: <strong>{formatCurrency(amountToFund || 0)}</strong>
                </p>
              </div>
            </div>
            
            {/* Contadores individuales por cada reserva */}
            <div className="flex flex-wrap gap-2 mt-3">
              {othersTimeRemaining.map((item, idx) => (
                <div 
                  key={idx}
                  className={`flex items-center gap-2 px-2 py-1 rounded-md text-xs ${
                    item.timeRemaining <= 60 
                      ? 'bg-green-100 border border-green-400' 
                      : 'bg-orange-100 border border-orange-300'
                  }`}
                >
                  <span className="text-gray-600">{formatCurrency(item.amount)}</span>
                  <span className={`font-mono font-bold ${
                    item.timeRemaining <= 60 
                      ? 'text-green-600 animate-pulse' 
                      : 'text-orange-600'
                  }`}>
                    {formatTimeRemaining(item.timeRemaining)}
                  </span>
                </div>
              ))}
            </div>
            
            {othersTimeRemaining.some(t => t.timeRemaining <= 60 && t.timeRemaining > 0) && (
              <p className="text-xs text-green-700 font-medium mt-2 text-center animate-pulse">
                ⏰ ¡Pronto habrá más disponible!
              </p>
            )}
          </div>
        )}
        
        {/* Indicador de reserva exitosa con contador */}
        {reservationStatus === 'reserved' && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-400 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <div>
                  <p className="font-bold text-green-800">¡Cupo reservado!</p>
                  <p className="text-sm text-green-700">
                    Has reservado {formatCurrency(reservedAmount)} para este préstamo.
                  </p>
                </div>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                timeRemaining <= 60 
                  ? 'bg-red-100 border-2 border-red-400' 
                  : timeRemaining <= 120 
                    ? 'bg-yellow-100 border-2 border-yellow-400'
                    : 'bg-green-100 border-2 border-green-400'
              }`}>
                <Timer className={`h-5 w-5 ${
                  timeRemaining <= 60 
                    ? 'text-red-600 animate-pulse' 
                    : timeRemaining <= 120 
                      ? 'text-yellow-600'
                      : 'text-green-600'
                }`} />
                <span className={`text-2xl font-mono font-bold ${
                  timeRemaining <= 60 
                    ? 'text-red-600' 
                    : timeRemaining <= 120 
                      ? 'text-yellow-600'
                      : 'text-green-700'
                }`}>
                  {formatTimeRemaining(timeRemaining)}
                </span>
              </div>
            </div>
            {timeRemaining <= 60 && (
              <p className="text-sm text-red-600 font-medium mt-2 text-center animate-pulse">
                ⚠️ ¡Menos de 1 minuto! Completa tu inversión antes de que expire la reserva.
              </p>
            )}
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2 max-h-[55vh] overflow-y-auto">
            {/* Left Column */}
            <div className="space-y-4">
                {/* Paso 1: Monto y Reserva */}
                <div className="space-y-2">
                    <Label htmlFor="amount" className="font-semibold text-base">1. Ingresa el monto a invertir</Label>
                    <Input 
                        id="amount" 
                        type="number"
                        value={amount}
                        onChange={handleAmountChange}
                        onKeyDown={(e) => {
                          // Bloquear punto y coma (decimales)
                          if (e.key === '.' || e.key === ',') {
                            e.preventDefault();
                          }
                        }}
                        placeholder={`Máximo: ${formatCurrency(amountToFund || 0)}`}
                        max={amountToFund || 0}
                        min={1}
                        step={1}
                        disabled={reservationStatus === 'reserved' || reservationStatus === 'confirming'}
                    />
                    <p className='text-xs text-muted-foreground text-right'>
                        Disponible para fondeo: <span className='font-medium text-foreground'>{formatCurrency(amountToFund || 0)}</span>
                    </p>
                    
                    {(reservationStatus === 'idle' || reservationStatus === 'reserving') && (
                      <Button 
                        className="w-full mt-2" 
                        onClick={handleReserveAmount}
                        disabled={!amount || Number(amount) <= 0 || Number(amount) > amountToFund || reservationStatus === 'reserving'}
                      >
                        {reservationStatus === 'reserving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {reservationStatus !== 'reserving' && <Lock className="mr-2 h-4 w-4" />}
                        {reservationStatus === 'reserving' ? 'Reservando...' : 'Reservar cupo'}
                      </Button>
                    )}
                    
                    {reservationStatus === 'reserved' && (
                      <Button 
                        variant="outline" 
                        className="w-full mt-2" 
                        onClick={handleCancelReservation}
                      >
                        Cancelar reserva y cambiar monto
                      </Button>
                    )}
                </div>
                
                <Separator />
                
                {/* Paso 2: Transferencia - Solo mostrar datos cuando hay reserva */}
                <div className={`space-y-1 ${reservationStatus !== 'reserved' && reservationStatus !== 'confirming' ? 'opacity-50' : ''}`}>
                    <p className="font-semibold text-sm">2. Realiza la transferencia</p>
                    {(reservationStatus === 'reserved' || reservationStatus === 'confirming') ? (
                        <Alert className='border-primary/50 py-2'>
                            <Landmark className="h-3 w-3" />
                            <AlertTitle className="font-bold text-xs">Datos de la Cuenta del Solicitante</AlertTitle>
                            <AlertDescription className='space-y-0.5 pt-1 text-xs'>
                                <div className="flex justify-between"><span>Nombre:</span> <span className="font-medium">{loan.requesterFirstName} {loan.requesterLastName}</span></div>
                                <div className="flex justify-between"><span>Banco:</span> <span className="font-medium">{loan.bankName || 'N/A'}</span></div>
                                <div className="flex justify-between"><span>Tipo de Cuenta:</span> <span className="font-medium">{loan.accountType || 'N/A'}</span></div>
                                <div className="flex justify-between"><span>Número de Cuenta:</span> <span className="font-medium">{loan.accountNumber || 'N/A'}</span></div>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <Alert className='border-muted py-2 bg-muted/30'>
                            <Lock className="h-3 w-3 text-muted-foreground" />
                            <AlertTitle className="font-bold text-xs text-muted-foreground">Datos de la Cuenta</AlertTitle>
                            <AlertDescription className='text-xs text-muted-foreground'>
                                Reserva tu cupo primero para ver los datos bancarios del solicitante.
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                {/* Paso 3: Comprobante */}
                <div className={`space-y-1 ${reservationStatus !== 'reserved' && reservationStatus !== 'confirming' ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Label htmlFor="payment-proof" className="font-semibold text-sm">3. Adjunta el comprobante</Label>
                    <Input 
                        id="payment-proof" 
                        name="paymentProof" 
                        type="file" 
                        accept="image/*,application/pdf" 
                        onChange={handleFileChange} 
                        className='file:text-primary file:font-semibold text-xs'
                        disabled={reservationStatus !== 'reserved' && reservationStatus !== 'confirming'}
                    />
                </div>

                <div className={`space-y-1 ${reservationStatus !== 'reserved' && reservationStatus !== 'confirming' ? 'opacity-50 pointer-events-none' : ''}`}>
                    <Label htmlFor="investment-date" className="font-semibold text-sm">4. Fecha de Inversión (Prueba)</Label>
                    <Input 
                        id="investment-date" 
                        type="date"
                        value={investmentDate}
                        onChange={(e) => setInvestmentDate(e.target.value)}
                        disabled={reservationStatus !== 'reserved' && reservationStatus !== 'confirming'}
                    />
                    <p className='text-xs text-muted-foreground'>Solo para pruebas de matemática financiera.</p>
                </div>
            </div>

            {/* Right Column */}
            <div className="space-y-3">
                 <Card className="py-2">
                    <CardHeader className="py-2 px-4">
                        <p className="font-semibold text-sm">Resumen del Préstamo</p>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm px-4 pb-3">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Propósito:</span>
                            <span className="font-medium text-xs">{loan.purpose}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Monto Total:</span>
                            <span className="font-medium text-xs">{formatCurrency(loan.amount)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Plazo:</span>
                            <span className="font-medium text-xs">{loan.term} meses</span>
                        </div>
                         <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Tu Rentabilidad E.M.:</span>
                            <span className="font-bold text-primary text-xs">{investorInterestRate}%</span>
                        </div>
                    </CardContent>
                 </Card>

                 <Alert variant="default" className="bg-blue-50 border-blue-200 text-blue-900 py-2">
                    <ShieldCheck className="h-3 w-3 !text-blue-700" />
                    <AlertTitle className="text-xs">Transparencia y Verificación</AlertTitle>
                    <AlertDescription className="text-xs">
                        Banqi ha verificado la identidad de este solicitante a través de su cédula de ciudadanía.
                    </AlertDescription>
                </Alert>
                
                 <Alert variant="default" className="bg-yellow-50 border-yellow-200 text-yellow-800 py-2">
                    <Info className="h-3 w-3 !text-yellow-600" />
                    <AlertTitle className="text-xs">Confirmación Pendiente</AlertTitle>
                    <AlertDescription className="text-xs">
                        El solicitante deberá confirmar la recepción del dinero para que tu inversión quede registrada.
                    </AlertDescription>
                </Alert>
                
                {/* Alerta de proceso de reserva */}
                <Alert variant="default" className="bg-purple-50 border-purple-200 text-purple-800 py-2">
                    <Lock className="h-3 w-3 !text-purple-600" />
                    <AlertTitle className="text-xs">Sistema de Reserva</AlertTitle>
                    <AlertDescription className="text-xs">
                        Para evitar sobrefinanciamiento, primero reserva tu cupo (5 min).
                    </AlertDescription>
                </Alert>
            </div>
        </div>

        <DialogFooter className="pt-2">
          <Button type="button" variant="outline" onClick={() => {
            if (reservationStatus === 'reserved') {
              handleCancelReservation();
            }
            onClose();
          }} disabled={loading}>
            Cancelar
          </Button>
          <Button 
            type="submit" 
            onClick={handleSubmit} 
            disabled={loading || !amount || !paymentProof || reservationStatus !== 'reserved'}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar Inversión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

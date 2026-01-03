
'use client';

import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { LoanRequest } from './loan-requests-table';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Separator } from '../ui/separator';

type EvaluationModalProps = {
    isOpen: boolean;
    onClose: () => void;
    request: LoanRequest;
    onApprove: (data: { amount: number; term: number; interestRate: number; disbursementFee: number; technologyFee: number; }) => Promise<void>;
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

export default function EvaluationModal({ isOpen, onClose, request, onApprove }: EvaluationModalProps) {
    const [amount, setAmount] = useState(request.amount);
    const [term, setTerm] = useState(request.term);
    const [interestRate, setInterestRate] = useState(2.1); // Default interest rate
    const [disbursementFee, setDisbursementFee] = useState(25000);
    const [technologyFee, setTechnologyFee] = useState(8000); // Default tech fee
    const [loading, setLoading] = useState(false);

    const monthlyPayment = useMemo(() => {
        const principal = Number(amount);
        const i = Number(interestRate) / 100;
        const n = Number(term);

        if (principal <= 0 || i <= 0 || n <= 0) {
            return 0;
        }

        const interestPaymentPart = principal * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        const totalMonthlyPayment = interestPaymentPart + Number(technologyFee);
        
        return totalMonthlyPayment;

    }, [amount, term, interestRate, technologyFee]);

    const handleApproveClick = async () => {
        setLoading(true);
        await onApprove({ 
            amount: Number(amount), 
            term: Number(term), 
            interestRate: Number(interestRate),
            disbursementFee: Number(disbursementFee),
            technologyFee: Number(technologyFee),
        });
        setLoading(false);
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                <DialogTitle>Pre-Aprobar Solicitud de Crédito</DialogTitle>
                <DialogDescription>
                    Ajusta los términos y envía la oferta al usuario para su aceptación final.
                </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-2">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="requester" className="text-right">
                            Solicitante
                        </Label>
                        <Input id="requester" value={request.userName} disabled className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="amount" className="text-right">
                            Monto
                        </Label>
                        <Input 
                            id="amount" 
                            type="number"
                            value={amount} 
                            onChange={(e) => setAmount(Number(e.target.value))}
                            className="col-span-3" 
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="term" className="text-right">
                            Plazo (meses)
                        </Label>
                        <Input 
                            id="term"
                            type="number" 
                            value={term}
                            onChange={(e) => setTerm(Number(e.target.value))} 
                            className="col-span-3" 
                        />
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="interestRate" className="text-right">
                            Interés (% E.M.)
                        </Label>
                        <Input 
                            id="interestRate" 
                            type="number"
                            step="0.1"
                            value={interestRate}
                            onChange={(e) => setInterestRate(Number(e.target.value))} 
                            className="col-span-3" 
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="disbursementFee" className="text-right">
                            Costo Desembolso
                        </Label>
                        <Input 
                            id="disbursementFee" 
                            type="number"
                            step="1000"
                            value={disbursementFee}
                            onChange={(e) => setDisbursementFee(Number(e.target.value))} 
                            className="col-span-3" 
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="technologyFee" className="text-right">
                            Cuota Tecnología
                        </Label>
                        <Input 
                            id="technologyFee" 
                            type="number"
                            step="1000"
                            value={technologyFee}
                            onChange={(e) => setTechnologyFee(Number(e.target.value))} 
                            className="col-span-3" 
                        />
                    </div>

                    <Separator className="my-2" />

                    <div className="grid grid-cols-1 gap-2">
                        <Label>Simulador de Oferta</Label>
                        <Card className="text-center bg-accent/10">
                            <CardContent className="p-3">
                                <p className="text-sm text-muted-foreground mb-1">Cuota Mensual Aprox.</p>
                                <p className="text-2xl font-bold text-accent">{formatCurrency(monthlyPayment)}</p>
                                <p className="text-xs text-muted-foreground mt-1">Incluye cuota de tecnología</p>
                            </CardContent>
                        </Card>
                    </div>

                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
                    <Button onClick={handleApproveClick} disabled={loading}>
                         {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Enviar Oferta
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

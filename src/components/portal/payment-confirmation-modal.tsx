
'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ReceiptText, Check } from 'lucide-react';
import type { PaymentBreakdown } from '@/lib/types';
import { Separator } from '../ui/separator';

type PaymentConfirmationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  breakdown: PaymentBreakdown;
  onConfirm: () => Promise<void>;
  isConfirming?: boolean;
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 2,
    }).format(value);
};

export default function PaymentConfirmationModal({ isOpen, onClose, breakdown, onConfirm, isConfirming }: PaymentConfirmationModalProps) {

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
           <div className="flex justify-center">
             <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <ReceiptText className="h-7 w-7" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Confirmar Pago</DialogTitle>
          <DialogDescription className="text-center">
            Revisa el detalle de la transacción antes de confirmar. Este es un pago simulado y no moverá dinero real.
          </DialogDescription>
        </DialogHeader>
        
        <div className="my-4 space-y-2">
            <div className="flex justify-between items-baseline p-3 bg-muted rounded-lg">
                <span className="text-muted-foreground">Pago Total:</span>
                <span className="text-2xl font-bold text-primary">{formatCurrency(breakdown.total)}</span>
            </div>
            <Separator className="my-2" />
            <div className="space-y-1 text-sm p-3">
                 <div className="flex justify-between">
                    <span>Cuota de Tecnología:</span>
                    <span className="font-medium">{formatCurrency(breakdown.technologyFee)}</span>
                 </div>
                 <div className="flex justify-between">
                    <span>Intereses Corrientes:</span>
                    <span className="font-medium">{formatCurrency(breakdown.interest)}</span>
                 </div>
                 <div className="flex justify-between font-bold">
                    <span>Abono a Capital:</span>
                    <span className="">{formatCurrency(breakdown.capital)}</span>
                 </div>
            </div>
        </div>

        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isConfirming}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                </>
            ) : (
                <>
                    <Check className="mr-2 h-4 w-4" />
                    Confirmar y Pagar
                </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

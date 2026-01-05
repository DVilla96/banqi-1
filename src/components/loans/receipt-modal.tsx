'use client';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { BadgeCheck, Receipt, Share2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReceiptModalProps {
    isOpen: boolean;
    onClose: () => void;
    paymentDetails: {
        date: Date;
        amount: number;
        reference: string;
        concept: string;
    } | null;
}

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
    }).format(value);
};

export default function ReceiptModal({ isOpen, onClose, paymentDetails }: ReceiptModalProps) {
    if (!paymentDetails) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="flex flex-col items-center gap-4 pb-4 border-b">
                    <div className="h-16 w-16 bg-emerald-100 rounded-full flex items-center justify-center">
                        <BadgeCheck className="h-8 w-8 text-emerald-600" />
                    </div>
                    <div className="text-center">
                        <DialogTitle className="text-xl font-bold text-center">¡Pago Exitoso!</DialogTitle>
                        <DialogDescription className="text-center mt-2">
                            Comprobante de transacción
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="text-center">
                        <p className="text-muted-foreground text-sm">Monto Pagado</p>
                        <h2 className="text-3xl font-bold mt-1 text-slate-900 dark:text-slate-100">
                            {formatCurrency(paymentDetails.amount)}
                        </h2>
                    </div>

                    <div className="space-y-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Fecha</span>
                            <span className="font-medium">
                                {format(paymentDetails.date, "dd 'de' MMMM, yyyy - HH:mm", { locale: es })}
                            </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Concepto</span>
                            <span className="font-medium">{paymentDetails.concept}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Referencia</span>
                            <span className="font-mono text-xs">{paymentDetails.reference}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">Estado</span>
                            <span className="font-medium text-emerald-600 flex items-center gap-1">
                                <BadgeCheck className="h-3 w-3" /> Aprobado
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button className="flex-1" variant="outline" disabled>
                        <Share2 className="mr-2 h-4 w-4" /> Compartir
                    </Button>
                    <Button className="flex-1" disabled>
                        <Download className="mr-2 h-4 w-4" /> Descargar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

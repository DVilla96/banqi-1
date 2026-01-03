import LoanSimulator from '@/components/request/loan-simulator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SlidersHorizontal } from 'lucide-react';

export default function RequestLoanPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Simula tu Crédito</h1>
        <p className="text-muted-foreground">Ajusta los valores para encontrar el préstamo perfecto para ti.</p>
      </div>
      
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SlidersHorizontal className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>Simulador de Préstamo</CardTitle>
              <CardDescription>Calcula tu cuota mensual y los detalles de tu crédito.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <LoanSimulator />
        </CardContent>
      </Card>
    </div>
  );
}

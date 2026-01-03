
'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Award, Shield, Gem } from 'lucide-react';

// For demonstration purposes, we'll use a hardcoded value.
// In a real app, this would come from a hook or props: useUserInvestment().total;
const currentUserInvestment = 45500000; 

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const tiers = [
  {
    name: 'Bronce',
    icon: Award,
    min: 0,
    max: 9999999,
    commission: 30,
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
  },
  {
    name: 'Plata',
    icon: Shield,
    min: 10000000,
    max: 49999999,
    commission: 25,
    color: 'text-slate-600',
    bgColor: 'bg-slate-200',
  },
  {
    name: 'Oro',
    icon: Gem,
    min: 50000000,
    max: Infinity,
    commission: 20,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-200',
  },
];

const getCurrentTier = (investment: number) => {
  return tiers.find(tier => investment >= tier.min && investment <= tier.max) || tiers[0];
};

export default function IncentiveTiers() {
    const currentTier = getCurrentTier(currentUserInvestment);
    const nextTier = tiers.find(tier => tier.min > currentTier.min);

    const progressToNextTier = nextTier 
        ? Math.max(0, Math.min(100, ((currentUserInvestment - currentTier.min) / (nextTier.min - currentTier.min)) * 100))
        : 100;
        
    const amountToNextTier = nextTier
        ? nextTier.min - currentUserInvestment
        : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nivel de Inversionista</CardTitle>
        <CardDescription>Invierte más para reducir nuestra comisión y aumentar tu rentabilidad.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {tiers.map((tier) => {
          const isActive = currentTier.name === tier.name;
          return (
            <div key={tier.name} className={`rounded-lg border p-3 ${isActive ? 'border-primary ring-2 ring-primary shadow-lg' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex size-8 items-center justify-center rounded-full ${tier.bgColor} ${tier.color}`}>
                    <tier.icon className="h-5 w-5" />
                  </div>
                  <p className={`font-bold ${tier.color}`}>{tier.name}</p>
                </div>
                <Badge variant={isActive ? 'default' : 'secondary'} className={isActive ? 'bg-primary' : ''}>
                    Tu Rentabilidad: {100 - tier.commission}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground pl-11">Invierte {formatCurrency(tier.min)}+</p>
            </div>
          );
        })}
        <div className="pt-2">
            {nextTier ? (
                <>
                    <p className="text-sm font-medium text-center">
                        Te faltan <span className="font-bold text-primary">{formatCurrency(amountToNextTier)}</span> para el nivel {nextTier.name}.
                    </p>
                    <Progress value={progressToNextTier} className="mt-2 h-2" />
                </>
            ) : (
                <p className="text-sm font-bold text-center text-yellow-600">¡Felicidades! Has alcanzado el nivel máximo.</p>
            )}
        </div>
      </CardContent>
    </Card>
  );
}

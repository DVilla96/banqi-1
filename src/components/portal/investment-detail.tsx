

'use client';

import { useMemo, useContext } from 'react';
import type { Investment, Loan, Payment } from '@/lib/types';
import AmortizationTable from '../loans/amortization-table';
import { SimulationContext } from '@/hooks/use-simulation-date';
import { startOfDay, fromUnixTime, differenceInDays } from 'date-fns';

type InvestmentDetailProps = {
    investment: Investment;
    loan: Loan;
    allLoanInvestments: Investment[];
    payments: Payment[];
};

export default function InvestmentDetail({ investment, loan, allLoanInvestments, payments }: InvestmentDetailProps) {
    const { simulationDate } = useContext(SimulationContext);

    const investorParticipation = useMemo(() => {
        if (!loan.interestRate || allLoanInvestments.length === 0) return 0;
        
        const dailyRate = Math.pow(1 + (loan.interestRate / 100), 1 / 30.4167) - 1;
        const sortedInvestments = [...allLoanInvestments].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);
        const focalDate = startOfDay(fromUnixTime(sortedInvestments[0].createdAt.seconds));

        const presentValues = sortedInvestments.map(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
            const daysDiff = differenceInDays(invDate, focalDate);
            const pv = inv.amount / Math.pow(1 + dailyRate, daysDiff);
            return { id: inv.id, pv };
        });
        
        const totalPresentValue = presentValues.reduce((acc, val) => acc + val.pv, 0);
        if (totalPresentValue === 0) return 0;

        const thisInvestorPV = presentValues.find(p => p.id === investment.id)?.pv || 0;
        
        return thisInvestorPV / totalPresentValue;
    }, [allLoanInvestments, loan.interestRate, investment.id]);

    // Only show the amortization table if the loan payment day has been set.
    if (!loan.paymentDay) {
        return null;
    }

    return (
        <div className="space-y-3 text-xs">
            <AmortizationTable
                loan={loan}
                investments={allLoanInvestments}
                payments={payments}
                simulationDate={simulationDate}
                investorId={investment.investorId}
                investmentId={investment.id}
                investorParticipation={investorParticipation}
            />
        </div>
    );
}

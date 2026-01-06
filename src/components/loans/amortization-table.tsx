

'use client';

import { useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Loan, Investment, Payment, AmortizationRow } from '@/lib/types';
import { generatePreciseAmortizationSchedule } from '@/lib/financial-utils';
import { format, parseISO, fromUnixTime, differenceInDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader } from '../ui/card';
import { cn } from '@/lib/utils';
import { BadgeCheck, AlertTriangle, Receipt } from 'lucide-react';


const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 2,
    }).format(value).replace(/\s/g, '');
};

type AmortizationTableProps = {
    loan: Loan;
    investments: Investment[];
    payments: Payment[];
    simulationDate: Date | null;
    investorId?: string;
    investmentId?: string; // ID de la inversión específica que estamos viendo
    investorParticipation?: number;
};

export default function AmortizationTable({ loan, investments, payments, simulationDate, investorId, investmentId, investorParticipation }: AmortizationTableProps) {

    const amortizationDetails = useMemo(() => {
        console.log("[AMORTIZATION_TABLE] Generating general schedule...");
        if (!loan || investments.length === 0 || !loan.paymentDay) {
            return null;
        }
        return generatePreciseAmortizationSchedule(loan, investments, payments, simulationDate);
    }, [loan, investments, payments, simulationDate]);

    const { filteredAndAdaptedSchedule, isProjection } = useMemo(() => {
        if (!amortizationDetails) return { filteredAndAdaptedSchedule: [], isProjection: false };

        const { schedule, isProjection } = amortizationDetails;
        console.log("[AMORTIZATION_TABLE] Original Schedule:", schedule);
        console.log("[AMORTIZATION_TABLE] Investor View Props:", { investorId, investorParticipation });

        if (!investorParticipation || !investorId) {
            return { filteredAndAdaptedSchedule: schedule, isProjection };
        }

        // Si hay un investmentId específico, solo mostrar esa inversión
        // Si no, mostrar todas las inversiones del inversionista
        const thisInvestorInvestments = investmentId
            ? investments.filter(inv => inv.id === investmentId)
            : investments.filter(inv => inv.investorId === investorId);
        if (thisInvestorInvestments.length === 0) return { filteredAndAdaptedSchedule: [], isProjection };

        // Tasa diaria usando la misma fórmula que el Excel
        const monthlyRate = loan.interestRate ? loan.interestRate / 100 : 0.021;
        const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;

        const investorSchedule: AmortizationRow[] = [];

        // Capital inicial del inversionista
        const investorTotalCapital = thisInvestorInvestments.reduce((sum, inv) => sum + inv.amount, 0);
        let investorBalance = investorTotalCapital;

        // Fecha de la inversión (para calcular valor futuro)
        const investmentDate = thisInvestorInvestments.length > 0
            ? startOfDay(fromUnixTime(thisInvestorInvestments[0].createdAt.seconds))
            : new Date();

        thisInvestorInvestments.forEach(investment => {
            investorSchedule.push({
                period: '-',
                date: fromUnixTime(investment.createdAt.seconds).toISOString(),
                type: 'disbursement',
                flow: -investment.amount,
                interest: 0,
                principal: -investment.amount,
                technologyFee: 0,
                balance: investment.amount,
                details: { investmentId: investment.id }
            });
        });

        // Para cada cuota, el interés es el valor futuro del saldo - saldo actual
        let lastPaymentDate = investmentDate;

        schedule.filter(r => r.type === 'payment').forEach((paymentRow, index) => {
            const paymentDate = startOfDay(new Date(paymentRow.date));
            const daysFromInvestment = differenceInDays(paymentDate, lastPaymentDate);

            // El interés es: saldo * ((1 + tasa_diaria)^días - 1)
            const interestForInvestor = investorBalance * (Math.pow(1 + dailyRate, daysFromInvestment) - 1);

            // La cuota del inversionista es proporcional (sin tech fee)
            const totalInstallmentExclTechFee = paymentRow.principal + paymentRow.interest;
            const installmentForInvestor = totalInstallmentExclTechFee * investorParticipation;

            // El capital es: cuota - interés
            const principalForInvestor = installmentForInvestor - interestForInvestor;

            const newBalance = investorBalance - principalForInvestor;

            investorSchedule.push({
                ...paymentRow,
                flow: installmentForInvestor,
                interest: interestForInvestor,
                principal: principalForInvestor,
                technologyFee: 0,
                balance: newBalance < 0.01 ? 0 : newBalance,
            });

            investorBalance = newBalance;
            lastPaymentDate = paymentDate;
        });

        console.log("[AMORTIZATION_TABLE] Final Investor Schedule:", investorSchedule);

        return { filteredAndAdaptedSchedule: investorSchedule, isProjection };

    }, [amortizationDetails, loan.interestRate, investorParticipation, investorId, investmentId, investments]);


    if (!amortizationDetails) {
        return null;
    }

    // Filtrar filas: ocultar cuotas proyectadas después de que el saldo llegue a $0
    const scheduleToShow = useMemo(() => {
        let zeroBalanceReached = false;
        return filteredAndAdaptedSchedule.filter((row) => {
            if (zeroBalanceReached && row.type === 'payment' && !row.isPaid) {
                return false; // Ocultar cuotas no pagadas después de saldo $0
            }
            if (row.balance <= 0 && row.type === 'payment') {
                zeroBalanceReached = true;
            }
            return true;
        });
    }, [filteredAndAdaptedSchedule]);

    const loanCompleted = scheduleToShow.some(row => row.balance <= 0 && row.isPaid);

    return (
        <Card className="overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-950">
            {isProjection && (
                <CardHeader className="p-4 pb-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-800">
                    <p className="text-xs text-center text-amber-700 dark:text-amber-300 italic">
                        ⏳ Este es un plan de pagos proyectado. Las fechas definitivas se confirmarán cuando el préstamo esté 100% fondeado.
                    </p>
                </CardHeader>
            )}
            {loanCompleted && (
                <CardHeader className="p-4 pb-2 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-800">
                    <p className="text-sm text-center text-emerald-700 dark:text-emerald-300 font-medium flex items-center justify-center gap-2">
                        🎉 ¡Préstamo completado! Has saldado tu deuda exitosamente.
                    </p>
                </CardHeader>
            )}
            <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[500px]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead className='text-right'>Cuota</TableHead>
                                {!investorParticipation && <TableHead className='text-right'>Pagado</TableHead>}
                                {investorParticipation ? (
                                    <>
                                        <TableHead className='text-right'>Interés Total</TableHead>
                                        <TableHead className='text-right'>Comisión Banqi (30%)</TableHead>
                                        <TableHead className='text-right'>Interés Banquero (70%)</TableHead>
                                    </>
                                ) : (
                                    <TableHead className='text-right'>Interés</TableHead>
                                )}
                                <TableHead className='text-right'>Capital</TableHead>
                                {!investorParticipation && <TableHead className='text-right'>Tecnología</TableHead>}
                                <TableHead className='text-right'>Saldo</TableHead>
                                <TableHead className='text-right'>Comprobante</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {scheduleToShow.map((row, index) => {
                                // Calcular interés Banqi (30%) e interés neto (70%) para inversionistas
                                const interesBanqi = row.interest * 0.30;
                                const interesNeto = row.interest * 0.70;
                                const hasActualPayment = row.actualPayment && row.actualPayment.amount > 0;
                                const isLastPaidRow = row.balance <= 0 && row.isPaid;

                                return (
                                    <TableRow
                                        key={index}
                                        className={cn('text-xs transition-colors', {
                                            'bg-slate-50 dark:bg-slate-900/50 font-semibold': row.type === 'disbursement' || row.type === 'capitalization',
                                            'bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 font-medium': row.isPaid && !isLastPaidRow,
                                            // Make the last paid row (completion) very celebratory
                                            'bg-gradient-to-r from-emerald-100 to-green-100 dark:from-emerald-900/40 dark:to-green-900/40 text-emerald-900 dark:text-emerald-100 font-bold ring-1 ring-emerald-500/30 shadow-sm': isLastPaidRow,
                                            'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 font-semibold': row.isOverdue,
                                            'bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 font-semibold': row.isNextDue,
                                        })}
                                    >
                                        <TableCell className="font-medium">
                                            <div className='flex items-center gap-2'>
                                                {row.isPaid && <BadgeCheck className='h-4 w-4 text-green-600' />}
                                                {row.isOverdue && <AlertTriangle className='h-4 w-4 text-red-600' />}
                                                {row.date ? format(parseISO(row.date), 'dd/MM/yyyy', { locale: es }) : '-'}
                                            </div>
                                            {row.type === 'payment' && <p className='text-muted-foreground pl-6 text-xs'>Cuota {row.period}</p>}
                                            {row.type === 'disbursement' && <p className='text-muted-foreground pl-6 text-xs'>Desembolso</p>}
                                            {row.type === 'capitalization' && <p className='text-muted-foreground pl-6 text-xs'>Capitalización</p>}
                                            {hasActualPayment && row.actualPayment && (
                                                <p className='text-green-600 pl-6 text-[10px]'>
                                                    Pagado: {format(parseISO(row.actualPayment.date), 'dd/MM/yyyy', { locale: es })}
                                                </p>
                                            )}
                                        </TableCell>
                                        <TableCell className={cn('text-right font-mono font-bold', { 'text-green-600': row.type === 'disbursement' && row.flow < 0, 'text-red-600': row.type === 'payment', 'text-amber-700': row.type === 'capitalization' && row.flow > 0, 'text-gray-500': row.flow === 0 })}>
                                            {row.flow === 0 ? '-' : (row.flow > 0 ? formatCurrency(row.flow) : `-${formatCurrency(Math.abs(row.flow))}`)}
                                        </TableCell>
                                        {!investorParticipation && (
                                            <TableCell className='text-right font-mono text-green-600 font-semibold'>
                                                {hasActualPayment && row.actualPayment ? formatCurrency(row.actualPayment.amount) : '-'}
                                            </TableCell>
                                        )}
                                        {investorParticipation ? (
                                            <>
                                                <TableCell className='text-right font-mono'>
                                                    {row.interest !== 0 ? formatCurrency(row.interest) : '-'}
                                                </TableCell>
                                                <TableCell className='text-right font-mono text-muted-foreground'>
                                                    {row.interest !== 0 ? formatCurrency(interesBanqi) : '-'}
                                                </TableCell>
                                                <TableCell className='text-right font-mono text-green-600 font-semibold'>
                                                    {row.interest !== 0 ? formatCurrency(interesNeto) : '-'}
                                                </TableCell>
                                            </>
                                        ) : (
                                            <TableCell className={cn('text-right font-mono', { 'text-green-600': row.interest < 0 })}>
                                                {hasActualPayment && row.actualPayment
                                                    ? <span className="text-green-600">{formatCurrency(row.actualPayment.interest)}</span>
                                                    : (row.interest !== 0 ? (row.interest > 0 ? formatCurrency(row.interest) : `-${formatCurrency(Math.abs(row.interest))}`) : '-')
                                                }
                                            </TableCell>
                                        )}
                                        <TableCell className={cn('text-right font-mono')}>
                                            {hasActualPayment && row.actualPayment
                                                ? <span className="text-green-600">{formatCurrency(row.actualPayment.capital)}</span>
                                                : (row.principal > 0 ? formatCurrency(row.principal) : (row.principal < 0 ? `-${formatCurrency(Math.abs(row.principal))}` : '-'))
                                            }
                                        </TableCell>
                                        {!investorParticipation && (
                                            <TableCell className='text-right font-mono'>
                                                {hasActualPayment && row.actualPayment
                                                    ? <span className="text-green-600">{formatCurrency(row.actualPayment.technologyFee)}</span>
                                                    : (row.technologyFee > 0 ? formatCurrency(row.technologyFee) : '-')
                                                }
                                            </TableCell>
                                        )}
                                        <TableCell className='text-right font-mono font-semibold'>{formatCurrency(row.balance)}</TableCell>
                                        <TableCell className='text-right'>
                                            {row.isPaid && (
                                                <button className="inline-flex items-center justify-center p-1.5 rounded-full bg-white dark:bg-slate-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/50 hover:scale-105 transition-all shadow-sm border border-emerald-100 dark:border-emerald-800" title="Ver Comprobante">
                                                    <Receipt className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

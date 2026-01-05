

import type { Loan, Investment, Payment, AmortizationRow, PaymentBreakdown } from '@/lib/types';
import { differenceInDays, addMonths, setDate, startOfDay, fromUnixTime, addDays } from 'date-fns';
import { MONTHLY_TECHNOLOGY_FEE } from '@/lib/constants';

const round = (num: number) => Math.round(num * 100) / 100;

/**
 * Calcula el saldo total a pagar (payoff) a una fecha específica usando valor focal.
 * Trae todas las inversiones a valor futuro/presente según corresponda y resta los pagos.
 * El tech fee se calcula desde la última inversión hasta la fecha focal.
 */
export function calculatePayoffBalance(
    loan: Loan,
    investments: Investment[],
    payments: Payment[],
    focalDate: Date,
    schedule?: AmortizationRow[]
): number {
    const today = startOfDay(focalDate);
    const monthlyRate = loan.interestRate / 100;
    const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;
    // Tech fee mensual se convierte a diario: (tarifa_mensual * 12) / 365
    const dailyTechFee = ((loan.technologyFee || MONTHLY_TECHNOLOGY_FEE) * 12) / 365;

    // --- LOGIC VIA SCHEDULE (PREFERRED FOR CONSISTENCY) ---
    if (schedule && schedule.length > 0) {
        // Find the last CONFIRMED event (Disbursement or Paid Payment)
        // We reverse to find the latest one chronologically
        const lastEventRow = [...schedule].reverse().find(row =>
            row.type === 'disbursement' || (row.type === 'payment' && row.isPaid)
        );

        if (lastEventRow) {
            // Determine the date of this last event
            // Use actualPayment.date if available for payments, otherwise row date
            const lastEventDate = lastEventRow.actualPayment?.date
                ? startOfDay(new Date(lastEventRow.actualPayment.date))
                : startOfDay(new Date(lastEventRow.date));

            // Calculate days from that event to today
            const daysToToday = differenceInDays(today, lastEventDate);

            // Base principal is the balance remaining after that event
            const principalBalance = lastEventRow.balance;

            // Calculate accrued interest and tech fees since that event
            const accruedInterest = principalBalance * (Math.pow(1 + dailyRate, Math.max(0, daysToToday)) - 1);
            const accruedTechFee = dailyTechFee * Math.max(0, daysToToday);

            // Total Payoff = Principal + Interest + Tech Fee
            // Note: Late fees are usually handled separately (e.g. added to the displayed total if overdue),
            // but for "Payoff Balance" (capital + interest accrued), this is strictly correct.
            const totalPayoff = principalBalance + accruedInterest + accruedTechFee;

            return round(totalPayoff);
        }
    }

    // --- FALLBACK: VALUE FOCAL METHOD ---
    if (!loan.interestRate || investments.length === 0) return 0;

    // Calcular valor focal de todas las inversiones
    let totalFocalValueInvestments = 0;

    investments.forEach(inv => {
        const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
        const days = differenceInDays(today, invDate);

        if (days >= 0) {
            // Inversión pasada o presente: capitalizar (traer a valor futuro)
            const fv = inv.amount * Math.pow(1 + dailyRate, days);
            totalFocalValueInvestments += fv;
        } else {
            // Inversión futura: descontar (traer a valor presente)
            const pv = inv.amount / Math.pow(1 + dailyRate, Math.abs(days));
            totalFocalValueInvestments += pv;
        }
    });

    // Restar valor focal de los pagos
    let totalFocalValuePayments = 0;

    payments.forEach(payment => {
        const paymentDate = startOfDay(fromUnixTime(payment.paymentDate.seconds));
        const days = differenceInDays(today, paymentDate);

        if (days >= 0) {
            // Pago pasado: capitalizar el capital pagado
            const fv = (payment.capital || 0) * Math.pow(1 + dailyRate, days);
            totalFocalValuePayments += fv;
            // Los intereses pagados se restan directamente
            totalFocalValuePayments += (payment.interest || 0);
        } else {
            // Pago futuro: descontar
            const pv = (payment.capital || 0) / Math.pow(1 + dailyRate, Math.abs(days));
            totalFocalValuePayments += pv;
        }
    });

    // Calcular tech fee desde la ÚLTIMA inversión hasta la fecha focal
    const sortedInvestments = [...investments].sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
    const lastInvestmentDate = startOfDay(fromUnixTime(sortedInvestments[0].createdAt.seconds));
    const daysSinceLastInvestment = differenceInDays(today, lastInvestmentDate);

    const techFee = daysSinceLastInvestment > 0 ? dailyTechFee * daysSinceLastInvestment : 0;

    // Restar tech fee ya pagado en payments
    const techFeePaid = payments.reduce((sum, p) => sum + (p.technologyFee || 0), 0);

    // El payoff es: valor focal inversiones - valor focal pagos + tech fee acumulado - tech fee pagado
    const payoff = totalFocalValueInvestments - totalFocalValuePayments + techFee - techFeePaid;

    return Math.max(0, round(payoff));
}

// This function calculates the interest for the irregular first period.
// It brings all disbursement amounts to their future value on the first payment date.
function getInitialAccruedInterest(investments: Investment[], dailyRate: number, firstPaymentDate: Date): number {
    const totalFutureValue = investments.reduce((acc, inv) => {
        const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
        const days = differenceInDays(firstPaymentDate, invDate);
        if (days < 0) return acc; // Should not happen in a valid loan
        const fv = inv.amount * Math.pow(1 + dailyRate, days);
        return acc + fv;
    }, 0);
    const totalInvestment = investments.reduce((sum, i) => sum + i.amount, 0);
    return totalFutureValue - totalInvestment;
}


/**
 * Calcula la cuota fija total (capital + interés + tech fee) mediante iteración.
 * La cuota TOTAL es fija, y el capital se ajusta para absorber la variación del tech fee.
 * Similar a "Buscar Objetivo" de Excel.
 */
function calculateFixedTotalInstallment(
    initialBalance: number,
    term: number,
    dailyRate: number,
    dailyTechFee: number,
    paymentDates: Date[],
    lastInvestmentDate: Date
): number {
    console.log('=== CALCULANDO CUOTA FIJA ===');
    console.log('Saldo inicial (valor focal):', initialBalance);
    console.log('Plazo:', term, 'meses');
    console.log('Tasa diaria:', dailyRate);
    console.log('Tech fee diario:', dailyTechFee);
    console.log('Fecha última inversión:', lastInvestmentDate.toISOString());
    console.log('Fechas de pago:', paymentDates.map(d => d.toISOString().split('T')[0]));

    // Función que simula el préstamo con una cuota total dada y retorna el saldo final
    const simulateLoan = (totalInstallment: number): number => {
        let balance = initialBalance;
        let lastEventDate = lastInvestmentDate;

        for (let i = 0; i < term; i++) {
            const paymentDate = paymentDates[i];
            const daysInPeriod = differenceInDays(paymentDate, lastEventDate);

            // Interés del período
            const interest = balance * (Math.pow(1 + dailyRate, daysInPeriod) - 1);

            // Tech fee del período (variable según días)
            const techFee = dailyTechFee * daysInPeriod;

            // Capital = Cuota Total - Interés - Tech Fee
            const principal = totalInstallment - interest - techFee;

            // NO ajustar última cuota - queremos ver el saldo real
            balance = balance - principal;
            lastEventDate = paymentDate;
        }

        return balance;
    };

    // Método de bisección para encontrar la cuota total correcta
    let low = initialBalance / term; // Cuota mínima
    let high = (initialBalance / term) * 3; // Cuota máxima estimada
    let mid = (low + high) / 2;

    const tolerance = 0.01; // Tolerancia de $0.01
    const maxIterations = 100;

    for (let iter = 0; iter < maxIterations; iter++) {
        mid = (low + high) / 2;
        const finalBalance = simulateLoan(mid);

        if (Math.abs(finalBalance) < tolerance) {
            console.log('Cuota encontrada en iteración:', iter, '- Cuota:', mid, '- Saldo final:', finalBalance);
            break;
        }

        if (finalBalance > 0) {
            low = mid;
        } else {
            high = mid;
        }
    }

    console.log('=== CUOTA FIJA CALCULADA:', mid, '===');
    return mid; // NO redondear - usar precisión completa como Excel
}


function determineFirstPaymentDate(investments: Investment[], paymentDay: number): Date {
    if (investments.length === 0) {
        let firstPaymentDate = setDate(new Date(), paymentDay);
        if (firstPaymentDate <= new Date()) {
            firstPaymentDate = addMonths(firstPaymentDate, 1);
        }
        return startOfDay(firstPaymentDate);
    }
    const sortedInvestments = [...investments].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);
    const lastDisbursementDate = startOfDay(fromUnixTime(sortedInvestments[sortedInvestments.length - 1].createdAt.seconds));

    let firstPaymentDate = setDate(lastDisbursementDate, paymentDay);

    // If the calculated payment date is less than 15 days from the last disbursement, move to the next month
    if (differenceInDays(firstPaymentDate, lastDisbursementDate) < 15) {
        firstPaymentDate = addMonths(firstPaymentDate, 1);
    } else if (firstPaymentDate <= lastDisbursementDate) { // Or if it's on or before, move to next month
        firstPaymentDate = addMonths(firstPaymentDate, 1);
    }

    return startOfDay(firstPaymentDate);
}


export function generatePreciseAmortizationSchedule(loan: Loan, investments: Investment[], payments: Payment[], simulationDate: Date | null): { schedule: AmortizationRow[], isProjection: boolean } | null {
    if (!loan.interestRate || !loan.term || investments.length === 0 || !loan.paymentDay) {
        return null;
    }

    const isProjection = loan.status !== 'repayment-active' && loan.status !== 'repayment-overdue' && loan.status !== 'completed';
    const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

    const monthlyRate = loan.interestRate / 100;
    // Fórmula Excel: (1 + tasa_mensual)^(12/365) - 1
    const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;
    const dailyTechnologyFee = ((loan.technologyFee || MONTHLY_TECHNOLOGY_FEE) * 12) / 365;

    const schedule: AmortizationRow[] = [];
    const sortedInvestments = [...investments].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);

    // Fecha focal = fecha de la última inversión
    const lastInvestmentDate = startOfDay(fromUnixTime(sortedInvestments[sortedInvestments.length - 1].createdAt.seconds));

    // Agrupar inversiones por fecha (mismo día = una sola fila)
    const investmentsByDate = new Map<string, { date: Date, totalAmount: number, investments: Investment[] }>();

    sortedInvestments.forEach((investment) => {
        const invDate = startOfDay(fromUnixTime(investment.createdAt.seconds));
        const dateKey = invDate.toISOString();

        if (investmentsByDate.has(dateKey)) {
            const existing = investmentsByDate.get(dateKey)!;
            existing.totalAmount += investment.amount;
            existing.investments.push(investment);
        } else {
            investmentsByDate.set(dateKey, {
                date: invDate,
                totalAmount: investment.amount,
                investments: [investment]
            });
        }
    });

    // Convertir a array ordenado por fecha
    const groupedInvestments = Array.from(investmentsByDate.values()).sort(
        (a, b) => a.date.getTime() - b.date.getTime()
    );

    // MÉTODO: Desembolsos solo muestran capital
    // El interés se calcula como valor futuro al día de la primera cuota - capital original
    let simpleCapitalBalance = 0; // Solo capital acumulado (para mostrar en desembolsos)

    groupedInvestments.forEach((group) => {
        // El saldo mostrado es solo capital acumulado
        simpleCapitalBalance += group.totalAmount;

        schedule.push({
            period: '-',
            date: group.date.toISOString(),
            type: 'disbursement',
            flow: -group.totalAmount,
            interest: 0, // No mostrar interés en desembolsos
            principal: -group.totalAmount,
            technologyFee: 0,
            balance: simpleCapitalBalance, // Solo capital, sin interés
            details: { investmentId: group.investments[0].id }
        });
    });

    console.log('=== Capital puro acumulado:', simpleCapitalBalance, '===');

    const paymentDay = loan.paymentDay;
    const firstPaymentDate = determineFirstPaymentDate(sortedInvestments, paymentDay);

    // Generar todas las fechas de pago primero
    const paymentDates: Date[] = [];
    for (let i = 0; i < loan.term; i++) {
        paymentDates.push(startOfDay(addMonths(firstPaymentDate, i)));
    }

    // --- PREPARACIÓN DE PAGOS ---
    // Ordenar pagos por fecha
    const sortedPayments = [...payments].sort((a, b) => {
        const dateA = a.paymentDate?.seconds ? a.paymentDate.seconds : 0;
        const dateB = b.paymentDate?.seconds ? b.paymentDate.seconds : 0;
        return dateA - dateB;
    });

    // Agrupar pagos por periodo usando las fechas calculadas
    const paymentsPerPeriod: Map<number, Payment[]> = new Map();
    sortedPayments.forEach(payment => {
        if (!payment.paymentDate?.seconds) return;
        const paymentDate = startOfDay(fromUnixTime(payment.paymentDate.seconds));

        // Encontrar a qué período pertenece este pago
        for (let i = 0; i < paymentDates.length; i++) {
            const currentDueDate = paymentDates[i];
            const previousDueDate = i === 0
                ? lastInvestmentDate
                : paymentDates[i - 1];

            // El pago pertenece a este período si está después de la cuota anterior y hasta la cuota actual
            if (paymentDate > previousDueDate && paymentDate <= currentDueDate) {
                const periodNum = i + 1;
                if (!paymentsPerPeriod.has(periodNum)) {
                    paymentsPerPeriod.set(periodNum, []);
                }
                paymentsPerPeriod.get(periodNum)!.push(payment);
                break;
            }

            // Si es después de la última cuota programada, asignarlo a la última
            if (i === paymentDates.length - 1 && paymentDate > currentDueDate) {
                const periodNum = i + 1;
                if (!paymentsPerPeriod.has(periodNum)) {
                    paymentsPerPeriod.set(periodNum, []);
                }
                paymentsPerPeriod.get(periodNum)!.push(payment);
            }
        }
    });


    // --- CÁLCULO INICIAL PROYECTADO ---
    // Calcular el valor futuro de cada inversión al día de la PRIMERA CUOTA
    const firstPaymentDateValue = paymentDates[0];
    let totalFutureValueAtFirstPayment = 0;

    groupedInvestments.forEach((group) => {
        const daysToFirstPayment = differenceInDays(firstPaymentDateValue, group.date);
        const futureValue = group.totalAmount * Math.pow(1 + dailyRate, daysToFirstPayment);
        totalFutureValueAtFirstPayment += futureValue;
    });

    // El interés de la cuota 1 es la diferencia entre el valor futuro y el capital original
    const interestForFirstInstallment = totalFutureValueAtFirstPayment - simpleCapitalBalance;

    // Para las cuotas, el saldo inicial es el capital puro
    let currentBalance = simpleCapitalBalance;

    // Calcular cuota TOTAL fija inicial mediante iteración (Valor Focal)
    let totalFocalBalance = 0;
    groupedInvestments.forEach((group) => {
        const daysToFocal = differenceInDays(lastInvestmentDate, group.date);
        const focalValue = group.totalAmount * Math.pow(1 + dailyRate, daysToFocal);
        totalFocalBalance += focalValue;
    });

    // Estado de la iteración
    let currentFixedInstallment = calculateFixedTotalInstallment(
        totalFocalBalance,
        loan.term,
        dailyRate,
        dailyTechnologyFee,
        paymentDates,
        lastInvestmentDate
    );

    let lastEventDate = lastInvestmentDate;
    let firstUnpaidFound = false;

    console.log('=== GENERANDO SCHEDULE DINÁMICO ===');

    for (let i = 0; i < loan.term; i++) {
        const paymentDate = paymentDates[i];
        const periodNum = i + 1;
        const actualPayments = paymentsPerPeriod.get(periodNum);

        // -- CÁLCULO TEÓRICO PARA ESTE PERIODO (lo que debería ser) --
        // Nota: Si hubo pago parcial, esto puede diferir, pero para proyección
        // usamos la cuota fija vigente.

        let interestForPeriod: number;
        let daysInPeriod = differenceInDays(paymentDate, lastEventDate);

        // Si es el primer periodo y NO hemos recalculado (es decir, estamos al inicio),
        // usamos el cálculo especial de interés inicial.
        // PERO si venimos de un recálculo (i > 0), simple interés compuesto.
        if (i === 0) {
            interestForPeriod = interestForFirstInstallment;
        } else {
            interestForPeriod = currentBalance * (Math.pow(1 + dailyRate, daysInPeriod) - 1);
        }

        const techFeeForPeriod = dailyTechnologyFee * daysInPeriod;

        // Verificar si hay pagos REALES
        if (actualPayments && actualPayments.length > 0) {
            // -- FASE 1: PROCESAR PAGOS REALES INDIVIDUALES --
            // Ordenar por fecha para procesar en orden cronológico
            const sortedPeriodPayments = [...actualPayments].sort((a, b) => a.paymentDate.seconds - b.paymentDate.seconds);

            let lastPaymentDate = lastEventDate;

            // Generar una fila por CADA pago real
            sortedPeriodPayments.forEach((p, index) => {
                const thisPaymentDate = startOfDay(fromUnixTime(p.paymentDate.seconds));
                const pAmount = p.amount;
                const pCapital = p.capital || 0;
                const pInterest = p.interest || 0;
                const pTech = p.technologyFee || 0;
                const pLate = p.lateFee || 0;

                // Actualizar Saldo con lo REALMENTE pagado a capital en este pago específico
                currentBalance = currentBalance - pCapital;

                schedule.push({
                    period: `${periodNum}`, // Misma cuota para todos
                    date: thisPaymentDate.toISOString(),
                    type: 'payment',
                    flow: round(pAmount),
                    interest: round(pInterest),
                    principal: round(pCapital),
                    technologyFee: round(pTech),
                    balance: currentBalance < 0.01 ? 0 : round(currentBalance),
                    isPaid: true,
                    isOverdue: false,
                    isNextDue: false,
                    actualPayment: { // Detalle individual
                        date: thisPaymentDate.toISOString(),
                        amount: pAmount,
                        capital: pCapital,
                        interest: pInterest,
                        technologyFee: pTech,
                        lateFee: pLate
                    }
                });

                lastPaymentDate = thisPaymentDate;
            });


            // -- FASE 2: RECALCULAR LA CUOTA FUTURA --
            // Si queda deuda y quedan periodos, recalculamos para que se pague en el tiempo restante
            // Usamos el saldo final y la fecha del ULTIMO pago de este periodo
            const remainingPeriods = loan.term - periodNum;
            if (currentBalance > 1 && remainingPeriods > 0) {
                console.log(`[RECALCULO] Periodo ${periodNum} tuvo ${sortedPeriodPayments.length} pagos. Recalculando cuota para los siguientes ${remainingPeriods} periodos. Saldo actual: ${currentBalance}`);

                // Usamos la fecha del último pago real como nuevo punto de partida (fecha focal)
                // para el cálculo de los siguientes periodos.
                currentFixedInstallment = calculateFixedTotalInstallment(
                    currentBalance, // Nuevo saldo inicial
                    remainingPeriods, // Nuevo plazo
                    dailyRate,
                    dailyTechnologyFee,
                    paymentDates.slice(periodNum), // Próximas fechas de pago
                    lastPaymentDate // Anclamos al último pago real
                );

                // Actualizamos lastEventDate para el siguiente loop para que el cálculo de días sea correcto
                lastEventDate = lastPaymentDate;
            } else {
                lastEventDate = lastPaymentDate;
            }

        } else { // -- NO HAY PAGO REAL (PROYECCIÓN) --

            // Capital = Cuota Total Fija - Interés - Tech Fee
            let principalPart = currentFixedInstallment - interestForPeriod - techFeeForPeriod;

            // Ajuste última cuota
            if (i === loan.term - 1) {
                principalPart = currentBalance;
            }

            const totalPaymentForPeriod = (i === loan.term - 1)
                ? principalPart + interestForPeriod + techFeeForPeriod
                : currentFixedInstallment;

            const balanceBefore = currentBalance;
            const newBalance = currentBalance - principalPart;
            currentBalance = newBalance;

            // Determinar flags de estado
            const isOverdue = today > paymentDate;
            let isNextDue = false;
            if (!isOverdue && !firstUnpaidFound) {
                isNextDue = true;
                firstUnpaidFound = true;
            }

            schedule.push({
                period: `${periodNum}`,
                date: paymentDate.toISOString(),
                type: 'payment',
                flow: round(totalPaymentForPeriod),
                interest: round(interestForPeriod),
                principal: round(principalPart),
                technologyFee: round(techFeeForPeriod),
                balance: currentBalance < 0.01 ? 0 : round(currentBalance),
                isPaid: false,
                isOverdue,
                isNextDue
            });

            // Para el siguiente periodo, contamos desde esta fecha de corte
            lastEventDate = paymentDate;
        }
    }

    return { schedule: schedule, isProjection };
}


export function calculatePrecisePaymentBreakdown(
    totalPaymentAmount: number,
    schedule: AmortizationRow[],
    loan: Loan,
    simulationDate: Date | null,
    investments?: Investment[]
): PaymentBreakdown {
    const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());

    // Find the next unpaid payment row in the schedule
    const nextPaymentRow = schedule.find(row => row.type === 'payment' && !row.isPaid);

    if (!nextPaymentRow) {
        // No pending payments, return all as capital
        return { capital: totalPaymentAmount, interest: 0, technologyFee: 0, lateFee: 0, total: totalPaymentAmount, paymentDate: today.toISOString() };
    }

    const paymentDueDate = startOfDay(new Date(nextPaymentRow.date));

    // Calcular valores prorrateados basados en la fecha actual
    const monthlyRate = loan.interestRate / 100;
    const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;
    const dailyTechnologyFee = (loan.technologyFee || MONTHLY_TECHNOLOGY_FEE) * 12 / 365;

    // Determine if this is the first payment (no previous payments have been made)
    const isFirstPayment = !schedule.some(row => row.type === 'payment' && row.isPaid);

    let interestToToday: number;
    let techFeeToToday: number;

    if (isFirstPayment && investments && investments.length > 0) {
        // For the first payment, calculate future value of each investment to TODAY
        // Use the same logic as generatePreciseAmortizationSchedule - use createdAt.seconds with fromUnixTime
        const sortedInvestments = [...investments].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds);
        const groupedInvestments = new Map<string, { date: Date; totalAmount: number }>();

        sortedInvestments.forEach(inv => {
            const invDate = startOfDay(fromUnixTime(inv.createdAt.seconds));
            const dateKey = invDate.toISOString();

            if (groupedInvestments.has(dateKey)) {
                const existing = groupedInvestments.get(dateKey)!;
                existing.totalAmount += inv.amount;
            } else {
                groupedInvestments.set(dateKey, { date: invDate, totalAmount: inv.amount });
            }
        });

        // Last investment date (same as in generatePreciseAmortizationSchedule)
        const latestInvestmentDate = startOfDay(fromUnixTime(sortedInvestments[sortedInvestments.length - 1].createdAt.seconds));

        let totalFutureValueToToday = 0;
        let totalCapital = 0;

        groupedInvestments.forEach((group) => {
            const daysToToday = differenceInDays(today, group.date);
            const futureValue = group.totalAmount * Math.pow(1 + dailyRate, Math.max(0, daysToToday));
            totalFutureValueToToday += futureValue;
            totalCapital += group.totalAmount;
        });

        interestToToday = totalFutureValueToToday - totalCapital;
        const daysFromLastInvestment = differenceInDays(today, latestInvestmentDate);
        techFeeToToday = dailyTechnologyFee * daysFromLastInvestment;

    } else {
        // For subsequent payments, find the last paid payment
        let lastEventRow: AmortizationRow | undefined;
        const paymentIndex = schedule.indexOf(nextPaymentRow);

        for (let i = paymentIndex - 1; i >= 0; i--) {
            const row = schedule[i];
            if (row.type === 'payment' && row.isPaid) {
                lastEventRow = row;
                break;
            }
        }

        if (!lastEventRow) {
            lastEventRow = [...schedule].reverse().find(row => row.type === 'disbursement');
        }

        if (!lastEventRow) {
            return { capital: totalPaymentAmount, interest: 0, technologyFee: 0, lateFee: 0, total: totalPaymentAmount };
        }

        const lastEventDate = lastEventRow.actualPayment?.date
            ? startOfDay(new Date(lastEventRow.actualPayment.date))
            : startOfDay(new Date(lastEventRow.date));
        const daysToToday = differenceInDays(today, lastEventDate);
        const balanceAtLastEvent = lastEventRow.balance;

        interestToToday = balanceAtLastEvent * (Math.pow(1 + dailyRate, daysToToday) - 1);
        techFeeToToday = dailyTechnologyFee * daysToToday;
    }

    // El pago seleccionado por el usuario
    const selectedPayment = totalPaymentAmount;

    // Orden de prioridad: 1) Tech Fee, 2) Intereses, 3) Capital
    // El pago primero cubre tech fee, luego intereses, y el resto va a capital

    let actualTechFee: number;
    let actualInterest: number;
    let actualCapital: number;

    if (selectedPayment <= techFeeToToday) {
        // El pago solo alcanza para cubrir parte o todo el tech fee
        actualTechFee = selectedPayment;
        actualInterest = 0;
        actualCapital = 0;
    } else if (selectedPayment <= techFeeToToday + interestToToday) {
        // El pago cubre todo el tech fee y parte de los intereses
        actualTechFee = techFeeToToday;
        actualInterest = selectedPayment - techFeeToToday;
        actualCapital = 0;
    } else {
        // El pago cubre tech fee, intereses, y algo de capital
        actualTechFee = techFeeToToday;
        actualInterest = interestToToday;
        actualCapital = selectedPayment - techFeeToToday - interestToToday;
    }

    return {
        capital: round(Math.max(0, actualCapital)),
        interest: round(actualInterest),
        technologyFee: round(actualTechFee),
        lateFee: 0,
        total: round(selectedPayment),
        paymentDate: today.toISOString(),
        period: nextPaymentRow ? parseInt(nextPaymentRow.period) : undefined
    };
}

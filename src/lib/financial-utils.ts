

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

    // --- SIEMPRE USAR VALOR FOCAL PARA PRECISIÓN ---
    // El método del schedule no funciona bien con múltiples inversiones en diferentes fechas
    // porque el balance del disbursement solo muestra capital, no los intereses acumulados
    
    if (!loan.interestRate || investments.length === 0) return 0;

    // Calcular valor focal de todas las inversiones (cada una capitalizada a la fecha focal)
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

    // Restar valor focal de los pagos (capital capitalizado + intereses pagados)
    let totalFocalValuePayments = 0;

    payments.forEach(payment => {
        const paymentDate = startOfDay(fromUnixTime(payment.paymentDate.seconds));
        const days = differenceInDays(today, paymentDate);

        if (days >= 0) {
            // Pago pasado: capitalizar el capital pagado
            const fv = (payment.capital || 0) * Math.pow(1 + dailyRate, days);
            totalFocalValuePayments += fv;
            // Los intereses pagados se restan directamente (ya fueron "consumidos")
            totalFocalValuePayments += (payment.interest || 0);
        } else {
            // Pago futuro: descontar
            const pv = (payment.capital || 0) / Math.pow(1 + dailyRate, Math.abs(days));
            totalFocalValuePayments += pv;
        }
    });

    // Tech fee: un solo cargo diario por el crédito, desde la ÚLTIMA inversión
    const sortedInvestments = [...investments].sort((a, b) => b.createdAt.seconds - a.createdAt.seconds);
    const lastInvestmentDate = startOfDay(fromUnixTime(sortedInvestments[0].createdAt.seconds));
    const daysSinceLastInvestment = Math.max(0, differenceInDays(today, lastInvestmentDate));
    const totalTechFee = dailyTechFee * daysSinceLastInvestment;

    // Restar tech fee ya pagado en payments
    const techFeePaid = payments.reduce((sum, p) => sum + (p.technologyFee || 0), 0);

    // El payoff es: valor focal inversiones - valor focal pagos + tech fee acumulado - tech fee pagado
    const payoff = totalFocalValueInvestments - totalFocalValuePayments + totalTechFee - techFeePaid;

    console.log('[PAYOFF] Focal calculation:', {
        focalDate: today.toISOString(),
        investments: investments.map(i => ({ amount: i.amount, date: fromUnixTime(i.createdAt.seconds).toISOString() })),
        totalFocalValueInvestments: round(totalFocalValueInvestments),
        totalFocalValuePayments: round(totalFocalValuePayments),
        totalTechFee: round(totalTechFee),
        techFeePaid: round(techFeePaid),
        payoff: round(payoff)
    });

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

    // NUEVO ENFOQUE: Generar schedule cronológicamente como el Excel
    // 1. Crear una lista de TODOS los eventos (fechas de vencimiento + pagos reales)
    // 2. Procesar en orden cronológico
    // 3. Mostrar cuotas vencidas como $0, pagos donde ocurrieron, y proyecciones futuras
    
    type ScheduleEvent = {
        date: Date;
        type: 'due-date' | 'payment';
        periodNum?: number;
        payment?: Payment;
    };
    
    const events: ScheduleEvent[] = [];
    
    // Agregar todas las fechas de vencimiento
    paymentDates.forEach((date, i) => {
        events.push({ date, type: 'due-date', periodNum: i + 1 });
    });
    
    // Agregar todos los pagos reales
    sortedPayments.forEach(payment => {
        if (payment.paymentDate?.seconds) {
            events.push({
                date: startOfDay(fromUnixTime(payment.paymentDate.seconds)),
                type: 'payment',
                payment
            });
        }
    });
    
    // Ordenar por fecha
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    console.log('[EVENTS] Lista de eventos ordenados:');
    events.forEach(e => {
        if (e.type === 'due-date') {
            console.log(`  DUE: ${e.date.toISOString().split('T')[0]} - Periodo ${e.periodNum}`);
        } else {
            console.log(`  PAY: ${e.date.toISOString().split('T')[0]} - $${e.payment?.amount}`);
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

    // --- NUEVO ENFOQUE: PROCESAR EVENTOS CRONOLÓGICAMENTE COMO EL EXCEL ---
    // Agrupar pagos por fecha (consolidar pagos del mismo día)
    const paymentsByDate = new Map<string, Payment[]>();
    sortedPayments.forEach(p => {
        if (!p.paymentDate?.seconds) return;
        const dateKey = startOfDay(fromUnixTime(p.paymentDate.seconds)).toISOString();
        if (!paymentsByDate.has(dateKey)) {
            paymentsByDate.set(dateKey, []);
        }
        paymentsByDate.get(dateKey)!.push(p);
    });
    
    let lastEventDate = lastInvestmentDate;
    let paymentIndex = 0; // Índice del siguiente pago a procesar
    let periodNum = 0; // Contador de cuotas mostradas
    let firstUnpaidFound = false;
    
    // Calcular cuota fija inicial
    let currentFixedInstallment = calculateFixedTotalInstallment(
        totalFocalBalance,
        loan.term,
        dailyRate,
        dailyTechnologyFee,
        paymentDates,
        lastInvestmentDate
    );
    
    console.log('=== GENERANDO SCHEDULE COMO EXCEL ===');
    console.log('Capital inicial:', simpleCapitalBalance);
    console.log('Total focal balance:', totalFocalBalance);
    console.log('Cuota fija inicial:', currentFixedInstallment);
    console.log('Pagos disponibles:', sortedPayments.length);
    console.log('Fechas de vencimiento:', paymentDates.map(d => d.toISOString().split('T')[0]));
    console.log('lastInvestmentDate:', lastInvestmentDate.toISOString().split('T')[0]);
    
    // --- NUEVO ENFOQUE: Siempre 12 cuotas, pagos agrupados por periodo ---
    // Cada periodo va desde el día después del vencimiento anterior hasta el vencimiento actual
    // Todos los pagos dentro de ese rango se consolidan en una sola fila
    
    // Primero, asignar todos los pagos a sus periodos correspondientes
    const paymentsPerPeriod = new Map<number, Payment[]>();
    for (let i = 1; i <= loan.term; i++) {
        paymentsPerPeriod.set(i, []);
    }
    
    // Asignar cada pago al periodo que corresponde
    sortedPayments.forEach(p => {
        const pDate = startOfDay(fromUnixTime(p.paymentDate.seconds));
        
        // Encontrar a qué periodo pertenece este pago
        // El pago pertenece al periodo N si: fechaVencimiento(N-1) < fechaPago <= fechaVencimiento(N)
        for (let i = 0; i < paymentDates.length; i++) {
            const periodNum = i + 1;
            const dueDate = paymentDates[i];
            const prevDueDate = i > 0 ? paymentDates[i - 1] : lastInvestmentDate;
            
            if (pDate > prevDueDate && pDate <= dueDate) {
                paymentsPerPeriod.get(periodNum)!.push(p);
                break;
            }
            
            // Si el pago es después de la última fecha de vencimiento, va al último periodo
            if (i === paymentDates.length - 1 && pDate > dueDate) {
                paymentsPerPeriod.get(periodNum)!.push(p);
            }
        }
    });
    
    console.log('[SCHEDULE] Pagos por periodo:');
    paymentsPerPeriod.forEach((payments, period) => {
        if (payments.length > 0) {
            const total = payments.reduce((sum, p) => sum + p.amount, 0);
            console.log(`  Periodo ${period}: ${payments.length} pagos, total $${total.toFixed(2)}`);
        }
    });
    
    let firstUnpaidPeriodFound = false;
    
    // Procesar cada periodo (siempre 12 cuotas)
    for (let i = 0; i < loan.term; i++) {
        const periodNum = i + 1;
        const dueDate = paymentDates[i];
        const periodPayments = paymentsPerPeriod.get(periodNum) || [];
        
        // Calcular proyección teórica para este periodo
        const daysInPeriod = differenceInDays(dueDate, lastEventDate);
        const projectedInterest = currentBalance * (Math.pow(1 + dailyRate, daysInPeriod) - 1);
        const projectedTechFee = dailyTechnologyFee * daysInPeriod;
        let projectedCapital = currentFixedInstallment - projectedInterest - projectedTechFee;
        
        // Ajuste última cuota
        if (periodNum === loan.term || currentBalance - projectedCapital < 1) {
            projectedCapital = currentBalance;
        }
        
        const projectedTotal = projectedCapital + projectedInterest + projectedTechFee;
        
        const isOverdue = today > dueDate;
        
        if (periodPayments.length > 0) {
            // HAY PAGOS en este periodo - consolidar todos
            let totalAmount = 0, totalCapital = 0, totalInterest = 0, totalTech = 0, totalLate = 0;
            const receiptUrls: string[] = [];
            let latestPaymentDate = new Date(0);
            
            periodPayments.forEach(p => {
                totalAmount += p.amount;
                totalCapital += p.capital || 0;
                totalInterest += p.interest || 0;
                totalTech += p.technologyFee || 0;
                totalLate += p.lateFee || 0;
                if (p.receiptUrl) receiptUrls.push(p.receiptUrl);
                
                const pDate = startOfDay(fromUnixTime(p.paymentDate.seconds));
                if (pDate > latestPaymentDate) {
                    latestPaymentDate = pDate;
                }
            });
            
            currentBalance = currentBalance - totalCapital;
            
            // El periodo está "pagado" si el total pagado >= proyección teórica
            // O si ya pasó la fecha de vencimiento y hay algún pago
            const isPeriodFullyPaid = totalAmount >= projectedTotal * 0.95 || isOverdue; // 95% margen
            
            schedule.push({
                period: `${periodNum}`,
                date: latestPaymentDate.toISOString(), // Fecha del último pago
                type: 'payment',
                flow: round(totalAmount),
                interest: round(totalInterest),
                principal: round(totalCapital),
                technologyFee: round(totalTech),
                balance: currentBalance < 0.01 ? 0 : round(currentBalance),
                isPaid: true,
                isOverdue: false,
                isNextDue: false,
                actualPayment: {
                    date: latestPaymentDate.toISOString(),
                    amount: totalAmount,
                    capital: totalCapital,
                    interest: totalInterest,
                    technologyFee: totalTech,
                    lateFee: totalLate,
                    receiptUrl: receiptUrls.length > 0 ? receiptUrls.join(',') : undefined,
                    paymentCount: periodPayments.length
                }
            });
            
            lastEventDate = latestPaymentDate;
            
            // Recalcular cuota fija para los periodos restantes
            const remainingPeriods = loan.term - periodNum;
            if (currentBalance > 1 && remainingPeriods > 0) {
                currentFixedInstallment = calculateFixedTotalInstallment(
                    currentBalance,
                    remainingPeriods,
                    dailyRate,
                    dailyTechnologyFee,
                    paymentDates.slice(periodNum),
                    lastEventDate
                );
                console.log(`[PERIODO ${periodNum}] Pagos: $${totalAmount.toFixed(2)}, Nueva cuota: $${currentFixedInstallment.toFixed(2)}, Saldo: $${currentBalance.toFixed(2)}`);
            }
            
        } else {
            // NO HAY PAGOS en este periodo
            if (isOverdue) {
                // Cuota vencida sin pago
                schedule.push({
                    period: `${periodNum}`,
                    date: dueDate.toISOString(),
                    type: 'payment',
                    flow: 0,
                    interest: 0,
                    principal: 0,
                    technologyFee: 0,
                    balance: round(currentBalance),
                    isPaid: false,
                    isOverdue: true,
                    isNextDue: false
                });
                // NO actualizar lastEventDate para cuotas vencidas sin pago
            } else {
                // Cuota futura - proyectar
                let isNextDue = false;
                if (!firstUnpaidPeriodFound) {
                    isNextDue = true;
                    firstUnpaidPeriodFound = true;
                }
                
                const newBalance = currentBalance - projectedCapital;
                
                schedule.push({
                    period: `${periodNum}`,
                    date: dueDate.toISOString(),
                    type: 'payment',
                    flow: round(projectedTotal),
                    interest: round(projectedInterest),
                    principal: round(projectedCapital),
                    technologyFee: round(projectedTechFee),
                    balance: newBalance < 0.01 ? 0 : round(newBalance),
                    isPaid: false,
                    isOverdue: false,
                    isNextDue
                });
                
                currentBalance = newBalance;
                lastEventDate = dueDate;
            }
        }
        
        // Si el saldo llegó a 0, terminar
        if (currentBalance < 1) {
            // Rellenar periodos restantes con saldo 0 si es necesario
            for (let j = i + 1; j < loan.term; j++) {
                schedule.push({
                    period: `${j + 1}`,
                    date: paymentDates[j].toISOString(),
                    type: 'payment',
                    flow: 0,
                    interest: 0,
                    principal: 0,
                    technologyFee: 0,
                    balance: 0,
                    isPaid: true,
                    isOverdue: false,
                    isNextDue: false
                });
            }
            break;
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

    // DEBUG: Log all payment rows and their isPaid status
    const paymentRows = schedule.filter(row => row.type === 'payment');
    console.log('[BREAKDOWN] All payment rows DETAILED:');
    paymentRows.forEach((r, i) => {
        console.log(`  Row ${i}: period=${r.period}, isPaid=${r.isPaid}, hasActualPayment=${!!r.actualPayment}, date=${r.date}`);
    });

    // Find the next unpaid payment row in the schedule
    const nextPaymentRow = schedule.find(row => row.type === 'payment' && !row.isPaid);
    
    console.log('[BREAKDOWN] nextPaymentRow found:', nextPaymentRow ? {
        period: nextPaymentRow.period,
        isPaid: nextPaymentRow.isPaid,
        date: nextPaymentRow.date
    } : 'NONE');

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
        // For subsequent payments, find the last ACTUAL paid payment in the ENTIRE schedule
        // Not just before the nextPaymentRow, but anywhere in the schedule
        let lastEventRow: AmortizationRow | undefined;

        console.log('[BREAKDOWN] Looking for last paid payment in entire schedule');

        // Search ALL payment rows for the most recent one with actualPayment
        const allPaidPayments = schedule.filter(row => 
            row.type === 'payment' && row.actualPayment && row.actualPayment.amount > 0
        );
        
        if (allPaidPayments.length > 0) {
            // Get the last one (most recent payment)
            lastEventRow = allPaidPayments[allPaidPayments.length - 1];
            console.log('[BREAKDOWN] Found last actual payment:', {
                period: lastEventRow.period,
                date: lastEventRow.actualPayment?.date,
                balance: lastEventRow.balance
            });
        }

        if (!lastEventRow) {
            // No paid payment found, look for the last disbursement
            lastEventRow = [...schedule].reverse().find(row => row.type === 'disbursement');
            console.log('[BREAKDOWN] No paid payment found, using disbursement:', lastEventRow?.date);
        }

        if (!lastEventRow) {
            return { capital: totalPaymentAmount, interest: 0, technologyFee: 0, lateFee: 0, total: totalPaymentAmount };
        }

        // Use actualPayment date if available (real payment date), otherwise row date
        const lastEventDate = lastEventRow.actualPayment?.date
            ? startOfDay(new Date(lastEventRow.actualPayment.date))
            : startOfDay(new Date(lastEventRow.date));
        const daysToToday = differenceInDays(today, lastEventDate);
        const balanceAtLastEvent = lastEventRow.balance;

        console.log('[BREAKDOWN] Last event date:', lastEventDate.toISOString());
        console.log('[BREAKDOWN] Today:', today.toISOString());
        console.log('[BREAKDOWN] Days to today:', daysToToday);
        console.log('[BREAKDOWN] Balance at last event:', balanceAtLastEvent);
        console.log('[BREAKDOWN] Daily rate:', dailyRate);
        console.log('[BREAKDOWN] Daily tech fee:', dailyTechnologyFee);

        interestToToday = balanceAtLastEvent * (Math.pow(1 + dailyRate, daysToToday) - 1);
        techFeeToToday = dailyTechnologyFee * daysToToday;

        console.log('[BREAKDOWN] Interest calculated:', interestToToday);
        console.log('[BREAKDOWN] Tech fee calculated:', techFeeToToday);
        console.log('[BREAKDOWN] Interest formula: ', balanceAtLastEvent, '* ((1 +', dailyRate, ')^', daysToToday, '- 1) =', interestToToday);
    }

    // El pago seleccionado por el usuario
    const selectedPayment = totalPaymentAmount;

    // Orden de prioridad según Excel: 1) Intereses, 2) Tech Fee, 3) Capital
    // El pago primero cubre intereses, luego tech fee, y el resto va a capital

    let actualTechFee: number;
    let actualInterest: number;
    let actualCapital: number;

    if (selectedPayment <= interestToToday) {
        // El pago solo alcanza para cubrir parte o todo el interés
        actualInterest = selectedPayment;
        actualTechFee = 0;
        actualCapital = 0;
    } else if (selectedPayment <= interestToToday + techFeeToToday) {
        // El pago cubre todo el interés y parte del tech fee
        actualInterest = interestToToday;
        actualTechFee = selectedPayment - interestToToday;
        actualCapital = 0;
    } else {
        // El pago cubre intereses, tech fee, y algo de capital
        actualInterest = interestToToday;
        actualTechFee = techFeeToToday;
        actualCapital = selectedPayment - interestToToday - techFeeToToday;
    }

    // Determine the actual payment number (how many payments have been made + 1)
    // This is more reliable than using nextPaymentRow.period because overdue payments
    // can leave old rows with isPaid: false
    const paidPaymentsCount = schedule.filter(row => 
        row.type === 'payment' && row.actualPayment && row.actualPayment.amount > 0
    ).length;
    const currentPaymentNumber = paidPaymentsCount + 1;
    
    console.log('[BREAKDOWN] Paid payments count:', paidPaymentsCount, '-> Current payment number:', currentPaymentNumber);

    return {
        capital: round(Math.max(0, actualCapital)),
        interest: round(actualInterest),
        technologyFee: round(actualTechFee),
        lateFee: 0,
        total: round(selectedPayment),
        paymentDate: today.toISOString(),
        period: currentPaymentNumber
    };
}

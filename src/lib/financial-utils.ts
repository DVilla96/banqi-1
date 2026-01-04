

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
    focalDate: Date
): number {
    if (!loan.interestRate || investments.length === 0) return 0;
    
    const monthlyRate = loan.interestRate / 100;
    // Fórmula Excel: (1 + tasa_mensual)^(12/365) - 1
    const dailyRate = Math.pow(1 + monthlyRate, 12 / 365) - 1;
    const today = startOfDay(focalDate);
    
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
    
    // Tech fee mensual se convierte a diario: (tarifa_mensual * 12) / 365
    const dailyTechFee = ((loan.technologyFee || MONTHLY_TECHNOLOGY_FEE) * 12) / 365;
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
    
    // Calcular el valor futuro de cada inversión al día de la PRIMERA CUOTA
    // El interés de la cuota 1 = Valor Futuro total - Capital original
    const firstPaymentDateValue = paymentDates[0];
    let totalFutureValueAtFirstPayment = 0;
    
    groupedInvestments.forEach((group) => {
        const daysToFirstPayment = differenceInDays(firstPaymentDateValue, group.date);
        const futureValue = group.totalAmount * Math.pow(1 + dailyRate, daysToFirstPayment);
        totalFutureValueAtFirstPayment += futureValue;
    });
    
    // El interés de la cuota 1 es la diferencia entre el valor futuro y el capital original
    const interestForFirstInstallment = totalFutureValueAtFirstPayment - simpleCapitalBalance;
    
    console.log('=== Valor futuro al día de cuota 1:', totalFutureValueAtFirstPayment, '===');
    console.log('=== Interés para cuota 1:', interestForFirstInstallment, '===');
    
    // Para las cuotas, el saldo inicial es el capital puro
    let currentBalance = simpleCapitalBalance;
    
    // Calcular cuota TOTAL fija mediante iteración
    // Usamos el valor futuro al día de la ÚLTIMA INVERSIÓN (fecha focal) como saldo inicial para el cálculo de la cuota
    // Esto mantiene la cuota igual que antes ($156,659.87)
    let totalFocalBalance = 0;
    groupedInvestments.forEach((group) => {
        const daysToFocal = differenceInDays(lastInvestmentDate, group.date);
        const focalValue = group.totalAmount * Math.pow(1 + dailyRate, daysToFocal);
        totalFocalBalance += focalValue;
    });
    
    const fixedTotalInstallment = calculateFixedTotalInstallment(
        totalFocalBalance, // Valor focal para cálculo de cuota (como antes)
        loan.term,
        dailyRate,
        dailyTechnologyFee,
        paymentDates,
        lastInvestmentDate
    );

    let lastEventDate = lastInvestmentDate;
    
    console.log('=== GENERANDO SCHEDULE ===');
    console.log('Capital puro:', simpleCapitalBalance);
    console.log('Valor focal (última inversión):', totalFocalBalance);
    console.log('Valor futuro al día cuota 1:', totalFutureValueAtFirstPayment);
    console.log('Interés para cuota 1:', interestForFirstInstallment);
    console.log('Cuota fija:', fixedTotalInstallment);
    
    for (let i = 0; i < loan.term; i++) {
        const paymentDate = paymentDates[i];
        const daysInPeriod = differenceInDays(paymentDate, lastEventDate);
        
        // Interés del período
        let interestForPeriod: number;
        
        if (i === 0) {
            // Primera cuota: el interés es el valor futuro total - capital original
            interestForPeriod = interestForFirstInstallment;
        } else {
            // Demás cuotas: interés sobre el saldo actual
            interestForPeriod = currentBalance * (Math.pow(1 + dailyRate, daysInPeriod) - 1);
        }
        
        // Tech fee proporcional a días (NO capitalizable)
        const techFeeForPeriod = dailyTechnologyFee * daysInPeriod;
        
        // Capital = Cuota Total Fija - Interés - Tech Fee
        let principalPart = fixedTotalInstallment - interestForPeriod - techFeeForPeriod;
        
        // Última cuota: ajustar para saldar completamente
        if (i === loan.term - 1) {
            principalPart = currentBalance;
        }
        
        // Cuota total es FIJA
        const totalPaymentForPeriod = (i === loan.term - 1) 
            ? principalPart + interestForPeriod + techFeeForPeriod  // Última cuota puede variar
            : fixedTotalInstallment;

        const newBalance = currentBalance - principalPart;
        
        console.log(`Cuota ${i+1}: Días=${daysInPeriod}, SaldoAntes=${currentBalance}, Interés=${interestForPeriod}, TechFee=${techFeeForPeriod}, Capital=${principalPart}, CuotaTotal=${totalPaymentForPeriod}, SaldoDespués=${newBalance}`);
         
        schedule.push({
            period: `${i + 1}`,
            date: paymentDate.toISOString(),
            type: 'payment',
            flow: round(totalPaymentForPeriod),
            interest: round(interestForPeriod),
            principal: round(principalPart),
            technologyFee: round(techFeeForPeriod),
            balance: newBalance < 0.01 ? 0 : round(newBalance),
        });
        
        currentBalance = newBalance;
        lastEventDate = paymentDate;
    }


    const today = simulationDate ? startOfDay(simulationDate) : startOfDay(new Date());
    let firstUnpaidFound = false;
    
    // Ordenar pagos por fecha
    const sortedPayments = [...payments].sort((a, b) => {
        const dateA = a.paymentDate?.seconds ? a.paymentDate.seconds : 0;
        const dateB = b.paymentDate?.seconds ? b.paymentDate.seconds : 0;
        return dateA - dateB;
    });
    
    // Asociar pagos a cada período de cuota
    // Un pago pertenece a la cuota N si su fecha está entre la fecha de cuota N-1 y la fecha de cuota N
    const paymentSchedule = schedule.filter(row => row.type === 'payment');
    const paymentsPerPeriod: Map<number, Payment[]> = new Map();
    
    sortedPayments.forEach(payment => {
        if (!payment.paymentDate?.seconds) return;
        const paymentDate = startOfDay(fromUnixTime(payment.paymentDate.seconds));
        
        // Encontrar a qué período pertenece este pago
        for (let i = 0; i < paymentSchedule.length; i++) {
            const currentDueDate = startOfDay(new Date(paymentSchedule[i].date));
            const previousDueDate = i === 0 
                ? startOfDay(fromUnixTime(investments[investments.length - 1]?.createdAt?.seconds || 0))
                : startOfDay(new Date(paymentSchedule[i - 1].date));
            
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
            if (i === paymentSchedule.length - 1 && paymentDate > currentDueDate) {
                const periodNum = i + 1;
                if (!paymentsPerPeriod.has(periodNum)) {
                    paymentsPerPeriod.set(periodNum, []);
                }
                paymentsPerPeriod.get(periodNum)!.push(payment);
            }
        }
    });

    // Calcular saldo real basándose en pagos reales
    let realBalance = simpleCapitalBalance;
    
    const finalSchedule = schedule.map(row => {
        if (row.type !== 'payment') return row;

        const periodNum = parseInt(row.period);
        const dueDate = startOfDay(new Date(row.date));
        const periodPayments = paymentsPerPeriod.get(periodNum) || [];
        
        // Sumar todos los pagos de este período
        const actualPaymentData = periodPayments.length > 0 ? {
            date: fromUnixTime(periodPayments[0].paymentDate.seconds).toISOString(),
            amount: periodPayments.reduce((sum, p) => sum + p.amount, 0),
            capital: periodPayments.reduce((sum, p) => sum + (p.capital || 0), 0),
            interest: periodPayments.reduce((sum, p) => sum + (p.interest || 0), 0),
            technologyFee: periodPayments.reduce((sum, p) => sum + (p.technologyFee || 0), 0),
            lateFee: periodPayments.reduce((sum, p) => sum + (p.lateFee || 0), 0),
        } : undefined;
        
        const isPaid = actualPaymentData && actualPaymentData.amount > 0;
        const isOverdue = !isPaid && today > dueDate;
        let isNextDue = false;
        if (!isPaid && !isOverdue && !firstUnpaidFound) {
            isNextDue = true;
            firstUnpaidFound = true;
        }

        // Si hay pago real, actualizar el saldo con el capital real pagado
        if (actualPaymentData) {
            realBalance = realBalance - actualPaymentData.capital;
        }

        return { 
            ...row, 
            isPaid, 
            isOverdue, 
            isNextDue,
            actualPayment: actualPaymentData,
            // Si hay pago real, mostrar el saldo real
            balance: actualPaymentData ? round(Math.max(0, realBalance)) : row.balance,
        };
    });
    
    return { schedule: finalSchedule, isProjection };
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
        
        const lastEventDate = startOfDay(new Date(lastEventRow.date));
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
        paymentDate: today.toISOString()
    };
}

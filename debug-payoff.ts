
import { calculatePayoffBalance } from './src/lib/financial-utils';
import { Loan, Investment, Payment } from './src/lib/types';
import { Timestamp } from 'firebase/firestore';

const mockLoan: Loan = {
    id: 'loan-123',
    amount: 500000, // Assuming from screenshot context
    interestRate: 3.5, // Check screenshot/user context if available, otherwise guess typical
    term: 3,
    paymentDay: 3,
    technologyFee: 8000,
    status: 'repayment-overdue',
    createdAt: Timestamp.now(), // Irrelevant for payoff calc logic usually
    requesterId: 'user-1',
};

// Mock investments - need dates to match screenshot scenario
// Screenshot shows "Fecha de pago es el 3 de cada mes", "Próxima fecha 03 de abril 2026"
// Sim Date: 03/04/2026.
// Start date must be ~3 months prior? Terms 3 months usually.
// Let's assume start date Jan 3 2026 for investments.

const investmentDate = new Date('2026-01-03T12:00:00');
const investments: Investment[] = [
    {
        id: 'inv-1',
        loanId: 'loan-123',
        amount: 250000,
        createdAt: Timestamp.fromDate(investmentDate),
        investorId: 'inv-1',
        status: 'confirmed'
    },
    {
        id: 'inv-2',
        loanId: 'loan-123',
        amount: 250000,
        createdAt: Timestamp.fromDate(investmentDate),
        investorId: 'inv-2',
        status: 'confirmed'
    }
];

const payments: Payment[] = []; // No payments yet based on "Saldo total" being high? Or maybe some?
// Sado total 278,191.10. Initial amount 500k.
// Maybe some payments were made?
// Or is it a smaller loan?
// Wait, "Cuota $37.598".
// If total balance is 278k, and it's "completed" soon?
// Maybe the loan amount in screenshot is NOT 500k.
// Screenshot says "Confirmado $453.364 de $500.000" in prev screenshot.
// But this view says "Saldo total $278.191,10".

// Let's rely on the user claiming max to pay is 277.675 vs 278.191.
// Difference ~516.

const simulationDate = new Date('2026-04-03T00:00:00'); // From screenshot

console.log("Simulating Payoff Calculation...");
const payoff = calculatePayoffBalance(mockLoan, investments, payments, simulationDate);
console.log(`Calculated Payoff: ${payoff}`);

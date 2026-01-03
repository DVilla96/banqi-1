

import type { LucideIcon } from "lucide-react";

export type NavLink = {
  href: string;
  label: string;
  icon?: LucideIcon;
};

export type Loan = {
  id: string;
  purpose: string;
  amount: number;
  interestRate: number;
  term: number; // in months
  riskGrade: "A" | "B" | "C" | "D" | "E";
  status: 'pending' | 'approved' | 'funded' | 'rejected' | 'rejected-docs' | 'pre-approved' | 'pending-review' | 'withdrawn' | 'funding-active' | 'repayment-active' | 'repayment-overdue' | 'completed';
  fundedPercentage: number;
  committedPercentage: number;
  fundingOrder?: number;
  paymentDay?: number;
  disbursementFee?: number;
  technologyFee?: number;
  dataAiHint?: string;
  
  requesterId?: string; 
  requesterFirstName?: string;
  requesterLastName?: string;
  requesterEmail?: string;
  requesterPhotoUrl?: string;
  dateOfBirth?: string;
  employerName?: string;
  position?: string;
  startDate?: string;
  workCertificateUrl?: string;
  bankCertificateUrl?: string;
  signatureUrl?: string;
  documentUrls?: any;

  bankName?: string;
  accountType?: string;
  accountNumber?: string;
};

export type ReinvestmentSource = {
  investorId: string;
  amount: number;
};

export type Investment = {
  id: string;
  loanId: string;
  investorId?: string; 
  borrowerId: string;
  amount: number; 
  status: 'pending-confirmation' | 'confirmed' | 'disputed' | 'rejected_by_admin';
  paymentProofUrl: string;
  paymentProofContentType?: string;
  createdAt: any; 
  confirmedAt?: any;
  payerId?: string; 
  payingLoanId?: string; 
  isRepayment?: boolean; 
  sourceBreakdown?: ReinvestmentSource[];
  paymentBreakdown?: Omit<PaymentBreakdown, 'details'>;
};

export type Payment = {
    id: string;
    loanId: string;
    payerId: string;
    paymentDate: any; // Timestamp
    amount: number;
    capital: number;
    interest: number;
    technologyFee: number;
    lateFee: number;
}

export type ChartData = {
  month: string;
  investment: number;
  returns: number;
};

export type OverviewCard = {
  title: string;
  value: string;
  change: string;
  icon: "trendingUp" | "target" | "landmark" | "shieldCheck";
};

export type PaymentBreakdown = {
    capital: number;
    interest: number;
    technologyFee: number;
    lateFee: number;
    total: number;
    paymentDate?: string; // ISO date string of the payment date used for calculations
    details?: any; // Keeping this for potential future use if needed
};

export type AmortizationRow = {
  period: string;
  date: string;
  type: 'disbursement' | 'payment' | 'capitalization';
  flow: number;
  interest: number;
  principal: number;
  technologyFee: number;
  balance: number;
  isPaid?: boolean;
  isOverdue?: boolean;
  isNextDue?: boolean;
  details?: any;
};

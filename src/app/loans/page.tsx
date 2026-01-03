import LoanListings from '@/components/loans/loan-listings';

export default function LoansPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Listado de Préstamos</h1>
        <p className="text-muted-foreground">Explora e invierte en préstamos peer-to-peer aprobados.</p>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <LoanListings />
      </div>
    </div>
  );
}

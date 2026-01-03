
'use client';

import { useState, useEffect } from 'react';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import type { Investment, Loan } from '@/lib/types';
import InvestmentCard from '@/components/dashboard/investment-card';
import { SimulationProvider } from '@/hooks/use-simulation-date';

type EnrichedInvestment = Investment & {
  loan?: Loan & UserProfile;
};

function MyInvestmentsContent() {
  const { user } = useAuth();
  const [investments, setInvestments] = useState<EnrichedInvestment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'investments'),
      where('investorId', '==', user.uid),
      where('isRepayment', '!=', true),
      where('status', '==', 'confirmed')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const enrichedInvestments: EnrichedInvestment[] = [];
      for (const investmentDoc of snapshot.docs) {
        const data = investmentDoc.data() as Omit<Investment, 'id'>;
        let enrichedData: EnrichedInvestment = { id: investmentDoc.id, ...data };

        try {
          if (data.loanId) {
            const loanRef = doc(db, 'loanRequests', data.loanId);
            const loanSnap = await getDoc(loanRef);
            if (loanSnap.exists()) {
              const loanData = { id: loanSnap.id, ...(loanSnap.data() as Loan) };
              
              if (loanData.requesterId) {
                const borrowerRef = doc(db, 'users', loanData.requesterId);
                const borrowerSnap = await getDoc(borrowerRef);
                
                if (borrowerSnap.exists()) {
                  const borrowerData = borrowerSnap.data() as UserProfile;
                  loanData.requesterFirstName = borrowerData.firstName;
                  loanData.requesterLastName = borrowerData.lastName;
                  loanData.requesterPhotoUrl = borrowerData.photoUrl;
                  loanData.dateOfBirth = borrowerData.dateOfBirth;
                  loanData.requesterEmail = borrowerData.email;
                  loanData.employerName = borrowerData.employerName;
                  loanData.position = borrowerData.position;
                  loanData.startDate = borrowerData.startDate;

                  const fullLoanDoc = await getDoc(loanRef);
                  if (fullLoanDoc.exists()) {
                      loanData.workCertificateUrl = fullLoanDoc.data().documentUrls?.workCertificate?.url;
                      loanData.bankCertificateUrl = fullLoanDoc.data().documentUrls?.bankCertificate?.url;
                  }
                }
              }
              enrichedData.loan = loanData;
            }
          }
        } catch (error) { console.error("Error enriching investment:", error); }
        
        enrichedInvestments.push(enrichedData);
      }

      setInvestments(enrichedInvestments);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching investments:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-60">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-muted-foreground">Cargando tus inversiones...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
       <div>
        <h1 className="text-3xl font-bold tracking-tight">Mis Inversiones</h1>
        <p className="text-muted-foreground">Aquí está el detalle de todos los préstamos en los que has invertido.</p>
      </div>
      {investments.length > 0 ? (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {investments.map((investment) => (
             investment.loan ? <InvestmentCard key={investment.id} investment={investment} /> : null
          ))}
        </div>
      ) : (
        <div className="text-center py-10">
          <h3 className="text-xl font-semibold">Aún no tienes inversiones</h3>
          <p className="text-muted-foreground">
            Explora las oportunidades de préstamo y empieza a construir tu cartera.
          </p>
          <Button asChild className="mt-4">
            <Link href="/loans">Ver Préstamos</Link>
          </Button>
        </div>
      )}
    </div>
  );
}


export default function MyInvestmentsPage() {
  return (
    <SimulationProvider>
      <MyInvestmentsContent />
    </SimulationProvider>
  )
}

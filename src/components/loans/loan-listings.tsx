
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit, doc, getDoc, collectionGroup } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import LoanCard from './loan-card';
import { Loan } from '@/lib/types';
import { UserProfile } from '@/hooks/use-auth';

type EnrichedLoan = Loan & UserProfile & { 
    workCertificateUrl?: string,
    bankCertificateUrl?: string,
};

export default function LoanListings() {
  const [approvedLoans, setApprovedLoans] = useState<EnrichedLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [fundingQueueSize, setFundingQueueSize] = useState(3);

  useEffect(() => {
    const fetchConfigAndLoans = async () => {
      console.log("LOAN_LISTINGS: Starting fetchConfigAndLoans...");
      setLoading(true);
      
      try {
        const configRef = doc(db, 'settings', 'platformConfig');
        const configSnap = await getDoc(configRef);
        const queueSize = configSnap.exists() ? configSnap.data().fundingQueueSize || 3 : 3;
        setFundingQueueSize(queueSize);
        console.log(`LOAN_LISTINGS: Funding queue size set to ${queueSize}`);

        const q = query(
          collection(db, 'loanRequests'),
          where('status', '==', 'funding-active'),
          orderBy('fundingOrder', 'asc'),
          limit(queueSize)
        );
        console.log("LOAN_LISTINGS: Query created. Setting up Firestore listener for approved loans...");

        const unsubscribe = onSnapshot(q, async (querySnapshot) => {
          console.log(`LOAN_LISTINGS: Snapshot received. Found ${querySnapshot.docs.length} approved loan documents.`);
          const loans: Loan[] = [];
          querySnapshot.forEach((doc) => {
            loans.push({ id: doc.id, ...(doc.data() as Omit<Loan, 'id'>) });
          });
          
          console.log(`LOAN_LISTINGS: Found ${loans.length} loans. Now enriching with user data...`);
          if (loans.length === 0) {
            setApprovedLoans([]);
            setLoading(false);
            return;
          }

          const enrichedLoansPromises = loans.map(async (loan) => {
            if (!loan.requesterId) {
                console.warn(`LOAN_LISTINGS: Loan ${loan.id} is missing a requesterId. Skipping enrichment.`);
                return loan as EnrichedLoan;
            }
            
            try {
              console.log(`LOAN_LISTINGS: Enriching loan ${loan.id}. Fetching user profile for requesterId ${loan.requesterId}...`);
              const userRef = doc(db, 'users', loan.requesterId);
              const userSnap = await getDoc(userRef);
              
              const loanRef = doc(db, 'loanRequests', loan.id);
              const loanSnap = await getDoc(loanRef);
              const loanData = loanSnap.data();

              if (userSnap.exists()) {
                const userData = userSnap.data() as UserProfile;
                console.log(`LOAN_LISTINGS: User profile found for ${loan.requesterId}:`, userData);
                
                const enrichedLoan: EnrichedLoan = {
                  ...loan,
                  requesterFirstName: userData.firstName,
                  requesterLastName: userData.lastName,
                  requesterEmail: userData.email,
                  requesterPhotoUrl: userData.photoUrl,
                  dateOfBirth: userData.dateOfBirth,
                  employerName: userData.employerName,
                  position: userData.position,
                  startDate: userData.startDate,
                  workCertificateUrl: loanData?.documentUrls?.workCertificate?.url,
                  bankCertificateUrl: loanData?.documentUrls?.bankCertificate?.url,
                  // Add bank details needed for investment
                  bankName: userData.bankName,
                  accountType: userData.accountType,
                  accountNumber: userData.accountNumber,
                };
                 console.log(`LOAN_LISTINGS: Successfully enriched loan ${loan.id}. Final object:`, enrichedLoan);
                 return enrichedLoan;
              } else {
                 console.warn(`LOAN_LISTINGS: WARNING - No user profile document found for requesterId ${loan.requesterId}`);
              }
            } catch (enrichError) {
                console.error(`LOAN_LISTINGS: Error enriching loan ${loan.id}:`, enrichError);
            }
            return loan as EnrichedLoan; // Return loan even if enrichment fails to not break the whole list
          });
          
          const resolvedLoans = (await Promise.all(enrichedLoansPromises)).filter(Boolean) as EnrichedLoan[];
          console.log("LOAN_LISTINGS: All loans enriched. Final list:", resolvedLoans);
          setApprovedLoans(resolvedLoans);
          setLoading(false);
        }, (error) => {
          console.error("LOAN_LISTINGS: FATAL ERROR in onSnapshot listener for loanRequests:", error);
          setLoading(false);
        });

        return () => {
          console.log("LOAN_LISTINGS: Unsubscribing from Firestore listener.");
          unsubscribe();
        }
      } catch (error) {
          console.error("LOAN_LISTINGS: FATAL ERROR in fetchConfigAndLoans:", error);
          setLoading(false);
      }
    };

    fetchConfigAndLoans();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-60">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-4 text-muted-foreground">Cargando oportunidades...</p>
      </div>
    );
  }

  if (approvedLoans.length === 0) {
      return (
        <div className="text-center py-10">
            <h3 className="text-xl font-semibold">No hay préstamos para fondear</h3>
            <p className="text-muted-foreground">Vuelve más tarde para ver nuevas oportunidades de inversión.</p>
        </div>
      )
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      {approvedLoans.map((loan) => (
        <LoanCard key={loan.id} loan={loan} />
      ))}
    </div>
  );
}

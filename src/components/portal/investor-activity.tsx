

'use client';

import React from 'react';
import { useState, useEffect, useContext } from 'react';
import { useAuth, UserProfile } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, getDoc, doc, orderBy, limit, deleteDoc } from 'firebase/firestore';
import type { Investment, Loan } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Handshake, AlertTriangle, Eye, Trash2 } from 'lucide-react';
import Link from 'next/link';
import InvestmentDetailModal from './investment-detail-modal';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { SimulationContext } from '@/hooks/use-simulation-date';


type EnrichedInvestment = Investment & {
    loan?: Loan & UserProfile;
};

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const getStatusBadge = (status: Investment['status']) => {
    switch (status) {
        case 'confirmed':
            return <Badge className="bg-green-100 text-green-800 border-green-200">Confirmado</Badge>;
        case 'pending-confirmation':
            return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pendiente</Badge>;
        case 'disputed':
            return <Badge variant="destructive">En Disputa</Badge>;
        case 'rejected_by_admin':
            return <Badge variant="destructive">Rechazado</Badge>;
        default:
            return <Badge variant="secondary">{status}</Badge>;
    }
};

export default function InvestorActivity() {
    const { user } = useAuth();
    const [investments, setInvestments] = useState<EnrichedInvestment[]>([]);
    const [disputedInvestment, setDisputedInvestment] = useState<EnrichedInvestment | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedInvestment, setSelectedInvestment] = useState<EnrichedInvestment | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'investments'),
            where('investorId', '==', user.uid),
            orderBy('createdAt', 'desc'),
            limit(10) // Fetch more to find disputes and regular investments
        );

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            const allRecentInvestments: EnrichedInvestment[] = [];
            for (const investmentDoc of snapshot.docs) {
                const data = investmentDoc.data() as Omit<Investment, 'id'>;
                let enrichedData: EnrichedInvestment = { id: investmentDoc.id, ...data };
                
                try {
                    if (data.loanId) {
                        const loanRef = doc(db, 'loanRequests', data.loanId);
                        const loanSnap = await getDoc(loanRef);
                        if (loanSnap.exists()) {
                            const loanData = { id: loanSnap.id, ...(loanSnap.data() as Loan) };
                            
                            // Enrich with borrower data
                            if (loanData.requesterId) {
                                const borrowerRef = doc(db, 'users', loanData.requesterId);
                                const borrowerSnap = await getDoc(borrowerRef);
                                
                                if (borrowerSnap.exists()) {
                                    const borrowerData = borrowerSnap.data() as UserProfile;
                                    loanData.requesterFirstName = borrowerData.firstName;
                                    loanData.requesterLastName = borrowerData.lastName;
                                    loanData.requesterPhotoUrl = borrowerData.photoUrl;
                                    // Pass all loan data needed by modal
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
                
                allRecentInvestments.push(enrichedData);
            }

            const firstDispute = allRecentInvestments.find(inv => inv.status === 'disputed' && inv.isRepayment !== true) || null;
            
            setDisputedInvestment(firstDispute);
            
            if (!firstDispute) {
                const regularInvestments = allRecentInvestments.filter(inv => inv.isRepayment !== true).slice(0, 3);
                setInvestments(regularInvestments);
            }
            
            setLoading(false);

        }, (error) => {
            console.error("Error fetching investments:", error);
            setLoading(false);
        });

        // Cleanup function
        return () => unsubscribe();

    }, [user]);

    const handleDeleteInvestment = async (investmentId: string) => {
        try {
            await deleteDoc(doc(db, 'investments', investmentId));
            toast({
                title: 'Inversión eliminada',
                description: 'La inversión rechazada ha sido eliminada de tu lista.',
            });
        } catch (error) {
            console.error('Error deleting investment:', error);
            toast({
                title: 'Error',
                description: 'No se pudo eliminar la inversión.',
                variant: 'destructive',
            });
        }
    };


    if (loading) {
        return <Loader2 className="h-8 w-8 animate-spin text-primary" />;
    }
    
    const borrowerName = (loan?: Loan) => {
        if (!loan) return 'Deudor';
        const firstName = (loan.requesterFirstName || '').split(' ')[0] || '';
        const lastName = (loan.requesterLastName || '').split(' ')[0] || '';
        const fullName = `${firstName} ${lastName}`.trim();
    
        return fullName.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    }


    if (disputedInvestment) {
        return (
            <div className='w-full'>
                <CardHeader className="p-0 mb-4 text-center">
                    <div className="mx-auto bg-destructive/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                        <AlertTriangle className="h-10 w-10 text-destructive" />
                    </div>
                    <CardTitle className="text-2xl mt-4">Pago en disputa</CardTitle>
                </CardHeader>
                <CardContent className="p-0 w-full">
                    <p className='text-center text-sm text-muted-foreground mb-4'>
                        Hemos pausado la posibilidad de hacer nuevas inversiones mientras nuestro equipo revisa un pago en disputa.
                    </p>
                </CardContent>
            </div>
        )
    }

    if (investments.length === 0) {
        return (
            <>
                <CardHeader className="p-0 mb-4 text-center">
                     <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                        <Handshake className="h-10 w-10 text-primary" />
                    </div>
                    <CardTitle className="text-2xl mt-4">Soy banquero</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
                        <Link href="/loans">Ver préstamos</Link>
                    </Button>
                </CardContent>
            </>
        );
    }

    return (
        <>
            <div className='w-full'>
                <CardHeader className="p-0 mb-4 text-center">
                    <div className="mx-auto bg-primary/10 rounded-full p-4 w-20 h-20 flex items-center justify-center">
                        <Handshake className="h-10 w-10 text-primary" />
                    </div>
                    <CardTitle className="text-2xl mt-4">Soy banquero</CardTitle>
                </CardHeader>
                <CardContent className="p-0 w-full">
                    <div className="w-full space-y-2">
                        {investments.map((investment) => {
                           const investmentDate = (() => {
                                if (!investment.createdAt?.seconds) {
                                    return 'Fecha no disponible';
                                }
                                const date = new Date(investment.createdAt.seconds * 1000);
                                const adjustedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60000);
                                return format(adjustedDate, 'dd MMM yyyy', { locale: es });
                            })();

                            const isRejected = investment.status === 'rejected_by_admin';

                            return (
                                <div key={investment.id} className="p-3 bg-background rounded-lg border flex items-center justify-between gap-4">
                                    <div className='flex-1 space-y-1 text-left'>
                                        <p className="font-semibold text-sm leading-tight">{borrowerName(investment.loan)}</p>
                                        <div>
                                            <p className="text-muted-foreground font-semibold text-sm leading-tight">{formatCurrency(investment.amount)}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {investmentDate}
                                            </p>
                                        </div>
                                    </div>
                                    <div className='flex items-center gap-2'>
                                        {getStatusBadge(investment.status)}
                                        {investment.loan && investment.status === 'confirmed' && (
                                            <Button variant="ghost" size="icon" className='h-8 w-8 text-muted-foreground hover:text-primary' onClick={() => setSelectedInvestment(investment)}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                        )}
                                        {isRejected && (
                                            <Button variant="ghost" size="icon" className='h-8 w-8 text-destructive hover:bg-destructive/10' onClick={() => handleDeleteInvestment(investment.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
                <CardFooter className="p-0 pt-6 justify-center">
                    <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
                        <Link href="/loans">Ver más préstamos</Link>
                    </Button>
                </CardFooter>
            </div>
             {selectedInvestment && selectedInvestment.loan && (
                <InvestmentDetailModal
                    isOpen={!!selectedInvestment}
                    onClose={() => setSelectedInvestment(null)}
                    investment={selectedInvestment}
                    loan={selectedInvestment.loan}
                />
            )}
        </>
    );
}

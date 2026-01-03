
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, DocumentData, orderBy, getDocs, doc, updateDoc, where, getCountFromServer } from 'firebase/firestore';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import EvaluationModal from './evaluation-modal';
import ReviewModal from './review-modal';
import { useToast } from '@/hooks/use-toast';
import { ExtractedData } from './review-modal';
import DisputeModal from './dispute-modal';

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleString('es-CO', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

type UserData = {
    [uid: string]: {
        firstName: string;
        lastName: string;
        email: string;
        phoneNumber?: string;
    }
}

export type LoanRequest = DocumentData & {
    id: string;
    userName?: string;
    userEmail?: string;
    userPhoneNumber?: string;
    hasDisputedInvestments?: boolean;
}

export default function LoanRequestsTable() {
  const [loanRequests, setLoanRequests] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<LoanRequest | null>(null);
  const [isEvaluationModalOpen, setIsEvaluationModalOpen] = useState(false);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const q = query(collection(db, 'loanRequests'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, async (querySnapshot) => {
      const requests: DocumentData[] = [];
      querySnapshot.forEach((doc) => {
        requests.push({ id: doc.id, ...doc.data() });
      });

      const userIds = [...new Set(requests.map(req => req.requesterId))].filter(Boolean);
      const users: UserData = {};
      
      if (userIds.length > 0) {
        try {
            const userDocsQuery = query(collection(db, 'users'), where('uid', 'in', userIds));
            const usersSnapshot = await getDocs(userDocsQuery);
            usersSnapshot.forEach(doc => {
                const userData = doc.data();
                users[doc.id] = {
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    email: userData.email,
                    phoneNumber: userData.phoneNumber,
                }
            });
        } catch (error) {
            console.error("Error fetching user documents for enrichment:", error);
        }
      }

      // Check for disputed investments for each loan request
      const enrichedRequestsPromises = requests.map(async (req) => {
          let hasDisputedInvestments = false;
          try {
              const investmentsQuery = query(collection(db, 'investments'), where('loanId', '==', req.id), where('status', '==', 'disputed'));
              const investmentsSnapshot = await getCountFromServer(investmentsQuery);
              if (investmentsSnapshot.data().count > 0) {
                  hasDisputedInvestments = true;
              }
          } catch (error) {
              console.error(`Error checking for disputed investments on loan ${req.id}:`, error);
          }

          return {
              ...req,
              id: req.id,
              userName: users[req.requesterId] ? `${users[req.requesterId].firstName} ${users[req.requesterId].lastName}` : 'N/A',
              userEmail: users[req.requesterId] ? users[req.requesterId].email : 'N/A',
              userPhoneNumber: users[req.requesterId] ? users[req.requesterId].phoneNumber : 'N/A',
              hasDisputedInvestments
          };
      });

      const enrichedRequests = await Promise.all(enrichedRequestsPromises);
      
      setLoanRequests(enrichedRequests as LoanRequest[]);
      setLoading(false);
    }, (error) => {
        console.error("FATAL ERROR fetching loan requests:", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleEvaluateClick = (request: LoanRequest) => {
    setSelectedRequest(request);
    setIsEvaluationModalOpen(true);
  }

  const handleReviewClick = (request: LoanRequest) => {
    setSelectedRequest(request);
    setIsReviewModalOpen(true);
  }
  
  const handleDisputeClick = (request: LoanRequest) => {
    setSelectedRequest(request);
    setIsDisputeModalOpen(true);
  }

  const handlePreApprove = async (approvedData: { amount: number; term: number; interestRate: number; disbursementFee: number; technologyFee: number; }) => {
    if (!selectedRequest) return;

    const requestRef = doc(db, 'loanRequests', selectedRequest.id);

    try {
        await updateDoc(requestRef, {
            ...approvedData,
            status: 'pre-approved',
            preApprovedAt: new Date(),
            requesterId: selectedRequest.requesterId,
        });
        toast({
            title: "Oferta enviada",
            description: "La oferta de crédito ha sido enviada al usuario para su aceptación.",
        });
        setIsEvaluationModalOpen(false);
        setSelectedRequest(null);
    } catch (error) {
        console.error("Error pre-approving loan:", error);
        toast({
            title: "Error",
            description: "No se pudo enviar la oferta.",
            variant: "destructive",
        });
    }
  };

  const handleFinalApproval = async (decision: 'approved' | 'rejected' | 'rejected-docs', finalData?: ExtractedData) => {
      if (!selectedRequest) return;
      const requestRef = doc(db, 'loanRequests', selectedRequest.id);

      try {
          let updateData: any = { status: decision };

          if (decision === 'approved' && finalData) {
              const approvedLoansQuery = query(collection(db, 'loanRequests'), where('status', 'in', ['approved', 'funding-active', 'funded']));
              const snapshot = await getCountFromServer(approvedLoansQuery);
              const fundingOrder = snapshot.data().count;

              updateData.approvedAt = new Date();
              updateData.fundedPercentage = 0;
              updateData.committedPercentage = 0;
              updateData.fundingOrder = fundingOrder;

              // Update user's official information in their profile
              if (selectedRequest.requesterId) {
                  const userRef = doc(db, 'users', selectedRequest.requesterId);
                  // Omit nameMismatch before saving to user profile
                  const { nameMismatch, ...dataToSave } = finalData;
                  
                  const userUpdateData = {
                      ...dataToSave,
                      photoUrl: selectedRequest.documentUrls?.profilePhotoProcessed?.url || null,
                  };

                  await updateDoc(userRef, userUpdateData, { merge: true });
              }

          } else if (decision === 'rejected' || decision === 'rejected-docs') {
              updateData.rejectedAt = new Date();
          }

          await updateDoc(requestRef, updateData);

          toast({
              title: `Solicitud actualizada`,
              description: `La solicitud ha sido marcada como '${decision}'.`,
          });
          setIsReviewModalOpen(false);
          setSelectedRequest(null);
      } catch (error) {
          console.error("Error updating final status:", error);
          toast({ title: "Error", description: "No se pudo actualizar la solicitud.", variant: "destructive" });
      }
  }


  const getStatusBadge = (request: LoanRequest) => {
    const { status, hasDisputedInvestments, paymentDay } = request;
    if (hasDisputedInvestments) {
        return <Badge className="bg-red-600 text-white hover:bg-red-700">EN DISPUTA</Badge>;
    }
    switch (status) {
        case 'pending':
            return <Badge variant="secondary">Pendiente</Badge>;
        case 'pre-approved':
            return <Badge className="bg-yellow-100 text-yellow-800">Oferta Enviada</Badge>;
        case 'pending-review':
            return <Badge className="bg-purple-100 text-purple-800">Revisión Final</Badge>;
        case 'approved':
            return <Badge className="bg-blue-100 text-blue-800">Aprobado (Pend. Publicar)</Badge>;
        case 'funding-active':
            return <Badge className="bg-green-100 text-green-800">Fondeando</Badge>;
        case 'funded':
             if (!paymentDay) {
                return <Badge className="bg-teal-100 text-teal-800">Esperando Día de Pago</Badge>;
            }
             return <Badge className="bg-teal-500 text-white">Fondeado</Badge>;
        case 'repayment-active':
            return <Badge className="bg-cyan-100 text-cyan-800">En Pagos</Badge>;
        case 'repayment-overdue':
            return <Badge className="bg-rose-100 text-rose-800">Pago Vencido</Badge>;
        case 'rejected-docs':
             return <Badge className="bg-orange-100 text-orange-800">Docs Inválidos</Badge>;
        case 'rejected':
            return <Badge variant="destructive">Rechazado</Badge>;
        case 'withdrawn':
            return <Badge variant="outline">Retirada</Badge>;
        case 'completed':
            return <Badge className="bg-green-600 text-white">Completado</Badge>;
        default:
            return <Badge>{status}</Badge>;
    }
  }


  return (
    <>
    <Card>
        <CardHeader>
            <CardTitle>Últimas solicitudes de crédito</CardTitle>
        </CardHeader>
        <CardContent>
            {loading ? (
                <div className="flex justify-center items-center h-60">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Fecha y Hora</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead>Monto Solicitado</TableHead>
                    <TableHead>Plazo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loanRequests.map((request) => (
                    <TableRow key={request.id} className={request.hasDisputedInvestments ? 'bg-red-50 hover:bg-red-100' : ''}>
                        <TableCell>{formatDate(request.createdAt)}</TableCell>
                        <TableCell className="font-medium">{request.userName}</TableCell>
                        <TableCell>{request.userEmail}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(request.amount)}</TableCell>
                        <TableCell>{request.term} meses</TableCell>
                        <TableCell>
                           {getStatusBadge(request)}
                        </TableCell>
                        <TableCell className="text-right">
                           {request.hasDisputedInvestments ? (
                             <Button variant="destructive" size="sm" onClick={() => handleDisputeClick(request)}>
                                Resolver Disputa
                             </Button>
                           ) : request.status === 'pending' ? (
                             <Button variant="outline" size="sm" onClick={() => handleEvaluateClick(request)}>
                                Evaluar
                             </Button>
                           ) : request.status === 'pending-review' ? (
                             <Button variant="default" size="sm" onClick={() => handleReviewClick(request)}>
                                Revisar
                             </Button>
                           ) : null}
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
                {loanRequests.length === 0 && !loading && (
                    <TableCaption>No hay solicitudes de crédito pendientes.</TableCaption>
                )}
                </Table>
            )}
        </CardContent>
    </Card>
    {isEvaluationModalOpen && selectedRequest && (
        <EvaluationModal 
            isOpen={isEvaluationModalOpen}
            onClose={() => setIsEvaluationModalOpen(false)}
            request={selectedRequest}
            onApprove={handlePreApprove}
        />
    )}
    {isReviewModalOpen && selectedRequest && (
        <ReviewModal
            isOpen={isReviewModalOpen}
            onClose={() => setIsReviewModalOpen(false)}
            request={selectedRequest}
            onDecision={handleFinalApproval}
        />
    )}
    {isDisputeModalOpen && selectedRequest && (
        <DisputeModal
            isOpen={isDisputeModalOpen}
            onClose={() => { setIsDisputeModalOpen(false); setSelectedRequest(null); }}
            request={selectedRequest}
        />
    )}
    </>
  );
}

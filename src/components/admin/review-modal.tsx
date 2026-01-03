
'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { LoanRequest } from './loan-requests-table';
import { Loader2, CheckCircle, XCircle, FileText, Trash2, FileQuestion, AlertTriangle, Pencil, Phone } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import Link from 'next/link';
import { Separator } from '../ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { deleteObject, ref } from 'firebase/storage';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export type ExtractedData = {
    firstName: string;
    lastName: string;
    idNumber: string;
    idIssuePlace: string;
    dateOfBirth: string;
    phoneNumber?: string;
    employerName: string;
    position: string;
    salary: number;
    startDate: string;
    bankName: string;
    accountHolder: string;
    accountType: string;
    accountNumber: string;
    nameMismatch: boolean;
};


type ReviewModalProps = {
    isOpen: boolean;
    onClose: () => void;
    request: LoanRequest;
    onDecision: (decision: 'approved' | 'rejected' | 'rejected-docs', finalData?: ExtractedData) => Promise<void>;
}

const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const docKeyToName: Record<string, string> = {
    profilePhotoProcessed: 'Foto de Perfil',
    idFront: 'Cédula (Cara Frontal)',
    idBack: 'Cédula (Cara Trasera)',
    workCertificate: 'Certificado Laboral',
    bankCertificate: 'Certificado Bancario',
    signature: 'Firma del Solicitante'
}

const documentOrder: (keyof typeof docKeyToName)[] = ['profilePhotoProcessed', 'idFront', 'idBack', 'signature', 'workCertificate', 'bankCertificate'];

const isImageKey = (key: string) => {
    const imageKeys = ['profilePhotoProcessed', 'idFront', 'idBack', 'signature'];
    return imageKeys.includes(key);
};


export default function ReviewModal({ isOpen, onClose, request, onDecision }: ReviewModalProps) {
    const [loading, setLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [editableData, setEditableData] = useState<ExtractedData | null>(null);
    const { toast } = useToast();
    const { aiAnalysis, documentUrls } = request;

    useEffect(() => {
        const initializeData = async () => {
             if (isOpen && request.requesterId) {
                // 1. Start with AI data if it exists
                let initialData = aiAnalysis?.extractedData ? { ...aiAnalysis.extractedData } : {};

                // 2. Fetch the user's current profile from Firestore
                try {
                    const userRef = doc(db, 'users', request.requesterId);
                    const userSnap = await getDoc(userRef);
                    if (userSnap.exists()) {
                        const userProfile = userSnap.data();
                        // 3. Merge, giving priority to existing data if AI didn't find it
                        initialData = {
                            ...initialData,
                            phoneNumber: userProfile.phoneNumber || initialData.phoneNumber || '',
                        };
                    }
                } catch (error) {
                    console.error("Could not fetch user profile to merge phone number:", error);
                }
                
                setEditableData(initialData as ExtractedData);
            }
        };
        initializeData();
    }, [isOpen, aiAnalysis, request.requesterId]);


    const handleDecision = async (decision: 'approved' | 'rejected' | 'rejected-docs') => {
        setLoading(true);
        await onDecision(decision, editableData || undefined);
        setLoading(false);
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setEditableData(prev => {
            if (!prev) return null;
            const isNumeric = ['salary'].includes(name);
            return {
                ...prev,
                [name]: isNumeric ? Number(value) : value,
            };
        });
    };
    
    const handleDeleteRequest = async () => {
        setDeleteLoading(true);
        try {
            // Delete associated files from storage
            if (request.requesterId && request.id) {
                const fileNames = ['id-front', 'id-back', 'work-certificate', 'bank-certificate', 'signature', 'profile-photo-original', 'profile-photo-processed'];
                const deletePromises = fileNames.map(fileName => {
                    try {
                        const fileRef = ref(storage, `loan-documents/${request.requesterId}/${request.id}/${fileName}`);
                        return deleteObject(fileRef);
                    } catch (error) {
                        console.error("Error creating storage reference for deletion:", error);
                        // Don't block deletion if one file fails, just log it.
                        return Promise.resolve();
                    }
                });
                await Promise.allSettled(deletePromises);
            }
            
            // Delete the Firestore document
            const requestRef = doc(db, 'loanRequests', request.id);
            await deleteDoc(requestRef);
            
            toast({
                title: 'Solicitud Eliminada',
                description: 'La solicitud y todos sus documentos han sido eliminados.',
            });
            onClose();

        } catch (error) {
            console.error("Error deleting request:", error);
            toast({
                title: "Error al eliminar",
                description: "No se pudo completar la eliminación. Revisa los permisos o inténtalo de nuevo.",
                variant: 'destructive',
            });
        } finally {
            setDeleteLoading(false);
        }
    }
    
    const orderedDocumentEntries = documentOrder
        .map(key => {
            const docData = documentUrls?.[key];
            if (!docData) return null;

            // Handle both string URL and object with URL
            const url = typeof docData === 'object' ? docData.url : typeof docData === 'string' ? docData : undefined;
            const contentType = typeof docData === 'object' ? docData.contentType : '';
            
            if (!url) return null;

            return [key, contentType, url];
        })
        .filter((entry): entry is [string, string, string] => entry !== null);


    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <div className='flex items-center justify-between'>
                        <div className='flex items-center gap-3'>
                            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                <FileText className="h-6 w-6" />
                            </div>
                            <div>
                                <DialogTitle>Revisión Final de Solicitud</DialogTitle>
                                <DialogDescription>
                                    Verifica y corrige la información extraída. Toma una decisión de aprobación.
                                </DialogDescription>
                            </div>
                        </div>
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={loading || deleteLoading}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Eliminar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                <AlertDialogTitle>¿Estás seguro que quieres eliminar esta solicitud?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Esta acción no se puede deshacer. Se borrará permanentemente la solicitud y todos los documentos asociados.
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDeleteRequest} className="bg-destructive hover:bg-destructive/90" disabled={deleteLoading}>
                                    {deleteLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Sí, eliminar
                                </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </DialogHeader>

                {!editableData ? (
                    <div className="py-8 text-center text-muted-foreground">
                        No se encontró análisis para esta solicitud.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4 max-h-[70vh] overflow-y-auto">
                        {/* Left Column: Data & Analysis */}
                        <div className='space-y-4'>
                           <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Pencil className='h-5 w-5 text-primary'/>
                                        Datos Extraídos (Editables)
                                    </CardTitle>
                                    {editableData.nameMismatch && (
                                        <p className="text-sm font-semibold text-destructive pt-2 flex items-center gap-2"><AlertTriangle size={16}/> Alerta: Nombre no coincide en documentos.</p>
                                    )}
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className='space-y-1'><Label htmlFor="firstName">Nombre(s)</Label><Input id="firstName" name="firstName" value={editableData.firstName} onChange={handleInputChange} /></div>
                                        <div className='space-y-1'><Label htmlFor="lastName">Apellido(s)</Label><Input id="lastName" name="lastName" value={editableData.lastName} onChange={handleInputChange} /></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                      <div className='space-y-1'><Label htmlFor="idNumber">Cédula</Label><Input id="idNumber" name="idNumber" value={editableData.idNumber} onChange={handleInputChange} /></div>
                                      <div className='space-y-1'><Label htmlFor="phoneNumber">Teléfono</Label><Input id="phoneNumber" name="phoneNumber" value={editableData.phoneNumber || ''} onChange={handleInputChange} /></div>
                                    </div>
                                    <div className='space-y-1'><Label htmlFor="idIssuePlace">Lugar de Expedición</Label><Input id="idIssuePlace" name="idIssuePlace" value={editableData.idIssuePlace} onChange={handleInputChange} /></div>
                                    <div className='space-y-1'><Label htmlFor="dateOfBirth">Fecha de Nacimiento</Label><Input id="dateOfBirth" name="dateOfBirth" value={editableData.dateOfBirth} onChange={handleInputChange} placeholder="DD-MM-AAAA" /></div>
                                    <Separator />
                                    <div className='space-y-1'><Label htmlFor="employerName">Empleador</Label><Input id="employerName" name="employerName" value={editableData.employerName} onChange={handleInputChange} /></div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className='space-y-1'><Label htmlFor="position">Cargo</Label><Input id="position" name="position" value={editableData.position} onChange={handleInputChange} /></div>
                                        <div className='space-y-1'><Label htmlFor="startDate">Fecha de Inicio</Label><Input id="startDate" name="startDate" value={editableData.startDate} onChange={handleInputChange} placeholder="DD-MM-AAAA" /></div>
                                    </div>
                                    <div className='space-y-1'><Label htmlFor="salary">Salario</Label><Input id="salary" name="salary" type="number" value={editableData.salary} onChange={handleInputChange} /></div>
                                    <Separator />
                                    <div className='space-y-1'><Label htmlFor="bankName">Banco</Label><Input id="bankName" name="bankName" value={editableData.bankName} onChange={handleInputChange} /></div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className='space-y-1'><Label htmlFor="accountHolder">Titular de la Cuenta</Label><Input id="accountHolder" name="accountHolder" value={editableData.accountHolder} onChange={handleInputChange} /></div>
                                        <div className='space-y-1'><Label htmlFor="accountType">Tipo de Cuenta</Label><Input id="accountType" name="accountType" value={editableData.accountType} onChange={handleInputChange} /></div>
                                    </div>
                                    <div className='space-y-1'><Label htmlFor="accountNumber">Número de Cuenta</Label><Input id="accountNumber" name="accountNumber" value={editableData.accountNumber} onChange={handleInputChange} /></div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Resumen del Crédito</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex justify-between"><span>Solicitante:</span> <span className="font-medium">{request.userName}</span></div>
                                    <div className="flex justify-between"><span>Monto Aprobado:</span> <span className="font-medium">{formatCurrency(request.amount)}</span></div>
                                    <div className="flex justify-between"><span>Plazo:</span> <span className="font-medium">{request.term} meses</span></div>
                                    <div className="flex justify-between"><span>Interés:</span> <span className="font-medium">{request.interestRate}% E.M.</span></div>
                                </CardContent>
                            </Card>
                        </div>
                        
                        {/* Right Column: Documents */}
                        <div className="space-y-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Documentos Adjuntos</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                     {orderedDocumentEntries.map(([key, contentType, url]) => {
                                        const docName = docKeyToName[key] || key;
                                        
                                        if ((contentType && contentType.startsWith('image/')) || isImageKey(key)) {
                                            return (
                                                <div key={key}>
                                                    <p className='text-sm font-medium mb-1 capitalize'>{docName}</p>
                                                    <a href={url} target="_blank" rel="noopener noreferrer" className="block relative aspect-video w-full overflow-hidden rounded-md border hover:ring-2 hover:ring-primary transition-all">
                                                        <Image src={url} alt={`Vista previa de ${docName}`} layout="fill" objectFit="contain" />
                                                    </a>
                                                </div>
                                            )
                                        } 
                                        
                                        if (contentType === 'application/pdf') {
                                            return (
                                                 <div key={key}>
                                                    <p className='text-sm font-medium mb-1 capitalize'>{docName}</p>
                                                     <Button asChild variant="outline" className="w-full justify-start">
                                                        <Link href={url} target="_blank"><FileText className="mr-2 h-4 w-4" /> Ver PDF</Link>
                                                    </Button>
                                                </div>
                                            )
                                        } 
                                        
                                        return (
                                            <div key={key}>
                                                <p className='text-sm font-medium mb-1 capitalize'>{docName}</p>
                                                <Button asChild variant="outline" className="w-full justify-start">
                                                    <Link href={url} target="_blank"><FileQuestion className="mr-2 h-4 w-4" /> Ver Documento</Link>
                                                </Button>
                                            </div>
                                        )
                                    })}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}
                
                <Separator />
                
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>Cerrar</Button>
                    <Button variant="destructive" onClick={() => handleDecision('rejected-docs')} disabled={loading || !editableData}>Rechazar (Docs Inválidos)</Button>
                    <Button className="bg-red-700 hover:bg-red-800" onClick={() => handleDecision('rejected')} disabled={loading || !editableData}>
                        <XCircle className="mr-2 h-4 w-4" />
                        Rechazar Definitivamente
                    </Button>
                    <Button variant="default" onClick={() => handleDecision('approved')} disabled={loading || !editableData}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                        Aprobar Crédito
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, getDoc, updateDoc, DocumentData } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, UploadCloud, AlertTriangle, FileSignature, Brush, UserSquare, Eye, Paperclip, File as FileIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { assessLoanRisk, AssessLoanRiskOutput } from '@/ai/flows/loan-risk-assessment';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import SignatureCanvas from 'react-signature-canvas';
import Image from 'next/image';
import PromissoryNoteModal from '@/components/portal/promissory-note-modal';
import { CameraCapture } from '@/components/common/camera-capture';
import { removeBackground } from '@imgly/background-removal';


const formatCurrency = (value: number) => {
    if (isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

type FileState = {
    profilePhoto?: File;
    idFront?: File;
    idBack?: File;
    workCertificate?: File;
    bankCertificate?: File;
};

type FilePreviewState = {
    profilePhoto?: string;
    idFront?: string;
    idBack?: string;
};


const fileToDataUri = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};


export default function ApprovalPage() {
    const { requestId } = useParams();
    const { user, loading: authLoading } = useAuth();
    const router = useRouter();
    const { toast } = useToast();

    const [loanRequest, setLoanRequest] = useState<DocumentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [files, setFiles] = useState<FileState>({});
    const [filePreviews, setFilePreviews] = useState<FilePreviewState>({});
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [isNotePreviewOpen, setIsNotePreviewOpen] = useState(false);
    const [hasSeenPagare, setHasSeenPagare] = useState(false);
    
    const sigPadRef = useRef<SignatureCanvas>(null);
    const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);

    useEffect(() => {
        const fetchLoanRequest = async () => {
            if (!user || !requestId) return;
            console.log("APPROVAL_PAGE: Fetching loan request...");

            try {
                const docRef = doc(db, 'loanRequests', requestId as string);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.requesterId === user.uid && (data.status === 'pre-approved' || data.status === 'rejected-docs')) {
                        console.log("APPROVAL_PAGE: Loan request found and authorized.", data);
                        setLoanRequest({ ...data, id: docSnap.id });
                        if (data.status === 'rejected-docs') {
                            setShowUpload(true); 
                        }
                    } else {
                        console.log("APPROVAL_PAGE: Loan request not authorized or in wrong status. Redirecting.");
                        router.push('/portal');
                    }
                } else {
                    console.log("APPROVAL_PAGE: Loan request document not found. Redirecting.");
                    router.push('/portal');
                }
            } catch (error) {
                console.error("APPROVAL_PAGE: Error fetching loan request:", error);
                toast({ title: 'Error', description: 'No se pudo cargar la oferta.', variant: 'destructive' });
                router.push('/portal');
            } finally {
                setLoading(false);
            }
        };

        if (!authLoading) {
            fetchLoanRequest();
        }

    }, [user, requestId, authLoading, router, toast]);

    const { monthlyPayment, netDisbursement } = useMemo(() => {
        if (!loanRequest) return { monthlyPayment: 0, netDisbursement: 0 };
        
        const principal = loanRequest.amount;
        const i = loanRequest.interestRate / 100;
        const n = loanRequest.term;
        const disbursementFee = loanRequest.disbursementFee || 0;
        const technologyFee = loanRequest.technologyFee || 8000;

        const interestPaymentPart = principal * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        const totalMonthlyPayment = interestPaymentPart + technologyFee;
        const netDisbursementAmount = principal - disbursementFee;

        return {
          monthlyPayment: totalMonthlyPayment,
          netDisbursement: netDisbursementAmount,
        };
    }, [loanRequest]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, files: inputFiles } = e.target;
        console.log(`APPROVAL_PAGE: File change for input '${name}'`);
        if (inputFiles && inputFiles.length > 0) {
            const file = inputFiles[0];
            const fieldName = name as keyof FileState;
            setFiles(prev => ({ ...prev, [fieldName]: file }));

            if (fieldName === 'profilePhoto' || fieldName === 'idFront' || fieldName === 'idBack') {
                 try {
                    const dataUri = await fileToDataUri(file);
                    setFilePreviews(prev => ({...prev, [fieldName]: dataUri }));
                } catch (error) {
                    console.error("Error creating file preview:", error);
                    toast({ title: "Error de Archivo", description: "No se pudo generar la vista previa.", variant: "destructive" });
                }
            }
        }
    };
    
    const dataURLtoFile = (dataurl: string, filename: string): File => {
        console.log("APPROVAL: Converting data URL to file.");
        const arr = dataurl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) {
            throw new Error('Invalid data URL');
        }
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new window.File([u8arr], filename, { type: mime });
    }

    const isUploadComplete = useMemo(() => {
        return files.profilePhoto && files.idFront && files.idBack && files.workCertificate && files.bankCertificate && !isSignatureEmpty;
    }, [files, isSignatureEmpty]);

    const clearSignature = () => {
        sigPadRef.current?.clear();
        setIsSignatureEmpty(true);
    }
    
    const handleSigEnd = () => {
        if(sigPadRef.current) {
            setIsSignatureEmpty(sigPadRef.current.isEmpty());
        }
    }

    const handleFinalAcceptance = async () => {
        console.log("APPROVAL_PAGE: Starting final acceptance process...");
        if (!user || !loanRequest) {
            toast({ title: 'No autenticado', description: 'Debes iniciar sesión.', variant: 'destructive'});
            return;
        }

        if (!isUploadComplete || !sigPadRef.current || sigPadRef.current.isEmpty()) {
            toast({ title: 'Información Faltante', description: 'Por favor, sube todos los documentos, tu foto y proporciona tu firma.', variant: 'destructive'});
            return;
        }

        if (!agreedToTerms) {
            toast({ title: 'Términos no aceptados', description: 'Debes aceptar los términos del pagaré para continuar.', variant: 'destructive'});
            return;
        }

        setActionLoading(true);

        try {
            console.log("APPROVAL_PAGE: Uploading files...");
            const uploadFile = async (file: File, fileName: string): Promise<{url: string, contentType: string} | null> => {
                try {
                    const storageRef = ref(storage, `loan-documents/${user.uid}/${requestId}/${fileName}`);
                    const uploadResult = await uploadBytes(storageRef, file, { contentType: file.type });
                    const downloadUrl = await getDownloadURL(uploadResult.ref);
                    console.log(`APPROVAL_PAGE: Successfully uploaded ${fileName}.`);
                    return { url: downloadUrl, contentType: file.type };
                } catch (error) {
                    console.error(`APPROVAL_PAGE: Error uploading ${fileName}:`, error);
                    return null;
                }
            };
            
            // AI Background Removal (client-side with @imgly/background-removal)
            console.log("APPROVAL_PAGE: Processing profile photo with AI background removal...");
            toast({ title: 'Procesando foto de perfil...', description: 'Nuestra IA está eliminando el fondo. Esto puede tardar un momento.' });
            
            let processedPhotoFile: File;
            try {
                // Remove background using client-side ML
                const blob = await removeBackground(files.profilePhoto!, {
                    progress: (key, current, total) => {
                        console.log(`Background removal progress: ${key} - ${current}/${total}`);
                    },
                });
                
                // Create a canvas to add white background
                const img = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d')!;
                
                // Fill with white background
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Draw the image (with transparent background) on top
                ctx.drawImage(img, 0, 0);
                
                // Convert to blob/file
                const whiteBackgroundBlob = await new Promise<Blob>((resolve) => {
                    canvas.toBlob((b) => resolve(b!), 'image/png');
                });
                
                processedPhotoFile = new File([whiteBackgroundBlob], 'profile-photo-processed.png', { type: 'image/png' });
                console.log("APPROVAL_PAGE: Background removal successful!");
                toast({ title: '¡Foto procesada!', description: 'El fondo ha sido eliminado exitosamente.' });
            } catch (bgError) {
                console.error("APPROVAL_PAGE: Background removal failed:", bgError);
                toast({ title: 'Error en procesamiento', description: 'No se pudo eliminar el fondo. Se usará la foto original.', variant: 'destructive' });
                processedPhotoFile = files.profilePhoto!;
            }
            
            const signatureDataUri = sigPadRef.current.getTrimmedCanvas().toDataURL('image/png');
            const signatureFile = dataURLtoFile(signatureDataUri, 'signature.png');

            const [
                profilePhotoOriginalData, 
                profilePhotoProcessedData,
                idFrontData, 
                idBackData, 
                workCertificateData, 
                bankCertificateData, 
                signatureData
            ] = await Promise.all([
                uploadFile(files.profilePhoto!, 'profile-photo-original'),
                uploadFile(processedPhotoFile, 'profile-photo-processed'),
                uploadFile(files.idFront!, 'id-front'),
                uploadFile(files.idBack!, 'id-back'),
                uploadFile(files.workCertificate!, 'work-certificate'),
                uploadFile(files.bankCertificate!, 'bank-certificate'),
                uploadFile(signatureFile, 'signature')
            ]);

            if (!idFrontData || !idBackData || !workCertificateData || !bankCertificateData || !signatureData || !profilePhotoProcessedData) {
                throw new Error("Una o más subidas de archivos fallaron. Revisa la consola para más detalles.");
            }

            console.log("APPROVAL_PAGE: All files uploaded. Running AI risk assessment...");
            const [idFrontDataUri, idBackDataUri, workCertificateDataUri, bankCertificateDataUri] = await Promise.all([
                fileToDataUri(files.idFront!),
                fileToDataUri(files.idBack!),
                fileToDataUri(files.workCertificate!),
                fileToDataUri(files.bankCertificate!),
            ]);

            const aiResult: AssessLoanRiskOutput = await assessLoanRisk({
                idFrontDataUri,
                idBackDataUri,
                workCertificateDataUri,
                bankCertificateDataUri,
                signatureDataUri,
                loanDetails: `Monto: ${formatCurrency(loanRequest?.amount)}, Plazo: ${loanRequest?.term} meses`,
            });
            
            console.log("APPROVAL_PAGE: AI analysis complete. Updating Firestore document...");
            const loanDocRef = doc(db, 'loanRequests', requestId as string);
            await updateDoc(loanDocRef, { 
                status: 'pending-review',
                submittedForReviewAt: new Date(),
                documentUrls: {
                    profilePhotoOriginal: profilePhotoOriginalData,
                    profilePhotoProcessed: profilePhotoProcessedData,
                    idFront: idFrontData,
                    idBack: idBackData,
                    workCertificate: workCertificateData,
                    bankCertificate: bankCertificateData,
                    signature: signatureData,
                },
                aiAnalysis: {
                    riskScore: aiResult.riskScore,
                    riskFactors: aiResult.riskFactors,
                    extractedData: aiResult.extractedData,
                    recommendedAction: aiResult.recommendedAction,
                    analyzedAt: new Date(),
                }
            });
            
            console.log("APPROVAL_PAGE: Process complete. Redirecting to portal.");
            toast({
                title: `Documentos Enviados`,
                description: 'Tus documentos han sido enviados para la revisión final. Recibirás una notificación pronto.',
            });
            router.push('/portal');

        } catch (error) {
            console.error(`APPROVAL_PAGE: Error in final acceptance:`, error);
            toast({ title: 'Error en el Proceso', description: (error as Error).message || 'No se pudo procesar tu solicitud. Revisa la consola.', variant: 'destructive' });
        } finally {
            setActionLoading(false);
        }
    }


    if (loading || authLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Cargando tu oferta...</p>
            </div>
        );
    }

    if (!loanRequest) {
        return <div className="text-center">No se encontró una oferta válida.</div>;
    }
    
    const pageTitle = loanRequest.status === 'rejected-docs' ? "Corrige tus documentos" : "¡Felicitaciones! Tu crédito fue pre-aprobado";
    const pageDescription = loanRequest.status === 'rejected-docs' 
        ? "Hubo un problema con los documentos que enviaste. Por favor, cárgalos de nuevo para que podamos revisar tu solicitud." 
        : "Gracias por tu interés en un crédito con Banqi. Por favor, revisa los términos de tu oferta y completa los siguientes pasos.";


  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{pageTitle}</h1>
        <p className="text-muted-foreground">{pageDescription}</p>
      </div>
      
      <Card>
        <CardHeader>
            <CardTitle className="text-xl">Resumen de la oferta</CardTitle>
            <CardDescription>Con nosotros, ahorrarás en cargos financieros. La mayoría del interés que pagarás beneficiará a personas como tú que están confiándote sus ahorros.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
             <div className="space-y-3 rounded-lg border p-4">
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Monto Aprobado</p>
                    <p className="text-lg font-bold">{formatCurrency(loanRequest.amount)}</p>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Plazo</p>
                    <p className="text-lg font-bold">{loanRequest.term} meses</p>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Tasa Mensual</p>
                    <p className="text-lg font-bold">{loanRequest.interestRate}%</p>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Estudio de crédito (una única vez)</p>
                    <p className="text-lg font-bold">{formatCurrency(loanRequest.disbursementFee || 0)}</p>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Cuota de Tecnología (mensual)</p>
                    <p className="text-lg font-bold">{formatCurrency(loanRequest.technologyFee || 8000)}</p>
                </div>
            </div>
            
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="rounded-lg border p-4 text-center bg-primary/10 flex flex-col justify-center items-center">
                    <p className="text-sm text-primary font-semibold">Tu cuota mensual estimada</p>
                    <p className="text-3xl font-bold text-primary">{formatCurrency(monthlyPayment)}</p>
                </div>
                 <div className="space-y-2 text-sm text-muted-foreground border p-4 rounded-lg">
                    <div className="flex justify-between font-bold text-base text-foreground">
                        <span>Valor a recibir (neto):</span>
                        <span>{formatCurrency(netDisbursement)}</span>
                    </div>
                    <Separator className="my-2" />
                    <div className="flex justify-between">
                        <span>Monto Solicitado:</span>
                        <span className="font-medium text-foreground">{formatCurrency(loanRequest.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Costo estudio de crédito:</span>
                        <span className="font-medium text-foreground">- {formatCurrency(loanRequest.disbursementFee || 0)}</span>
                    </div>
                </div>
             </div>
              <div className="text-xs text-muted-foreground text-center pt-2">
                Recibirás el desembolso en una o varias transacciones a tu cuenta bancaria a medida que los inversionistas fondeen tu crédito.
            </div>
            <Alert variant="default" className="bg-green-50 border-green-200 text-green-800">
                <AlertTriangle className="h-4 w-4 !text-green-600" />
                <AlertTitle className="font-bold">Banqi es transparente y honesto</AlertTitle>
                <AlertDescription>
                    Recuerda que puedes realizar abonos a capital o pagar la totalidad de tu crédito en cualquier momento sin ningún tipo de penalidad.
                </AlertDescription>
            </Alert>
        </CardContent>
        {(!showUpload && loanRequest.status !== 'rejected-docs') && (
             <CardFooter className="flex-col gap-4">
                <Button className="w-full" onClick={() => setShowUpload(true)} disabled={actionLoading}>
                    Aceptar y cargar documentos
                </Button>
                <Button variant="outline" className="w-full" onClick={() => router.push('/portal')} disabled={actionLoading}>
                    Volver al portal
                </Button>
            </CardFooter>
        )}
      </Card>

      {showUpload && (
        <Card>
            <CardHeader>
                <div className='flex items-center gap-3'>
                    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UploadCloud className="h-6 w-6" />
                    </div>
                    <div>
                        <CardTitle className="text-xl">Verificación de identidad y firma</CardTitle>
                        <CardDescription>Para finalizar, por favor sube los siguientes documentos. Serán analizados por nuestra IA para completar tu perfil.</CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className='space-y-6'>
                {loanRequest.status === 'rejected-docs' && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>Acción requerida</AlertTitle>
                        <AlertDescription>
                            Tus documentos anteriores no pudieron ser validados. Por favor, asegúrate de que las imágenes sean claras y los documentos correctos antes de volver a enviarlos.
                        </AlertDescription>
                    </Alert>
                )}
                {loanRequest.status !== 'rejected-docs' && (
                    <Alert variant="default" className="bg-yellow-50 border-yellow-200 text-yellow-800">
                        <AlertTriangle className="h-4 w-4 !text-yellow-600" />
                        <AlertTitle>Un acto de confianza</AlertTitle>
                        <AlertDescription>
                            Al aceptar este crédito, estás aceptando un compromiso con personas que confían en ti. Detrás de tu préstamo están los ahorros de individuos como tú. Tu responsabilidad es la base de esta comunidad.
                        </AlertDescription>
                    </Alert>
                )}
                
                 <div className='space-y-2'>
                    <Label>Foto de perfil</Label>
                    <div className='flex items-center gap-4'>
                        <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                           {filePreviews.profilePhoto ? (
                                <Image src={filePreviews.profilePhoto} alt="Vista previa" width={96} height={96} className="object-cover w-full h-full" />
                           ) : (
                                <UserSquare className="w-12 h-12 text-muted-foreground" />
                           )}
                        </div>
                        <div className="flex-1">
                             <CameraCapture
                                label="Foto de perfil"
                                facingMode="user"
                                description="Sube una foto clara de tu rostro. Nuestra IA eliminará el fondo."
                                onCapture={async (file) => {
                                    setFiles(prev => ({ ...prev, profilePhoto: file }));
                                    const dataUri = await fileToDataUri(file);
                                    setFilePreviews(prev => ({ ...prev, profilePhoto: dataUri }));
                                }}
                             />
                        </div>
                    </div>
                </div>

                <Separator />

                <div className='space-y-6'>
                    {/* Cédula con opción de cámara */}
                    <div className='space-y-2'>
                        <Label>Cédula (Cara Frontal)</Label>
                        <div className='flex items-start gap-4'>
                            {filePreviews.idFront && (
                                <Image src={filePreviews.idFront} alt="Vista previa" width={80} height={50} className="object-cover rounded-md border" />
                            )}
                            <div className='flex-1'>
                                <CameraCapture
                                    label="Cédula (Cara Frontal)"
                                    facingMode="environment"
                                    description="Toma una foto clara de la cara frontal de tu cédula"
                                    onCapture={async (file) => {
                                        setFiles(prev => ({ ...prev, idFront: file }));
                                        const dataUri = await fileToDataUri(file);
                                        setFilePreviews(prev => ({ ...prev, idFront: dataUri }));
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className='space-y-2'>
                        <Label>Cédula (Cara Trasera)</Label>
                        <div className='flex items-start gap-4'>
                            {filePreviews.idBack && (
                                <Image src={filePreviews.idBack} alt="Vista previa" width={80} height={50} className="object-cover rounded-md border" />
                            )}
                            <div className='flex-1'>
                                <CameraCapture
                                    label="Cédula (Cara Trasera)"
                                    facingMode="environment"
                                    description="Toma una foto clara de la cara trasera de tu cédula"
                                    onCapture={async (file) => {
                                        setFiles(prev => ({ ...prev, idBack: file }));
                                        const dataUri = await fileToDataUri(file);
                                        setFilePreviews(prev => ({ ...prev, idBack: dataUri }));
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Certificaciones - solo subir archivo */}
                    {[
                        { name: 'workCertificate', label: 'Certificación Laboral', accept: 'image/*,application/pdf' },
                        { name: 'bankCertificate', label: 'Certificación Bancaria', accept: 'image/*,application/pdf' },
                    ].map(field => (
                        <div key={field.name} className='space-y-2'>
                            <Label htmlFor={field.name}>{field.label}</Label>
                            <div className='flex items-start gap-4'>
                                {files[field.name as keyof FileState] && (
                                    <div className='flex items-center gap-2 text-sm text-muted-foreground bg-muted p-2 rounded-md border'>
                                        <Paperclip className='h-4 w-4' />
                                        <span>{files[field.name as keyof FileState]?.name}</span>
                                    </div>
                                )}
                                <div className='flex-1 space-y-2'>
                                    <Input 
                                        id={field.name} 
                                        name={field.name} 
                                        type="file" 
                                        accept={field.accept}
                                        onChange={handleFileChange} 
                                        className='file:text-primary file:font-semibold'
                                     />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>


                 <div className='space-y-2'>
                    <div className="flex justify-between items-center mb-1">
                        <div>
                            <Label htmlFor="signature">Firma digital</Label>
                            <p className="text-sm text-muted-foreground">
                                Por favor, firma tal como aparece en tu documento de identidad.
                            </p>
                        </div>
                        <Button type="button" variant="ghost" size="sm" onClick={clearSignature} disabled={actionLoading}>
                            <Brush className="mr-2 h-4 w-4" />
                            Limpiar
                        </Button>
                    </div>
                    <div className='rounded-md border border-input bg-background has-[:disabled]:opacity-50'>
                        <SignatureCanvas 
                            ref={sigPadRef}
                            penColor='black'
                            canvasProps={{
                                className: 'w-full aspect-[2/1] rounded-md'
                            }}
                            onEnd={handleSigEnd}
                            onBegin={() => setIsSignatureEmpty(false)}
                            onClear={() => setIsSignatureEmpty(true)}
                        />
                    </div>
                </div>
                
                <Alert variant={hasSeenPagare ? "default" : "destructive"} className={hasSeenPagare ? "bg-green-50 border-green-200 text-green-900" : "bg-amber-50 border-amber-200 text-amber-900"}>
                    <FileSignature className={`h-4 w-4 ${hasSeenPagare ? '!text-green-700' : '!text-amber-700'}`} />
                    <AlertTitle>{hasSeenPagare ? '✓ Modelo de pagaré revisado' : '⚠️ Revisa el modelo del pagaré'}</AlertTitle>
                    <AlertDescription>
                        <div className="flex flex-col gap-2">
                           <p>Al continuar y proporcionar tu firma, aceptas que por cada desembolso de dinero que recibas se generará un pagaré a tu nombre. Tu firma se incrustará en cada pagaré, y aceptas este mecanismo con total validez y conciencia, comprometiéndote a cumplir con los términos acordados.</p>
                           <Button 
                                type="button" 
                                variant={hasSeenPagare ? "outline" : "default"}
                                className={hasSeenPagare ? "w-fit" : "w-fit bg-amber-600 hover:bg-amber-700"}
                                onClick={() => {
                                    setIsNotePreviewOpen(true);
                                    setHasSeenPagare(true);
                                }}
                            >
                                <Eye className="mr-2 h-4 w-4" />
                                {hasSeenPagare ? 'Ver modelo del pagaré nuevamente' : 'Ver modelo del pagaré (obligatorio)'}
                            </Button>
                        </div>
                    </AlertDescription>
                </Alert>
                <div className="flex items-center space-x-2">
                    <Checkbox 
                        id="terms" 
                        disabled={!hasSeenPagare}
                        onCheckedChange={(checked) => setAgreedToTerms(Boolean(checked))} 
                    />
                    <label
                        htmlFor="terms"
                        className={`text-sm font-medium leading-none ${!hasSeenPagare ? 'text-muted-foreground' : ''}`}
                    >
                        {hasSeenPagare 
                            ? 'He leído, entiendo y acepto los términos del pagaré y el uso de mi firma.'
                            : 'Debes ver el modelo del pagaré antes de aceptar los términos.'
                        }
                    </label>
                </div>
            </CardContent>
            <CardFooter>
                 <Button className="w-full" onClick={handleFinalAcceptance} disabled={actionLoading || !isUploadComplete || !agreedToTerms}>
                    {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Finalizar y enviar documentos
                </Button>
            </CardFooter>
        </Card>
      )}

      {isNotePreviewOpen && (
          <PromissoryNoteModal
            isOpen={isNotePreviewOpen}
            onClose={() => setIsNotePreviewOpen(false)}
            investment={{ id: 'preview', loanId: requestId as string, amount: loanRequest?.amount || 500000, investorName: 'Ejemplo de Inversionista' } as any}
            bankers={[{id: 'preview', loanId: requestId as string, amount: loanRequest?.amount || 500000, investorName: 'Ejemplo de Inversionista' } as any]}
            isReadOnly
            previewSignatureUrl={!isSignatureEmpty && sigPadRef.current ? sigPadRef.current.getTrimmedCanvas().toDataURL('image/png') : null}
            previewBorrowerName={user?.displayName || 'Deudor'}
          />
      )}
    </div>
  );
}

    
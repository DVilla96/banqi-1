
'use client';

import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Bell, Shield, UserCheck, Briefcase, Banknote, FileText, Link as LinkIcon, MapPin } from "lucide-react";
import { useAuth, UserProfile } from "@/hooks/use-auth";
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

const formatCurrency = (value: number) => {
    if (!value || isNaN(value)) return 'N/A';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const toTitleCase = (str: string | undefined | null): string => {
    if (!str) return '';
    return str.replace(
        /\w\S*/g,
        (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
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


export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loanDocuments, setLoanDocuments] = useState<any>(null);

  useEffect(() => {
    const fetchProfileData = async () => {
      if (user) {
        setLoading(true);
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        
        let userProfile: UserProfile | null = null;
        if (userSnap.exists()) {
          userProfile = userSnap.data() as UserProfile;
          setProfile(userProfile);
        } else {
          setProfile({ email: user.email || '' });
        }

        // If the user profile is verified, try to fetch their submitted documents
        if (userProfile?.idNumber) {
            const loanQuery = query(
                collection(db, 'loanRequests'),
                where('requesterId', '==', user.uid),
                where('documentUrls', '!=', null),
                orderBy('createdAt', 'desc'),
                limit(1)
            );
            const loanDocsSnapshot = await getDocs(loanQuery);
            if (!loanDocsSnapshot.empty) {
                const latestLoanWithDocs = loanDocsSnapshot.docs[0].data();
                setLoanDocuments(latestLoanWithDocs.documentUrls);
            }
        }
        
        setLoading(false);
      }
    };

    if (!authLoading) {
      fetchProfileData();
    }
  }, [user, authLoading]);

  const getInitials = (firstName?: string, lastName?: string) => {
    const first = firstName?.[0] || '';
    const last = lastName?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }
  
  const orderedDocumentEntries = loanDocuments ? documentOrder
        .map(key => {
            const docData = loanDocuments?.[key];
            if (!docData) return null;
            const url = typeof docData === 'object' ? docData.url : typeof docData === 'string' ? docData : undefined;
            if (!url) return null;
            return { key, name: docKeyToName[key], url };
        })
        .filter((entry): entry is { key: string; name: string; url: string; } => entry !== null) : [];


  const isVerified = !!profile?.idNumber;

  if (loading || authLoading) {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Tu perfil</h1>
                <p className="text-muted-foreground">Administra la configuración y preferencias de tu cuenta.</p>
            </div>
             <Card>
                <CardHeader>
                    <div className="flex items-center gap-4">
                        <Skeleton className="h-20 w-20 rounded-full" />
                        <div className='space-y-2'>
                            <Skeleton className="h-7 w-48" />
                            <Skeleton className="h-4 w-64" />
                            <Skeleton className="h-8 w-32" />
                        </div>
                    </div>
                </CardHeader>
                 <CardContent className="space-y-6">
                    <Skeleton className="h-40 w-full" />
                 </CardContent>
             </Card>
        </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tu perfil</h1>
        <p className="text-muted-foreground">Administra la configuración y preferencias de tu cuenta.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row items-start gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profile?.photoUrl} alt="Usuario" />
              <AvatarFallback>{getInitials(profile?.firstName, profile?.lastName)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <CardTitle className="text-2xl">{toTitleCase(profile?.firstName) || 'Usuario'} {toTitleCase(profile?.lastName) || ''}</CardTitle>
              <CardDescription>{profile?.email}</CardDescription>
              {isVerified && (
                  <div className='mt-2 flex items-center gap-2 text-sm font-semibold text-green-600 bg-green-50 p-2 rounded-md border border-green-200'>
                      <UserCheck className='h-5 w-5'/>
                      <span>Identidad verificada</span>
                  </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
            <Separator />
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Información personal</h3>
              <p className="text-sm text-muted-foreground">
                {isVerified 
                  ? 'Esta información ha sido verificada a través de tus documentos y no puede ser editada.'
                  : 'Completa una solicitud de crédito o verifica tu perfil como inversionista para completar tu información.'
                }
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Nombre(s)</Label>
                  <Input id="firstName" value={toTitleCase(profile?.firstName) || ''} disabled />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="lastName">Apellido(s)</Label>
                  <Input id="lastName" value={toTitleCase(profile?.lastName) || ''} disabled />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="idNumber">Cédula</Label>
                  <Input id="idNumber" value={profile?.idNumber || 'No verificado'} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="idIssuePlace">Lugar de expedición</Label>
                  <Input id="idIssuePlace" value={profile?.idIssuePlace || 'No verificado'} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Fecha de nacimiento</Label>
                  <Input id="dateOfBirth" value={profile?.dateOfBirth || 'No verificado'} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input id="email" type="email" value={profile?.email || ''} disabled />
                </div>
              </div>
            </div>
            {isVerified && (
              <>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Información laboral verificada</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="employerName">Empleador</Label>
                      <Input id="employerName" value={profile?.employerName || 'N/A'} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="position">Cargo</Label>
                      <Input id="position" value={profile?.position || 'N/A'} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="salary">Salario</Label>
                      <Input id="salary" value={formatCurrency(profile?.salary || 0)} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="startDate">Fecha de inicio</Label>
                      <Input id="startDate" value={profile?.startDate || 'N/A'} disabled />
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-5 w-5 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Información bancaria verificada</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                     <div className="space-y-2">
                      <Label htmlFor="bankName">Banco</Label>
                      <Input id="bankName" value={profile?.bankName || 'N/A'} disabled />
                    </div>
                     <div className="space-y-2">
                      <Label htmlFor="accountType">Tipo de cuenta</Label>
                      <Input id="accountType" value={profile?.accountType || 'N/A'} disabled />
                    </div>
                  </div>
                </div>
                 {orderedDocumentEntries.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <h3 className="text-lg font-semibold">Documentos adjuntos</h3>
                      </div>
                      <div className="space-y-3 rounded-md border p-4">
                        {orderedDocumentEntries.map((doc) => (
                           <div key={doc.key} className="flex items-center justify-between">
                            <p className="font-medium text-sm">{doc.name}</p>
                            <Button asChild variant="outline" size="sm">
                              <Link href={doc.url} target="_blank" rel="noopener noreferrer">
                                <LinkIcon className="mr-2 h-4 w-4" /> Ver
                              </Link>
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            <Separator />
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Notificaciones</h3>
              </div>
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex items-center justify-between">
                    <Label htmlFor="loan-updates">Actualizaciones de préstamos</Label>
                    <Switch id="loan-updates" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="payment-reminders">Recordatorios de pago</Label>
                    <Switch id="payment-reminders" defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                    <Label htmlFor="platform-news">Noticias de la plataforma</Label>
                    <Switch id="platform-news" />
                </div>
              </div>
            </div>
             <Separator />
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Seguridad</h3>
              </div>
              <div className="space-y-3">
                <Button variant="outline">Cambiar contraseña</Button>
              </div>
            </div>

            <CardFooter className="p-0 pt-4">
                <Button disabled>Guardar cambios</Button>
            </CardFooter>
        </CardContent>
      </Card>
    </div>
  )
}

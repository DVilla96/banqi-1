
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useForm, SubmitHandler } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

type InvestorKycModalProps = {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  initialFirstName?: string;
  initialLastName?: string;
};

const kycSchema = z.object({
  firstName: z.string().min(1, { message: 'El nombre es requerido.' }),
  lastName: z.string().min(1, { message: 'El apellido es requerido.' }),
  idNumber: z.string().min(1, { message: 'El número de cédula es requerido.' }),
  idIssuePlace: z.string().min(1, { message: 'El lugar de expedición es requerido.' }),
});

type KycFormValues = z.infer<typeof kycSchema>;

export default function InvestorKycModal({ isOpen, onClose, userId, initialFirstName, initialLastName }: InvestorKycModalProps) {
  const { toast } = useToast();
  const { 
    register, 
    handleSubmit, 
    formState: { errors, isSubmitting } 
  } = useForm<KycFormValues>({
    resolver: zodResolver(kycSchema),
    defaultValues: {
      firstName: initialFirstName || '',
      lastName: initialLastName || '',
      idNumber: '',
      idIssuePlace: '',
    }
  });

  const onSubmit: SubmitHandler<KycFormValues> = async (data) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        firstName: data.firstName,
        lastName: data.lastName,
        idNumber: data.idNumber,
        idIssuePlace: data.idIssuePlace,
      });

      toast({
        title: '¡Verificación Completa!',
        description: 'Tu información ha sido guardada. Ahora puedes continuar con tu inversión.',
      });
      onClose();
    } catch (error) {
      console.error("Error updating user KYC info:", error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar tu información. Por favor, inténtalo de nuevo.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <ShieldCheck className="h-7 w-7" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Verifica tu Identidad</DialogTitle>
          <DialogDescription className="text-center">
            Para poder invertir, necesitamos que completes tu perfil. Solo tendrás que hacerlo una vez.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto pr-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <Alert variant="destructive" className="border-yellow-500/50 text-yellow-700 dark:border-yellow-500 [&>svg]:text-yellow-700">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle className="font-bold">¡Atención!</AlertTitle>
                    <AlertDescription>
                       Esta información se utilizará para generar los pagarés legales a tu nombre. Por favor, asegúrate de que todos los datos coincidan exactamente con tu documento de identidad.
                    </AlertDescription>
                </Alert>
                
                <div className="space-y-1">
                    <Label htmlFor="firstName">Nombre(s)</Label>
                    <Input id="firstName" {...register('firstName')} />
                    {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
                </div>
                <div className="space-y-1">
                    <Label htmlFor="lastName">Apellido(s)</Label>
                    <Input id="lastName" {...register('lastName')} />
                    {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
                </div>
                <div className="space-y-1">
                    <Label htmlFor="idNumber">Número de Cédula</Label>
                    <Input id="idNumber" {...register('idNumber')} />
                    {errors.idNumber && <p className="text-xs text-destructive">{errors.idNumber.message}</p>}
                </div>
                <div className="space-y-1">
                    <Label htmlFor="idIssuePlace">Lugar de Expedición</Label>
                    <Input id="idIssuePlace" {...register('idIssuePlace')} />
                    {errors.idIssuePlace && <p className="text-xs text-destructive">{errors.idIssuePlace.message}</p>}
                </div>
                 <DialogFooter className='pt-4'>
                    <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar y Continuar
                    </Button>
                </DialogFooter>
            </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

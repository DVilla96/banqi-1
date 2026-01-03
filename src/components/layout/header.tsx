
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import {
  Bell,
  LogOut,
  PiggyBank,
  User,
  CreditCard,
  Settings,
  LifeBuoy,
  Shield,
  CheckCircle,
  DollarSign,
  ListOrdered,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import React from 'react';
import { useAuth } from '@/hooks/use-auth';

const ADMIN_EMAIL = 's_delrio91@hotmail.com';

export default function Header() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, profile } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast({
        title: "Sesión cerrada",
        description: "Has cerrado sesión correctamente.",
      });
      router.push('/login');
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      toast({
        title: "Error",
        description: "No se pudo cerrar la sesión. Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const getInitials = () => {
    if (!profile) return '..';
    const first = profile.firstName?.[0] || '';
    const last = profile.lastName?.[0] || '';
    return `${first}${last}`.toUpperCase();
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-4">
        <Link href="/portal" className="flex items-center space-x-2">
            <PiggyBank className="h-6 w-6 text-primary" />
            <span className="font-bold">Banqi</span>
        </Link>
        
        <div className="flex items-center space-x-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                    <Bell className="h-5 w-5" />
                    <span className="sr-only">Ver notificaciones</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
                <DropdownMenuSeparator />
                  <DropdownMenuItem className="flex items-start gap-3">
                    <CheckCircle className="text-green-500 mt-1" />
                    <div>
                      <p className="font-medium">¡Crédito Fondeado!</p>
                      <p className="text-xs text-muted-foreground">Tu préstamo para 'Viaje a la costa' ha sido completamente fondeado.</p>
                    </div>
                  </DropdownMenuItem>
                   <DropdownMenuItem className="flex items-start gap-3">
                    <DollarSign className="text-blue-500 mt-1" />
                     <div>
                      <p className="font-medium">Pago Recibido</p>
                      <p className="text-xs text-muted-foreground">Recibiste un pago de $150.000 de Ana Sofía para el préstamo 'Renovación'.</p>
                    </div>
                  </DropdownMenuItem>
                   <DropdownMenuItem className="flex items-start gap-3">
                    <PiggyBank className="text-primary mt-1" />
                     <div>
                      <p className="font-medium">Nuevo Inversionista</p>
                      <p className="text-xs text-muted-foreground">Carlos invirtió $500.000 en tu crédito 'Estudios'.</p>
                    </div>
                  </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full">
                <Avatar>
                    <AvatarImage src={profile?.photoUrl} alt="Usuario" className="object-cover" />
                    <AvatarFallback>{getInitials()}</AvatarFallback>
                </Avatar>
                <span className="sr-only">Menú de usuario</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                    <p>Mi Cuenta</p>
                    {user && (
                        <p className="text-xs font-normal text-muted-foreground">
                            {user.email}
                        </p>
                    )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                <Link href="/profile">
                    <User className="mr-2 h-4 w-4" />
                    <span>Perfil</span>
                </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/my-investments">
                        <CreditCard className="mr-2 h-4 w-4" />
                        <span>Mis Inversiones</span>
                    </Link>
                </DropdownMenuItem>
                 <DropdownMenuItem asChild>
                    <Link href="/loans">
                        <LifeBuoy className="mr-2 h-4 w-4" />
                        <span>Préstamos</span>
                    </Link>
                </DropdownMenuItem>
                {user?.email === ADMIN_EMAIL && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                        <Link href="/admin">
                            <Shield className="mr-2 h-4 w-4" />
                            <span>Admin</span>
                        </Link>
                    </DropdownMenuItem>
                     <DropdownMenuItem asChild>
                        <Link href="/admin/queue">
                            <ListOrdered className="mr-2 h-4 w-4" />
                            <span>Cola de Fondeo</span>
                        </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Cerrar Sesión</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

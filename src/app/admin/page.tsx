
'use client';

import { useAuth } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import LoanRequestsTable from '@/components/admin/loan-requests-table';

const ADMIN_EMAIL = 's_delrio91@hotmail.com';

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (user?.email === ADMIN_EMAIL) {
        setIsAuthorized(true);
      } else {
        router.push('/portal');
      }
    }
  }, [user, authLoading, router]);

  if (authLoading || !isAuthorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Verificando autorización...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
       <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Shield className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Panel de Administrador</h1>
                <p className="text-muted-foreground">Gestiona las solicitudes de crédito.</p>
              </div>
          </div>
      </div>
      <LoanRequestsTable />
    </div>
  );
}

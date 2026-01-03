
"use client";

import * as React from 'react';
import { usePathname } from 'next/navigation';
import Header from '@/components/layout/header';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Loader2 } from 'lucide-react';

const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];

export function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  
  React.useEffect(() => {
    if (loading) {
      return; 
    }

    const isAuthRoute = AUTH_ROUTES.includes(pathname);

    if (user && isAuthRoute) {
      router.push('/portal');
      return;
    }

    if (!user && !isAuthRoute) {
        router.push('/login');
        return;
    }

  }, [user, loading, pathname, router]);


  const isAuthRoute = AUTH_ROUTES.includes(pathname);
  
  // While loading, or if we are about to redirect, show a loading screen
  // This avoids a flash of the wrong content.
  if (loading || (!user && !isAuthRoute) || (user && isAuthRoute)) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
    )
  }

  if (isAuthRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        {children}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
    </div>
  );
}

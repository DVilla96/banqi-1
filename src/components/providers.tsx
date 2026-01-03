"use client";

import { AuthProvider } from "@/hooks/use-auth";
import { SimulationProvider } from "@/hooks/use-simulation-date";
import { MainLayout } from "@/components/layout/main-layout";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <SimulationProvider>
                <MainLayout>{children}</MainLayout>
            </SimulationProvider>
        </AuthProvider>
    );
}

export function ToasterWrapper() {
    return <Toaster />;
}

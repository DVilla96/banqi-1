"use client";

import dynamic from "next/dynamic";
import { ReactNode } from "react";

// Dynamically import Providers with SSR disabled
const ProvidersInner = dynamic(
    () => import("@/components/providers").then((mod) => mod.Providers),
    { ssr: false }
);

const ToasterInner = dynamic(
    () => import("@/components/providers").then((mod) => mod.ToasterWrapper),
    { ssr: false }
);

export function ClientProviders({ children }: { children: ReactNode }) {
    return (
        <>
            <ProvidersInner>{children}</ProvidersInner>
            <ToasterInner />
        </>
    );
}

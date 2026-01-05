'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Trophy, Star, Heart, ArrowRight, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface CelebrationCardProps {
    loanAmount?: number;
    duration?: string;
    interestPaid?: number;
}

export default function CelebrationCard({ loanAmount, duration, interestPaid }: CelebrationCardProps) {
    useEffect(() => {
        // Trigger confetti on mount
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

        const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

        const interval: any = setInterval(function () {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);

        return () => {
            clearInterval(interval);
        };
    }, []);

    const formatCurrency = (val?: number) => {
        if (val === undefined) return '-';
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            maximumFractionDigits: 0
        }).format(val);
    };

    return (
        <Card className="w-full max-w-md overflow-hidden border-2 border-yellow-400/50 shadow-2xl bg-gradient-to-br from-purple-50 to-white dark:from-slate-900 dark:to-slate-800">
            <CardContent className="p-0">
                <div className="relative p-8 text-center space-y-6">
                    {/* Background Decorative Circles */}
                    <div className="absolute top-0 left-0 w-64 h-64 bg-yellow-200/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
                    <div className="absolute bottom-0 right-0 w-64 h-64 bg-purple-200/20 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />

                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 260, damping: 20 }}
                        className="relative mx-auto w-24 h-24 bg-gradient-to-br from-yellow-300 to-yellow-500 rounded-full flex items-center justify-center shadow-lg mb-4"
                    >
                        <Trophy className="w-12 h-12 text-white" />
                    </motion.div>

                    <div className="space-y-2 relative z-10">
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-indigo-600"
                        >
                            ¡Deuda Saldada!
                        </motion.h2>
                        <p className="text-muted-foreground text-lg">
                            Has completado tu ciclo con éxito.
                        </p>
                    </div>

                    {/* Stats Grid */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="grid grid-cols-3 gap-2 py-2"
                    >
                        <div className="flex flex-col items-center p-2 bg-white/60 dark:bg-black/20 rounded-lg shadow-sm">
                            <span className="text-xs text-muted-foreground font-medium">Monto Total</span>
                            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatCurrency(loanAmount)}</span>
                        </div>
                        <div className="flex flex-col items-center p-2 bg-white/60 dark:bg-black/20 rounded-lg shadow-sm">
                            <span className="text-xs text-muted-foreground font-medium">Duración</span>
                            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{duration || '-'}</span>
                        </div>
                        <div className="flex flex-col items-center p-2 bg-white/60 dark:bg-black/20 rounded-lg shadow-sm">
                            <span className="text-xs text-muted-foreground font-medium">Intereses</span>
                            <span className="text-sm font-bold text-green-600 dark:text-green-400">{formatCurrency(interestPaid)}</span>
                        </div>
                    </motion.div>

                    {/* Trust Score Gamification */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5 }}
                        className="bg-white/50 dark:bg-black/20 backdrop-blur-sm rounded-xl p-4 border border-indigo-100 dark:border-indigo-900/50 shadow-inner"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
                                <ShieldCheck className="w-4 h-4" />
                                Nivel de Confianza
                            </span>
                            <span className="text-2xl font-bold text-indigo-600">Alta</span>
                        </div>
                        <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                            <motion.div
                                className="h-full bg-gradient-to-r from-yellow-400 to-orange-500"
                                initial={{ width: 0 }}
                                animate={{ width: "100%" }}
                                transition={{ duration: 1.5, ease: "easeOut" }}
                            />
                        </div>
                        <p className="text-xs text-left mt-2 text-muted-foreground">
                            ¡Fantástico! Tu historial impecable aumenta tu reputación en la comunidad.
                        </p>
                    </motion.div>


                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.5 }}
                        className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-100 dark:border-purple-800"
                    >
                        <div className="flex items-start gap-3">
                            <Heart className="w-6 h-6 text-pink-500 shrink-0 mt-1" />
                            <div className="text-left">
                                <h4 className="font-semibold text-purple-900 dark:text-purple-100">La comunidad te agradece</h4>
                                <p className="text-sm text-purple-700 dark:text-purple-300">
                                    Tu cumplimiento fortalece la confianza de todos. Gracias a ti, más personas podrán acceder a oportunidades.
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <div className="pt-4 flex flex-col sm:flex-row gap-3">
                        <Button asChild className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-none h-12 text-base group">
                            <Link href="/request">
                                Nuevo Préstamo
                                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </Button>
                        <Button asChild variant="outline" className="flex-1 h-12 text-base border-2 hover:bg-purple-50 hover:text-purple-700 dark:hover:bg-purple-900/30">
                            <Link href="/my-loan/history">
                                Ver Historial
                            </Link>
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}



'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileSignature, Check, Users, Landmark, Wallet, Percent, Calendar, HandCoins, Calculator, Download, PiggyBank } from 'lucide-react';
import type { Investment, Loan, UserProfile } from '@/lib/types';
import { Separator } from '../ui/separator';
import { useAuth } from '@/hooks/use-auth';
import { Checkbox } from '../ui/checkbox';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Image from 'next/image';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import jsPDF from 'jspdf';

type EnrichedInvestment = Investment & {
    investorFirstName?: string;
    investorLastName?: string;
    investorName?: string;
};

type PromissoryNoteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  investment: EnrichedInvestment;
  bankers: EnrichedInvestment[]; // List of underlying bankers for reinvestments
  onConfirm?: (investment: EnrichedInvestment) => Promise<void>;
  isConfirming?: boolean;
  isReadOnly?: boolean;
  previewSignatureUrl?: string | null; // Optional signature URL for preview mode
  previewBorrowerName?: string; // Optional borrower name for preview mode
};

const formatCurrency = (value: number | undefined) => {
    if (value === undefined || isNaN(value)) return '$0';
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
};

const numberToWords = (num: number): string => {
    const units = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
    const teens = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
    const tens = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

    if (num === 0) return 'cero';
    if (num < 0) return 'menos ' + numberToWords(Math.abs(num));

    let words = '';

    if (Math.floor(num / 1000000) > 0) {
        words += (Math.floor(num / 1000000) === 1 ? 'un millón' : numberToWords(Math.floor(num / 1000000)) + ' millones');
        num %= 1000000;
        if (num > 0) words += ' ';
    }

    if (Math.floor(num / 1000) > 0) {
        if (Math.floor(num / 1000) === 1) {
            words += 'mil';
        } else {
            words += numberToWords(Math.floor(num / 1000)) + ' mil';
        }
        num %= 1000;
        if (num > 0) words += ' ';
    }

    if (Math.floor(num / 100) > 0) {
        if (num === 100) {
            words += 'cien';
        } else {
            words += hundreds[Math.floor(num / 100)];
        }
        num %= 100;
        if (num > 0) words += ' ';
    }

    if (num > 0) {
        if (num < 10) {
            words += units[num];
        } else if (num < 20) {
            words += teens[num - 10];
        } else {
            words += tens[Math.floor(num / 10)];
            if (num % 10 > 0) {
                words += ' y ' + units[num % 10];
            }
        }
    }

    return words.trim();
};

export default function PromissoryNoteModal({ isOpen, onClose, investment, bankers, onConfirm, isConfirming, isReadOnly = false, previewSignatureUrl, previewBorrowerName }: PromissoryNoteModalProps) {
    const [borrowerProfile, setBorrowerProfile] = useState<UserProfile | null>(null);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [loanDetails, setLoanDetails] = useState<Loan | null>(null);
    const [bankerProfiles, setBankerProfiles] = useState<Record<string, UserProfile>>({});
    const [loadingData, setLoadingData] = useState(true);
    const pdfRef = useRef<HTMLDivElement>(null);

    // Use preview signature if provided, otherwise use loan signature
    const displaySignatureUrl = previewSignatureUrl || loanDetails?.signatureUrl;

    useEffect(() => {
        const fetchAllData = async () => {
            if (!isOpen || !investment.loanId || bankers.length === 0) return;
            setLoadingData(true);
            console.log("[PromissoryNoteModal] Received bankers:", bankers.map(b => ({ investorId: b.investorId, name: b.investorName, amount: b.amount })));

            try {
                // Fetch Loan Details
                const loanRef = doc(db, 'loanRequests', investment.loanId);
                const loanSnap = await getDoc(loanRef);
                let loanData: Loan | null = null;
                if (loanSnap.exists()) {
                    loanData = loanSnap.data() as Loan;
                    console.log("[DEBUG] Fetched Loan Details:", loanData);
                    console.log("[DEBUG] documentUrls:", loanData.documentUrls);
                    console.log("[DEBUG] documentUrls.signature:", loanData.documentUrls?.signature);
                    
                    // Buscar firma en múltiples ubicaciones posibles
                    const sigData = loanData.documentUrls?.signature;
                    let signatureUrl: string | null = null;
                    
                    if (typeof sigData === 'string') {
                        signatureUrl = sigData;
                    } else if (sigData && typeof sigData === 'object' && 'url' in sigData) {
                        signatureUrl = (sigData as any).url;
                    } else if ((loanData as any).signatureUrl) {
                        signatureUrl = (loanData as any).signatureUrl;
                    }
                    
                    console.log("[DEBUG] Final signatureUrl:", signatureUrl);
                    
                    setLoanDetails({
                        ...loanData,
                        signatureUrl: signatureUrl
                    });

                     // Fetch Borrower Profile using requesterId from the loan
                    if (loanData.requesterId) {
                        const borrowerRef = doc(db, 'users', loanData.requesterId);
                        const borrowerSnap = await getDoc(borrowerRef);
                        if (borrowerSnap.exists()) {
                            const borrowerData = borrowerSnap.data() as UserProfile;
                             console.log(`[DEBUG] Fetched Borrower Profile for ${loanData.requesterId}:`, borrowerData);
                            setBorrowerProfile(borrowerData);
                        } else {
                             console.error("Borrower profile not found!");
                        }
                    }
                } else {
                    console.error("Loan document not found!");
                }

                // Fetch Banker Profiles
                const profiles: Record<string, UserProfile> = {};
                for (const banker of bankers) {
                    if (banker.investorId && !profiles[banker.investorId]) {
                        console.log(`[DEBUG] Fetching profile for banker ID: ${banker.investorId}`);
                        const bankerRef = doc(db, 'users', banker.investorId);
                        const bankerSnap = await getDoc(bankerRef);
                        if (bankerSnap.exists()) {
                            const bankerData = bankerSnap.data() as UserProfile;
                            console.log(`[DEBUG] Fetched Banker Profile for ${banker.investorId}:`, bankerData);
                            profiles[banker.investorId] = bankerData;
                        } else {
                             console.warn(`Banker profile not found for ID: ${banker.investorId}`);
                        }
                    }
                }
                setBankerProfiles(profiles);
            } catch (error) {
                console.error("Error fetching promissory note data:", error);
            } finally {
                setLoadingData(false);
                console.log("--- End Promissory Note Modal ---");
            }
        };

        fetchAllData();
    }, [isOpen, investment.loanId, bankers]);


    const handleDownloadPDF = async () => {
        const input = pdfRef.current;
        if (!input) return;

        // Create PDF with professional design
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        
        // Colors - Banqi brand
        const primaryColor: [number, number, number] = [123, 97, 255]; // #7B61FF
        const lightPurple: [number, number, number] = [194, 163, 206]; // #C2A3CE
        const darkText: [number, number, number] = [31, 41, 55]; // gray-800
        const grayText: [number, number, number] = [107, 114, 128]; // gray-500
        
        // Helper to set colors
        const setColor = (color: [number, number, number]) => {
            pdf.setTextColor(color[0], color[1], color[2]);
        };

        // Draw piggy bank watermark (simplified)
        const drawPiggyWatermark = (x: number, y: number, size: number, opacity: number = 0.05) => {
            // Light watermark color
            pdf.setFillColor(123, 97, 255);
            pdf.setGState(new (pdf as any).GState({ opacity }));
            
            // Main body (ellipse-like shape using circle)
            pdf.circle(x, y, size, 'F');
            // Snout
            pdf.circle(x + size * 0.7, y, size * 0.35, 'F');
            // Ear
            pdf.circle(x - size * 0.5, y - size * 0.7, size * 0.25, 'F');
            // Legs
            pdf.rect(x - size * 0.5, y + size * 0.6, size * 0.2, size * 0.4, 'F');
            pdf.rect(x + size * 0.3, y + size * 0.6, size * 0.2, size * 0.4, 'F');
            
            // Reset opacity
            pdf.setGState(new (pdf as any).GState({ opacity: 1 }));
        };

        // Add watermark pattern
        drawPiggyWatermark(pdfWidth / 2, pdfHeight / 2, 40, 0.08);
        
        // Header bar with gradient effect
        pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.rect(0, 0, pdfWidth, 38, 'F');
        
        // Draw mini piggy logo in header
        pdf.setFillColor(255, 255, 255);
        pdf.circle(22, 19, 8, 'F');
        pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.circle(22, 19, 6, 'F');
        pdf.setFillColor(255, 255, 255);
        // Simplified piggy inside circle
        pdf.circle(22, 19, 4, 'F');
        pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.circle(22, 19, 3, 'F');
        pdf.setFillColor(255, 255, 255);
        pdf.circle(24.5, 19, 1.2, 'F'); // snout
        pdf.circle(20, 17, 0.8, 'F'); // ear
        
        // Logo text
        pdf.setFontSize(24);
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Banqi', 32, 23);
        
        // Document title on right
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'normal');
        pdf.text('PAGARÉ ELECTRÓNICO', pdfWidth - 15, 16, { align: 'right' });
        pdf.setFontSize(8);
        pdf.text(`No. ${investment.loanId?.slice(0, 12).toUpperCase() || 'N/A'}`, pdfWidth - 15, 22, { align: 'right' });
        pdf.text(`Fecha: ${transactionDate}`, pdfWidth - 15, 28, { align: 'right' });
        
        // Decorative line under header
        pdf.setDrawColor(lightPurple[0], lightPurple[1], lightPurple[2]);
        pdf.setLineWidth(0.8);
        pdf.line(15, 45, pdfWidth - 15, 45);
        
        let yPosition = 55;
        
        // Transaction amount box
        pdf.setFillColor(248, 247, 250);
        pdf.roundedRect(15, yPosition, pdfWidth - 30, 20, 3, 3, 'F');
        pdf.setFontSize(10);
        setColor(grayText);
        pdf.text('Monto Total de la Transacción:', 20, yPosition + 8);
        pdf.setFontSize(18);
        setColor(primaryColor);
        pdf.setFont('helvetica', 'bold');
        pdf.text(formatCurrency(investment.amount), pdfWidth - 20, yPosition + 13, { align: 'right' });
        
        yPosition += 30;
        
        // Date
        pdf.setFontSize(9);
        setColor(grayText);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Fecha de emisión: ${transactionDate}`, 15, yPosition);
        
        yPosition += 12;
        
        // Pagarés section
        bankers.forEach((banker, index) => {
            const bankerProfile = banker.investorId ? bankerProfiles[banker.investorId] : null;
            const bankerName = toTitleCase(`${bankerProfile?.firstName || ''} ${bankerProfile?.lastName || ''}`.trim()) || toTitleCase(banker.investorName) || 'Banquero';
            const bankerIdNumber = bankerProfile?.idNumber || '[Cédula del Banquero]';
            const bankerAmount = banker.amount || 0;
            const amountInWords = numberToWords(bankerAmount).toLowerCase();
            
            // Check if we need a new page
            if (yPosition > pdfHeight - 80) {
                pdf.addPage();
                yPosition = 20;
                // Add watermark to new page
                pdf.setFontSize(80);
                pdf.setTextColor(240, 240, 245);
                pdf.text('BANQI', pdfWidth / 2, pdfHeight / 2, { 
                    align: 'center',
                    angle: 45
                });
            }
            
            // Pagaré header
            pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
            pdf.roundedRect(15, yPosition, pdfWidth - 30, 10, 2, 2, 'F');
            pdf.setFontSize(10);
            pdf.setTextColor(255, 255, 255);
            pdf.setFont('helvetica', 'bold');
            pdf.text(`Pagaré ${index + 1} - A favor de: ${bankerName}`, 20, yPosition + 7);
            pdf.text(formatCurrency(bankerAmount), pdfWidth - 20, yPosition + 7, { align: 'right' });
            
            yPosition += 15;
            
            // Pagaré content
            pdf.setFontSize(9);
            setColor(darkText);
            pdf.setFont('helvetica', 'normal');
            
            const paragraph1 = `Yo, ${borrowerName}, identificado(a) con Cédula de Ciudadanía No. ${borrowerProfile?.idNumber || '[Cédula del Deudor]'}, mayor de edad y domiciliado(a) en Colombia, por medio del presente documento me obligo a pagar incondicionalmente a la orden de ${bankerName}${bankerName !== 'Banqi (Plataforma)' && bankerIdNumber !== '[Cédula del Banquero]' ? ` (identificado(a) con C.C. No. ${bankerIdNumber})` : ''}, la suma de ${formatCurrency(bankerAmount)} (${amountInWords} pesos m/cte).`;
            
            const splitText1 = pdf.splitTextToSize(paragraph1, pdfWidth - 40);
            pdf.text(splitText1, 20, yPosition);
            yPosition += splitText1.length * 4 + 4;
            
            const paragraph2 = `El pago de esta obligación se realizará de acuerdo con los términos y el plan de pagos del crédito administrado por la plataforma Banqi.`;
            const splitText2 = pdf.splitTextToSize(paragraph2, pdfWidth - 40);
            pdf.text(splitText2, 20, yPosition);
            yPosition += splitText2.length * 4 + 4;
            
            const paragraph3 = `En caso de mora en el pago de una o más cuotas, me obligo a pagar sobre el saldo de capital vencido la misma tasa de interés remuneratoria pactada, es decir, del ${loanDetails?.interestRate || '2.1'}% efectivo mensual, sin que esto constituya una sanción y sin exceder los límites legales.`;
            const splitText3 = pdf.splitTextToSize(paragraph3, pdfWidth - 40);
            pdf.text(splitText3, 20, yPosition);
            yPosition += splitText3.length * 4 + 4;
            
            const paragraph4 = `Declaro haber recibido el monto anteriormente mencionado a entera satisfacción en la fecha de ${transactionDate}. En constancia de lo anterior, suscribo el presente documento mediante mi firma electrónica y la aceptación en la plataforma Banqi, reconociendo su plena validez y fuerza vinculante de conformidad con la Ley 527 de 1999 y demás normas aplicables.`;
            const splitText4 = pdf.splitTextToSize(paragraph4, pdfWidth - 40);
            pdf.text(splitText4, 20, yPosition);
            yPosition += splitText4.length * 4 + 10;
            
            // Separator line
            pdf.setDrawColor(230, 230, 230);
            pdf.setLineWidth(0.3);
            pdf.line(20, yPosition, pdfWidth - 20, yPosition);
            yPosition += 10;
        });
        
        // Signature section
        if (yPosition > pdfHeight - 70) {
            pdf.addPage();
            yPosition = 30;
            // Add watermark to new page
            drawPiggyWatermark(pdfWidth / 2, pdfHeight / 2, 40, 0.08);
        }
        
        // Signature box
        pdf.setFillColor(248, 247, 250);
        pdf.roundedRect(pdfWidth - 90, yPosition, 75, 45, 3, 3, 'F');
        pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.setLineWidth(0.3);
        pdf.roundedRect(pdfWidth - 90, yPosition, 75, 45, 3, 3, 'S');
        
        pdf.setFontSize(9);
        setColor(darkText);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Firma (Deudor):', pdfWidth - 85, yPosition + 8);
        
        // Add signature image if available (use displaySignatureUrl)
        const signatureToUse = displaySignatureUrl;
        console.log('[PDF] signatureToUse:', signatureToUse);
        
        let signatureLoaded = false;
        if (signatureToUse) {
            try {
                // Intentar cargar la imagen usando fetch para evitar CORS
                const response = await fetch(signatureToUse);
                const blob = await response.blob();
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });
                
                console.log('[PDF] Signature base64 loaded, length:', base64.length);
                
                if (base64 && base64.startsWith('data:')) {
                    pdf.addImage(base64, 'PNG', pdfWidth - 80, yPosition + 10, 55, 18);
                    signatureLoaded = true;
                }
            } catch (e) {
                console.error('[PDF] Error loading signature with fetch:', e);
                
                // Fallback: intentar con Image element
                try {
                    const img = new window.Image();
                    img.crossOrigin = 'anonymous';
                    img.src = signatureToUse;
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        setTimeout(reject, 5000); // timeout 5s
                    });
                    if (img.complete && img.naturalWidth > 0) {
                        pdf.addImage(img, 'PNG', pdfWidth - 80, yPosition + 10, 55, 18);
                        signatureLoaded = true;
                    }
                } catch (e2) {
                    console.error('[PDF] Error loading signature with Image:', e2);
                }
            }
        }
        
        if (!signatureLoaded) {
            pdf.setFontSize(8);
            setColor(grayText);
            pdf.text('(Pendiente de firma)', pdfWidth - 85, yPosition + 20);
        }
        
        pdf.setFont('helvetica', 'bold');
        setColor(darkText);
        pdf.text(previewBorrowerName || borrowerName, pdfWidth - 85, yPosition + 34);
        pdf.setFont('helvetica', 'normal');
        setColor(grayText);
        pdf.setFontSize(8);
        pdf.text(`C.C. ${borrowerProfile?.idNumber || '[Cédula]'}`, pdfWidth - 85, yPosition + 39);
        if (signatureLoaded) {
            pdf.text('(Firmado electrónicamente)', pdfWidth - 85, yPosition + 43);
        }
        
        // Footer with branding
        const footerY = pdfHeight - 20;
        
        // Footer background
        pdf.setFillColor(248, 247, 250);
        pdf.rect(0, footerY - 8, pdfWidth, 28, 'F');
        
        // Footer line
        pdf.setDrawColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.setLineWidth(0.5);
        pdf.line(15, footerY - 8, pdfWidth - 15, footerY - 8);
        
        // Mini piggy in footer
        pdf.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        pdf.circle(pdfWidth / 2, footerY - 2, 2.5, 'F');
        pdf.setFillColor(255, 255, 255);
        pdf.circle(pdfWidth / 2 + 1.5, footerY - 2, 0.8, 'F');
        
        pdf.setFontSize(7);
        setColor(grayText);
        pdf.text('Documento generado electrónicamente por Banqi - Plataforma de préstamos P2P', pdfWidth / 2, footerY + 4, { align: 'center' });
        pdf.text('Este documento tiene plena validez legal según la Ley 527 de 1999 y demás normas aplicables', pdfWidth / 2, footerY + 8, { align: 'center' });
        
        pdf.save(`pagare-banqi-${investment.loanId?.slice(0, 8) || 'doc'}.pdf`);
    };

    const toTitleCase = (str: string | undefined | null): string => {
        if (!str) return '';
        return str.replace(
            /\w\S*/g,
            (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        );
    };

    const borrowerName = toTitleCase(`${borrowerProfile?.firstName || ''} ${borrowerProfile?.lastName || ''}`.trim()) || 'Deudor';

    const handleConfirmClick = () => {
        if (!agreedToTerms || !onConfirm) return;
        onConfirm(investment);
    }

    const dialogTitle = isReadOnly ? "Detalle del pagaré" : "Confirmación de Fondos y Aceptación de Pagarés";
    const dialogDescription = isReadOnly
      ? "Este es el pagaré que aceptaste para esta transacción."
      : "Estás a punto de confirmar la recepción de fondos. Al hacerlo, aceptas y firmas electrónicamente los siguientes pagarés que se generan por esta transacción.";

    const transactionDate = useMemo(() => {
        if (!investment?.createdAt?.seconds) {
            return "la fecha de la transacción";
        }
        const date = new Date(investment.createdAt.seconds * 1000);
        const adjustedDate = new Date(date.valueOf() + date.getTimezoneOffset() * 60000);
        return format(adjustedDate, "dd 'de' MMMM 'de' yyyy", { locale: es });
    }, [investment.createdAt]);
    
    const isProofImage = investment.paymentProofContentType?.startsWith('image/');
    const isProofPdf = investment.paymentProofContentType === 'application/pdf';


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
           <div className="flex justify-center">
             <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <FileSignature className="h-7 w-7" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">{dialogTitle}</DialogTitle>
          <DialogDescription className="text-center">
           {dialogDescription}
          </DialogDescription>
        </DialogHeader>
        
        <div ref={pdfRef} className="my-4 flex-1 min-h-0 max-h-[45vh] overflow-y-auto rounded-lg border p-6 space-y-4 text-sm bg-white text-black">
           
           <div className="flex justify-between items-baseline p-3 bg-gray-100 rounded-lg">
                <span className="text-gray-600">Monto Total de la Transacción:</span>
                <span className="text-2xl font-bold text-purple-700">{formatCurrency(investment.amount)}</span>
            </div>
            
            {loadingData && (
                <div className='flex justify-center items-center py-4'>
                    <Loader2 className="h-5 w-5 animate-spin"/>
                </div>
            )}


            <Accordion type="multiple" className="w-full" defaultValue={bankers.map((_, index) => `item-${index}`)}>
            {bankers.map((banker, index) => {
                const bankerProfile = banker.investorId ? bankerProfiles[banker.investorId] : null;
                const bankerName = toTitleCase(`${bankerProfile?.firstName || ''} ${bankerProfile?.lastName || ''}`.trim()) || toTitleCase(banker.investorName) || 'Banquero';
                const bankerIdNumber = bankerProfile?.idNumber || '[Cédula del Banquero]';
                const bankerAmount = banker.amount || 0;
                const amountInWords = numberToWords(bankerAmount).toLowerCase();
                
                return (
                    <AccordionItem value={`item-${index}`} key={`banker-${index}-${banker.investorId || banker.id || 'unknown'}`}>
                         <AccordionTrigger>
                            <div className='flex-1 flex justify-between items-center pr-4'>
                                <p className="font-semibold flex items-center gap-2">
                                    <Users className='h-4 w-4 text-gray-500' />
                                    Pagaré a favor de: {bankerName}
                                </p>
                                <p className='font-bold text-purple-700'>{formatCurrency(bankerAmount)}</p>
                            </div>
                        </AccordionTrigger>
                         <AccordionContent className="space-y-3 prose prose-sm max-w-none text-gray-700">
                             <p>
                                Yo, <strong>{borrowerName}</strong>, identificado(a) con Cédula de Ciudadanía No. <strong>{borrowerProfile?.idNumber || '[Cédula del Deudor]'}</strong>, mayor de edad y domiciliado(a) en Colombia, por medio del presente documento me obligo a pagar incondicionalmente a la orden de <strong>{bankerName}</strong>{bankerName !== 'Banqi (Plataforma)' && bankerIdNumber !== '[Cédula del Banquero]' ? <> (identificado(a) con C.C. No. <strong>{bankerIdNumber}</strong>)</> : ''}, la suma de <strong>{formatCurrency(bankerAmount)} ({amountInWords} pesos m/cte)</strong>.
                            </p>
                             <p>
                                El pago de esta obligación se realizará de acuerdo con los términos y el plan de pagos del crédito administrado por la plataforma Banqi.
                            </p>
                            <p>
                               En caso de mora en el pago de una o más cuotas, me obligo a pagar sobre el saldo de capital vencido la misma tasa de interés remuneratoria pactada, es decir, del {loanDetails?.interestRate}% efectivo mensual, sin que esto constituya una sanción y sin exceder los límites legales.
                            </p>
                             <p>
                                Declaro haber recibido el monto anteriormente mencionado a entera satisfacción en la fecha de <strong>{transactionDate}</strong>. En constancia de lo anterior, suscribo el presente documento mediante mi firma electrónica y la aceptación en la plataforma Banqi, reconociendo su plena validez y fuerza vinculante de conformidad con la Ley 527 de 1999 y demás normas aplicables.
                            </p>
                        </AccordionContent>
                    </AccordionItem>
                )
            })}
            </Accordion>


            <Separator className='my-4 bg-gray-200' />

            <div className='grid grid-cols-2 gap-4 items-end'>
                <div className='space-y-2'>
                    {/* Solo mostrar comprobante si hay URL y no es exclusivamente Banqi */}
                    {investment.paymentProofUrl && bankers.some(b => {
                        const bankerProfile = b.investorId ? bankerProfiles[b.investorId] : null;
                        const bankerName = `${bankerProfile?.firstName || ''} ${bankerProfile?.lastName || ''}`.trim() || b.investorName || '';
                        return bankerName !== '' && bankerName !== 'Banqi (Plataforma)';
                    }) ? (
                        <>
                            <p className='font-semibold'>Anexo - Comprobante de Pago:</p>
                            <div>
                                {isProofImage && (
                                    <a href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer" className="block relative aspect-[4/3] w-full overflow-hidden rounded-md border hover:ring-2 hover:ring-purple-500">
                                        <img 
                                            src={investment.paymentProofUrl} 
                                            alt="Comprobante de pago" 
                                            className="w-full h-full object-contain"
                                        />
                                    </a>
                                )}
                                {isProofPdf && (
                                    <Button asChild variant="outline">
                                        <a href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                                            <FileSignature className="mr-2 h-4 w-4"/> Ver Comprobante (PDF)
                                        </a>
                                    </Button>
                                )}
                                {!isProofImage && !isProofPdf && (
                                     <Button asChild variant="outline">
                                        <a href={investment.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                                            <FileSignature className="mr-2 h-4 w-4"/> Ver Comprobante
                                        </a>
                                    </Button>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <p className='font-semibold text-purple-700'>Estudio de Crédito</p>
                            <p className='text-xs text-gray-500'>
                                Este pagaré corresponde al costo del estudio de crédito realizado por Banqi para la evaluación y aprobación del préstamo.
                            </p>
                        </>
                    )}
                </div>
                 <div className='space-y-2 text-right'>
                    <p className='font-semibold'>Firma (Deudor):</p>
                    {displaySignatureUrl ? (
                        <div className="relative h-20 w-full">
                            <Image 
                                src={displaySignatureUrl}
                                alt="Firma del deudor"
                                fill
                                style={{ objectFit: 'contain' }}
                            />
                        </div>
                    ) : <p className='text-xs text-gray-500'>Pendiente de firma</p>}
                    <p className='font-semibold'>{previewBorrowerName || borrowerName}</p>
                    <p className='text-gray-500'>C.C. {borrowerProfile?.idNumber || '[Cédula del Deudor]'}</p>
                    {displaySignatureUrl && <p className='text-gray-500'>(Aceptado electrónicamente)</p>}
                </div>
            </div>
        </div>

        {!isReadOnly && (
            <div className="flex items-center space-x-2 my-4">
                <Checkbox id="terms" checked={agreedToTerms} onCheckedChange={(checked) => setAgreedToTerms(Boolean(checked))} />
                <label
                    htmlFor="terms"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                    He verificado mi cuenta bancaria, he recibido la transferencia y acepto los términos de los pagarés.
                </label>
            </div>
        )}


        <DialogFooter className="pt-4 flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={isConfirming}>
            {isReadOnly ? 'Cerrar' : 'Cancelar'}
            </Button>
            <Button type="button" variant="secondary" onClick={handleDownloadPDF}>
                <Download className="mr-2 h-4 w-4" />
                Descargar como PDF
            </Button>
          {!isReadOnly && onConfirm && (
             <Button type="submit" onClick={handleConfirmClick} disabled={isConfirming || !agreedToTerms}>
                {isConfirming ? (
                    <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Confirmando...
                    </>
                ) : (
                    <>
                        <Check className="mr-2 h-4 w-4" />
                        Confirmar Recepción y Firmar Pagarés
                    </>
                )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

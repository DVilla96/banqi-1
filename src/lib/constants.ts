import type { NavLink, Investment, ChartData, OverviewCard } from './types';
import { LayoutDashboard, Wallet, Landmark, Settings, FlaskConical } from 'lucide-react';

export const NAV_LINKS: NavLink[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/my-investments', label: 'Mis Inversiones', icon: Wallet },
    { href: '/loans', label: 'Préstamos', icon: Landmark },
    { href: '/admin/test-tools', label: 'Zona de Pruebas', icon: FlaskConical },
];

export const OVERVIEW_CARDS_DATA: OverviewCard[] = [
    { title: "Inversión Total", value: "$75.231.890", change: "+20.1% desde el mes pasado", icon: "trendingUp" },
    { title: "ROI Esperado", value: "12.5%", change: "+2.2% desde el mes pasado", icon: "target" },
    { title: "Préstamos Activos", value: "32", change: "+5 desde el mes pasado", icon: "landmark" },
    { title: "Perfil de Riesgo", value: "Equilibrado", change: "Cartera diversificada", icon: "shieldCheck" },
];

export const INVESTMENT_CHART_DATA: ChartData[] = [
  { month: "Ene", investment: 4000000, returns: 2400000 },
  { month: "Feb", investment: 3000000, returns: 1398000 },
  { month: "Mar", investment: 5000000, returns: 6800000 },
  { month: "Abr", investment: 2780000, returns: 3908000 },
  { month: "May", investment: 1890000, returns: 4800000 },
  { month: "Jun", investment: 2390000, returns: 3800000 },
  { month: "Jul", investment: 3490000, returns: 4300000 },
];

export const RECENT_INVESTMENTS_DATA: Investment[] = [
  { id: "INV001", loanId: "LN456", amount: 250000, borrower: "Olivia Martin", date: "2023-11-23", status: "Activo" },
  { id: "INV002", loanId: "LN789", amount: 150000, borrower: "Jackson Lee", date: "2023-11-20", status: "Activo" },
  { id: "INV003", loanId: "LN123", amount: 350000, borrower: "Isabella Nguyen", date: "2023-11-15", status: "Pagado" },
  { id: "INV004", loanId: "LN321", amount: 450000, borrower: "William Kim", date: "2023-11-10", status: "Activo" },
  { id: "INV005", loanId: "LN654", amount: 550000, borrower: "Sofia Davis", date: "2023-11-01", status: "Pagado" },
];

// ============================================
// CONSTANTES DE FEES DEL SISTEMA (VALORES POR DEFECTO)
// ============================================
// NOTA: Estos son valores por defecto. El valor real se define
// por crédito individual cuando el admin envía la oferta.

/**
 * Fee de estudio de crédito / desembolso por defecto (COP)
 * Este valor se cobra al deudor y es fondeado inicialmente por Banqi.
 * El admin puede personalizarlo por cada crédito en la evaluación.
 */
export const DISBURSEMENT_FEE = 25000;

/**
 * Fee de tecnología mensual por defecto (COP)
 * Se cobra mensualmente como parte de cada cuota.
 * El admin puede personalizarlo por cada crédito en la evaluación.
 */
export const MONTHLY_TECHNOLOGY_FEE = 8000;

/**
 * ID del inversor virtual de Banqi para fees de plataforma
 */
export const BANQI_FEE_INVESTOR_ID = 'banqi_platform_fee';

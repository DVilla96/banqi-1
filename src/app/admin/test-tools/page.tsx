'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { 
    collection, 
    query, 
    getDocs, 
    deleteDoc, 
    doc, 
    addDoc, 
    Timestamp,
    orderBy,
    limit,
    where,
    writeBatch,
    updateDoc
} from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, Plus, AlertTriangle, RefreshCw, Database, CreditCard, Users, Receipt } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DISBURSEMENT_FEE, MONTHLY_TECHNOLOGY_FEE, BANQI_FEE_INVESTOR_ID } from '@/lib/constants';

type UserProfile = {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
};

type LoanRequest = {
    id: string;
    requesterId: string;
    requesterFirstName: string;
    requesterLastName: string;
    amount: number;
    status: string;
    createdAt: any;
};

type Investment = {
    id: string;
    loanId: string;
    investorId?: string;
    payerId?: string;
    amount: number;
    status: string;
    isRepayment?: boolean;
    createdAt: any;
};

type Payment = {
    id: string;
    loanId: string;
    payerId: string;
    amount: number;
    paymentDate: any;
};

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
    }).format(value);
};

const formatDate = (timestamp: any) => {
    if (!timestamp?.seconds) return 'N/A';
    return new Date(timestamp.seconds * 1000).toLocaleDateString('es-CO');
};

// Datos aleatorios para generar créditos
const RANDOM_PURPOSES = [
    'Consolidación de deudas',
    'Mejoras del hogar',
    'Gastos médicos',
    'Educación',
    'Viaje familiar',
    'Compra de vehículo',
    'Capital de trabajo',
    'Emergencia familiar',
    'Inversión en negocio',
    'Remodelación'
];

const RANDOM_EMPLOYERS = [
    'Bancolombia S.A.',
    'Grupo Éxito',
    'Ecopetrol',
    'Claro Colombia',
    'Avianca Holdings',
    'Cementos Argos',
    'Nutresa',
    'ISA Intercolombia',
    'EPM',
    'Bavaria S.A.'
];

const RANDOM_POSITIONS = [
    'Analista Senior',
    'Coordinador de Operaciones',
    'Ingeniero de Software',
    'Contador Público',
    'Gerente de Proyectos',
    'Especialista en Marketing',
    'Director Comercial',
    'Consultor',
    'Administrador de Empresas',
    'Arquitecto de Soluciones'
];

const RANDOM_BANKS = [
    'Bancolombia',
    'Banco de Bogotá',
    'Davivienda',
    'BBVA Colombia',
    'Banco de Occidente',
    'Banco Popular',
    'Banco Caja Social',
    'Banco Falabella',
    'Scotiabank Colpatria',
    'Banco AV Villas'
];

export default function TestToolsPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loans, setLoans] = useState<LoanRequest[]>([]);
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    
    // Formulario para crear crédito rápido
    const [newLoan, setNewLoan] = useState({
        userId: '',
        amount: 500000,
        term: 12,
        interestRate: 2.1,
        status: 'funding-active' as string,
        technologyFee: MONTHLY_TECHNOLOGY_FEE, // Cuota de tecnología mensual (personalizable)
        disbursementFee: DISBURSEMENT_FEE, // Estudio de crédito (personalizable)
    });

    // Cargar datos
    const loadData = async () => {
        setLoading(true);
        try {
            // Cargar usuarios
            const usersQuery = query(collection(db, 'users'), limit(50));
            const usersSnap = await getDocs(usersQuery);
            const usersData = usersSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as UserProfile[];
            setUsers(usersData);

            // Cargar préstamos
            const loansQuery = query(collection(db, 'loanRequests'), orderBy('createdAt', 'desc'), limit(50));
            const loansSnap = await getDocs(loansQuery);
            const loansData = loansSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as LoanRequest[];
            setLoans(loansData);

            // Cargar inversiones
            const investmentsQuery = query(collection(db, 'investments'), orderBy('createdAt', 'desc'), limit(100));
            const investmentsSnap = await getDocs(investmentsQuery);
            const investmentsData = investmentsSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Investment[];
            setInvestments(investmentsData);

            // Cargar pagos
            const paymentsQuery = query(collection(db, 'payments'), limit(100));
            const paymentsSnap = await getDocs(paymentsQuery);
            const paymentsData = paymentsSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Payment[];
            setPayments(paymentsData);

        } catch (error) {
            console.error('Error loading data:', error);
            toast({ title: 'Error', description: 'No se pudieron cargar los datos', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Crear crédito rápido con datos aleatorios
    const createQuickLoan = async () => {
        if (!newLoan.userId) {
            toast({ title: 'Error', description: 'Selecciona un usuario', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            const user = users.find(u => u.id === newLoan.userId);
            if (!user) throw new Error('Usuario no encontrado');

            const randomPurpose = RANDOM_PURPOSES[Math.floor(Math.random() * RANDOM_PURPOSES.length)];
            const randomEmployer = RANDOM_EMPLOYERS[Math.floor(Math.random() * RANDOM_EMPLOYERS.length)];
            const randomPosition = RANDOM_POSITIONS[Math.floor(Math.random() * RANDOM_POSITIONS.length)];
            const randomBank = RANDOM_BANKS[Math.floor(Math.random() * RANDOM_BANKS.length)];
            const randomAccountNumber = Math.floor(Math.random() * 9000000000) + 1000000000;
            const randomIdNumber = Math.floor(Math.random() * 900000000) + 100000000;

            // Calcular fecha de inicio aleatoria (últimos 30 días)
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - Math.floor(Math.random() * 365));

            const loanData = {
                requesterId: newLoan.userId,
                requesterFirstName: user.firstName,
                requesterLastName: user.lastName,
                requesterEmail: user.email,
                amount: newLoan.amount,
                term: newLoan.term,
                interestRate: newLoan.interestRate,
                purpose: randomPurpose,
                status: newLoan.status,
                fundedPercentage: 0,
                committedPercentage: 0,
                riskGrade: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
                createdAt: Timestamp.now(),
                
                // Datos de empleo (aleatorios)
                employerName: randomEmployer,
                position: randomPosition,
                startDate: startDate.toISOString().split('T')[0],
                dateOfBirth: '1990-01-15',
                
                // Datos bancarios (aleatorios)
                bankName: randomBank,
                accountType: Math.random() > 0.5 ? 'Ahorros' : 'Corriente',
                accountNumber: randomAccountNumber.toString(),
                
                // Documentos ficticios (URLs de placeholder)
                workCertificateUrl: 'https://placehold.co/600x400?text=Work+Certificate',
                bankCertificateUrl: 'https://placehold.co/600x400?text=Bank+Certificate',
                signatureUrl: 'https://placehold.co/300x150?text=Signature',
                documentUrls: {
                    idFront: 'https://placehold.co/600x400?text=ID+Front',
                    idBack: 'https://placehold.co/600x400?text=ID+Back',
                    signature: 'https://placehold.co/300x150?text=Signature',
                },
                
                // Fees (valores del formulario, personalizables por crédito)
                disbursementFee: newLoan.disbursementFee,
                technologyFee: newLoan.technologyFee,
                // paymentDay solo se asigna si el crédito está en repago (el deudor ya lo seleccionó)
                ...(newLoan.status === 'repayment-active' && { paymentDay: 6 }),
                fundingOrder: Date.now(),
            };

            const loanRef = await addDoc(collection(db, 'loanRequests'), loanData);
            
            // Estados que requieren la inversión inicial de Banqi (estudio de crédito)
            // funding-active: en fondeo, funded: fondeado, repayment-active: en repago
            const statusesWithBanqiInvestment = ['funding-active', 'funded', 'repayment-active'];
            const needsBanqiInvestment = statusesWithBanqiInvestment.includes(newLoan.status);
            
            if (needsBanqiInvestment) {
                const banqiInvestmentData = {
                    loanId: loanRef.id,
                    investorId: BANQI_FEE_INVESTOR_ID,
                    borrowerId: newLoan.userId,
                    amount: newLoan.disbursementFee,
                    status: 'confirmed',
                    paymentProofUrl: 'internal_platform_fee',
                    createdAt: Timestamp.now(),
                    confirmedAt: Timestamp.now(),
                };
                
                await addDoc(collection(db, 'investments'), banqiInvestmentData);
                
                // Actualizar el porcentaje fondeado para incluir la inversión de Banqi
                // El % fondeado = (disbursementFee / amount) * 100
                const fundedPercentage = (newLoan.disbursementFee / newLoan.amount) * 100;
                const loanDocRef = doc(db, 'loanRequests', loanRef.id);
                await updateDoc(loanDocRef, { 
                    fundedPercentage: fundedPercentage,
                    committedPercentage: fundedPercentage 
                });
            }
            
            toast({ 
                title: '¡Crédito Creado!', 
                description: needsBanqiInvestment
                    ? `Crédito de ${formatCurrency(newLoan.amount)} con inversión inicial de Banqi (${formatCurrency(newLoan.disbursementFee)})`
                    : `Crédito de ${formatCurrency(newLoan.amount)} para ${user.firstName} ${user.lastName}` 
            });
            
            loadData();
        } catch (error) {
            console.error('Error creating loan:', error);
            toast({ title: 'Error', description: 'No se pudo crear el crédito', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    // Eliminar elementos seleccionados
    const deleteSelected = async (type: 'loans' | 'investments' | 'payments') => {
        if (selectedItems.size === 0) {
            toast({ title: 'Error', description: 'Selecciona al menos un elemento', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            const batch = writeBatch(db);
            const collectionName = type === 'loans' ? 'loanRequests' : type;
            
            selectedItems.forEach(id => {
                const docRef = doc(db, collectionName, id);
                batch.delete(docRef);
            });

            await batch.commit();
            
            toast({ 
                title: 'Eliminado', 
                description: `${selectedItems.size} elemento(s) eliminado(s)` 
            });
            
            setSelectedItems(new Set());
            loadData();
        } catch (error) {
            console.error('Error deleting:', error);
            toast({ title: 'Error', description: 'No se pudieron eliminar los elementos', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    // Eliminar un crédito con todas sus inversiones y pagos asociados
    const deleteLoanWithRelated = async (loanId: string) => {
        setLoading(true);
        try {
            const batch = writeBatch(db);
            
            // Eliminar inversiones asociadas
            const investmentsQuery = query(collection(db, 'investments'), where('loanId', '==', loanId));
            const investmentsSnap = await getDocs(investmentsQuery);
            investmentsSnap.docs.forEach(doc => batch.delete(doc.ref));
            
            // Eliminar pagos asociados
            const paymentsQuery = query(collection(db, 'payments'), where('loanId', '==', loanId));
            const paymentsSnap = await getDocs(paymentsQuery);
            paymentsSnap.docs.forEach(doc => batch.delete(doc.ref));
            
            // Eliminar el crédito
            batch.delete(doc(db, 'loanRequests', loanId));
            
            await batch.commit();
            
            toast({ 
                title: 'Crédito Eliminado', 
                description: `Se eliminó el crédito y ${investmentsSnap.size} inversiones y ${paymentsSnap.size} pagos asociados` 
            });
            
            loadData();
        } catch (error) {
            console.error('Error deleting loan:', error);
            toast({ title: 'Error', description: 'No se pudo eliminar el crédito', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    // Toggle selección
    const toggleSelection = (id: string) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedItems(newSelected);
    };

    // Seleccionar todos
    const selectAll = (items: { id: string }[]) => {
        const allIds = new Set(items.map(item => item.id));
        setSelectedItems(allIds);
    };

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = {
            'pending': 'bg-yellow-500',
            'approved': 'bg-blue-500',
            'funding-active': 'bg-purple-500',
            'funded': 'bg-green-500',
            'repayment-active': 'bg-teal-500',
            'repayment-overdue': 'bg-red-500',
            'completed': 'bg-gray-500',
            'confirmed': 'bg-green-500',
            'pending-confirmation': 'bg-yellow-500',
            'disputed': 'bg-red-500',
        };
        return <Badge className={colors[status] || 'bg-gray-400'}>{status}</Badge>;
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-2">
                        <Database className="h-8 w-8 text-primary" />
                        Herramientas de Prueba
                    </h1>
                    <p className="text-muted-foreground">Crear y eliminar datos para pruebas</p>
                </div>
                <Button onClick={loadData} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Recargar
                </Button>
            </div>

            <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>¡Cuidado!</AlertTitle>
                <AlertDescription>
                    Estas herramientas eliminan datos de forma permanente. Úsalas solo en entornos de prueba.
                </AlertDescription>
            </Alert>

            <Tabs defaultValue="create" className="space-y-4">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="create">
                        <Plus className="h-4 w-4 mr-2" /> Crear Crédito
                    </TabsTrigger>
                    <TabsTrigger value="loans">
                        <CreditCard className="h-4 w-4 mr-2" /> Créditos ({loans.length})
                    </TabsTrigger>
                    <TabsTrigger value="investments">
                        <Users className="h-4 w-4 mr-2" /> Inversiones ({investments.length})
                    </TabsTrigger>
                    <TabsTrigger value="payments">
                        <Receipt className="h-4 w-4 mr-2" /> Pagos ({payments.length})
                    </TabsTrigger>
                </TabsList>

                {/* Tab: Crear Crédito Rápido */}
                <TabsContent value="create">
                    <Card>
                        <CardHeader>
                            <CardTitle>Crear Crédito Rápido</CardTitle>
                            <CardDescription>
                                Genera un crédito con datos aleatorios (sin validaciones ni documentos reales)
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Usuario (Deudor)</Label>
                                    <Select value={newLoan.userId} onValueChange={(v) => setNewLoan({...newLoan, userId: v})}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Seleccionar usuario..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {users.map(user => (
                                                <SelectItem key={user.id} value={user.id}>
                                                    {user.firstName} {user.lastName} ({user.email})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Estado Inicial</Label>
                                    <Select value={newLoan.status} onValueChange={(v) => setNewLoan({...newLoan, status: v})}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pending">Pendiente</SelectItem>
                                            <SelectItem value="approved">Aprobado</SelectItem>
                                            <SelectItem value="funding-active">En Fondeo</SelectItem>
                                            <SelectItem value="funded">Fondeado</SelectItem>
                                            <SelectItem value="repayment-active">En Repago</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Monto</Label>
                                    <Input 
                                        type="number" 
                                        value={newLoan.amount}
                                        onChange={(e) => setNewLoan({...newLoan, amount: parseInt(e.target.value) || 0})}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Plazo (meses)</Label>
                                    <Input 
                                        type="number" 
                                        value={newLoan.term}
                                        onChange={(e) => setNewLoan({...newLoan, term: parseInt(e.target.value) || 12})}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Tasa E.M. (%)</Label>
                                    <Input 
                                        type="number" 
                                        step="0.1"
                                        value={newLoan.interestRate}
                                        onChange={(e) => setNewLoan({...newLoan, interestRate: parseFloat(e.target.value) || 2.1})}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Estudio de Crédito ($)</Label>
                                    <Input 
                                        type="number" 
                                        step="1000"
                                        value={newLoan.disbursementFee}
                                        onChange={(e) => setNewLoan({...newLoan, disbursementFee: parseInt(e.target.value) || DISBURSEMENT_FEE})}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Cuota Tecnología ($/mes)</Label>
                                    <Input 
                                        type="number" 
                                        step="1000"
                                        value={newLoan.technologyFee}
                                        onChange={(e) => setNewLoan({...newLoan, technologyFee: parseInt(e.target.value) || MONTHLY_TECHNOLOGY_FEE})}
                                    />
                                </div>
                            </div>

                            {/* Información sobre la inversión inicial de Banqi */}
                            {['funding-active', 'funded', 'repayment-active'].includes(newLoan.status) && (
                                <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                                    <p className="text-xs text-primary">
                                        ℹ️ Se creará automáticamente una inversión de Banqi por {formatCurrency(newLoan.disbursementFee)} (estudio de crédito).
                                    </p>
                                </div>
                            )}

                            <Button onClick={createQuickLoan} disabled={loading} className="w-full mt-4">
                                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                                Crear Crédito con Datos Aleatorios
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tab: Créditos */}
                <TabsContent value="loans">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Créditos</CardTitle>
                                <CardDescription>Gestionar créditos de prueba</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => selectAll(loans)}>
                                    Seleccionar Todos
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setSelectedItems(new Set())}>
                                    Limpiar Selección
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" disabled={selectedItems.size === 0}>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Eliminar ({selectedItems.size})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Eliminar créditos seleccionados?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Se eliminarán {selectedItems.size} crédito(s). Esta acción no se puede deshacer.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => deleteSelected('loans')}>
                                                Eliminar
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12"></TableHead>
                                        <TableHead>Deudor</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loans.map(loan => (
                                        <TableRow key={loan.id}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={selectedItems.has(loan.id)}
                                                    onCheckedChange={() => toggleSelection(loan.id)}
                                                />
                                            </TableCell>
                                            <TableCell>{loan.requesterFirstName} {loan.requesterLastName}</TableCell>
                                            <TableCell>{formatCurrency(loan.amount)}</TableCell>
                                            <TableCell>{getStatusBadge(loan.status)}</TableCell>
                                            <TableCell>{formatDate(loan.createdAt)}</TableCell>
                                            <TableCell>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="text-red-500">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>¿Eliminar crédito completo?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Se eliminará el crédito junto con todas sus inversiones y pagos asociados.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                            <AlertDialogAction onClick={() => deleteLoanWithRelated(loan.id)}>
                                                                Eliminar Todo
                                                            </AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tab: Inversiones */}
                <TabsContent value="investments">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Inversiones</CardTitle>
                                <CardDescription>Gestionar inversiones de prueba</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => selectAll(investments)}>
                                    Seleccionar Todos
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setSelectedItems(new Set())}>
                                    Limpiar Selección
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" disabled={selectedItems.size === 0}>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Eliminar ({selectedItems.size})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Eliminar inversiones seleccionadas?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Se eliminarán {selectedItems.size} inversión(es). Esta acción no se puede deshacer.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => deleteSelected('investments')}>
                                                Eliminar
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12"></TableHead>
                                        <TableHead>Loan ID</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead>Fecha</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {investments.map(inv => (
                                        <TableRow key={inv.id}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={selectedItems.has(inv.id)}
                                                    onCheckedChange={() => toggleSelection(inv.id)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{inv.loanId.slice(0, 8)}...</TableCell>
                                            <TableCell>
                                                <Badge variant={inv.isRepayment ? "secondary" : "outline"}>
                                                    {inv.isRepayment ? 'Repago' : 'Inversión'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{formatCurrency(inv.amount)}</TableCell>
                                            <TableCell>{getStatusBadge(inv.status)}</TableCell>
                                            <TableCell>{formatDate(inv.createdAt)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Tab: Pagos */}
                <TabsContent value="payments">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Pagos</CardTitle>
                                <CardDescription>Gestionar pagos de prueba</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => selectAll(payments)}>
                                    Seleccionar Todos
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setSelectedItems(new Set())}>
                                    Limpiar Selección
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" size="sm" disabled={selectedItems.size === 0}>
                                            <Trash2 className="h-4 w-4 mr-2" />
                                            Eliminar ({selectedItems.size})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>¿Eliminar pagos seleccionados?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Se eliminarán {selectedItems.size} pago(s). Esta acción no se puede deshacer.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => deleteSelected('payments')}>
                                                Eliminar
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12"></TableHead>
                                        <TableHead>Loan ID</TableHead>
                                        <TableHead>Monto</TableHead>
                                        <TableHead>Fecha</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {payments.map(payment => (
                                        <TableRow key={payment.id}>
                                            <TableCell>
                                                <Checkbox 
                                                    checked={selectedItems.has(payment.id)}
                                                    onCheckedChange={() => toggleSelection(payment.id)}
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{payment.loanId.slice(0, 8)}...</TableCell>
                                            <TableCell>{formatCurrency(payment.amount)}</TableCell>
                                            <TableCell>{formatDate(payment.paymentDate)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

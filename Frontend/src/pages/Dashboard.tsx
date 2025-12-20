import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import {
    FiUsers,
    FiFileText,
    FiCalendar,
    FiAlertTriangle,
    FiTrendingUp,
    FiCheck,
    FiClock,
    FiPlus
} from 'react-icons/fi';
import { workersApi } from '../api/client';
import type { Worker } from '../api/client';

export default function Dashboard() {
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            // Solo llamamos a endpoints que sí existen
            const workersRes = await workersApi.list();
            if (workersRes.success && workersRes.data) {
                setWorkers(workersRes.data);
            }
            // Los endpoints activities/stats y documents no existen en el backend
            // Por ahora mostramos valores por defecto
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const statCards = [
        {
            icon: FiUsers,
            label: 'Trabajadores Activos',
            value: workers.length,
            color: 'var(--primary-500)',
            change: '+5%',
            positive: true
        },
        {
            icon: FiFileText,
            label: 'Documentos',
            value: 0,
            color: 'var(--info-500)',
            change: '-',
            positive: true
        },
        {
            icon: FiCalendar,
            label: 'Actividades Completadas',
            value: 0,
            color: 'var(--success-500)',
            change: '0%',
            positive: true
        },
        {
            icon: FiAlertTriangle,
            label: 'Incidentes Pendientes',
            value: 0,
            color: 'var(--danger-500)',
            change: '-',
            positive: true
        }
    ];

    const recentActivities = [
        { type: 'Charla 5 min', date: 'Hoy 08:30', status: 'completed', attendees: 12 },
        { type: 'ART', date: 'Hoy 09:15', status: 'completed', attendees: 5 },
        { type: 'Capacitación EPP', date: 'Hoy 14:00', status: 'pending', attendees: 0 },
        { type: 'Inspección', date: 'Mañana 10:00', status: 'scheduled', attendees: 0 },
    ];

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    return (
        <>
            <Header title="Dashboard" />

            <div className="page-content">
                {/* Stats Grid */}
                <div className="grid grid-cols-4 mb-6">
                    {statCards.map((stat, index) => {
                        const Icon = stat.icon;
                        return (
                            <div key={index} className="card stat-card">
                                <div className="flex items-center gap-3 mb-4">
                                    <div
                                        className="avatar"
                                        style={{ background: stat.color }}
                                    >
                                        <Icon />
                                    </div>
                                    <span className="text-sm text-muted">{stat.label}</span>
                                </div>
                                <div className="stat-value">{stat.value}</div>
                                <div className={`stat-change ${stat.positive ? 'positive' : 'negative'}`}>
                                    <FiTrendingUp />
                                    {stat.change}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Main content grid */}
                <div className="grid grid-cols-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
                    {/* Recent Activities */}
                    <div className="card">
                        <div className="card-header">
                            <div>
                                <h2 className="card-title">Actividades de Hoy</h2>
                                <p className="card-subtitle">Resumen de actividades del día</p>
                            </div>
                            <Link to="/activities" className="btn btn-primary btn-sm">
                                <FiPlus />
                                Nueva
                            </Link>
                        </div>

                        <div className="flex flex-col gap-3">
                            {recentActivities.map((activity, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between"
                                    style={{
                                        padding: 'var(--space-3)',
                                        background: 'var(--surface-elevated)',
                                        borderRadius: 'var(--radius-md)'
                                    }}
                                >
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="avatar avatar-sm"
                                            style={{
                                                background: activity.status === 'completed'
                                                    ? 'var(--success-500)'
                                                    : activity.status === 'pending'
                                                        ? 'var(--warning-500)'
                                                        : 'var(--gray-600)'
                                            }}
                                        >
                                            {activity.status === 'completed' ? <FiCheck /> : <FiClock />}
                                        </div>
                                        <div>
                                            <div className="font-bold">{activity.type}</div>
                                            <div className="text-sm text-muted">{activity.date}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {activity.attendees > 0 && (
                                            <span className="badge badge-neutral">
                                                <FiUsers size={12} />
                                                {activity.attendees}
                                            </span>
                                        )}
                                        <span className={`badge badge-${activity.status === 'completed' ? 'success' :
                                            activity.status === 'pending' ? 'warning' : 'neutral'
                                            }`}>
                                            {activity.status === 'completed' ? 'Completada' :
                                                activity.status === 'pending' ? 'Pendiente' : 'Programada'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="card">
                        <h2 className="card-title mb-4">Acciones Rápidas</h2>

                        <div className="flex flex-col gap-3">
                            <Link to="/workers/enroll" className="btn btn-primary" style={{ justifyContent: 'flex-start' }}>
                                <FiUsers />
                                Enrolar Trabajador
                            </Link>
                            <Link to="/activities" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
                                <FiCalendar />
                                Registrar Charla 5 min
                            </Link>
                            <Link to="/documents" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
                                <FiFileText />
                                Crear Documento
                            </Link>
                            <Link to="/incidents" className="btn btn-secondary" style={{ justifyContent: 'flex-start' }}>
                                <FiAlertTriangle />
                                Reportar Incidente
                            </Link>
                        </div>

                        {/* Cumplimiento */}
                        <div className="mt-6">
                            <div className="flex justify-between mb-2">
                                <span className="text-sm">Cumplimiento Mensual</span>
                                <span className="text-sm font-bold">0%</span>
                            </div>
                            <div className="progress">
                                <div
                                    className="progress-bar"
                                    style={{ width: '0%' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Recent Workers */}
                <div className="card mt-6">
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Trabajadores Recientes</h2>
                            <p className="card-subtitle">Últimos trabajadores enrolados</p>
                        </div>
                        <Link to="/workers" className="btn btn-secondary btn-sm">
                            Ver todos
                        </Link>
                    </div>

                    {workers.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">👷</div>
                            <h3 className="empty-state-title">Sin trabajadores</h3>
                            <p className="empty-state-description">
                                Comienza enrolando tu primer trabajador para gestionar sus documentos y firmas.
                            </p>
                            <Link to="/workers/enroll" className="btn btn-primary">
                                <FiPlus />
                                Enrolar Trabajador
                            </Link>
                        </div>
                    ) : (
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Trabajador</th>
                                        <th>RUT</th>
                                        <th>Cargo</th>
                                        <th>Fecha Enrolamiento</th>
                                        <th>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {workers.slice(0, 5).map((worker) => (
                                        <tr key={worker.workerId}>
                                            <td>
                                                <div className="flex items-center gap-3">
                                                    <div className="avatar avatar-sm">
                                                        {worker.nombre.charAt(0)}
                                                    </div>
                                                    <span className="font-bold">{worker.nombre} {worker.apellido}</span>
                                                </div>
                                            </td>
                                            <td>{worker.rut}</td>
                                            <td>{worker.cargo}</td>
                                            <td>{new Date(worker.fechaEnrolamiento).toLocaleDateString('es-CL')}</td>
                                            <td>
                                                <span className={`badge badge-${worker.estado === 'activo' ? 'success' : 'neutral'}`}>
                                                    {worker.estado}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

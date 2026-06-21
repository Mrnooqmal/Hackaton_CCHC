import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { personasApi, type PersonaResponse } from '../api/client';
import { tenantsApi, type TenantRole } from '../api/tenants.api';
import { useAuth } from '../context/AuthContext';
import { useObraContext } from '../context/ObraContext';
import { AlertBanner, PageHeader, CollectionView, DataTable, Badge } from '../components/ui';
import type { CollectionMode, DataTableColumn } from '../components/ui';
import { PERMISSIONS } from '../permissions';
import { FiUserPlus, FiUsers, FiUpload, FiMoreVertical } from 'react-icons/fi';
import { getCargoLabel } from '../utils/ds44';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { Select } from '../components/ui';
import ConfirmModal from '../components/ConfirmModal';

// ── helpers ──────────────────────────────────────────────────────────────────

const AVATAR_TINT = { bg: 'rgba(0, 110, 220, 0.12)', fg: '#4d9fff', border: 'rgba(0, 110, 220, 0.25)' };

function PersonaAvatar({ p, size = 40 }: { p: PersonaResponse; size?: number }) {
    return (
        <div style={{
            width: size, height: size, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: size * 0.38, textTransform: 'uppercase',
            overflow: 'hidden',
            ...(p.fotoPerfil
                ? { border: `1.5px solid ${AVATAR_TINT.border}` }
                : { background: AVATAR_TINT.bg, color: AVATAR_TINT.fg, border: `1.5px solid ${AVATAR_TINT.border}` })
        }}>
            {p.fotoPerfil
                ? <img src={p.fotoPerfil} alt={p.nombre} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <>{p.nombre[0]}{p.apellido?.[0] ?? p.nombre[1] ?? ''}</>
            }
        </div>
    );
}

export default function PersonasManagement() {
    const { user, hasPermission } = useAuth();
    const { selectedObraId, selectedObra } = useObraContext();
    const { options: cargoOptions } = useCargoCatalog();
    const navigate = useNavigate();

    const tenantId = user?.tenantId || user?.empresaId || localStorage.getItem('tenant_id') || '';
    const isAdmin = user?.rol === 'admin';
    const isObraScoped = Boolean(user && !isAdmin);
    const isMissingObra = isObraScoped && !selectedObraId;
    const canCreatePersonas = hasPermission(PERMISSIONS.PERSONAS_CREAR);
    const canBulkUpload = hasPermission(PERMISSIONS.PERSONAS_CREAR);
    const canVerDetalle = hasPermission(PERMISSIONS.PERSONAS_DETALLE);
    const canManageObra = hasPermission(PERMISSIONS.OBRAS_DETALLE);

    const [personas, setPersonas] = useState<PersonaResponse[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [filterRol, setFilterRol] = useState('');
    const [filterCargo, setFilterCargo] = useState('');
    const [mode, setMode] = useState<CollectionMode>('grid');

    const [tenantRoles, setTenantRoles] = useState<TenantRole[]>([]);

    // Unused locally but kept for WorkerDetail-triggered confirm flows
    const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string }>({ isOpen: false, title: '', message: '' });
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

    useEffect(() => {
        if (!tenantId) return;
        tenantsApi.get(tenantId).then(res => {
            if (res.success && res.data?.roles?.length) setTenantRoles(res.data.roles);
        }).catch(() => {});
    }, [tenantId]);

    const fetchPersonas = async () => {
        if (!tenantId || isMissingObra) { setPersonas([]); setLoading(false); return; }
        setLoading(true);
        try {
            const filters: any = {};
            if (filterRol) filters.rol = filterRol;
            if (isObraScoped && selectedObraId) filters.obraId = selectedObraId;
            const res = await personasApi.list(tenantId, filters);
            if (res.success && res.data) setPersonas(res.data.personas || []);
            else setError(res.error || 'Error al cargar personas');
        } catch { setError('Error de conexión'); }
        finally { setLoading(false); }
    };

    useEffect(() => { fetchPersonas(); }, [tenantId, filterRol, selectedObraId, isObraScoped]);

    const filtered = personas.filter(p => {
        const s = searchTerm.toLowerCase().replace(/[.-]/g, '');
        const rut = p.rut.toLowerCase().replace(/[.-]/g, '');
        const matchesSearch = p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (p.apellido || '').toLowerCase().includes(searchTerm.toLowerCase()) || rut.includes(s);
        const matchesCargo = !filterCargo || p.cargo === filterCargo;
        return matchesSearch && matchesCargo;
    });

    const pageTitle = isObraScoped ? 'Equipo de Obra' : 'Personas';
    const pageDescription = isObraScoped
        ? selectedObra ? `Personas asignadas a ${selectedObra.nombre}.` : 'Selecciona una obra para ver el equipo.'
        : 'Directorio de personas, roles y accesos de la empresa.';

    // DataTable columns
    const columns: DataTableColumn<PersonaResponse>[] = [
        {
            key: 'nombre',
            header: 'Persona',
            sortable: true,
            sortValue: (p) => p.nombre,
            render: (p) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <PersonaAvatar p={p} size={32} />
                    <div>
                        <div style={{ fontWeight: 600 }}>{p.nombre} {p.apellido}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{p.rut}</div>
                    </div>
                </div>
            ),
        },
        {
            key: 'cargo',
            header: 'Cargo',
            hideOnMobile: true,
            render: (p) => <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{getCargoLabel(p.cargo) || '—'}</span>,
        },
        {
            key: 'rol',
            header: 'Rol',
            width: '130px',
            render: (p) => {
                const v = (p.rol === 'admin' || p.rol === 'jefe_obra') ? 'warning' : (p.rol === 'trabajador' ? 'neutral' : 'success');
                const label = tenantRoles.find(r => r.id === p.rol)?.nombre || p.rol || '—';
                return <Badge variant={v as any} size="sm">{label}</Badge>;
            },
        },
        {
            key: 'acciones',
            header: '',
            width: '44px',
            render: (p) => {
                const isOpen = menuOpenId === p.personaId;
                return (
                    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                        <button
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 6px', color: 'var(--text-muted)' }}
                            onClick={() => setMenuOpenId(isOpen ? null : p.personaId)}
                        >
                            <FiMoreVertical size={16} />
                        </button>
                        {isOpen && (
                            <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setMenuOpenId(null)} />
                                <div style={{
                                    position: 'absolute', right: 0, top: '100%', zIndex: 1000,
                                    background: 'var(--surface-card)', border: '1px solid var(--surface-border)',
                                    borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                                    minWidth: 180, overflow: 'hidden',
                                }}>
                                    {[
                                        { label: 'Ver datos', href: `/personas/${encodeURIComponent(p.rut)}` },
                                        { label: 'Ver asignaciones', href: `/personas/${encodeURIComponent(p.rut)}?tab=asignaciones` },
                                        { label: 'Cumplimiento', href: `/personas/${encodeURIComponent(p.rut)}?tab=cumplimiento` },
                                    ].map((item) => (
                                        <button
                                            key={item.label}
                                            className="btn btn-ghost"
                                            style={{ width: '100%', justifyContent: 'flex-start', padding: '9px 14px', fontSize: 'var(--text-sm)', borderRadius: 0 }}
                                            onClick={() => { setMenuOpenId(null); navigate(item.href); }}
                                        >
                                            {item.label}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                );
            },
        },
    ];

    // Card grid view
    const cardGrid = (
        <div className="pdir-grid">
            {filtered.length === 0 ? (
                <div style={{ gridColumn: '1/-1', padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No hay personas que coincidan con los filtros.
                </div>
            ) : filtered.map((p, i) => {
                const cardInner = (
                    <>
                        <PersonaAvatar p={p} size={56} />
                        <span className="pdir-name">{p.nombre} {p.apellido}</span>
                        <span className="pdir-rut">{p.rut}</span>
                        <span className="pdir-cargo">{getCargoLabel(p.cargo) || p.rol || '—'}</span>
                    </>
                );
                const style = { animationDelay: `${Math.min(i * 20, 400)}ms` };
                return canVerDetalle ? (
                    <Link key={p.personaId} to={`/personas/${p.rut}`} className="pdir-card" style={style}>{cardInner}</Link>
                ) : (
                    <div key={p.personaId} className="pdir-card" style={{ ...style, cursor: 'default' }}>{cardInner}</div>
                );
            })}
        </div>
    );

    const tableList = (
        <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(p) => p.personaId}
            loading={loading}
            onRowClick={canVerDetalle ? (p) => navigate(`/personas/${p.rut}`) : undefined}
            emptyState={
                <div className="empty-state" style={{ padding: 'var(--space-10) 0' }}>
                    <FiUsers size={36} className="empty-state-icon" />
                    <p className="empty-state-description">
                        {isMissingObra ? 'Selecciona una obra para ver el equipo.' : 'No hay personas registradas.'}
                    </p>
                </div>
            }
        />
    );

    return (
        <>
            <div className="page-content">
                <PageHeader
                    banner
                    title={pageTitle}
                    description={pageDescription}
                    actions={
                        <>
                            {canBulkUpload && (
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => navigate('/personas/carga-masiva')}
                                >
                                    <FiUpload /> Carga masiva
                                </button>
                            )}
                            {canCreatePersonas && (
                                <button className="btn btn-primary" onClick={() => navigate('/personas/nueva')}>
                                    <FiUserPlus /> Nueva persona
                                </button>
                            )}
                        </>
                    }
                />

                {isMissingObra && (
                    <AlertBanner variant="warning" message="Selecciona una obra en el encabezado para ver y gestionar el equipo asignado." />
                )}

                {!isAdmin && selectedObraId && (
                    <AlertBanner variant="info" message="Las nuevas personas se crean a nivel empresa. Para sumar personas a esta obra, asígnalas desde la ficha de la obra.">
                        {canManageObra && (
                            <Link to={`/obras/${selectedObraId}`} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-2)' }}>
                                Ir a Gestionar Obra
                            </Link>
                        )}
                    </AlertBanner>
                )}

                {error && <AlertBanner variant="error" message={error} onDismiss={() => setError('')} />}

                {!isMissingObra && (
                    <CollectionView
                        searchValue={searchTerm}
                        onSearchChange={setSearchTerm}
                        searchPlaceholder="Buscar por nombre o RUT…"
                        count={filtered.length}
                        mode={mode}
                        onModeChange={setMode}
                        filters={
                            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                                <div style={{ width: 160 }}>
                                    <Select
                                        ariaLabel="Filtrar por rol"
                                        value={filterRol}
                                        onChange={setFilterRol}
                                        options={[
                                            { value: '', label: 'Todos los roles' },
                                            ...tenantRoles.map(r => ({ value: r.id, label: r.nombre })),
                                        ]}
                                    />
                                </div>
                                <div style={{ width: 180 }}>
                                    <Select
                                        ariaLabel="Filtrar por cargo"
                                        value={filterCargo}
                                        onChange={setFilterCargo}
                                        options={[
                                            { value: '', label: 'Todos los cargos' },
                                            ...cargoOptions,
                                        ]}
                                    />
                                </div>
                            </div>
                        }
                        list={tableList}
                        grid={cardGrid}
                    />
                )}
            </div>

            <ConfirmModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmLabel="Confirmar"
                variant="warning"
                onConfirm={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
            />

            <style>{`
                .pdir-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 12px;
                    padding: var(--space-2) 0;
                }
                .pdir-card {
                    display: flex; flex-direction: column; align-items: center; text-align: center;
                    padding: 24px 16px 16px;
                    border-radius: 12px; border: 1px solid var(--surface-border);
                    background: var(--surface-card);
                    text-decoration: none; color: inherit;
                    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s;
                    animation: pdirIn 0.3s ease both;
                }
                @keyframes pdirIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                .pdir-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px -4px rgba(0,0,0,0.18); border-color: var(--primary-400); }
                .pdir-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); line-height: 1.35; word-break: break-word; margin: 12px 0 4px; }
                .pdir-rut { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); letter-spacing: 0.04em; }
                .pdir-cargo { font-size: 11px; color: var(--text-secondary); margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--surface-border); width: 100%; word-break: break-word; line-height: 1.4; }
                @media (max-width: 900px) { .pdir-grid { grid-template-columns: repeat(3, 1fr); } }
                @media (max-width: 580px) { .pdir-grid { grid-template-columns: repeat(2, 1fr); } }
            `}</style>
        </>
    );
}

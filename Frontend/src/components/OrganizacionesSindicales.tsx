import { useCallback, useEffect, useState } from 'react';
import { FiPlus, FiTrash2, FiUsers } from 'react-icons/fi';
import { EmptyState } from './ui';
import { tenantsApi, type OrganizacionSindical, type TenantReglas } from '../api/tenants.api';

/**
 * Organizaciones sindicales de la empresa — Art. 57 inc. 2.
 *
 * Son destinatarias del Reglamento Interno, así que el sistema necesita saber a
 * quién informar. Registro MÍNIMO a propósito: nombre y contacto. No es un
 * módulo sindical y no debe convertirse en uno.
 *
 * La declaración de "no hay ninguna" NO es cosmética: sin ella, una empresa sin
 * sindicatos deja ese destinatario Pendiente para siempre, que es un
 * incumplimiento imposible de cerrar. Declararlo lo saca del denominador con su
 * razón escrita, que es lo que el expediente necesita mostrar.
 */

export interface OrganizacionesSindicalesProps {
    tenantId: string;
    reglas?: TenantReglas | null;
    personaId?: string | null;
    /** Se llama tras guardar, para que quien evalúe el ítem 50 recargue. */
    onCambio?: () => void;
}

const nuevoId = () => `os-${Date.now().toString(36)}`;

export default function OrganizacionesSindicales({
    tenantId, reglas, personaId = null, onCambio,
}: OrganizacionesSindicalesProps) {
    const [lista, setLista] = useState<OrganizacionSindical[]>(reglas?.organizacionesSindicales || []);
    const [declarado, setDeclarado] = useState(Boolean(reglas?.sinOrganizacionesSindicales?.declarado));
    const [nombre, setNombre] = useState('');
    const [contacto, setContacto] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLista(reglas?.organizacionesSindicales || []);
        setDeclarado(Boolean(reglas?.sinOrganizacionesSindicales?.declarado));
    }, [reglas]);

    const persistir = useCallback(async (
        siguiente: OrganizacionSindical[],
        declaracion: TenantReglas['sinOrganizacionesSindicales'],
    ) => {
        setGuardando(true);
        setError(null);
        try {
            const res = await tenantsApi.updateOrganizacionesSindicales(tenantId, siguiente, declaracion);
            if (!res.success) throw new Error(res.error || 'No se pudo guardar.');
            onCambio?.();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Error al guardar.');
            // Se revierte el estado local: dejarlo pintado como guardado cuando el
            // servidor lo rechazó es peor que el error mismo.
            setLista(reglas?.organizacionesSindicales || []);
            setDeclarado(Boolean(reglas?.sinOrganizacionesSindicales?.declarado));
        } finally {
            setGuardando(false);
        }
    }, [tenantId, reglas, onCambio]);

    const agregar = useCallback(() => {
        if (!nombre.trim()) return;
        const siguiente = [...lista, { id: nuevoId(), nombre: nombre.trim(), contacto: contacto.trim() || null }];
        setLista(siguiente);
        setNombre('');
        setContacto('');
        // Registrar una organización desmiente la declaración de que no hay ninguna.
        setDeclarado(false);
        void persistir(siguiente, null);
    }, [nombre, contacto, lista, persistir]);

    const quitar = useCallback((id: string) => {
        const siguiente = lista.filter((o) => o.id !== id);
        setLista(siguiente);
        void persistir(siguiente, declarado ? { declarado: true, fecha: new Date().toISOString(), personaId } : null);
    }, [lista, declarado, personaId, persistir]);

    const alternarDeclaracion = useCallback((valor: boolean) => {
        setDeclarado(valor);
        void persistir(lista, valor ? { declarado: true, fecha: new Date().toISOString(), personaId } : null);
    }, [lista, personaId, persistir]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {error && (
                <div className="ds44-alert ds44-alert-danger" style={{ fontSize: 'var(--text-sm)' }}>
                    <span className="ds44-alert-icon"><FiUsers size={14} /></span>
                    <span>{error}</span>
                </div>
            )}

            {lista.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {lista.map((o) => (
                        <div key={o.id} className="ds44-doc-row">
                            <div style={{ minWidth: 0 }}>
                                <div className="font-medium" style={{ fontSize: '0.88rem' }}>{o.nombre}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    {o.contacto || 'Sin contacto registrado'}
                                </div>
                            </div>
                            <button
                                className="btn btn-ghost btn-sm"
                                type="button"
                                disabled={guardando}
                                onClick={() => quitar(o.id)}
                                aria-label={`Quitar ${o.nombre}`}
                            >
                                <FiTrash2 size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={<FiUsers size={30} />}
                    title="Sin organizaciones sindicales registradas"
                    description="El Art. 57 inc. 2 obliga a remitirles el Reglamento Interno. Si en la empresa no hay ninguna, decláralo abajo para que deje de exigirse."
                />
            )}

            {!declarado && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '2 1 200px', minWidth: 0 }}>
                        <label className="form-label" htmlFor="os-nombre">Nombre</label>
                        <input
                            id="os-nombre" type="text" className="form-input"
                            placeholder="Sindicato de trabajadores N.º 1"
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
                        />
                    </div>
                    <div style={{ flex: '2 1 180px', minWidth: 0 }}>
                        <label className="form-label" htmlFor="os-contacto">Contacto</label>
                        <input
                            id="os-contacto" type="text" className="form-input"
                            placeholder="Correo o teléfono"
                            value={contacto}
                            onChange={(e) => setContacto(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
                        />
                    </div>
                    <button className="btn btn-secondary" type="button" disabled={!nombre.trim() || guardando} onClick={agregar}>
                        <FiPlus size={15} /> Agregar
                    </button>
                </div>
            )}

            {/* La declaración se ofrece solo cuando no hay ninguna registrada: no
                tiene sentido declarar que no existen mientras hay una en la lista. */}
            {lista.length === 0 && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={declarado}
                        disabled={guardando}
                        style={{ marginTop: 3 }}
                        onChange={(e) => alternarDeclaracion(e.target.checked)}
                    />
                    <span>
                        <span className="form-label" style={{ margin: 0 }}>
                            En la empresa no hay organizaciones sindicales
                        </span>
                        <span className="form-hint" style={{ marginTop: 2 }}>
                            Queda registrado como declaración de la entidad, con su fecha. Es lo que saca a
                            este destinatario de la exigencia en vez de dejarlo pendiente para siempre.
                        </span>
                    </span>
                </label>
            )}
        </div>
    );
}

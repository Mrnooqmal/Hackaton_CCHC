import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
    LuUser,
    LuFileText,
    LuActivity,
    LuCircleCheck,
    LuCircleAlert,
    LuDownload,
    LuClock,
    LuShield,
    LuUsers,
    LuCircleMinus,
    LuPlus,
    LuMinus,
    LuTrash2,
    LuShieldCheck,
    LuTriangleAlert,
    LuPencil,
    LuBuilding2 as LuBuild
} from 'react-icons/lu';
import {
    workersApi,
    documentsApi,
    uploadsApi,
    signaturesApi,
    signatureRequestsApi,
    activitiesApi,
    surveysApi,
    personasApi,
    obrasApi,
    tenantsApi,
    type Worker as ApiWorker,
    type DigitalSignature,
    type Capacitacion,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../permissions';
import { useObraContext } from '../context/ObraContext';
import { Modal, Select, IdentityPanel } from '../components/ui';
import WorkerEvidencias from '../components/WorkerEvidencias';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { eppApi, faltantesLabel, type EppElemento } from '../api/epp.api';
import { DS44_ONBOARDING_ITEMS, getCargoLabel } from '../utils/ds44';

interface WorkerStats {
    totalFirmas: number;
    firmasUltimos30Dias: number;
    documentosFirmados: number;
    actividadesAsistidas: number;
}

// Extender la interfaz Worker para incluir rol (que viene del backend para usuarios legacy)
interface WorkerWithRole extends ApiWorker {
    rol?: 'admin' | 'prevencionista' | 'trabajador';
    obraIds?: string[];
}

// Item de EPP dentro del formulario de entrega. El elemento se elige del
// catálogo de la empresa (Mi Empresa › EPP): `eppId` es la referencia y
// `descripcion` se copia al registro para que la entrega siga siendo legible
// aunque después se renombre o se elimine el elemento del catálogo.
interface EppItemDraft {
    eppId: string;
    descripcion: string;
    cantidad: number;
    talla: string;
}

const getSigIcon = (sig: DigitalSignature) => {
    const type = (sig as any).requestTipo || sig.tipoFirma;
    switch (type) {
        case 'enrolamiento': return <LuShield size={12} />;
        case 'documento': return <LuFileText size={12} />;
        case 'actividad':
        case 'capacitacion':
        case 'CHARLA_5MIN':
        case 'INDUCCION':
            return <LuUsers size={12} />;
        case 'ENTREGA_EPP':
            return <LuShield size={12} />;
        default:
            return <LuFileText size={12} />;
    }
};

export default function WorkerDetail() {
    const { rut } = useParams<{ rut: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const { selectedObraId } = useObraContext();
    const { user, hasPermission } = useAuth();
    const authTenantId = user?.tenantId || localStorage.getItem('tenant_id') || '';
    // Permisos de la ficha del trabajador
    const canValidarEpp = hasPermission(PERMISSIONS.PERSONA_EPP);
    const canExportar = hasPermission(PERMISSIONS.PERSONA_EXPORTAR);
    const canOnboarding = hasPermission(PERMISSIONS.PERSONA_ONBOARDING);
    const canVigilancia = hasPermission(PERMISSIONS.PERSONA_VIGILANCIA_SALUD);
    const canDesvincular = hasPermission(PERMISSIONS.PERSONA_DESVINCULAR);
    // Editar datos sensibles de la persona (cargo, teléfono, etc.): mismo permiso
    // que gestionar/añadir personas.
    const canEditarDatos = hasPermission(PERMISSIONS.PERSONAS_CREAR);
    const { options: cargoOptions } = useCargoCatalog();

    const [worker, setWorker] = useState<WorkerWithRole | null>(null);
    const [fotoSaving, setFotoSaving] = useState(false);
    const [fotoSuccess, setFotoSuccess] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState({
        nombre: '', apellidoPaterno: '', apellidoMaterno: '', email: '', telefono: '',
        fechaNacimiento: '', cargo: '', nivelEscolar: '',
        contactoNombre: '', contactoTelefono: '', contactoRelacion: '',
    });
    const [editSaving, setEditSaving] = useState(false);
    // Roles del tenant para mostrar el NOMBRE real del rol (ej. "Persona trabajadora")
    // en vez de un genérico, ya que persona.rol guarda el id.
    const [tenantRoles, setTenantRoles] = useState<{ id?: string; nombre?: string }[]>([]);
    const rolLabel = (rol?: string) => {
        if (!rol) return 'Trabajador';
        if (rol === 'admin') return 'Administrador';
        const r = tenantRoles.find((x) => x.id === rol || (x.nombre || '').toLowerCase() === rol.toLowerCase());
        if (r?.nombre) return r.nombre;
        return rol.charAt(0).toUpperCase() + rol.slice(1).replace(/_/g, ' ');
    };
    const [stats, setStats] = useState<WorkerStats | null>(null);
    const [signatures, setSignatures] = useState<DigitalSignature[]>([]);
    const [, setCompliance] = useState({ completed: 0, assigned: 0 });
    const [ds44Checklist, setDs44Checklist] = useState<{ completed: number; total: number; items: Array<{ key: string; label: string; articulo?: string; kind?: string; tipo?: string; actionLabel?: string; firmaInfo?: string; status: 'ok' | 'pending' | 'na' | 'subido' }> } | null>(null);
    const [docRecordMap, setDocRecordMap] = useState<Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }>>({});
    const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Vigilancia de salud (Art. 67/73) — editable desde la ficha del trabajador
    const [vigForm, setVigForm] = useState({ enVigilancia: false, protocolos: '', fechaUltimoExamen: '', aptitudLaboral: '', restricciones: '' });
    const [vigEditing, setVigEditing] = useState(false);
    const [vigSaving, setVigSaving] = useState(false);
    // Historial de EPP (Art. 13) — entregas/reposiciones validadas por instancia superior
    const [eppHistorial, setEppHistorial] = useState<any[]>([]);
    // Historial de capacitaciones/actividades (cross-obra) para revisar recapacitación.
    const [capacitaciones, setCapacitaciones] = useState<Capacitacion[]>([]);
    const [eppModalOpen, setEppModalOpen] = useState(false);
    const [eppForm, setEppForm] = useState({ esReposicion: false, motivoReposicion: 'desgaste', capacitacionMinutos: '60', capacitacionCompletada: true });
    const [eppItems, setEppItems] = useState<EppItemDraft[]>([{ eppId: '', descripcion: '', cantidad: 1, talla: '' }]);
    // Catálogo de EPP de la empresa: alimenta el selector de la entrega.
    const [eppCatalogo, setEppCatalogo] = useState<EppElemento[]>([]);
    const [eppSaving, setEppSaving] = useState(false);
    const [eppError, setEppError] = useState('');
    const [eppValidating, setEppValidating] = useState<string | null>(null);
    // Desvinculación de la persona de la empresa (acción crítica con confirmación escrita)
    const [desvincularOpen, setDesvincularOpen] = useState(false);
    const [desvincularText, setDesvincularText] = useState('');
    const [desvinculando, setDesvinculando] = useState(false);
    const [desvincularError, setDesvincularError] = useState('');

    const initialTab = new URLSearchParams(location.search).get('tab');
    const [activeTab, setActiveTab] = useState<'datos' | 'asignaciones'>(
        (initialTab === 'asignaciones' || initialTab === 'cumplimiento') ? 'asignaciones' : 'datos'
    );
    const [obrasInfo, setObrasInfo] = useState<Record<string, { nombre?: string; codigo?: string }>>({});

    const getLatestOverrideObraId = (overrides?: Record<string, { items?: Record<string, { doneAt: string }>; updatedAt?: string }>) => {
        if (!overrides) return null;
        let latestId: string | null = null;
        let latestTs = 0;

        Object.entries(overrides).forEach(([obraId, entry]) => {
            let ts = 0;
            if (entry?.updatedAt) {
                const parsed = Date.parse(entry.updatedAt);
                if (!Number.isNaN(parsed)) ts = parsed;
            }
            if (ts === 0 && entry?.items) {
                Object.values(entry.items).forEach((item) => {
                    const parsed = Date.parse(item.doneAt);
                    if (!Number.isNaN(parsed) && parsed > ts) ts = parsed;
                });
            }
            if (ts > latestTs) {
                latestTs = ts;
                latestId = obraId;
            }
        });

        return latestId;
    };

    const resolveTargetObraId = (workerData: WorkerWithRole | null) => {
        if (selectedObraId) return selectedObraId;
        if (!workerData) return null;
        const overrideObraId = getLatestOverrideObraId((workerData as any).onboardingDS44);
        if (overrideObraId) return overrideObraId;
        return workerData.obraIds?.[0] || null;
    };

    useEffect(() => {
        if (rut) {
            loadWorkerData();
        }
    }, [rut, selectedObraId]);

    // Carga los roles del tenant para resolver el nombre del rol de la persona.
    useEffect(() => {
        if (!authTenantId) return;
        tenantsApi.get(authTenantId).then((res) => {
            if (res.success && (res.data as any)?.roles) setTenantRoles((res.data as any).roles);
        }).catch(() => {});
    }, [authTenantId]);

    // Sincroniza el formulario de vigilancia con los datos del trabajador.
    useEffect(() => {
        const v = (worker as any)?.vigilanciaSalud;
        if (!v) return;
        setVigForm({
            enVigilancia: Boolean(v.enVigilancia),
            protocolos: Array.isArray(v.protocolos) ? v.protocolos.join(', ') : (v.protocolos || ''),
            fechaUltimoExamen: v.fechaUltimoExamen ? String(v.fechaUltimoExamen).slice(0, 10) : '',
            aptitudLaboral: v.aptitudLaboral || '',
            restricciones: Array.isArray(v.restricciones) ? v.restricciones.join(', ') : (v.restricciones || ''),
        });
    }, [worker]);

    // El retrato se cambia desde la propia ficha, como en la cuenta propia. Se
    // reescala en el navegador antes de subir: la foto se guarda en el registro
    // de la persona, no en un bucket, así que un JPEG de cámara no cabe.
    const resizeToBase64 = (file: File, maxSize = 320): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                };
                img.onerror = reject;
                img.src = e.target!.result as string;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const handleFotoSelect = async (file: File) => {
        if (!worker) return;
        setFotoSaving(true);
        setFotoSuccess(false);
        try {
            const base64 = await resizeToBase64(file);
            const res = await workersApi.update(worker.personaId, { fotoPerfil: base64 } as any);
            if (res.success) {
                setWorker((prev) => (prev ? { ...prev, fotoPerfil: base64 } : prev));
                setFotoSuccess(true);
                setTimeout(() => setFotoSuccess(false), 2500);
            }
        } catch (err) {
            console.error('Error subiendo la foto:', err);
        } finally {
            setFotoSaving(false);
        }
    };

    const handleFotoRemove = async () => {
        if (!worker) return;
        setFotoSaving(true);
        try {
            const res = await workersApi.update(worker.personaId, { fotoPerfil: null } as any);
            if (res.success) setWorker((prev) => (prev ? { ...prev, fotoPerfil: undefined } : prev));
        } catch (err) {
            console.error('Error quitando la foto:', err);
        } finally {
            setFotoSaving(false);
        }
    };

    const handleSaveVigilancia = async () => {
        if (!worker) return;
        setVigSaving(true);
        try {
            const vigilanciaSalud = {
                enVigilancia: vigForm.enVigilancia,
                protocolos: vigForm.protocolos.split(',').map((s) => s.trim()).filter(Boolean),
                fechaUltimoExamen: vigForm.fechaUltimoExamen || null,
                aptitudLaboral: vigForm.aptitudLaboral || null,
                restricciones: vigForm.restricciones.split(',').map((s) => s.trim()).filter(Boolean),
            };
            const res = await workersApi.update(worker.personaId, { vigilanciaSalud } as any);
            if (res.success) {
                setVigEditing(false);
                await loadWorkerData();
            }
        } catch (err) {
            console.error('Error guardando vigilancia de salud:', err);
        } finally {
            setVigSaving(false);
        }
    };

    const openEditModal = () => {
        if (!worker) return;
        const w = worker as any;
        const ce = w.contactoEmergencia || {};
        setEditForm({
            nombre: w.nombre || '',
            apellidoPaterno: w.apellidoPaterno || '',
            apellidoMaterno: w.apellidoMaterno || '',
            email: w.email || '',
            telefono: w.telefono || '',
            fechaNacimiento: w.fechaNacimiento || '',
            cargo: w.cargo || '',
            nivelEscolar: w.nivelEscolar || '',
            contactoNombre: ce.nombre || '',
            contactoTelefono: ce.telefono || '',
            contactoRelacion: ce.relacion || '',
        });
        setShowEditModal(true);
    };

    const handleSaveEdit = async () => {
        if (!worker) return;
        setEditSaving(true);
        try {
            const apellido = [editForm.apellidoPaterno, editForm.apellidoMaterno].filter(Boolean).join(' ').trim();
            const payload: any = {
                nombre: editForm.nombre.trim(),
                apellidoPaterno: editForm.apellidoPaterno.trim(),
                apellidoMaterno: editForm.apellidoMaterno.trim(),
                apellido,
                email: editForm.email.trim(),
                telefono: editForm.telefono.trim(),
                fechaNacimiento: editForm.fechaNacimiento || null,
                cargo: editForm.cargo || null,
                nivelEscolar: editForm.nivelEscolar.trim(),
                contactoEmergencia: {
                    nombre: editForm.contactoNombre.trim(),
                    telefono: editForm.contactoTelefono.trim(),
                    relacion: editForm.contactoRelacion.trim(),
                },
            };
            const res = await workersApi.update(worker.personaId, payload);
            if (res.success) {
                setShowEditModal(false);
                await loadWorkerData();
            } else {
                setError(res.error || 'No se pudieron guardar los cambios');
            }
        } catch (err) {
            console.error('Error guardando datos de la persona:', err);
            setError('Error de conexión al guardar');
        } finally {
            setEditSaving(false);
        }
    };

    const loadEppHistorial = async (personaId: string) => {
        try {
            const res = await personasApi.getHistorialEpp(authTenantId, personaId);
            if (res.success && res.data) setEppHistorial(res.data.entregas || []);
        } catch (err) {
            console.error('Error cargando historial EPP:', err);
        }
    };

    const loadCapacitaciones = async (personaId: string) => {
        try {
            const res = await personasApi.getCapacitaciones(authTenantId, personaId);
            if (res.success && res.data) setCapacitaciones(res.data.capacitaciones || []);
        } catch (err) {
            console.error('Error cargando capacitaciones:', err);
        }
    };

    // Catálogo de EPP de la empresa: se carga una vez y alimenta el selector de
    // la entrega (antes el nombre se escribía a mano y no era comparable).
    useEffect(() => {
        if (!authTenantId) return;
        let alive = true;
        eppApi.list(authTenantId)
            .then((res) => { if (alive && res.success && res.data) setEppCatalogo(res.data.epp); })
            .catch(() => { /* el modal muestra el estado vacío con su explicación */ });
        return () => { alive = false; };
    }, [authTenantId]);

    useEffect(() => {
        if (worker?.personaId) { loadEppHistorial(worker.personaId); loadCapacitaciones(worker.personaId); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [worker?.personaId]);

    useEffect(() => {
        // Obras a resolver: activas + del historial + de las capacitaciones (cross-obra),
        // para que el historial/currículum muestre el nombre y no el UUID.
        const ids: string[] = Array.from(new Set<string>([
            ...(worker?.obraIds || []),
            ...(worker?.historialAsignaciones || []).map((h) => h.obraId),
            ...capacitaciones.map((c) => c.obraId).filter((x): x is string => !!x),
        ].filter(Boolean)));
        if (!ids.length) return;
        Promise.allSettled(ids.map((id) => obrasApi.getById(id))).then((results) => {
            const map: Record<string, { nombre?: string; codigo?: string }> = {};
            results.forEach((r, i) => {
                if (r.status === 'fulfilled' && r.value.success && r.value.data) {
                    map[ids[i]] = { nombre: r.value.data.nombre, codigo: r.value.data.codigo };
                } else {
                    map[ids[i]] = {};
                }
            });
            setObrasInfo(map);
        });
    }, [
        worker?.obraIds?.join(','),
        (worker?.historialAsignaciones || []).map((h) => h.obraId).join(','),
        capacitaciones.map((c) => c.obraId).join(','),
    ]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetEppForm = () => {
        setEppForm({ esReposicion: false, motivoReposicion: 'desgaste', capacitacionMinutos: '60', capacitacionCompletada: true });
        setEppItems([{ eppId: '', descripcion: '', cantidad: 1, talla: '' }]);
        setEppError('');
    };

    const addEppItem = () => setEppItems((prev) => [...prev, { eppId: '', descripcion: '', cantidad: 1, talla: '' }]);

    const updateEppItem = (index: number, field: keyof EppItemDraft, value: string | number) =>
        setEppItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));

    // Al elegir del catálogo se guardan ambos: la referencia y el nombre con el
    // que quedará impreso el registro de entrega.
    const seleccionarEpp = (index: number, eppId: string) => {
        const elemento = eppCatalogo.find((e) => e.eppId === eppId);
        setEppItems((prev) => prev.map((it, i) => (
            i === index ? { ...it, eppId, descripcion: elemento?.nombre || '' } : it
        )));
    };

    const removeEppItem = (index: number) =>
        setEppItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [{ eppId: '', descripcion: '', cantidad: 1, talla: '' }]));

    const handleCrearEntregaEpp = async () => {
        if (!worker || !user?.personaId) return;
        const items = eppItems
            .map((it) => {
                const elemento = eppCatalogo.find((e) => e.eppId === it.eppId);
                return {
                    eppId: it.eppId || null,
                    descripcion: it.descripcion.trim(),
                    cantidad: Math.max(1, Number(it.cantidad) || 1),
                    talla: it.talla.trim() || null,
                    // Se deja constancia de si el elemento tenía sus respaldos DS44
                    // al momento de la entrega (el catálogo puede completarse después).
                    respaldosFaltantes: elemento && !elemento.completo ? elemento.faltantes : null,
                };
            })
            .filter((it) => it.descripcion);
        if (items.length === 0) { setEppError('Elige al menos un elemento del catálogo.'); return; }
        setEppSaving(true);
        setEppError('');
        try {
            const res = await personasApi.crearEntregaEpp(authTenantId, worker.personaId, {
                creadorId: user.personaId,
                obraId: selectedObraId || worker.obraIds?.[0] || null,
                itemsEntregados: items,
                esReposicion: eppForm.esReposicion,
                motivoReposicion: eppForm.esReposicion ? eppForm.motivoReposicion : null,
                capacitacion: {
                    completada: eppForm.capacitacionCompletada,
                    duracionRealMinutos: Number(eppForm.capacitacionMinutos) || null,
                    relatorId: user.personaId
                }
            });
            if (!res.success) { setEppError(res.error || 'No se pudo registrar la entrega.'); return; }
            setEppModalOpen(false);
            resetEppForm();
            await loadEppHistorial(worker.personaId);
        } catch {
            setEppError('Error de conexion.');
        } finally {
            setEppSaving(false);
        }
    };

    const handleValidarEntrega = async (entregaDocumentId: string) => {
        if (!worker || !user?.personaId) return;
        setEppValidating(entregaDocumentId);
        try {
            const res = await personasApi.validarEntregaEpp(authTenantId, worker.personaId, {
                entregaDocumentId,
                validadorId: user.personaId
            });
            if (res.success) await loadEppHistorial(worker.personaId);
        } catch (err) {
            console.error('Error validando entrega EPP:', err);
        } finally {
            setEppValidating(null);
        }
    };

    // Nombre completo y frase de autorización exigida para desvincular a la persona.
    const nombreCompleto = worker ? `${worker.nombre} ${worker.apellido || ''}`.trim() : '';
    const fraseAutorizacion = `Autorizo desvincular a ${nombreCompleto}`;

    const closeDesvincular = () => {
        setDesvincularOpen(false);
        setDesvincularText('');
        setDesvincularError('');
    };

    const handleDesvincular = async () => {
        if (!worker || desvincularText.trim() !== fraseAutorizacion) return;
        setDesvinculando(true);
        setDesvincularError('');
        try {
            const res = await personasApi.remove(authTenantId, worker.personaId, user?.personaId);
            if (res.success) {
                navigate('/personas');
            } else {
                setDesvincularError(res.error || 'No se pudo desvincular a la persona.');
            }
        } catch {
            setDesvincularError('Error de conexión con el servidor.');
        } finally {
            setDesvinculando(false);
        }
    };

    const loadWorkerData = async () => {
        if (!rut) return;
        setLoading(true);
        setError('');
        try {
            // OPTIMIZED: Use getByRut instead of listing all workers
            const workerRes = await workersApi.getByRut(rut);

            if (!workerRes.success || !workerRes.data) {
                setError('Trabajador no encontrado');
                setLoading(false);
                return;
            }
            setWorker(workerRes.data as WorkerWithRole);

            const targetObraId = resolveTargetObraId(workerRes.data as WorkerWithRole);
            const manualOverrides = targetObraId
                ? (workerRes.data as any).onboardingDS44?.[targetObraId]?.items || {}
                : {};
            const [signaturesRes, , historyRes, docsRes, activitiesRes, surveysRes] = await Promise.all([
                signaturesApi.getByWorker(workerRes.data.personaId),
                signatureRequestsApi.getPendingByWorker(workerRes.data.personaId),
                signatureRequestsApi.getHistoryByWorker(workerRes.data.personaId),
                // TODOS los documentos asignados a la persona (kit de su obra + docs de
                // empresa a nivel tenant), sin importar la obra. Antes era obra-scoped y
                // dejaba fuera los documentos de empresa y a quienes no tienen obra.
                documentsApi.list({ asignadoA: workerRes.data.personaId } as any),
                activitiesApi.list({}),
                surveysApi.list(),
            ]);

            // TRAZABILIDAD: ítems de onboarding cumplidos vía actividad/encuesta
            // VINCULADA (kitItemKey). Asistir / responder cierra el ítem del kit.
            const myId = workerRes.data.personaId;
            const kitDoneByLink = new Set<string>();
            if (activitiesRes.success && activitiesRes.data) {
                (activitiesRes.data.activities || []).forEach((act: any) => {
                    if (act.kitItemKey && (act.asistentes || []).some((a: any) => (a.personaId || a.workerId) === myId)) {
                        kitDoneByLink.add(act.kitItemKey);
                    }
                });
            }
            if (surveysRes.success && surveysRes.data) {
                (surveysRes.data.surveys || []).forEach((s: any) => {
                    if (s.kitItemKey && (s.recipients || []).some((r: any) => (r.personaId || r.workerId) === myId && r.estado === 'respondida')) {
                        kitDoneByLink.add(s.kitItemKey);
                    }
                });
            }

            if (signaturesRes.success && signaturesRes.data) {
                const firmas = signaturesRes.data.firmas || [];
                setSignatures(firmas);

                // Calculate statistics manually
                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                setStats({
                    totalFirmas: firmas.length,
                    firmasUltimos30Dias: firmas.filter(f => new Date(f.timestamp) > thirtyDaysAgo).length,
                    documentosFirmados: firmas.filter(f => (f as any).requestTipo === 'documento' || f.tipoFirma === 'documento').length,
                    actividadesAsistidas: firmas.filter(f =>
                        ['actividad', 'capacitacion', 'CHARLA_5MIN', 'INDUCCION', 'ENTREGA_EPP', 'ART', 'PROCEDIMIENTO', 'INSPECCION', 'REGLAMENTO']
                            .includes((f as any).requestTipo || f.tipoFirma || '')
                    ).length
                });
            }

            const historyItems = historyRes.success && historyRes.data
                ? (historyRes.data.historial || [])
                : [];
            const completedRequests = historyItems
                .map((item: any) => item.solicitud)
                .filter(Boolean);

            const filteredCompleted = targetObraId
                ? completedRequests.filter((req: any) => req.obraId === targetObraId)
                : completedRequests;

            const completedTypes = new Set(filteredCompleted.map((req: any) => req.tipo));

            const docs = docsRes && (docsRes as any).success && (docsRes as any).data
                ? (docsRes as any).data.documents || []
                : [];
            // Tri-estado por tipo: firmado (ok) vs subido-sin-firma (subido) vs nada (pending).
            // "ok" SOLO con firma real del trabajador; subir el archivo NO completa.
            const docSigned = new Map<string, boolean>();
            const docHasFile = new Map<string, boolean>();
            // Firma cruzada (CAPACITACION_SST): completo solo si relator + trabajador firmaron.
            const docRelatorPendiente = new Map<string, boolean>();
            const newDocRecordMap: Record<string, { documentId: string; s3Key: string | null; archivoNombre: string | null }> = {};
            docs.forEach((doc: any) => {
                const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
                const relatorPendiente = Boolean(doc.requiereFirmaRelator) && doc.firmaRelator?.estado !== 'firmado';
                (doc.asignaciones || []).forEach((asig: any) => {
                    const personaId = asig.personaId;
                    if (personaId !== workerRes.data.personaId) return;
                    if (!doc.tipo) return;
                    if (asig.estado === 'firmado' || asig.fechaFirma) docSigned.set(doc.tipo, true);
                    if (hasFile) docHasFile.set(doc.tipo, true);
                    if (relatorPendiente) docRelatorPendiente.set(doc.tipo, true);
                    // Track document record for upload
                    if (!newDocRecordMap[doc.tipo]) {
                        newDocRecordMap[doc.tipo] = { documentId: doc.documentId, s3Key: doc.s3Key || null, archivoNombre: doc.archivoNombre || null };
                    }
                });
            });
            setDocRecordMap(newDocRecordMap);

            let ds44Total = 0;
            let ds44Completed = 0;
            // Terreno (con cargo) → checklist completo del kit. Sin cargo (gestión /
            // oficina) → solo los documentos de empresa que aplican a todos (RI /
            // Política SST), que es lo único que el backend les asigna. Se usa "tiene
            // cargo" como señal (coincide con el backend) en vez del rol, que puede
            // venir con nombres personalizados ("Colaborador") y ocultaría el kit.
            const esTerreno = Boolean((workerRes.data as any).cargo);
            const EMPRESA_KEYS = new Set(['POLITICA_SSO', 'REGLAMENTO_INTERNO']);
            const itemsParaRol = esTerreno
                ? DS44_ONBOARDING_ITEMS
                : DS44_ONBOARDING_ITEMS.filter((it) => EMPRESA_KEYS.has(it.key));
            const checklistItems = itemsParaRol.map((item) => {
                ds44Total += 1;
                const manualDone = Boolean((manualOverrides as any)[item.tipo]);
                // Cumplido vía actividad/encuesta vinculada (kitItemKey).
                const linkDone = kitDoneByLink.has(item.key);

                if (item.kind === 'document') {
                    const trabajadorFirmo = docSigned.get(item.tipo) || false;
                    const relatorPendiente = (docRelatorPendiente.get(item.tipo) || false) && !linkDone;
                    const signed = (trabajadorFirmo && !relatorPendiente) || manualDone || linkDone;
                    const subido = docHasFile.get(item.tipo) || trabajadorFirmo;
                    if (signed) ds44Completed += 1;
                    const status = signed ? 'ok' as const : subido ? 'subido' as const : 'pending' as const;
                    const firmaInfo = relatorPendiente && !signed
                        ? `Trabajador: ${trabajadorFirmo ? 'firmado' : 'pendiente'} | Relator: pendiente`
                        : undefined;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status, firmaInfo };
                }

                if (item.kind === 'signature') {
                    const signed = completedTypes.has(item.tipo) || manualDone || linkDone;
                    if (signed) ds44Completed += 1;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: signed ? 'ok' as const : 'pending' as const };
                }

                if (item.kind === 'actividad') {
                    const hasCap = completedTypes.has('CAPACITACION') || manualDone || linkDone;
                    if (hasCap) ds44Completed += 1;
                    return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: hasCap ? 'ok' as const : 'pending' as const };
                }

                const done = manualDone || linkDone;
                if (done) ds44Completed += 1;
                return { key: item.key, label: item.label, articulo: item.articulo, kind: item.kind, tipo: item.tipo, actionLabel: item.actionLabel, status: done ? 'ok' as const : 'pending' as const };
            });

            setDs44Checklist({ completed: ds44Completed, total: ds44Total, items: checklistItems });
            setCompliance({ completed: ds44Completed, assigned: ds44Total });

        } catch (err) {
            console.error('Error loading worker details:', err);
            setError('Error al cargar la información del trabajador');
        } finally {
            setLoading(false);
        }
    };

    const downloadReport = () => {
        if (!worker || !stats) return;

        const reportContent = `
REPORTE DE TRABAJADOR: ${worker.nombre} ${worker.apellido || ''}
RUT: ${worker.rut}
Fecha: ${new Date().toLocaleDateString('es-CL')}
--------------------------------------------------

DETALLES
- Cargo: ${getCargoLabel(worker.cargo) || 'N/A'}
- Email: ${worker.email || 'N/A'}
- Estado: ${worker.habilitado ? 'Habilitado' : 'Pendiente'}

ESTADÍSTICAS
- Total Firmas: ${stats.totalFirmas}
- Firmas (30 días): ${stats.firmasUltimos30Dias}
- Documentos: ${stats.documentosFirmados}
- Actividades: ${stats.actividadesAsistidas}

HISTORIAL RECIENTE
${signatures.slice(0, 10).map(s => `- ${s.fecha} ${s.horario}: ${s.tipoFirma} (${s.estado})`).join('\n')}

Generado por PrevencionApp
        `.trim();

        const blob = new Blob([reportContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reporte_${worker.rut}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleUploadWorkerDoc = async (tipo: string, file: File) => {
        const docRecord = docRecordMap[tipo];
        if (!docRecord || !worker) return;
        setUploadingDocType(tipo);
        try {
            const uploadRes = await uploadsApi.getUploadUrl({
                archivo: file, fileName: file.name, fileType: file.type, fileSize: file.size,
                categoria: 'trabajadores', empresaId: (worker as any).tenantId || (worker as any).empresaId || 'default'
            });
            if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
            await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: uploadRes.data.uploadHeaders });
            const fileKey = uploadRes.data.fileKey;
            await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });
            await documentsApi.update(docRecord.documentId, { s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name } as any);
            await loadWorkerData(); // Recargar datos
        } catch (err) {
            console.error('Error subiendo documento del trabajador:', err);
        } finally {
            setUploadingDocType(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ height: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    if (error || !worker) {
        return (
            <div className="page-content">
                <div className="card text-center p-12">
                    <LuCircleAlert size={48} className="text-danger-500 mb-4 mx-auto" />
                    <h2 className="text-xl font-bold mb-2">{error || 'Trabajador no encontrado'}</h2>
                    <button className="btn btn-primary" onClick={() => navigate('/personas')}>
                        Volver al listado
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>

            <div className="page-content">
                {/* ── Credencial ── */}
                {(() => {
                    const obraActualId = selectedObraId || worker.obraIds?.[0] || null;
                    const obraActual = obraActualId ? obrasInfo[obraActualId] : null;
                    return (
                        <IdentityPanel
                            eyebrow="Ficha de persona"
                            title={`${worker.nombre} ${worker.apellido || ''}`.trim()}
                            image={(worker as any).fotoPerfil}
                            fallback={`${worker.nombre[0] ?? ''}${worker.apellido?.[0] ?? ''}`.toUpperCase() || '?'}
                            status={{
                                label: worker.habilitado ? 'Habilitado' : 'Pendiente de enrolamiento',
                                tone: worker.habilitado ? 'ok' : 'pending',
                            }}
                            meta={[
                                { label: 'RUT', value: worker.rut, mono: true },
                                { label: 'Cargo', value: getCargoLabel(worker.cargo) || worker.cargo || 'Sin cargo' },
                                {
                                    label: 'Obra actual',
                                    value: obraActual?.nombre || obraActual?.codigo || 'Sin obra asignada',
                                },
                            ]}
                            photo={canEditarDatos ? {
                                onSelect: handleFotoSelect,
                                onRemove: handleFotoRemove,
                                saving: fotoSaving,
                                success: fotoSuccess,
                            } : undefined}
                            actions={canExportar && (
                                <button className="btn btn-secondary btn-sm" onClick={downloadReport}>
                                    <LuDownload size={14} /> Exportar ficha
                                </button>
                            )}
                        />
                    );
                })()}

                {/* ── Tab nav ── */}
                <div className="wd-tab-nav">
                    <button className={`wd-tab${activeTab === 'datos' ? ' wd-tab--active' : ''}`} onClick={() => setActiveTab('datos')}>
                        <LuUser size={14} /> Datos
                    </button>
                    <button className={`wd-tab${activeTab === 'asignaciones' ? ' wd-tab--active' : ''}`} onClick={() => setActiveTab('asignaciones')}>
                        <LuBuild size={14} /> Asignaciones
                    </button>
                </div>

                {/* ── TAB: ASIGNACIONES ── */}
                {activeTab === 'asignaciones' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>

                        {/* Onboarding DS 44 */}
                        {ds44Checklist && (() => {
                            const pct = ds44Checklist.total > 0 ? Math.round((ds44Checklist.completed / ds44Checklist.total) * 100) : 0;
                            const tono = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
                            return (
                                <section className="idp-section">
                                    <div className="idp-section-head">
                                        <div>
                                            <h2 className="idp-section-title">Onboarding DS 44</h2>
                                            <div className="idp-section-sub">
                                                {ds44Checklist.completed} de {ds44Checklist.total} ítems completados
                                            </div>
                                        </div>
                                        {/* El color de la barra ya dice el estado; el número solo lo precisa. */}
                                        <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: tono }}>{pct}%</span>
                                    </div>

                                    <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-elevated)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
                                        <div style={{ width: `${pct}%`, height: '100%', background: tono, transition: 'width 300ms' }} />
                                    </div>

                                    {ds44Checklist.items.map((item) => (
                                        <div key={item.key} className="wd-ds44-item">
                                            <span style={{ flexShrink: 0 }}>
                                                {item.status === 'ok'
                                                    ? <LuCircleCheck size={16} style={{ color: '#10b981' }} />
                                                    : item.status === 'na'
                                                    ? <LuCircleMinus size={16} style={{ color: 'var(--text-muted)' }} />
                                                    : <LuClock size={16} style={{ color: item.status === 'subido' ? '#f59e0b' : 'var(--surface-border)' }} />
                                                }
                                            </span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: item.status === 'ok' ? 400 : 500, color: item.status === 'ok' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                                                    {item.label}
                                                </div>
                                                {(item as any).articulo && (
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                        {(item as any).articulo}
                                                        {(item as any).firmaInfo && <span style={{ color: '#f59e0b' }}> · {(item as any).firmaInfo}</span>}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                {item.status === 'pending' && item.kind === 'document' && (
                                                    <>
                                                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Pendiente de subir</span>
                                                        {canOnboarding && (
                                                            <label className="wd-upload-chip">
                                                                {uploadingDocType === item.tipo ? <><LuClock size={11} /> Subiendo…</> : <><LuDownload size={11} /> Subir</>}
                                                                <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} disabled={!!uploadingDocType}
                                                                    onChange={(e) => { const f = e.target.files?.[0]; if (f && item.tipo) handleUploadWorkerDoc(item.tipo, f); if (e.target) e.target.value = ''; }} />
                                                            </label>
                                                        )}
                                                    </>
                                                )}
                                                {item.status === 'subido' && (
                                                    <>
                                                        <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Pendiente de firma</span>
                                                        {canOnboarding && (
                                                            <label className="wd-upload-chip">
                                                                {uploadingDocType === item.tipo ? <><LuClock size={11} /> Subiendo…</> : <><LuDownload size={11} /> Reemplazar</>}
                                                                <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} disabled={!!uploadingDocType}
                                                                    onChange={(e) => { const f = e.target.files?.[0]; if (f && item.tipo) handleUploadWorkerDoc(item.tipo, f); if (e.target) e.target.value = ''; }} />
                                                            </label>
                                                        )}
                                                    </>
                                                )}
                                                {item.status === 'pending' && item.kind !== 'document' && (
                                                    <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Pendiente de firma</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </section>
                            );
                        })()}

                        {/* Asignar contenido */}
                        <section className="idp-section">
                            <div className="idp-section-head">
                                <div>
                                    <h2 className="idp-section-title">Asignar contenido</h2>
                                    <div className="idp-section-sub">Crea un documento, una actividad o una encuesta ya dirigida a esta persona.</div>
                                </div>
                            </div>
                            <div className="wd-assign-row">
                                <Link to={`/documents?workerRut=${encodeURIComponent(worker.rut)}`} className="btn btn-secondary btn-sm">
                                    <LuFileText size={14} /> Documento
                                </Link>
                                <Link to={`/activities?workerRut=${encodeURIComponent(worker.rut)}`} className="btn btn-secondary btn-sm">
                                    <LuActivity size={14} /> Actividad
                                </Link>
                                <Link to={`/surveys?workerRut=${encodeURIComponent(worker.rut)}`} className="btn btn-secondary btn-sm">
                                    <LuShieldCheck size={14} /> Encuesta
                                </Link>
                            </div>
                        </section>

                        {/* Obras asignadas */}
                        {worker.obraIds && worker.obraIds.length > 0 && (
                            <section className="idp-section">
                                <div className="idp-section-head">
                                    <div>
                                        <h2 className="idp-section-title">Obras asignadas</h2>
                                        <div className="idp-section-sub">
                                            {worker.obraIds.length} {worker.obraIds.length === 1 ? 'obra' : 'obras'} · avance de onboarding en cada una
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    {(worker.obraIds as string[]).map((obraId) => {
                                        const info = obrasInfo[obraId];
                                        const onboardingEntry = (worker as any).onboardingDS44?.[obraId];
                                        const items = onboardingEntry?.items ? Object.values(onboardingEntry.items as Record<string, any>) : [];
                                        const completed = items.filter((it: any) => it.doneAt).length;
                                        const total = items.length;
                                        const pct = total > 0 ? Math.round((completed / total) * 100) : null;
                                        return (
                                            <div key={obraId} className="wd-list-row">
                                                <LuBuild size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{info?.nombre || info?.codigo || obraId}</span>
                                                    {info?.codigo && info?.nombre && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>{info.codigo}</span>}
                                                </div>
                                                {pct !== null && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                                        <div style={{ width: 48, height: 4, borderRadius: 999, background: 'var(--surface-elevated)', overflow: 'hidden' }}>
                                                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                                                        </div>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{completed}/{total}</span>
                                                    </div>
                                                )}
                                                <Link to={`/obras/${obraId}`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem', padding: '2px 8px', flexShrink: 0 }}>Ver</Link>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* Historial de cumplimiento */}
                        <section className="idp-section">
                            <div className="idp-section-head">
                                <div>
                                    <h2 className="idp-section-title">Historial de cumplimiento</h2>
                                    <div className="idp-section-sub">
                                        {signatures.length} {signatures.length === 1 ? 'firma registrada' : 'firmas registradas'}
                                    </div>
                                </div>
                            </div>
                            {signatures.length === 0 ? (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    Aún no hay firmas. Asigna un documento o una actividad para empezar el registro.
                                </div>
                            ) : (
                                <div className="table-container">
                                    <table className="table">
                                        <thead>
                                            <tr><th>Tipo</th><th>Documento / Actividad</th><th>Fecha</th><th>Estado</th></tr>
                                        </thead>
                                        <tbody>
                                            {signatures.map((sig, idx) => {
                                                const s = sig as any;
                                                const fecha = s.fechaFirma || s.fecha;
                                                return (
                                                    <tr key={s.firmaId || s.id || idx}>
                                                        <td>{getSigIcon(sig)}</td>
                                                        <td style={{ fontSize: '0.85rem' }}>{s.requestTitulo || s.titulo || s.nombre || '—'}</td>
                                                        <td style={{ fontSize: '0.85rem' }}>{fecha ? new Date(fecha).toLocaleDateString('es-CL') : '—'}</td>
                                                        <td><span className={`badge badge-sm badge-${sig.estado === 'valida' ? 'success' : 'warning'}`}>{sig.estado === 'valida' ? 'Válida' : sig.estado}</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>

                        {/* Historial de obras (auditoría) */}
                        {Array.isArray(worker.historialAsignaciones) && worker.historialAsignaciones.length > 0 && (
                            <section className="idp-section">
                                <div className="idp-section-head">
                                    <div>
                                        <h2 className="idp-section-title">Obras anteriores</h2>
                                        <div className="idp-section-sub">Asignaciones cerradas, con su motivo de egreso</div>
                                    </div>
                                </div>
                                <div>
                                    {worker.historialAsignaciones.slice().reverse().map((h, i) => {
                                        const oi = obrasInfo[h.obraId];
                                        const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('es-CL') : '—';
                                        return (
                                            <div key={i} className="wd-list-row">
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 500, fontSize: '0.88rem' }}>{oi?.nombre || oi?.codigo || h.obraId}</div>
                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                                        {(h.cargos || []).join(', ') || 'sin cargo'} · {fmt(h.fechaIngreso)} → {fmt(h.fechaEgreso)}
                                                    </div>
                                                </div>
                                                <span className={`badge badge-sm ${h.motivo === 'transferencia' ? 'badge-info' : 'badge-warning'}`}>{h.motivo || 'egreso'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* Currículum */}
                        <section className="idp-section">
                            <div className="idp-section-head">
                                <div>
                                    <h2 className="idp-section-title">Currículum</h2>
                                    <div className="idp-section-sub">Lo que la persona acredita, más allá de la obra en la que esté</div>
                                </div>
                            </div>

                            <div className="idp-subhead">Cursos y certificaciones</div>
                            {Array.isArray(worker.cursos) && worker.cursos.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {worker.cursos.map((c, i) => <span key={i} className="badge badge-sm badge-neutral">{c.nombre}</span>)}
                                </div>
                            ) : <div className="wd-empty-line">Sin cursos registrados.</div>}

                            <div className="idp-subhead">Evidencias vigentes</div>
                            {Array.isArray(worker.evidencias) && worker.evidencias.length > 0 ? (
                                <div>
                                    {worker.evidencias.map((e, i) => {
                                        const vencida = e.venceEn ? new Date(e.venceEn).getTime() < Date.now() : false;
                                        return (
                                            <div key={i} className="wd-list-row">
                                                <span style={{ flex: 1, minWidth: 0, fontSize: '0.88rem' }}>{e.nombre || e.tipo}</span>
                                                {e.venceEn && <span className={`badge badge-sm ${vencida ? 'badge-danger' : 'badge-success'}`}>{vencida ? 'Vencida' : 'Vigente'} · {new Date(e.venceEn).toLocaleDateString('es-CL')}</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : <div className="wd-empty-line">Sin evidencias registradas.</div>}

                            <div className="idp-subhead">Capacitaciones y actividades</div>
                            {capacitaciones.length > 0 ? (
                                <div>
                                    {capacitaciones.map((c) => {
                                        const oi = c.obraId ? obrasInfo[c.obraId] : null;
                                        return (
                                            <div key={c.activityId} className="wd-list-row">
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{c.subtipoDescripcion || c.tipoDescripcion || c.titulo}</div>
                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 1 }}>
                                                        {c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—'}
                                                        {oi && <> · {oi.nombre || oi.codigo}</>}
                                                    </div>
                                                </div>
                                                <Link to={`/activities?activity=${c.activityId}`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem', flexShrink: 0 }}>Ver</Link>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : <div className="wd-empty-line">Sin capacitaciones registradas.</div>}
                        </section>
                    </div>
                )}

                {/* ── TAB: DATOS ── */}
                {activeTab === 'datos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>

                    {/* Stats — fila inline sin cajas */}
                    {stats && (
                        <div className="wd-stats-row">
                            <div className="wd-stat">
                                <div className="wd-stat-val">{stats.totalFirmas}</div>
                                <div className="wd-stat-lab">Firmas totales</div>
                            </div>
                            <div className="wd-stat">
                                <div className="wd-stat-val">{stats.firmasUltimos30Dias}</div>
                                <div className="wd-stat-lab">Últimos 30 días</div>
                            </div>
                            <div className="wd-stat">
                                <div className="wd-stat-val">{stats.documentosFirmados}</div>
                                <div className="wd-stat-lab">Docs. firmados</div>
                            </div>
                            <div className="wd-stat">
                                <div className="wd-stat-val">{stats.actividadesAsistidas}</div>
                                <div className="wd-stat-lab">Asistencias</div>
                            </div>
                        </div>
                    )}

                    {/* Información personal */}
                    <section className="idp-section">
                        <div className="idp-section-head">
                            <div>
                                <h2 className="idp-section-title">Información</h2>
                                <div className="idp-section-sub">Datos personales y de contacto</div>
                            </div>
                            {canEditarDatos && (
                                <button className="btn btn-ghost btn-sm" type="button" onClick={openEditModal}>
                                    <LuPencil size={13} /> Editar datos
                                </button>
                            )}
                        </div>
                        <div className="idp-fields">
                            <div className="idp-field">
                                <div className="idp-field-label">Correo</div>
                                <div className="idp-field-value">{worker.email || <span className="idp-field-value--empty">Sin correo</span>}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field-label">Rol de sistema</div>
                                <div className="idp-field-value">{rolLabel(worker.rol)}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field-label">Teléfono</div>
                                <div className="idp-field-value">{(worker as any).telefono || <span className="idp-field-value--empty">Sin teléfono</span>}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field-label">Fecha de nacimiento</div>
                                <div className="idp-field-value">{(worker as any).fechaNacimiento || <span className="idp-field-value--empty">—</span>}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field-label">Nivel escolar</div>
                                <div className="idp-field-value">{(worker as any).nivelEscolar || <span className="idp-field-value--empty">—</span>}</div>
                            </div>
                            <div className="idp-field">
                                <div className="idp-field-label">Cursos</div>
                                <div className="idp-field-value">
                                    {(() => {
                                        const cursos = (worker as any).cursos;
                                        const list = Array.isArray(cursos)
                                            ? cursos.map((c: any) => (typeof c === 'string' ? c : c?.nombre)).filter(Boolean)
                                            : [];
                                        return list.length > 0
                                            ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{list.map((c: string, i: number) => <span key={i} className="badge badge-secondary" style={{ fontSize: '0.72rem' }}>{c}</span>)}</div>
                                            : <span className="idp-field-value--empty">Sin cursos registrados</span>;
                                    })()}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Contacto de emergencia */}
                    {(() => {
                        const ce = (worker as any).contactoEmergencia || {};
                        const hasContacto = ce.nombre || ce.telefono || ce.relacion;
                        return (
                            <div className="idp-section">
                                <div className="idp-section-head">
                                    <div>
                                        <h2 className="idp-section-title">Contacto de emergencia</h2>
                                        <div className="idp-section-sub">A quién avisar ante una emergencia</div>
                                    </div>
                                </div>
                                {hasContacto ? (
                                    <div className="idp-fields">
                                        {[
                                            { label: 'Nombre', value: ce.nombre },
                                            { label: 'Teléfono', value: ce.telefono },
                                            { label: 'Relación', value: ce.relacion },
                                        ].map(({ label, value }) => (
                                            <div key={label} className="idp-field">
                                                <div className="idp-field-label">{label}</div>
                                                <div className="idp-field-value">
                                                    {value || <span className="idp-field-value--empty">—</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                        Sin contacto de emergencia registrado.
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* Vigilancia de Salud */}
                    <div className="idp-section">
                        <div className="idp-section-head">
                            <div>
                                <h2 className="idp-section-title">Vigilancia de salud</h2>
                                <div className="idp-section-sub">Art. 67/73</div>
                            </div>
                            {canVigilancia && (!vigEditing ? (
                                <button className="btn btn-ghost btn-sm" type="button" onClick={() => setVigEditing(true)}>Editar</button>
                            ) : (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => setVigEditing(false)}>Cancelar</button>
                                    <button className="btn btn-sm" type="button" disabled={vigSaving} onClick={handleSaveVigilancia}
                                        style={{ background: '#f13800', color: '#fff', border: 'none' }}>
                                        {vigSaving ? 'Guardando…' : 'Guardar'}
                                    </button>
                                </div>
                            ))}
                        </div>
                        {!vigEditing ? (
                            <div className="idp-fields">
                                <div className="idp-field">
                                    <div className="idp-field-label">En vigilancia</div>
                                    <div className="idp-field-value">
                                        <span className={`badge ${vigForm.enVigilancia ? 'badge-warning' : 'badge-secondary'}`}>
                                            {vigForm.enVigilancia ? 'Sí' : 'No'}
                                        </span>
                                    </div>
                                </div>
                                {[
                                    { label: 'Protocolos', value: vigForm.protocolos },
                                    { label: 'Último examen', value: vigForm.fechaUltimoExamen },
                                    { label: 'Aptitud laboral', value: vigForm.aptitudLaboral },
                                    { label: 'Restricciones', value: vigForm.restricciones },
                                ].map(({ label, value }) => (
                                    <div key={label} className="idp-field">
                                        <div className="idp-field-label">{label}</div>
                                        <div className="idp-field-value">
                                            {value || <span className="idp-field-value--empty">—</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input type="checkbox" checked={vigForm.enVigilancia} onChange={(e) => setVigForm({ ...vigForm, enVigilancia: e.target.checked })} />
                                    <span>En programa de vigilancia de la salud</span>
                                </label>
                                <div className="form-group"><label className="form-label">Protocolos</label><input type="text" className="form-input" placeholder="Ej: PLANESI, Ruido, Sílice" value={vigForm.protocolos} onChange={(e) => setVigForm({ ...vigForm, protocolos: e.target.value })} /><span className="form-hint">Separar con coma</span></div>
                                <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                                    <div className="form-group"><label className="form-label">Último examen</label><input type="date" className="form-input" value={vigForm.fechaUltimoExamen} onChange={(e) => setVigForm({ ...vigForm, fechaUltimoExamen: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">Aptitud laboral</label><input type="text" className="form-input" placeholder="apto / apto con restricciones / no apto" value={vigForm.aptitudLaboral} onChange={(e) => setVigForm({ ...vigForm, aptitudLaboral: e.target.value })} /></div>
                                </div>
                                <div className="form-group"><label className="form-label">Restricciones</label><input type="text" className="form-input" placeholder="Ej: No trabajo en altura" value={vigForm.restricciones} onChange={(e) => setVigForm({ ...vigForm, restricciones: e.target.value })} /><span className="form-hint">Separar con coma</span></div>
                            </div>
                        )}
                    </div>

                    {/* EPP historial */}
                    <div className="idp-section">
                        <div className="idp-section-head">
                            <div>
                                <h2 className="idp-section-title">Historial de EPP</h2>
                                <div className="idp-section-sub">Art. 13 — entregas y reposiciones</div>
                            </div>
                            {canValidarEpp && (
                                <button className="btn btn-sm" type="button" onClick={() => { resetEppForm(); setEppModalOpen(true); }}
                                    style={{ background: '#f13800', color: '#fff', border: 'none' }}>
                                    Nueva entrega
                                </button>
                            )}
                        </div>
                        <div>
                            {eppHistorial.length === 0 ? (
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin entregas de EPP registradas.</div>
                            ) : (
                                <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
                                    <table className="table">
                                        <thead>
                                            <tr><th>Fecha</th><th>Items</th><th>Reposición</th><th>Validado por</th><th>Cap. uso</th><th>Estado</th></tr>
                                        </thead>
                                        <tbody>
                                            {eppHistorial.map((e: any) => {
                                                const validado = e.validacion?.estado === 'validado';
                                                return (
                                                    <tr key={e.documentId}>
                                                        <td style={{ fontSize: '0.82rem' }}>{e.fecha ? new Date(e.fecha).toLocaleDateString('es-CL') : '-'}</td>
                                                        <td style={{ fontSize: '0.82rem' }}>{(e.itemsEntregados || []).map((i: any) => `${i.descripcion} x${i.cantidad}${i.talla ? ` (${i.talla})` : ''}`).join(', ') || '-'}</td>
                                                        <td style={{ fontSize: '0.82rem' }}>{e.esReposicion ? (e.motivoReposicion || 'Sí') : 'No'}</td>
                                                        <td style={{ fontSize: '0.82rem' }}>{e.validacion?.validadoPor?.nombre || '-'}</td>
                                                        <td style={{ fontSize: '0.82rem' }}>{e.capacitacionUso?.completada ? `${e.capacitacionUso.duracionRealMinutos || 60} min` : 'Pendiente'}</td>
                                                        <td>
                                                            {e.firmadoPorTrabajador
                                                                ? <span className="badge badge-success">Firmado</span>
                                                                : validado
                                                                    ? <span className="badge badge-info">Falta firma</span>
                                                                    : (
                                                                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                                            <span className="badge badge-warning">Pendiente</span>
                                                                            {canValidarEpp && (
                                                                                <button className="btn btn-secondary btn-sm" type="button"
                                                                                    disabled={eppValidating === e.documentId}
                                                                                    onClick={() => handleValidarEntrega(e.documentId)}>
                                                                                    {eppValidating === e.documentId ? '...' : 'Validar'}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Evidencias persona-level */}
                    <WorkerEvidencias
                        personaId={worker.personaId}
                        tenantId={authTenantId}
                        initial={(worker as any).evidencias || []}
                        canEdit={canVigilancia}
                    />

                    {/* Danger zone */}
                    {canDesvincular && worker.rol !== 'admin' && (
                        <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                            <div className="worker-danger-zone">
                                <button type="button" className="worker-danger-btn"
                                    onClick={() => { setDesvincularError(''); setDesvincularText(''); setDesvincularOpen(true); }}>
                                    <LuTriangleAlert size={15} />
                                    <span>Eliminar persona de la empresa</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                )}

            </div>

            <style>{`
                .page-content { padding-bottom: var(--space-8); }

                /* ── Tabs ── */
                .wd-tab-nav {
                    display: flex; gap: 0;
                    border-bottom: 2px solid var(--surface-border);
                    margin-bottom: var(--space-5);
                    margin-top: var(--space-2);
                }
                .wd-tab {
                    display: inline-flex; align-items: center; gap: 6px;
                    padding: 9px 18px;
                    font-size: var(--text-sm); font-weight: 500;
                    color: var(--text-muted);
                    background: none; border: none; cursor: pointer;
                    border-bottom: 2px solid transparent;
                    margin-bottom: -2px;
                    transition: color var(--transition-fast), border-color var(--transition-fast);
                }
                .wd-tab:hover { color: var(--text-primary); }
                .wd-tab--active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

                /* ── Datos: cifras ── */
                .wd-stats-row {
                    display: flex; gap: 0;
                    border-top: 1px solid var(--surface-border);
                    border-bottom: 1px solid var(--surface-border);
                }
                .wd-stat {
                    flex: 1; padding: var(--space-4) var(--space-5) var(--space-4) 0;
                }
                .wd-stat + .wd-stat {
                    padding-left: var(--space-5);
                    border-left: 1px solid var(--surface-border);
                }
                .wd-stat-val {
                    font-size: var(--text-2xl); font-weight: 700;
                    color: var(--text-primary); line-height: 1;
                    letter-spacing: -0.02em;
                }
                .wd-stat-lab { font-size: 0.7rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

                /* ── Asignaciones: filas de lista ──
                   Mismo recurso que la rejilla de campos: el filete separa, no la
                   caja. Sirve igual para obras, evidencias y capacitaciones. */
                .wd-list-row {
                    display: flex; align-items: center; gap: var(--space-3);
                    padding: 10px 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .wd-list-row:last-child { border-bottom: none; }

                .wd-ds44-item {
                    display: flex; align-items: center; gap: var(--space-2);
                    padding: 8px 0;
                    border-bottom: 1px solid var(--surface-border);
                }
                .wd-ds44-item:last-child { border-bottom: none; }

                /* Subir archivo dentro de un ítem: control pequeño, no botón pleno. */
                .wd-upload-chip {
                    display: inline-flex; align-items: center; gap: 4px;
                    padding: 2px 8px; border-radius: var(--radius-sm);
                    border: 1px solid var(--surface-border);
                    background: var(--surface-elevated); color: var(--text-primary);
                    font-size: 0.75rem; cursor: pointer;
                    transition: border-color var(--transition-fast);
                }
                .wd-upload-chip:hover { border-color: var(--accent); }

                .wd-assign-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }

                .wd-empty-line { font-size: 0.85rem; color: var(--text-muted); }

                /* ── Tables ── */
                .table-container { overflow-x: auto; }
                .table { width: 100%; min-width: 500px; }
                .table th {
                    padding: var(--space-2) var(--space-3);
                    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em;
                    color: var(--text-muted); font-weight: 700;
                    border-bottom: 1px solid var(--surface-border);
                }
                .table td { padding: var(--space-3); border-bottom: 1px solid var(--surface-border); vertical-align: middle; }
                .table tbody tr:hover { background: var(--surface-elevated); }

                /* ── Danger zone ── */
                .worker-danger-zone { margin-top: 0; }
                .worker-danger-btn {
                    display: inline-flex; align-items: center; gap: 8px;
                    padding: 8px 14px;
                    border-radius: var(--radius-md);
                    border: 1px solid rgba(239,68,68,0.35);
                    background: rgba(239,68,68,0.06); color: #dc2626;
                    font-size: 0.82rem; font-weight: 600; cursor: pointer;
                    transition: background 0.15s, border-color 0.15s;
                }
                .worker-danger-btn:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.55); }

                /* ── EPP modal ── */
                .signatures-timeline { position: relative; }
                .border-bottom { border-bottom: 1px solid var(--surface-border); }

                @media (max-width: 600px) {
                    .wd-stats-row { flex-wrap: wrap; }
                    .wd-stat { flex: 1 1 45%; border-right: 1px solid var(--surface-border); }
                }
            `}</style>

            {/* Modal: nueva entrega / reposicion de EPP (solo instancia superior) */}
            <Modal
                isOpen={eppModalOpen}
                onClose={() => { setEppModalOpen(false); resetEppForm(); }}
                title="Nueva entrega / Reposición de EPP"
                subtitle="Art. 13 DS44 — La entrega queda pendiente de validación y de firma del trabajador"
                size="lg"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={() => { setEppModalOpen(false); resetEppForm(); }}>Cancelar</button>
                        <button className="btn btn-primary" onClick={handleCrearEntregaEpp} disabled={eppSaving}>
                            {eppSaving ? 'Guardando…' : 'Registrar entrega'}
                        </button>
                    </div>
                }
            >
                <div className="epp-modal">
                    {eppError && (
                        <div className="epp-alert" role="alert">
                            <LuCircleAlert size={15} />
                            <span>{eppError}</span>
                        </div>
                    )}

                    {/* ── Items entregados ── */}
                    <section className="epp-section">
                        <div className="epp-section-head">
                            <div className="epp-section-title">
                                <LuShieldCheck size={15} className="text-primary-500" />
                                <span>Elementos entregados</span>
                            </div>
                            <span className="epp-count">{eppItems.filter(i => i.descripcion.trim()).length} ítem(s)</span>
                        </div>

                        {/* Sin catálogo no hay nada que elegir: se explica dónde crearlo */}
                        {eppCatalogo.length === 0 && (
                            <p className="epp-catalogo-vacio">
                                <LuTriangleAlert size={13} aria-hidden="true" />
                                El catálogo de EPP de la empresa está vacío. Agrega los elementos en
                                <strong> Mi Empresa › EPP</strong> para poder registrar entregas.
                            </p>
                        )}

                        <div className="epp-items">
                            {eppItems.map((item, index) => (
                                <div className="epp-item-card" key={index}>
                                    <div className="epp-item-card-header">
                                        <span className="epp-item-badge">Ítem {index + 1}</span>
                                        <button
                                            type="button"
                                            className="epp-remove"
                                            onClick={() => removeEppItem(index)}
                                            title="Quitar ítem"
                                            aria-label="Quitar ítem"
                                        >
                                            <LuTrash2 size={14} />
                                        </button>
                                    </div>
                                    <div className="epp-item-desc">
                                        <label className="epp-mini-label">Elemento de protección personal</label>
                                        <Select
                                            ariaLabel={`Elemento de protección personal del ítem ${index + 1}`}
                                            placeholder="Elige un elemento del catálogo"
                                            searchable
                                            value={item.eppId}
                                            onChange={(v) => seleccionarEpp(index, v)}
                                            options={eppCatalogo.map((e) => ({
                                                value: e.eppId,
                                                label: e.nombre,
                                                description: e.completo
                                                    ? (e.descripcion || undefined)
                                                    : faltantesLabel(e.faltantes),
                                            }))}
                                        />
                                        {(() => {
                                            // Aviso DS44: se puede entregar igual, pero la falta queda visible.
                                            const elemento = eppCatalogo.find((e) => e.eppId === item.eppId);
                                            if (!elemento || elemento.completo) return null;
                                            return (
                                                <p className="epp-item-warn">
                                                    <LuTriangleAlert size={12} aria-hidden="true" />
                                                    {faltantesLabel(elemento.faltantes)} exigido por el DS44.
                                                    Puedes entregarlo, pero quedará registrado.
                                                </p>
                                            );
                                        })()}
                                    </div>
                                    <div className="epp-item-meta">
                                        <div className="epp-item-qty">
                                            <label className="epp-mini-label">Cantidad</label>
                                            <div className="epp-stepper">
                                                <button
                                                    type="button"
                                                    className="epp-step-btn"
                                                    onClick={() => updateEppItem(index, 'cantidad', Math.max(1, (Number(item.cantidad) || 1) - 1))}
                                                    aria-label="Disminuir cantidad"
                                                >
                                                    <LuMinus size={13} />
                                                </button>
                                                <input
                                                    className="epp-step-input"
                                                    type="number"
                                                    min={1}
                                                    value={item.cantidad}
                                                    onChange={(e) => updateEppItem(index, 'cantidad', Math.max(1, Number(e.target.value) || 1))}
                                                />
                                                <button
                                                    type="button"
                                                    className="epp-step-btn"
                                                    onClick={() => updateEppItem(index, 'cantidad', (Number(item.cantidad) || 1) + 1)}
                                                    aria-label="Aumentar cantidad"
                                                >
                                                    <LuPlus size={13} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="epp-item-size">
                                            <label className="epp-mini-label">Talla <span className="epp-opt">(opcional)</span></label>
                                            <input
                                                className="form-input"
                                                placeholder="M, 42…"
                                                value={item.talla}
                                                onChange={(e) => updateEppItem(index, 'talla', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <button type="button" className="epp-add-btn" onClick={addEppItem}>
                            <LuPlus size={15} /> Agregar ítem
                        </button>
                    </section>

                    {/* ── Reposición ── */}
                    <section className="epp-section">
                        <label className="epp-toggle">
                            <input type="checkbox" checked={eppForm.esReposicion} onChange={(e) => setEppForm({ ...eppForm, esReposicion: e.target.checked })} />
                            <span className="epp-toggle-text">
                                <span className="epp-toggle-title">Es una reposición</span>
                                <span className="epp-toggle-desc">Reemplazo de un EPP ya entregado</span>
                            </span>
                        </label>
                        {eppForm.esReposicion && (
                            <div className="form-group epp-sub-field">
                                <label className="form-label">Motivo de reposición</label>
                                <select className="form-input form-select" value={eppForm.motivoReposicion} onChange={(e) => setEppForm({ ...eppForm, motivoReposicion: e.target.value })}>
                                    <option value="desgaste">Desgaste</option>
                                    <option value="perdida">Pérdida</option>
                                    <option value="accidente">Accidente</option>
                                    <option value="cambio_talla">Cambio de talla</option>
                                    <option value="otro">Otro</option>
                                </select>
                            </div>
                        )}
                    </section>

                    {/* ── Capacitación de uso ── */}
                    <section className="epp-section">
                        <label className="epp-toggle">
                            <input type="checkbox" checked={eppForm.capacitacionCompletada} onChange={(e) => setEppForm({ ...eppForm, capacitacionCompletada: e.target.checked })} />
                            <span className="epp-toggle-text">
                                <span className="epp-toggle-title">Capacitación de uso realizada</span>
                                <span className="epp-toggle-desc">Art. 13 — instrucción sobre el uso correcto del EPP</span>
                            </span>
                        </label>
                        {eppForm.capacitacionCompletada && (
                            <div className="form-group epp-sub-field">
                                <label className="form-label">Duración de la capacitación (minutos)</label>
                                <input type="number" className="form-input" min={0} value={eppForm.capacitacionMinutos} onChange={(e) => setEppForm({ ...eppForm, capacitacionMinutos: e.target.value })} />
                                <span className="form-hint">Mínimo recomendado: 60 minutos.</span>
                            </div>
                        )}
                    </section>
                </div>

                <style>{`
                    /* ── EPP modal wrapper ── */
                    .epp-modal {
                        display: flex;
                        flex-direction: column;
                        gap: var(--space-4);
                    }
                    /* ── Alert ── */
                    .epp-modal .epp-alert {
                        display: flex; align-items: center; gap: 8px;
                        padding: 10px 14px; border-radius: var(--radius-md);
                        background: rgba(239, 68, 68, 0.08);
                        border: 1px solid rgba(239, 68, 68, 0.25);
                        color: var(--danger-600, #b91c1c); font-size: 0.82rem;
                    }
                    /* ── Section card ── */
                    .epp-section {
                        background: var(--surface-elevated);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-lg);
                        padding: var(--space-5);
                    }
                    .epp-section-head {
                        display: flex; align-items: center; justify-content: space-between;
                        margin-bottom: var(--space-4);
                    }
                    .epp-section-title {
                        display: flex; align-items: center; gap: 8px;
                        font-weight: 600; font-size: 0.9rem; color: var(--text-primary);
                    }
                    .epp-count {
                        font-size: 0.72rem; font-weight: 600;
                        color: var(--text-muted);
                        background: var(--surface-border);
                        padding: 2px 8px; border-radius: var(--radius-full);
                    }
                    /* ── Item list ── */
                    .epp-items { display: flex; flex-direction: column; gap: 10px; }
                    /* ── Item card ── */
                    .epp-item-card {
                        background: var(--surface-card);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-md);
                        padding: 14px 16px;
                        display: flex;
                        flex-direction: column;
                        gap: 12px;
                        transition: border-color 0.15s;
                    }
                    .epp-item-card:focus-within {
                        border-color: var(--primary-400);
                    }
                    .epp-item-card-header {
                        display: flex; align-items: center; justify-content: space-between;
                    }
                    .epp-item-badge {
                        font-size: 0.68rem; font-weight: 700;
                        text-transform: uppercase; letter-spacing: 0.06em;
                        color: var(--text-muted);
                    }
                    .epp-item-desc { width: 100%; }
                    /* Aviso de respaldo DS44 faltante: ámbar, la entrega sigue permitida */
                    .epp-item-warn {
                        display: flex; align-items: flex-start; gap: 5px;
                        margin: 6px 0 0; font-size: 11px; line-height: 1.45;
                        color: var(--warning-600, var(--warning-500));
                    }
                    .epp-item-warn svg { flex-shrink: 0; margin-top: 1px; }
                    .epp-catalogo-vacio {
                        display: flex; align-items: flex-start; gap: 6px;
                        margin: 0 0 var(--space-3); padding: 9px 11px; border-radius: var(--radius-md);
                        font-size: var(--text-xs); line-height: 1.5;
                        color: var(--warning-600, var(--warning-500));
                        background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.25);
                    }
                    .epp-catalogo-vacio svg { flex-shrink: 0; margin-top: 2px; }
                    /* ── Item meta row: qty + talla ── */
                    .epp-item-meta {
                        display: grid;
                        grid-template-columns: 180px 1fr;
                        gap: 12px;
                        align-items: end;
                    }
                    /* ── Labels ── */
                    .epp-mini-label {
                        display: block; font-size: 0.7rem; font-weight: 600;
                        text-transform: uppercase; letter-spacing: 0.03em;
                        color: var(--text-muted); margin-bottom: 4px;
                    }
                    .epp-opt { font-weight: 400; text-transform: none; letter-spacing: 0; }
                    /* ── Quantity stepper ── */
                    .epp-stepper {
                        display: flex; align-items: center;
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-md);
                        background: var(--surface-card);
                        overflow: hidden; height: 38px;
                    }
                    .epp-step-btn {
                        display: flex; align-items: center; justify-content: center;
                        width: 36px; height: 100%; border: none; cursor: pointer; flex-shrink: 0;
                        background: var(--surface-elevated); color: var(--text-primary);
                        transition: background 0.15s;
                    }
                    .epp-step-btn:hover { background: var(--surface-hover); color: var(--primary-500); }
                    .epp-step-input {
                        flex: 1; min-width: 0; text-align: center; border: none; outline: none;
                        background: transparent; color: var(--text-primary);
                        font-size: 0.9rem; font-weight: 600;
                        -moz-appearance: textfield;
                    }
                    .epp-step-input::-webkit-outer-spin-button,
                    .epp-step-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                    /* ── Remove button ── */
                    .epp-remove {
                        display: flex; align-items: center; justify-content: center;
                        width: 30px; height: 30px; border-radius: var(--radius-md);
                        border: 1px solid var(--surface-border); background: transparent;
                        color: var(--text-muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0;
                    }
                    .epp-remove:hover {
                        color: var(--danger-500, #ef4444);
                        border-color: rgba(239, 68, 68, 0.35);
                        background: rgba(239, 68, 68, 0.06);
                    }
                    /* ── Add item button ── */
                    .epp-add-btn {
                        display: flex; align-items: center; justify-content: center; gap: 6px;
                        margin-top: 10px; padding: 9px 14px; width: 100%;
                        border: 1px dashed var(--primary-400); border-radius: var(--radius-md);
                        background: transparent; color: var(--primary-500);
                        font-size: 0.83rem; font-weight: 600; cursor: pointer;
                        transition: all 0.15s;
                    }
                    .epp-add-btn:hover {
                        background: rgba(0, 110, 220, 0.06);
                        border-color: var(--primary-500);
                    }
                    /* ── Toggle (checkbox + text) ── */
                    .epp-toggle {
                        display: flex; align-items: flex-start; gap: 12px; cursor: pointer;
                    }
                    .epp-toggle input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; }
                    .epp-toggle-text { display: flex; flex-direction: column; gap: 3px; }
                    .epp-toggle-title { font-weight: 600; font-size: 0.88rem; color: var(--text-primary); }
                    .epp-toggle-desc { font-size: 0.76rem; color: var(--text-muted); line-height: 1.4; }
                    /* ── Sub-field (conditional) ── */
                    .epp-sub-field { margin: var(--space-4) 0 0; }
                    /* ── Responsive ── */
                    @media (max-width: 520px) {
                        .epp-item-meta { grid-template-columns: 1fr 1fr; }
                    }
                `}</style>
            </Modal>

            {/* Modal: desvincular persona de la empresa (confirmación escrita) */}
            <Modal
                isOpen={desvincularOpen}
                onClose={closeDesvincular}
                title="Eliminar persona de la empresa"
                subtitle="Esta acción desvincula a la persona de la empresa y no se puede deshacer."
                size="md"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={closeDesvincular} disabled={desvinculando}>Cancelar</button>
                        <button
                            className="btn btn-danger"
                            onClick={handleDesvincular}
                            disabled={desvinculando || desvincularText.trim() !== fraseAutorizacion}
                        >
                            {desvinculando ? 'Eliminando…' : 'Aceptar'}
                        </button>
                    </div>
                }
            >
                <div className="desv-modal">
                    {desvincularError && (
                        <div className="desv-alert" role="alert">
                            <LuCircleAlert size={15} />
                            <span>{desvincularError}</span>
                        </div>
                    )}
                    <p className="desv-text">
                        Escribe <strong>“{fraseAutorizacion}”</strong> para confirmar.
                    </p>
                    <input
                        className="form-input"
                        placeholder={fraseAutorizacion}
                        value={desvincularText}
                        onChange={(e) => setDesvincularText(e.target.value)}
                        autoFocus
                    />
                </div>

                <style>{`
                    .desv-modal { display: flex; flex-direction: column; gap: var(--space-3); }
                    .desv-text { font-size: 0.88rem; color: var(--text-primary); line-height: 1.5; margin: 0; }
                    .desv-alert {
                        display: flex; align-items: center; gap: 8px;
                        padding: 10px 14px; border-radius: var(--radius-md);
                        background: rgba(239, 68, 68, 0.08);
                        border: 1px solid rgba(239, 68, 68, 0.25);
                        color: var(--danger-600, #b91c1c); font-size: 0.82rem;
                    }
                `}</style>
            </Modal>

            {/* Editar datos sensibles de la persona */}
            <Modal
                isOpen={showEditModal}
                onClose={() => !editSaving && setShowEditModal(false)}
                title="Editar datos de la persona"
                subtitle="Actualiza la información de contacto, cargo y datos personales."
                size="lg"
                footer={
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
                        <button className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={editSaving}>Cancelar</button>
                        <button className="btn" style={{ background: '#f13800', color: '#fff', border: 'none' }} onClick={handleSaveEdit} disabled={editSaving}>
                            {editSaving ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </div>
                }
            >
                <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div className="form-group">
                        <label className="form-label">Nombre</label>
                        <input className="form-input" value={editForm.nombre} onChange={(e) => setEditForm({ ...editForm, nombre: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Apellido paterno</label>
                        <input className="form-input" value={editForm.apellidoPaterno} onChange={(e) => setEditForm({ ...editForm, apellidoPaterno: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Apellido materno</label>
                        <input className="form-input" value={editForm.apellidoMaterno} onChange={(e) => setEditForm({ ...editForm, apellidoMaterno: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Cargo DS44</label>
                        <Select ariaLabel="Cargo" value={editForm.cargo}
                            onChange={(v) => setEditForm({ ...editForm, cargo: v })}
                            options={[{ value: '', label: 'Sin cargo específico' }, ...cargoOptions]} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Correo</label>
                        <input className="form-input" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Teléfono</label>
                        <input className="form-input" value={editForm.telefono} onChange={(e) => setEditForm({ ...editForm, telefono: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Fecha de nacimiento</label>
                        <input className="form-input" type="date" value={editForm.fechaNacimiento} onChange={(e) => setEditForm({ ...editForm, fechaNacimiento: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Nivel escolar</label>
                        <input className="form-input" value={editForm.nivelEscolar} onChange={(e) => setEditForm({ ...editForm, nivelEscolar: e.target.value })} />
                    </div>
                </div>

                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 'var(--space-4) 0 var(--space-2)' }}>
                    Contacto de emergencia
                </div>
                <div className="grid-collapse-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                    <div className="form-group">
                        <label className="form-label">Nombre</label>
                        <input className="form-input" value={editForm.contactoNombre} onChange={(e) => setEditForm({ ...editForm, contactoNombre: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Teléfono</label>
                        <input className="form-input" value={editForm.contactoTelefono} onChange={(e) => setEditForm({ ...editForm, contactoTelefono: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Relación</label>
                        <input className="form-input" value={editForm.contactoRelacion} onChange={(e) => setEditForm({ ...editForm, contactoRelacion: e.target.value })} />
                    </div>
                </div>
            </Modal>
        </>
    );
}
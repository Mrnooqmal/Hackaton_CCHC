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
    LuUpload,
    LuChevronRight,
    LuHardHat,
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
import PinDeFirma, { type PinRestablecido } from '../components/PinDeFirma';
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { eppApi, faltantesLabel, type EppElemento } from '../api/epp.api';
import { DS44_ONBOARDING_ITEMS, getCargoLabel } from '../utils/ds44';
import '../css/ficha.css';

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
    pinConfigurado?: boolean;
    pinRestablecido?: PinRestablecido | null;
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
    const canRestablecerPin = hasPermission(PERMISSIONS.PERSONA_RESTABLECER_PIN);
    // Editar datos sensibles de la persona (cargo, teléfono, etc.): mismo permiso
    // que gestionar/añadir personas.
    const canEditarDatos = hasPermission(PERMISSIONS.PERSONAS_CREAR);
    const { options: cargoOptions } = useCargoCatalog();

    const [worker, setWorker] = useState<WorkerWithRole | null>(null);
    const [fotoSaving, setFotoSaving] = useState(false);
    const [fotoSuccess, setFotoSuccess] = useState(false);
    // Edición en el lugar: los campos de la sección pasan a inputs y aparece una
    // barra fija con Cancelar / Guardar. Solo una sección se edita a la vez.
    const [editando, setEditando] = useState<'datos' | 'vigilancia' | null>(null);
    const [editBase, setEditBase] = useState<string>('');
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

    const [verTodoEpp, setVerTodoEpp] = useState(false);
    const [verTodasFirmas, setVerTodasFirmas] = useState(false);
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
                setEditando(null);
                await loadWorkerData();
            } else {
                setError(res.error || 'No se pudo guardar la vigilancia de salud');
            }
        } catch (err) {
            console.error('Error guardando vigilancia de salud:', err);
        } finally {
            setVigSaving(false);
        }
    };

    const formDesdeWorker = () => {
        const w = (worker || {}) as any;
        const ce = w.contactoEmergencia || {};
        return {
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
        };
    };

    const vigDesdeWorker = () => {
        const v = (worker as any)?.vigilanciaSalud || {};
        return {
            enVigilancia: Boolean(v.enVigilancia),
            protocolos: Array.isArray(v.protocolos) ? v.protocolos.join(', ') : (v.protocolos || ''),
            fechaUltimoExamen: v.fechaUltimoExamen ? String(v.fechaUltimoExamen).slice(0, 10) : '',
            aptitudLaboral: v.aptitudLaboral || '',
            restricciones: Array.isArray(v.restricciones) ? v.restricciones.join(', ') : (v.restricciones || ''),
        };
    };

    const empezarEdicion = (seccion: 'datos' | 'vigilancia') => {
        if (!worker || editando) return;
        if (seccion === 'datos') {
            const f = formDesdeWorker();
            setEditForm(f);
            setEditBase(JSON.stringify(f));
        } else {
            const v = vigDesdeWorker();
            setVigForm(v);
            setEditBase(JSON.stringify(v));
        }
        setEditando(seccion);
    };

    const cancelarEdicion = () => {
        if (editando === 'vigilancia') setVigForm(vigDesdeWorker());
        setEditando(null);
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
                setEditando(null);
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
                // `avanceKit` trae quién respondió cada encuesta del kit; el
                // listado ya no incluye `recipients`.
                (surveysRes.data.surveys || []).forEach((s) => {
                    if (s.kitItemKey && myId && s.avanceKit?.respondidos.includes(myId)) {
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

    const cambiarTab = (id: string) => {
        if (editando) return;
        setActiveTab(id as 'datos' | 'asignaciones');
    };

    if (loading && !worker) {
        return <PersonaSkeleton tab={activeTab} />;
    }

    if (error && !worker) {
        return (
            <div className="page-content">
                <div className="pd-error">
                    <LuCircleAlert size={40} aria-hidden="true" />
                    <h2>{error || 'Trabajador no encontrado'}</h2>
                    <button className="btn btn-primary" onClick={() => navigate('/personas')}>
                        Volver al listado
                    </button>
                </div>
            </div>
        );
    }
    if (!worker) return null;

    const w = worker as any;
    const ce = w.contactoEmergencia || {};
    const cursosLista: string[] = Array.isArray(w.cursos)
        ? w.cursos.map((c: any) => (typeof c === 'string' ? c : c?.nombre)).filter(Boolean)
        : [];
    const fechaCorta = (v?: string | null) => {
        if (!v) return null;
        const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v);
        return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    const cambios = (() => {
        if (!editando) return 0;
        const base = JSON.parse(editBase || '{}');
        const actual: Record<string, unknown> = editando === 'datos' ? editForm : vigForm;
        return Object.keys(actual).filter((k) => String(actual[k] ?? '') !== String(base[k] ?? '')).length;
    })();
    const guardando = editando === 'datos' ? editSaving : vigSaving;
    const guardarEdicion = () => (editando === 'datos' ? handleSaveEdit() : handleSaveVigilancia());
    const eppVisibles = verTodoEpp ? eppHistorial : eppHistorial.slice(0, 4);
    const firmasVisibles = verTodasFirmas ? signatures : signatures.slice(0, 6);

    const entrada = (i: number) => ({ animationDelay: `${i * 35}ms` });

    const seccion = (titulo: string, hint: React.ReactNode, accion?: React.ReactNode) => (
        <div className="pd-head">
            <h2 className="pd-titulo">{titulo}</h2>
            {hint && <span className="pd-hint">{hint}</span>}
            {accion && <span className="pd-head-accion">{accion}</span>}
        </div>
    );
    const botonEditar = (sec: 'datos' | 'vigilancia') => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => empezarEdicion(sec)} disabled={!!editando}>
            <LuPencil size={13} /> Editar
        </button>
    );

    return (
        <>
            <div className="page-content">
                {(() => {
                    const obraActualId = selectedObraId || worker.obraIds?.[0] || null;
                    const obraActual = obraActualId ? obrasInfo[obraActualId] : null;
                    return (
                        <IdentityPanel
                            eyebrow="Ficha de persona"
                            title={`${worker.nombre} ${worker.apellido || ''}`.trim()}
                            image={w.fotoPerfil}
                            fallback={`${worker.nombre[0] ?? ''}${worker.apellido?.[0] ?? ''}`.toUpperCase() || '?'}
                            status={{
                                label: worker.habilitado ? 'Habilitado' : 'Pendiente de enrolamiento',
                                tone: worker.habilitado ? 'ok' : 'pending',
                            }}
                            meta={[
                                { label: 'RUT', value: worker.rut, mono: true },
                                { label: 'Cargo', value: getCargoLabel(worker.cargo) || worker.cargo || 'Sin cargo' },
                                { label: 'Obra actual', value: obraActual?.nombre || obraActual?.codigo || 'Sin obra asignada' },
                            ]}
                            photo={canEditarDatos ? {
                                onSelect: handleFotoSelect,
                                onRemove: handleFotoRemove,
                                saving: fotoSaving,
                                success: fotoSuccess,
                            } : undefined}
                            tabs={[
                                { id: 'datos', label: 'Datos', icon: <LuUser size={15} /> },
                                { id: 'asignaciones', label: 'Asignaciones', icon: <LuBuild size={15} /> },
                            ]}
                            activeTab={activeTab}
                            onTabChange={cambiarTab}
                            tabsLabel="Secciones de la ficha"
                            actions={canExportar && (
                                <button className="btn btn-secondary btn-sm" onClick={downloadReport}>
                                    <LuDownload size={14} /> Exportar ficha
                                </button>
                            )}
                        />
                    );
                })()}

                {error && <div className="pd-alerta" role="alert"><LuCircleAlert size={15} aria-hidden="true" /><span>{error}</span></div>}

                {/* ── TAB: DATOS ── */}
                {activeTab === 'datos' && (
                    <div
                        className={`pd-tab${editando ? ' pd-tab--editando' : ''}`}
                        onKeyDown={(e) => { if (e.key === 'Escape' && editando && !guardando) cancelarEdicion(); }}
                    >
                        {stats && (
                            <div className="pd-stats pd-atenuable">
                                {[
                                    { l: 'Firmas totales', v: stats.totalFirmas, s: 'desde el ingreso' },
                                    { l: 'Últimos 30 días', v: stats.firmasUltimos30Dias, s: 'firmas' },
                                    { l: 'Documentos firmados', v: stats.documentosFirmados, s: 'documentos' },
                                    { l: 'Asistencias', v: stats.actividadesAsistidas, s: 'charlas y capacitaciones' },
                                ].map((x) => (
                                    <div key={x.l} className="pd-stat">
                                        <span className="pd-label">{x.l}</span>
                                        <span className="pd-stat-valor">{x.v}</span>
                                        <span className="pd-stat-sub">{x.s}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={`pd-fila${editando === 'vigilancia' ? ' pd-atenuada' : ''}`}>
                            <section className={`pd-seccion${editando === 'datos' ? ' pd-seccion--editando' : ''}`} aria-label="Datos personales">
                                {seccion('Datos personales',
                                    editando === 'datos' ? 'Editando · los cambios se aplican al guardar' : 'Contacto y datos de la persona',
                                    editando === 'datos'
                                        ? <span className="pd-modo"><span className="pd-modo-punto" aria-hidden="true" /> Modo edición</span>
                                        : canEditarDatos && botonEditar('datos'))}

                                {editando === 'datos' ? (
                                    <>
                                        <div className="pd-identidad">
                                            <span className="pd-identidad-titulo">Nombre y cargo · aparecen en la credencial</span>
                                            <div className="pd-rejilla pd-rejilla--4">
                                                {[
                                                    { k: 'nombre', l: 'Nombre' },
                                                    { k: 'apellidoPaterno', l: 'Apellido paterno' },
                                                    { k: 'apellidoMaterno', l: 'Apellido materno' },
                                                ].map((f, i) => (
                                                    <label key={f.k} className="pd-input" style={entrada(i)}>
                                                        <span className="pd-label">{f.l}</span>
                                                        <input className="form-input" autoFocus={i === 0}
                                                            value={(editForm as any)[f.k]}
                                                            onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })} />
                                                    </label>
                                                ))}
                                                <div className="pd-input" style={entrada(3)}>
                                                    <span className="pd-label">Cargo DS44</span>
                                                    <Select ariaLabel="Cargo" value={editForm.cargo}
                                                        onChange={(v) => setEditForm({ ...editForm, cargo: v })}
                                                        options={[{ value: '', label: 'Sin cargo específico' }, ...cargoOptions]} />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="pd-rejilla">
                                            {[
                                                { k: 'email', l: 'Correo', type: 'email' },
                                                { k: 'telefono', l: 'Teléfono', type: 'tel' },
                                                { k: 'fechaNacimiento', l: 'Fecha de nacimiento', type: 'date' },
                                                { k: 'nivelEscolar', l: 'Nivel escolar', type: 'text' },
                                            ].map((f, i) => (
                                                <label key={f.k} className="pd-input" style={entrada(i + 4)}>
                                                    <span className="pd-label">{f.l}</span>
                                                    <input className="form-input" type={f.type}
                                                        value={(editForm as any)[f.k]}
                                                        onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })} />
                                                </label>
                                            ))}
                                        </div>
                                        <div className="pd-rejilla pd-solo-lectura">
                                            <Campo label="Rol de sistema" value={`${rolLabel(worker.rol)} · se cambia en Roles`} />
                                            <Campo label="Cursos" value={cursosLista.length > 0 && <span className="pd-chips">{cursosLista.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}</span>} vacio="Sin cursos registrados" />
                                        </div>
                                    </>
                                ) : (
                                    <div className="pd-rejilla">
                                        <Campo label="Correo" value={worker.email} vacio="Sin correo" />
                                        <Campo label="Teléfono" value={w.telefono} vacio="Sin teléfono" />
                                        <Campo label="Fecha de nacimiento" value={fechaCorta(w.fechaNacimiento)} />
                                        <Campo label="Nivel escolar" value={w.nivelEscolar} />
                                        <Campo label="Rol de sistema" value={rolLabel(worker.rol)} />
                                        <Campo label="Cursos" value={cursosLista.length > 0 && <span className="pd-chips">{cursosLista.map((c, i) => <span key={i} className="pd-chip">{c}</span>)}</span>} vacio="Sin cursos registrados" />
                                    </div>
                                )}
                            </section>

                            <section className={`pd-seccion${editando === 'datos' ? ' pd-seccion--editando' : ''}`} aria-label="Contacto de emergencia">
                                {seccion('Contacto de emergencia', 'A quién avisar')}
                                {editando === 'datos' ? (
                                    <div className="pd-columna">
                                        {[
                                            { k: 'contactoNombre', l: 'Nombre' },
                                            { k: 'contactoTelefono', l: 'Teléfono' },
                                            { k: 'contactoRelacion', l: 'Relación' },
                                        ].map((f, i) => (
                                            <label key={f.k} className="pd-input" style={entrada(i + 8)}>
                                                <span className="pd-label">{f.l}</span>
                                                <input className="form-input" value={(editForm as any)[f.k]}
                                                    onChange={(e) => setEditForm({ ...editForm, [f.k]: e.target.value })} />
                                            </label>
                                        ))}
                                    </div>
                                ) : (ce.nombre || ce.telefono || ce.relacion) ? (
                                    <div className="pd-columna">
                                        <Campo label="Nombre" value={ce.nombre} />
                                        <Campo label="Teléfono" value={ce.telefono} />
                                        <Campo label="Relación" value={ce.relacion} />
                                    </div>
                                ) : (
                                    <p className="pd-vacio-linea">Sin contacto de emergencia registrado.</p>
                                )}
                            </section>
                        </div>

                        <div className={`pd-fila${editando === 'datos' ? ' pd-atenuada' : ''}`}>
                            <section className={`pd-seccion${editando === 'vigilancia' ? ' pd-seccion--editando' : ''}`} aria-label="Vigilancia de salud">
                                {seccion('Vigilancia de salud', 'Art. 67 / 73',
                                    editando === 'vigilancia'
                                        ? <span className="pd-modo"><span className="pd-modo-punto" aria-hidden="true" /> Modo edición</span>
                                        : canVigilancia && botonEditar('vigilancia'))}
                                {editando === 'vigilancia' ? (
                                    <>
                                        <label className="checkbox-row pd-check pd-input" style={entrada(0)}>
                                            <input type="checkbox" className="checkbox-input custom-checkbox" checked={vigForm.enVigilancia}
                                                onChange={(e) => setVigForm({ ...vigForm, enVigilancia: e.target.checked })} />
                                            <span>En programa de vigilancia de la salud</span>
                                        </label>
                                        <div className="pd-rejilla">
                                            <label className="pd-input" style={entrada(1)}>
                                                <span className="pd-label">Protocolos</span>
                                                <input className="form-input" placeholder="Ej: PLANESI, Ruido, Sílice" value={vigForm.protocolos}
                                                    onChange={(e) => setVigForm({ ...vigForm, protocolos: e.target.value })} />
                                                <span className="pd-ayuda">Separar con coma</span>
                                            </label>
                                            <label className="pd-input" style={entrada(2)}>
                                                <span className="pd-label">Último examen</span>
                                                <input className="form-input" type="date" value={vigForm.fechaUltimoExamen}
                                                    onChange={(e) => setVigForm({ ...vigForm, fechaUltimoExamen: e.target.value })} />
                                            </label>
                                            <label className="pd-input" style={entrada(3)}>
                                                <span className="pd-label">Aptitud laboral</span>
                                                <input className="form-input" placeholder="apto / apto con restricciones / no apto" value={vigForm.aptitudLaboral}
                                                    onChange={(e) => setVigForm({ ...vigForm, aptitudLaboral: e.target.value })} />
                                            </label>
                                            <label className="pd-input" style={entrada(4)}>
                                                <span className="pd-label">Restricciones</span>
                                                <input className="form-input" placeholder="Ej: No trabajo en altura" value={vigForm.restricciones}
                                                    onChange={(e) => setVigForm({ ...vigForm, restricciones: e.target.value })} />
                                                <span className="pd-ayuda">Separar con coma</span>
                                            </label>
                                        </div>
                                    </>
                                ) : (
                                    <div className="pd-rejilla">
                                        <Campo label="En vigilancia" value={<span className="pd-pildora">{vigForm.enVigilancia ? 'Sí' : 'No'}</span>} />
                                        <Campo label="Último examen" value={fechaCorta(vigForm.fechaUltimoExamen)} />
                                        <Campo label="Protocolos" value={vigForm.protocolos} />
                                        <Campo label="Aptitud laboral" value={vigForm.aptitudLaboral} />
                                        <Campo label="Restricciones" value={vigForm.restricciones} />
                                    </div>
                                )}
                            </section>

                            <PinDeFirma
                                tenantId={authTenantId}
                                persona={worker}
                                actorPersonaId={user?.personaId}
                                puedeRestablecer={canRestablecerPin}
                                puedeAsistir={canEditarDatos}
                                onCambio={loadWorkerData}
                            />
                        </div>

                        <section className="pd-seccion pd-atenuable" aria-label="Historial de EPP">
                            {seccion('Historial de EPP', 'Art. 13 · entregas y reposiciones',
                                canValidarEpp && (
                                    <button className="btn btn-primary btn-sm" type="button" onClick={() => { resetEppForm(); setEppModalOpen(true); }}>
                                        <LuPlus size={14} /> Nueva entrega
                                    </button>
                                ))}
                            {eppHistorial.length === 0 ? (
                                <p className="pd-vacio-linea">Sin entregas de EPP registradas.</p>
                            ) : (
                                <>
                                    <div className="pd-lista">
                                        {eppVisibles.map((e: any) => {
                                            const validado = e.validacion?.estado === 'validado';
                                            const items = (e.itemsEntregados || []).map((i: any) => `${i.descripcion} ×${i.cantidad}${i.talla ? ` (${i.talla})` : ''}`).join(', ') || '—';
                                            const meta = [
                                                e.esReposicion ? `Reposición${e.motivoReposicion ? ` por ${String(e.motivoReposicion).replace(/_/g, ' ')}` : ''}` : 'Entrega',
                                                e.validacion?.validadoPor?.nombre ? `validado por ${e.validacion.validadoPor.nombre}` : null,
                                                e.capacitacionUso?.completada ? `capacitación de uso ${e.capacitacionUso.duracionRealMinutos || 60} min` : 'capacitación de uso pendiente',
                                            ].filter(Boolean).join(' · ');
                                            return (
                                                <div key={e.documentId} className="pd-fila-lista">
                                                    <span className="pd-fecha">{fechaCorta(e.fecha) || '—'}</span>
                                                    <span className="pd-fila-texto">
                                                        <span className="pd-fila-titulo">{items}</span>
                                                        <span className="pd-fila-meta">{meta}</span>
                                                    </span>
                                                    {e.firmadoPorTrabajador ? (
                                                        <span className="pd-ok"><LuCircleCheck size={14} aria-hidden="true" /> Firmado</span>
                                                    ) : validado ? (
                                                        <span className="pd-pildora">Falta firma</span>
                                                    ) : (
                                                        <span className="pd-fila-acciones">
                                                            <span className="pd-pildora">Por validar</span>
                                                            {canValidarEpp && (
                                                                <button className="btn btn-secondary btn-sm" type="button"
                                                                    disabled={eppValidating === e.documentId}
                                                                    onClick={() => handleValidarEntrega(e.documentId)}>
                                                                    {eppValidating === e.documentId ? 'Validando…' : 'Validar'}
                                                                </button>
                                                            )}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {eppHistorial.length > 4 && (
                                        <button type="button" className="pd-ver-mas" onClick={() => setVerTodoEpp((v) => !v)}>
                                            {verTodoEpp ? 'Ver menos' : `Ver las ${eppHistorial.length} entregas`}
                                        </button>
                                    )}
                                </>
                            )}
                        </section>

                        <div className="pd-atenuable">
                            <WorkerEvidencias
                                personaId={worker.personaId}
                                tenantId={authTenantId}
                                initial={w.evidencias || []}
                                canEdit={canVigilancia}
                            />
                        </div>

                        {canDesvincular && worker.rol !== 'admin' && (
                            <div className="pd-peligro pd-atenuable">
                                <span className="pd-fila-texto">
                                    <span className="pd-fila-titulo">Eliminar persona de la empresa</span>
                                    <span className="pd-fila-meta">La desvincula de la empresa y de sus obras. No se puede deshacer; se pide confirmación escrita.</span>
                                </span>
                                <button type="button" className="btn pd-btn-alerta"
                                    onClick={() => { setDesvincularError(''); setDesvincularText(''); setDesvincularOpen(true); }}>
                                    <LuTriangleAlert size={14} /> Eliminar persona
                                </button>
                            </div>
                        )}

                        {editando && (
                            <div className="pd-barra" role="region" aria-label="Edición en curso">
                                <span className="pd-modo-punto" aria-hidden="true" />
                                <span className="pd-barra-texto">
                                    {editando === 'datos' ? `Editando datos de ${worker.nombre}` : 'Editando vigilancia de salud'}
                                </span>
                                <span className="pd-barra-cambios">
                                    · {cambios === 0 ? 'sin cambios' : `${cambios} ${cambios === 1 ? 'campo modificado' : 'campos modificados'}`}
                                </span>
                                <span className="pd-espacio" />
                                <button className="btn btn-secondary" onClick={cancelarEdicion} disabled={guardando}>Cancelar</button>
                                <button className="btn btn-primary" onClick={guardarEdicion} disabled={guardando || cambios === 0}>
                                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── TAB: ASIGNACIONES ── */}
                {activeTab === 'asignaciones' && (
                    <div className="pd-tab">
                        <div className="pd-fila pd-fila--asignaciones">
                            {ds44Checklist ? (() => {
                                const pct = ds44Checklist.total > 0 ? Math.round((ds44Checklist.completed / ds44Checklist.total) * 100) : 0;
                                return (
                                    <section className="pd-seccion" aria-label="Onboarding DS 44">
                                        {seccion('Onboarding DS 44', `${ds44Checklist.completed} de ${ds44Checklist.total} ítems completados`,
                                            <span className="pd-pct">{pct}%</span>)}
                                        <span className="pd-barra-progreso"><span style={{ width: `${pct}%` }} /></span>
                                        <div className="pd-lista">
                                            {ds44Checklist.items.map((item) => {
                                                const subir = (texto: string) => canOnboarding && (
                                                    <label className="btn btn-secondary btn-sm pd-subir">
                                                        {uploadingDocType === item.tipo ? <><LuClock size={13} /> Subiendo…</> : <><LuUpload size={13} /> {texto}</>}
                                                        <input type="file" accept=".pdf,.doc,.docx" hidden disabled={!!uploadingDocType}
                                                            onChange={(e) => { const f = e.target.files?.[0]; if (f && item.tipo) handleUploadWorkerDoc(item.tipo, f); e.target.value = ''; }} />
                                                    </label>
                                                );
                                                return (
                                                    <div key={item.key} className={`pd-fila-lista${item.status === 'ok' ? ' pd-fila-lista--hecha' : ''}`}>
                                                        {item.status === 'ok'
                                                            ? <LuCircleCheck size={16} className="pd-icono-ok" aria-label="Completado" />
                                                            : item.status === 'na'
                                                                ? <LuCircleMinus size={16} className="pd-icono-neutro" aria-label="No aplica" />
                                                                : <LuClock size={16} className="pd-icono-neutro" aria-label="Pendiente" />}
                                                        <span className="pd-fila-texto">
                                                            <span className="pd-fila-titulo">{item.label}</span>
                                                            {(item.articulo || item.firmaInfo) && (
                                                                <span className="pd-fila-meta">
                                                                    {item.articulo}{item.firmaInfo && ` · ${item.firmaInfo}`}
                                                                </span>
                                                            )}
                                                        </span>
                                                        {item.status === 'pending' && item.kind === 'document' && (
                                                            <span className="pd-fila-acciones"><span className="pd-pildora">Pendiente de subir</span>{subir('Subir')}</span>
                                                        )}
                                                        {item.status === 'subido' && (
                                                            <span className="pd-fila-acciones"><span className="pd-pildora">Pendiente de firma</span>{subir('Reemplazar')}</span>
                                                        )}
                                                        {item.status === 'pending' && item.kind !== 'document' && (
                                                            <span className="pd-pildora">Pendiente de firma</span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })() : <div />}

                            <div className="pd-columna pd-columna--gap">
                                <section className="pd-seccion" aria-label="Asignar contenido">
                                    {seccion('Asignar contenido', 'Ya dirigido a esta persona')}
                                    <div className="pd-asignar">
                                        {[
                                            { to: `/documents?workerRut=${encodeURIComponent(worker.rut)}`, l: 'Documento', i: <LuFileText size={15} /> },
                                            { to: `/activities?workerRut=${encodeURIComponent(worker.rut)}`, l: 'Actividad', i: <LuActivity size={15} /> },
                                            { to: `/surveys?workerRut=${encodeURIComponent(worker.rut)}`, l: 'Encuesta', i: <LuShieldCheck size={15} /> },
                                        ].map((a) => (
                                            <Link key={a.l} to={a.to} className="pd-asignar-item">
                                                {a.i}<span>{a.l}</span><LuChevronRight size={14} className="pd-chevron" />
                                            </Link>
                                        ))}
                                    </div>
                                </section>

                                {worker.obraIds && worker.obraIds.length > 0 && (
                                    <section className="pd-seccion" aria-label="Obras asignadas">
                                        {seccion('Obras asignadas', `${worker.obraIds.length} ${worker.obraIds.length === 1 ? 'obra' : 'obras'} · avance de onboarding`)}
                                        <div className="pd-lista">
                                            {(worker.obraIds as string[]).map((obraId) => {
                                                const info = obrasInfo[obraId];
                                                const entry = w.onboardingDS44?.[obraId];
                                                const items = entry?.items ? Object.values(entry.items as Record<string, any>) : [];
                                                const hechos = items.filter((it: any) => it.doneAt).length;
                                                const pct = items.length > 0 ? Math.round((hechos / items.length) * 100) : null;
                                                return (
                                                    <Link key={obraId} to={`/obras/${obraId}`} className="pd-fila-lista pd-fila-link">
                                                        <span className="pd-fila-texto">
                                                            <span className="pd-fila-titulo">{info?.nombre || info?.codigo || obraId}</span>
                                                            {info?.codigo && info?.nombre && <span className="pd-fila-meta pd-mono">{info.codigo}</span>}
                                                        </span>
                                                        {pct !== null && (
                                                            <span className="pd-mini">
                                                                <span className="pd-mini-barra"><span style={{ width: `${pct}%` }} /></span>
                                                                <span className="pd-fila-meta">{hechos}/{items.length}</span>
                                                            </span>
                                                        )}
                                                        <LuChevronRight size={14} className="pd-chevron" />
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    </section>
                                )}
                            </div>
                        </div>

                        <section className="pd-seccion" aria-label="Historial de cumplimiento">
                            {seccion('Historial de cumplimiento', `${signatures.length} ${signatures.length === 1 ? 'firma registrada' : 'firmas registradas'}`)}
                            {signatures.length === 0 ? (
                                <p className="pd-vacio-linea">Aún no hay firmas. Asigna un documento o una actividad para empezar el registro.</p>
                            ) : (
                                <>
                                    <div className="pd-lista">
                                        {firmasVisibles.map((sig, idx) => {
                                            const s = sig as any;
                                            const fecha = s.fechaFirma || s.fecha;
                                            return (
                                                <div key={s.firmaId || s.id || idx} className="pd-fila-lista">
                                                    <span className="pd-tipo" aria-hidden="true">{getSigIcon(sig)}</span>
                                                    <span className="pd-fila-texto"><span className="pd-fila-titulo">{s.requestTitulo || s.titulo || s.nombre || '—'}</span></span>
                                                    <span className="pd-fecha">{fecha ? fechaCorta(fecha) : '—'}</span>
                                                    {sig.estado === 'valida'
                                                        ? <span className="pd-ok"><LuCircleCheck size={14} aria-hidden="true" /> Válida</span>
                                                        : <span className="pd-pildora">{sig.estado}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {signatures.length > 6 && (
                                        <button type="button" className="pd-ver-mas" onClick={() => setVerTodasFirmas((v) => !v)}>
                                            {verTodasFirmas ? 'Ver menos' : `Ver las ${signatures.length} firmas`}
                                        </button>
                                    )}
                                </>
                            )}
                        </section>

                        {Array.isArray(worker.historialAsignaciones) && worker.historialAsignaciones.length > 0 && (
                            <section className="pd-seccion" aria-label="Obras anteriores">
                                {seccion('Obras anteriores', 'Asignaciones cerradas y su motivo de egreso')}
                                <div className="pd-lista">
                                    {worker.historialAsignaciones.slice().reverse().map((h, i) => {
                                        const oi = obrasInfo[h.obraId];
                                        return (
                                            <div key={i} className="pd-fila-lista">
                                                <span className="pd-fila-texto">
                                                    <span className="pd-fila-titulo">{oi?.nombre || oi?.codigo || h.obraId}</span>
                                                    <span className="pd-fila-meta">{(h.cargos || []).join(', ') || 'sin cargo'} · {fechaCorta(h.fechaIngreso) || '—'} → {fechaCorta(h.fechaEgreso) || '—'}</span>
                                                </span>
                                                <span className="pd-pildora">{h.motivo ? h.motivo.charAt(0).toUpperCase() + h.motivo.slice(1) : 'Egreso'}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        <section className="pd-seccion" aria-label="Currículum">
                            {seccion('Currículum', 'Lo que acredita, más allá de la obra en que esté')}
                            <div className="pd-cv">
                                <div>
                                    <span className="pd-subtitulo">Cursos y certificaciones</span>
                                    {Array.isArray(worker.cursos) && worker.cursos.length > 0
                                        ? <span className="pd-chips">{worker.cursos.map((c, i) => <span key={i} className="pd-chip">{c.nombre}</span>)}</span>
                                        : <p className="pd-vacio-linea">Sin cursos registrados.</p>}
                                </div>
                                <div>
                                    <span className="pd-subtitulo">Evidencias vigentes</span>
                                    {Array.isArray(worker.evidencias) && worker.evidencias.length > 0 ? (
                                        <div className="pd-cv-lista">
                                            {worker.evidencias.map((e, i) => {
                                                const vencida = e.venceEn ? new Date(e.venceEn).getTime() < Date.now() : false;
                                                return (
                                                    <span key={i} className="pd-cv-item">
                                                        {e.nombre || e.tipo}
                                                        {e.venceEn && <span className={`pd-fila-meta${vencida ? ' pd-texto-alerta' : ''}`}>{vencida ? 'vencida el' : 'vigente hasta'} {fechaCorta(e.venceEn)}</span>}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    ) : <p className="pd-vacio-linea">Sin evidencias registradas.</p>}
                                </div>
                                <div>
                                    <span className="pd-subtitulo">Capacitaciones y actividades</span>
                                    {capacitaciones.length > 0 ? (
                                        <div className="pd-cv-lista">
                                            {capacitaciones.map((c) => {
                                                const oi = c.obraId ? obrasInfo[c.obraId] : null;
                                                return (
                                                    <Link key={c.activityId} to={`/activities?activity=${c.activityId}`} className="pd-cv-item pd-cv-link">
                                                        {c.subtipoDescripcion || c.tipoDescripcion || c.titulo}
                                                        <span className="pd-fila-meta">{fechaCorta(c.fecha) || '—'}{oi && ` · ${oi.nombre || oi.codigo}`}</span>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    ) : <p className="pd-vacio-linea">Sin capacitaciones registradas.</p>}
                                </div>
                            </div>
                        </section>
                    </div>
                )}
            </div>


            {/* Modal: nueva entrega / reposición de EPP (solo instancia superior) */}
            {(() => {
                const cerrar = () => { setEppModalOpen(false); resetEppForm(); };
                const elegidos = eppItems.filter((i) => i.descripcion.trim()).length;
                const MOTIVOS = [
                    { v: 'desgaste', l: 'Desgaste' }, { v: 'perdida', l: 'Pérdida' }, { v: 'accidente', l: 'Accidente' },
                    { v: 'cambio_talla', l: 'Cambio de talla' }, { v: 'otro', l: 'Otro' },
                ];
                const motivoLabel = MOTIVOS.find((m) => m.v === eppForm.motivoReposicion)?.l.toLowerCase();
                const resumen = [
                    `${elegidos} ${elegidos === 1 ? 'elemento' : 'elementos'}`,
                    eppForm.esReposicion ? `reposición por ${motivoLabel}` : 'entrega',
                    eppForm.capacitacionCompletada ? `capacitación ${Number(eppForm.capacitacionMinutos) || 0} min` : 'sin capacitación de uso',
                ].join(' · ');
                return (
                    <Modal
                        isOpen={eppModalOpen}
                        onClose={cerrar}
                        title="Nueva entrega de EPP"
                        subtitle={`Art. 13 · queda pendiente de validación y de la firma de ${worker.nombre}`}
                        icon={<LuHardHat size={18} />}
                        size="lg"
                        footer={
                            <div className="epp-pie">
                                <span className="epp-resumen">{resumen}</span>
                                <button className="btn btn-secondary" onClick={cerrar}>Cancelar</button>
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

                            <section aria-label="Elementos entregados">
                                <div className="epp-head">
                                    <h3>Elementos entregados</h3>
                                    <span className="epp-count">{elegidos}</span>
                                    <span className="epp-hint">Del catálogo de la empresa</span>
                                </div>

                                {/* Sin catálogo no hay nada que elegir: se explica dónde crearlo */}
                                {eppCatalogo.length === 0 && (
                                    <p className="epp-catalogo-vacio">
                                        El catálogo de EPP de la empresa está vacío. Agrega los elementos en
                                        <strong> Mi Empresa › EPP</strong> para poder registrar entregas.
                                    </p>
                                )}

                                <div className="epp-items">
                                    {eppItems.map((item, index) => {
                                        // Aviso DS44: se puede entregar igual, pero la falta queda visible.
                                        const elemento = eppCatalogo.find((e) => e.eppId === item.eppId);
                                        const incompleto = elemento && !elemento.completo;
                                        return (
                                            <div className="epp-item" key={index}>
                                                <div className="epp-item-fila">
                                                    <div className="epp-campo">
                                                        <span className="form-label">Elemento</span>
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
                                                    </div>
                                                    <div className="epp-campo">
                                                        <span className="form-label">Cantidad</span>
                                                        <div className="epp-stepper">
                                                            <button type="button" className="epp-step-btn" aria-label="Disminuir cantidad"
                                                                onClick={() => updateEppItem(index, 'cantidad', Math.max(1, (Number(item.cantidad) || 1) - 1))}>
                                                                <LuMinus size={13} />
                                                            </button>
                                                            <input className="epp-step-input" type="number" min={1} value={item.cantidad}
                                                                aria-label="Cantidad"
                                                                onChange={(e) => updateEppItem(index, 'cantidad', Math.max(1, Number(e.target.value) || 1))} />
                                                            <button type="button" className="epp-step-btn" aria-label="Aumentar cantidad"
                                                                onClick={() => updateEppItem(index, 'cantidad', (Number(item.cantidad) || 1) + 1)}>
                                                                <LuPlus size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <label className="epp-campo">
                                                        <span className="form-label">Talla</span>
                                                        <input className="form-input" placeholder="Opcional" value={item.talla}
                                                            onChange={(e) => updateEppItem(index, 'talla', e.target.value)} />
                                                    </label>
                                                    <button type="button" className="epp-remove" onClick={() => removeEppItem(index)}
                                                        title="Quitar elemento" aria-label={`Quitar el elemento ${index + 1}`}>
                                                        <LuTrash2 size={15} />
                                                    </button>
                                                </div>
                                                {incompleto && (
                                                    <p className="epp-item-warn">
                                                        <LuTriangleAlert size={13} aria-hidden="true" />
                                                        {faltantesLabel(elemento.faltantes)} exigido por el DS44. Se puede entregar; queda registrado.
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <button type="button" className="epp-add-btn" onClick={addEppItem}>
                                    <LuPlus size={14} /> Agregar elemento
                                </button>
                            </section>

                            <section aria-label="Condiciones de la entrega">
                                <div className="epp-head"><h3>Condiciones de la entrega</h3></div>
                                <div className="epp-condiciones">
                                    <div className="epp-condicion">
                                        <label className="checkbox-row epp-toggle">
                                            <input type="checkbox" className="checkbox-input custom-checkbox" checked={eppForm.esReposicion}
                                                onChange={(e) => setEppForm({ ...eppForm, esReposicion: e.target.checked })} />
                                            <span className="epp-toggle-text">
                                                <span className="epp-toggle-title">Es una reposición</span>
                                                <span className="epp-toggle-desc">Reemplazo de un EPP ya entregado</span>
                                            </span>
                                        </label>
                                        {eppForm.esReposicion && (
                                            <div className="epp-sub">
                                                <span className="form-label">Motivo</span>
                                                <div className="epp-chips" role="group" aria-label="Motivo de reposición">
                                                    {MOTIVOS.map((m) => (
                                                        <button key={m.v} type="button" className="epp-chip"
                                                            aria-pressed={eppForm.motivoReposicion === m.v}
                                                            onClick={() => setEppForm({ ...eppForm, motivoReposicion: m.v })}>
                                                            {m.l}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="epp-condicion">
                                        <label className="checkbox-row epp-toggle">
                                            <input type="checkbox" className="checkbox-input custom-checkbox" checked={eppForm.capacitacionCompletada}
                                                onChange={(e) => setEppForm({ ...eppForm, capacitacionCompletada: e.target.checked })} />
                                            <span className="epp-toggle-text">
                                                <span className="epp-toggle-title">Capacitación de uso realizada</span>
                                                <span className="epp-toggle-desc">Art. 13 · instrucción sobre el uso correcto</span>
                                            </span>
                                        </label>
                                        {eppForm.capacitacionCompletada && (
                                            <label className="epp-sub">
                                                <span className="form-label">Duración</span>
                                                <span className="epp-minutos">
                                                    <input type="number" className="form-input" min={0} value={eppForm.capacitacionMinutos}
                                                        onChange={(e) => setEppForm({ ...eppForm, capacitacionMinutos: e.target.value })} />
                                                    <span>minutos · recomendado 60 o más</span>
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </div>

                        <style>{`
                            .epp-modal { display: flex; flex-direction: column; gap: 24px; }
                            .epp-modal .epp-alert {
                                display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: var(--radius-md);
                                background: color-mix(in srgb, var(--danger-alerta) 8%, transparent);
                                border: 1px solid color-mix(in srgb, var(--danger-alerta) 30%, transparent);
                                color: var(--danger-alerta); font-size: 13px;
                            }
                            .epp-head {
                                display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                                padding-bottom: 9px; margin-bottom: 12px; border-bottom: 1px solid var(--surface-border);
                            }
                            .epp-head h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
                            .epp-count {
                                padding: 1px 8px; border: 1px solid var(--surface-border); border-radius: 999px;
                                font-size: 11.5px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums;
                            }
                            .epp-hint { font-size: 11.5px; color: var(--text-secondary); }
                            .epp-catalogo-vacio {
                                margin: 0 0 12px; padding: 10px 12px; border: 1px dashed var(--gray-500); border-radius: var(--radius-md);
                                font-size: 12.5px; line-height: 1.5; color: var(--text-secondary);
                            }
                            .epp-items { display: flex; flex-direction: column; border: 1px solid var(--surface-border); border-radius: 12px; }
                            .epp-item { border-bottom: 1px solid var(--surface-border); }
                            .epp-item:last-child { border-bottom: none; }
                            .epp-item-fila {
                                display: grid; grid-template-columns: minmax(0, 1fr) 132px 120px 32px; gap: 12px;
                                align-items: end; padding: 12px 16px;
                            }
                            .epp-campo { display: flex; flex-direction: column; min-width: 0; }
                            .epp-campo .form-label { margin-bottom: 6px; }
                            .epp-item-warn {
                                display: flex; align-items: center; gap: 6px; margin: -2px 0 0; padding: 0 16px 12px;
                                font-size: 12px; line-height: 1.45; color: var(--danger-alerta);
                            }
                            .epp-item-warn svg { flex-shrink: 0; }
                            .epp-stepper {
                                display: flex; align-items: center; height: 38px; overflow: hidden;
                                border: 1px solid var(--surface-border); border-radius: 8px;
                            }
                            .epp-step-btn {
                                display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                                width: 36px; height: 100%; border: none; background: none; color: var(--text-primary); cursor: pointer;
                                transition: background var(--transition-fast);
                            }
                            .epp-step-btn:first-child { border-right: 1px solid var(--surface-border); }
                            .epp-step-btn:last-child { border-left: 1px solid var(--surface-border); }
                            .epp-step-btn:hover { background: var(--surface-hover); }
                            .epp-step-input {
                                flex: 1; min-width: 0; border: none; outline: none; background: transparent; text-align: center;
                                color: var(--text-primary); font-family: inherit; font-size: 14px; font-weight: 600; -moz-appearance: textfield;
                            }
                            .epp-step-input::-webkit-outer-spin-button, .epp-step-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
                            .epp-remove {
                                display: flex; align-items: center; justify-content: center; width: 32px; height: 38px;
                                border: none; border-radius: 6px; background: none; color: var(--text-muted); cursor: pointer;
                                transition: background var(--transition-fast), color var(--transition-fast);
                            }
                            .epp-remove:hover { background: var(--surface-hover); color: var(--danger-alerta); }
                            .epp-add-btn {
                                display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 9px 16px;
                                border: 1px dashed var(--gray-500); border-radius: var(--radius-md); background: none;
                                color: var(--text-primary); font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                                transition: border-color var(--transition-fast), color var(--transition-fast);
                            }
                            .epp-add-btn:hover { border-color: var(--accent); color: var(--accent-text); }
                            .epp-condiciones { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
                            .epp-condicion { display: flex; flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--surface-border); border-radius: 12px; }
                            .epp-toggle { align-items: flex-start; gap: 10px; cursor: pointer; }
                            .epp-toggle .custom-checkbox { margin-top: 1px; }
                            .epp-toggle-text { display: flex; flex-direction: column; gap: 2px; }
                            .epp-toggle-title { font-size: 13.5px; font-weight: 500; color: var(--text-primary); }
                            .epp-toggle-desc { font-size: 12px; color: var(--text-secondary); }
                            .epp-sub { display: flex; flex-direction: column; gap: 8px; padding-left: 28px; animation: pd-entra 220ms ease-out both; }
                            .epp-sub .form-label { margin-bottom: 0; }
                            .epp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
                            .epp-chip {
                                padding: 5px 12px; border: 1px solid var(--surface-border); border-radius: 999px; background: none;
                                font-family: inherit; font-size: 12.5px; color: var(--text-secondary); cursor: pointer;
                                transition: border-color var(--transition-fast), color var(--transition-fast);
                            }
                            .epp-chip:hover { color: var(--text-primary); }
                            .epp-chip[aria-pressed='true'] {
                                border-color: transparent; background: var(--surface-hover); box-shadow: 0 0 0 1.5px var(--gray-500) inset;
                                color: var(--text-primary); font-weight: 600;
                            }
                            .epp-minutos { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-secondary); }
                            .epp-minutos .form-input { width: 90px; }
                            .epp-pie { display: flex; align-items: center; gap: var(--space-2); width: 100%; }
                            .epp-resumen { flex: 1; min-width: 0; font-size: 12.5px; color: var(--text-secondary); }
                            @media (max-width: 720px) {
                                .epp-condiciones { grid-template-columns: minmax(0, 1fr); }
                                .epp-item-fila { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px; }
                                .epp-item-fila > .epp-campo:first-child { grid-column: 1 / -1; }
                                .epp-resumen { display: none; }
                            }
                        `}</style>
                    </Modal>
                );
            })()}

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

        </>
    );
}

// Un campo de solo lectura de la ficha: rótulo y valor, o un guion si está vacío.
function Campo({ label, value, vacio = '—' }: { label: string; value: React.ReactNode; vacio?: string }) {
    return (
        <div className="pd-campo">
            <span className="pd-label">{label}</span>
            <span className="pd-valor">{value || <span className="pd-vacio">{vacio}</span>}</span>
        </div>
    );
}

// ── Esqueleto ────────────────────────────────────────────────────────────────
// Repite la credencial (retrato, nombre, estado, tira, pestañas) y la pestaña
// abierta con las mismas clases que el contenido cargado.
const Sk = ({ w, h = 12, r, style }: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) => (
    <div className="ui-skel" style={{ width: w, height: h, borderRadius: r, flexShrink: 0, ...style }} />
);
const Txt = ({ w, h, lh, style }: { w: number | string; h: number; lh: number; style?: React.CSSProperties }) => (
    <div style={{ display: 'flex', alignItems: 'center', height: lh, width: typeof w === 'number' ? w : undefined, ...style }}>
        <Sk w={w} h={h} />
    </div>
);
const HeadSkel = ({ t, h, boton }: { t: number; h: number; boton?: boolean }) => (
    <div className="pd-head">
        <Txt w={t} h={14} lh={22} />
        <Txt w={h} h={10} lh={18} />
        {boton && <span className="pd-head-accion"><Sk w={82} h={32} r={8} /></span>}
    </div>
);
const CampoSkel = ({ w }: { w: number | string }) => (
    <div className="pd-campo">
        <Txt w={80} h={9} lh={16.8} />
        <Txt w={w} h={12} lh={22.4} />
    </div>
);
const FilaSkel = ({ i }: { i: number }) => (
    <div className="pd-fila-lista">
        <Sk w={16} h={16} r={4} />
        <span className="pd-fila-texto">
            <Txt w={['58%', '44%', '66%', '50%'][i % 4]} h={12} lh={21} />
            <Txt w={['30%', '22%', '36%', '26%'][i % 4]} h={9} lh={18} />
        </span>
        <Sk w={112} h={24} r={999} />
    </div>
);

function PersonaSkeleton({ tab }: { tab: 'datos' | 'asignaciones' }) {
    return (
        <div className="page-content" aria-busy="true" aria-live="polite" aria-label="Cargando la ficha de la persona">
            <header className="idp idp--con-tabs">
                <div className="idp-main">
                    <div className="idp-portrait"><div className="idp-portrait-inner"><Sk w="100%" h="100%" r={0} style={{ position: 'absolute', inset: 0, height: '100%' }} /></div></div>
                    <div className="idp-body" style={{ display: 'flex', flexDirection: 'column' }}>
                        <Txt w={110} h={9} lh={17.4} style={{ marginBottom: 8 }} />
                        <Txt w={320} h={26} lh={35} />
                        <Txt w={120} h={11} lh={22} style={{ marginTop: 12 }} />
                        <div className="idp-strip" style={{ gap: 40 }}>
                            {[70, 110, 140].map((x, i) => <div key={i}><Txt w={40} h={8} lh={17.4} /><Txt w={x} h={11} lh={22.4} style={{ marginTop: 3 }} /></div>)}
                        </div>
                    </div>
                </div>
                <div className="idp-bar" style={{ height: 48 }}>
                    <div style={{ display: 'flex', gap: 32, paddingLeft: 16 }}><Sk w={60} h={12} /><Sk w={100} h={12} /></div>
                    <Sk w={130} h={32} r={8} />
                </div>
            </header>
            {tab === 'datos' ? (
                <div className="pd-tab">
                    <div className="pd-stats">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="pd-stat">
                                <Txt w={100} h={9} lh={16.8} />
                                <Txt w={40} h={22} lh={31.2} />
                                <Txt w={90} h={9} lh={19.2} />
                            </div>
                        ))}
                    </div>
                    <div className="pd-fila">
                        <section className="pd-seccion">
                            <HeadSkel t={140} h={200} boton />
                            <div className="pd-rejilla">{['70%', '45%', '38%', '52%', '30%', '48%'].map((x, i) => <CampoSkel key={i} w={x} />)}</div>
                        </section>
                        <section className="pd-seccion">
                            <HeadSkel t={170} h={90} />
                            <div className="pd-columna">{['60%', '70%', '40%'].map((x, i) => <CampoSkel key={i} w={x} />)}</div>
                        </section>
                    </div>
                    <div className="pd-fila">
                        <section className="pd-seccion">
                            <HeadSkel t={150} h={80} boton />
                            <div className="pd-rejilla">{['20%', '40%', '50%', '30%', '44%'].map((x, i) => <CampoSkel key={i} w={x} />)}</div>
                        </section>
                        <section className="pd-seccion">
                            <HeadSkel t={100} h={120} />
                            <Sk w="100%" h={130} r={12} />
                        </section>
                    </div>
                    <section className="pd-seccion">
                        <HeadSkel t={140} h={220} boton />
                        <div className="pd-lista">{[0, 1, 2].map((i) => <FilaSkel key={i} i={i} />)}</div>
                    </section>
                </div>
            ) : (
                <div className="pd-tab">
                    <div className="pd-fila pd-fila--asignaciones">
                        <section className="pd-seccion">
                            <HeadSkel t={150} h={170} />
                            <span className="pd-barra-progreso" />
                            <div className="pd-lista">{Array.from({ length: 7 }, (_, i) => <FilaSkel key={i} i={i} />)}</div>
                        </section>
                        <div className="pd-columna pd-columna--gap">
                            <section className="pd-seccion">
                                <HeadSkel t={140} h={150} />
                                <div className="pd-asignar">{[0, 1, 2].map((i) => <Sk key={i} w="100%" h={44} r={10} />)}</div>
                            </section>
                            <section className="pd-seccion">
                                <HeadSkel t={130} h={160} />
                                <div className="pd-lista">{[0, 1].map((i) => <FilaSkel key={i} i={i} />)}</div>
                            </section>
                        </div>
                    </div>
                    <section className="pd-seccion">
                        <HeadSkel t={200} h={130} />
                        <div className="pd-lista">{[0, 1, 2, 3].map((i) => <FilaSkel key={i} i={i} />)}</div>
                    </section>
                </div>
            )}
        </div>
    );
}

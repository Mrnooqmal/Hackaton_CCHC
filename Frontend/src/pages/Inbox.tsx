import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FiMail, FiSend, FiInbox, FiArchive, FiSearch,
    FiCheck, FiCheckCircle, FiAlertCircle, FiBell, FiClock,
    FiTrash2, FiChevronLeft, FiPlus, FiUsers, FiFlag,
    FiChevronDown, FiX
} from 'react-icons/fi';
import { inboxApi, personasApi, tenantsApi, type InboxMessage, type InboxRecipient, type SendMessageData, type MessageType, type MessagePriority } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useObraContext } from '../context/ObraContext';
import { Modal, Select, SegmentedControl, PageHeader } from '../components/ui';

type TabType = 'inbox' | 'sent' | 'archived';
type FilterType = 'all' | 'unread' | 'archived';
type DateRangeFilter = 'all' | 'today' | 'week' | 'month';
type ClassificationFilter = 'all' | 'priority' | 'normal';

// Etiqueta legible del rol para los filtros de destinatario.
const ROL_LABELS: Record<string, string> = {
    admin: 'Administrador',
    prevencionista: 'Prevencionista',
    supervisor: 'Supervisor',
    jefe_obra: 'Jefe de obra',
    trabajador: 'Trabajador',
    relator: 'Relator',
};
const rolLabel = (rol: string) => ROL_LABELS[rol] || rol || 'Sin rol';

// Etiqueta del tipo de mensaje. Solo se muestra cuando el mensaje no es una
// comunicación corriente: el resto sería ruido repetido en cada fila.
const TIPO_LABELS: Record<string, string> = {
    alert: 'Alerta',
    notification: 'Notificación',
    task: 'Tarea',
    message: 'Mensaje',
};
const tipoLabel = (tipo: string) => TIPO_LABELS[tipo] || 'Mensaje';

const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const inicioDelDia = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

/**
 * Tramo temporal al que pertenece un mensaje. Reproduce los cortes que usa
 * cualquiera al buscar en su correo: primero el día, después la semana en
 * curso, después el mes, y de ahí hacia atrás por nombre de mes.
 *
 * "Esta semana" son los últimos 7 días y no la semana calendario: así el
 * tramo nunca queda vacío un lunes ni empuja el domingo anterior a un grupo
 * que se lee como mucho más antiguo de lo que es.
 */
function tramoTemporal(iso: string, ahora: Date): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Sin fecha';

    const hoy = inicioDelDia(ahora);
    const dia = inicioDelDia(d);
    const diasAtras = Math.round((hoy.getTime() - dia.getTime()) / 86400000);

    if (diasAtras <= 0) return 'Hoy';
    if (diasAtras === 1) return 'Ayer';
    if (diasAtras < 7) return 'Esta semana';

    const mismoAnio = d.getFullYear() === ahora.getFullYear();
    if (mismoAnio && d.getMonth() === ahora.getMonth()) return 'Este mes';

    const mesPasado = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    if (d.getFullYear() === mesPasado.getFullYear() && d.getMonth() === mesPasado.getMonth()) {
        return 'El mes pasado';
    }

    return mismoAnio ? MESES[d.getMonth()] : `${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

// Grupo de filtro del carril. Con tres o cuatro opciones, un desplegable
// esconde el estado detrás de un clic; en chips el valor vigente se lee sin
// abrir nada y cambiarlo cuesta un toque.
//
// Hay dos niveles de marcado a propósito: `is-current` dice cuál es el valor
// elegido y `is-narrowing` sólo se enciende cuando ese valor además recorta la
// lista. Así se distingue "esto es lo que está puesto" de "esto te está
// escondiendo mensajes", que es lo que uno necesita saber de un vistazo.
function FiltroChips({
    label, value, valorNeutro, options, onChange,
}: {
    label: string;
    value: string;
    valorNeutro: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
}) {
    return (
        <div className="inbox-filtro">
            <span className="inbox-filtro-label">{label}</span>
            <div className="inbox-filtro-chips" role="group" aria-label={label}>
                {options.map((o) => {
                    const vigente = value === o.value;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            className={`inbox-chip${vigente ? ' is-current' : ''}${vigente && o.value !== valorNeutro ? ' is-narrowing' : ''}`}
                            aria-pressed={vigente}
                            onClick={() => onChange(o.value)}
                        >
                            {o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// Dropdown multi-select con checkboxes, estilo igual al Select de la interfaz.
function MultiSelectDropdown({
    label, options, selected, onToggle, onClear, disabledSet = new Set<string>(), getLabel
}: {
    label: string;
    options: string[];
    selected: string[];
    onToggle: (val: string) => void;
    onClear: () => void;
    disabledSet?: Set<string>;
    getLabel?: (val: string) => string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const activeCount = selected.length;
    const displayLabel = activeCount > 0 ? `${label} (${activeCount})` : label;

    return (
        <div className="msd-wrap" ref={ref}>
            <button
                type="button"
                className={`msd-trigger ${activeCount > 0 ? 'active' : ''}`}
                onClick={() => setOpen(o => !o)}
            >
                <span>{displayLabel}</span>
                {activeCount > 0
                    ? <FiX size={13} onClick={(e) => { e.stopPropagation(); onClear(); }} />
                    : <FiChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                }
            </button>
            {open && (
                <div className="msd-panel">
                    {options.length === 0 ? (
                        <div className="msd-empty">Sin opciones</div>
                    ) : options.map(opt => {
                        const disabled = disabledSet.has(opt);
                        const checked = selected.includes(opt);
                        return (
                            <label key={opt} className={`msd-option ${disabled ? 'msd-disabled' : ''}`}>
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={() => !disabled && onToggle(opt)}
                                />
                                <span className="msd-option-label">{getLabel ? getLabel(opt) : opt}</span>
                                {disabled && <span className="msd-no-members">sin personas</span>}
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function Inbox() {
    const { user } = useAuth();
    const { toast } = useToast();
    // Id canonico de la persona. El backend (inbox) indexa por personaId;
    // userId es alias legacy y, cuando existe, es identico a personaId.
    const currentUserId = user?.personaId || user?.userId;
    const currentTenantId = user?.tenantId || user?.empresaId;
    const navigate = useNavigate();
    const { obras, selectedObraId } = useObraContext();
    const [activeTab, setActiveTab] = useState<TabType>('inbox');
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(null);
    const [filter, setFilter] = useState<FilterType>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [unreadCount, setUnreadCount] = useState(0);
    const [errorCarga, setErrorCarga] = useState<string | null>(null);
    // Descarta respuestas que llegan tarde tras cambiar de carpeta.
    const cargaVigente = useRef(0);
    // En móvil los filtros van plegados: en un teléfono, tres grupos de
    // opciones antes del primer mensaje son más estorbo que ayuda.
    const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

    // Filtros de la lista de mensajes
    const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
    const [classification, setClassification] = useState<ClassificationFilter>('all');

    // Obras a las que pertenece el usuario actual (acotan obra y destinatarios)
    const [myObraIds, setMyObraIds] = useState<string[] | null>(null);

    // Compose modal
    const [showCompose, setShowCompose] = useState(false);
    const [recipients, setRecipients] = useState<InboxRecipient[]>([]);
    const [loadingRecipients, setLoadingRecipients] = useState(false);
    const [composing, setComposing] = useState(false);
    const [composeObraId, setComposeObraId] = useState('');
    // Catálogo del tenant (para los filtros de rol y cargo)
    const [tenantRoleCatalog, setTenantRoleCatalog] = useState<{ id: string; nombre: string }[]>([]);
    const [tenantCargoCatalog, setTenantCargoCatalog] = useState<string[]>([]);
    // Filtros del selector de destinatarios
    const [recipientSearch, setRecipientSearch] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [rolFilters, setRolFilters] = useState<string[]>([]);
    const [cargoFilters, setCargoFilters] = useState<string[]>([]);
    const [composeData, setComposeData] = useState({
        recipientIds: [] as string[],
        subject: '',
        content: '',
        type: 'message' as MessageType,
        priority: 'normal' as MessagePriority
    });

    // Obras donde el usuario puede enviar mensajes. Admin (y prevencionista sin
    // asignación explícita) ven todas; el resto solo las suyas.
    const userObras = useMemo(() => {
        if (user?.rol === 'admin') return obras;
        if (myObraIds === null) return [];
        const propias = obras.filter(o => myObraIds.includes(o.obraId));
        if (propias.length === 0 && user?.rol === 'prevencionista') return obras;
        return propias;
    }, [obras, myObraIds, user?.rol]);

    useEffect(() => {
        if (currentUserId) {
            loadMessages();
            loadUnreadCount();
        }
    }, [currentUserId, activeTab, filter]);

    // Cargar las obras del usuario actual (para acotar el selector del modal)
    useEffect(() => {
        let active = true;
        if (!currentUserId) return;
        if (user?.rol === 'admin') {
            setMyObraIds([]); // admin usa todas las obras del tenant
            return;
        }
        (async () => {
            try {
                const res = await personasApi.get(currentUserId);
                if (active && res.success && res.data) {
                    setMyObraIds(res.data.obraIds || []);
                } else if (active) {
                    setMyObraIds([]);
                }
            } catch (error) {
                console.error('Error loading user obras:', error);
                if (active) setMyObraIds([]);
            }
        })();
        return () => { active = false; };
    }, [currentUserId, user?.rol]);

    // Carga roles y cargos del tenant una sola vez al abrir el modal
    useEffect(() => {
        if (!showCompose || !currentTenantId) return;
        if (tenantRoleCatalog.length === 0) {
            tenantsApi.get(currentTenantId)
                .then(res => {
                    if (res.success && res.data?.roles?.length) {
                        setTenantRoleCatalog(res.data.roles);
                    }
                })
                .catch(() => {});
        }
        if (tenantCargoCatalog.length === 0) {
            tenantsApi.getCargos(currentTenantId)
                .then(res => {
                    if (res.success && res.data?.cargos) {
                        setTenantCargoCatalog(res.data.cargos.map(c => c.label));
                    }
                })
                .catch(() => {});
        }
    }, [showCompose, currentTenantId]);

    const loadMessages = async () => {
        if (!currentUserId) return;
        // Cada carga lleva su número. Al cambiar de carpeta rápido, la respuesta
        // de la anterior puede llegar después: si ya no es la vigente, se
        // descarta en vez de pintar los mensajes de la carpeta equivocada.
        const cargaId = ++cargaVigente.current;
        setLoading(true);
        setErrorCarga(null);
        try {
            let response;
            if (activeTab === 'inbox') {
                response = await inboxApi.getInbox(currentUserId, filter);
            } else if (activeTab === 'sent') {
                response = await inboxApi.getSent(currentUserId);
            } else {
                response = await inboxApi.getInbox(currentUserId, 'archived');
            }
            if (cargaId !== cargaVigente.current) return;

            if (response.success && response.data) {
                // Orden tipo correo: mas recientes primero por fecha/hora de llegada.
                const ordenados = [...response.data.messages].sort((a, b) =>
                    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
                );
                setMessages(ordenados);
            } else {
                // Sin esto la lista se quedaba con los mensajes de la carpeta
                // anterior y parecía que la carpeta nueva no filtraba nada.
                setMessages([]);
                setErrorCarga(response.error || 'No se pudieron cargar los mensajes.');
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            if (cargaId !== cargaVigente.current) return;
            setMessages([]);
            setErrorCarga('No se pudieron cargar los mensajes. Revisa tu conexión.');
        } finally {
            if (cargaId === cargaVigente.current) setLoading(false);
        }
    };

    const loadUnreadCount = async () => {
        if (!currentUserId) return;
        try {
            const response = await inboxApi.getUnreadCount(currentUserId);
            if (response.success && response.data) {
                setUnreadCount(response.data.unreadCount);
            }
        } catch (error) {
            console.error('Error loading unread count:', error);
        }
    };

    const loadRecipients = async (obraId: string) => {
        if (!currentUserId || !obraId) {
            setRecipients([]);
            return;
        }
        setLoadingRecipients(true);
        try {
            const response = await inboxApi.getRecipients(currentUserId, currentTenantId, obraId);
            if (response.success && response.data) {
                setRecipients(response.data.recipients);
            }
        } catch (error) {
            console.error('Error loading recipients:', error);
        } finally {
            setLoadingRecipients(false);
        }
    };

    // Al cambiar la obra del modal: recargar destinatarios y limpiar selección/filtros
    const handleSelectComposeObra = (obraId: string) => {
        setComposeObraId(obraId);
        setComposeData(prev => ({ ...prev, recipientIds: [] }));
        setRecipientSearch('');
        setRolFilters([]);
        setCargoFilters([]);
        setRecipients([]);
        if (obraId) loadRecipients(obraId);
    };

    const handleOpenMessage = async (message: InboxMessage) => {
        setSelectedMessage(message);
        if (!message.read && currentUserId) {
            await inboxApi.markAsRead(message.messageId, currentUserId);
            setMessages(prev => prev.map(m =>
                m.messageId === message.messageId ? { ...m, read: true } : m
            ));
            setUnreadCount(prev => Math.max(0, prev - 1));
        }
    };

    const handleArchive = async (messageId: string) => {
        if (!currentUserId) return;
        try {
            await inboxApi.archive(messageId, currentUserId);
            setMessages(prev => prev.filter(m => m.messageId !== messageId));
            setSelectedMessage(null);
        } catch (error) {
            console.error('Error archiving:', error);
        }
    };

    const handleDelete = async (messageId: string) => {
        if (!currentUserId) return;
        if (!confirm('¿Eliminar este mensaje?')) return;
        try {
            await inboxApi.delete(messageId, currentUserId);
            setMessages(prev => prev.filter(m => m.messageId !== messageId));
            setSelectedMessage(null);
        } catch (error) {
            console.error('Error deleting:', error);
        }
    };

    // Marcar / desmarcar un mensaje concreto. Se actualiza primero la vista y
    // se revierte si el servidor falla: el punto tiene que responder al toque.
    const handleToggleRead = async (message: InboxMessage, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentUserId) return;
        const leido = !message.read;
        setMessages(prev => prev.map(m =>
            m.messageId === message.messageId ? { ...m, read: leido } : m
        ));
        setUnreadCount(prev => Math.max(0, prev + (leido ? -1 : 1)));
        try {
            const res = await inboxApi.markAsRead(message.messageId, currentUserId, leido);
            if (!res.success) throw new Error(res.error || 'Error');
        } catch {
            setMessages(prev => prev.map(m =>
                m.messageId === message.messageId ? { ...m, read: !leido } : m
            ));
            setUnreadCount(prev => Math.max(0, prev + (leido ? 1 : -1)));
            toast.error('No se pudo cambiar el estado del mensaje');
        }
    };

    const handleMarkAllAsRead = async () => {
        if (!currentUserId) return;
        try {
            await inboxApi.markAllAsRead(currentUserId);
            setMessages(prev => prev.map(m => ({ ...m, read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    };

    const handleCompose = () => {
        setShowCompose(true);
        setRecipients([]);
        setRecipientSearch('');
        setRolFilters([]);
        setCargoFilters([]);
        setComposeData({
            recipientIds: [],
            subject: '',
            content: '',
            type: 'message',
            priority: 'normal'
        });
        // Preseleccionar obra: la seleccionada globalmente si el usuario pertenece,
        // o la única obra disponible.
        const candidatas = user?.rol === 'admin' ? obras : userObras;
        const preselect = selectedObraId && candidatas.some(o => o.obraId === selectedObraId)
            ? selectedObraId
            : (candidatas.length === 1 ? candidatas[0].obraId : '');
        setComposeObraId(preselect);
        if (preselect) loadRecipients(preselect);
    };

    const handleSend = async () => {
        if (!composeObraId) {
            toast.error('Selecciona una obra antes de enviar');
            return;
        }
        if (!currentUserId || composeData.recipientIds.length === 0 || !composeData.subject || !composeData.content) {
            toast.error('Completa todos los campos obligatorios');
            return;
        }

        setComposing(true);
        try {
            const sendData: SendMessageData = {
                senderId: currentUserId,
                senderName: `${user.nombre} ${user.apellido || ''}`.trim(),
                senderRol: user.rol || 'trabajador',
                ...composeData
            };

            const response = await inboxApi.send(sendData);
            if (response.success) {
                setShowCompose(false);
                toast.success('Mensaje enviado correctamente');
                if (activeTab === 'sent') loadMessages();
            } else {
                toast.error('Error al enviar: ' + response.error);
            }
        } catch (error) {
            console.error('Error sending:', error);
            toast.error('Error al enviar mensaje');
        } finally {
            setComposing(false);
        }
    };

    const toggleRecipient = (userId: string) => {
        setComposeData(prev => ({
            ...prev,
            recipientIds: prev.recipientIds.includes(userId)
                ? prev.recipientIds.filter(id => id !== userId)
                : [...prev.recipientIds, userId]
        }));
    };

    // Roles del catálogo del tenant. Fallback a los roles de sistema mientras carga.
    const FALLBACK_ROLES = [
        { id: 'admin', nombre: 'Administrador' },
        { id: 'prevencionista', nombre: 'Prevencionista' },
        { id: 'supervisor', nombre: 'Supervisor' },
        { id: 'jefe_obra', nombre: 'Jefe de obra' },
        { id: 'trabajador', nombre: 'Trabajador' },
        { id: 'relator', nombre: 'Relator' },
    ];
    const rolesParaFiltros = tenantRoleCatalog.length > 0 ? tenantRoleCatalog : FALLBACK_ROLES;
    const rolesConRecipients = useMemo(
        () => new Set(recipients.map(r => r.rol).filter(Boolean)),
        [recipients]
    );
    // IDs de roles sin personas en la obra actual (se deshabilitan en el dropdown)
    const rolesDisabled = useMemo(
        () => new Set(rolesParaFiltros.map(r => r.id).filter(id => !rolesConRecipients.has(id))),
        [rolesParaFiltros, rolesConRecipients]
    );

    // Cargos del catálogo del tenant. Si aún no se cargó, fallback a los cargos
    // de los recipients actuales para que los chips aparezcan de inmediato.
    const cargosParaFiltros = useMemo(() => {
        if (tenantCargoCatalog.length > 0) return tenantCargoCatalog;
        return Array.from(new Set(recipients.map(r => r.cargo).filter(Boolean)));
    }, [tenantCargoCatalog, recipients]);
    const cargosConRecipients = useMemo(
        () => new Set(recipients.map(r => r.cargo).filter(Boolean)),
        [recipients]
    );
    const cargosDisabled = useMemo(
        () => new Set(cargosParaFiltros.filter(c => !cargosConRecipients.has(c))),
        [cargosParaFiltros, cargosConRecipients]
    );

    // Destinatarios visibles en la lista según filtros activos de rol/cargo
    // (la búsqueda ya NO filtra la lista — lo hace el autocomplete arriba)
    const filteredRecipients = useMemo(() => {
        return recipients.filter(r => {
            const matchesRol = rolFilters.length === 0 || rolFilters.includes(r.rol);
            const matchesCargo = cargoFilters.length === 0 || cargoFilters.includes(r.cargo);
            return matchesRol && matchesCargo;
        });
    }, [recipients, rolFilters, cargoFilters]);

    // Sugerencias de autocomplete: max 8, filtradas por texto + filtros activos
    const suggestions = useMemo(() => {
        const q = recipientSearch.trim().toLowerCase();
        if (!q) return [];
        return filteredRecipients
            .filter(r =>
                (r.nombreCompleto || '').toLowerCase().includes(q) ||
                (r.rut || '').toLowerCase().includes(q) ||
                (r.cargo || '').toLowerCase().includes(q)
            )
            .slice(0, 8);
    }, [filteredRecipients, recipientSearch]);

    const toggleRolFilter = (rol: string) => {
        setRolFilters(prev => prev.includes(rol) ? prev.filter(r => r !== rol) : [...prev, rol]);
    };
    const toggleCargoFilter = (cargo: string) => {
        setCargoFilters(prev => prev.includes(cargo) ? prev.filter(c => c !== cargo) : [...prev, cargo]);
    };

    // Selecciona un destinatario desde el dropdown de autocomplete
    const selectFromSuggestion = (userId: string) => {
        setComposeData(prev => ({
            ...prev,
            recipientIds: prev.recipientIds.includes(userId)
                ? prev.recipientIds
                : [...prev.recipientIds, userId]
        }));
        setRecipientSearch('');
        setShowSuggestions(false);
    };

    // Seleccionar / quitar todos los destinatarios actualmente visibles (permite
    // seleccionar a todos los usuarios de uno o más roles o cargos filtrados).
    const selectAllFiltered = () => {
        const ids = filteredRecipients.map(r => r.userId);
        setComposeData(prev => ({
            ...prev,
            recipientIds: Array.from(new Set([...prev.recipientIds, ...ids]))
        }));
    };
    const clearFilteredSelection = () => {
        const ids = new Set(filteredRecipients.map(r => r.userId));
        setComposeData(prev => ({
            ...prev,
            recipientIds: prev.recipientIds.filter(id => !ids.has(id))
        }));
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'alert': return <FiAlertCircle className="text-danger-500" />;
            case 'notification': return <FiBell className="text-info-500" />;
            case 'task': return <FiCheckCircle className="text-warning-500" />;
            default: return <FiMail className="text-primary-500" />;
        }
    };

    // Get navigation route from linked entity
    const getLinkedEntityRoute = (linkedEntity: { type: string; id: string } | null | undefined): string | null => {
        if (!linkedEntity || !linkedEntity.type) return null;
        // Normalizar: el backend puede enviar 'signature-request' o 'signature_request'
        switch (linkedEntity.type.replace(/_/g, '-')) {
            case 'survey': return '/surveys';
            case 'activity': return '/activities';
            // Deep-link al documento específico: abre su detalle (visualización + firmar).
            case 'document': return `/documents?doc=${encodeURIComponent(linkedEntity.id)}`;
            case 'incident': return '/incidents';
            case 'signature-request': return '/my-signatures';
            default: return null;
        }
    };

    const getLinkedEntityLabel = (type: string | undefined): string => {
        if (!type) return 'Ver Detalle';
        switch (type.replace(/_/g, '-')) {
            case 'survey': return 'Ver Encuesta';
            case 'activity': return 'Ver Actividad';
            case 'document': return 'Ver Documento';
            case 'incident': return 'Ver Incidente';
            case 'signature-request': return 'Ver Firma';
            default: return 'Ver Detalle';
        }
    };

    const getPriorityLabel = (priority: string): string => {
        const labels: Record<string, string> = {
            urgent: 'Urgente',
            high: 'Alta',
            normal: 'Normal'
        };
        return labels[priority] || priority;
    };

    const formatDate = (date: string) => {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '—';
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        } else if (days === 1) {
            return 'Ayer';
        } else if (days < 7) {
            return d.toLocaleDateString('es-CL', { weekday: 'short' });
        } else {
            return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        }
    };

    // Group sent messages by subject and approximate time (within 1 minute)
    const groupedMessages = (() => {
        if (activeTab !== 'sent') return messages;

        const grouped = new Map<string, InboxMessage & { recipientCount?: number }>();
        messages.forEach(msg => {
            // Group key: subject + rounded timestamp (to nearest minute)
            const timestamp = new Date(msg.createdAt || Date.now());
            const timeValue = timestamp.getTime();
            // Check if date is valid
            if (isNaN(timeValue)) {
                // Use a fallback key for invalid dates
                const groupKey = `${msg.subject || 'unknown'}-unknown`;
                if (!grouped.has(groupKey)) {
                    grouped.set(groupKey, { ...msg, recipientCount: 1 });
                } else {
                    const existing = grouped.get(groupKey)!;
                    existing.recipientCount = (existing.recipientCount || 1) + 1;
                }
                return;
            }

            const roundedTime = new Date(Math.floor(timeValue / 60000) * 60000);
            const groupKey = `${msg.subject || 'unknown'}-${roundedTime.toISOString()}`;

            if (!grouped.has(groupKey)) {
                grouped.set(groupKey, { ...msg, recipientCount: 1 });
            } else {
                const existing = grouped.get(groupKey)!;
                existing.recipientCount = (existing.recipientCount || 1) + 1;
            }
        });

        return Array.from(grouped.values());
    })();

    // Inicio del rango temporal seleccionado (null = sin límite)
    const dateRangeStart = (() => {
        if (dateRange === 'all') return null;
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        if (dateRange === 'today') return d;
        if (dateRange === 'week') {
            // Lunes de la semana actual
            const day = (d.getDay() + 6) % 7;
            d.setDate(d.getDate() - day);
            return d;
        }
        if (dateRange === 'month') {
            d.setDate(1);
            return d;
        }
        return null;
    })();

    const filteredMessages = groupedMessages
        .filter(m => {
            const q = searchTerm.toLowerCase();
            const matchesSearch =
                (m.subject || '').toLowerCase().includes(q) ||
                (m.senderName || '').toLowerCase().includes(q) ||
                (m.content || '').toLowerCase().includes(q);

            // Filtro por clasificación (prioritario = high/urgent)
            const matchesClassification =
                classification === 'all' ||
                (classification === 'priority' && m.priority !== 'normal') ||
                (classification === 'normal' && m.priority === 'normal');

            // Filtro temporal
            let matchesDate = true;
            if (dateRangeStart) {
                const t = new Date(m.createdAt).getTime();
                matchesDate = !isNaN(t) && t >= dateRangeStart.getTime();
            }

            return matchesSearch && matchesClassification && matchesDate;
        })
        // Orden temporal decreciente: los más recientes primero
        .sort((a, b) => {
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
        });

    const hayFiltrosActivos =
        dateRange !== 'all' || classification !== 'all' || searchTerm.trim() !== '' ||
        (activeTab === 'inbox' && filter !== 'all');

    const limpiarFiltros = () => {
        setDateRange('all');
        setClassification('all');
        setSearchTerm('');
        if (activeTab === 'inbox') setFilter('all');
    };

    // La lista ya viene ordenada de más nuevo a más viejo, así que basta con
    // abrir un grupo cada vez que cambia el tramo: quedan en orden y sin repetir.
    const gruposTemporales = useMemo(() => {
        const ahora = new Date();
        const grupos: { label: string; items: InboxMessage[] }[] = [];
        filteredMessages.forEach((m) => {
            const label = tramoTemporal(m.createdAt, ahora);
            const ultimo = grupos[grupos.length - 1];
            if (ultimo && ultimo.label === label) ultimo.items.push(m);
            else grupos.push({ label, items: [m] });
        });
        return grupos;
    }, [filteredMessages]);

    // El vacío dice qué hacer, no solo que no hay nada. Distingue la bandeja
    // realmente vacía de la que quedó vacía por los filtros aplicados.
    const textoVacio = hayFiltrosActivos
        ? { titulo: 'Ningún mensaje coincide', detalle: 'Ajusta la búsqueda o los filtros del costado para ver más.' }
        : activeTab === 'sent'
            ? { titulo: 'Aún no has enviado mensajes', detalle: 'Usa «Nuevo mensaje» para escribirle a tu equipo en obra.' }
            : activeTab === 'archived'
                ? { titulo: 'No hay mensajes archivados', detalle: 'Los mensajes que archives desde la bandeja aparecerán aquí.' }
                : { titulo: 'Bandeja al día', detalle: 'No tienes mensajes pendientes de tu equipo ni de tus supervisores.' };

    return (
        <>

            <div className="page-content">
                <PageHeader
                    banner
                    title="Mensajería interna"
                    description="Comunicación directa con tu equipo y supervisores."
                    actions={
                        <button className="btn btn-primary" onClick={handleCompose}>
                            <FiPlus size={15} />
                            <span className="hide-mobile">Nuevo mensaje</span>
                            <span className="show-mobile-only">Nuevo</span>
                        </button>
                    }
                />

                <div className={`inbox-container ${selectedMessage ? 'has-selection' : ''}`}>

                    {/* Message List */}
                    {/* Carril izquierdo: carpetas + filtros.
                        Las carpetas son navegación (dónde estoy) y los filtros
                        acotan lo que estoy viendo. Ambas cosas son persistentes,
                        así que viven al costado y dejan la barra superior libre
                        para lo único que cambia a cada rato: buscar. */}
                    <aside className="inbox-rail">
                        <nav className="inbox-rail-nav" aria-label="Carpetas">
                            <button
                                type="button"
                                className={`inbox-rail-item ${activeTab === 'inbox' ? 'active' : ''}`}
                                onClick={() => { setActiveTab('inbox'); setFilter('all'); setSelectedMessage(null); }}
                                aria-current={activeTab === 'inbox' ? 'page' : undefined}
                            >
                                <FiInbox size={16} />
                                <span>Recibidos</span>
                                {unreadCount > 0 && <span className="inbox-rail-count">{unreadCount}</span>}
                            </button>
                            <button
                                type="button"
                                className={`inbox-rail-item ${activeTab === 'sent' ? 'active' : ''}`}
                                onClick={() => { setActiveTab('sent'); setSelectedMessage(null); }}
                                aria-current={activeTab === 'sent' ? 'page' : undefined}
                            >
                                <FiSend size={16} />
                                <span>Enviados</span>
                            </button>
                            <button
                                type="button"
                                className={`inbox-rail-item ${activeTab === 'archived' ? 'active' : ''}`}
                                onClick={() => { setActiveTab('archived'); setSelectedMessage(null); }}
                                aria-current={activeTab === 'archived' ? 'page' : undefined}
                            >
                                <FiArchive size={16} />
                                <span>Archivados</span>
                            </button>
                        </nav>

                        {/* En móvil los filtros se pliegan tras este botón; en
                            escritorio el carril siempre los muestra. */}
                        <button
                            type="button"
                            className={`inbox-rail-filtros-toggle${filtrosAbiertos ? ' is-open' : ''}`}
                            onClick={() => setFiltrosAbiertos(o => !o)}
                            aria-expanded={filtrosAbiertos}
                        >
                            <FiFlag size={14} />
                            <span>Filtros</span>
                            {hayFiltrosActivos && <span className="inbox-rail-filtros-dot" aria-label="con filtros aplicados" />}
                            <FiChevronDown size={14} className="inbox-rail-filtros-caret" />
                        </button>

                        <div className={`inbox-rail-filters${filtrosAbiertos ? ' is-open' : ''}`}>
                            {activeTab === 'inbox' && (
                                <FiltroChips
                                    label="Estado"
                                    value={filter}
                                    valorNeutro="all"
                                    onChange={(v) => setFilter(v as FilterType)}
                                    options={[
                                        { value: 'all', label: 'Todos' },
                                        { value: 'unread', label: 'No leídos' },
                                    ]}
                                />
                            )}

                            <FiltroChips
                                label="Fecha"
                                value={dateRange}
                                valorNeutro="all"
                                onChange={(v) => setDateRange(v as DateRangeFilter)}
                                options={[
                                    { value: 'all', label: 'Todas' },
                                    { value: 'today', label: 'Hoy' },
                                    { value: 'week', label: 'Semana' },
                                    { value: 'month', label: 'Mes' },
                                ]}
                            />

                            <FiltroChips
                                label="Prioridad"
                                value={classification}
                                valorNeutro="all"
                                onChange={(v) => setClassification(v as ClassificationFilter)}
                                options={[
                                    { value: 'all', label: 'Todas' },
                                    { value: 'priority', label: 'Prioritarios' },
                                    { value: 'normal', label: 'Normales' },
                                ]}
                            />

                            {hayFiltrosActivos && (
                                <button type="button" className="inbox-rail-clear" onClick={limpiarFiltros}>
                                    <FiX size={13} /> Quitar filtros
                                </button>
                            )}
                        </div>
                    </aside>

                    {/* Lista de mensajes */}
                    <div className="inbox-list">
                        <div className="inbox-toolbar">
                            <div className="inbox-search">
                                <FiSearch size={15} />
                                <input
                                    type="text"
                                    placeholder="Buscar por asunto, remitente o contenido"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        className="inbox-search-clear"
                                        onClick={() => setSearchTerm('')}
                                        aria-label="Limpiar búsqueda"
                                    >
                                        <FiX size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="inbox-toolbar-actions">
                                {!loading && filteredMessages.length > 0 && (
                                    <span className="inbox-toolbar-count">
                                        {filteredMessages.length} {filteredMessages.length === 1 ? 'mensaje' : 'mensajes'}
                                    </span>
                                )}
                                {activeTab === 'inbox' && unreadCount > 0 && (
                                    <button className="btn btn-sm btn-secondary" onClick={handleMarkAllAsRead}>
                                        <FiCheck size={14} />
                                        <span className="hide-mobile">Marcar todos como leídos</span>
                                        <span className="show-mobile-only">Todos leídos</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="inbox-messages">
                            {loading ? (
                                <div className="inbox-empty">
                                    <div className="spinner" />
                                </div>
                            ) : errorCarga ? (
                                /* Antes el fallo era mudo y la lista se quedaba con
                                   los mensajes de la carpeta anterior. Ahora dice qué
                                   pasó y ofrece la salida. */
                                <div className="inbox-empty">
                                    <FiAlertCircle size={40} />
                                    <p className="inbox-empty-title">No se pudo cargar esta carpeta</p>
                                    <p className="inbox-empty-hint">{errorCarga}</p>
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={loadMessages}>
                                        Reintentar
                                    </button>
                                </div>
                            ) : filteredMessages.length === 0 ? (
                                <div className="inbox-empty">
                                    <FiInbox size={40} />
                                    <p className="inbox-empty-title">{textoVacio.titulo}</p>
                                    <p className="inbox-empty-hint">{textoVacio.detalle}</p>
                                    {hayFiltrosActivos && (
                                        <button type="button" className="btn btn-sm btn-secondary" onClick={limpiarFiltros}>
                                            Quitar filtros
                                        </button>
                                    )}
                                </div>
                            ) : (
                                gruposTemporales.map((grupo) => (
                                    <section key={grupo.label} className="inbox-group">
                                        {/* El separador queda fijo mientras se recorre el grupo:
                                            al bajar por la lista siempre se sabe de qué tramo de
                                            tiempo son los mensajes que se están leyendo. */}
                                        <h3 className="inbox-group-header">
                                            <span className="inbox-group-label">{grupo.label}</span>
                                            <span className="inbox-group-rule" aria-hidden="true" />
                                        </h3>

                                        {grupo.items.map((message) => {
                                            const conteoDestinatarios = (message as InboxMessage & { recipientCount?: number }).recipientCount;
                                            const esEnviado = activeTab === 'sent';
                                            const leido = esEnviado || message.read;
                                            return (
                                                <div
                                                    key={message.messageId}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`${message.subject || 'Sin asunto'}, de ${message.senderName || 'desconocido'}`}
                                                    className={`inbox-row ${!leido ? 'unread' : ''} ${selectedMessage?.messageId === message.messageId ? 'selected' : ''}`}
                                                    onClick={() => handleOpenMessage(message)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleOpenMessage(message);
                                                        }
                                                    }}
                                                >
                                                    {/* Un solo control hace de indicador y de interruptor:
                                                        el punto muestra si está leído y al tocarlo lo cambia.
                                                        En obra se usa el teléfono, así que el estado tiene que
                                                        ser tocable y no depender del hover. */}
                                                    {esEnviado ? (
                                                        <span className="inbox-row-dot is-static" aria-hidden="true" />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className="inbox-row-dot"
                                                            aria-pressed={!message.read}
                                                            title={message.read ? 'Marcar como no leído' : 'Marcar como leído'}
                                                            aria-label={message.read ? 'Marcar como no leído' : 'Marcar como leído'}
                                                            onClick={(e) => handleToggleRead(message, e)}
                                                        />
                                                    )}

                                                    <div className="inbox-row-body">
                                                        <div className="inbox-row-top">
                                                            <span className="inbox-row-from">
                                                                {esEnviado && conteoDestinatarios && conteoDestinatarios > 1
                                                                    ? `${conteoDestinatarios} destinatarios`
                                                                    : esEnviado
                                                                        ? 'Enviado'
                                                                        : message.senderName || 'Desconocido'}
                                                            </span>
                                                            <span className="inbox-row-time">{formatDate(message.createdAt)}</span>
                                                        </div>
                                                        <div className="inbox-row-line">
                                                            {message.type !== 'message' && (
                                                                <span className="inbox-row-kind" title={tipoLabel(message.type)}>
                                                                    {getTypeIcon(message.type)}
                                                                </span>
                                                            )}
                                                            <span className="inbox-row-subject">{message.subject || '(Sin asunto)'}</span>
                                                            {message.content && (
                                                                <span className="inbox-row-preview">
                                                                    <span className="inbox-row-dash" aria-hidden="true">—</span>
                                                                    {message.content.replace(/\s+/g, ' ').trim()}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {message.priority !== 'normal' && (
                                                        <span className={`inbox-row-priority ${message.priority}`}>
                                                            {getPriorityLabel(message.priority)}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </section>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Message Detail */}
                    {selectedMessage && (
                        <div className="inbox-detail">
                            <div className="inbox-detail-header">
                                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedMessage(null)} title="Volver a la lista" aria-label="Volver a la lista">
                                    <FiChevronLeft />
                                </button>
                                <div className="inbox-detail-actions">
                                    {/* Abrir un mensaje lo marca leído, así que aquí hace
                                        falta el camino de vuelta: dejarlo pendiente. */}
                                    {activeTab !== 'sent' && (
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            onClick={(e) => { handleToggleRead(selectedMessage, e); setSelectedMessage(null); }}
                                            title="Marcar como no leído"
                                            aria-label="Marcar como no leído"
                                        >
                                            <FiMail />
                                        </button>
                                    )}
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleArchive(selectedMessage.messageId)} title="Archivar" aria-label="Archivar">
                                        <FiArchive />
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(selectedMessage.messageId)} title="Eliminar" aria-label="Eliminar">
                                        <FiTrash2 />
                                    </button>
                                </div>
                            </div>

                            <div className="inbox-detail-content">
                                <h2 className="inbox-detail-subject">{selectedMessage.subject || '(Sin asunto)'}</h2>
                                <div className="inbox-detail-meta">
                                    <div className="inbox-detail-sender">
                                        <div className="avatar avatar-sm">{(selectedMessage.senderName || 'S').charAt(0)}</div>
                                        <div>
                                            <div className="font-semibold">{selectedMessage.senderName || 'Desconocido'}</div>
                                            <div className="text-sm text-muted">{selectedMessage.senderRol || ''}</div>
                                        </div>
                                    </div>
                                    <div className="text-sm text-muted">
                                        <FiClock size={12} /> {isNaN(new Date(selectedMessage.createdAt).getTime()) ? '—' : new Date(selectedMessage.createdAt).toLocaleString('es-CL')}
                                    </div>
                                </div>
                                <div className="inbox-detail-body">
                                    {(selectedMessage.content || '').split('\n').map((line, i) => (
                                        <p key={i}>{line}</p>
                                    ))}
                                </div>

                                {/* Navigation button if linked to an entity */}
                                {selectedMessage.linkedEntity && getLinkedEntityRoute(selectedMessage.linkedEntity) && (
                                    <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--surface-border)' }}>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => {
                                                const route = getLinkedEntityRoute(selectedMessage.linkedEntity);
                                                if (route) navigate(route);
                                            }}
                                        >
                                            {getLinkedEntityLabel(selectedMessage.linkedEntity.type)}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Compose Modal */}
            <Modal
                isOpen={showCompose}
                onClose={() => setShowCompose(false)}
                title="Nuevo Mensaje"
                size="lg"
                preventClose={composing}
                footer={
                    <>
                        <button className="btn btn-secondary" onClick={() => setShowCompose(false)}>Cancelar</button>
                        <button className="btn btn-primary" onClick={handleSend} disabled={composing}>
                            {composing ? <><div className="spinner" /> Enviando...</> : <><FiSend /> Enviar</>}
                        </button>
                    </>
                }
            >
                            <div className="form-group">
                                <label className="form-label">Obra *</label>
                                <Select
                                    ariaLabel="Obra"
                                    value={composeObraId}
                                    onChange={handleSelectComposeObra}
                                    placeholder={userObras.length === 0 ? 'No perteneces a ninguna obra' : 'Selecciona una obra'}
                                    disabled={userObras.length === 0}
                                    options={userObras.map(o => ({
                                        value: o.obraId,
                                        label: o.nombre + (o.codigo ? ` (${o.codigo})` : ''),
                                    }))}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">
                                    Destinatarios *
                                    {composeData.recipientIds.length > 0 && (
                                        <span className="recipient-count-badge">{composeData.recipientIds.length} seleccionado(s)</span>
                                    )}
                                </label>

                                {!composeObraId ? (
                                    <div className="recipient-placeholder">
                                        <FiUsers size={20} />
                                        <span>Selecciona una obra para ver sus destinatarios.</span>
                                    </div>
                                ) : loadingRecipients ? (
                                    <div className="spinner" />
                                ) : recipients.length === 0 ? (
                                    <div className="recipient-placeholder">
                                        <FiUsers size={20} />
                                        <span>No hay destinatarios disponibles en esta obra.</span>
                                    </div>
                                ) : (
                                    <>
                                        {/* Autocomplete de búsqueda de destinatarios */}
                                        <div className="recipient-autocomplete-wrap">
                                            <div className="recipient-search">
                                                <FiSearch size={14} />
                                                <input
                                                    type="text"
                                                    placeholder="Buscar por nombre, cargo o RUT…"
                                                    value={recipientSearch}
                                                    autoComplete="off"
                                                    onChange={(e) => { setRecipientSearch(e.target.value); setShowSuggestions(true); }}
                                                    onFocus={() => { if (recipientSearch) setShowSuggestions(true); }}
                                                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Escape') { setShowSuggestions(false); setRecipientSearch(''); }
                                                        if (e.key === 'Enter' && suggestions.length > 0) { e.preventDefault(); selectFromSuggestion(suggestions[0].userId); }
                                                    }}
                                                />
                                                {recipientSearch && (
                                                    <button type="button" className="recipient-search-clear" onClick={() => { setRecipientSearch(''); setShowSuggestions(false); }}>×</button>
                                                )}
                                            </div>
                                            {showSuggestions && suggestions.length > 0 && (
                                                <div className="recipient-suggestions">
                                                    {suggestions.map(r => (
                                                        <button
                                                            type="button"
                                                            key={r.userId}
                                                            className={`recipient-suggestion-item ${composeData.recipientIds.includes(r.userId) ? 'selected' : ''}`}
                                                            onMouseDown={(e) => { e.preventDefault(); selectFromSuggestion(r.userId); }}
                                                        >
                                                            <div className="avatar avatar-sm">{(r.nombre || 'U').charAt(0)}</div>
                                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                                <div className="font-semibold" style={{ fontSize: '13px' }}>{r.nombreCompleto}</div>
                                                                <div className="text-xs text-muted">{rolLabel(r.rol)}{r.cargo ? ` · ${r.cargo}` : ''}</div>
                                                            </div>
                                                            {composeData.recipientIds.includes(r.userId) && <FiCheck size={14} style={{ color: 'var(--primary-500)', flexShrink: 0 }} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {showSuggestions && recipientSearch.trim() && suggestions.length === 0 && (
                                                <div className="recipient-suggestions">
                                                    <div className="recipient-suggestion-empty">Sin resultados para "{recipientSearch}"</div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Filtros por rol y cargo — dropdowns con checkboxes */}
                                        <div className="recipient-filter-dropdowns">
                                            <MultiSelectDropdown
                                                label="Rol"
                                                options={rolesParaFiltros.map(r => r.id)}
                                                selected={rolFilters}
                                                onToggle={toggleRolFilter}
                                                onClear={() => setRolFilters([])}
                                                disabledSet={rolesDisabled}
                                                getLabel={id => rolesParaFiltros.find(r => r.id === id)?.nombre || rolLabel(id)}
                                            />
                                            {cargosParaFiltros.length > 0 && (
                                                <MultiSelectDropdown
                                                    label="Cargo"
                                                    options={cargosParaFiltros}
                                                    selected={cargoFilters}
                                                    onToggle={toggleCargoFilter}
                                                    onClear={() => setCargoFilters([])}
                                                    disabledSet={cargosDisabled}
                                                />
                                            )}
                                        </div>

                                        {/* Acciones de selección masiva */}
                                        <div className="recipient-bulk-actions">
                                            <span className="text-xs text-muted">{filteredRecipients.length} persona(s)</span>
                                            <div className="flex gap-2">
                                                <button type="button" className="btn btn-sm btn-secondary" onClick={selectAllFiltered} disabled={filteredRecipients.length === 0}>
                                                    <FiCheck /> Seleccionar todos
                                                </button>
                                                <button type="button" className="btn btn-sm btn-ghost" onClick={clearFilteredSelection} disabled={filteredRecipients.length === 0}>
                                                    Quitar
                                                </button>
                                            </div>
                                        </div>

                                        <div className="recipient-list">
                                            {filteredRecipients.length === 0 ? (
                                                <div className="recipient-placeholder" style={{ border: 'none' }}>
                                                    <span>Ningún destinatario coincide con los filtros.</span>
                                                </div>
                                            ) : filteredRecipients.map((r) => (
                                                <label key={r.userId} className={`recipient-item ${composeData.recipientIds.includes(r.userId) ? 'selected' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={composeData.recipientIds.includes(r.userId)}
                                                        onChange={() => toggleRecipient(r.userId)}
                                                    />
                                                    <div className="avatar avatar-sm">{(r.nombre || 'U').charAt(0)}</div>
                                                    <div>
                                                        <div className="font-semibold">{r.nombreCompleto}</div>
                                                        <div className="text-xs text-muted">
                                                            {rolLabel(r.rol)}{r.cargo ? ` • ${r.cargo}` : ''} • {r.rut}
                                                        </div>
                                                    </div>
                                                </label>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="form-group">
                                    <label className="form-label">Tipo</label>
                                    <Select
                                        ariaLabel="Tipo de mensaje"
                                        value={composeData.type}
                                        onChange={(v) => setComposeData({ ...composeData, type: v as MessageType })}
                                        options={[
                                            { value: 'message', label: 'Mensaje', icon: <FiMail /> },
                                            { value: 'notification', label: 'Notificación', icon: <FiBell /> },
                                            { value: 'alert', label: 'Alerta', icon: <FiAlertCircle /> },
                                            { value: 'task', label: 'Tarea', icon: <FiCheckCircle /> },
                                        ]}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Prioridad</label>
                                    <SegmentedControl
                                        ariaLabel="Prioridad del mensaje"
                                        value={composeData.priority}
                                        onChange={(v) => setComposeData({ ...composeData, priority: v as MessagePriority })}
                                        options={[
                                            { value: 'normal', label: 'Normal' },
                                            { value: 'high', label: 'Alta' },
                                            { value: 'urgent', label: 'Urgente' },
                                        ]}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Asunto *</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Asunto del mensaje"
                                    value={composeData.subject}
                                    onChange={(e) => setComposeData({ ...composeData, subject: e.target.value })}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Mensaje *</label>
                                <textarea
                                    className="form-input"
                                    rows={6}
                                    placeholder="Escribe tu mensaje aquí..."
                                    value={composeData.content}
                                    onChange={(e) => setComposeData({ ...composeData, content: e.target.value })}
                                />
                            </div>
            </Modal>

            <style>{`
                /* ── Estructura ──
                   Tres zonas: carril de carpetas y filtros, lista y detalle.
                   El carril es fijo; la lista y el detalle hacen scroll propio,
                   así que la página nunca crece más allá del alto disponible. */
                .inbox-container {
                    display: grid;
                    grid-template-columns: 240px minmax(0, 1fr);
                    grid-template-rows: minmax(0, 1fr);
                    height: calc(100vh - var(--header-height) - var(--space-12));
                    background: var(--surface-card);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--surface-border);
                    overflow: hidden;
                }

                /* ── Carril ── */
                .inbox-rail {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-5);
                    padding: var(--space-4) var(--space-3);
                    border-right: 1px solid var(--surface-border);
                    background: var(--surface-elevated);
                    overflow-y: auto;
                }

                .inbox-rail-nav {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }

                .inbox-rail-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    width: 100%;
                    padding: var(--space-2) var(--space-3);
                    border: none;
                    border-radius: var(--radius-full);
                    background: transparent;
                    color: var(--text-secondary);
                    font-family: inherit;
                    font-size: var(--text-sm);
                    font-weight: 500;
                    text-align: left;
                    cursor: pointer;
                    transition: background var(--transition-fast), color var(--transition-fast);
                }

                .inbox-rail-item:hover { background: var(--surface-hover); color: var(--text-primary); }

                .inbox-rail-item.active {
                    background: var(--accent-tint);
                    color: var(--accent-text);
                    font-weight: 700;
                }

                .inbox-rail-count {
                    margin-left: auto;
                    min-width: 20px;
                    padding: 1px 6px;
                    border-radius: var(--radius-full);
                    background: var(--primary-500);
                    color: #fff;
                    font-size: 11px;
                    font-weight: 700;
                    text-align: center;
                }

                .inbox-rail-filters {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-4);
                    padding-top: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                }

                /* El plegado es sólo de móvil: en escritorio el carril tiene
                   sitio de sobra y esconder los filtros sería trabajo extra. */
                .inbox-rail-filtros-toggle { display: none; }

                .inbox-filtro {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                }

                .inbox-filtro-label {
                    padding: 0 var(--space-3);
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.09em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                }

                .inbox-filtro-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    padding: 0 4px;
                }

                .inbox-chip {
                    padding: 4px 8px;
                    border: 1px solid transparent;
                    border-radius: var(--radius-full);
                    background: transparent;
                    color: var(--text-secondary);
                    font-family: inherit;
                    font-size: 12px;
                    font-weight: 500;
                    line-height: 1.4;
                    cursor: pointer;
                    transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
                }

                .inbox-chip:hover { background: var(--surface-hover); color: var(--text-primary); }

                .inbox-chip:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }

                /* Valor elegido que no recorta nada: se marca en gris. */
                .inbox-chip.is-current {
                    background: var(--surface-hover);
                    border-color: var(--surface-border);
                    color: var(--text-primary);
                    font-weight: 600;
                }

                /* Valor elegido que sí esconde mensajes: se enciende en azul,
                   igual que la carpeta activa, para que se note que hay algo
                   fuera de la vista. */
                .inbox-chip.is-narrowing {
                    background: var(--accent-tint);
                    border-color: transparent;
                    color: var(--accent-text);
                    font-weight: 700;
                }

                .inbox-rail-clear {
                    display: inline-flex;
                    align-items: center;
                    align-self: flex-start;
                    gap: 5px;
                    margin-left: 4px;
                    padding: 4px 8px;
                    border: none;
                    border-radius: var(--radius-md);
                    background: transparent;
                    color: var(--text-muted);
                    font-family: inherit;
                    font-size: 12.5px;
                    cursor: pointer;
                    transition: background var(--transition-fast), color var(--transition-fast);
                }

                .inbox-rail-clear:hover { background: var(--surface-hover); color: var(--text-primary); }

                /* ── Lista ── */
                .inbox-list {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                    min-height: 0;
                    overflow: hidden;
                }

                .inbox-toolbar {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3) var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }

                .inbox-search {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-2) var(--space-3);
                    border: 1px solid transparent;
                    border-radius: var(--radius-full);
                    background: var(--surface-elevated);
                    color: var(--text-muted);
                    transition: border-color var(--transition-fast), background var(--transition-fast);
                }

                .inbox-search:focus-within {
                    border-color: var(--accent);
                    background: var(--surface-card);
                }

                .inbox-search input {
                    flex: 1;
                    min-width: 0;
                    border: none;
                    outline: none;
                    background: transparent;
                    color: var(--text-primary);
                    font-family: inherit;
                    font-size: var(--text-sm);
                }

                .inbox-search-clear {
                    display: flex;
                    padding: 2px;
                    border: none;
                    border-radius: var(--radius-full);
                    background: transparent;
                    color: var(--text-muted);
                    cursor: pointer;
                }

                .inbox-search-clear:hover { color: var(--text-primary); }

                .inbox-toolbar-actions {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    flex-shrink: 0;
                }

                .inbox-toolbar-count {
                    font-size: 12.5px;
                    color: var(--text-muted);
                    white-space: nowrap;
                }

                .inbox-messages {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                }

                /* ── Separadores por tramo de tiempo ──
                   Se quedan pegados arriba mientras se recorre el grupo: el
                   tramo que se está leyendo siempre está a la vista. */
                .inbox-group-header {
                    position: sticky;
                    top: 0;
                    z-index: 2;
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    margin: 0;
                    padding: var(--space-3) var(--space-4) var(--space-2);
                    background: var(--surface-card);
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.09em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                }

                .inbox-group-rule {
                    flex: 1;
                    height: 1px;
                    background: var(--surface-border);
                }

                /* ── Fila ── */
                .inbox-row {
                    display: flex;
                    align-items: baseline;
                    gap: var(--space-3);
                    padding: 10px var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: background var(--transition-fast);
                }

                .inbox-row:last-child { border-bottom: none; }
                .inbox-row:hover { background: var(--surface-hover); }
                .inbox-row:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: -2px;
                }

                .inbox-row.selected {
                    background: var(--accent-tint);
                    box-shadow: inset 3px 0 0 var(--primary-500);
                }

                /* El punto es a la vez indicador y control: lleno = no leído,
                   contorno = leído. Un solo toque cambia el estado. */
                .inbox-row-dot {
                    flex-shrink: 0;
                    width: 20px;
                    height: 20px;
                    position: relative;
                    align-self: center;
                    padding: 0;
                    border: none;
                    border-radius: var(--radius-full);
                    background: transparent;
                    cursor: pointer;
                    transition: background var(--transition-fast);
                }

                .inbox-row-dot::after {
                    content: '';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 9px;
                    height: 9px;
                    transform: translate(-50%, -50%);
                    border-radius: var(--radius-full);
                    border: 1.5px solid var(--text-muted);
                    background: transparent;
                    transition: background var(--transition-fast), border-color var(--transition-fast);
                }

                .inbox-row.unread .inbox-row-dot::after {
                    border-color: var(--primary-500);
                    background: var(--primary-500);
                }

                button.inbox-row-dot:hover { background: var(--surface-border); }
                button.inbox-row-dot:focus-visible {
                    outline: 2px solid var(--accent);
                    outline-offset: 1px;
                }

                .inbox-row-dot.is-static { cursor: default; }
                .inbox-row-dot.is-static::after { opacity: 0.45; }

                .inbox-row-body { flex: 1; min-width: 0; }

                .inbox-row-top {
                    display: flex;
                    align-items: baseline;
                    justify-content: space-between;
                    gap: var(--space-3);
                    margin-bottom: 2px;
                }

                .inbox-row-from {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-secondary);
                }

                .inbox-row-time {
                    flex-shrink: 0;
                    font-size: 12px;
                    color: var(--text-muted);
                    font-variant-numeric: tabular-nums;
                }

                /* Asunto y adelanto en una sola línea, como en el correo: cabe
                   más historial en pantalla y el ojo baja por una sola columna. */
                .inbox-row-line {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    min-width: 0;
                    white-space: nowrap;
                    overflow: hidden;
                }

                .inbox-row-kind {
                    display: inline-flex;
                    align-self: center;
                    flex-shrink: 0;
                    line-height: 0;
                }

                .inbox-row-subject {
                    flex-shrink: 0;
                    max-width: 60%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-size: 13.5px;
                    color: var(--text-secondary);
                }

                .inbox-row-preview {
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    font-size: 13px;
                    color: var(--text-muted);
                }

                .inbox-row-dash { margin-right: 5px; }

                /* No leído: peso y contraste, sin teñir la fila. El color queda
                   libre para lo único que sí es una alarma, la prioridad. */
                .inbox-row.unread .inbox-row-from { font-weight: 700; color: var(--text-primary); }
                .inbox-row.unread .inbox-row-subject { font-weight: 700; color: var(--text-primary); }
                .inbox-row.unread .inbox-row-time { color: var(--text-secondary); font-weight: 600; }

                .inbox-row-priority {
                    flex-shrink: 0;
                    align-self: center;
                    padding: 2px 8px;
                    border-radius: var(--radius-full);
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.02em;
                    white-space: nowrap;
                }

                .inbox-row-priority.urgent {
                    background: var(--danger-600);
                    color: #fff;
                }

                .inbox-row-priority.high {
                    background: var(--warning-500);
                    color: #4a3708;
                }

                /* ── Vacío ── */
                .inbox-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-2);
                    height: 100%;
                    padding: var(--space-8) var(--space-6);
                    text-align: center;
                    color: var(--text-muted);
                }

                .inbox-empty-title {
                    margin: var(--space-2) 0 0;
                    font-size: var(--text-base);
                    font-weight: 600;
                    color: var(--text-primary);
                }

                .inbox-empty-hint {
                    margin: 0 0 var(--space-2);
                    max-width: 34ch;
                    font-size: var(--text-sm);
                    line-height: 1.5;
                }

                /* ── Detalle ── */
                .inbox-detail {
                    display: none;
                    flex-direction: column;
                    border-left: 1px solid var(--surface-border);
                    width: 100%;
                    height: 100%;
                    min-height: 0;
                    overflow: hidden;
                }

                .inbox-detail-content .inbox-detail-body {
                    overflow-wrap: anywhere;
                    word-break: break-word;
                }

                .inbox-detail-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-3) var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }

                .inbox-detail-actions {
                    display: flex;
                    gap: var(--space-1);
                }

                .inbox-detail-content {
                    flex: 1;
                    padding: var(--space-5);
                    overflow-y: auto;
                }

                .inbox-detail-subject {
                    font-size: var(--text-xl);
                    font-weight: 700;
                    margin-bottom: var(--space-4);
                }

                .inbox-detail-meta {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: var(--space-3);
                    flex-wrap: wrap;
                    padding-bottom: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    margin-bottom: var(--space-4);
                }

                .inbox-detail-sender {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                }

                .inbox-detail-body {
                    line-height: 1.7;
                    color: var(--text-secondary);
                }

                .inbox-detail-body p {
                    margin-bottom: var(--space-3);
                }

                @media (prefers-reduced-motion: reduce) {
                    .inbox-rail-item,
                    .inbox-chip,
                    .inbox-row,
                    .inbox-row-dot,
                    .inbox-row-dot::after,
                    .inbox-search { transition: none; }
                }

                /* Selector de destinatarios */
                .recipient-autocomplete-wrap {
                    position: relative;
                    margin-bottom: var(--space-2);
                }

                .recipient-search {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    background: var(--surface-elevated);
                    padding: var(--space-2) var(--space-3);
                    border-radius: var(--radius-md);
                    border: 1px solid var(--surface-border);
                    transition: border-color 0.15s;
                }

                .recipient-search:focus-within {
                    border-color: var(--primary-500);
                    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-500) 15%, transparent);
                }

                .recipient-search input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    outline: none;
                    color: var(--text-primary);
                    font-size: 14px;
                }

                .recipient-search-clear {
                    background: none;
                    border: none;
                    cursor: pointer;
                    color: var(--text-muted);
                    font-size: 18px;
                    line-height: 1;
                    padding: 0 2px;
                    display: flex;
                    align-items: center;
                }

                .recipient-search-clear:hover {
                    color: var(--text-primary);
                }

                .recipient-suggestions {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    right: 0;
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                    z-index: 200;
                    overflow: hidden;
                    max-height: 280px;
                    overflow-y: auto;
                }

                .recipient-suggestion-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-2) var(--space-3);
                    width: 100%;
                    text-align: left;
                    background: none;
                    border: none;
                    cursor: pointer;
                    transition: background 0.1s;
                    border-bottom: 1px solid var(--surface-border);
                }

                .recipient-suggestion-item:last-child {
                    border-bottom: none;
                }

                .recipient-suggestion-item:hover {
                    background: var(--surface-hover);
                }

                .recipient-suggestion-item.selected {
                    background: color-mix(in srgb, var(--primary-500) 6%, transparent);
                }

                .recipient-suggestion-empty {
                    padding: var(--space-3) var(--space-4);
                    color: var(--text-muted);
                    font-size: 13px;
                    text-align: center;
                }

                .recipient-filter-dropdowns {
                    display: flex;
                    gap: var(--space-2);
                    margin-bottom: var(--space-2);
                    flex-wrap: wrap;
                }

                /* MultiSelectDropdown */
                .msd-wrap {
                    position: relative;
                }

                .msd-trigger {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    font-size: 13px;
                    font-weight: 500;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    background: var(--surface-elevated);
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                    white-space: nowrap;
                }

                .msd-trigger:hover {
                    border-color: var(--primary-400);
                    color: var(--text-primary);
                }

                .msd-trigger.active {
                    border-color: var(--primary-500);
                    background: color-mix(in srgb, var(--primary-500) 10%, transparent);
                    color: var(--primary-600, var(--primary-500));
                    font-weight: 600;
                }

                .msd-panel {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    min-width: 200px;
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                    z-index: 300;
                    overflow: hidden;
                    max-height: 260px;
                    overflow-y: auto;
                }

                .msd-option {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 9px 14px;
                    cursor: pointer;
                    font-size: 13px;
                    color: var(--text-primary);
                    transition: background 0.1s;
                    border-bottom: 1px solid var(--surface-border);
                }

                .msd-option:last-child {
                    border-bottom: none;
                }

                .msd-option:hover:not(.msd-disabled) {
                    background: var(--surface-hover);
                }

                .msd-option.msd-disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                .msd-option input[type="checkbox"] {
                    accent-color: var(--primary-500);
                    width: 15px;
                    height: 15px;
                    flex-shrink: 0;
                }

                .msd-option-label {
                    flex: 1;
                }

                .msd-no-members {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-left: auto;
                }

                .msd-empty {
                    padding: 10px 14px;
                    font-size: 13px;
                    color: var(--text-muted);
                    text-align: center;
                }

                .recipient-bulk-actions {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-2);
                    margin-bottom: var(--space-2);
                }

                .recipient-placeholder {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-2);
                    padding: var(--space-4);
                    color: var(--text-muted);
                    font-size: var(--text-sm);
                    text-align: center;
                    border: 1px dashed var(--surface-border);
                    border-radius: var(--radius-md);
                }

                .recipient-count-badge {
                    margin-left: var(--space-2);
                    font-size: var(--text-xs);
                    font-weight: 600;
                    color: var(--primary-500);
                }

                .recipient-list {
                    max-height: 200px;
                    overflow-y: auto;
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-md);
                    padding: var(--space-2);
                }

                .recipient-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-2);
                    border-radius: var(--radius-md);
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .recipient-item:hover {
                    background: var(--surface-hover);
                }

                .recipient-item.selected {
                    background: rgba(76, 175, 80, 0.15);
                }

                .recipient-item input {
                    margin-right: var(--space-2);
                }

                .hide-mobile { display: inline !important; }
                .show-mobile-only { display: none !important; }

                /* Con un mensaje abierto se parte en dos columnas: lista a la
                   izquierda, mensaje a la derecha. */
                @media (min-width: 1025px) {
                    .inbox-container.has-selection {
                        grid-template-columns: 240px minmax(0, 1fr) 400px;
                    }

                    .inbox-detail { display: flex; }
                }

                /* Tablet: el carril pasa a ser una franja horizontal sobre la
                   lista. Es el MISMO marcado, solo cambia el eje: las carpetas
                   siguen siendo carpetas y los filtros siguen siendo filtros. */
                @media (max-width: 1024px) {
                    .inbox-container {
                        grid-template-columns: minmax(0, 1fr);
                        grid-template-rows: auto minmax(0, 1fr);
                        height: calc(100vh - var(--header-height) - 140px);
                        margin-bottom: var(--space-4);
                        position: relative;
                    }

                    .inbox-rail {
                        flex-direction: row;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: var(--space-2) var(--space-3);
                        padding: var(--space-3);
                        border-right: none;
                        border-bottom: 1px solid var(--surface-border);
                        overflow-x: auto;
                        overflow-y: visible;
                    }

                    .inbox-rail-nav { flex-direction: row; gap: var(--space-1); }
                    .inbox-rail-item { width: auto; white-space: nowrap; }

                    /* Plegados tras el botón «Filtros»: en un teléfono, tres
                       grupos de opciones antes del primer mensaje estorban más
                       de lo que ayudan. Abiertos, ocupan el ancho completo. */
                    .inbox-rail-filtros-toggle {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        flex-shrink: 0;
                        padding: var(--space-2) var(--space-3);
                        border: 1px solid var(--surface-border);
                        border-radius: var(--radius-full);
                        background: var(--surface-card);
                        color: var(--text-secondary);
                        font-family: inherit;
                        font-size: var(--text-sm);
                        font-weight: 500;
                        cursor: pointer;
                    }

                    .inbox-rail-filtros-toggle.is-open {
                        background: var(--accent-tint);
                        border-color: transparent;
                        color: var(--accent-text);
                    }

                    .inbox-rail-filtros-caret { transition: transform var(--transition-fast); }
                    .inbox-rail-filtros-toggle.is-open .inbox-rail-filtros-caret { transform: rotate(180deg); }

                    /* Aviso de que hay filtros puestos aunque estén plegados. */
                    .inbox-rail-filtros-dot {
                        width: 6px;
                        height: 6px;
                        border-radius: var(--radius-full);
                        background: var(--primary-500);
                    }

                    .inbox-rail-filters {
                        display: none;
                        width: 100%;
                        gap: var(--space-3);
                        padding-top: var(--space-3);
                    }

                    .inbox-rail-filters.is-open { display: flex; }

                    .inbox-filtro { flex-direction: row; align-items: center; gap: var(--space-3); }
                    .inbox-filtro-label { flex: 0 0 68px; padding: 0; }
                    .inbox-filtro-chips { flex: 1; padding: 0; }

                    .inbox-detail {
                        display: none;
                        position: absolute;
                        inset: 0;
                        z-index: 10;
                        background: var(--surface-card);
                        border-left: none;
                    }

                    .inbox-container.has-selection .inbox-rail,
                    .inbox-container.has-selection .inbox-list { display: none; }
                    .inbox-container.has-selection .inbox-detail { display: flex; }
                }

                @media (max-width: 640px) {
                    .hide-mobile { display: none !important; }
                    .show-mobile-only { display: inline !important; }

                    .inbox-rail { gap: var(--space-2); }
                    .inbox-rail-nav { width: 100%; }
                    .inbox-rail-item { flex: 1; justify-content: center; gap: var(--space-2); padding: var(--space-2); }
                    .inbox-rail-filters { width: 100%; min-width: 0; flex-wrap: wrap; }

                    .inbox-toolbar { padding: var(--space-2) var(--space-3); }
                    .inbox-group-header { padding: var(--space-3) var(--space-3) var(--space-2); }
                    .inbox-row { padding: var(--space-3); gap: var(--space-2); }

                    /* En pantalla angosta el adelanto baja a su propia línea: el
                       asunto completo pesa más que ver dos palabras del cuerpo.
                       Cada línea se corta con puntos suspensivos en vez de
                       envolverse, para que todas las filas midan lo mismo. */
                    .inbox-row-line { flex-wrap: wrap; }
                    .inbox-row-subject { flex: 1 1 0; min-width: 0; max-width: 100%; }
                    .inbox-row-preview { flex: 0 0 100%; white-space: nowrap; }
                    .inbox-row-dash { display: none; }

                    .inbox-detail-content { padding: var(--space-4); }
                }

                @media (max-width: 380px) {
                    .inbox-rail-item span:not(.inbox-rail-count) { display: none; }
                }
            `}</style>
        </>
    );
}
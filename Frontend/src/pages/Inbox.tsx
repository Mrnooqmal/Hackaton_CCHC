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
import { Modal, Select, SegmentedControl } from '../components/ui';

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
        setLoading(true);
        try {
            let response;
            if (activeTab === 'inbox') {
                response = await inboxApi.getInbox(currentUserId, filter);
            } else if (activeTab === 'sent') {
                response = await inboxApi.getSent(currentUserId);
            } else {
                response = await inboxApi.getInbox(currentUserId, 'archived');
            }

            if (response.success && response.data) {
                // Orden tipo correo: mas recientes primero por fecha/hora de llegada.
                const ordenados = [...response.data.messages].sort((a, b) =>
                    String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
                );
                setMessages(ordenados);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        } finally {
            setLoading(false);
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

    const getPriorityBadge = (priority: string) => {
        const badges: Record<string, string> = {
            urgent: 'badge-danger',
            high: 'badge-warning',
            normal: 'badge-secondary'
        };
        return badges[priority] || 'badge-secondary';
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

    return (
        <>

            <div className="page-content">
                <div className="page-header">
                    <div className="page-header-info">
                        <h2 className="page-header-title">
                            <FiInbox className="text-primary-500" />
                            Mensajería Interna
                        </h2>
                        <p className="page-header-description">Comunicación directa con tu equipo y supervisores.</p>
                    </div>
                    <div className="page-header-actions">
                        <button className="btn btn-primary" onClick={handleCompose}>
                            <FiPlus className="mr-2" />
                            <span className="hide-mobile">Nuevo Mensaje</span>
                            <span className="show-mobile-only">Nuevo</span>
                        </button>
                    </div>
                </div>

                <div className={`inbox-container ${selectedMessage ? 'has-selection' : ''}`}>

                    {/* Message List */}
                    <div className="inbox-list">
                        <div className="inbox-list-header">
                            {/* Search bar */}
                            <div className="inbox-search">
                                <FiSearch />
                                <input
                                    type="text"
                                    placeholder="Buscar..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>

                            {/* Desktop actions */}
                            <div className="flex gap-2 desktop-only">
                                {activeTab === 'inbox' && unreadCount > 0 && (
                                    <button className="btn btn-sm btn-secondary" onClick={handleMarkAllAsRead}>
                                        <FiCheck /> Marcar todos leídos
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Filtros de temporalidad y clasificación */}
                        <div className="inbox-toolbar-filters">
                            <div className="inbox-toolbar-filter">
                                <FiClock size={14} />
                                <Select
                                    ariaLabel="Filtrar por fecha"
                                    value={dateRange}
                                    onChange={(v) => setDateRange(v as DateRangeFilter)}
                                    options={[
                                        { value: 'all', label: 'Todas las fechas' },
                                        { value: 'today', label: 'Hoy' },
                                        { value: 'week', label: 'Esta semana' },
                                        { value: 'month', label: 'Este mes' },
                                    ]}
                                />
                            </div>
                            <div className="inbox-toolbar-filter">
                                <FiFlag size={14} />
                                <Select
                                    ariaLabel="Filtrar por clasificación"
                                    value={classification}
                                    onChange={(v) => setClassification(v as ClassificationFilter)}
                                    options={[
                                        { value: 'all', label: 'Todas las prioridades' },
                                        { value: 'priority', label: 'Solo prioritarios' },
                                        { value: 'normal', label: 'Solo normales' },
                                    ]}
                                />
                            </div>
                        </div>

                        {/* DESKTOP TABS */}
                        <div className="desktop-only" style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            padding: '16px 16px 12px 16px',
                            borderBottom: '1px solid var(--surface-border)'
                        }}>
                            {/* Tabs horizontales para desktop */}
                            <div style={{
                                display: 'flex',
                                gap: '4px',
                                background: 'var(--surface-elevated)',
                                padding: '4px',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--surface-border)'
                            }}>
                                <button
                                    className={`desktop-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
                                    onClick={() => { setActiveTab('inbox'); setFilter('all'); }}
                                    style={{
                                        flex: 1,
                                        padding: '10px 16px',
                                        fontSize: '14px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        background: activeTab === 'inbox' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'inbox' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontWeight: '500'
                                    }}
                                >
                                    <FiInbox size={16} />
                                    <span>Recibidos</span>
                                    {unreadCount > 0 && (
                                        <span style={{
                                            width: '8px',
                                            height: '8px',
                                            background: activeTab === 'inbox' ? 'white' : 'var(--danger-500)',
                                            borderRadius: '50%'
                                        }} />
                                    )}
                                </button>
                                <button
                                    className={`desktop-nav-item ${activeTab === 'sent' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('sent')}
                                    style={{
                                        flex: 1,
                                        padding: '10px 16px',
                                        fontSize: '14px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        background: activeTab === 'sent' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'sent' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontWeight: '500'
                                    }}
                                >
                                    <FiSend size={16} />
                                    <span>Enviados</span>
                                </button>
                                <button
                                    className={`desktop-nav-item ${activeTab === 'archived' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('archived')}
                                    style={{
                                        flex: 1,
                                        padding: '10px 16px',
                                        fontSize: '14px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '8px',
                                        background: activeTab === 'archived' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'archived' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontWeight: '500'
                                    }}
                                >
                                    <FiArchive size={16} />
                                    <span>Archivados</span>
                                </button>
                            </div>

                            {/* Filtros para inbox - SOLO CUANDO ESTÁ EN RECIBIDOS - DESKTOP */}
                            {activeTab === 'inbox' && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    background: 'var(--surface-elevated)',
                                    padding: '8px',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--surface-border)'
                                }}>
                                    <span style={{
                                        fontSize: '14px',
                                        fontWeight: '500',
                                        color: 'var(--text-secondary)',
                                        padding: '0 16px'
                                    }}>
                                        Mostrar:
                                    </span>
                                    <div style={{
                                        display: 'flex',
                                        flex: 1,
                                        gap: '6px',
                                        maxWidth: '250px'
                                    }}>
                                        <button
                                            onClick={() => setFilter('all')}
                                            style={{
                                                flex: 1,
                                                padding: '10px 16px',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                whiteSpace: 'nowrap',
                                                background: filter === 'all' ? 'var(--primary-500)' : 'transparent',
                                                color: filter === 'all' ? 'white' : 'var(--text-secondary)',
                                                border: 'none',
                                                borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            <FiInbox size={16} />
                                            <span>TODOS</span>
                                        </button>
                                        <button
                                            onClick={() => setFilter('unread')}
                                            style={{
                                                flex: 1,
                                                padding: '10px 16px',
                                                fontSize: '14px',
                                                fontWeight: '600',
                                                whiteSpace: 'nowrap',
                                                background: filter === 'unread' ? 'var(--primary-500)' : 'transparent',
                                                color: filter === 'unread' ? 'white' : 'var(--text-secondary)',
                                                border: 'none',
                                                borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            <FiBell size={16} />
                                            <span>NO LEÍDOS</span>
                                            {unreadCount > 0 && filter !== 'unread' && (
                                                <span style={{
                                                    fontSize: '12px',
                                                    background: 'var(--danger-500)',
                                                    color: 'white',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    minWidth: '20px'
                                                }}>
                                                    {unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* MOBILE TABS */}
                        <div className="show-mobile" style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            padding: '12px 12px 8px 12px'
                        }}>
                            {/* Tabs horizontales para móvil */}
                            <div style={{
                                display: 'flex',
                                gap: '4px',
                                background: 'var(--surface-elevated)',
                                padding: '4px',
                                borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--surface-border)'
                            }}>
                                <button
                                    className={`mobile-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
                                    onClick={() => { setActiveTab('inbox'); setFilter('all'); }}
                                    style={{
                                        flex: 1,
                                        padding: '8px 12px',
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        background: activeTab === 'inbox' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'inbox' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <FiInbox size={14} />
                                    <span>Recibidos</span>
                                    {unreadCount > 0 && (
                                        <span style={{
                                            width: '6px',
                                            height: '6px',
                                            background: activeTab === 'inbox' ? 'white' : 'var(--danger-500)',
                                            borderRadius: '50%'
                                        }} />
                                    )}
                                </button>
                                <button
                                    className={`mobile-nav-item ${activeTab === 'sent' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('sent')}
                                    style={{
                                        flex: 1,
                                        padding: '8px 12px',
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        background: activeTab === 'sent' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'sent' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <FiSend size={14} />
                                    <span>Enviados</span>
                                </button>
                                <button
                                    className={`mobile-nav-item ${activeTab === 'archived' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('archived')}
                                    style={{
                                        flex: 1,
                                        padding: '8px 12px',
                                        fontSize: '13px',
                                        whiteSpace: 'nowrap',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        background: activeTab === 'archived' ? 'var(--primary-500)' : 'transparent',
                                        color: activeTab === 'archived' ? 'white' : 'var(--text-muted)',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <FiArchive size={14} />
                                    <span>Archivados</span>
                                </button>
                            </div>

                            {/* Filtros para inbox - SOLO CUANDO ESTÁ EN RECIBIDOS - MÓVIL */}
                            {activeTab === 'inbox' && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    background: 'var(--surface-elevated)',
                                    padding: '6px',
                                    borderRadius: 'var(--radius-lg)',
                                    border: '1px solid var(--surface-border)'
                                }}>
                                    <span style={{
                                        fontSize: '13px',
                                        fontWeight: '500',
                                        color: 'var(--text-secondary)',
                                        padding: '0 12px'
                                    }}>
                                        Mostrar:
                                    </span>
                                    <div style={{
                                        display: 'flex',
                                        flex: 1,
                                        gap: '4px',
                                        maxWidth: '200px'
                                    }}>
                                        <button
                                            onClick={() => setFilter('all')}
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                fontSize: '13px',
                                                fontWeight: '600',
                                                whiteSpace: 'nowrap',
                                                background: filter === 'all' ? 'var(--primary-500)' : 'transparent',
                                                color: filter === 'all' ? 'white' : 'var(--text-secondary)',
                                                border: 'none',
                                                borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            <FiInbox size={14} />
                                            <span>TODOS</span>
                                        </button>
                                        <button
                                            onClick={() => setFilter('unread')}
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                fontSize: '13px',
                                                fontWeight: '600',
                                                whiteSpace: 'nowrap',
                                                background: filter === 'unread' ? 'var(--primary-500)' : 'transparent',
                                                color: filter === 'unread' ? 'white' : 'var(--text-secondary)',
                                                border: 'none',
                                                borderRadius: 'var(--radius-md)',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px'
                                            }}
                                        >
                                            <FiBell size={14} />
                                            <span>NO LEÍDOS</span>
                                            {unreadCount > 0 && filter !== 'unread' && (
                                                <span style={{
                                                    fontSize: '11px',
                                                    background: 'var(--danger-500)',
                                                    color: 'white',
                                                    padding: '2px 6px',
                                                    borderRadius: '10px',
                                                    minWidth: '18px'
                                                }}>
                                                    {unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Messages List */}
                        <div className="inbox-messages" style={{ paddingTop: '0' }}>
                            {loading ? (
                                <div className="inbox-empty">
                                    <div className="spinner" />
                                </div>
                            ) : filteredMessages.length === 0 ? (
                                <div className="inbox-empty">
                                    <FiInbox size={48} />
                                    <p>No hay mensajes</p>
                                </div>
                            ) : (
                                filteredMessages.map((message) => (
                                    <div
                                        key={message.messageId}
                                        className={`inbox-message-item ${!message.read ? 'unread' : ''} ${selectedMessage?.messageId === message.messageId ? 'selected' : ''}`}
                                        onClick={() => handleOpenMessage(message)}
                                    >
                                        <div className="inbox-message-icon">
                                            {getTypeIcon(message.type)}
                                        </div>
                                        <div className="inbox-message-content">
                                            <div className="inbox-message-header">
                                                <span className="inbox-message-sender">
                                                    {activeTab === 'sent' && (message as InboxMessage & { recipientCount?: number }).recipientCount && (message as InboxMessage & { recipientCount?: number }).recipientCount! > 1
                                                        ? `Para: ${(message as InboxMessage & { recipientCount?: number }).recipientCount} destinatarios`
                                                        : `De: ${message.senderName || 'Desconocido'}`}
                                                </span>
                                                <span className="inbox-message-time">{formatDate(message.createdAt)}</span>
                                            </div>
                                            <div className="inbox-message-subject">{message.subject || '(Sin asunto)'}</div>
                                            <div className="inbox-message-preview">
                                                {message.content
                                                    ? `${message.content.substring(0, 80)}${message.content.length > 80 ? '…' : ''}`
                                                    : 'Sin contenido'}
                                            </div>
                                        </div>
                                        {message.priority !== 'normal' && (
                                            <span className={`badge ${getPriorityBadge(message.priority)}`}>
                                                {getPriorityLabel(message.priority)}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Message Detail */}
                    {selectedMessage && (
                        <div className="inbox-detail desktop-only">
                            <div className="inbox-detail-header">
                                <button className="btn btn-ghost btn-sm" onClick={() => setSelectedMessage(null)}>
                                    <FiChevronLeft />
                                </button>
                                <div className="inbox-detail-actions">
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleArchive(selectedMessage.messageId)} title="Archivar">
                                        <FiArchive />
                                    </button>
                                    <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(selectedMessage.messageId)} title="Eliminar">
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
                .inbox-container {
                    display: grid;
                    grid-template-columns: 1fr;
                    /* Limita la fila a la altura del contenedor para que las columnas
                       (lista y detalle) puedan hacer scroll interno en vez de crecer. */
                    grid-template-rows: minmax(0, 1fr);
                    gap: var(--space-4);
                    height: calc(100vh - var(--header-height) - var(--space-12));
                    background: var(--surface-card);
                    border-radius: var(--radius-xl);
                    border: 1px solid var(--surface-border);
                    overflow: hidden;
                }

                .inbox-sidebar {
                    padding: var(--space-4);
                    border-right: 1px solid var(--surface-border);
                    display: flex;
                    flex-direction: column;
                }

                .inbox-nav {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-1);
                }

                .inbox-nav-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-3);
                    padding: var(--space-3);
                    border-radius: var(--radius-md);
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: left;
                    width: 100%;
                }

                .inbox-nav-item:hover {
                    background: var(--surface-hover);
                }

                .inbox-nav-item.active {
                    background: var(--primary-500);
                    color: white;
                }

                .inbox-badge {
                    margin-left: auto;
                    background: var(--danger-500);
                    color: white;
                    font-size: 11px;
                    font-weight: 600;
                    padding: 2px 8px;
                    border-radius: var(--radius-full);
                }

                .inbox-filters {
                    margin-top: var(--space-6);
                    padding-top: var(--space-4);
                    border-top: 1px solid var(--surface-border);
                }

                .inbox-filters h4 {
                    font-size: var(--text-xs);
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: var(--space-2);
                }

                .inbox-filter-item {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    padding: var(--space-2);
                    cursor: pointer;
                    font-size: var(--text-sm);
                }

                .inbox-list {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    width: 100%;
                    min-height: 0;
                }

                .inbox-list-header {
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    display: flex;
                    gap: var(--space-3);
                    align-items: center;
                }

                .inbox-search {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    background: var(--surface-elevated);
                    padding: var(--space-2) var(--space-3);
                    border-radius: var(--radius-md);
                }

                .inbox-search input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    outline: none;
                    color: var(--text-primary);
                }

                .inbox-messages {
                    flex: 1;
                    overflow-y: auto;
                    width: 100%;
                    min-height: 0;
                }

                .inbox-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-muted);
                    gap: var(--space-3);
                }

                .inbox-message-item {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--space-3);
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .inbox-message-item:hover {
                    background: var(--surface-hover);
                }

                .inbox-message-item.selected {
                    background: var(--surface-elevated);
                }

                .inbox-message-item.unread {
                    background: rgba(76, 175, 80, 0.05);
                }

                .inbox-message-item.unread .inbox-message-subject {
                    font-weight: 700;
                }

                .inbox-message-icon {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .inbox-message-content {
                    flex: 1;
                    min-width: 0;
                }

                .inbox-message-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: var(--space-1);
                }

                .inbox-message-sender {
                    font-size: var(--text-sm);
                    font-weight: 500;
                }

                .inbox-message-time {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                }

                .inbox-message-subject {
                    font-size: var(--text-sm);
                    margin-bottom: var(--space-1);
                }

                .inbox-message-preview {
                    font-size: var(--text-xs);
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

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
                    padding: var(--space-4);
                    border-bottom: 1px solid var(--surface-border);
                }

                .inbox-detail-actions {
                    display: flex;
                    gap: var(--space-2);
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

                /* Filtros de la lista (temporalidad + clasificación) */
                .inbox-toolbar-filters {
                    display: flex;
                    gap: var(--space-2);
                    padding: var(--space-2) var(--space-4) 0 var(--space-4);
                    flex-wrap: wrap;
                }

                .inbox-toolbar-filter {
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                    flex: 1;
                    min-width: 160px;
                    color: var(--text-muted);
                }

                .inbox-toolbar-filter > div {
                    flex: 1;
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

                .show-mobile { display: none !important; }
                .desktop-only { display: flex !important; }
                .inbox-sidebar.desktop-only { display: flex !important; }
                .show-mobile-only { display: none !important; }

                /* DESKTOP: Cuando hay mensaje seleccionado, mostramos 2 columnas */
                @media (min-width: 1025px) {
                    .inbox-container.has-selection {
                        grid-template-columns: 1fr 400px;
                    }
                    
                    .inbox-detail.desktop-only {
                        display: flex;
                    }
                }

                @media (max-width: 1024px) {
                    .show-mobile { display: flex !important; }
                    .desktop-only { display: none !important; }
                    .inbox-container {
                        grid-template-columns: 1fr;
                        height: calc(100vh - var(--header-height) - 140px);
                        margin-bottom: var(--space-4);
                    }
                    
                    .inbox-sidebar {
                        display: none !important;
                    }
                    
                    .inbox-container.has-selection .inbox-list {
                        display: none;
                    }
                    
                    .inbox-container.has-selection .inbox-detail {
                        display: flex !important;
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        z-index: 10;
                        background: var(--surface-card);
                        border-left: none;
                    }

                    .inbox-list-header {
                        padding: var(--space-3);
                        flex-direction: column !important;
                        gap: var(--space-3) !important;
                    }
                    
                    .inbox-search {
                        width: 100% !important;
                        order: 2;
                    }
                    
                    .mobile-nav-container {
                        order: 1;
                        width: 100%;
                    }
                }

                @media (max-width: 640px) {
                    .hide-mobile { display: none !important; }
                    .show-mobile-only { display: inline !important; }
                    
                    .inbox-list-header {
                        padding: var(--space-2) !important;
                    }
                    
                    .inbox-search {
                        width: 100%;
                    }
                    
                    .inbox-message-item {
                        padding: var(--space-3);
                    }
                    
                    .inbox-message-preview {
                        width: 100%;
                    }
                    
                    .page-header-actions {
                        flex-direction: column;
                        gap: var(--space-2);
                    }
                    
                    .page-header-actions .btn {
                        width: 100%;
                        justify-content: center;
                    }
                }
            `}</style>
        </>
    );
}
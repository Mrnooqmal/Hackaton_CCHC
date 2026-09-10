import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { activitiesApi, documentsApi, incidentsApi, obrasApi, uploadsApi, workersApi, signatureRequestsApi, tenantsApi, surveysApi } from '../api/client';
import { abrirDocumentoFirmable as abrirDocumentoFirmableCompartido, resolverDocumentoFirmable } from '../utils/documentoFirmado';
import { publicarNuevaVersion } from '../utils/versionarDocumento';
import { caducidadPorDefecto, tiempoRelativo, revisionVencida, MESES_VIGENCIA_DEFECTO } from '../utils/vigenciaDocumento';
import { ultimaDifusion, descripcionDifusion } from '../utils/difusion';
import { estadoDuracion } from '../utils/reporteActividad';
import ObraAplicabilidadKit from '../components/ObraAplicabilidadKit';
import ObraPlantillasOnboarding from '../components/ObraPlantillasOnboarding';
import { estadoPtp, aprobadoPorRepresentanteLegal, etiquetaEstadoPtp } from '../utils/ptp';
import { incidenteAbierto, incidenteCerrado } from '../utils/incidentes';
import { LuFileText, LuUsers, LuShieldAlert, LuPencil, LuUserPlus, LuClock, LuChevronUp, LuChevronDown, LuCircleCheck, LuDownload, LuSettings, LuEllipsisVertical, LuHistory } from 'react-icons/lu';
import { FiUploadCloud, FiEye, FiAlertTriangle, FiCopy, FiCheck, FiChevronRight } from 'react-icons/fi';
import { Modal, Select, SegmentedControl, PageHeader } from '../components/ui';
import { DS44_ACT_ACTUALIZACIONES, DS44_ACT_DOCS, DS44_CHECK_DOCS, DS44_DO_PROCEDIMIENTOS, DS44_DO_CAPACITACIONES, DS44_DO_REGISTROS_GESTION, DS44_DO_REGISTROS_EJECUCION, esRegistroEjecucion, DS44_REQUIEREN_DIFUSION, DS44_DO_EVENTOS, evalAplicabilidad, DS44_ONBOARDING_ITEMS, DS44_PHASE_LABELS, DS44_PLAN_DOCS, resolveCargoKit, normalizeCargoCodigo, unionKits, getCargoLabel, type Ds44DoContext, type Ds44DoElemento } from '../utils/ds44';

// Roles de gestión/staff que NO entran al onboarding de terreno (espejo del backend).
const ROLES_GESTION_ONBOARDING = new Set(['admin', 'jefe_obra', 'supervisor', 'prevencionista', 'relator']);
const esRolGestion = (rol?: string): boolean => {
  const n = String(rol || '').toLowerCase().trim().replace(/\s+/g, '_');
  const canon = n === 'administrador' ? 'admin' : (n === 'jefe_de_obra' ? 'jefe_obra' : (n === 'colaborador' ? 'trabajador' : n));
  return ROLES_GESTION_ONBOARDING.has(canon);
};
import { useCargoCatalog } from '../hooks/useCargoCatalog';
import { useObraContext } from '../context/ObraContext';
import FirmaAsistidaModal from '../components/FirmaAsistidaModal';
import EstructuraPreventivaPanel from '../components/EstructuraPreventivaPanel';
import CompletitudFufPanel from '../components/CompletitudFufPanel';
import { completitudDeFase } from '../utils/completitudObra';
import { colorProgreso } from '../utils/completitud';
import { AMBITO as AMBITO_ESTRUCTURA } from '../utils/estructuraPreventiva';
import DocumentPreviewModal from '../components/DocumentPreviewModal';
import type { SignatureRequest, DocumentVersion, Document as DocumentoApi, EntidadRevision } from '../api/client';

/** Una entrada del historial: las archivadas más la vigente, marcada como tal. */
type VersionHistorial = DocumentVersion & { actual: boolean };
import { PERMISSIONS } from '../permissions';

// FUF 51 / Art. 57 inc. 5: órganos que pueden participar en la revisión de un
// documento (Reglamento Interno, MIPER, procedimientos). Se registran al publicar
// una nueva versión y quedan en el historial de cambios.
const ENTIDADES_REVISION: { id: EntidadRevision; label: string }[] = [
  { id: 'DEPTO_PREVENCION', label: 'Departamento de Prevención de Riesgos' },
  { id: 'COMITE_PARITARIO', label: 'Comité Paritario de Higiene y Seguridad' },
  { id: 'DELEGADO_SST', label: 'Delegado de Seguridad y Salud en el Trabajo' },
  { id: 'SINDICATO', label: 'Organización sindical' },
];
const labelEntidadRevision = (id: string) =>
  ENTIDADES_REVISION.find((e) => e.id === id)?.label || id;

interface Ds44Item {
  key: string;
  tipos: string[];
  titulo: string;
  estadoFirma?: string;
  documentId?: string;
  archivoSubido: boolean;
  document?: any;
  /** Todos los documentos que cubren el requisito. Uno solo, salvo en los
   *  requisitos `multiple` (los planes de emergencia). */
  documentos?: any[];
  multiple?: boolean;
  /** Documento que se gestiona EXCLUSIVAMENTE a nivel empresa (Onboarding):
   *  no se sube por obra, la obra solo refleja el estado corporativo. */
  tenantLevel?: boolean;
  /** El requisito está cubierto por el documento corporativo subido en Onboarding
   *  (1 documento para todas las obras). */
  fromEmpresa?: boolean;
  empresaPlantilla?: { fileKey: string; nombre?: string; subidoEn?: string };
}

// Documentos base que viven a NIVEL EMPRESA (Onboarding) y se comparten entre
// todas las obras. No se vuelven a subir por obra: la obra hereda el corporativo.
const TENANT_LEVEL_PLAN_KEYS = new Set(['POLITICA_SSO', 'REGLAMENTO_INTERNO']);

// Extrae las plantillas corporativas (por tipo de documento) del catálogo de
// cargos del tenant. Estas plantillas son las que se suben en /cargos-onboarding.
const extractEmpresaDocs = (cargos: any[]): Record<string, { fileKey: string; nombre?: string; subidoEn?: string }> => {
  const out: Record<string, { fileKey: string; nombre?: string; subidoEn?: string }> = {};
  for (const c of cargos || []) {
    for (const it of (c?.kit || [])) {
      const fileKey = it?.plantilla?.fileKey;
      if (fileKey && it?.tipo && !out[it.tipo]) {
        out[it.tipo] = { fileKey, nombre: it.plantilla.nombre, subidoEn: it.plantilla.subidoEn };
      }
    }
  }
  return out;
};

// Tipos de documento que son procedimientos de obra (DS 44): actualizar su
// archivo publica una NUEVA VERSIÓN (notifica a la línea de mando + re-firma).
// Espejo de TIPOS_PROCEDIMIENTO en Backend/handlers/documents/handler.js.
// Los tipos que NO salen de DS44_DO_PROCEDIMIENTOS van listados a mano: la MIPER
// es un documento de la fase PLAN, pero el Art. 7 inc. 9 le exige el mismo ciclo
// de revisión (re-informar y re-firmar), así que se versiona igual que un
// procedimiento. 'MATRIZ_MIPPER' es su alias histórico.
const TIPOS_PROCEDIMIENTO = new Set<string>([
  ...DS44_DO_PROCEDIMIENTOS.map((el) => el.tipo),
  'PROCEDIMIENTO_TRABAJO',
  'MIPER',
  'MATRIZ_MIPPER',
  // Art. 57 inc. 5: revisión anual con participación del comité o del delegado.
  // El FUF 51 pide el control de cambios, que es exactamente el versionado.
  'REGLAMENTO_INTERNO',
]);
const esProcedimiento = (tipo?: string): boolean => !!tipo && TIPOS_PROCEDIMIENTO.has(tipo);

/**
 * ¿Reemplazar el archivo de este documento de la fase PLAN publica una versión?
 * Solo si el tipo es versionable y el documento YA existe con archivo: la primera
 * subida es una actualización normal (sigue en v1), no una v2 sin predecesora.
 * El tipo se lee del documento guardado, para que los alias históricos
 * (MATRIZ_MIPPER) se comporten igual que el actual.
 */
const ds44EsVersionable = (
  doc: { documentId?: string; tipos: string[] } | null,
  detalle: { tipo?: string; s3Key?: string; archivoUrl?: string } | null,
): boolean => {
  if (!doc?.documentId) return false;
  if (!detalle?.s3Key && !detalle?.archivoUrl) return false;
  return esProcedimiento(detalle?.tipo || doc.tipos[0]);
};

// Construye la lista de documentos base de la obra reconciliando:
//  1) documentos propios de la obra (clasificacion 'obra'), y
//  2) documentos corporativos heredados (Política SST, Reglamento Interno).
const buildDs44PlanDocs = (
  docsObra: any[],
  empresaDocs: Record<string, { fileKey: string; nombre?: string; subidoEn?: string }>,
): Ds44Item[] =>
  DS44_PLAN_DOCS.map((required) => {
    // Documentos corporativos: fuente única en Onboarding. No se suben por obra;
    // la obra refleja el estado de empresa (presente / falta en empresa).
    if (TENANT_LEVEL_PLAN_KEYS.has(required.key)) {
      const emp = required.tipos.map((t) => empresaDocs[t]).find(Boolean);
      return { ...required, tenantLevel: true, archivoSubido: Boolean(emp), fromEmpresa: Boolean(emp), empresaPlantilla: emp };
    }
    // PLAN_EMERGENCIAS existe en las dos fases con el mismo `tipo`: sin filtrar
    // por fase, el plan de la fase HACER daba por cumplido el de PLAN y viceversa.
    // Los documentos antiguos sin `fase` se consideran de PLAN, que es donde vivían.
    const coincidencias = docsObra.filter(
      (doc: DocumentoApi) => required.tipos.includes(doc.tipo) && (!doc.fase || doc.fase === 'plan'),
    );
    const existing = coincidencias[0];
    const hasFile = coincidencias.some((d: DocumentoApi) => d.s3Key || d.archivoUrl);
    return {
      ...required,
      documentId: existing?.documentId,
      archivoSubido: hasFile,
      document: existing,
      documentos: coincidencias,
    };
  });

// Tipos que son requisito de la fase PLAN. Sirven para desambiguar los
// documentos antiguos que se guardaron sin `fase`: si su tipo es un requisito
// de PLAN, pertenecen a PLAN; si no, son de la fase HACER.
const TIPOS_FASE_PLAN = new Set(DS44_PLAN_DOCS.flatMap((d) => d.tipos));

const esDocumentoDeFaseHacer = (doc: { fase?: string | null; tipo?: string }): boolean =>
  doc.fase === 'hacer' || (!doc.fase && !TIPOS_FASE_PLAN.has(doc.tipo || ''));

interface DoItem {
  key: string;
  tipos: string[];
  titulo: string;
  descripcion: string;
  articulo: string;
  estadoFirma: string;
  documentId?: string;
  archivoSubido: boolean;
  document?: any;
}

/**
 * Acciones secundarias de una fila. Cada documento tiene hasta cuatro acciones,
 * pero solo una es la habitual (ver o subir); el resto vive acá para que la lista
 * se lea como un checklist de cumplimiento y no como una botonera.
 */
/** Ancho del panel y alto aproximado de cada opción, para decidir si abre hacia abajo. */
const MENU_ANCHO = 208;
const MENU_ALTO_ITEM = 36;
const MENU_MARGEN = 8;

function RowMenu({ label, items }: { label: string; items: { label: string; onClick: () => void }[] }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // El panel se posiciona en coordenadas de viewport (position: fixed) y no
  // relativo a la fila: las filas viven dentro de un contenedor con
  // `overflow: auto`, que recorta a cualquier descendiente absoluto por mucho
  // z-index que tenga. Es la razón por la que el menú de las últimas filas
  // quedaba cortado bajo el borde del scroll.
  const abrir = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const alto = items.length * MENU_ALTO_ITEM + MENU_MARGEN;
    const cabeAbajo = r.bottom + alto + MENU_MARGEN <= window.innerHeight;
    setPos({
      // Si no cabe abajo se despliega hacia arriba, anclado al borde superior.
      top: cabeAbajo ? r.bottom + 4 : Math.max(MENU_MARGEN, r.top - alto - 4),
      // Alineado a la derecha del botón, sin salirse por ninguno de los lados.
      left: Math.max(
        MENU_MARGEN,
        Math.min(r.right - MENU_ANCHO, window.innerWidth - MENU_ANCHO - MENU_MARGEN),
      ),
    });
    setAbierto(true);
  };

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    const porTecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    // Al hacer scroll el panel quedaría flotando lejos de su fila; se cierra en
    // vez de reposicionarse, que es lo que se espera de un menú de fila.
    // `capture` para enterarse también del scroll del contenedor interno.
    window.addEventListener('scroll', cerrar, true);
    window.addEventListener('resize', cerrar);
    window.addEventListener('keydown', porTecla);
    return () => {
      window.removeEventListener('scroll', cerrar, true);
      window.removeEventListener('resize', cerrar);
      window.removeEventListener('keydown', porTecla);
    };
  }, [abierto]);

  if (items.length === 0) return null;

  return (
    <div className="ds44-menu">
      <button
        ref={triggerRef}
        type="button"
        className="ds44-menu-trigger"
        aria-label={label}
        aria-expanded={abierto}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
      >
        <LuEllipsisVertical size={16} />
      </button>
      {abierto && pos && (
        <>
          <div className="ds44-menu-scrim" onClick={() => setAbierto(false)} />
          <div className="ds44-menu-panel" role="menu" style={{ top: pos.top, left: pos.left }}>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => { setAbierto(false); item.onClick(); }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Un documento dentro de un requisito que admite varios, ya formateado. */
interface DocResumen {
  documentId: string;
  titulo: string;
  meta: string;
  badgeClass: string;
  badgeLabel: string;
  onVer: () => void;
  acciones: { label: string; onClick: () => void }[];
}

/**
 * Requisito que se cumple con uno o varios documentos (los planes de emergencia).
 *
 * Sigue siendo UNA línea del checklist: lo que cambia es que el recuento hace de
 * disclosure y despliega los documentos dentro del requisito. Así la lista no se
 * alarga con una fila por plan y se mantiene legible la pregunta que importa:
 * ¿está cubierto este requisito?
 */
function Ds44MultiRow({ titulo, meta, badgeClass, badgeLabel, singular, plural, documentos, agregarLabel, onAgregar }: {
  titulo: React.ReactNode;
  meta: React.ReactNode;
  badgeClass: string;
  badgeLabel: string;
  singular: string;
  plural: string;
  documentos: DocResumen[];
  agregarLabel: string;
  onAgregar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const n = documentos.length;

  return (
    <div className="ds44-multi">
      <div className="ds44-multi-head">
        <div style={{ minWidth: 0 }}>
          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{titulo}</div>
          <div className="text-muted ds44-doc-meta">{meta}</div>
        </div>
        <div className="ds44-doc-actions">
          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
          {n > 0 && (
            <button
              type="button"
              className="ds44-multi-toggle"
              aria-expanded={abierto}
              onClick={() => setAbierto((v) => !v)}
            >
              <LuChevronDown size={14} aria-hidden="true" />
              {n} {n === 1 ? singular : plural}
            </button>
          )}
          <button
            type="button"
            className={n > 0 ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
            onClick={onAgregar}
          >
            {n > 0 ? agregarLabel : 'Subir'}
          </button>
        </div>
      </div>

      {abierto && n > 0 && (
        <ul className="ds44-multi-lista">
          {documentos.map((d) => (
            <li key={d.documentId} className="ds44-multi-item">
              <div className="ds44-multi-nombre">
                <div className="ds44-multi-titulo">{d.titulo}</div>
                <div className="ds44-multi-sub">{d.meta}</div>
              </div>
              <span className={`badge ${d.badgeClass}`}>{d.badgeLabel}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={d.onVer}>Ver</button>
              <RowMenu label={`Más acciones de ${d.titulo}`} items={d.acciones} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ObraDetalle() {
  const { user, hasPermission } = useAuth();
  const { cargos: cargoCatalog } = useCargoCatalog();
  // Cargos de terreno seleccionables al asignar (excluye legacy de texto libre).
  const cargoOptions = cargoCatalog.filter((c) => !c.legacy).map((c) => ({ value: c.codigo, label: c.label }));
  const canAsignarTrabajadores = hasPermission(PERMISSIONS.OBRA_ASIGNAR_TRABAJADORES);
  const canSubirDocumentos = hasPermission(PERMISSIONS.OBRA_SUBIR_DOCUMENTOS);
  const canFirmaAsistida = hasPermission(PERMISSIONS.OBRA_FIRMA_ASISTIDA);
  const navigate = useNavigate();
  const { obraId } = useParams();
  const { setSelectedObraId } = useObraContext();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Atajo: agendar/asignar un ítem de onboarding precargado para una persona desde
  // el Equipo. Fija la obra activa y abre el flujo correspondiente con prefill.
  const agendarItem = (worker: any, item: any) => {
    if (obraId) setSelectedObraId(obraId);
    if (item.accion === 'ENCUESTA') {
      navigate('/surveys', { state: { prefill: { rut: worker.rut, nombre: worker.nombre, titulo: item.label, kitItemKey: item.key } } });
    } else {
      navigate('/activities', { state: { prefill: { obraId, personaId: worker.workerId, nombre: worker.nombre, subtipo: item.subtipo || 'OTRA', titulo: item.label, kitItemKey: item.key } } });
    }
  };

  const [loading, setLoading] = useState(true);
  const [obra, setObra] = useState<any | null>(null);
  const [trabajadores, setTrabajadores] = useState<any[]>([]);
  const [allWorkers, setAllWorkers] = useState<any[]>([]);
  const [documentosPrevencion, setDocumentosPrevencion] = useState<any[]>([]);
  const [incidentes, setIncidentes] = useState<any[]>([]);
  const [actividades, setActividades] = useState<any[]>([]);
  const [encuestas, setEncuestas] = useState<any[]>([]);
  const [obraSignatureRequests, setObraSignatureRequests] = useState<SignatureRequest[]>([]);
  const [ds44Docs, setDs44Docs] = useState<Ds44Item[]>([]);
  const [empresaDocsByTipo, setEmpresaDocsByTipo] = useState<Record<string, { fileKey: string; nombre?: string; subidoEn?: string }>>({});
  const [obraDocs, setObraDocs] = useState<any[]>([]); // documentos clasificacion 'obra' (incluye procedimientos DO)
  const [tenantSize, setTenantSize] = useState<number | null>(null); // cantidadTrabajadores de la entidad (condicionales DO)
  const [representanteLegal, setRepresentanteLegal] = useState<{ personaId?: string; nombre?: string | null } | null>(null);
  const [firmaAsistidaOpen, setFirmaAsistidaOpen] = useState(false);
  const [firmaAsistidaWorkerId, setFirmaAsistidaWorkerId] = useState<string | undefined>(undefined);
  const [firmaAsistidaTipo, setFirmaAsistidaTipo] = useState<string | undefined>(undefined);
  // Firma cruzada de relator (CAPACITACION_SST): el relator firma con su PIN
  const [relatorSign, setRelatorSign] = useState<{ documentId: string; titulo: string } | null>(null);
  const [relatorPin, setRelatorPin] = useState('');
  const [relatorModalidad, setRelatorModalidad] = useState('');
  const [relatorSaving, setRelatorSaving] = useState(false);
  const [relatorError, setRelatorError] = useState<string | null>(null);
  // Modal inline de creacion DO (procedimiento/evento => documento; capacitacion => actividad)
  const [doCreateModal, setDoCreateModal] = useState<{ mode: 'documento' | 'actividad'; el: any; existingDoc?: any } | null>(null);
  const [doCreateForm, setDoCreateForm] = useState<{ titulo: string; descripcion: string; fecha: string; relatorId: string; file: File | null; motivo: string }>({ titulo: '', descripcion: '', fecha: '', relatorId: '', file: null, motivo: '' });
  const [doCreateSaving, setDoCreateSaving] = useState(false);
  const [doCreateError, setDoCreateError] = useState<string | null>(null);
  const [savingObraFlag, setSavingObraFlag] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0); // bump para recargar datos de la obra
  const [obraToast, setObraToast] = useState<string | null>(null); // confirmacion breve de acciones inline
  const [checkConsolidado, setCheckConsolidado] = useState<any | null>(null);
  const [medidas, setMedidas] = useState<any | null>(null); // read-model medidas correctivas (ACT)
  const [loadingMedidas, setLoadingMedidas] = useState(false);
  const [savingMedida, setSavingMedida] = useState<string | null>(null);
  // Cierre de investigacion Art. 71 (genera informe firmado)
  const [cerrarInvModal, setCerrarInvModal] = useState<{ incidentId: string; descripcion: string } | null>(null);
  const [cerrarInvPin, setCerrarInvPin] = useState('');
  const [cerrarInvSaving, setCerrarInvSaving] = useState(false);
  const [cerrarInvError, setCerrarInvError] = useState<string | null>(null);
  const [cerrarInvResult, setCerrarInvResult] = useState<{ token: string; hash: string } | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [isDs44ModalOpen, setIsDs44ModalOpen] = useState(false);
  const [selectedDs44Doc, setSelectedDs44Doc] = useState<Ds44Item | null>(null);
  const [historialModal, setHistorialModal] = useState<{ titulo: string; versiones: VersionHistorial[] } | null>(null);
  const [docAEliminar, setDocAEliminar] = useState<{ documentId: string; titulo: string } | null>(null);
  const [ds44Titulo, setDs44Titulo] = useState('');
  // Motivo del cambio: obligatorio al reemplazar el archivo de un documento
  // versionable (hoy, la MIPER). Queda en el historial y en el aviso al mando.
  const [ds44Motivo, setDs44Motivo] = useState('');
  // FUF 51: participantes de la revisión que origina esta nueva versión.
  const [ds44Participantes, setDs44Participantes] = useState<EntidadRevision[]>([]);
  const [ds44ParticipantesDetalle, setDs44ParticipantesDetalle] = useState('');
  const [eliminandoDoc, setEliminandoDoc] = useState(false);
  const [docPreview, setDocPreview] = useState<{ url: string | null; name: string } | null>(null);
  const [selectedDs44Detail, setSelectedDs44Detail] = useState<any | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [selectedExpiryDate, setSelectedExpiryDate] = useState('');
  const [expiryApplicable, setExpiryApplicable] = useState(true);
  const [ds44Loading, setDs44Loading] = useState(false);
  const [ds44Saving, setDs44Saving] = useState(false);
  const [ds44Previewing, setDs44Previewing] = useState(false);
  const [pendingDs44File, setPendingDs44File] = useState<File | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);
  const [signatureModalDoc, setSignatureModalDoc] = useState<{ titulo: string; asignaciones: any[] } | null>(null);
  const [editData, setEditData] = useState<any | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isWorkersModalOpen, setIsWorkersModalOpen] = useState(false);
  const [updatingWorkers, setUpdatingWorkers] = useState<string | null>(null);
  const [selectedUnassignedWorkerIds, setSelectedUnassignedWorkerIds] = useState<string[]>([]);
  // Cargos elegidos por trabajador al asignarlo a la obra (multi-cargo). El cargo
  // de terreno vive en la asignación persona×obra, no en la persona.
  const [assignCargos, setAssignCargos] = useState<Record<string, string[]>>({});

  // Fase 2 (DO/HACER) state — modal DO listo para conectar cuando se agregue lista de docs DO
  const [doDocs] = useState<DoItem[]>([]);
  const [activatingFaseDeming, setActivatingFaseDeming] = useState(false);
  const [selectedDoDoc] = useState<DoItem | null>(null);
  const [selectedDoDetail] = useState<any | null>(null);
  const [isDoModalOpen, setIsDoModalOpen] = useState(false);
  const [doLoading] = useState(false);
  const [doSaving, setDoSaving] = useState(false);
  const [pendingDoFile, setPendingDoFile] = useState<File | null>(null);
  const [doExpiryDate, setDoExpiryDate] = useState('');
  const [doExpiryNotApplicable, setDoExpiryNotApplicable] = useState(false);
  const [doWorkerIds, setDoWorkerIds] = useState<string[]>([]);
  const [doPreviewing, setDoPreviewing] = useState(false);
  const doFileInputRef = useRef<HTMLInputElement | null>(null);
  const doCreateFileRef = useRef<HTMLInputElement | null>(null);
  const autoAdvanceRef = useRef<string | null>(null); // fase desde la que ya se auto-avanzó
  // Panel DO: workers expandidos
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [expandedCargos, setExpandedCargos] = useState<Set<string>>(new Set());
  const [expandedRegistros, setExpandedRegistros] = useState<Set<string>>(new Set());
  const [planToast, setPlanToast] = useState(false);
  // Modal de onboarding post-asignación
  const [onboardingUploadModal, setOnboardingUploadModal] = useState<{ show: boolean; addedWorkers: any[] } | null>(null);
  const [bulkUploadingTipo, setBulkUploadingTipo] = useState<string | null>(null);
  const [bulkUploadDone, setBulkUploadDone] = useState<Record<string, boolean>>({});
  // Registro AT/EP export
  const [registroSignModal, setRegistroSignModal] = useState(false);
  // Expediente consolidado (Art. 72 inc. 1 — puesta a disposición).
  const [expedienteLoading, setExpedienteLoading] = useState(false);
  const [exportingRegistro, setExportingRegistro] = useState(false);
  const [registroPin, setRegistroPin] = useState('');
  const [registroError, setRegistroError] = useState<string | null>(null);
  const [registroResult, setRegistroResult] = useState<{ documentId: string; token: string; hash: string } | null>(null);
  // Inline per-worker doc upload
  const [uploadingWorkerDoc, setUploadingWorkerDoc] = useState<string | null>(null); // `${workerId}:${tipo}`
  // Local override map so checklist updates immediately without full refetch

  const faseDeming = obra?.faseDeming || 'plan';
  const [selectedDemingPhase, setSelectedDemingPhase] = useState(faseDeming);
  const [activeTab, setActiveTab] = useState<'resumen' | 'ds44' | 'equipo'>('ds44');
  const [copiedId, setCopiedId] = useState(false);
  const handleCopyId = () => {
    // Copia el código que puso el creador; si la obra no tiene código, el ID interno.
    navigator.clipboard.writeText(obra?.codigo || obraId || '');
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  };

  const onboardingSummary = useMemo(() => {
    const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');
    if (!activeWorkers.length) {
      return { completed: 0, total: 0, progress: 0, byWorker: [] as any[] };
    }

    // Flujo secuencial por (persona, tipo): sin archivo (pendiente_asignar => Subir)
    // -> con archivo sin firmar (pendiente_firma => Firma asistida) -> firmado (completo).
    // "Completo" SOLO con firma real del trabajador. Si el documento exige firma
    // cruzada (CAPACITACION_SST), tambien debe estar firmado por el relator.
    const docSigned = new Map<string, boolean>();
    const docHasFile = new Map<string, boolean>();
    const docRelatorPendiente = new Map<string, boolean>();
    const docIdPorKey = new Map<string, string>();
    documentosPrevencion.forEach((doc) => {
      const hasFile = Boolean(doc.s3Key || doc.archivoUrl);
      const relatorPendiente = Boolean(doc.requiereFirmaRelator) && doc.firmaRelator?.estado !== 'firmado';
      (doc.asignaciones || []).forEach((asig: any) => {
        const personaId = asig.personaId;
        if (!personaId || !doc.tipo) return;
        const key = `${personaId}:${doc.tipo}`;
        if (!docIdPorKey.has(key)) docIdPorKey.set(key, doc.documentId);
        if (hasFile) docHasFile.set(key, true);
        if (relatorPendiente) docRelatorPendiente.set(key, true);
        if (asig.estado === 'firmado' || asig.fechaFirma) docSigned.set(key, true);
      });
    });

    const requestSigned = new Map<string, boolean>();
    const requestAssigned = new Map<string, boolean>();
    obraSignatureRequests.forEach((request) => {
      (request.trabajadores || []).forEach((trabajador) => {
        const workerId = trabajador.workerId;
        if (!workerId || !request.tipo) return;
        const key = `${workerId}:${request.tipo}`;
        requestAssigned.set(key, true);
        if (trabajador.firmado) requestSigned.set(key, true);
      });
    });

    // TRAZABILIDAD: ítems de onboarding cumplidos vía actividad o encuesta VINCULADA
    // (kitItemKey). Asistir a la actividad / responder la encuesta cierra el ítem.
    const kitDoneByLink = new Map<string, boolean>(); // `${personaId}:${kitItemKey}`
    const kitAssignedByLink = new Map<string, boolean>();
    actividades.forEach((act: any) => {
      if (!act.kitItemKey) return;
      (act.asistentesRequeridos || []).forEach((pid: string) => kitAssignedByLink.set(`${pid}:${act.kitItemKey}`, true));
      (act.asistentes || []).forEach((a: any) => {
        const pid = a.personaId || a.workerId;
        if (pid) kitDoneByLink.set(`${pid}:${act.kitItemKey}`, true);
      });
    });
    encuestas.forEach((survey: any) => {
      if (!survey.kitItemKey) return;
      (survey.recipients || []).forEach((r: any) => {
        const pid = r.personaId || r.workerId;
        if (!pid) return;
        kitAssignedByLink.set(`${pid}:${survey.kitItemKey}`, true);
        if (r.estado === 'respondida') kitDoneByLink.set(`${pid}:${survey.kitItemKey}`, true);
      });
    });

    let total = 0;
    let completed = 0;

    // Kit por código de cargo: del catálogo del tenant (con plantillas) y, si no,
    // de la semilla. El onboarding ahora se rige por el KIT del cargo, no por una
    // lista fija. Cada ítem se cierra con firma real (cruzada si aplica).
    const kitDeCargo = (codigo?: string): any[] => {
      if (!codigo) return [];
      const fromCatalog = cargoCatalog.find((c) => c.codigo === codigo)?.kit;
      return (fromCatalog && fromCatalog.length ? fromCatalog : resolveCargoKit(codigo)) as any[];
    };

    // Cargos que el trabajador ejecuta EN esta obra (asignación, multi-cargo).
    // Fallback al cargo legacy global por compatibilidad con personas sin migrar.
    const cargosEnObra = (worker: any): string[] => {
      const asig = (worker.asignaciones || []).find((a: any) => a.obraId === (obraId || ''));
      const raw = (asig && Array.isArray(asig.cargos) && asig.cargos.length)
        ? asig.cargos
        : (worker.cargo ? [worker.cargo] : []);
      // Normaliza a CÓDIGO de catálogo ("Carpintero" → CARPINTERO) para resolver el
      // kit real, igual que el backend. Dedup.
      return [...new Set(raw.map((c: string) => normalizeCargoCodigo(c)).filter(Boolean))] as string[];
    };
    const aplicabilidad = (obra?.aplicabilidadKit) || {};

    const byWorker = activeWorkers.map((worker) => {
      const workerId = worker.personaId;
      // Roles de gestión/staff no entran al onboarding de terreno (coherente con el
      // backend, que no genera sus documentos). Evita el ruido "admin 0/6".
      if (esRolGestion(worker.rol)) return null;
      const cargos = cargosEnObra(worker);
      // Unión de kits de todos los cargos de la persona en la obra (dedup + estricto).
      let kit: any[] = unionKits(cargos.map((c) => ({ cargo: c, kit: kitDeCargo(c) })));
      // Aplicabilidad MIPER (manual): excluir ítems marcados 'no_aplica' para TODOS
      // sus cargos de origen en esta obra (PR-PO excluidos según MIPER).
      kit = kit.filter((it: any) => !(it.cargosOrigen || []).every((cg: string) => aplicabilidad?.[cg]?.[it.key] === 'no_aplica'));
      // Sin cargo/kit (personal de oficina/gestión) → no entra al onboarding de terreno.
      if (!kit.length) return null;
      let workerTotal = 0;
      let workerCompleted = 0;
      const obraKey = obraId || '';
      const manualOverrides = obraKey ? (worker as any).onboardingDS44?.[obraKey]?.items || {} : {};

      const itemDetail = kit.map((item: any) => {
        const manualDone = Boolean(manualOverrides[item.tipo]);
        const key = `${workerId}:${item.tipo}`;
        const linkKey = `${workerId}:${item.key}`;
        // Señal unificada: documento del onboarding (incl. ENTREGA_EPP), solicitud de
        // firma del mismo tipo, o actividad/encuesta VINCULADA (kitItemKey) cumplida.
        const cumplidoPorLink = Boolean(kitDoneByLink.get(linkKey));
        const trabajadorFirmo = Boolean(docSigned.get(key)) || Boolean(requestSigned.get(key)) || cumplidoPorLink;
        const firmaRelatorPendiente = Boolean(docRelatorPendiente.get(key)) && !cumplidoPorLink;
        const tieneArchivoOAsignado = Boolean(docHasFile.get(key)) || Boolean(requestAssigned.get(key)) || Boolean(kitAssignedByLink.get(linkKey));

        let estado: 'pendiente_asignar' | 'pendiente_firma' | 'completo' = 'pendiente_asignar';
        if (trabajadorFirmo && !firmaRelatorPendiente) estado = 'completo';
        else if (trabajadorFirmo || tieneArchivoOAsignado) estado = 'pendiente_firma';
        if (manualDone) estado = 'completo';

        const done = estado === 'completo';
        workerTotal += 1;
        if (done) workerCompleted += 1;

        return {
          key: item.key, tipo: item.tipo, label: item.titulo, articulo: item.articulo || '',
          done, estado, firmaRelatorPendiente, trabajadorFirmo,
          documentId: docIdPorKey.get(key) || null,
          kind: 'document' as const,
          // Naturaleza del ítem: define el atajo (firmar doc, agendar capacitación, asignar encuesta).
          accion: item.accion || 'DIFUSION_FIRMA',
          subtipo: item.subtipo || null,
          bloqueante: Boolean(item.bloqueante)
        };
      });

      total += workerTotal;
      completed += workerCompleted;

      // "Apto para ingresar a terreno": todos los ítems bloqueantes completos.
      const bloqueantesPendientes = itemDetail.filter((i) => i.bloqueante && !i.done).length;

      return {
        workerId,
        rut: worker.rut,
        nombre: `${worker.nombre} ${worker.apellido || ''}`.trim(),
        cargo: cargos.length ? cargos.map((c) => getCargoLabel(c)).join(', ') : (worker.cargo || ''),
        fechaIngreso: (worker.obraIds || []).length > 0 ? (worker.createdAt || null) : null,
        completed: workerCompleted,
        total: workerTotal,
        bloqueantesPendientes,
        aptoTerreno: bloqueantesPendientes === 0,
        itemDetail
      };
    }).filter(Boolean) as any[];

    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, total, progress, byWorker };
  }, [documentosPrevencion, obraSignatureRequests, trabajadores, actividades, encuestas, obraId, cargoCatalog, obra]);

  // El onboarding se agrupa por cargo porque el kit DS44 es por cargo: dos
  // carpinteros tienen exactamente los mismos items, y en una obra con 40
  // personas la lista plana obligaba a bajar por decenas de filas identicas.
  // La clave es el `cargo` ya resuelto en byWorker (multi-cargo llega unido con
  // coma, y esa combinacion es su propio grupo porque su kit es la union).
  const onboardingPorCargo = useMemo(() => {
    // El tipo sale del propio read-model en vez de re-declararse: byWorker no
    // esta tipado y duplicar su forma aca solo crearia otra copia que mantener.
    type OnboardingWorker = (typeof onboardingSummary.byWorker)[number];
    const grupos = new Map<string, OnboardingWorker[]>();
    onboardingSummary.byWorker.forEach((w: OnboardingWorker) => {
      const cargo = w.cargo || 'Sin cargo asignado';
      if (!grupos.has(cargo)) grupos.set(cargo, []);
      grupos.get(cargo)!.push(w);
    });
    return [...grupos.entries()]
      .map(([cargo, workers]) => ({
        cargo,
        workers,
        completed: workers.reduce((n, w) => n + w.completed, 0),
        total: workers.reduce((n, w) => n + w.total, 0),
        sinApto: workers.filter((w) => !w.aptoTerreno).length,
      }))
      .sort((a, b) => a.cargo.localeCompare(b.cargo));
  }, [onboardingSummary]);

  const getSignatureStats = (doc: any) => {
    // Prefer obraSignatureRequests (live data) over doc.asignaciones (may be absent in list responses)
    if (doc?.documentId) {
      const req = obraSignatureRequests.find(
        (r: any) => r.referenciaId === doc.documentId || r.documentId === doc.documentId
      );
      if (req) {
        return { firmadas: req.totalFirmados, total: req.totalRequeridos, asignaciones: req.trabajadores || [] };
      }
    }
    const asignaciones = doc?.asignaciones || [];
    const firmadas = asignaciones.filter((asignacion: any) => asignacion.estado === 'firmado' || asignacion.fechaFirma).length;
    return { firmadas, total: asignaciones.length, asignaciones };
  };

  // ── FASE DO (HACER) — elementos clasificados por naturaleza ───────────────────
  // El % de cumplimiento de la obra se calcula SOLO sobre procedimientos +
  // capacitaciones aplicables + registro maestro Art.72. NO sobre el onboarding
  // ni sobre eventos sobrevinientes. Gating por firma: un elemento con firmantes
  // asignados pendientes NO cuenta como completo hasta que todas las firmas esten.
  // Dotación que gobierna TODA la aplicabilidad por tramo de esta pantalla.
  // Una sola fuente evita que dos condicionales del mismo umbral miren números
  // distintos y el sistema declare "no te aplica" sobre un tramo equivocado.
  const dotacionEntidad = tenantSize ?? trabajadores.filter((w) => w.estado !== 'inactivo').length;

  const doContext = useMemo<Ds44DoContext>(() => ({
    tamanoEntidad: dotacionEntidad,
    faenaCompartida: obra?.faenaCompartida,
    tieneMaquinaria: obra?.tieneMaquinaria,
    agentesFQB: obra?.agentesFQB,
  }), [dotacionEntidad, obra]);

  // Estado de un elemento-documento con gating por firma. Los documentos de esta
  // fase son los creados con `fase: 'hacer'`; ver la nota sobre PLAN_EMERGENCIAS
  // en buildDs44PlanDocs. Un requisito `multiple` reúne todos sus documentos y
  // queda pendiente mientras a alguno le falten firmas.
  const estadoDocumento = (tipo: string): { document: any; documentos: any[]; estado: 'faltante' | 'pendiente_firma' | 'completo'; firmadas: number; totalFirmas: number } => {
    const documentos = obraDocs.filter((d: DocumentoApi) => d.tipo === tipo && esDocumentoDeFaseHacer(d));
    const document = documentos[0];
    const stats = documentos.map((d: DocumentoApi) => getSignatureStats(d));
    const firmadas = stats.reduce((n, s) => n + s.firmadas, 0);
    const total = stats.reduce((n, s) => n + s.total, 0);
    let estado: 'faltante' | 'pendiente_firma' | 'completo';
    if (documentos.length === 0) estado = 'faltante';
    else if (total > 0 && firmadas < total) estado = 'pendiente_firma';
    else estado = 'completo';
    return { document, documentos, estado, firmadas, totalFirmas: total };
  };

  // Estado de un elemento-capacitacion leido de ActivitiesTable.
  // "completo" requiere actividad ejecutada con asistentes firmados.
  const estadoCapacitacion = (el: Ds44DoElemento): { matches: any[]; estado: 'faltante' | 'pendiente_firma' | 'completo' } => {
    const matches = actividades.filter((a: any) => {
      if (!(el.actividadTipos || []).includes(a.tipo)) return false;
      // Vincula por subtipo (preciso) o, como respaldo, por titulo exacto
      // (el modal pre-llena el titulo con el del elemento) para que funcione
      // aunque el backend aun no persista el subtipo.
      if (el.subtipo) return a.subtipo === el.subtipo || a.titulo === el.titulo;
      return true;
    });
    // Ejecutada = cerrada, con asistentes firmados Y con las horas que exige el
    // decreto declaradas y alcanzadas (FUF 18 y 23). Una capacitación de 8 horas
    // no acredita el Art. 16 si nadie declaró cuánto duró, aunque el acta esté
    // firmada por todos.
    //
    // Retrocompatible: las actividades anteriores a este bloque no tienen
    // `duracion` y `estadoDuracion` devuelve null; a esas no se les exige nada,
    // porque su incumplimiento sería del sistema y no de la obra.
    const ejecutada = matches.some((a: any) => {
      if (a.estado !== 'completada' || (a.asistentes?.length || 0) === 0) return false;
      const dur = estadoDuracion(a);
      return dur === null || dur.cumple === true;
    });
    const estado = ejecutada ? 'completo' : matches.length > 0 ? 'pendiente_firma' : 'faltante';
    return { matches, estado };
  };

  const doProcedimientos = useMemo(() =>
    DS44_DO_PROCEDIMIENTOS.map((el) => ({
      el,
      aplicabilidad: evalAplicabilidad(el.condicion, doContext),
      ...estadoDocumento(el.tipo),
    })), [doContext, obraDocs]);

  const doCapacitaciones = useMemo(() =>
    DS44_DO_CAPACITACIONES.map((el) => ({
      el,
      aplicabilidad: evalAplicabilidad(el.condicion, doContext),
      ...estadoCapacitacion(el),
    })), [doContext, actividades]);

  // Estado de un registro de ejecucion: la evidencia existe y, si el articulo le
  // pone plazo, la ocurrencia mas reciente sigue vigente. Se mira la fecha del
  // documento (cuando ocurrio el hecho), no la de subida: un acta de un simulacro
  // del año pasado subida hoy no renueva la vigencia.
  const estadoRegistroEjecucion = (el: Ds44DoElemento) => {
    const documentos = obraDocs
      .filter((d: DocumentoApi) => d.tipo === el.tipo && esDocumentoDeFaseHacer(d))
      .sort((a: DocumentoApi, b: DocumentoApi) => String(b.fecha || b.createdAt || '').localeCompare(String(a.fecha || a.createdAt || '')));
    const ultimo = documentos[0];
    const ultimaFecha = ultimo ? (ultimo.fecha || ultimo.createdAt || null) : null;
    const vencido = Boolean(el.vigenciaMeses && revisionVencida(ultimaFecha, el.vigenciaMeses));
    const estado: 'faltante' | 'vencido' | 'completo' =
      documentos.length === 0 ? 'faltante' : vencido ? 'vencido' : 'completo';
    return { documentos, ultimo, ultimaFecha, vencido, estado };
  };

  const doRegistrosEjecucion = useMemo(() =>
    DS44_DO_REGISTROS_EJECUCION.map((el) => ({
      el,
      aplicabilidad: evalAplicabilidad(el.condicion, doContext),
      ...estadoRegistroEjecucion(el),
    })), [doContext, obraDocs]);

  const doRegistros = useMemo(() =>
    DS44_DO_REGISTROS_GESTION
      .map((el) => ({ el, aplicabilidad: evalAplicabilidad(el.condicion, doContext) }))
      .filter((r) => r.aplicabilidad !== 'no_aplica'), [doContext]);

  const registroMaestroGenerado = useMemo(() =>
    obraDocs.some((d: any) => d.tipo === 'REGISTRO_AT_EP'), [obraDocs]);

  // % cumplimiento HACER: solo aplicables que cuentan + registro maestro.
  const doCumplimiento = useMemo(() => {
    const procCuenta = doProcedimientos.filter((p) => p.el.cuenta && p.aplicabilidad === 'aplica');
    const capCuenta = doCapacitaciones.filter((c) => c.el.cuenta && c.aplicabilidad === 'aplica');
    const ejecCuenta = doRegistrosEjecucion.filter((r) => r.el.cuenta && r.aplicabilidad === 'aplica');
    const total = procCuenta.length + capCuenta.length + ejecCuenta.length + 1; // +1 = registro maestro Art.72
    const completados =
      procCuenta.filter((p) => p.estado === 'completo').length +
      capCuenta.filter((c) => c.estado === 'completo').length +
      // Un registro vencido no cuenta: el Art. 19 exige el ensayo "al menos una
      // vez al año", asi que la evidencia del año pasado ya no acredita nada.
      ejecCuenta.filter((r) => r.estado === 'completo').length +
      (registroMaestroGenerado ? 1 : 0);
    const progress = total > 0 ? Math.round((completados / total) * 100) : 0;
    return { total, completados, progress };
  }, [doProcedimientos, doCapacitaciones, doRegistrosEjecucion, registroMaestroGenerado]);

  const indicadores = useMemo(() => {
    const pendientesFirma = obraSignatureRequests
      .filter((r) => ['pendiente', 'en_proceso'].includes(r.estado))
      .reduce((total, r) => total + (r.totalRequeridos - r.totalFirmados), 0);
    const ds44Pendientes = faseDeming === 'hacer'
      ? Math.max(onboardingSummary.total - onboardingSummary.completed, 0)
      : ds44Docs.filter((doc) => !doc.archivoSubido).length;
    const mesActual = new Date().toISOString().slice(0, 7);
    const actividadesMes = actividades.filter((act) => act.fecha?.startsWith(mesActual)).length;
    const incidentesAbiertos = incidentes.filter(incidenteAbierto).length;
    const ds44Label = faseDeming === 'hacer' ? 'Onboarding DS44 pendiente' : 'Documentos DS44 pendientes';

    return [
      { label: 'Firmas pendientes', value: String(pendientesFirma) },
      { label: ds44Label, value: String(ds44Pendientes) },
      { label: 'Actividades del mes', value: String(actividadesMes) },
      { label: 'Incidentes abiertos', value: String(incidentesAbiertos) }
    ];
  }, [obraSignatureRequests, ds44Docs, actividades, incidentes, faseDeming, onboardingSummary]);

  useEffect(() => {
    const loadData = async () => {
      if (!obraId) return;
      setLoading(true);
      try {
        // Fase 1 — crítico: obra + workers para mostrar la UI de inmediato
        const [obraRes, workersRes] = await Promise.all([
          obrasApi.getById(obraId),
          workersApi.list(),
        ]);

        const obraData = obraRes.success ? obraRes.data : null;
        setObra(obraData || null);

        const workers = workersRes.success && workersRes.data ? workersRes.data : [];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));

        setLoading(false); // UI visible aquí

        // Fase 2 — background paralelo: documentos, incidentes, actividades, firmas,
        // y catálogo de cargos (para heredar documentos corporativos de la obra).
        const tenantId = obraData?.tenantId || localStorage.getItem('tenant_id') || '';
        const [docsObraRes, docsPrevRes, docsEmpresaRes, incidentsRes, activitiesRes, sigRes, cargosRes, surveysRes] = await Promise.all([
          documentsApi.list({ obraId, clasificacion: 'obra' } as any),
          documentsApi.list({ obraId, clasificacion: 'diario' } as any),
          // Documentos de empresa (RI/Política) a nivel tenant: se cuentan en TODAS
          // las obras porque toda persona debe cumplirlos, aunque no sean por-obra.
          documentsApi.list({ clasificacion: 'empresa' } as any),
          incidentsApi.list(),
          activitiesApi.list(),
          signatureRequestsApi.list({ tenantId, obraId }),
          tenantsApi.getCargos(tenantId),
          surveysApi.list(),
        ]);

        const empresaDocs = extractEmpresaDocs(cargosRes.success && cargosRes.data ? cargosRes.data.cargos || [] : []);
        setEmpresaDocsByTipo(empresaDocs);

        const docsObra = docsObraRes.success && docsObraRes.data ? docsObraRes.data.documents || [] : [];
        setDs44Docs(buildDs44PlanDocs(docsObra, empresaDocs));
        setObraDocs(docsObra);

        const ds44Types = new Set([...DS44_ONBOARDING_ITEMS.map(i => i.tipo), ...DS44_PLAN_DOCS.flatMap(req => req.tipos)]);
        const empresaDocsList = docsEmpresaRes.success && docsEmpresaRes.data ? docsEmpresaRes.data.documents || [] : [];
        const candidatos = [
          ...(docsPrevRes.success && docsPrevRes.data ? docsPrevRes.data.documents || [] : [])
            .filter((d: any) => d.clasificacion === 'diario' || (!ds44Types.has(d.tipo) && d.clasificacion !== 'obra' && d.clasificacion !== 'trabajador')),
          // Documentos de empresa (tenant-level) — cuentan en la obra para cada persona.
          ...empresaDocsList,
        ];
        // Dedup por documentId (NO por tipo): cada persona tiene su propio documento
        // del mismo tipo; deduplicar por tipo perdía a todas las personas menos una.
        const uniqueDocsPrev: any[] = [];
        const seenIds = new Set();
        for (const doc of candidatos) {
          if (!seenIds.has(doc.documentId)) { seenIds.add(doc.documentId); uniqueDocsPrev.push(doc); }
        }
        setDocumentosPrevencion(uniqueDocsPrev);

        setIncidentes((incidentsRes.success && incidentsRes.data ? incidentsRes.data : []).filter((inc: any) => inc.obraId === obraId));
        setActividades((activitiesRes.success && activitiesRes.data ? activitiesRes.data.activities || [] : []).filter((act: any) => act.obraId === obraId));
        setEncuestas(surveysRes.success && surveysRes.data ? surveysRes.data.surveys || [] : []);
        if (sigRes.success && sigRes.data) setObraSignatureRequests(sigRes.data.requests || []);

        // Fase 3 — fire-and-forget: tamaño tenant (condicionales DO) y
        // representante legal (aprobación del programa de trabajo, Art. 8).
        tenantsApi.get(tenantId).then(res => {
          if (res.success && res.data) {
            setTenantSize((res.data as any).cantidadTrabajadores ?? null);
            setRepresentanteLegal(res.data.reglas?.representanteLegal || null);
          }
        }).catch(() => {});

      } catch (error) {
        console.error('Error loading obra detail:', error);
        setLoading(false);
      }
    };

    loadData();
  }, [obraId, reloadTick]);

  useEffect(() => {
    setSelectedDemingPhase(faseDeming);
  }, [faseDeming]);

  useEffect(() => {
    if (!obraToast) return;
    const t = setTimeout(() => setObraToast(null), 3500);
    return () => clearTimeout(t);
  }, [obraToast]);

  // ── Programa de Trabajo Preventivo (Art. 8) ────────────────────────────────
  // El PTP es un documento más del repositorio: se sube y se firma como los otros
  // cinco de la fase PLAN. Lo único que el sistema deriva son los dos hechos que
  // sí puede verificar sin leer el PDF — el plazo y quién lo firmó.

  // El documento MIPER vigente: de él sale la fecha con la que se mide el plazo.
  const miperDoc = useMemo(
    () => ds44Docs.find((d) => d.key === 'MIPER')?.document || null,
    [ds44Docs],
  );

  const ptpDoc = useMemo(
    () => ds44Docs.find((d) => d.key === 'PROGRAMA_TRABAJO_PREVENTIVO')?.document || null,
    [ds44Docs],
  );

  const ptpEstado = useMemo(() => estadoPtp(ptpDoc, miperDoc), [ptpDoc, miperDoc]);
  const ptpAprobado = useMemo(
    () => aprobadoPorRepresentanteLegal(ptpDoc, representanteLegal),
    [ptpDoc, representanteLegal],
  );

  // Estado real de cada actualización de la fase ACTUAR (FUF 8, 9 y 49).
  //
  // Esta sección era una lista estática de títulos con un botón: no decía si la
  // MIPER cambió, si el PTP quedó fuera de plazo ni hace cuánto no se revisa el
  // Reglamento — que es literalmente el reparo del FUF ("está en la fase ACTUAR
  // pero no lleva a nada"). Toda la lógica ya existía; solo no se consultaba acá.
  //
  // Sigue siendo repositorio: nada se genera. Se derivan hechos verificables sin
  // abrir el archivo — que el documento exista, su fecha, su versión y su firma.
  const actActualizaciones = useMemo(() =>
    DS44_ACT_ACTUALIZACIONES.map((act) => {
      const docs = obraDocs.filter((d: DocumentoApi) => d.tipo === act.tipoOrigen);
      const doc = docs[0] || null;
      const actualizadoEn = doc?.updatedAt || doc?.createdAt || null;

      // El PTP no se rige por un plazo de calendario sino por un hecho: que la
      // MIPER haya cambiado. Su estado ya lo deriva utils/ptp.ts.
      const esPtp = act.key === 'PTP';
      const vencidaPorPlazo = Boolean(act.revisionMeses && revisionVencida(actualizadoEn, act.revisionMeses));

      let estado: 'sin_documento' | 'vencida' | 'al_dia';
      if (!doc) estado = 'sin_documento';
      else if (esPtp) estado = ptpEstado.vencido ? 'vencida' : 'al_dia';
      else estado = vencidaPorPlazo ? 'vencida' : 'al_dia';

      return {
        act, doc, estado, actualizadoEn,
        // El Art. 8 exige que el PTP esté aprobado por el representante legal, y
        // esa aprobación es su firma real sobre el documento, no una casilla.
        aprobacionPendiente: esPtp && Boolean(doc) && !ptpAprobado,
        detalle: esPtp ? ptpEstado.detalle : null,
      };
    }), [obraDocs, ptpEstado, ptpAprobado]);


  const reloadDocs = useCallback(async () => {
    if (!obraId) return;
    const tenantId = localStorage.getItem('tenant_id') || '';
    const [docsObraRes, sigRes] = await Promise.all([
      documentsApi.list({ obraId, clasificacion: 'obra' } as any),
      signatureRequestsApi.list({ tenantId, obraId }),
    ]);
    if (docsObraRes.success && docsObraRes.data) {
      const docsObra = docsObraRes.data.documents || [];
      setDs44Docs(buildDs44PlanDocs(docsObra, empresaDocsByTipo));
      setObraDocs(docsObra);
    }
    if (sigRes.success && sigRes.data) {
      setObraSignatureRequests(sigRes.data.requests || []);
    }
  }, [obraId, empresaDocsByTipo]);

  const reloadActividades = useCallback(async () => {
    const res = await activitiesApi.list();
    if (res.success && res.data) {
      setActividades((res.data.activities || []).filter((a: any) => a.obraId === obraId));
    }
  }, [obraId]);

  // Recarga completa de la obra (documentos, asignaciones, firmas, etc.).
  const reloadObraData = useCallback(() => setReloadTick((t) => t + 1), []);

  // Firma cruzada: el relator firma el certificado de capacitacion con su PIN.
  const handleFirmaRelator = async () => {
    if (!relatorSign || !user?.personaId) return;
    if (!relatorPin || relatorPin.length < 4) { setRelatorError('Ingresa tu PIN para firmar.'); return; }
    setRelatorSaving(true);
    setRelatorError(null);
    try {
      const res = await documentsApi.sign(relatorSign.documentId, {
        personaId: user.personaId,
        tipoFirma: 'relator',
        pin: relatorPin,
        modalidad: relatorModalidad || undefined,
      });
      if (!res.success) {
        setRelatorError(res.error || 'No se pudo registrar la firma. Verifica tu PIN.');
        return;
      }
      setRelatorSign(null);
      setRelatorPin('');
      setObraToast('Firma de relator registrada.');
      reloadObraData();
    } catch (err) {
      console.error('Error firmando como relator:', err);
      setRelatorError('Error de conexion.');
    } finally {
      setRelatorSaving(false);
    }
  };

  // Read-model de medidas correctivas (Art. 71) — insumo de la Fase ACT.
  const loadMedidas = useCallback(async () => {
    if (!obraId) return;
    setLoadingMedidas(true);
    try {
      const res = await obrasApi.getMedidasCorrectivas(obraId);
      if (res.success && res.data) setMedidas(res.data);
    } catch (err) {
      console.error('Error cargando medidas correctivas:', err);
    } finally {
      setLoadingMedidas(false);
    }
  }, [obraId]);

  // Cargar medidas al entrar a la fase ACT.
  useEffect(() => {
    if (selectedDemingPhase === 'actuar' && medidas === null) loadMedidas();
  }, [selectedDemingPhase, medidas, loadMedidas]);

  // Avanza el estado de una medida correctiva (seguimiento ACT).
  const avanzarMedida = async (incidentId: string, numero: string | number, estado: 'pendiente' | 'en_proceso' | 'completada' | 'verificada') => {
    const key = `${incidentId}:${numero}`;
    setSavingMedida(key);
    try {
      const res = await incidentsApi.updateMedidaEstado(incidentId, numero, estado);
      if (res.success) {
        await loadMedidas();
        setObraToast('Medida correctiva actualizada.');
      }
    } catch (err) {
      console.error('Error actualizando medida:', err);
    } finally {
      setSavingMedida(null);
    }
  };

  // Cierra la investigacion (Art. 71): genera y firma el informe, lo guarda como
  // documento de la obra y marca el incidente como cerrado.
  const handleCerrarInvestigacion = async () => {
    if (!cerrarInvModal || !obraId) return;
    const firmanteId = user?.personaId;
    if (!firmanteId) { setCerrarInvError('No se pudo identificar al firmante.'); return; }
    if (!cerrarInvPin || cerrarInvPin.length < 4) { setCerrarInvError('Ingresa tu PIN para firmar el informe.'); return; }
    setCerrarInvSaving(true);
    setCerrarInvError(null);
    try {
      const res = await obrasApi.cerrarInvestigacion(obraId, cerrarInvModal.incidentId, {
        firmante: { personaId: firmanteId, pin: cerrarInvPin },
        metodo: 'PIN',
      });
      if (!res.success || !res.data) {
        setCerrarInvError(res.error || 'No se pudo cerrar la investigación. Verifica tu PIN.');
        return;
      }
      setCerrarInvResult(res.data);
      setCerrarInvPin('');
      reloadObraData();
    } catch (err) {
      console.error('Error cerrando investigación:', err);
      setCerrarInvError('Error de conexión.');
    } finally {
      setCerrarInvSaving(false);
    }
  };

  // Persiste un flag de la obra (faenaCompartida/tieneMaquinaria/agentesFQB) desde
  // la micro-pregunta de aplicabilidad. Resuelve la visibilidad sin volver a preguntar.
  const handleSetObraFlag = async (flag: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB', value: boolean) => {
    if (!obraId) return;
    setSavingObraFlag(flag);
    try {
      const res = await obrasApi.update(obraId, { [flag]: value } as any);
      const updated = res.success ? (res.data?.obra || res.data) : null;
      setObra((prev: any) => ({ ...(prev || {}), ...(updated || {}), [flag]: value }));
    } catch (err) {
      console.error('Error guardando flag de obra:', err);
    } finally {
      setSavingObraFlag(null);
    }
  };

  // Abre el modal inline pre-rellenado con los datos del elemento DO.
  const openDoCreate = (mode: 'documento' | 'actividad', el: any, existingDoc?: any) => {
    setDoCreateForm({
      titulo: existingDoc?.titulo || el.titulo || '',
      descripcion: existingDoc?.descripcion || '',
      // Al corregir un registro ya cargado se abre con SU fecha del hecho, no con
      // hoy: si no, editar el titulo movia la fecha sin que nadie lo pidiera.
      fecha: existingDoc?.fecha || new Date().toISOString().slice(0, 10),
      relatorId: '',
      file: null,
      motivo: '',
    });
    setDoCreateError(null);
    setDoCreateModal({ mode, el, existingDoc: existingDoc || null });
  };

  // Descarga el archivo de una versión concreta (historial) vía URL prefirmada.
  const descargarVersionArchivo = async (fileKey?: string | null) => {
    if (!fileKey) { alert('Esta versión no tiene archivo asociado.'); return; }
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) {
        window.open(res.data.downloadUrl, '_blank', 'noopener');
      } else {
        alert('No se pudo obtener el archivo de esa versión.');
      }
    } catch (err) {
      console.error('Error descargando versión:', err);
      alert('No se pudo obtener el archivo de esa versión.');
    }
  };

  // Crea inline el documento (procedimiento/evento) o la actividad (capacitacion).
  const submitDoCreate = async () => {
    if (!doCreateModal || !obraId || !obra) return;
    const { mode, el } = doCreateModal;
    if (!doCreateForm.titulo.trim()) { setDoCreateError('El título es obligatorio.'); return; }
    setDoCreateSaving(true);
    setDoCreateError(null);
    try {
      if (mode === 'actividad') {
        if (!doCreateForm.relatorId) { setDoCreateError('Selecciona un relator.'); setDoCreateSaving(false); return; }
        const tipoAct = el.activityTipo || 'CAPACITACION';
        const r = await activitiesApi.create({
          tipo: tipoAct,
          subtipo: tipoAct === 'CAPACITACION' ? el.subtipo : undefined,
          titulo: doCreateForm.titulo,
          fecha: doCreateForm.fecha, relatorId: doCreateForm.relatorId,
          obraId, tenantId: obra.tenantId,
        } as any);
        if (!r.success) { setDoCreateError(r.error || 'No se pudo crear la actividad.'); return; }
        await reloadActividades();
        setObraToast(el.activityTipo === 'SIMULACRO' ? 'Simulacro programado.' : 'Capacitación programada. Queda pendiente de firmas de asistencia.');
      } else {
        const existingDoc = doCreateModal.existingDoc;
        // Publicar nueva versión: procedimiento que YA tenía archivo + archivo nuevo.
        // (La primera subida sobre un doc sin archivo es una actualización normal, no v2.)
        // Exige motivo (auditoría) y dispara la notificación a la línea de mando.
        const yaTieneArchivo = Boolean(existingDoc?.s3Key || existingDoc?.archivoUrl);
        const esNuevaVersion = Boolean(existingDoc?.documentId) && yaTieneArchivo && Boolean(doCreateForm.file) && esProcedimiento(el.tipo);
        if (esNuevaVersion && !doCreateForm.motivo.trim()) {
          setDoCreateError('Indica el motivo del cambio para publicar la nueva versión.');
          setDoCreateSaving(false);
          return;
        }

        let s3Key: string | undefined;
        let archivoNombre: string | undefined;
        if (doCreateForm.file) {
          const up = await uploadsApi.getUploadUrl({
            fileName: doCreateForm.file.name, fileType: doCreateForm.file.type,
            fileSize: doCreateForm.file.size, categoria: 'obras', empresaId: obra.tenantId,
          });
          if (up.success && up.data) {
            await fetch(up.data.uploadUrl, { method: 'PUT', body: doCreateForm.file, headers: { 'Content-Type': doCreateForm.file.type } });
            await uploadsApi.confirmUpload({ fileKey: up.data.fileKey, fileName: doCreateForm.file.name, fileType: doCreateForm.file.type, fileSize: doCreateForm.file.size });
            s3Key = up.data.fileKey;
            archivoNombre = doCreateForm.file.name;
          }
        }

        const autorNombre = user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined;
        if (esNuevaVersion && s3Key) {
          const r = await publicarNuevaVersion({
            documentId: existingDoc.documentId,
            versionActual: existingDoc.version || 1,
            s3Key, archivoNombre,
            motivo: doCreateForm.motivo,
            notasCambio: doCreateForm.descripcion || undefined,
            titulo: el.titulo || doCreateForm.titulo || 'Procedimiento',
            asignaciones: existingDoc.asignaciones || [],
            autorId: user?.personaId,
            autorNombre,
            tenantId: obra.tenantId,
            obraId,
            fechaLimite: existingDoc.fechaCaducidad,
            tamanoArchivo: doCreateForm.file?.size,
          });
          if (!r.ok) { setDoCreateError(r.error || 'No se pudo publicar la nueva versión.'); return; }

          await reloadDocs();
          setObraToast('Nueva versión publicada. Se notificó a la línea de mando y el personal debe re-firmar.');
        } else if (existingDoc?.documentId) {
          // Actualización de metadatos/archivo sin versionar (doc no procedimiento).
          const r = await documentsApi.update(existingDoc.documentId, {
            titulo: doCreateForm.titulo, descripcion: doCreateForm.descripcion,
            // Sin esto, corregir la fecha de un acta ya cargada no hacia nada.
            ...(esRegistroEjecucion(el.tipo) ? { fecha: doCreateForm.fecha } : {}),
            ...(s3Key ? { s3Key, archivoUrl: s3Key, archivoNombre } : {}),
          } as any);
          if (!r.success) { setDoCreateError(r.error || 'No se pudo actualizar el documento.'); return; }
          await reloadDocs();
          setObraToast('Documento actualizado.');
        } else {
          const r = await documentsApi.create({
            obraId, tenantId: obra.tenantId, tipo: el.tipo, titulo: doCreateForm.titulo,
            descripcion: doCreateForm.descripcion, clasificacion: 'obra', fase: 'hacer',
            // El modal ya pedia la fecha y la descartaba para documentos: sin ella
            // la vigencia se media contra la fecha de subida.
            fecha: doCreateForm.fecha,
            s3Key, archivoUrl: s3Key, archivoNombre,
            createdBy: user?.personaId, creatorName: autorNombre,
          } as any);
          if (!r.success) { setDoCreateError(r.error || 'No se pudo crear el documento.'); return; }
          await reloadDocs();
          setObraToast('Documento creado.');
        }
      }
      setDoCreateModal(null);
    } catch (err) {
      console.error('Error creando elemento DO:', err);
      setDoCreateError('Error de conexión.');
    } finally {
      setDoCreateSaving(false);
    }
  };

  // Mapea la condicion del elemento al flag de obra + texto de micro-pregunta.
  const condicionFlag = (cond: string): { flag: 'faenaCompartida' | 'tieneMaquinaria' | 'agentesFQB'; q: string } | null => {
    if (cond === 'faena_compartida') return { flag: 'faenaCompartida', q: '¿Esta obra comparte sitio con otra entidad?' };
    if (cond === 'tiene_maquinaria') return { flag: 'tieneMaquinaria', q: '¿Hay máquinas/herramientas motrices?' };
    if (cond === 'agentes_fqb') return { flag: 'agentesFQB', q: '¿Existen agentes físicos/químicos/biológicos?' };
    return null;
  };

  const loadCheckConsolidado = useCallback(async () => {
    if (!obraId) return;
    setLoadingCheck(true);
    try {
      const year = new Date().getFullYear();
      const res = await obrasApi.getCheckConsolidado(obraId, { desde: `${year}-01-01`, hasta: `${year}-12-31` });
      if (res.success && res.data) setCheckConsolidado(res.data);
    } catch (err) {
      console.error('Error cargando consolidado CHECK:', err);
    } finally {
      setLoadingCheck(false);
    }
  }, [obraId]);

  const handleActivarFaseHacer = useCallback(async () => {
    if (!obraId) return;
    setActivatingFaseDeming(true);
    try {
      const res = await obrasApi.avanzarFaseDeming(obraId);
      if (res.success && res.data?.obra) {
        setObra(res.data.obra);
        await reloadDocs();
        // Toast de 3s: PLAN completado
        setPlanToast(true);
        setTimeout(() => setPlanToast(false), 3000);
      }
    } catch (err) {
      console.error('Error activando fase HACER:', err);
    } finally {
      setActivatingFaseDeming(false);
    }
  }, [obraId, reloadDocs]);

  // Avance manual de fase del ciclo Deming (HACER→VERIFICAR, VERIFICAR→ACTUAR).
  // A diferencia de PLAN (auto), estas fases las cierra explícitamente el gestor.
  const handleAvanzarFaseDeming = useCallback(async () => {
    if (!obraId) return;
    setActivatingFaseDeming(true);
    try {
      const res = await obrasApi.avanzarFaseDeming(obraId);
      if (res.success && res.data?.obra) {
        setObra(res.data.obra);
        await reloadDocs();
        setObraToast('Fase completada. Avanzaste a la siguiente fase del ciclo.');
      }
    } catch (err) {
      console.error('Error avanzando fase Deming:', err);
    } finally {
      setActivatingFaseDeming(false);
    }
  }, [obraId, reloadDocs]);


  const handleDoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingDoFile(file);
    if (event.target) event.target.value = '';
  };

  const handleSaveDoChanges = async () => {
    if (!selectedDoDoc || !obraId) return;
    if (!doExpiryNotApplicable && !doExpiryDate) {
      alert('Selecciona una fecha de vencimiento para el documento.');
      return;
    }
    if (!selectedDoDoc.documentId && !pendingDoFile) {
      alert('Debes seleccionar un archivo antes de guardar.');
      return;
    }

    const expiryValue = doExpiryNotApplicable ? null : doExpiryDate;
    setDoSaving(true);
    try {
      let fileKey = selectedDoDetail?.s3Key || selectedDoDetail?.archivoUrl || null;
      let fileName = selectedDoDetail?.archivoNombre || null;

      if (pendingDoFile) {
        const uploadUrlRes = await uploadsApi.getUploadUrl({
          fileName: pendingDoFile.name,
          fileType: pendingDoFile.type,
          fileSize: pendingDoFile.size,
          categoria: 'obras',
          empresaId: obra?.tenantId
        });
        if (!uploadUrlRes.success || !uploadUrlRes.data) throw new Error('Error al obtener URL de subida');
        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: pendingDoFile,
          headers: { 'Content-Type': pendingDoFile.type }
        });
        if (!uploadResult.ok) throw new Error('Error al subir archivo');
        fileKey = uploadUrlRes.data.fileKey;
        fileName = pendingDoFile.name;
        await uploadsApi.confirmUpload({ fileKey, fileName: pendingDoFile.name, fileType: pendingDoFile.type, fileSize: pendingDoFile.size });
      }

      let documentId = selectedDoDoc.documentId;
      if (documentId) {
        await documentsApi.update(documentId, { s3Key: fileKey, archivoUrl: fileKey, archivoNombre: fileName, fechaCaducidad: expiryValue } as any);
      } else {
        const createRes = await documentsApi.create({
          obraId,
          clasificacion: 'obra',
          fase: faseDeming,
          tipo: selectedDoDoc.tipos[0],
          obligatorio: true,
          titulo: selectedDoDoc.titulo,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue,
          createdBy: user?.personaId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || documentId;
      }

      if (documentId && doWorkerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: doWorkerIds,
          personaIds: doWorkerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.personaId,
          assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
      }

      await reloadDocs();
      setPendingDoFile(null);
      setIsDoModalOpen(false);
    } catch (error) {
      console.error('Error guardando documento DO:', error);
    } finally {
      setDoSaving(false);
    }
  };

  // Abre el PDF de un documento: si ya tiene firmas, la versión con el anexo
  // de firmas estampado (única con validez legal); si no, el archivo
  // original. La pestaña se abre en el click (ver utils/documentoFirmado)
  // para que el navegador no la bloquee mientras se espera el estampado.
  const abrirDocumentoFirmable = (params: { documentId?: string | null; firmas?: any[]; fileKey?: string | null }) =>
    abrirDocumentoFirmableCompartido({
      ...params,
      onPreparando: () => setObraToast('Preparando documento firmado, esto puede tardar unos segundos...'),
      onError: (mensaje) => alert(mensaje),
    });

  const handlePreviewDoDocument = async () => {
    setDoPreviewing(true);
    try {
      await abrirDocumentoFirmable({
        documentId: selectedDoDetail?.documentId,
        firmas: selectedDoDetail?.firmas,
        fileKey: selectedDoDetail?.s3Key || selectedDoDetail?.archivoUrl,
      });
    } catch (error) {
      console.error('Error abriendo documento DO:', error);
    } finally {
      setDoPreviewing(false);
    }
  };

  const handleBulkOnboardingUpload = async (tipo: string, file: File, workers: any[]) => {
    if (!obraId || !obra) return;
    setBulkUploadingTipo(tipo);
    try {
      const uploadRes = await uploadsApi.getUploadUrl({
        fileName: file.name, fileType: file.type, fileSize: file.size,
        categoria: 'obras', empresaId: obra.tenantId
      });
      if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
      await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const fileKey = uploadRes.data.fileKey;
      await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });

      // Actualizar el documento de cada worker para este tipo
      for (const worker of workers) {
        const workerId = worker.personaId;
        const docsRes = await documentsApi.list({ obraId, workerId } as any);
        if (docsRes.success && docsRes.data) {
          const workerDocs = docsRes.data.documents || [];
          const targetDoc = workerDocs.find((d: any) =>
            d.tipo === tipo &&
            (d.asignaciones || []).some((a: any) => (a.personaId) === workerId)
          );
          if (targetDoc) {
            // Update file + mark the worker's asignacion as firmado so checklist reflects it
            const updatedAsignaciones = (targetDoc.asignaciones || []).map((a: any) =>
              (a.personaId) === workerId
                ? { ...a, estado: 'firmado', fechaFirma: new Date().toISOString() }
                : a
            );
            await documentsApi.update(targetDoc.documentId, {
              s3Key: fileKey,
              archivoUrl: fileKey,
              archivoNombre: file.name,
              asignaciones: updatedAsignaciones
            } as any);
          }
        }
      }
      setBulkUploadDone(prev => ({ ...prev, [tipo]: true }));
    } catch (err) {
      console.error('Error en carga masiva de onboarding:', err);
    } finally {
      setBulkUploadingTipo(null);
    }
  };

  const generateRegistroATHTML = () => {
    const fecha = new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' });
    const abiertos = incidentes.filter(incidenteAbierto);
    const cerrados = incidentes.filter(incidenteCerrado);
    const rows = incidentes.map((inc: any) => `
      <tr>
        <td>${inc.fecha ? new Date(inc.fecha).toLocaleDateString('es-CL') : '-'}</td>
        <td>${inc.tipo || '-'}</td>
        <td>${inc.descripcion || inc.titulo || '-'}</td>
        <td>${inc.trabajadorAfectado || inc.personaAfectada || '-'}</td>
        <td><span class="badge-${incidenteCerrado(inc) ? 'ok' : 'warn'}">${incidenteCerrado(inc) ? 'cerrado' : (inc.estado || '-')}</span></td>
        <td>${inc.responsable || inc.creadoPor || '-'}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Registro AT/EP/Incidentes Peligrosos — ${obra?.nombre}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; font-size: 12px; padding: 32px; }
    .header { text-align: center; border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 15px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
    .header .subtitle { font-size: 11px; color: #555; margin-bottom: 2px; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
    .meta-card { border: 1px solid #ddd; padding: 10px 12px; border-radius: 6px; }
    .meta-label { font-size: 9px; text-transform: uppercase; color: #888; letter-spacing: 0.06em; margin-bottom: 2px; }
    .meta-value { font-size: 16px; font-weight: 700; color: #1a1a2e; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #555; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #eee; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #1a1a2e; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .badge-ok { background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .badge-warn { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
    .empty { text-align: center; color: #aaa; padding: 24px; font-style: italic; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 48px; }
    .sign-box { border-top: 1px solid #333; padding-top: 8px; text-align: center; }
    .sign-name { font-weight: 600; font-size: 12px; }
    .sign-role { font-size: 10px; color: #888; }
    .legal-note { margin-top: 24px; font-size: 9px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Registro de Accidentes del Trabajo, Enfermedades Profesionales e Incidentes Peligrosos</h1>
    <p class="subtitle">Arts. 72 y 73 — Decreto Supremo N°44/2024 — Ministerio de Salud</p>
    <p class="subtitle">Generado: ${fecha}</p>
  </div>

  <div class="meta-grid">
    <div class="meta-card"><div class="meta-label">Obra</div><div class="meta-value" style="font-size:13px">${obra?.nombre || '-'}</div></div>
    <div class="meta-card"><div class="meta-label">Total incidentes</div><div class="meta-value">${incidentes.length}</div></div>
    <div class="meta-card"><div class="meta-label">Abiertos</div><div class="meta-value" style="color:#d97706">${abiertos.length}</div></div>
    <div class="meta-card"><div class="meta-label">Cerrados</div><div class="meta-value" style="color:#059669">${cerrados.length}</div></div>
  </div>

  <div class="section-title">Detalle de incidentes registrados</div>
  ${incidentes.length === 0
        ? '<p class="empty">No se han registrado incidentes para esta obra.</p>'
        : `<table>
        <thead><tr>
          <th>Fecha</th><th>Tipo</th><th>Descripci&oacute;n</th><th>Afectado</th><th>Estado</th><th>Responsable</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
      }

  <div class="signatures">
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">${user ? `${user.nombre} ${user.apellido || ''}`.trim() : 'Prevencionista'}</div>
      <div class="sign-role">Prevencionista / Responsable SST</div>
    </div>
    <div class="sign-box">
      <div style="height:48px"></div>
      <div class="sign-name">Jefe de Obra</div>
      <div class="sign-role">Revisado y validado</div>
    </div>
  </div>

  <p class="legal-note">Documento generado por PrevencionApp &bull; ${obra?.nombre} &bull; Cumplimiento DS44 Arts. 72-73</p>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
  };

  const handleExportRegistroAT = async () => {
    if (!obraId) return;
    const firmanteId = user?.personaId;
    if (!firmanteId) {
      setRegistroError('No se pudo identificar al firmante.');
      return;
    }
    if (!registroPin || registroPin.length < 4) {
      setRegistroError('Ingresa tu PIN para firmar el registro.');
      return;
    }
    setRegistroError(null);
    setExportingRegistro(true);
    try {
      // El backend consolida incidentes+actividades+ indicadores, firma via
      // FirmaService (firma real, no decorativa) y persiste el snapshot inmutable
      // con hash verificable. El periodo por defecto cubre el anio en curso.
      const year = new Date().getFullYear();
      const res = await obrasApi.generarRegistroATEP(obraId, {
        periodo: { desde: `${year}-01-01`, hasta: `${year}-12-31` },
        firmante: { personaId: firmanteId, pin: registroPin },
        metodo: 'PIN',
      });

      if (!res.success || !res.data) {
        setRegistroError(res.error || 'No se pudo generar el registro. Verifica tu PIN.');
        return;
      }

      setRegistroResult(res.data);
      setRegistroPin('');

      // Vista imprimible del snapshot retornado (solo presentacion).
      const html = generateRegistroATHTML();
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      console.error('Error exportando Registro AT/EP:', err);
      setRegistroError('Error de conexion al generar el registro.');
    } finally {
      setExportingRegistro(false);
    }
  };



  const handleInlineWorkerUpload = async (workerId: string, tipo: string, file: File) => {
    if (!obraId || !obra) return;
    const key = `${workerId}:${tipo}`;
    setUploadingWorkerDoc(key);
    try {
      const uploadRes = await uploadsApi.getUploadUrl({
        fileName: file.name, fileType: file.type, fileSize: file.size,
        categoria: 'obras', empresaId: obra.tenantId
      });
      if (!uploadRes.success || !uploadRes.data) throw new Error('Sin URL de subida');
      await fetch(uploadRes.data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const fileKey = uploadRes.data.fileKey;
      await uploadsApi.confirmUpload({ fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });

      // Find and update the worker's specific doc record
      const docsRes = await documentsApi.list({ obraId, workerId } as any);
      if (docsRes.success && docsRes.data) {
        const workerDocs = docsRes.data.documents || [];
        const targetDoc = workerDocs.find((d: any) =>
          d.tipo === tipo &&
          (d.asignaciones || []).some((a: any) => (a.personaId) === workerId)
        );
        if (targetDoc) {
          // Adjuntar el archivo. NO marca firmado: la asignacion queda 'pendiente'
          // hasta que el trabajador firme (firma cruzada via firma asistida).
          await documentsApi.update(targetDoc.documentId, {
            s3Key: fileKey, archivoUrl: fileKey, archivoNombre: file.name
          } as any);
        }
      }
      reloadObraData();
    } catch (err) {
      console.error('Error subiendo doc de onboarding:', err);
    } finally {
      setUploadingWorkerDoc(null);
    }
  };


  const toggleExpandWorker = (workerId: string) => {
    setExpandedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId); else next.add(workerId);
      return next;
    });
  };

  const getDocExpiryDate = (doc: any) => {
    if (!doc) return null;
    if (doc.fechaCaducidad) return doc.fechaCaducidad;
    const fechas = (doc.asignaciones || [])
      .map((asignacion: any) => asignacion.fechaLimite)
      .filter(Boolean)
      .map((fecha: string) => new Date(fecha))
      .filter((fecha: Date) => !Number.isNaN(fecha.getTime()));
    if (fechas.length === 0) return null;
    const earliest = fechas.reduce((min: Date, current: Date) => (current < min ? current : min), fechas[0]);
    return earliest.toISOString();
  };

  const formatDate = (value?: string | null) => {
    if (!value) return 'No aplica';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('es-CL');
  };

  const toDateInputValue = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    }
    return date.toISOString().slice(0, 10);
  };

  const openDs44Modal = async (doc: Ds44Item) => {
    setSelectedDs44Doc(doc);
    setSelectedDs44Detail(doc.document || null);
    setDs44Titulo(doc.document?.titulo || '');
    setSelectedWorkerIds((doc.document?.asignaciones || []).map((a: any) => a.personaId || a.workerId).filter(Boolean));
    const docExpiry = getDocExpiryDate(doc.document);
    // Un documento nuevo llega con la caducidad a un año ya propuesta, visible y
    // editable, en vez de un campo vacío que hay que recordar llenar.
    setSelectedExpiryDate(toDateInputValue(docExpiry) || caducidadPorDefecto());
    setExpiryApplicable(Boolean(!doc.document || docExpiry));
    setPendingDs44File(null);
    setDs44Motivo('');
    setDs44Participantes([]);
    setDs44ParticipantesDetalle('');
    setIsDs44ModalOpen(true);

    if (doc.documentId) {
      setDs44Loading(true);
      try {
        const res = await documentsApi.get(doc.documentId);
        if (res.success && res.data) {
          setSelectedDs44Detail(res.data);
          setSelectedWorkerIds((res.data.asignaciones || []).map((a: any) => a.personaId || a.workerId).filter(Boolean));
          const fetchedExpiry = getDocExpiryDate(res.data);
          // Si el documento nunca tuvo caducidad, se propone la de un año al
          // activar el toggle: el campo no queda vacío esperando una fecha.
          setSelectedExpiryDate(toDateInputValue(fetchedExpiry) || caducidadPorDefecto());
          setExpiryApplicable(Boolean(fetchedExpiry));
        }
      } catch (error) {
        console.error('Error loading DS44 document:', error);
      } finally {
        setDs44Loading(false);
      }
    }
  };

  const handleDs44FileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPendingDs44File(file);
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleSaveDs44Changes = async () => {
    if (!selectedDs44Doc || !obraId) return;

    // Sin fecha elegida, el documento caduca en un año: es la vigencia que el
    // DS 44 asume por defecto (Art. 7 inc. 9). Antes esto bloqueaba el guardado,
    // lo que empujaba a apagar la caducidad con tal de poder subir el archivo.
    const expiryValue = expiryApplicable ? (selectedExpiryDate || caducidadPorDefecto()) : null;
    const existingSignerIds = (selectedDs44Detail?.asignaciones || []).map((asignacion: any) => asignacion.personaId || asignacion.workerId);
    const targetSignerIds = selectedWorkerIds.length > 0 ? selectedWorkerIds : existingSignerIds;

    if (!selectedDs44Doc.documentId && !pendingDs44File) {
      alert('Debes seleccionar un archivo antes de guardar.');
      return;
    }

    // En un requisito con varios documentos, el nombre los distingue en la lista.
    if (selectedDs44Doc.multiple && !ds44Titulo.trim()) {
      alert('Escribe un nombre para identificar este plan.');
      return;
    }
    const tituloDocumento = selectedDs44Doc.multiple ? ds44Titulo.trim() : selectedDs44Doc.titulo;

    // Reemplazar el archivo de un documento versionable publica una versión nueva
    // en vez de sobrescribir: archiva la anterior, invalida las firmas y avisa a la
    // línea de mando (Art. 7 inc. 9 para la MIPER). La primera subida sobre un
    // documento sin archivo sigue siendo una actualización normal, no una v2.
    const esNuevaVersionPlan = ds44EsVersionable(selectedDs44Doc, selectedDs44Detail) && Boolean(pendingDs44File);
    if (esNuevaVersionPlan && !ds44Motivo.trim()) {
      alert('Indica el motivo del cambio para publicar la nueva versión.');
      return;
    }

    setUploadingKey(selectedDs44Doc.key);
    setDs44Saving(true);

    try {
      let fileKey = selectedDs44Detail?.s3Key || selectedDs44Detail?.archivoUrl || null;
      let fileName = selectedDs44Detail?.archivoNombre || null;

      if (pendingDs44File) {
        const uploadUrlRes = await uploadsApi.getUploadUrl({
          fileName: pendingDs44File.name,
          fileType: pendingDs44File.type,
          fileSize: pendingDs44File.size,
          categoria: 'obras',
          empresaId: obra?.tenantId
        });

        if (!uploadUrlRes.success || !uploadUrlRes.data) {
          throw new Error(uploadUrlRes.error || 'Error al obtener URL de subida');
        }

        const uploadResult = await fetch(uploadUrlRes.data.uploadUrl, {
          method: 'PUT',
          body: pendingDs44File,
          headers: { 'Content-Type': pendingDs44File.type }
        });

        if (!uploadResult.ok) {
          throw new Error('Error al subir archivo');
        }

        fileKey = uploadUrlRes.data.fileKey;
        fileName = pendingDs44File.name;
        await uploadsApi.confirmUpload({
          fileKey,
          fileName: pendingDs44File.name,
          fileType: pendingDs44File.type,
          fileSize: pendingDs44File.size
        });
      }

      let documentId = selectedDs44Doc.documentId;
      const autorNombreDs44 = user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined;

      if (documentId && esNuevaVersionPlan && fileKey) {
        // Dos llamadas: la publicación de la versión no acepta metadatos, y el
        // `update` posterior no vuelve a archivar porque no lleva `s3Key` nuevo.
        const publicacion = await publicarNuevaVersion({
          documentId,
          versionActual: selectedDs44Detail?.version || 1,
          s3Key: fileKey,
          archivoNombre: fileName || undefined,
          motivo: ds44Motivo,
          participantesRevision: ds44Participantes.length
            ? { entidades: ds44Participantes, detalle: ds44ParticipantesDetalle.trim() || undefined }
            : undefined,
          titulo: tituloDocumento,
          asignaciones: targetSignerIds.map((id: string) => ({ personaId: id })),
          autorId: user?.personaId,
          autorNombre: autorNombreDs44,
          tenantId: obra?.tenantId,
          obraId,
          fechaLimite: expiryValue,
          tamanoArchivo: pendingDs44File?.size,
        });
        if (!publicacion.ok) {
          alert(publicacion.error || 'No se pudo publicar la nueva versión.');
          return;
        }
        await documentsApi.update(documentId, {
          fechaCaducidad: expiryValue,
          titulo: tituloDocumento,
        } as any);
      } else if (documentId) {
        await documentsApi.update(documentId, {
          s3Key: fileKey,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue,
          titulo: tituloDocumento,
          // Queda registrado en el historial como autor de esta versión.
          publicadaPor: user?.personaId,
          publicadaPorNombre: autorNombreDs44,
        } as any);
      } else {
        const createRes = await documentsApi.create({
          obraId,
          clasificacion: 'obra',
          fase: 'plan',
          tipo: selectedDs44Doc.tipos[0],
          obligatorio: true,
          titulo: tituloDocumento,
          archivoUrl: fileKey,
          archivoNombre: fileName,
          fechaCaducidad: expiryValue,
          createdBy: user?.personaId,
          creatorName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);
        documentId = (createRes as any)?.data?.documentId || (createRes as any)?.data?.id || documentId;
      }

      if (documentId && targetSignerIds.length > 0) {
        await documentsApi.assign(documentId, {
          workerIds: targetSignerIds,
          personaIds: targetSignerIds,
          fechaLimite: expiryValue,
          notificar: true,
          replace: true,
          assignedBy: user?.personaId,
          assignerName: user ? `${user.nombre} ${user.apellido || ''}`.trim() : undefined
        } as any);

        // Also create a SignatureRequest so workers see it in "Mis Firmas".
        // Evita duplicados: solo crea si no existe ya una solicitud activa para este documento.
        // Al publicar una versión nueva la solicitud de re-firma ya la emitió
        // `publicarNuevaVersion` (con el número de versión en el título), así que
        // esta rama se salta: `obraSignatureRequests` es estado previo a la
        // publicación y no la vería, creando una segunda solicitud para lo mismo.
        try {
          const yaExiste = esNuevaVersionPlan || obraSignatureRequests.some(
            (r: any) => (r.referenciaId === documentId || r.documentId === documentId)
              && ['pendiente', 'en_proceso'].includes(r.estado)
          );
          if (!yaExiste) {
            const docTitle = selectedDs44Doc.titulo || 'Documento DS44';
            const docAttachments = fileKey ? [{
              nombre: fileName || docTitle,
              url: fileKey,
              tipo: 'application/pdf',
              tamaño: pendingDs44File?.size || 0
            }] : [];

            await signatureRequestsApi.create({
              tipo: 'DOCUMENTO',
              // El título es el nombre del documento; el backend ya antepone "Firma requerida:"
              // al notificar (evita el doble prefijo "Firma requerida: Firma requerida:").
              titulo: docTitle,
              descripcion: `Se requiere su firma para el documento DS44 "${docTitle}" de la obra.`,
              documentos: docAttachments,
              trabajadoresIds: targetSignerIds,
              solicitanteId: user?.personaId || '',
              fechaLimite: expiryValue || undefined,
              tenantId: obra?.tenantId,
              obraId,
              referenciaId: documentId,
              referenciaTipo: 'document',
              documentId,
            } as any);
          }
        } catch (sigReqError) {
          console.warn('No se pudo crear solicitud de firma (los trabajadores podrían no ver la firma pendiente):', sigReqError);
        }
      }

      await reloadDocs();

      if (documentId) {
        const updatedDoc = await documentsApi.get(documentId);
        if (updatedDoc.success && updatedDoc.data) {
          setSelectedDs44Detail(updatedDoc.data);
          setSelectedDs44Doc((prev) => prev ? { ...prev, documentId } : prev);
          const updatedExpiry = getDocExpiryDate(updatedDoc.data);
          setSelectedExpiryDate(toDateInputValue(updatedExpiry));
          setExpiryApplicable(Boolean(updatedExpiry));
        }
      }

      setPendingDs44File(null);
      setIsDs44ModalOpen(false);
    } catch (error) {
      console.error('Error updating documento DS44:', error);
    } finally {
      setUploadingKey(null);
      setDs44Saving(false);
    }
  };

  const toggleWorkerSelection = (workerId: string) => {
    setSelectedWorkerIds((prev) =>
      prev.includes(workerId) ? prev.filter((id) => id !== workerId) : [...prev, workerId]
    );
  };

  // Vista previa dentro de la misma página. Si el documento tiene firmas se
  // muestra la versión con el anexo estampado, que puede tardar en generarse:
  // el modal abre en carga y se completa cuando la URL está lista.
  const handlePreviewDocumentFromCard = async (doc: Ds44Item) => {
    setDocPreview({ url: null, name: doc.document?.archivoNombre || doc.titulo });
    try {
      const resultado = await resolverDocumentoFirmable({
        documentId: doc.documentId || doc.document?.documentId,
        firmas: doc.document?.firmas,
        fileKey: doc.document?.s3Key || doc.document?.archivoUrl,
      });
      if ('url' in resultado) {
        setDocPreview((prev) => (prev ? { ...prev, url: resultado.url } : prev));
      } else {
        setDocPreview(null);
      }
    } catch (error) {
      console.error('Error opening document:', error);
      setDocPreview(null);
    }
  };

  // Plantilla corporativa heredada (Política SST / Reglamento Interno). Se ve
  // en la misma página, igual que el resto de los documentos de la lista.
  const previewEmpresaDoc = async (fileKey: string, nombre?: string) => {
    if (!fileKey) return;
    setDocPreview({ url: null, name: nombre || 'documento' });
    try {
      const res = await uploadsApi.getDownloadUrl(fileKey);
      if (res.success && res.data?.downloadUrl) {
        setDocPreview((prev) => (prev ? { ...prev, url: res.data!.downloadUrl } : prev));
      } else {
        setDocPreview(null);
      }
    } catch (error) {
      console.error('Error opening company document:', error);
      setDocPreview(null);
    }
  };

  // "Ver documento" dentro del modal de edición: la vista previa se abre encima
  // y Escape solo cierra la de arriba, así que el formulario no se pierde.
  const handlePreviewDocument = async () => {
    setDs44Previewing(true);
    setDocPreview({ url: null, name: selectedDs44Detail?.archivoNombre || selectedDs44Doc?.titulo || 'documento' });
    try {
      const resultado = await resolverDocumentoFirmable({
        documentId: selectedDs44Doc?.documentId || selectedDs44Detail?.documentId,
        firmas: selectedDs44Detail?.firmas,
        fileKey: selectedDs44Detail?.s3Key || selectedDs44Detail?.archivoUrl,
      });
      if ('url' in resultado) {
        setDocPreview((prev) => (prev ? { ...prev, url: resultado.url } : prev));
      } else {
        setDocPreview(null);
      }
    } catch (error) {
      console.error('Error opening document:', error);
      setDocPreview(null);
    } finally {
      setDs44Previewing(false);
    }
  };

  const openSignatureModal = (doc: Ds44Item) => {
    const stats = getSignatureStats(doc.document);
    setSignatureModalDoc({ titulo: doc.titulo, asignaciones: stats.asignaciones || [] });
    setIsSignatureModalOpen(true);
  };

  const eliminarDocumento = async () => {
    if (!docAEliminar) return;
    setEliminandoDoc(true);
    try {
      const res = await documentsApi.remove(docAEliminar.documentId, user?.personaId);
      if (!res.success) {
        alert(res.error || 'No se pudo eliminar el documento.');
        return;
      }
      setObraDocs((prev) => prev.filter((d: DocumentoApi) => d.documentId !== docAEliminar.documentId));
      setDs44Docs((prev) => prev.map((item) => item.documentos
        ? { ...item, documentos: item.documentos.filter((d: DocumentoApi) => d.documentId !== docAEliminar.documentId) }
        : item));
      setDocAEliminar(null);
    } catch (err) {
      console.error('Error deleting document:', err);
      alert('Error de conexión al eliminar el documento.');
    } finally {
      setEliminandoDoc(false);
    }
  };

  // Cada documento de un requisito `multiple`, listo para la lista desplegable:
  // conserva las mismas acciones que una fila normal más "Eliminar plan".
  const resumenDocumento = (d: DocumentoApi, requisito: { titulo: string; key: string; tipos?: string[]; multiple?: boolean }): DocResumen => {
    const { firmadas, total } = getSignatureStats(d);
    const version = d.version || 1;
    const actualizadoEn = d.updatedAt || d.createdAt;
    const firmado = total > 0 && firmadas === total;
    const partes = [
      version > 1 ? `v${version}` : null,
      tiempoRelativo(actualizadoEn) ? `Revisado ${tiempoRelativo(actualizadoEn)}` : null,
      total > 0 ? `Firmas ${firmadas}/${total}` : null,
    ].filter(Boolean);

    // El requisito ya identifica el tipo; cada documento se distingue por su título.
    const comoItem: Ds44Item = { ...requisito, tipos: requisito.tipos || [d.tipo], titulo: d.titulo || requisito.titulo, documentId: d.documentId, archivoSubido: true, document: d };

    return {
      documentId: d.documentId,
      titulo: d.titulo || requisito.titulo,
      meta: partes.join(' · '),
      badgeClass: total > 0 && !firmado ? 'badge-warning' : 'badge-success',
      badgeLabel: total > 0 && !firmado ? 'Pendiente de firma' : 'Completo',
      onVer: () => handlePreviewDocumentFromCard(comoItem),
      acciones: [
        { label: 'Actualizar archivo', onClick: () => openDs44Modal(comoItem) },
        ...(total > 0 ? [{ label: 'Ver firmas', onClick: () => openSignatureModal(comoItem) }] : []),
        // Disponible desde la v1: es donde se ve quién subió el archivo vigente.
        { label: 'Historial de cambios', onClick: () => openHistorialModal(comoItem) },
        ...(total === 0 ? [{ label: 'Eliminar', onClick: () => setDocAEliminar({ documentId: d.documentId, titulo: d.titulo || requisito.titulo }) }] : []),
      ],
    };
  };

  // Equivalente para la fase HACER: los procedimientos se actualizan publicando
  // una versión nueva (con motivo y re-firma), no reemplazando el archivo.
  const resumenDocumentoDo = (d: DocumentoApi, el: Ds44DoElemento): DocResumen => {
    const { firmadas, total } = getSignatureStats(d);
    const version = d.version || 1;
    const firmado = total > 0 && firmadas === total;
    const partes = [
      version > 1 ? `v${version}` : null,
      tiempoRelativo(d.updatedAt) ? `Revisado ${tiempoRelativo(d.updatedAt)}` : null,
      total > 0 ? `Firmas ${firmadas}/${total}` : null,
    ].filter(Boolean);

    const comoItem: Ds44Item = { key: el.key, tipos: [el.tipo], titulo: d.titulo || el.titulo, documentId: d.documentId, archivoSubido: true, document: d };

    return {
      documentId: d.documentId,
      titulo: d.titulo || el.titulo,
      meta: partes.join(' · '),
      badgeClass: total > 0 && !firmado ? 'badge-warning' : 'badge-success',
      badgeLabel: total > 0 && !firmado ? 'Pendiente de firma' : 'Completo',
      onVer: () => handlePreviewDocumentFromCard(comoItem),
      acciones: [
        { label: 'Publicar nueva versión', onClick: () => openDoCreate('documento', el, d) },
        ...(total > 0 ? [{ label: 'Ver firmas', onClick: () => openSignatureModal(comoItem) }] : []),
        // Disponible desde la v1: es donde se ve quién subió el archivo vigente.
        { label: 'Historial de cambios', onClick: () => openHistorialModal(comoItem) },
        ...(total === 0 ? [{ label: 'Eliminar', onClick: () => setDocAEliminar({ documentId: d.documentId, titulo: d.titulo || el.titulo }) }] : []),
      ],
    };
  };

  // Historial de versiones: la versión vigente encabeza la lista y debajo van las
  // archivadas, de la más reciente a la más antigua.
  const openHistorialModal = (doc: Ds44Item) => {
    const d = doc.document || {};
    const archivadas: DocumentVersion[] = Array.isArray(d.versiones) ? d.versiones : [];
    const vigente = {
      version: d.version || archivadas.length + 1,
      s3Key: d.s3Key || d.archivoUrl || null,
      archivoNombre: d.archivoNombre || null,
      publicadaEn: d.updatedAt || d.createdAt || null,
      publicadaPorNombre: d.ultimaPublicacionNombre || d.creatorName || null,
      motivo: d.ultimoMotivoVersion || null,
      participantes: d.ultimosParticipantesRevision || null,
      actual: true,
    };
    const previas = [...archivadas]
      .sort((a, b) => (b.version || 0) - (a.version || 0))
      .map((v) => ({ ...v, actual: false }));
    setHistorialModal({ titulo: doc.titulo, versiones: [vigente, ...previas] });
  };

  // Abre una versión concreta dentro de la misma página (sin pestaña nueva).
  const verVersion = async (s3Key?: string | null, nombre?: string | null) => {
    if (!s3Key) return;
    setDocPreview({ url: null, name: nombre || 'documento' });
    try {
      const res = await uploadsApi.getDownloadUrl(s3Key);
      if (res.success && res.data?.downloadUrl) {
        setDocPreview((prev) => (prev ? { ...prev, url: res.data!.downloadUrl } : prev));
      } else {
        setDocPreview(null);
      }
    } catch (error) {
      console.error('Error opening version:', error);
      setDocPreview(null);
    }
  };

  // Gating por firma: un documento de fase cuenta como COMPLETO solo si esta
  // subido Y todas sus firmas asignadas estan hechas. Si tiene firmantes
  // pendientes, NO avanza el % de la fase hasta que todos firmen.
  const docFaseCompleto = (doc: any) => {
    if (!doc.archivoSubido) return false;
    const { firmadas, total } = getSignatureStats(doc.document);
    return total === 0 || firmadas === total;
  };

  const documentosPendientes = ds44Docs.filter((doc) => !doc.archivoSubido);
  const documentosPendientesFirma = ds44Docs.filter((doc) => {
    if (!doc.archivoSubido) return false;
    const { firmadas, total } = getSignatureStats(doc.document);
    return total > 0 && firmadas < total;
  });
  const documentosVencidos = ds44Docs.filter((doc) => {
    const fechaCaducidad = getDocExpiryDate(doc.document);
    if (!fechaCaducidad) return false;
    return new Date(fechaCaducidad) < new Date();
  });
  const documentosPendientesTitulos = documentosPendientes.map((doc) => doc.titulo);
  const inactiveWorkers = trabajadores.filter((worker) => worker.estado === 'inactivo');
  const activeWorkers = trabajadores.filter((worker) => worker.estado !== 'inactivo');


  // PLAN completo: todos los documentos subidos Y firmados (gating por firma).
  const planCompleto = ds44Docs.length > 0 && ds44Docs.every(docFaseCompleto);

  // DO completo: el cumplimiento de la obra (procedimientos + capacitaciones
  // aplicables + registro maestro) llegó al 100%.
  const doCompleto = doCumplimiento.total > 0 && doCumplimiento.progress === 100;

  // CHECK completo: todos los documentos CHECK obligatorios aplicables están registrados.
  const checkCompleto = DS44_CHECK_DOCS
    .filter((d) => d.obligatorio && (d.condicional !== 'mas_100_trabajadores' || dotacionEntidad > 100))
    .every((d) => obraDocs.some((od: any) => od.tipo === d.tipo));

  const doPendientes = doDocs.filter((doc) => !doc.archivoSubido);
  const doTotal = doDocs.length;
  const doUploaded = doTotal - doPendientes.length;
  void doUploaded; // reservado para indicador de fase DO

  // Cumplimiento DE LA FASE SELECCIONADA, con las reglas del motor de completitud.
  //
  // Antes se mostraba siempre el conteo de los documentos base de PLAN bajo el
  // encabezado de la fase activa: en HACER o VERIFICAR el número describía otra
  // cosa que su etiqueta. Ahora cada fase mide su propio universo, y lo que no
  // aplica a la obra sale del denominador con su motivo en vez de penalizar.
  const faseCompletitud = useMemo(() => completitudDeFase({
    fase: selectedDemingPhase as 'plan' | 'hacer' | 'verificar' | 'actuar',
    docsPlan: ds44Docs,
    procedimientos: doProcedimientos,
    capacitaciones: doCapacitaciones,
    registroMaestroGenerado,
    obraDocs,
    dotacion: dotacionEntidad,
    ctx: doContext,
  }), [selectedDemingPhase, ds44Docs, doProcedimientos, doCapacitaciones,
    registroMaestroGenerado, obraDocs, dotacionEntidad, doContext]);

  const faseLabel = DS44_PHASE_LABELS[selectedDemingPhase] || selectedDemingPhase.toUpperCase();
  const isPlanPhase = selectedDemingPhase === 'plan';
  const isDoPhase = selectedDemingPhase === 'hacer';
  const isCheckPhase = selectedDemingPhase === 'verificar';
  const isActPhase = selectedDemingPhase === 'actuar';

  const FASES_DEMING = [
    { key: 'plan', label: 'PLANIFICAR', short: 'PLAN' },
    { key: 'hacer', label: 'HACER', short: 'DO' },
    { key: 'verificar', label: 'VERIFICAR', short: 'CHECK' },
    { key: 'actuar', label: 'ACTUAR', short: 'ACT' },
  ];
  const idxFaseDeming = FASES_DEMING.findIndex(f => f.key === faseDeming);

  // Auto-avance del ciclo Deming: en cuanto una fase queda completa, pasa sola a
  // la siguiente (PLAN→HACER→VERIFICAR→ACTUAR). Se dispara una sola vez por fase
  // (autoAdvanceRef guarda la fase ya avanzada). ACTUAR no avanza (última fase).
  useEffect(() => {
    if (!obraId || activatingFaseDeming) return;
    const completo =
      faseDeming === 'plan' ? planCompleto
        : faseDeming === 'hacer' ? doCompleto
          : faseDeming === 'verificar' ? checkCompleto
            : false;
    if (!completo) return;
    if (autoAdvanceRef.current === faseDeming) return; // ya disparado para esta fase

    autoAdvanceRef.current = faseDeming;
    if (faseDeming === 'plan') handleActivarFaseHacer();
    else handleAvanzarFaseDeming();
  }, [obraId, faseDeming, planCompleto, doCompleto, checkCompleto, activatingFaseDeming, handleActivarFaseHacer, handleAvanzarFaseDeming]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!obra) {
    return (
      <>
        <div className="page-content">
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <LuShieldAlert size={48} className="text-danger-500" />
              </div>
              <h3 className="empty-state-title">Obra no encontrada</h3>
              <p className="empty-state-description">No pudimos cargar la informacion de la obra.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const handleEditToggle = () => {
    setEditData({
      nombre: obra.nombre || '',
      estado: obra.estado || 'activa',
      faenaCompartida: Boolean(obra.faenaCompartida),
      tieneMaquinaria: obra.tieneMaquinaria !== undefined ? Boolean(obra.tieneMaquinaria) : true,
      agentesFQB: Boolean(obra.agentesFQB)
    });
    setIsEditModalOpen(true);
  };

  const handleEditChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target as HTMLInputElement;
    const checked = (event.target as HTMLInputElement).checked;
    setEditData((prev: any) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSaveObra = async () => {
    if (!obraId || !editData) return;
    const res = await obrasApi.update(obraId, {
      nombre: editData.nombre,
      estado: editData.estado,
      faenaCompartida: editData.faenaCompartida,
      tieneMaquinaria: editData.tieneMaquinaria,
      agentesFQB: editData.agentesFQB
    });
    if (res.success && res.data?.obra) {
      setObra(res.data.obra);
    } else if (res.success && res.data) {
      setObra(res.data);
    }
    setIsEditModalOpen(false);
  };

  // Cargos efectivos a asignar: los elegidos en el modal, o el cargo legacy del
  // trabajador como default (para no asignarlo "sin cargo" por accidente).
  const cargosParaAsignar = (worker: any): string[] => {
    const elegidos = assignCargos[worker.personaId];
    if (Array.isArray(elegidos) && elegidos.length) return elegidos;
    return worker.cargo ? [worker.cargo] : [];
  };

  // Cargos que el trabajador ya tiene en ESTA obra (para el editor de cargo).
  const cargosActualesEnObra = (worker: any): string[] => {
    const a = (worker.asignaciones || []).find((x: any) => x.obraId === obraId);
    if (a && Array.isArray(a.cargos) && a.cargos.length) return a.cargos;
    return worker.cargo ? [worker.cargo] : [];
  };

  // Editor de cargo para un trabajador YA asignado: actualiza los cargos de su
  // asignación. El checklist de onboarding se recalcula solo (lee la asignación).
  const handleUpdateCargos = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      const cargos = assignCargos[worker.personaId] ?? cargosActualesEnObra(worker);
      await workersApi.setAsignacion(worker.personaId, obraId, cargos, user?.personaId || user?.userId);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
      setObraToast('Cargo actualizado');
    } catch (error) {
      console.error('Error updating cargo:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleAddWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      // El cargo se asigna EN la obra (asignación). Dispara el onboarding del kit.
      await workersApi.setAsignacion(worker.personaId, obraId, cargosParaAsignar(worker), user?.personaId || user?.userId);
      if (worker.estado === 'inactivo') await workersApi.update(worker.personaId, { estado: 'activo' } as any);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
      // Abrir modal de onboarding post-asignación
      setBulkUploadDone({});
      setOnboardingUploadModal({ show: true, addedWorkers: [worker] });
    } catch (error) {
      console.error('Error adding worker to obra:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleAddMultipleWorkers = async (workersToAdd: any[]) => {
    if (!obraId || workersToAdd.length === 0) return;
    setUpdatingWorkers('multiple');
    try {
      for (const worker of workersToAdd) {
        await workersApi.setAsignacion(worker.personaId, obraId, cargosParaAsignar(worker), user?.personaId || user?.userId);
        if (worker.estado === 'inactivo') await workersApi.update(worker.personaId, { estado: 'activo' } as any);
      }
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
        setSelectedUnassignedWorkerIds([]);
      }
      // Abrir modal de onboarding post-asignación
      setIsWorkersModalOpen(false);
      setBulkUploadDone({});
      setOnboardingUploadModal({ show: true, addedWorkers: workersToAdd });
    } catch (error) {
      console.error('Error adding multiple workers to obra:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleDeactivateWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      // Prevent deactivating administrators
      if (worker.rol === 'admin') {
        alert('No se puede dar de baja a un trabajador con rol de administrador.');
        return;
      }

      await workersApi.update(worker.personaId, {
        estado: 'inactivo'
      } as any);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
    } catch (error) {
      console.error('Error deactivating worker:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  const handleReactivateWorker = async (worker: any) => {
    if (!obraId) return;
    setUpdatingWorkers(worker.personaId);
    try {
      // Reactivar: asegurar asignación a la obra (con sus cargos previos) + estado activo.
      const asig = (worker.asignaciones || []).find((a: any) => a.obraId === obraId);
      const cargos = (asig && Array.isArray(asig.cargos) && asig.cargos.length) ? asig.cargos : (worker.cargo ? [worker.cargo] : []);
      await workersApi.setAsignacion(worker.personaId, obraId, cargos, user?.personaId || user?.userId);
      await workersApi.update(worker.personaId, { estado: 'activo' } as any);
      const refreshed = await workersApi.list();
      if (refreshed.success && refreshed.data) {
        const workers = refreshed.data as any[];
        setAllWorkers(workers);
        setTrabajadores(workers.filter((w: any) => Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
      }
    } catch (error) {
      console.error('Error reactivating worker:', error);
    } finally {
      setUpdatingWorkers(null);
    }
  };

  return (
    <>
      <div className="page-content">
        <PageHeader
          banner
          title={obra.nombre}
          description={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>{obra.codigo ? `${obra.codigo} · ` : ''}{obra.comuna || '-'}, {obra.region || '-'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', opacity: 0.65 }}>{obra.codigo || obraId}</span>
                <button
                  type="button"
                  title={obra.codigo ? 'Copiar código de obra' : 'Copiar ID interno (esta obra no tiene código)'}
                  onClick={handleCopyId}
                  style={{
                    background: copiedId ? 'rgba(16,185,129,0.22)' : 'rgba(255,255,255,0.1)',
                    border: `1px solid ${copiedId ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.22)'}`,
                    borderRadius: 6,
                    padding: '2px 9px',
                    cursor: 'pointer',
                    color: copiedId ? '#6ee7b7' : 'rgba(255,255,255,0.75)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    transition: 'all 0.2s',
                    flexShrink: 0,
                  }}
                >
                  {copiedId ? <FiCheck size={11} /> : <FiCopy size={11} />}
                  {copiedId ? 'Copiado' : 'Copiar ID'}
                </button>
              </div>
            </div>
          }
          backTo="/obras"
          actions={
            <button className="btn btn-secondary" onClick={handleEditToggle}>
              <LuPencil /> Editar
            </button>
          }
        />

        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 'var(--space-5)' }}>
          {indicadores.map((item) => (
            <div key={item.label} className="card stat-card" style={{ padding: 'var(--space-3)' }}>
              <div className="stat-value">{item.value}</div>
              <div className="stat-label">{item.label}</div>
            </div>
          ))}
        </div>

        <div className="od-tab-nav">
          <button className={activeTab === 'resumen' ? 'od-tab od-tab--active' : 'od-tab'} onClick={() => setActiveTab('resumen')}>Resumen</button>
          <button className={activeTab === 'ds44' ? 'od-tab od-tab--active' : 'od-tab'} onClick={() => setActiveTab('ds44')}>DS44 — Cumplimiento</button>
          <button className={activeTab === 'equipo' ? 'od-tab od-tab--active' : 'od-tab'} onClick={() => setActiveTab('equipo')}>Equipo ({activeWorkers.length})</button>
        </div>

        {/* ── TAB: RESUMEN ────────────────────────────────────────────────────── */}
        {activeTab === 'resumen' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Información de la Obra</div>
                <button className="btn btn-ghost btn-sm" onClick={handleEditToggle}>
                  <LuPencil /> Editar
                </button>
              </div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>{obra.codigo ? 'Código de Obra' : 'ID de Obra'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-3)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-secondary)' }}>{obra.codigo || obraId}</span>
                <button
                  type="button"
                  title={obra.codigo ? 'Copiar código de obra' : 'Copiar ID interno (esta obra no tiene código)'}
                  onClick={handleCopyId}
                  style={{
                    flexShrink: 0,
                    background: copiedId ? 'rgba(16,185,129,0.1)' : 'var(--surface-elevated)',
                    border: `1px solid ${copiedId ? 'rgba(16,185,129,0.4)' : 'var(--surface-border)'}`,
                    borderRadius: 6,
                    padding: '2px 8px',
                    cursor: 'pointer',
                    color: copiedId ? '#059669' : 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    transition: 'all 0.2s',
                  }}
                >
                  {copiedId ? <FiCheck size={11} /> : <FiCopy size={11} />}
                  {copiedId ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>Mandante</div>
              <div className="font-medium" style={{ marginBottom: 'var(--space-3)' }}>{obra.mandante || '-'}</div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>Dirección</div>
              <div className="font-medium" style={{ marginBottom: 'var(--space-3)' }}>{obra.direccion || '-'}</div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>Región / Comuna</div>
              <div className="font-medium" style={{ marginBottom: 'var(--space-3)' }}>{obra.region || '-'} · {obra.comuna || '-'}</div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>Estado</div>
              <div style={{ display: 'inline-flex', marginBottom: 'var(--space-3)' }}>
                <span className="badge badge-success">{obra.estado || '-'}</span>
              </div>
              {(obra.faenaCompartida || obra.tieneMaquinaria || obra.agentesFQB) && (
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {obra.faenaCompartida && <span style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: '999px', background: 'rgba(0,110,220,0.10)', color: '#004a8f', border: '1px solid rgba(0,110,220,0.25)' }}>Faena compartida</span>}
                  {obra.tieneMaquinaria && <span style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: '999px', background: 'rgba(0,110,220,0.10)', color: '#004a8f', border: '1px solid rgba(0,110,220,0.25)' }}>Maquinaria DS44</span>}
                  {obra.agentesFQB && <span style={{ fontSize: '0.78rem', padding: '3px 10px', borderRadius: '999px', background: 'rgba(245,158,11,0.10)', color: '#92400e', border: '1px solid rgba(245,158,11,0.25)' }}>Agentes FQB/Físicos</span>}
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Cumplimiento DS44</div>
              </div>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span className="text-muted" style={{ fontSize: '0.85rem' }}>Fase {faseLabel}</span>
                  <span style={{ fontWeight: 700, fontSize: '1.2rem', color: colorProgreso(faseCompletitud.resumen.progreso) }}>{faseCompletitud.resumen.progreso}%</span>
                </div>
                <div style={{ height: '10px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface-elevated)' }}>
                  <div style={{ width: `${faseCompletitud.resumen.progreso}%`, height: '100%', background: colorProgreso(faseCompletitud.resumen.progreso), transition: 'width 300ms' }} />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <button className="btn btn-secondary" onClick={() => setActiveTab('ds44')} style={{ justifyContent: 'flex-start' }}>Ver DS44 completo →</button>
                <button className="btn btn-secondary" onClick={() => navigate(`/incidents?obraId=${obraId}`)} style={{ justifyContent: 'flex-start' }}>Incidentes · {incidentes.length}</button>
                <button className="btn btn-secondary" onClick={() => navigate(`/documents?obraId=${obraId}`)} style={{ justifyContent: 'flex-start' }}>Documentos de obra</button>
                <button className="btn btn-secondary" onClick={() => setActiveTab('equipo')} style={{ justifyContent: 'flex-start' }}>Equipo · {activeWorkers.length} activos</button>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: DS44 ───────────────────────────────────────────────────────── */}
        {activeTab === 'ds44' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>


          <div className="ds44-panel">
            <div className="ds44-stepper">
              {FASES_DEMING.map((fase, idx) => {
                const isActive = fase.key === faseDeming;
                const isDone = idx < idxFaseDeming;
                const isSelected = fase.key === selectedDemingPhase;
                const circleColor = isDone ? '#10b981' : isActive ? '#006edc' : 'var(--surface-border)';
                const textColor = isDone ? '#10b981' : isActive ? '#006edc' : isSelected ? 'var(--text-primary)' : 'var(--text-muted)';
                return (
                  <React.Fragment key={fase.key}>
                    <button
                      type="button"
                      className={`ds44-phase-btn${isSelected ? ' ds44-phase-btn--selected' : ''}`}
                      onClick={() => setSelectedDemingPhase(fase.key)}
                    >
                      <div className="ds44-phase-circle" style={{
                        background: isDone ? '#10b981' : isActive ? '#006edc' : 'var(--surface-card)',
                        borderColor: circleColor,
                        color: isDone || isActive ? 'white' : textColor,
                        boxShadow: isSelected ? `0 0 0 3px ${isDone ? 'rgba(16,185,129,0.2)' : isActive ? 'rgba(0,110,220,0.2)' : 'rgba(0,0,0,0.08)'}` : 'none',
                      }}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                      <span className="ds44-phase-label" style={{ color: textColor, fontWeight: isSelected ? 700 : isActive ? 600 : 400 }}>
                        {fase.label}
                      </span>
                    </button>
                    {idx < FASES_DEMING.length - 1 && (
                      <div className="ds44-phase-connector" style={{ background: isDone ? '#10b981' : 'var(--surface-border)' }} />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="ds44-progress-bar">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, color: 'var(--text-secondary)' }}>Fase {faseLabel}</span>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: colorProgreso(faseCompletitud.resumen.progreso) }}>{faseCompletitud.resumen.progreso}%</span>
              </div>
              <div className="ds44-progress-track">
                <div className="ds44-progress-fill" style={{
                  width: `${faseCompletitud.resumen.progreso}%`,
                  background: colorProgreso(faseCompletitud.resumen.progreso),
                }} />
              </div>
              {/* El denominador se declara: sin esto el porcentaje es un número
                  sin procedencia y nadie sabe qué quedó fuera ni por qué. */}
              <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 5 }}>
                {faseCompletitud.resumen.cumplidos}/{faseCompletitud.resumen.exigibles} {faseCompletitud.unidad} de esta fase
                {faseCompletitud.resumen.excluidos > 0 && ` · ${faseCompletitud.resumen.excluidos} no aplican`}
              </div>
            </div>
            <div className="ds44-content-section">
              <div className="ds44-content-header">
                <div className="ds44-content-title">
                  {isPlanPhase ? 'Documentos base de la obra · etapa actual' : isDoPhase ? 'Onboarding por trabajador' : isCheckPhase ? 'Evaluación anual de evidencias' : 'Seguimiento de mejora continua'}
                </div>
              </div>

            {isPlanPhase && (
              <>
                {(documentosPendientes.length > 0 || documentosPendientesFirma.length > 0 || documentosVencidos.length > 0) && (
                  <div className="ds44-alerts">
                    {documentosPendientesFirma.length > 0 && (
                      <div className="ds44-alert ds44-alert-warning">
                        <span className="ds44-alert-icon"><LuClock size={14} /></span>
                        <span>Pendientes de firma: {documentosPendientesFirma.map((d) => d.titulo).join(', ')}.</span>
                      </div>
                    )}
                    {documentosPendientes.length > 0 && (
                      <div className="ds44-alert ds44-alert-danger">
                        <span className="ds44-alert-icon"><FiAlertTriangle size={14} /></span>
                        <span>Faltantes: {documentosPendientesTitulos.join(', ')}.</span>
                      </div>
                    )}
                    {documentosVencidos.length > 0 && (
                      <div className="ds44-alert ds44-alert-warning">
                        <span className="ds44-alert-icon"><LuClock size={14} /></span>
                        <span>{documentosVencidos.length} documento{documentosVencidos.length === 1 ? '' : 's'} vencido{documentosVencidos.length === 1 ? '' : 's'}.</span>
                      </div>
                    )}
                  </div>
                )}
                {/* Estructura preventiva de la FAENA (DS 44 Art. 23): el conteo de
                    personas es por lugar de trabajo, así que un comité constituido en
                    la empresa no exime a esta obra del suyo. Informativo por ahora: las
                    acciones abren el asistente de constitución. */}
                {obra?.tenantId && obraId && (
                  <div style={{ marginBottom: 'var(--space-3)' }}>
                    <div className="ds44-section-label">Estructura preventiva de la obra</div>
                    <EstructuraPreventivaPanel
                      tenantId={obra.tenantId}
                      ambito={AMBITO_ESTRUCTURA.OBRA}
                      obraId={obraId}
                      onConstituir={(tipo) => navigate(`/estructura/constituir?ambito=obra&obraId=${obraId}&tipo=${tipo}`)}
                      onVerOrgano={(id) => navigate(`/estructura/organos/${id}`)}
                    />
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <CompletitudFufPanel
                        tenantId={obra.tenantId}
                        ambito={AMBITO_ESTRUCTURA.OBRA}
                        obraId={obraId}
                      />
                    </div>
                  </div>
                )}
                <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {ds44Docs.map((doc) => {
                    const { firmadas, total } = getSignatureStats(doc.document);
                    const fechaCaducidad = getDocExpiryDate(doc.document);
                    const isExpired = Boolean(fechaCaducidad && new Date(fechaCaducidad) < new Date());
                    const firmasCompletas = total > 0 && firmadas === total;

                    // Documento corporativo (Política SST / Reglamento Interno): fuente
                    // única en Onboarding, aplica a todas las obras. No se sube por obra.
                    if (doc.tenantLevel) {
                      return (
                        <div key={doc.key} className="ds44-doc-row">
                          <div style={{ minWidth: 0 }}>
                            <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                            <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                              {doc.fromEmpresa
                                ? <>Documento de empresa · aplica a todas las obras{doc.empresaPlantilla?.nombre && ` · ${doc.empresaPlantilla.nombre}`}</>
                                : 'Documento de empresa · se gestiona en Onboarding'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                            <span className={`badge ${doc.fromEmpresa ? 'badge-info' : 'badge-danger'}`}>
                              {doc.fromEmpresa ? 'Empresa' : 'Falta en empresa'}
                            </span>
                            {doc.fromEmpresa && doc.empresaPlantilla?.fileKey && (
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                onClick={() => previewEmpresaDoc(doc.empresaPlantilla!.fileKey, doc.empresaPlantilla?.nombre)}
                              >
                                Ver
                              </button>
                            )}
                            <button
                              className={doc.fromEmpresa ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                              type="button"
                              onClick={() => navigate('/cargos-onboarding')}
                            >
                              {doc.fromEmpresa ? 'Gestionar' : 'Subir en Onboarding'}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // Requisito que admite varios documentos (planes de emergencia):
                    // el recuento despliega los planes dentro de la misma fila.
                    if (doc.multiple) {
                      const planes = doc.documentos || [];
                      const stats = planes.map((p: DocumentoApi) => getSignatureStats(p));
                      const pendientes = stats.filter((s) => s.total > 0 && s.firmadas < s.total).length;
                      const badgeClassMulti = planes.length === 0 ? 'badge-danger' : pendientes > 0 ? 'badge-warning' : 'badge-success';
                      const badgeLabelMulti = planes.length === 0 ? 'Sin documento' : pendientes > 0 ? 'Pendiente de firma' : 'Completo';
                      return (
                        <Ds44MultiRow
                          key={doc.key}
                          titulo={doc.titulo}
                          meta={<>
                            <span>{doc.estadoFirma}</span>
                            {planes.length === 0
                              ? <span>Pendiente de carga</span>
                              : pendientes > 0 && <span>{pendientes} pendiente{pendientes === 1 ? '' : 's'} de firma</span>}
                          </>}
                          badgeClass={badgeClassMulti}
                          badgeLabel={badgeLabelMulti}
                          singular="plan"
                          plural="planes"
                          agregarLabel="Agregar plan"
                          onAgregar={() => openDs44Modal({ ...doc, documentId: undefined, document: undefined })}
                          documentos={planes.map((p: DocumentoApi) => resumenDocumento(p, doc))}
                        />
                      );
                    }

                    const badgeClass = isExpired ? 'badge-danger' : firmasCompletas ? 'badge-success' : doc.archivoSubido ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = isExpired ? 'Vencido' : firmasCompletas ? 'Completo' : doc.archivoSubido ? 'Pendiente de firma' : 'Sin documento';
                    const versionActual = doc.document?.version || 1;
                    // El historial se ofrece desde la v1: aunque no haya versiones
                    // archivadas, es donde se ve quién subió el archivo vigente y cuándo.
                    const tieneHistorial = Boolean(doc.document?.documentId) && doc.archivoSubido;
                    const tieneVersionesPrevias = (doc.document?.versiones?.length || 0) > 0;
                    const actualizadoEn = doc.document?.updatedAt || doc.document?.createdAt;
                    const revisadoHace = tiempoRelativo(actualizadoEn);
                    // El PTP arrastra dos hechos que ningún otro documento tiene:
                    // el plazo del Art. 8 desde la MIPER y si lo firmó el
                    // representante legal. Se muestran en su propia fila.
                    const esPtp = doc.key === 'PROGRAMA_TRABAJO_PREVENTIVO';
                    const plazoPtp = esPtp ? etiquetaEstadoPtp(ptpEstado) : null;
                    // Constancia de difusión (Arts. 7 inc. 9, 8 inc. 3, 57 inc. 2).
                    // Informar solo a la línea de mando es el incumplimiento exacto
                    // que el FUF marca en los ítems 4 y 11, así que se distingue.
                    const requiereDifusion = DS44_REQUIEREN_DIFUSION.has(doc.key);
                    const difusion = requiereDifusion ? ultimaDifusion(doc.document) : null;
                    const sinRepresentantes = Boolean(difusion) && (difusion?.totales?.representantes || 0) === 0;
                    return (
                      <div key={doc.key} className="ds44-doc-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                          <div className="text-muted ds44-doc-meta">
                            <span>{doc.estadoFirma}</span>
                            {total > 0 && <span>Firmas {firmadas}/{total}</span>}
                            {doc.archivoSubido && tieneVersionesPrevias && <span className="ds44-doc-ver">v{versionActual}</span>}
                            {doc.archivoSubido && revisadoHace && (
                              <span title={`Última actualización: ${formatDate(actualizadoEn)}`}>
                                Revisado {revisadoHace}
                              </span>
                            )}
                            {fechaCaducidad && <span>{isExpired ? 'Vencido' : 'Caduca'} {formatDate(fechaCaducidad)}</span>}
                            {plazoPtp && (
                              <span
                                style={{ color: ptpEstado.vencido ? 'var(--danger-500, #dc2626)' : undefined, fontWeight: ptpEstado.vencido ? 500 : undefined }}
                                title={ptpEstado.detalle}
                              >
                                {plazoPtp}
                              </span>
                            )}
                            {requiereDifusion && doc.archivoSubido && (
                              <span
                                style={{ color: !difusion || sinRepresentantes ? 'var(--danger-500, #dc2626)' : undefined }}
                                title={descripcionDifusion(difusion)?.titulo
                                  || 'El DS 44 exige informar este documento a los representantes de las personas trabajadoras'}
                              >
                                {!difusion
                                  ? 'Sin constancia de difusión'
                                  : sinRepresentantes
                                    ? 'Difundido sin representantes'
                                    : descripcionDifusion(difusion)?.texto}
                              </span>
                            )}
                            {esPtp && doc.archivoSubido && (
                              <span title="La aprobación del Art. 8 es la firma del representante legal sobre este documento">
                                {ptpAprobado
                                  ? 'Aprobado por el representante legal'
                                  : !representanteLegal
                                    ? 'Sin representante legal designado'
                                    : 'Falta la firma del representante legal'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="ds44-doc-actions">
                          <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                          {doc.archivoSubido ? (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                onClick={() => handlePreviewDocumentFromCard(doc)}
                              >
                                Ver
                              </button>
                              <RowMenu
                                label={`Más acciones de ${doc.titulo}`}
                                items={[
                                  { label: 'Actualizar archivo', onClick: () => openDs44Modal(doc) },
                                  ...(total > 0 ? [{ label: 'Ver firmas', onClick: () => openSignatureModal(doc) }] : []),
                                  ...(tieneHistorial ? [{ label: 'Historial de cambios', onClick: () => openHistorialModal(doc) }] : []),
                                ]}
                              />
                            </>
                          ) : (
                            <button className="btn btn-primary btn-sm" type="button" onClick={() => openDs44Modal(doc)}>
                              Subir
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                </div>

                {/* El IRL y los documentos del cargo se definen UNA vez a nivel empresa
                    (Onboarding por cargo), no por obra. Aquí no se suben plantillas de cargo:
                    la obra solo lleva sus documentos base (arriba) y el cumplimiento por
                    persona se revisa en la fase HACER / sección de onboarding por trabajador. */}
              </>
            )}

            {isDoPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)' }}>
                {/* Configuración del onboarding de ESTA obra. Ambos bloques alimentan
                    `runOnboardingForObra` (personas-module): el backend los lee al
                    vincular un trabajador, así que sin esta UI quedan inalcanzables
                    y toda obra nueva arranca con la configuración vacía. */}
                <ObraPlantillasOnboarding
                  obraId={obraId || ''}
                  tenantId={obra?.tenantId}
                  cargos={cargoCatalog}
                  initial={obra?.plantillasOnboarding}
                  canEdit={canSubirDocumentos}
                  onSaved={(map) => setObra((prev: any) => (prev ? { ...prev, plantillasOnboarding: map } : prev))}
                />
                <ObraAplicabilidadKit
                  obraId={obraId || ''}
                  cargos={cargoCatalog}
                  initial={obra?.aplicabilidadKit}
                  canEdit={canSubirDocumentos}
                  onSaved={(map) => setObra((prev: any) => (prev ? { ...prev, aplicabilidadKit: map } : prev))}
                />

                {/* ── Sección A: Registro AT/EP/Incidentes Peligrosos (Arts. 72-73) ── */}
                <div className="ds44-activity-block">
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                    {/* Info */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                        <LuShieldAlert size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <div className="font-medium">Registro de Actividad Preventiva (Art. 72)</div>
                      </div>
                      <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-2)' }}>
                        Arts. 71-72 DS44 &middot; Documento formal del DO. Consolida toda la actividad preventiva
                        del periodo (capacitaciones, EPP, inducciones, vigilancia) más incidentes e indicadores,
                        firmado con hash verificable. No se reduce a incidentes.
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{actividades.length}</span>
                          <span className="text-muted"> actividad{actividades.length !== 1 ? 'es' : ''} preventiva{actividades.length !== 1 ? 's' : ''}</span>
                        </span>
                        <span style={{ fontSize: '0.82rem' }}>
                          <span style={{ fontWeight: 600 }}>{incidentes.length}</span>
                          <span className="text-muted"> incidente{incidentes.length !== 1 ? 's' : ''}</span>
                        </span>
                        {incidentes.filter(incidenteAbierto).length > 0 && (
                          <span style={{ fontSize: '0.82rem', color: '#f59e0b', fontWeight: 500 }}>
                            {incidentes.filter(incidenteAbierto).length} abierto{incidentes.filter(incidenteAbierto).length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Acciones */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0, alignItems: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => navigate(`/incidents?obraId=${obraId}`)}
                      >
                        <LuFileText size={14} /> Ver incidentes
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        title="Expediente consolidado para fiscalizadores y Organismo Administrador (Art. 72 inc. 1)"
                        disabled={expedienteLoading || !obra?.tenantId}
                        onClick={async () => {
                          if (!obra?.tenantId || !obraId) return;
                          setExpedienteLoading(true);
                          const res = await obrasApi.abrirExpediente(obraId, obra.tenantId);
                          setExpedienteLoading(false);
                          if (!res.ok) alert(res.error || 'No se pudo generar el expediente.');
                        }}
                      >
                        <LuFileText size={14} /> {expedienteLoading ? 'Generando…' : 'Descargar expediente'}
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '6px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => setRegistroSignModal(true)}
                        disabled={exportingRegistro}
                      >
                        <LuDownload size={14} /> Exportar y Firmar
                      </button>
                    </div>
                  </div>
                </div>


                {/* ── Sección: Procedimientos operativos (documento de obra) ── */}
                <div className="ds44-section-label">Procedimientos operativos</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doProcedimientos.filter((p) => p.aplicabilidad !== 'no_aplica').map(({ el, aplicabilidad, estado, firmadas, totalFirmas, document, documentos }) => {
                    const verificar = aplicabilidad === 'verificar';
                    const cf = verificar ? condicionFlag(el.condicion) : null;
                    const badgeClass = estado === 'completo' ? 'badge-success' : estado === 'pendiente_firma' ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = estado === 'completo' ? 'Completo' : estado === 'pendiente_firma' ? 'Pendiente de firma' : 'Faltante';
                    const version = document?.version || 0;

                    // Requisito con varios documentos (plan de gestión y respuesta
                    // ante emergencias): el recuento despliega los planes.
                    if (el.multiple && !verificar) {
                      const pendientes = documentos.filter((d: DocumentoApi) => {
                        const s = getSignatureStats(d);
                        return s.total > 0 && s.firmadas < s.total;
                      }).length;
                      return (
                        <Ds44MultiRow
                          key={el.key}
                          titulo={el.titulo}
                          meta={<>
                            <span>{el.articulo}</span>
                            {documentos.length === 0
                              ? <span>Pendiente de carga</span>
                              : pendientes > 0 && <span>{pendientes} pendiente{pendientes === 1 ? '' : 's'} de firma</span>}
                          </>}
                          badgeClass={badgeClass}
                          badgeLabel={estado === 'faltante' ? 'Faltante' : badgeLabel}
                          singular="plan"
                          plural="planes"
                          agregarLabel="Agregar plan"
                          onAgregar={() => openDoCreate('documento', el, undefined)}
                          documentos={documentos.map((d: DocumentoApi) => resumenDocumentoDo(d, el))}
                        />
                      );
                    }
                    return (
                      <div key={el.key} className="ds44-doc-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>
                            {el.titulo}
                            {version > 1 && <span className="badge badge-neutral" style={{ marginLeft: '6px', fontSize: '0.68rem' }}>v{version}</span>}
                          </div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {el.articulo}
                            {totalFirmas > 0 && ` · Firmas: ${firmadas}/${totalFirmas}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                          {verificar && cf ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{cf.q}</span>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, true)}>Sí</button>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, false)}>No</button>
                            </div>
                          ) : (
                            <>
                              <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('documento', el, document)}>
                                {estado === 'faltante' ? 'Crear / subir' : (document?.s3Key || document?.archivoUrl) ? 'Nueva versión' : 'Actualizar'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Capacitaciones (vinculadas a Actividades) ── */}
                <div className="ds44-section-label">Capacitaciones</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doCapacitaciones.filter((c) => c.aplicabilidad !== 'no_aplica').map(({ el, aplicabilidad, estado }) => {
                    const verificar = aplicabilidad === 'verificar';
                    const cf = verificar ? condicionFlag(el.condicion) : null;
                    const badgeClass = estado === 'completo' ? 'badge-success' : estado === 'pendiente_firma' ? 'badge-warning' : 'badge-danger';
                    const badgeLabel = estado === 'completo' ? 'Ejecutada' : estado === 'pendiente_firma' ? 'Programada (faltan firmas)' : 'Sin actividad';
                    return (
                      <div key={el.key} className="ds44-doc-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{el.articulo} · Se registra como actividad con asistencia firmada</div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                          {verificar && cf ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span className="text-muted" style={{ fontSize: '0.78rem' }}>{cf.q}</span>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, true)}>Sí</button>
                              <button className="btn btn-secondary btn-sm" type="button" disabled={savingObraFlag === cf.flag} onClick={() => handleSetObraFlag(cf.flag, false)}>No</button>
                            </div>
                          ) : (
                            <>
                              <span className={`badge ${badgeClass}`}>{badgeLabel}</span>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('actividad', el)}>
                                Programar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Registros de gestión (read-models, datos del sistema) ── */}
                <div className="ds44-section-label">Registros de gestión</div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                  Se nutren de los datos del sistema; no son documentos a subir y no afectan el %.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doRegistros.map(({ el }) => {
                    // Conteo/estado real segun la naturaleza del registro.
                    const incCount = incidentes.length;
                    const invPend = incidentes.filter((i: any) => ['grave', 'fatal'].includes(i.gravedad) && i.estado !== 'cerrado').length;
                    // Art. 19: el ensayo vale "al menos una vez al año". Preguntar solo si existe
                    // alguno daba por cumplido un simulacro de hace tres años.
                    const hasSimulacro = actividades.some((a: any) => a.tipo === 'SIMULACRO'
                      && !revisionVencida(a.fecha || a.createdAt, 12));
                    const enVigilancia = trabajadores.filter((w: any) => w.vigilanciaSalud?.enVigilancia).length;
                    return (
                      <div key={el.key} className="ds44-doc-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {el.articulo}
                            {el.accion === 'incidentes' && ` · ${incCount} incidente(s)`}
                            {el.accion === 'investigaciones' && ` · ${invPend} investigación(es) pendiente(s)`}
                            {el.accion === 'simulacro' && ` · ${hasSimulacro ? 'Ensayo registrado' : 'Sin ensayo en el periodo'}`}
                            {el.key === 'REG_VIGILANCIA' && ` · ${enVigilancia} en vigilancia`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                          {el.moduloPendiente && <span className="badge badge-warning">Módulo pendiente</span>}
                          {el.accion === 'incidentes' && (
                            <>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver incidentes</button>
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}&nuevo=1`)}>Reportar</button>
                            </>
                          )}
                          {el.accion === 'investigaciones' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}&tab=investigaciones`)}>Ver investigaciones</button>
                          )}
                          {el.accion === 'simulacro' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('actividad', { titulo: 'Ensayo anual del plan de emergencias', activityTipo: 'SIMULACRO', tipo: 'SIMULACRO' })}>
                              Programar simulacro
                            </button>
                          )}
                          {el.accion === 'consulta' && (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => el.modulo && navigate(el.modulo)}>Ver</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Sección: Registros de ejecución (evidencia de que se hizo) ── */}
                <div className="ds44-section-label">Registros de ejecución</div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                  Evidencia de que la actividad ocurrió (actas, fotos). La sube la obra; cuentan en el %.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {doRegistrosEjecucion.filter((r) => r.aplicabilidad !== 'no_aplica').map(({ el, aplicabilidad, documentos, ultimaFecha, estado }) => {
                    const abierto = expandedRegistros.has(el.key);
                    return (
                    <div key={el.key} style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)' }}>
                      <div className="ds44-doc-row" style={{ border: 'none' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{el.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                            {el.articulo}
                            {` · ${documentos.length > 0 ? `${documentos.length} registro(s)` : 'Sin registros'}`}
                            {ultimaFecha && tiempoRelativo(ultimaFecha) && ` · último ${tiempoRelativo(ultimaFecha)}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                          {aplicabilidad === 'verificar' && <span className="badge badge-warning">Verificar si aplica</span>}
                          {estado === 'vencido' && <span className="badge badge-danger">Vencido</span>}
                          {estado === 'completo' && <span className="badge badge-success">Vigente</span>}
                          {documentos.length > 0 && (
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              aria-expanded={abierto}
                              onClick={() => setExpandedRegistros((prev) => {
                                const next = new Set(prev);
                                if (next.has(el.key)) next.delete(el.key); else next.add(el.key);
                                return next;
                              })}
                            >
                              {abierto ? 'Ocultar' : 'Ver registros'}
                            </button>
                          )}
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('documento', el)}>
                            {documentos.length === 0 ? 'Registrar' : 'Registrar otro'}
                          </button>
                        </div>
                      </div>
                      {abierto && (
                        <div style={{ borderTop: '1px solid var(--surface-border)', padding: 'var(--space-2) var(--space-3)', display: 'grid', gap: '6px' }}>
                          {documentos.map((doc: DocumentoApi) => {
                            const f = doc.fecha || doc.createdAt || null;
                            const caduco = Boolean(el.vigenciaMeses && revisionVencida(f, el.vigenciaMeses));
                            return (
                              <div key={doc.documentId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: '0.83rem' }}>
                                <div style={{ minWidth: 0 }}>
                                  <span>{f ? new Date(f).toLocaleDateString('es-CL') : 'Sin fecha'}</span>
                                  <span className="text-muted"> · {doc.archivoNombre || doc.titulo}</span>
                                  {caduco && <span className="text-muted"> · fuera de vigencia</span>}
                                </div>
                                <button className="btn btn-ghost btn-sm" type="button" onClick={() => openDoCreate('documento', el, doc)}>
                                  Corregir
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                {/* ── Sección: Eventos sobrevinientes ── */}
                <div className="ds44-section-label">Eventos sobrevinientes</div>
                <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 'var(--space-2)' }}>
                  Se generan solo ante el hecho. No cuentan como faltante en el cumplimiento.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                  {DS44_DO_EVENTOS.map((ev) => {
                    const ocurrencias = obraDocs.filter((d: any) => d.tipo === ev.tipo).length;
                    return (
                      <div key={ev.key} className="ds44-doc-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{ev.titulo}</div>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>{ev.articulo} · {ocurrencias > 0 ? `${ocurrencias} registro(s)` : 'Sin eventos'}</div>
                        </div>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => openDoCreate('documento', ev)}>
                          Registrar
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            {isCheckPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Consolidado del periodo */}
                <div className="card" style={{ padding: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                    <div className="font-medium">Consolidado del periodo (Arts. 14, 22.4)</div>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={loadCheckConsolidado} disabled={loadingCheck}>
                      {loadingCheck ? 'Cargando…' : checkConsolidado ? 'Actualizar' :'Consolidar periodo'}
                    </button>
                  </div>
                  {checkConsolidado ? (
                    <>
                      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Accidentes</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.indicadores?.numeroAccidentes ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Tasa frecuencia</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.indicadores?.tasaFrecuencia ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Investigaciones (pend./cerr.)</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                            <span style={{ color: (checkConsolidado.investigacionesATEP?.pendientes ?? 0) > 0 ? '#f59e0b' : undefined }}>{checkConsolidado.investigacionesATEP?.pendientes ?? 0}</span>
                            {' / '}{checkConsolidado.investigacionesATEP?.cerradas ?? 0}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>Medidas vencidas</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: (checkConsolidado.medidasCorrectivas?.vencidas ?? 0) > 0 ? '#ef4444' : undefined }}>{checkConsolidado.medidasCorrectivas?.vencidas ?? 0}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '120px' }}>
                          <div className="text-muted" style={{ fontSize: '0.78rem' }}>En vigilancia salud</div>
                          <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{checkConsolidado.vigilancia?.enVigilancia ?? 0}</div>
                        </div>
                      </div>
                      {(checkConsolidado.medidasCorrectivas?.total ?? 0) > 0 && (
                        <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: 'var(--space-2)' }}>
                          Medidas correctivas: {checkConsolidado.medidasCorrectivas.implementadas}/{checkConsolidado.medidasCorrectivas.total} implementadas · {checkConsolidado.medidasCorrectivas.verificadas} verificadas
                        </div>
                      )}
                      {(checkConsolidado.causasRecurrentes?.length ?? 0) > 0 && (
                        <div style={{ marginTop: 'var(--space-2)', padding: '8px 12px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.8rem', color: '#92400e' }}>
                          <strong>Causas raíz recurrentes (desviación sistémica):</strong>
                          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                            {checkConsolidado.causasRecurrentes.map((c: any, i: number) => (
                              <li key={i}>{c.descripcion} <span className="text-muted">({c.incidentes} incidentes)</span></li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                      Consolida los indicadores de siniestralidad, investigaciones y vigilancia del periodo.
                    </div>
                  )}
                </div>

                {/* ── Investigaciones AT/EP pendientes (Art. 71) — cerrar + firmar informe ── */}
                {(() => {
                  const pendientes = incidentes.filter((i: any) => (['grave', 'fatal'].includes(i.gravedad) || i.esFatal) && i.estado !== 'cerrado');
                  if (pendientes.length === 0) return null;
                  return (
                    <div className="card" style={{ padding: 'var(--space-4)' }}>
                      <div className="font-medium" style={{ marginBottom: 'var(--space-1)' }}>Investigaciones AT/EP pendientes (Art. 71)</div>
                      <div className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 'var(--space-2)' }}>
                        Obligatorias para incidentes graves/fatales. Cerrar genera el informe firmado (árbol de causas) como respaldo del Registro Art. 72.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {pendientes.map((inc: any) => (
                          <div key={inc.incidentId} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: 0 }}>
                              <div className="font-medium" style={{ fontSize: '0.9rem' }}>{inc.descripcion || inc.incidentId}</div>
                              <div className="text-muted" style={{ fontSize: '0.78rem' }}>{inc.fecha || ''} · {inc.gravedad}{inc.esFatal ? ' (fatal)' : ''} · {(inc.medidasCorrectivas || []).length} medida(s)</div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                              <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver / investigar</button>
                              <button className="btn btn-primary btn-sm" type="button" onClick={() => { setCerrarInvModal({ incidentId: inc.incidentId, descripcion: inc.descripcion || inc.incidentId }); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}>
                                Cerrar y firmar informe
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Documentos de la Fase CHECK */}
                {DS44_CHECK_DOCS.map((doc) => {
                  const aplica = doc.condicional !== 'mas_100_trabajadores' || dotacionEntidad > 100;
                  if (!aplica) return null;

                  const existing = obraDocs.find((d: any) => d.tipo === doc.tipo);
                  const subido = Boolean(existing?.s3Key || existing?.archivoUrl) || Boolean(existing);
                  return (
                    <div key={doc.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>{doc.articulo}{doc.descripcion ? ` · ${doc.descripcion}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                        <span className={`badge ${subido ? 'badge-success' : doc.obligatorio ? 'badge-danger' : 'badge-info'}`}>
                          {subido ? 'Registrado' : doc.obligatorio ? 'Pendiente' : 'Opcional'}
                        </span>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/documents?obraId=${obraId}&tipo=${doc.tipo}`)}>
                          Gestionar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isActPhase && (
              <div style={{ maxHeight: '520px', overflowY: 'auto', paddingRight: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                {/* Medidas correctivas — solo visible cuando hay datos o está cargando */}
                {(loadingMedidas || (medidas?.medidas?.length ?? 0) > 0) && (
                  <div className="card" style={{ padding: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: loadingMedidas ? 0 : 'var(--space-3)' }}>
                      <div>
                        <div className="font-medium">Medidas correctivas</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>De investigaciones AT/EP · Art. 71</div>
                      </div>
                      {medidas?.resumen && (
                        <div className="text-muted" style={{ fontSize: '0.8rem', flexShrink: 0 }}>
                          {medidas.resumen.verificadas}/{medidas.resumen.total} verificadas
                          {medidas.resumen.vencidas > 0 && ` · ${medidas.resumen.vencidas} vencida(s)`}
                        </div>
                      )}
                    </div>
                    {loadingMedidas ? (
                      <div className="text-muted" style={{ fontSize: '0.85rem' }}>Cargando medidas…</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {medidas!.medidas.map((m: any, idx: number) => {
                          const nextEstado: Record<string, 'en_proceso' | 'completada' | 'verificada'> = { pendiente: 'en_proceso', en_proceso: 'completada', completada: 'verificada' };
                          const next = nextEstado[m.estado as string];
                          const nextLabel: Record<string, string> = { en_proceso: 'Marcar en proceso', completada: 'Marcar implementada', verificada: 'Marcar verificada' };
                          const estadoLabel: Record<string, string> = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Implementada', verificada: 'Verificada' };
                          const estadoClass = m.estado === 'verificada' ? 'badge-success' : m.vencida ? 'badge-danger' : m.estado === 'completada' ? 'badge-info' : 'badge-warning';
                          const key = `${m.incidentId}:${m.numero}`;
                          return (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: idx < medidas!.medidas.length - 1 ? '1px solid var(--surface-border)' : 'none', flexWrap: 'wrap' }}>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '2px', flexWrap: 'wrap' }}>
                                  <span className={`badge ${estadoClass}`}>{m.vencida && m.estado !== 'verificada' ? 'Vencida' : estadoLabel[m.estado]}</span>
                                  <div className="font-medium" style={{ fontSize: '0.9rem' }}>{m.medida || '(sin descripción)'}</div>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                                  Causa raíz: {m.causaRaiz || '—'}
                                  {m.responsableNombre && ` · Responsable: ${m.responsableNombre}`}
                                  {m.fechaMaxEjecucion && ` · Plazo: ${m.fechaMaxEjecucion}`}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                                <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/incidents?obraId=${obraId}`)}>Ver origen</button>
                                {next && (
                                  <button className="btn btn-primary btn-sm" type="button" disabled={savingMedida === key} onClick={() => avanzarMedida(m.incidentId, m.numero, next)}>
                                    {savingMedida === key ? '...' : nextLabel[next]}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Documentos de la Fase ACT */}
                {DS44_ACT_DOCS.map((doc) => {
                  const existing = obraDocs.find((d: any) => d.tipo === doc.tipo);
                  const subido = Boolean(existing);
                  return (
                    <div key={doc.key} className="card" style={{ padding: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="font-medium" style={{ fontSize: '0.9rem' }}>{doc.titulo}</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>{doc.articulo}{doc.descripcion ? ` · ${doc.descripcion}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
                        <span className={`badge ${subido ? 'badge-success' : 'badge-danger'}`}>{subido ? 'Registrado' : 'Pendiente'}</span>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate(`/documents?obraId=${obraId}&tipo=${doc.tipo}`)}>
                          Gestionar
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Actualizaciones condicionales que cierran el ciclo Deming */}
                <div className="card" style={{ padding: 'var(--space-4)' }}>
                  <div className="font-medium" style={{ marginBottom: 'var(--space-3)' }}>Actualizaciones (cierre de ciclo hacia PLAN)</div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {actActualizaciones.map(({ act, estado, actualizadoEn, aprobacionPendiente, detalle }, idx) => (
                      <div key={act.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: idx < actActualizaciones.length - 1 ? '1px solid var(--surface-border)' : 'none', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="font-medium" style={{ fontSize: '0.88rem' }}>{act.titulo}</div>
                          <div className="text-muted ds44-doc-meta" style={{ fontSize: '0.78rem' }}>
                            <span>{act.articulo}</span>
                            {estado === 'sin_documento'
                              ? <span>Sin documento cargado</span>
                              : actualizadoEn && tiempoRelativo(actualizadoEn) && (
                                <span title={`Última actualización: ${formatDate(actualizadoEn)}`}>
                                  Revisado {tiempoRelativo(actualizadoEn)}
                                </span>
                              )}
                            {detalle && <span title={detalle}>{detalle}</span>}
                            {aprobacionPendiente && (
                              <span style={{ color: 'var(--danger-500, #dc2626)' }}>
                                Falta la firma del representante legal
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0, flexWrap: 'wrap' }}>
                          {estado === 'sin_documento' && <span className="badge badge-danger">Sin documento</span>}
                          {estado === 'vencida' && <span className="badge badge-danger">Vencida</span>}
                          {estado === 'al_dia' && !aprobacionPendiente && <span className="badge badge-success">Al día</span>}
                          {/* La ruta /documents no existe (solo /documents-repository),
                              así que este botón caía en el catch-all y devolvía al
                              dashboard. Estos documentos son de ESTA obra y ya están
                              en pantalla: lo correcto es llevar a su fase, no salir. */}
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setSelectedDemingPhase('plan')}>
                            Revisar documento
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 'var(--space-3)', padding: '8px 12px', borderRadius: '6px', background: 'var(--surface-base)', border: '1px solid var(--surface-border)', fontSize: '0.78rem' }} className="text-muted">
                    Nota: la evaluación OAL de cotización adicional (DS67/1999) es un proceso externo al SGSST; no se modela como documento obligatorio del sistema.
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
          {faseDeming === 'plan' && planCompleto && (
            <div className="card" style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '1.1rem', marginBottom: 'var(--space-1)' }}>
                    <LuCircleCheck size={18} /> Fase PLANIFICAR completada
                  </div>
                  <div style={{ opacity: 0.9, fontSize: '0.9rem' }}>
                    Todos los documentos de la Fase PLAN han sido subidos. La Fase HACER (DO) se activará automáticamente.
                  </div>
                </div>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {activatingFaseDeming ? 'Activando Fase HACER...' : 'Activación en curso'}
                </div>
              </div>
            </div>
          )}
          </div>
        )}

        {/* ── TAB: EQUIPO ─────────────────────────────────────────────────────── */}
        {activeTab === 'equipo' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Cabecera de sección */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>
                  Equipo en obra
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {activeWorkers.length} activos · {onboardingSummary.progress}% onboarding completado
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {canFirmaAsistida && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setFirmaAsistidaOpen(true)}>
                    Firma asistida
                  </button>
                )}
                {hasPermission(PERMISSIONS.CARGOS_GESTIONAR) && (
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate('/cargos-onboarding')} title="Kit de onboarding por cargo (nivel empresa)">
                    <LuSettings size={14} /> Kit empresa
                  </button>
                )}
                {canAsignarTrabajadores && (
                  <button className="btn btn-primary btn-sm" onClick={() => navigate(`/obras/${obraId}/equipo`)}>
                    <LuUserPlus size={14} /> Gestionar equipo
                  </button>
                )}
              </div>
            </div>

            {/* Barra de progreso global */}
            {activeWorkers.length > 0 && (
              <div style={{ height: '6px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)' }}>
                <div style={{ width: `${onboardingSummary.progress}%`, height: '100%', background: 'linear-gradient(90deg, #006edc, #004fa3)', transition: 'width 300ms ease' }} />
              </div>
            )}

            {/* Lista de trabajadores */}
            {trabajadores.length === 0 ? (
              <div className="card" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
                <LuUsers size={28} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }} />
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                  No hay trabajadores asignados.{canAsignarTrabajadores && <> <button className="btn-link" style={{ fontSize: 'inherit', color: 'var(--accent)' }} onClick={() => navigate(`/obras/${obraId}/equipo`)}>Agregar trabajadores</button>.</>}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {onboardingPorCargo.map((grupo) => {
                  // Con un solo cargo no hay nada que elegir: se muestra abierto.
                  const grupoAbierto = expandedCargos.has(grupo.cargo) || onboardingPorCargo.length === 1;
                  const pctGrupo = grupo.total > 0 ? Math.round((grupo.completed / grupo.total) * 100) : 0;
                  return (
                  <div key={grupo.cargo} style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--surface-elevated)' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedCargos((prev) => {
                        const next = new Set(prev);
                        if (next.has(grupo.cargo)) next.delete(grupo.cargo); else next.add(grupo.cargo);
                        return next;
                      })}
                      disabled={onboardingPorCargo.length === 1}
                      aria-expanded={grupoAbierto}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', background: 'transparent', border: 'none', cursor: onboardingPorCargo.length === 1 ? 'default' : 'pointer', textAlign: 'left' }}
                    >
                      <FiChevronRight
                        size={16}
                        style={{ flexShrink: 0, color: 'var(--text-muted)', transform: grupoAbierto ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease' }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="font-medium" style={{ fontSize: '0.9rem' }}>{grupo.cargo}</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem' }}>
                          {grupo.workers.length} {grupo.workers.length === 1 ? 'persona' : 'personas'} · {grupo.completed}/{grupo.total} ítems
                          {grupo.sinApto > 0 && ` · ${grupo.sinApto} sin apto para terreno`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                        <div style={{ width: 60, height: '5px', borderRadius: '999px', overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--surface-border)' }}>
                          <div style={{ width: `${pctGrupo}%`, height: '100%', background: 'linear-gradient(90deg, #006edc, #004fa3)' }} />
                        </div>
                        <span className="text-muted" style={{ fontSize: '0.78rem', minWidth: '32px', textAlign: 'right' }}>{pctGrupo}%</span>
                      </div>
                    </button>
                    {grupoAbierto && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2)', borderTop: '1px solid var(--surface-border)', background: 'var(--surface)' }}>
                {grupo.workers.map((worker) => {
                  const pct = worker.total > 0 ? Math.round((worker.completed / worker.total) * 100) : 0;
                  const isExpanded = expandedWorkers.has(worker.workerId);
                  const hasPendingFirma = ((worker as any).itemDetail as any[]).some(
                    (item) => item.estado === 'pendiente_firma' && !item.trabajadorFirmo && (item.kind === 'document' || item.kind === 'signature')
                  );
                  const ini = `${(worker.nombre || '')[0] ?? ''}${(worker.nombre || '').split(' ')[1]?.[0] ?? ''}`.toUpperCase();
                  return (
                    <div key={worker.workerId} style={{ border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--surface)' }}>
                      {/* Fila principal */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', flexWrap: 'wrap' }}>
                        {/* Avatar */}
                        <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', background: 'rgba(0,110,220,0.1)', color: '#4d9fff', border: '1.5px solid rgba(0,110,220,0.2)' }}>
                          {ini || <LuUsers size={14} />}
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{worker.nombre}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{(worker as any).cargo || 'Trabajador'}</div>
                        </div>
                        {/* Progreso + badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <div style={{ width: 72, height: 5, borderRadius: '999px', background: 'var(--surface-elevated)', overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444', transition: 'width 300ms' }} />
                          </div>
                          <span className={`badge ${pct >= 80 ? 'badge-success' : pct >= 50 ? 'badge-warning' : 'badge-danger'}`} style={{ minWidth: 42, textAlign: 'center', fontSize: '0.7rem' }}>
                            {worker.completed}/{worker.total}
                          </span>
                          {(worker as any).aptoTerreno
                            ? <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}><LuCircleCheck size={11} /> Apto</span>
                            : <span style={{ fontSize: '0.7rem', color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}><LuShieldAlert size={11} /> {(worker as any).bloqueantesPendientes} bloq.</span>
                          }
                        </div>
                        {/* Acciones */}
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {canFirmaAsistida && hasPendingFirma && (
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                              onClick={() => { setFirmaAsistidaWorkerId(worker.workerId); setFirmaAsistidaOpen(true); }}
                            >
                              Firmar
                            </button>
                          )}
                          <button
                            onClick={() => toggleExpandWorker(worker.workerId)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center' }}
                          >
                            {isExpanded ? <LuChevronUp size={16} /> : <LuChevronDown size={16} />}
                          </button>
                        </div>
                      </div>

                      {/* Checklist expandible */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid var(--surface-border)', padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--surface-base)' }}>
                          {((worker as any).itemDetail as any[]).map((item) => {
                            const estado = item.estado as 'pendiente_asignar' | 'pendiente_firma' | 'completo';
                            const soloFaltaRelator = estado === 'pendiente_firma' && item.firmaRelatorPendiente && item.trabajadorFirmo;
                            const estadoLabel = estado === 'completo' ? 'Completo'
                              : soloFaltaRelator ? 'Pendiente firma relator'
                              : estado === 'pendiente_firma' ? 'Pendiente de firma'
                              : 'Pendiente de asignar';
                            const estadoColor = estado === 'completo' ? '#10b981' : estado === 'pendiente_firma' ? '#f59e0b' : 'var(--text-muted)';
                            return (
                              <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--surface-border)', gap: 'var(--space-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
                                  {estado === 'completo'
                                    ? <LuCircleCheck size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                                    : <LuClock size={14} style={{ color: estadoColor, flexShrink: 0 }} />
                                  }
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: '0.84rem', fontWeight: estado === 'completo' ? 400 : 500, color: estado === 'completo' ? 'var(--text-muted)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {item.label}
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: estadoColor }}>{item.articulo} · {estadoLabel}</div>
                                  </div>
                                </div>
                                {estado !== 'completo' && (
                                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                    {/* Naturaleza encuesta → asignar encuesta precargada a esta persona. */}
                                    {item.accion === 'ENCUESTA' && canAsignarTrabajadores && (
                                      <button
                                        className="btn btn-primary"
                                        style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                        onClick={() => agendarItem(worker, item)}
                                      >
                                        Asignar encuesta
                                      </button>
                                    )}
                                    {/* Naturaleza capacitación → agendar actividad precargada (cargo/obra/persona). */}
                                    {item.accion === 'CAPACITACION_EVALUACION' && estado === 'pendiente_asignar' && canAsignarTrabajadores && (
                                      <button
                                        className="btn btn-secondary"
                                        style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                        onClick={() => agendarItem(worker, item)}
                                        title="Agendar la capacitación de este ítem para esta persona"
                                      >
                                        Agendar
                                      </button>
                                    )}
                                    {item.kind === 'document' && item.accion !== 'ENCUESTA' && estado === 'pendiente_asignar' && canSubirDocumentos && (
                                      <>
                                        <input
                                          type="file"
                                          id={`wd-${worker.workerId}-${item.key}`}
                                          style={{ display: 'none' }}
                                          accept="application/pdf,image/*"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleInlineWorkerUpload(worker.workerId, item.tipo, file);
                                            e.target.value = '';
                                          }}
                                        />
                                        <button
                                          className="btn btn-secondary"
                                          style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                          disabled={uploadingWorkerDoc === `${worker.workerId}:${item.tipo}`}
                                          onClick={() => document.getElementById(`wd-${worker.workerId}-${item.key}`)?.click()}
                                        >
                                          {uploadingWorkerDoc === `${worker.workerId}:${item.tipo}` ? '...' : 'Subir'}
                                        </button>
                                      </>
                                    )}
                                    {estado === 'pendiente_firma' && !item.trabajadorFirmo && (item.kind === 'document' || item.kind === 'signature') && canFirmaAsistida && (
                                      <button
                                        className="btn btn-primary"
                                        style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                        onClick={() => { setFirmaAsistidaWorkerId(worker.workerId); setFirmaAsistidaTipo(item.tipo); setFirmaAsistidaOpen(true); }}
                                      >
                                        Firma asistida
                                      </button>
                                    )}
                                    {estado === 'pendiente_firma' && item.firmaRelatorPendiente && item.documentId && user?.permisos?.includes('firmar_relator') && (
                                      <button
                                        className="btn btn-secondary"
                                        style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                        onClick={() => { setRelatorSign({ documentId: item.documentId, titulo: item.label }); setRelatorPin(''); setRelatorModalidad(''); setRelatorError(null); }}
                                      >
                                        Firmar como relator
                                      </button>
                                    )}
                                    {item.kind === 'signature' && estado === 'pendiente_asignar' && (
                                      <span className="text-muted" style={{ fontSize: '0.72rem' }}>Pendiente de asignar</span>
                                    )}
                                    {item.kind === 'actividad' && (
                                      <button
                                        className="btn btn-secondary"
                                        style={{ padding: '2px 10px', fontSize: '0.75rem' }}
                                        onClick={() => navigate('/activities')}
                                      >
                                        {estado === 'pendiente_firma' ? 'Ver actividad' : 'Programar'}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {estado === 'completo' && (
                                  <LuCircleCheck size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                      </div>
                    )}
                  </div>
                  );
                })}

                {/* Inactivos */}
                {inactiveWorkers.length > 0 && (
                  <details style={{ marginTop: 'var(--space-1)' }}>
                    <summary style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', padding: 'var(--space-2) 0', listStyle: 'none' }}>
                      ▶ Dados de baja · {inactiveWorkers.length}
                    </summary>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      {inactiveWorkers.map((worker) => (
                        <div key={worker.personaId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', opacity: 0.65, background: 'var(--surface)' }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-hover)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                            {`${(worker.nombre || '')[0] ?? ''}${(worker.nombre || '').split(' ')[1]?.[0] ?? ''}`.toUpperCase() || '?'}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{worker.nombre} {worker.apellido || ''}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{worker.cargo || 'Trabajador'} · {worker.rut}</div>
                          </div>
                          <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>Baja</span>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            onClick={() => handleReactivateWorker(worker)}
                            disabled={updatingWorkers === worker.personaId}
                          >
                            Reactivar
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {obraToast && (
          <div style={{
            position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
            background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white',
            padding: '14px 20px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(16,185,129,0.4)',
            display: 'flex', alignItems: 'center', gap: '10px',
            animation: 'fadeInRight 0.3s ease',
            maxWidth: '340px', fontSize: '0.9rem', fontWeight: 500
          }}>
            <LuCircleCheck size={20} style={{ flexShrink: 0 }} />
            <div>{obraToast}</div>
          </div>
        )}
        {planToast && (
          <div style={{
            position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
            background: 'linear-gradient(135deg,#10b981,#059669)', color: 'white',
            padding: '14px 20px', borderRadius: '12px', boxShadow: '0 4px 24px rgba(16,185,129,0.4)',
            display: 'flex', alignItems: 'center', gap: '10px',
            animation: 'fadeInRight 0.3s ease',
            maxWidth: '340px', fontSize: '0.9rem', fontWeight: 500
          }}>
            <LuCircleCheck size={20} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 700 }}>¡Fase PLAN completada!</div>
              <div style={{ opacity: 0.9, fontSize: '0.82rem' }}>La obra avanza automáticamente a la Fase DO.</div>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isDs44ModalOpen}
        onClose={() => {
          setIsDs44ModalOpen(false);
          setPendingDs44File(null);
          setDs44Motivo('');
          setDs44Participantes([]);
          setDs44ParticipantesDetalle('');
        }}
        title={selectedDs44Doc?.titulo ? `Documento DS44 - ${selectedDs44Doc.titulo}` : 'Documento DS44'}
        subtitle="Sube el archivo, selecciona firmantes y define caducidad"
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsDs44ModalOpen(false)} disabled={ds44Saving || uploadingKey === selectedDs44Doc?.key}>
              Cerrar
            </button>
            <button className="btn btn-primary" onClick={handleSaveDs44Changes} disabled={ds44Saving || uploadingKey === selectedDs44Doc?.key}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {/* Cuando el requisito admite varios documentos, el nombre es lo único
              que los distingue en la lista, así que se pide al subir. */}
          {selectedDs44Doc?.multiple && (
            <div className="form-group">
              <label className="form-label" htmlFor="ds44-titulo">Nombre del plan</label>
              <input
                id="ds44-titulo"
                className="form-input"
                value={ds44Titulo}
                maxLength={120}
                placeholder="Ej: Plan de evacuación — Torre A"
                onChange={(e) => setDs44Titulo(e.target.value)}
              />
              <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                Distingue este plan de los demás de la obra.
              </span>
            </div>
          )}
          <div className="ds44-expiry-section">
            <div className="ds44-expiry-toggle">
              <label className="ds44-toggle-label" htmlFor="expiry-toggle">
                <div className="ds44-toggle-text">
                  <span className="ds44-toggle-title">Aplica caducidad</span>
                  <span className="ds44-toggle-hint">
                    {expiryApplicable
                      ? `Si no eliges una fecha, caduca en ${MESES_VIGENCIA_DEFECTO} meses`
                      : 'Sin fecha de vencimiento'}
                  </span>
                </div>
                <div className="ds44-switch-wrapper">
                  <input
                    type="checkbox"
                    id="expiry-toggle"
                    className="ds44-switch-input"
                    checked={expiryApplicable}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setExpiryApplicable(checked);
                      if (!checked) {
                        setSelectedExpiryDate('');
                      }
                    }}
                  />
                  <span className="ds44-switch-track">
                    <span className="ds44-switch-thumb" />
                  </span>
                </div>
              </label>
            </div>
            <div className={`ds44-date-picker-container ${expiryApplicable ? 'ds44-date-visible' : ''}`}>
              <label className="form-label" style={{ marginBottom: 'var(--space-2)' }}>Fecha de caducidad</label>
              <div className="ds44-date-presets">
                {[
                  { label: '3 meses', months: 3 },
                  { label: '6 meses', months: 6 },
                  { label: '1 año', months: 12 },
                  { label: '2 años', months: 24 },
                ].map((preset) => {
                  const presetDate = new Date();
                  presetDate.setMonth(presetDate.getMonth() + preset.months);
                  const presetValue = presetDate.toISOString().split('T')[0];
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      className={`ds44-date-preset-btn ${selectedExpiryDate === presetValue ? 'active' : ''}`}
                      onClick={() => setSelectedExpiryDate(presetValue)}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="ds44-date-input-wrapper">
                <input
                  className="form-input ds44-date-input"
                  type="date"
                  value={selectedExpiryDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(event) => setSelectedExpiryDate(event.target.value)}
                />
                {selectedExpiryDate && (
                  <div className="ds44-date-display">
                    Caduca el {new Date(selectedExpiryDate + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div
            style={{
              border: '1px dashed var(--surface-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-4)',
              background: 'var(--surface-elevated)',
              display: 'grid',
              gap: 'var(--space-3)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className="avatar" style={{ background: 'var(--surface-hover)', color: 'var(--primary-500)' }}>
                <FiUploadCloud size={20} />
              </div>
              <div>
                <div className="font-medium">Subir documento</div>
                <div className="text-muted">
                  {pendingDs44File?.name || selectedDs44Detail?.archivoNombre || 'PDF requerido para completar el DS44'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {canSubirDocumentos && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingKey === selectedDs44Doc?.key || ds44Loading}
                >
                  {pendingDs44File ? 'Cambiar archivo' : selectedDs44Detail?.archivoUrl ? 'Actualizar archivo' : 'Seleccionar archivo'}
                </button>
              )}
              <button
                className="btn btn-secondary"
                type="button"
                onClick={handlePreviewDocument}
                disabled={!selectedDs44Detail?.archivoUrl && !selectedDs44Detail?.s3Key || ds44Previewing}
              >
                <FiEye /> Ver documento
              </button>
            </div>
          </div>

          {/* Reemplazar el archivo de un documento versionable (MIPER) no lo
              sobrescribe: publica una versión y obliga a re-firmar. Se avisa antes
              de guardar, porque invalida firmas ya recogidas. */}
          {ds44EsVersionable(selectedDs44Doc, selectedDs44Detail) && pendingDs44File && (
            <div className="form-group">
              <label className="form-label" htmlFor="ds44-motivo">
                Motivo de la revisión
              </label>
              <textarea
                id="ds44-motivo"
                className="form-input"
                rows={2}
                maxLength={300}
                value={ds44Motivo}
                placeholder="Ej: se incorporó el riesgo de sílice tras el cambio de faena"
                onChange={(e) => setDs44Motivo(e.target.value)}
              />
              <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                Se publica la <strong>v{(selectedDs44Detail?.version || 1) + 1}</strong>. La versión
                anterior queda en el historial, se avisa a la línea de mando y las
                {' '}{selectedWorkerIds.length > 0 ? `${selectedWorkerIds.length} firmas` : 'firmas'} recogidas
                dejan de ser válidas: el personal debe firmar de nuevo.
              </span>

              {/* FUF 51 / Art. 57 inc. 5: participantes de la revisión. */}
              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
                <label className="form-label">Participantes de la revisión</label>
                <span className="text-muted" style={{ fontSize: 'var(--text-xs)', marginTop: 'calc(-1 * var(--space-1))' }}>
                  Marca quiénes participaron en la revisión (Art. 57 inc. 5). Queda en el registro de control de cambios.
                </span>
                <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                  {ENTIDADES_REVISION.map((ent) => (
                    <label key={ent.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ds44Participantes.includes(ent.id)}
                        onChange={(e) => setDs44Participantes((prev) =>
                          e.target.checked ? [...prev, ent.id] : prev.filter((x) => x !== ent.id),
                        )}
                      />
                      <span style={{ fontSize: 'var(--text-sm)' }}>{ent.label}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  className="form-input"
                  rows={2}
                  maxLength={300}
                  value={ds44ParticipantesDetalle}
                  placeholder="Nombres de los participantes o referencia al acta de la reunión (opcional)"
                  onChange={(e) => setDs44ParticipantesDetalle(e.target.value)}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <div className="font-medium">Firmantes requeridos</div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asignados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                {trabajadores.map((worker, index) => (
                  <label
                    key={worker.personaId}
                    className="checkbox-row"
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      cursor: 'pointer',
                      borderBottom: index === trabajadores.length - 1 ? 'none' : '1px solid var(--surface-border)'
                    }}
                  >
                    <input
                      type="checkbox"
                      className="checkbox-input custom-checkbox"
                      checked={selectedWorkerIds.includes(worker.personaId)}
                      onChange={() => toggleWorkerSelection(worker.personaId)}
                    />
                    <span>{worker.nombre} {worker.apellido || ''}</span>
                    <span className="text-muted">({worker.rut})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

        </div>
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleDs44FileChange}
        style={{ display: 'none' }}
      />

      {/* ── Modal: Firma asistida (trabajador firma con su PIN en el dispositivo del admin) ── */}
      {obraId && user?.personaId && (
        <FirmaAsistidaModal
          isOpen={firmaAsistidaOpen}
          onClose={() => { setFirmaAsistidaOpen(false); setFirmaAsistidaWorkerId(undefined); setFirmaAsistidaTipo(undefined); }}
          obraId={obraId}
          workers={trabajadores}
          asistidoPor={user.personaId}
          initialWorkerId={firmaAsistidaWorkerId}
          initialTipo={firmaAsistidaTipo}
          onSigned={() => { reloadObraData(); }}
        />
      )}

      {/* ── Modal inline: crear procedimiento/evento (documento) o programar capacitación (actividad) ── */}
      <Modal
        isOpen={!!doCreateModal}
        onClose={() => setDoCreateModal(null)}
        title={doCreateModal?.mode === 'actividad' ? (doCreateModal?.el?.activityTipo === 'SIMULACRO' ? 'Programar simulacro' : 'Programar capacitación') : 'Crear / subir documento'}
        subtitle={doCreateModal ? `${doCreateModal.el.titulo} · ${doCreateModal.el.articulo}` : ''}
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => setDoCreateModal(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={submitDoCreate} disabled={doCreateSaving}>
              {doCreateSaving ? 'Guardando…' : doCreateModal?.mode === 'actividad' ? 'Programar' : 'Guardar'}
            </button>
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {doCreateError && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
              {doCreateError}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Título</label>
            <input className="form-input" value={doCreateForm.titulo} onChange={(e) => setDoCreateForm((p) => ({ ...p, titulo: e.target.value }))} />
          </div>

          {doCreateModal?.mode === 'actividad' ? (
            <>
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" className="form-input" value={doCreateForm.fecha} onChange={(e) => setDoCreateForm((p) => ({ ...p, fecha: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Relator</label>
                <Select
                  ariaLabel="Relator"
                  placeholder="Seleccione un relator"
                  searchable
                  value={doCreateForm.relatorId}
                  onChange={(v) => setDoCreateForm((p) => ({ ...p, relatorId: v }))}
                  options={activeWorkers.map((w) => ({
                    value: w.personaId,
                    label: `${w.nombre} ${w.apellido || ''}`.trim(),
                    description: w.cargo || undefined,
                  }))}
                />
              </div>
              <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                La actividad queda "Programada" hasta que los asistentes firmen su asistencia. Recién ahí cuenta como ejecutada.
              </div>
            </>
          ) : (() => {
            const versionActual = doCreateModal?.existingDoc?.version || 0;
            const yaTieneArchivo = Boolean(doCreateModal?.existingDoc?.s3Key || doCreateModal?.existingDoc?.archivoUrl);
            const puedeVersionar = Boolean(doCreateModal?.existingDoc?.documentId) && yaTieneArchivo && esProcedimiento(doCreateModal?.el?.tipo);
            const publicandoVersion = puedeVersionar && Boolean(doCreateForm.file);
            return (
            <>
              {puedeVersionar && (
                <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)', fontSize: '0.8rem', lineHeight: 1.55 }}>
                  <div style={{ fontWeight: 600, marginBottom: '2px' }}>Versión vigente: v{versionActual}</div>
                  <div className="text-muted">
                    Subir un archivo publica la <strong>v{versionActual + 1}</strong>, notifica a la línea de mando y exige re-firma. La versión anterior queda en el historial.
                  </div>
                </div>
              )}
              {esRegistroEjecucion(doCreateModal?.el?.tipo) && (
                <div className="form-group">
                  <label className="form-label">Fecha del hecho</label>
                  <input type="date" className="form-input" value={doCreateForm.fecha} onChange={(e) => setDoCreateForm((p) => ({ ...p, fecha: e.target.value }))} />
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '4px' }}>
                    Cuándo ocurrió, no cuándo se sube. La vigencia se mide desde esta fecha.
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">{publicandoVersion ? 'Notas de la versión (opcional)' : 'Descripción'}</label>
                <textarea className="form-input" rows={3} value={doCreateForm.descripcion} onChange={(e) => setDoCreateForm((p) => ({ ...p, descripcion: e.target.value }))} placeholder="Contenido o resumen del procedimiento…" style={{ resize: 'vertical' }} />
              </div>
              <div className="form-group">
                <label className="form-label">{puedeVersionar ? 'Archivo de la nueva versión' : 'Archivo (opcional)'}</label>
                <input
                  ref={doCreateFileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => setDoCreateForm((p) => ({ ...p, file: e.target.files?.[0] || null }))}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => doCreateFileRef.current?.click()}>
                    <FiUploadCloud size={15} style={{ marginRight: '6px' }} />
                    {doCreateForm.file ? 'Cambiar archivo' : puedeVersionar ? 'Seleccionar nuevo archivo' : 'Seleccionar archivo'}
                  </button>
                  <span className="text-muted" style={{ fontSize: '0.8rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doCreateForm.file?.name || 'Ningún archivo seleccionado'}
                  </span>
                </div>
              </div>
              {publicandoVersion && (
                <div className="form-group">
                  <label className="form-label">Motivo del cambio *</label>
                  <input className="form-input" value={doCreateForm.motivo} onChange={(e) => setDoCreateForm((p) => ({ ...p, motivo: e.target.value }))} placeholder="Ej: actualización por cambio de procedimiento en altura" />
                </div>
              )}

              {(() => {
                const doc = doCreateModal?.existingDoc;
                const historial = Array.isArray(doc?.versiones) ? doc.versiones : [];
                if (!doc?.documentId || (historial.length === 0 && (doc.version || 0) <= 1)) return null;
                // Vigente primero, luego las archivadas de más nueva a más antigua.
                const filas = [
                  { version: doc.version || 1, archivoNombre: doc.archivoNombre, s3Key: doc.s3Key || doc.archivoUrl, motivo: doc.ultimoMotivoVersion, publicadaPorNombre: doc.ultimaPublicacionNombre, publicadaEn: doc.updatedAt, vigente: true },
                  ...[...historial].reverse().map((v: any) => ({ ...v, vigente: false })),
                ];
                return (
                  <div className="form-group">
                    <label className="form-label">Historial de versiones</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      {filas.map((v: any) => (
                        <div key={`v-${v.version}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', background: v.vigente ? 'var(--surface-elevated)' : 'transparent' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                              v{v.version}
                              {v.vigente && <span className="badge badge-success" style={{ marginLeft: '6px', fontSize: '0.66rem' }}>Vigente</span>}
                            </div>
                            <div className="text-muted" style={{ fontSize: '0.74rem' }}>
                              {v.publicadaEn ? formatDate(v.publicadaEn) : '—'}
                              {v.publicadaPorNombre ? ` · ${v.publicadaPorNombre}` : ''}
                              {v.motivo ? ` · ${v.motivo}` : ''}
                            </div>
                          </div>
                          <button className="btn btn-secondary btn-sm" type="button" disabled={!v.s3Key} onClick={() => descargarVersionArchivo(v.s3Key)}>
                            Descargar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
            );
          })()}
        </div>
      </Modal>

      {/* ── Modal: Firma de relator (firma cruzada CAPACITACION_SST) ── */}
      <Modal
        isOpen={!!relatorSign}
        onClose={() => { setRelatorSign(null); setRelatorPin(''); setRelatorError(null); }}
        title="Firma de relator"
        subtitle={relatorSign ? `${relatorSign.titulo} — Art. 16 DS44, firma cruzada` : ''}
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => { setRelatorSign(null); setRelatorPin(''); setRelatorError(null); }}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleFirmaRelator} disabled={relatorSaving}>
              {relatorSaving ? 'Firmando…' : 'Firmar como relator'}
            </button>
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Firmas como relator de la capacitación. El documento queda completo
            cuando existen ambas firmas: la tuya y la del trabajador.
          </p>
          <div className="form-group">
            <label className="form-label">Modalidad (informativo)</label>
            <select className="form-input form-select" value={relatorModalidad} onChange={(e) => setRelatorModalidad(e.target.value)}>
              <option value="">Sin especificar</option>
              <option value="presencial">Presencial</option>
              <option value="e-learning">E-learning</option>
              <option value="mutualidad">Mutualidad</option>
              <option value="streaming">Streaming</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Tu PIN de firma</label>
            <input
              type="password"
              inputMode="numeric"
              className="form-input"
              value={relatorPin}
              onChange={(e) => { setRelatorPin(e.target.value.replace(/\D/g, '')); setRelatorError(null); }}
              placeholder="••••"
              maxLength={8}
              autoComplete="off"
            />
          </div>
          {relatorError && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
              {relatorError}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Modal: Cerrar investigación Art. 71 (genera informe firmado) ── */}
      <Modal
        isOpen={!!cerrarInvModal}
        onClose={() => { setCerrarInvModal(null); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}
        title="Cerrar investigación (Art. 71)"
        subtitle={cerrarInvModal?.descripcion}
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => { setCerrarInvModal(null); setCerrarInvPin(''); setCerrarInvError(null); setCerrarInvResult(null); }}>
              {cerrarInvResult ? 'Cerrar' : 'Cancelar'}
            </button>
            {!cerrarInvResult && (
              <button className="btn btn-primary" onClick={handleCerrarInvestigacion} disabled={cerrarInvSaving}>
                {cerrarInvSaving ? 'Firmando…' : 'Cerrar y firmar informe'}
              </button>
            )}
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Se genera el informe de investigación (árbol de causas) con los datos registrados,
            firmado con tu PIN y con hash verificable. El incidente queda <strong>cerrado</strong> y
            el informe se guarda como documento de la obra (respaldo del Registro Art. 72).
          </p>
          {!cerrarInvResult && (
            <div>
              <label className="text-muted" style={{ fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>Tu PIN de firma</label>
              <input
                type="password"
                inputMode="numeric"
                className="form-input"
                value={cerrarInvPin}
                onChange={(e) => { setCerrarInvPin(e.target.value.replace(/\D/g, '')); setCerrarInvError(null); }}
                placeholder="••••"
                maxLength={8}
                autoComplete="off"
              />
            </div>
          )}
          {cerrarInvError && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
              {cerrarInvError}
            </div>
          )}
          {cerrarInvResult && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.78rem', color: '#065f46', wordBreak: 'break-all' }}>
              Investigación cerrada e informe firmado. Token: <strong>{cerrarInvResult.token}</strong><br />
              Hash: {cerrarInvResult.hash}
            </div>
          )}
        </div>
      </Modal>

      {/* ── Modal: Confirmar firma y exportar Registro AT/EP ── */}
      <Modal
        isOpen={registroSignModal}
        onClose={() => { setRegistroSignModal(false); setRegistroPin(''); setRegistroError(null); setRegistroResult(null); }}
        title="Exportar Registro AT/EP"
        subtitle="Arts. 72-73 DS44 — Registro de Accidentes del Trabajo, Enfermedades Profesionales e Incidentes Peligrosos"
        size="sm"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', width: '100%' }}>
            <button className="btn btn-secondary" onClick={() => setRegistroSignModal(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={handleExportRegistroAT} disabled={exportingRegistro}>
              <LuDownload size={14} />
              {exportingRegistro ? 'Generando...' : 'Firmar y Exportar PDF'}
            </button>
          </div>
        }
      >
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div className="card" style={{ padding: 'var(--space-3)', background: 'var(--surface-elevated)', border: '1px solid var(--surface-border)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Incidentes totales</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{incidentes.length}</div>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Abiertos</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b' }}>
                    {incidentes.filter(incidenteAbierto).length}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '2px' }}>Cerrados</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981' }}>
                    {incidentes.filter(incidenteCerrado).length}
                  </div>
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Al confirmar, reconoces haber revisado todos los incidentes registrados en esta obra.
              El sistema consolidará incidentes, actividades e indicadores en un snapshot inmutable
              y registrará tu firma (verificable, con hash) como responsable.
            </p>
            <div>
              <label className="text-muted" style={{ fontSize: '0.82rem', display: 'block', marginBottom: '4px' }}>
                Tu PIN de firma
              </label>
              <input
                type="password"
                inputMode="numeric"
                className="form-input"
                value={registroPin}
                onChange={(e) => { setRegistroPin(e.target.value.replace(/\D/g, '')); setRegistroError(null); }}
                placeholder="••••"
                maxLength={8}
                autoComplete="off"
              />
            </div>
            {registroError && (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: '0.82rem', color: '#b91c1c' }}>
                {registroError}
              </div>
            )}
            {registroResult && (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.78rem', color: '#065f46', wordBreak: 'break-all' }}>
                Registro firmado. Token: <strong>{registroResult.token}</strong><br />
                Hash: {registroResult.hash}
              </div>
            )}
            <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.82rem', color: '#92400e' }}>
              El documento se abrirá en una nueva pestaña. Usa <strong>Ctrl+P → Guardar como PDF</strong> para descargarlo.
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Documentos de onboarding generados post-asignación ── */}
      <Modal
        isOpen={!!onboardingUploadModal?.show}
        onClose={() => setOnboardingUploadModal(null)}
        title="Documentos de onboarding generados"
        subtitle={`${onboardingUploadModal?.addedWorkers.length ?? 0} trabajador(es) asignado(s). Puedes subir los archivos ahora o desde el perfil de cada trabajador.`}
        size="lg" 
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
            <button className="btn btn-primary" onClick={() => setOnboardingUploadModal(null)}>
              Listo
            </button>
          </div>
        }
      >
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {DS44_ONBOARDING_ITEMS.map((item) => {
            const isDone = bulkUploadDone[item.tipo];
            const isUploading = bulkUploadingTipo === item.tipo;
            return (
              <div key={item.key} className="ds44-doc-row">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', minWidth: 0 }}>
                  {isDone
                    ? <LuCircleCheck size={16} style={{ color: '#10b981', marginTop: '2px', flexShrink: 0 }} />
                    : item.kind === 'document'
                      ? <LuDownload size={16} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
                      : <LuClock size={16} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>{item.label}</div>
                    <div className="text-muted" style={{ fontSize: '0.78rem' }}>{item.articulo}</div>
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {item.kind === 'document' && !isDone && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '8px', border: '1px solid var(--surface-border)', fontSize: '0.82rem', cursor: isUploading ? 'wait' : 'pointer', background: 'var(--surface-elevated)', color: 'var(--text-primary)' }}>
                      {isUploading ? <><LuClock size={13} /> Subiendo...</> : <><LuDownload size={13} /> Subir archivo</>}
                      <input type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                        disabled={!!bulkUploadingTipo}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f && onboardingUploadModal) handleBulkOnboardingUpload(item.tipo, f, onboardingUploadModal.addedWorkers);
                          if (e.target) e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                  {item.kind === 'document' && isDone && (
                    <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>Subido</span>
                  )}
                  {item.kind === 'signature' && (
                    <span className="badge badge-secondary" style={{ fontSize: '0.78rem' }}>Solicitud creada</span>
                  )}
                  {item.kind === 'actividad' && (
                    <span className="badge badge-secondary" style={{ fontSize: '0.78rem' }}>Via actividades</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        isOpen={isWorkersModalOpen}
        onClose={() => setIsWorkersModalOpen(false)}
        title="Gestionar trabajadores"
        subtitle="Agrega o da de baja trabajadores asociados a la obra."
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {selectedUnassignedWorkerIds.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const workersToAdd = allWorkers.filter(w => selectedUnassignedWorkerIds.includes(w.personaId));
                    handleAddMultipleWorkers(workersToAdd);
                  }}
                  disabled={updatingWorkers === 'multiple'}
                >
                  Agregar seleccionados ({selectedUnassignedWorkerIds.length})
                </button>
              )}
            </div>
            <button className="btn btn-secondary" onClick={() => setIsWorkersModalOpen(false)}>
              Cerrar
            </button>
          </div>
        }
      >
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <div className="text-muted">
              Selecciona trabajadores para agregarlos a la obra.
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const unassigned = allWorkers.filter(w => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId)));
                const unassignedIds = unassigned.map(w => w.personaId);
                if (selectedUnassignedWorkerIds.length === unassignedIds.length && unassignedIds.length > 0) {
                  setSelectedUnassignedWorkerIds([]);
                } else {
                  setSelectedUnassignedWorkerIds(unassignedIds);
                }
              }}
            >
              {(() => {
                const unassignedCount = allWorkers.filter(w => !(Array.isArray(w.obraIds) && w.obraIds.includes(obraId))).length;
                if (unassignedCount === 0) return 'Todos agregados';
                return selectedUnassignedWorkerIds.length === unassignedCount ? 'Deseleccionar todos' : 'Seleccionar todos los disponibles';
              })()}
            </button>
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {allWorkers.map((worker) => {
              const workerId = worker.personaId;
              const isAssigned = Array.isArray(worker.obraIds) && worker.obraIds.includes(obraId);
              const isInactive = worker.estado === 'inactivo';
              const isSelected = selectedUnassignedWorkerIds.includes(workerId);

              return (
                <div key={workerId} className="card" style={{ padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      {!isAssigned && (
                        <input
                          type="checkbox"
                          className="checkbox-input custom-checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setSelectedUnassignedWorkerIds(prev =>
                              prev.includes(workerId) ? prev.filter(id => id !== workerId) : [...prev, workerId]
                            );
                          }}
                          disabled={updatingWorkers === workerId || updatingWorkers === 'multiple'}
                        />
                      )}
                      <div>
                        <div className="font-medium">{worker.nombre} {worker.apellido || ''}</div>
                        <div className="text-muted">{worker.cargo || 'Trabajador'} · {worker.rut}</div>
                      </div>
                    </div>
                    {isAssigned ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        {/* Editor de cargo: cambia el/los cargo(s) del trabajador en la obra. */}
                        {!isInactive && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 360 }}>
                            {cargoOptions.map((opt) => {
                              const actuales = assignCargos[workerId] ?? cargosActualesEnObra(worker);
                              const sel = actuales.includes(opt.value);
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  className={`badge ${sel ? 'badge-success' : ''}`}
                                  style={{ cursor: 'pointer', border: '1px solid var(--surface-border)', background: sel ? undefined : 'transparent' }}
                                  onClick={() => setAssignCargos((prev) => {
                                    const base = prev[workerId] ?? cargosActualesEnObra(worker);
                                    const next = base.includes(opt.value) ? base.filter((c) => c !== opt.value) : [...base, opt.value];
                                    return { ...prev, [workerId]: next };
                                  })}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <span className={`badge ${isInactive ? 'badge-warning' : 'badge-success'}`}>
                            {isInactive ? 'Baja' : 'Activo'}
                          </span>
                          {!isInactive && assignCargos[workerId] && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleUpdateCargos(worker)}
                              disabled={updatingWorkers === workerId}
                              title="Guardar el/los cargo(s) del trabajador en esta obra"
                            >
                              Guardar cargo
                            </button>
                          )}
                          {!isInactive ? (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleDeactivateWorker(worker)}
                              disabled={updatingWorkers === workerId || worker.rol === 'admin'}
                              title={worker.rol === 'admin' ? 'No se puede dar de baja a administradores' : undefined}
                            >
                              Dar de baja
                            </button>
                          ) : (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleReactivateWorker(worker)}
                              disabled={updatingWorkers === workerId}
                            >
                              Reactivar
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        {/* Cargo(s) de terreno EN esta obra (multi-cargo). Define el kit. */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 360 }}>
                          {cargoOptions.map((opt) => {
                            const sel = (assignCargos[workerId] || (worker.cargo ? [worker.cargo] : [])).includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                className={`badge ${sel ? 'badge-success' : ''}`}
                                style={{ cursor: 'pointer', border: '1px solid var(--surface-border)', background: sel ? undefined : 'transparent' }}
                                onClick={() => setAssignCargos((prev) => {
                                  const base = prev[workerId] || (worker.cargo ? [worker.cargo] : []);
                                  const next = base.includes(opt.value) ? base.filter((c) => c !== opt.value) : [...base, opt.value];
                                  return { ...prev, [workerId]: next };
                                })}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleAddWorker(worker)}
                          disabled={updatingWorkers === workerId || updatingWorkers === 'multiple'}
                          title="Asigna al trabajador a la obra con el/los cargo(s) marcados"
                        >
                          Agregar a obra
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!docAEliminar}
        onClose={() => !eliminandoDoc && setDocAEliminar(null)}
        preventClose={eliminandoDoc}
        title="Eliminar documento"
        subtitle={docAEliminar?.titulo}
        footer={
          <>
            <button className="btn btn-secondary" disabled={eliminandoDoc} onClick={() => setDocAEliminar(null)}>Cancelar</button>
            <button className="btn btn-danger" disabled={eliminandoDoc} onClick={eliminarDocumento}>
              {eliminandoDoc ? 'Eliminando…' : 'Eliminar'}
            </button>
          </>
        }
      >
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          Se quita de la obra junto con su historial de versiones. Los documentos ya
          firmados no se pueden eliminar.
        </p>
      </Modal>

      {/* Historial de versiones: la vigente arriba, las archivadas debajo */}
      <Modal
        isOpen={!!historialModal}
        onClose={() => setHistorialModal(null)}
        title="Historial de cambios"
        subtitle={historialModal?.titulo}
        icon={<LuHistory size={20} />}
        size="lg"
        footer={
          <button className="btn btn-secondary" onClick={() => setHistorialModal(null)}>Cerrar</button>
        }
      >
        <ol className="ver-lista">
          {(historialModal?.versiones || []).map((v) => (
            <li key={v.version} className={`ver-item${v.actual ? ' actual' : ''}`}>
              <span className="ver-marca">v{v.version}</span>
              <div className="ver-datos">
                <div className="ver-linea">
                  {v.actual && <span className="ver-chip">Versión vigente</span>}
                  <span className="ver-fecha">
                    {v.publicadaEn ? formatDate(v.publicadaEn) : 'Sin fecha'}
                    {tiempoRelativo(v.publicadaEn) && ` · ${tiempoRelativo(v.publicadaEn)}`}
                  </span>
                </div>
                <div className="ver-archivo">{v.archivoNombre || 'Archivo sin nombre'}</div>
                {/* Quién la subió y por qué. En la v1 no hay motivo: nadie la
                    "cambió", es la carga inicial del documento. */}
                <div className="ver-sub">
                  {v.publicadaPorNombre
                    ? `Subido por ${v.publicadaPorNombre}`
                    : 'Autor no registrado'}
                  {v.motivo && ` · ${v.motivo}`}
                </div>
                {/* FUF 51: participantes de la revisión que originó esta versión. */}
                {v.participantes && (v.participantes.entidades?.length || v.participantes.detalle) && (
                  <div className="ver-sub" style={{ marginTop: 2 }}>
                    <strong>Revisión con participación de:</strong>{' '}
                    {(v.participantes.entidades || []).map(labelEntidadRevision).join(', ')}
                    {v.participantes.detalle && ` — ${v.participantes.detalle}`}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!v.s3Key}
                title={v.s3Key ? `Ver la versión ${v.version}` : 'Esta versión no tiene archivo'}
                onClick={() => verVersion(v.s3Key, v.archivoNombre)}
              >
                <FiEye size={13} /> Ver
              </button>
            </li>
          ))}
        </ol>
      </Modal>

      <DocumentPreviewModal
        isOpen={!!docPreview}
        onClose={() => setDocPreview(null)}
        url={docPreview?.url ?? null}
        fileName={docPreview?.name}
      />

      <Modal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        title={signatureModalDoc?.titulo ? `Firmas - ${signatureModalDoc.titulo}` : 'Firmas'}
        subtitle="Detalle de firmas solicitadas"
        size="lg"
        footer={
          <button className="btn btn-secondary" onClick={() => setIsSignatureModalOpen(false)}>
            Cerrar
          </button>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {!signatureModalDoc?.asignaciones?.length ? (
            <div className="text-muted">No hay firmantes asignados.</div>
          ) : (
            signatureModalDoc.asignaciones.map((asignacion: any) => {
              // El estado de firma puede venir de dos formas: document.asignaciones
              // usa `estado: 'firmado'`; request.trabajadores usa `firmado: boolean`.
              const haFirmado = asignacion.estado === 'firmado' || asignacion.firmado === true || Boolean(asignacion.fechaFirma);
              return (
              <div
                key={asignacion.personaId || asignacion.workerId}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div className="font-medium">{asignacion.nombre || 'Trabajador'}</div>
                  <div className="text-muted">{asignacion.rut || ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={`badge ${haFirmado ? 'badge-success' : 'badge-warning'}`}>
                    {haFirmado ? 'Firmado' : 'Pendiente'}
                  </div>
                  {asignacion.fechaFirma && (
                    <div className="text-muted" style={{ marginTop: 'var(--space-1)' }}>
                      {formatDate(asignacion.fechaFirma)}
                    </div>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>
      </Modal>

      {/* Modal subida documentos Fase HACER (DO) */}
      <Modal
        isOpen={isDoModalOpen}
        onClose={() => { setIsDoModalOpen(false); setPendingDoFile(null); }}
        title={selectedDoDoc?.titulo ? `Fase DO — ${selectedDoDoc.titulo}` : 'Documento Fase HACER'}
        subtitle={selectedDoDoc ? `${selectedDoDoc.articulo} · ${selectedDoDoc.descripcion}` : 'Sube el archivo, selecciona firmantes y define vencimiento'}
        size="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsDoModalOpen(false)} disabled={doSaving}>
              Cerrar
            </button>
            <button className="btn btn-primary" onClick={handleSaveDoChanges} disabled={doSaving}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Vencimiento</label>
            <label className="checkbox-row" style={{ marginTop: 'var(--space-2)' }}>
              <input
                type="checkbox"
                className="checkbox-input custom-checkbox"
                checked={doExpiryNotApplicable}
                onChange={(e) => { setDoExpiryNotApplicable(e.target.checked); if (e.target.checked) setDoExpiryDate(''); }}
              />
              <span>No aplica</span>
            </label>
            {!doExpiryNotApplicable && (
              <input
                className="form-input"
                type="date"
                value={doExpiryDate}
                onChange={(e) => setDoExpiryDate(e.target.value)}
              />
            )}
          </div>
          <div style={{ border: '1px dashed var(--surface-border)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', background: 'var(--surface-elevated)', display: 'grid', gap: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className="avatar" style={{ background: 'var(--surface-hover)', color: 'var(--primary-500)' }}>
                <FiUploadCloud size={20} />
              </div>
              <div>
                <div className="font-medium">Subir documento</div>
                <div className="text-muted">{pendingDoFile?.name || selectedDoDetail?.archivoNombre || 'PDF requerido'}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {canSubirDocumentos && (
                <button className="btn btn-primary" type="button" onClick={() => doFileInputRef.current?.click()} disabled={doLoading}>
                  {pendingDoFile ? 'Cambiar archivo' : selectedDoDetail?.archivoUrl ? 'Actualizar archivo' : 'Seleccionar archivo'}
                </button>
              )}
              <button className="btn btn-secondary" type="button" onClick={handlePreviewDoDocument} disabled={(!selectedDoDetail?.archivoUrl && !selectedDoDetail?.s3Key) || doPreviewing}>
                <FiEye /> Ver documento
              </button>
            </div>
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <div className="font-medium">Firmantes requeridos</div>
            {trabajadores.length === 0 ? (
              <div className="text-muted">No hay trabajadores asignados a esta obra.</div>
            ) : (
              <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)' }}>
                {trabajadores.map((worker, index) => (
                  <label key={worker.personaId} className="checkbox-row" style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderBottom: index === trabajadores.length - 1 ? 'none' : '1px solid var(--surface-border)' }}>
                    <input
                      type="checkbox"
                      className="checkbox-input custom-checkbox"
                      checked={doWorkerIds.includes(worker.personaId)}
                      onChange={() => {
                        const id = worker.personaId;
                        setDoWorkerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
                      }}
                    />
                    <span>{worker.nombre} {worker.apellido || ''}</span>
                    <span className="text-muted">({worker.rut})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <input ref={doFileInputRef} type="file" accept="application/pdf" onChange={handleDoFileChange} style={{ display: 'none' }} />

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Editar obra"
        subtitle="Solo puedes editar nombre, etapa y estado"
        size="md"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setIsEditModalOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={handleSaveObra}>
              Guardar cambios
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div className="form-group">
            <label className="form-label">Nombre</label>
            <input className="form-input" name="nombre" value={editData?.nombre || ''} onChange={handleEditChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Estado</label>
            <SegmentedControl
              ariaLabel="Estado de la obra"
              value={editData?.estado || 'activa'}
              onChange={(v) => setEditData((prev: any) => ({ ...prev, estado: v }))}
              options={[
                { value: 'activa', label: 'Activa' },
                { value: 'pausada', label: 'Pausada' },
                { value: 'finalizada', label: 'Finalizada' },
              ]}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Características DO (definen qué elementos aplican)</label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="faenaCompartida" checked={Boolean(editData?.faenaCompartida)} onChange={handleEditChange} />
              <span>Faena compartida con otra(s) entidad(es) — Art. 20</span>
            </label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="tieneMaquinaria" checked={Boolean(editData?.tieneMaquinaria)} onChange={handleEditChange} />
              <span>Hay máquinas/herramientas motrices — Art. 10</span>
            </label>
            <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
              <input type="checkbox" name="agentesFQB" checked={Boolean(editData?.agentesFQB)} onChange={handleEditChange} />
              <span>Existen agentes físicos/químicos/biológicos — Art. 2 N°14 c</span>
            </label>
          </div>
        </div>
      </Modal>
      <style>{`
        .od-tab-nav {
          display: flex;
          gap: 0;
          border-bottom: 2px solid var(--surface-border);
          margin-bottom: var(--space-5);
        }
        .od-tab {
          flex: 1;
          text-align: center;
          background: none;
          border: none;
          border-bottom: 3px solid transparent;
          margin-bottom: -2px;
          padding: 10px 16px;
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--text-secondary);
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
          white-space: nowrap;
        }
        .od-tab:hover { color: var(--text-primary); }
        .od-tab--active {
          color: #006edc;
          border-bottom-color: #006edc;
          font-weight: 600;
        }

        /* ── DS44 Panel ── */
        .ds44-panel {
          border: 1px solid var(--surface-border);
          border-radius: var(--radius-lg);
          background: var(--surface-card);
          overflow: hidden;
        }
        .ds44-stepper {
          display: flex;
          align-items: center;
          padding: var(--space-5) var(--space-6);
          border-bottom: 1px solid var(--surface-border);
          background: var(--surface-base);
          gap: 0;
        }
        .ds44-phase-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px 12px;
          border-radius: var(--radius-md);
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .ds44-phase-btn:hover { background: var(--surface-elevated); }
        .ds44-phase-btn--selected { background: var(--surface-elevated); }
        .ds44-phase-circle {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 2px solid;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          font-weight: 700;
          transition: all 0.2s;
        }
        .ds44-phase-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          transition: color 0.15s;
        }
        .ds44-phase-connector {
          flex: 1;
          height: 2px;
          margin: 0 2px;
          margin-bottom: 28px;
          border-radius: 1px;
          transition: background 0.2s;
          min-width: 12px;
        }
        .ds44-progress-bar {
          padding: var(--space-4) var(--space-6);
          border-bottom: 1px solid var(--surface-border);
        }
        .ds44-progress-track {
          height: 8px;
          border-radius: 999px;
          overflow: hidden;
          background: var(--surface-elevated);
          border: 1px solid var(--surface-border);
        }
        .ds44-progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width 0.3s ease;
        }
        .ds44-content-section {
          padding: var(--space-5) var(--space-6);
        }
        .ds44-content-header {
          margin-bottom: var(--space-4);
          padding-bottom: var(--space-3);
          border-bottom: 1px solid var(--surface-border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
        }
        .ds44-content-title {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-primary);
        }

        /* ── DS44 content items ── */
        .ds44-doc-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3);
          flex-wrap: wrap;
          padding: var(--space-3) 0;
          border-bottom: 1px solid var(--surface-border);
        }
        .ds44-doc-row:last-child { border-bottom: none; }

        /* Meta separada por puntos: los datos del documento viven acá como texto,
           no como controles, para que la fila conserve una sola acción visible. */
        .ds44-doc-meta {
          display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px;
          font-size: 0.78rem; margin-top: 2px;
        }
        .ds44-doc-meta > span + span::before { content: '·'; margin-right: 6px; }
        .ds44-doc-ver { font-family: var(--font-mono); font-size: 0.74rem; }
        .ds44-doc-actions { display: flex; gap: var(--space-2); align-items: center; flex-shrink: 0; }

        /* Requisito con varios documentos: sigue siendo una línea del checklist,
           y el recuento despliega los documentos dentro. */
        .ds44-multi { padding: var(--space-3) 0; border-bottom: 1px solid var(--surface-border); }
        .ds44-multi:last-child { border-bottom: none; }
        .ds44-multi-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: var(--space-3); flex-wrap: wrap;
        }
        .ds44-multi-toggle {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 9px 3px 7px; border-radius: var(--radius-full);
          border: 1px solid var(--surface-border); background: var(--surface-card);
          font-family: inherit; font-size: 11px; font-weight: 600; color: var(--text-secondary);
          cursor: pointer; transition: all var(--transition-fast);
        }
        .ds44-multi-toggle:hover { border-color: var(--primary-400); color: var(--accent-text); }
        .ds44-multi-toggle:focus-visible { outline: 2px solid var(--primary-400); outline-offset: 2px; }
        .ds44-multi-toggle svg { transition: transform var(--transition-fast); }
        .ds44-multi-toggle[aria-expanded="true"] svg { transform: rotate(180deg); }

        .ds44-multi-lista {
          list-style: none; margin: 10px 0 2px; padding: 0 0 0 var(--space-3);
          border-left: 2px solid var(--surface-border);
          display: flex; flex-direction: column;
        }
        .ds44-multi-item { display: flex; align-items: center; gap: var(--space-2); padding: 7px 0; }
        .ds44-multi-item + .ds44-multi-item { border-top: 1px solid var(--surface-border); }
        .ds44-multi-nombre { flex: 1; min-width: 0; }
        .ds44-multi-titulo {
          font-size: 0.84rem; font-weight: 500; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ds44-multi-sub { font-size: 0.73rem; color: var(--text-muted); }
        @media (max-width: 640px) {
          .ds44-multi-item { flex-wrap: wrap; }
          .ds44-multi-nombre { flex-basis: 100%; }
        }

        /* Menú de acciones secundarias */
        .ds44-menu { position: relative; display: inline-flex; }
        .ds44-menu-trigger {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: var(--radius-md);
          border: 1px solid var(--surface-border); background: var(--surface-card);
          color: var(--text-muted); cursor: pointer; transition: all var(--transition-fast);
        }
        .ds44-menu-trigger:hover { color: var(--text-primary); border-color: var(--primary-400); }
        .ds44-menu-trigger:focus-visible { outline: 2px solid var(--primary-400); outline-offset: 2px; }
        .ds44-menu-scrim { position: fixed; inset: 0; z-index: 999; }
        /* Fijo al viewport, con top/left calculados en JS: dentro del contenedor
           con overflow del listado, un panel absoluto quedaba recortado. */
        .ds44-menu-panel {
          position: fixed; z-index: 1000;
          width: 208px; overflow: hidden;
          background: var(--surface-card); border: 1px solid var(--surface-border);
          border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
        }
        .ds44-menu-panel button {
          display: block; width: 100%; text-align: left; padding: 9px 14px;
          border: none; background: none; cursor: pointer; font-family: inherit;
          font-size: 0.84rem; color: var(--text-primary);
        }
        .ds44-menu-panel button:hover { background: var(--surface-hover); }
        .ds44-menu-panel button:focus-visible { outline: 2px solid var(--primary-400); outline-offset: -2px; }

        /* Historial: es una secuencia real, así que la versión numera y ordena. */
        .ver-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .ver-item {
          display: flex; align-items: center; gap: var(--space-3);
          padding: 12px 0; border-bottom: 1px solid var(--surface-border);
        }
        .ver-item:last-child { border-bottom: none; }
        .ver-marca {
          flex-shrink: 0; width: 42px; text-align: center;
          font-family: var(--font-mono); font-size: 0.8rem; font-weight: 600;
          color: var(--text-muted);
        }
        .ver-item.actual .ver-marca { color: var(--accent-text); }
        .ver-datos { flex: 1; min-width: 0; }
        .ver-linea { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .ver-chip {
          font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
          color: var(--accent-text); background: var(--accent-tint);
          padding: 2px 7px; border-radius: var(--radius-full);
        }
        .ver-fecha { font-size: 0.82rem; font-weight: 600; color: var(--text-primary); }
        .ver-archivo {
          font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ver-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 1px; }
        .ds44-section-label {
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          padding: var(--space-4) 0 var(--space-2);
          border-top: 1px solid var(--surface-border);
          margin-top: var(--space-2);
        }
        .ds44-section-label:first-of-type { border-top: none; padding-top: var(--space-2); margin-top: 0; }
        .ds44-activity-block {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: var(--space-3);
          padding: var(--space-4);
          border-radius: var(--radius-md);
          background: var(--surface-elevated);
          border: 1px solid var(--surface-border);
          margin-bottom: var(--space-3);
        }
        .ds44-alerts {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          margin-bottom: var(--space-4);
        }
        .ds44-alert {
          display: flex;
          align-items: flex-start;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          font-size: 0.8rem;
          line-height: 1.5;
        }
        .ds44-alert-warning { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.25); color: #92400e; }
        .ds44-alert-danger  { background: rgba(239,68,68,0.08);  border: 1px solid rgba(239,68,68,0.25);  color: #991b1b; }
        .ds44-alert-icon { flex-shrink: 0; margin-top: 2px; }
      `}</style>
    </>
  );
}

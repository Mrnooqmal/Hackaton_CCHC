import { Modal, Badge } from './ui';
import { FiDownload, FiFile } from 'react-icons/fi';
import type { Document } from '../api/documents.api';
import { ultimaDifusion, descripcionDifusion } from '../utils/difusion';

interface DocumentPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** URL presignada del archivo. null mientras se obtiene. */
    url: string | null;
    fileName?: string;
    onDownload?: () => void;
    /** Documento del repositorio, para la ficha. Sin él solo se ve el archivo. */
    documento?: Pick<
        Document,
        'tipo' | 'tipoDescripcion' | 'version' | 'fecha' | 'createdAt' |
        'fechaEntradaVigencia' | 'asignaciones' | 'difusiones'
    > | null;
}

const fmt = (iso?: string | null) =>
    (iso ? new Date(iso).toLocaleDateString('es-CL') : null);

/** Firmas que faltan. Se deriva de las asignaciones, igual que en el motor de
 *  completitud: un campo duplicado se desincroniza. */
function firmasPendientes(doc?: DocumentPreviewModalProps['documento']): { firmadas: number; total: number } {
    const asignaciones = Array.isArray(doc?.asignaciones) ? doc!.asignaciones : [];
    const firmadas = asignaciones.filter((a: any) => a?.estado === 'firmado' || a?.fechaFirma).length;
    return { firmadas, total: asignaciones.length };
}

const getExt = (name?: string) => (name?.split('?')[0].split('.').pop() || '').toLowerCase();

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

export default function DocumentPreviewModal({
    isOpen, onClose, url, fileName, onDownload, documento = null,
}: DocumentPreviewModalProps) {
    const ext = getExt(fileName);
    const isPdf = ext === 'pdf';
    const isImage = IMAGE_EXTS.includes(ext);
    const canPreview = isPdf || isImage;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={fileName || 'Vista previa'}
            size="xl"
            footer={onDownload && (
                <button className="btn btn-secondary" onClick={onDownload}>
                    <FiDownload /> Descargar
                </button>
            )}
        >
            {/* Ficha del documento. Frente a un fiscalizador la primera pregunta no
                es qué dice el archivo sino de qué versión es, si está firmado y
                cuándo se informó. Tenerlo que buscar fuera del visor es un paso de
                más en el peor momento. */}
            {documento && <FichaDocumento documento={documento} />}

            <div style={{ height: documento ? '58vh' : '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base, #0f0f1a)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {!url ? (
                    <div className="spinner" />
                ) : !canPreview ? (
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-6)' }}>
                        <FiFile size={40} style={{ marginBottom: 'var(--space-3)' }} />
                        <p>La vista previa no está disponible para este formato.</p>
                        {onDownload && (
                            <button className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }} onClick={onDownload}>
                                <FiDownload /> Descargar archivo
                            </button>
                        )}
                    </div>
                ) : isImage ? (
                    <img src={url} alt={fileName || 'documento'} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                    <iframe
                        src={url}
                        title={fileName || 'documento'}
                        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                    />
                )}
            </div>
        </Modal>
    );
}

function FichaDocumento({ documento }: { documento: NonNullable<DocumentPreviewModalProps['documento']> }) {
    const { firmadas, total } = firmasPendientes(documento);
    const difusion = ultimaDifusion(documento);
    const descripcionEnvio = descripcionDifusion(difusion);

    const campos: Array<{ label: string; valor: React.ReactNode }> = [
        { label: 'Tipo', valor: documento.tipoDescripcion || documento.tipo },
        { label: 'Versión', valor: documento.version ? `v${documento.version}` : '—' },
        // La fecha del hecho, no la de subida: un acta de marzo cargada en
        // septiembre acredita marzo, y es contra ésa que se mide la vigencia.
        { label: 'Fecha del documento', valor: fmt(documento.fecha) || fmt(documento.createdAt) || '—' },
    ];
    if (documento.fechaEntradaVigencia) {
        campos.push({ label: 'Rige desde', valor: fmt(documento.fechaEntradaVigencia) });
    }
    if (total > 0) {
        campos.push({
            label: 'Firmas',
            valor: (
                <Badge variant={firmadas === total ? 'success' : 'warning'}>
                    {firmadas} de {total}
                </Badge>
            ),
        });
    }
    if (descripcionEnvio) {
        campos.push({ label: 'Difusión', valor: descripcionEnvio.texto });
    }

    return (
        <dl
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 'var(--space-3)',
                margin: '0 0 var(--space-4)',
                padding: 'var(--space-3)',
                border: '1px solid var(--surface-border)',
                borderRadius: 'var(--radius-md)',
            }}
        >
            {campos.map((c) => (
                <div key={c.label} style={{ minWidth: 0 }}>
                    <dt style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 2 }}>
                        {c.label}
                    </dt>
                    <dd style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                        {c.valor}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

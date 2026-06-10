import { Modal } from './ui';
import { FiDownload, FiFile } from 'react-icons/fi';

interface DocumentPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** URL presignada del archivo. null mientras se obtiene. */
    url: string | null;
    fileName?: string;
    onDownload?: () => void;
}

const getExt = (name?: string) => (name?.split('?')[0].split('.').pop() || '').toLowerCase();

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];

export default function DocumentPreviewModal({ isOpen, onClose, url, fileName, onDownload }: DocumentPreviewModalProps) {
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
            <div style={{ height: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-base, #0f0f1a)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
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

import { useRef, useState } from 'react';
import { FiCamera, FiCheckCircle } from 'react-icons/fi';

export interface IdentityMetaItem {
    label: string;
    value: React.ReactNode;
    /** Identificadores (RUT, fechas, códigos) van en monoespaciada. */
    mono?: boolean;
}

export interface IdentityPhotoControl {
    onSelect: (file: File) => void | Promise<void>;
    onRemove?: () => void | Promise<void>;
    saving?: boolean;
    success?: boolean;
    /** El objeto cambia según el sujeto: la foto de una persona, la imagen de una obra. */
    changeLabel?: string;
    removeLabel?: string;
}

export interface IdentityPanelProps {
    /** Qué es este registro: "Ficha de persona", "Tu cuenta", "Obra". */
    eyebrow?: string;
    /** El nombre del sujeto. Es el título de la página. */
    title: string;
    /** Imagen del sujeto; sin ella se pinta `fallback`. */
    image?: string | null;
    /** Iniciales de una persona, icono de una obra. */
    fallback?: React.ReactNode;
    /**
     * Retrato 4:5 para personas (el recorte de una credencial) y apaisado 4:3
     * para obras, que se fotografían de ancho. Misma altura en ambos, para que
     * la cabecera mantenga el mismo ritmo en todas las pantallas.
     */
    media?: 'portrait' | 'landscape';
    /** El hecho que decide si el sujeto está en regla. */
    status?: { label: string; tone: 'ok' | 'pending' | 'neutral' };
    /** Los tres hechos que se leen de una credencial. Más de cuatro la saturan. */
    meta?: IdentityMetaItem[];
    actions?: React.ReactNode;
    /** Presente = la imagen es editable desde esta pantalla. */
    photo?: IdentityPhotoControl;
}

/**
 * Cabecera de las pantallas que describen a un sujeto con identidad propia: la
 * ficha de una persona (`/personas/:rut`), la cuenta propia (`/settings`) y el
 * detalle de una obra (`/obras/:id`).
 *
 * Se lee como una credencial —imagen enmarcada, nombre, estado y una tira con
 * los datos que identifican— porque esa es la pregunta que las tres responden:
 * quién o qué es esto, y si está en regla. En una obra el referente es el
 * letrero de la entrada, que dice exactamente lo mismo.
 *
 * Reemplaza al PageHeader en esas pantallas: ahí el título de la página *es* el
 * sujeto, así que apilar un encabezado sobre la imagen repetía el nombre.
 */
export default function IdentityPanel({
    eyebrow, title, image, fallback, media = 'portrait',
    status, meta = [], actions, photo,
}: IdentityPanelProps) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [hover, setHover] = useState(false);
    const editable = !!photo;
    const busy = !!photo?.saving;

    const changeLabel = photo?.changeLabel ?? 'Cambiar foto';
    const removeLabel = photo?.removeLabel ?? 'Quitar foto';

    const pick = () => { if (editable && !busy) fileRef.current?.click(); };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) photo?.onSelect(file);
        e.target.value = '';
    };

    return (
        <header className="idp">
            <div className="idp-main">
                {/* ── Retrato ── */}
                <div
                    className={`idp-portrait idp-portrait--${media}${editable ? ' idp-portrait--editable' : ''}`}
                    onMouseEnter={() => setHover(true)}
                    onMouseLeave={() => setHover(false)}
                    onClick={pick}
                    onKeyDown={(e) => { if (editable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } }}
                    role={editable ? 'button' : undefined}
                    tabIndex={editable ? 0 : undefined}
                    aria-label={editable ? changeLabel : undefined}
                >
                    <div className="idp-portrait-inner">
                        {image
                            ? <img src={image} alt={`Imagen de ${title}`} className="idp-portrait-img" />
                            : <span className="idp-portrait-fallback" aria-hidden="true">{fallback}</span>}
                        {editable && (
                            <span className={`idp-portrait-overlay${hover || busy || photo?.success ? ' is-visible' : ''}`}>
                                {busy
                                    ? <span className="idp-spinner" />
                                    : photo?.success
                                        ? <FiCheckCircle size={22} />
                                        : <><FiCamera size={18} /><span>{changeLabel}</span></>}
                            </span>
                        )}
                    </div>
                </div>
                {editable && (
                    <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
                )}

                {/* ── Identidad ── */}
                <div className="idp-body">
                    {eyebrow && <span className="idp-eyebrow">{eyebrow}</span>}
                    <h1 className="idp-name">{title}</h1>

                    {status && (
                        <span className={`idp-status idp-status--${status.tone}`}>{status.label}</span>
                    )}

                    {meta.length > 0 && (
                        <dl className="idp-strip">
                            {meta.map((m) => (
                                <div key={m.label} className="idp-strip-item">
                                    <dt className="idp-strip-label">{m.label}</dt>
                                    <dd className={`idp-strip-value${m.mono ? ' idp-strip-value--mono' : ''}`}>{m.value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}

                    {(actions || editable) && (
                        <div className="idp-actions">
                            {editable && (
                                <button type="button" className="btn btn-secondary btn-sm" onClick={pick} disabled={busy}>
                                    <FiCamera size={13} /> {busy ? 'Guardando…' : changeLabel}
                                </button>
                            )}
                            {editable && image && photo?.onRemove && (
                                <button type="button" className="btn btn-ghost btn-sm idp-remove" onClick={photo.onRemove} disabled={busy}>
                                    {removeLabel}
                                </button>
                            )}
                            {actions}
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}

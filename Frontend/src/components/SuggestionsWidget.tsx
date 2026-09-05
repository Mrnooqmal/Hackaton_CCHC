import { useState } from 'react';
import { FiMessageCircle, FiX, FiSend } from 'react-icons/fi';
import { suggestionsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function SuggestionsWidget() {
    const { user } = useAuth();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);

    const handleSubmit = async () => {
        if (!user || !message.trim()) return;
        setSending(true);
        try {
            const res = await suggestionsApi.create({
                message: message.trim(),
                userId: user.personaId || '',
                userName: `${user.nombre || ''} ${user.apellido || ''}`.trim(),
                tenantId: user.tenantId || null,
                source: window.location.pathname,
            });
            if (!res.success) throw new Error(res.error || 'Error enviando sugerencia');
            toast.success('Gracias, recibimos tu sugerencia.');
            setMessage('');
            setOpen(false);
        } catch (err) {
            console.error(err);
            toast.error('No pudimos enviar tu sugerencia.');
        } finally {
            setSending(false);
        }
    };

    if (!user) return null;

    return (
        <>
            {/* ── FAB fijo abajo-derecha ── */}
            <button
                type="button"
                className="sw-fab"
                onClick={() => setOpen(true)}
                aria-label="Déjanos tu sugerencia"
            >
                <FiMessageCircle size={17} className="sw-fab-icon" />
                <span className="sw-fab-label">Déjanos tu sugerencia</span>
            </button>

            {/* ── Modal ── */}
            {open && (
                <div
                    className="sw-backdrop"
                    onClick={() => setOpen(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Formulario de sugerencia"
                >
                    <div className="sw-modal" onClick={(e) => e.stopPropagation()}>

                        {/* Header */}
                        <div className="sw-header">
                            <div className="sw-header-icon">
                                <FiMessageCircle size={20} />
                            </div>
                            <div className="sw-header-copy">
                                <h2 className="sw-title">Déjanos tu sugerencia</h2>
                                <p className="sw-subtitle">Tu opinión nos ayuda a mejorar la plataforma.</p>
                            </div>
                            <button
                                type="button"
                                className="sw-close"
                                onClick={() => setOpen(false)}
                                aria-label="Cerrar"
                            >
                                <FiX size={18} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="sw-body">
                            <label className="sw-label" htmlFor="sw-msg">
                                Tu mensaje
                            </label>
                            <textarea
                                id="sw-msg"
                                className="sw-textarea"
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                rows={5}
                                placeholder="Escribe tu idea, problema o comentario…"
                                autoFocus
                                maxLength={500}
                            />
                            <div className="sw-char-count">{message.length} / 500</div>
                        </div>

                        {/* Footer */}
                        <div className="sw-footer">
                            <button
                                type="button"
                                className="sw-btn-cancel"
                                onClick={() => setOpen(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="sw-btn-send"
                                onClick={handleSubmit}
                                disabled={sending || !message.trim()}
                            >
                                {sending ? (
                                    <span className="sw-spinner" />
                                ) : (
                                    <FiSend size={14} />
                                )}
                                {sending ? 'Enviando…' : 'Enviar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                /* ── FAB ── */
                .sw-fab {
                    position: fixed;
                    bottom: 28px;
                    right: 28px;
                    z-index: 1100;
                    display: inline-flex;
                    align-items: center;
                    gap: 0;
                    width: 44px;
                    height: 44px;
                    padding: 0;
                    justify-content: center;
                    background: #df3601;
                    color: #fff;
                    border: none;
                    border-radius: 50%;
                    font-size: 13px;
                    font-weight: 600;
                    font-family: inherit;
                    cursor: pointer;
                    letter-spacing: 0.01em;
                    box-shadow: 0 4px 14px rgba(0, 40, 85, 0.35);
                    transition: width 0.28s cubic-bezier(0.22, 1, 0.36, 1), padding 0.28s cubic-bezier(0.22, 1, 0.36, 1),
                        border-radius 0.28s ease, background 0.18s ease, transform 0.15s ease, box-shadow 0.18s ease;
                }
                .sw-fab-icon {
                    flex-shrink: 0;
                }
                .sw-fab-label {
                    max-width: 0;
                    opacity: 0;
                    overflow: hidden;
                    white-space: nowrap;
                    transition: max-width 0.28s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease, margin 0.28s ease;
                }
                .sw-fab:hover,
                .sw-fab:focus-visible {
                    width: 210px;
                    padding: 0 18px 0 14px;
                    justify-content: flex-start;
                    border-radius: 22px;
                    background: #f13800;
                    transform: translateY(-2px);
                    box-shadow: 0 6px 18px rgba(223, 54, 1, 0.35);
                }
                .sw-fab:hover .sw-fab-label,
                .sw-fab:focus-visible .sw-fab-label {
                    max-width: 200px;
                    opacity: 1;
                    margin-left: 8px;
                }
                .sw-fab:active {
                    transform: translateY(0);
                }

                /* ── Backdrop ── */
                .sw-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 1200;
                    background: rgba(0, 20, 50, 0.55);
                    backdrop-filter: blur(3px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    animation: sw-fade-in 0.18s ease;
                }
                @keyframes sw-fade-in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }

                /* ── Modal card ── */
                .sw-modal {
                    width: 100%;
                    max-width: 460px;
                    background: var(--surface-card);
                    border-radius: 18px;
                    overflow: hidden;
                    box-shadow:
                        0 2px 4px rgba(0,0,0,0.08),
                        0 12px 32px rgba(0,0,0,0.22),
                        0 40px 80px rgba(0,0,0,0.18);
                    animation: sw-rise 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
                }
                @keyframes sw-rise {
                    from { opacity: 0; transform: translateY(18px) scale(0.97); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }

                /* ── Header ── */
                .sw-header {
                    display: flex;
                    align-items: flex-start;
                    gap: 14px;
                    padding: 22px 22px 18px;
                    background: #002855;
                    position: relative;
                }
                .sw-header::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: linear-gradient(90deg, #006edc 0%, #df3601 100%);
                }

                .sw-header-icon {
                    width: 38px;
                    height: 38px;
                    flex-shrink: 0;
                    border-radius: 10px;
                    background: rgba(255,255,255,0.12);
                    color: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-top: 1px;
                }

                .sw-header-copy {
                    flex: 1;
                    min-width: 0;
                }

                .sw-title {
                    font-size: 17px;
                    font-weight: 700;
                    color: #fff;
                    margin: 0 0 3px;
                    letter-spacing: -0.01em;
                }

                .sw-subtitle {
                    font-size: 12.5px;
                    color: rgba(255,255,255,0.65);
                    margin: 0;
                    line-height: 1.4;
                }

                .sw-close {
                    width: 32px;
                    height: 32px;
                    flex-shrink: 0;
                    background: rgba(255,255,255,0.1);
                    border: none;
                    border-radius: 8px;
                    color: rgba(255,255,255,0.8);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.15s;
                    margin-top: 2px;
                }
                .sw-close:hover {
                    background: rgba(255,255,255,0.2);
                    color: #fff;
                }

                /* ── Body ── */
                .sw-body {
                    padding: 20px 22px 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .sw-label {
                    font-size: 11px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                    color: var(--text-muted);
                }

                .sw-textarea {
                    width: 100%;
                    resize: none;
                    border-radius: 10px;
                    border: 1.5px solid var(--surface-border);
                    padding: 12px 14px;
                    font-size: 14px;
                    font-family: inherit;
                    line-height: 1.55;
                    background: var(--surface-elevated, var(--surface-bg));
                    color: var(--text-primary);
                    outline: none;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    box-sizing: border-box;
                }
                .sw-textarea::placeholder { color: var(--text-muted); opacity: 0.7; }
                .sw-textarea:focus {
                    border-color: #006edc;
                    box-shadow: 0 0 0 3px rgba(0, 110, 220, 0.12);
                }

                .sw-char-count {
                    font-size: 11px;
                    color: var(--text-muted);
                    text-align: right;
                    opacity: 0.7;
                }

                /* ── Footer ── */
                .sw-footer {
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 10px;
                    padding: 14px 22px 20px;
                    border-top: 1px solid var(--surface-border);
                }

                .sw-btn-cancel {
                    height: 38px;
                    padding: 0 16px;
                    background: transparent;
                    border: 1.5px solid var(--surface-border);
                    border-radius: 8px;
                    color: var(--text-muted);
                    font-size: 13px;
                    font-family: inherit;
                    cursor: pointer;
                    transition: border-color 0.15s, color 0.15s;
                }
                .sw-btn-cancel:hover {
                    border-color: var(--text-muted);
                    color: var(--text-primary);
                }

                .sw-btn-send {
                    height: 38px;
                    padding: 0 18px;
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    background: #002855;
                    color: #fff;
                    border: none;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 600;
                    font-family: inherit;
                    cursor: pointer;
                    transition: background 0.15s, transform 0.12s;
                }
                .sw-btn-send:not(:disabled):hover {
                    background: #003f7a;
                    transform: translateY(-1px);
                }
                .sw-btn-send:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* ── Spinner ── */
                .sw-spinner {
                    width: 14px;
                    height: 14px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: sw-spin 0.7s linear infinite;
                }
                @keyframes sw-spin { to { transform: rotate(360deg); } }

            `}</style>
        </>
    );
}

import { useEffect, useRef, useState } from 'react';
import { FiMessageSquare, FiX, FiSend } from 'react-icons/fi';
import { suggestionsApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const DEFAULT_OFFSET = 24;
const STORAGE_KEY = 'suggestionsWidgetPosition';

export default function SuggestionsWidget() {
    const { user } = useAuth();
    const { toast } = useToast();
    const widgetRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [dragging, setDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (position || typeof window === 'undefined') return;
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                    setPosition(parsed);
                    return;
                }
            } catch {
                // ignore
            }
        }
        const nextX = window.innerWidth - 72 - DEFAULT_OFFSET;
        const nextY = window.innerHeight - 72 - DEFAULT_OFFSET;
        setPosition({ x: Math.max(DEFAULT_OFFSET, nextX), y: Math.max(DEFAULT_OFFSET, nextY) });
    }, [position]);

    useEffect(() => {
        if (!dragging) return;
        const handleMove = (event: MouseEvent) => {
            if (!widgetRef.current) return;
            const rect = widgetRef.current.getBoundingClientRect();
            const nextX = event.clientX - dragOffset.current.x;
            const nextY = event.clientY - dragOffset.current.y;
            const maxX = window.innerWidth - rect.width - DEFAULT_OFFSET;
            const maxY = window.innerHeight - rect.height - DEFAULT_OFFSET;
            const clampedX = Math.min(Math.max(DEFAULT_OFFSET, nextX), Math.max(DEFAULT_OFFSET, maxX));
            const clampedY = Math.min(Math.max(DEFAULT_OFFSET, nextY), Math.max(DEFAULT_OFFSET, maxY));
            setPosition({ x: clampedX, y: clampedY });
        };
        const handleUp = () => {
            setDragging(false);
        };
        const handleTouchMove = (event: TouchEvent) => {
            if (!widgetRef.current) return;
            const touch = event.touches[0];
            if (!touch) return;
            const rect = widgetRef.current.getBoundingClientRect();
            const nextX = touch.clientX - dragOffset.current.x;
            const nextY = touch.clientY - dragOffset.current.y;
            const maxX = window.innerWidth - rect.width - DEFAULT_OFFSET;
            const maxY = window.innerHeight - rect.height - DEFAULT_OFFSET;
            const clampedX = Math.min(Math.max(DEFAULT_OFFSET, nextX), Math.max(DEFAULT_OFFSET, maxX));
            const clampedY = Math.min(Math.max(DEFAULT_OFFSET, nextY), Math.max(DEFAULT_OFFSET, maxY));
            setPosition({ x: clampedX, y: clampedY });
        };
        const handleTouchEnd = () => {
            setDragging(false);
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchmove', handleTouchMove, { passive: true });
        window.addEventListener('touchend', handleTouchEnd);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [dragging]);

    useEffect(() => {
        if (!position) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
    }, [position]);

    const startDrag = (event: React.MouseEvent) => {
        if (!widgetRef.current) return;
        const rect = widgetRef.current.getBoundingClientRect();
        dragOffset.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
        setDragging(true);
    };

    const startDragTouch = (event: React.TouchEvent) => {
        if (!widgetRef.current) return;
        const touch = event.touches[0];
        if (!touch) return;
        const rect = widgetRef.current.getBoundingClientRect();
        dragOffset.current = {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
        };
        setDragging(true);
    };

    useEffect(() => {
        if (!position) return;
        const handleResize = () => {
            // Clamp position using the button dimension (64px) so that resizing 
            // the window doesn't shift the anchor permanently while the panel is open.
            const maxX = window.innerWidth - 64 - DEFAULT_OFFSET;
            const maxY = window.innerHeight - 64 - DEFAULT_OFFSET;
            const clampedX = Math.min(Math.max(DEFAULT_OFFSET, position.x), Math.max(DEFAULT_OFFSET, maxX));
            const clampedY = Math.min(Math.max(DEFAULT_OFFSET, position.y), Math.max(DEFAULT_OFFSET, maxY));
            if (clampedX !== position.x || clampedY !== position.y) {
                setPosition({ x: clampedX, y: clampedY });
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [position]);

    useEffect(() => {
        if (!open) {
            setPanelOffset({ x: 0, y: 0 });
            return;
        }
        const frame = requestAnimationFrame(() => {
            if (!widgetRef.current) return;
            const rect = widgetRef.current.getBoundingClientRect();
            const overflowRight = rect.right - (window.innerWidth - DEFAULT_OFFSET);
            const overflowLeft = DEFAULT_OFFSET - rect.left;
            const overflowBottom = rect.bottom - (window.innerHeight - DEFAULT_OFFSET);
            const overflowTop = DEFAULT_OFFSET - rect.top;
            const offsetX = overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0;
            const offsetY = overflowBottom > 0 ? -overflowBottom : overflowTop > 0 ? overflowTop : 0;
            setPanelOffset({ x: offsetX, y: offsetY });
        });
        return () => cancelAnimationFrame(frame);
    }, [open, position]);

    const handleSubmit = async () => {
        if (!user || !message.trim()) return;
        setSending(true);
        try {
            const payload = {
                message: message.trim(),
                userId: user.userId || user.workerId || '',
                userName: `${user.nombre || ''} ${user.apellido || ''}`.trim(),
                tenantId: user.tenantId || null,
            };
            const res = await suggestionsApi.create(payload);
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

    if (!user || !position) return null;

    return (
        <div
            ref={widgetRef}
            style={{
                position: 'fixed',
                left: position.x,
                top: position.y,
                zIndex: 1100,
                width: open ? 320 : 64,
                transform: `translate(${panelOffset.x}px, ${panelOffset.y}px)`,
            }}
        >
            {open ? (
                <div
                    style={{
                        background: 'var(--surface-card)',
                        borderRadius: '16px',
                        border: '1px solid var(--surface-border)',
                        boxShadow: '0 16px 32px rgba(15,23,42,0.18)',
                        overflow: 'hidden',
                    }}
                >
                    <div
                        onMouseDown={startDrag}
                        onTouchStart={startDragTouch}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            background: 'var(--gradient-primary)',
                            color: 'white',
                            cursor: 'grab',
                        }}
                    >
                        <div style={{ fontWeight: 700 }}>Sugerencias</div>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                            aria-label="Cerrar sugerencias"
                        >
                            <FiX />
                        </button>
                    </div>
                    <div style={{ padding: '12px 14px', display: 'grid', gap: '10px' }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Comparte una idea o problema. Esto se envia al equipo.
                        </div>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            rows={4}
                            placeholder="Escribe tu sugerencia..."
                            style={{
                                width: '100%',
                                resize: 'none',
                                borderRadius: '10px',
                                border: '1px solid var(--surface-border)',
                                padding: '10px',
                                fontSize: '0.9rem',
                                background: 'var(--surface-elevated)',
                                color: 'var(--text-primary)',
                            }}
                        />
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleSubmit}
                            disabled={sending || !message.trim()}
                            style={{ justifySelf: 'flex-end', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                        >
                            <FiSend /> {sending ? 'Enviando...' : 'Enviar'}
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    onMouseDown={startDrag}
                    onTouchStart={startDragTouch}
                    aria-label="Abrir sugerencias"
                    style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: 'var(--gradient-primary)',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        boxShadow: 'var(--shadow-glow-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                    }}
                >
                    <FiMessageSquare />
                </button>
            )}
        </div>
    );
}

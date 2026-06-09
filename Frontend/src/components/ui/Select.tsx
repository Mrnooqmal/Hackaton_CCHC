import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiChevronDown, FiSearch } from 'react-icons/fi';

/* ------------------------------------------------------------------ */
/*  Tipos                                                             */
/* ------------------------------------------------------------------ */
export interface SelectOption {
    value: string;
    label: string;
    /** Icono opcional a la izquierda de la opcion */
    icon?: ReactNode;
    /** Texto secundario bajo el label */
    description?: string;
    disabled?: boolean;
}

export interface SelectProps {
    value?: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    /** Muestra un buscador dentro del panel (util para listas largas) */
    searchable?: boolean;
    /** Etiqueta accesible cuando no hay <label> asociado */
    ariaLabel?: string;
    id?: string;
    className?: string;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                        */
/* ------------------------------------------------------------------ */
export default function Select({
    value,
    onChange,
    options,
    placeholder = 'Seleccionar…',
    disabled = false,
    searchable = false,
    ariaLabel,
    id,
    className = '',
}: SelectProps) {
    const reactId = useId();
    const listboxId = id ? `${id}-listbox` : `select-${reactId}`;

    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(-1);
    const [rect, setRect] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

    const selected = options.find((o) => o.value === value) || null;
    const visible = searchable && query
        ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
        : options;

    /* ----- Posicionamiento (portal con position: fixed) ----- */
    const reposition = () => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - r.bottom;
        const panelH = Math.min(280, visible.length * 44 + (searchable ? 52 : 0) + 8);
        const above = spaceBelow < panelH && r.top > spaceBelow;
        setRect({
            top: above ? r.top : r.bottom,
            left: r.left,
            width: r.width,
            above,
        });
    };

    useLayoutEffect(() => {
        if (open) reposition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, visible.length]);

    useEffect(() => {
        if (!open) return;
        const onScroll = () => reposition();
        const onResize = () => reposition();
        // capture: true para detectar el scroll del modal-body tambien
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onResize);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    /* ----- Cierre por clic afuera ----- */
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    /* ----- Foco en buscador / reset al abrir ----- */
    useEffect(() => {
        if (open) {
            setQuery('');
            setHighlight(options.findIndex((o) => o.value === value));
            if (searchable) requestAnimationFrame(() => searchRef.current?.focus());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const commit = (opt: SelectOption) => {
        if (opt.disabled) return;
        onChange(opt.value);
        setOpen(false);
        triggerRef.current?.focus();
    };

    const moveHighlight = (dir: 1 | -1) => {
        if (!visible.length) return;
        setHighlight((h) => {
            let next = h;
            for (let i = 0; i < visible.length; i++) {
                next = (next + dir + visible.length) % visible.length;
                if (!visible[next]?.disabled) break;
            }
            return next;
        });
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (disabled) return;
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); moveHighlight(1); break;
            case 'ArrowUp': e.preventDefault(); moveHighlight(-1); break;
            case 'Enter':
                e.preventDefault();
                if (visible[highlight]) commit(visible[highlight]);
                break;
            case 'Escape': e.preventDefault(); setOpen(false); break;
            case 'Tab': setOpen(false); break;
        }
    };

    const panel = open && rect && createPortal(
        <div
            ref={panelRef}
            className={`ui-select-panel ${rect.above ? 'is-above' : ''}`}
            style={{
                position: 'fixed',
                top: rect.top,
                left: rect.left,
                width: rect.width,
                transform: rect.above ? 'translateY(-100%)' : undefined,
            }}
            role="listbox"
            id={listboxId}
        >
            {searchable && (
                <div className="ui-select-search">
                    <FiSearch size={15} />
                    <input
                        ref={searchRef}
                        type="text"
                        value={query}
                        placeholder="Buscar…"
                        onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
                        onKeyDown={onKeyDown}
                    />
                </div>
            )}
            <div className="ui-select-options">
                {visible.length === 0 ? (
                    <div className="ui-select-empty">Sin resultados</div>
                ) : visible.map((opt, i) => (
                    <button
                        type="button"
                        key={opt.value}
                        role="option"
                        aria-selected={opt.value === value}
                        disabled={opt.disabled}
                        className={`ui-select-option ${opt.value === value ? 'selected' : ''} ${i === highlight ? 'highlight' : ''}`}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => commit(opt)}
                    >
                        {opt.icon && <span className="ui-select-option-icon">{opt.icon}</span>}
                        <span className="ui-select-option-text">
                            <span className="ui-select-option-label">{opt.label}</span>
                            {opt.description && <span className="ui-select-option-desc">{opt.description}</span>}
                        </span>
                        {opt.value === value && <FiCheck className="ui-select-option-check" size={16} />}
                    </button>
                ))}
            </div>
        </div>,
        document.body,
    );

    return (
        <div className={`ui-select ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                id={id}
                className={`ui-select-trigger ${open ? 'open' : ''} ${!selected ? 'placeholder' : ''}`}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                aria-label={ariaLabel}
                onClick={() => !disabled && setOpen((o) => !o)}
                onKeyDown={onKeyDown}
            >
                {selected?.icon && <span className="ui-select-value-icon">{selected.icon}</span>}
                <span className="ui-select-value">{selected ? selected.label : placeholder}</span>
                <FiChevronDown className="ui-select-caret" size={18} />
            </button>
            {panel}
        </div>
    );
}

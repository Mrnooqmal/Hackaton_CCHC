import { useEffect, useRef, useState, useCallback } from 'react';
import { FiMapPin, FiLoader } from 'react-icons/fi';

interface NominatimResult {
    place_id: number;
    display_name: string;
    address: {
        road?: string;
        house_number?: string;
        suburb?: string;
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        postcode?: string;
    };
    lat: string;
    lon: string;
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    className?: string;
}

// Extract the street name + number from a Nominatim result
function getMainLine(result: NominatimResult): string {
    const { road, house_number } = result.address;
    if (road) return [road, house_number].filter(Boolean).join(' ');
    return result.display_name.split(',')[0];
}

function getSecondaryLine(result: NominatimResult): string {
    const { suburb, city, town, village, county, state } = result.address;
    return [suburb, city || town || village, county, state]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i) // dedup
        .slice(0, 3)
        .join(', ');
}

let debounceTimer: ReturnType<typeof setTimeout>;

export default function AddressAutocomplete({ value, onChange, placeholder = 'Ej: Av. Providencia 1234, Santiago', required, className }: Props) {
    const [query, setQuery] = useState(value);
    const [results, setResults] = useState<NominatimResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync external value changes (e.g. form reset)
    useEffect(() => {
        setQuery(value);
    }, [value]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const fetchSuggestions = useCallback((q: string) => {
        clearTimeout(debounceTimer);
        if (q.trim().length < 3) { setResults([]); setOpen(false); return; }
        debounceTimer = setTimeout(async () => {
            setLoading(true);
            try {
                const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Chile')}&countrycodes=cl&format=json&addressdetails=1&limit=6&accept-language=es`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'HackatonCCHC/1.0 (contacto@example.com)' }
                });
                const data: NominatimResult[] = await res.json();
                setResults(data);
                setOpen(data.length > 0);
                setActiveIndex(-1);
            } catch {
                setResults([]);
            } finally {
                setLoading(false);
            }
        }, 550);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setQuery(v);
        onChange(v);
        fetchSuggestions(v);
    };

    const selectResult = (result: NominatimResult) => {
        const streetOnly = getMainLine(result);
        setQuery(streetOnly);
        onChange(streetOnly);
        setOpen(false);
        setResults([]);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!open || results.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex(i => Math.min(i + 1, results.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex(i => Math.max(i - 1, -1));
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            selectResult(results[activeIndex]);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
                <input
                    ref={inputRef}
                    type="text"
                    required={required}
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => results.length > 0 && setOpen(true)}
                    placeholder={placeholder}
                    autoComplete="off"
                    className={className || 'form-input'}
                    style={{ paddingRight: '36px' }}
                />
                <div style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', display: 'flex', alignItems: 'center', pointerEvents: 'none',
                }}>
                    {loading
                        ? <FiLoader size={15} style={{ animation: 'addr-spin 0.8s linear infinite' }} />
                        : <FiMapPin size={15} />}
                </div>
            </div>

            {open && results.length > 0 && (
                <div className="addr-dropdown">
                    {results.map((r, i) => (
                        <button
                            key={r.place_id}
                            type="button"
                            className={`addr-option${i === activeIndex ? ' active' : ''}`}
                            onMouseEnter={() => setActiveIndex(i)}
                            onMouseDown={(e) => { e.preventDefault(); selectResult(r); }}
                        >
                            <FiMapPin size={14} className="addr-pin" />
                            <div className="addr-text">
                                <span className="addr-main">{getMainLine(r)}</span>
                                <span className="addr-secondary">{getSecondaryLine(r)}</span>
                            </div>
                        </button>
                    ))}
                    <div className="addr-footer">
                        <span>Resultados de © OpenStreetMap</span>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes addr-spin { to { transform: rotate(360deg); } }

                .addr-dropdown {
                    position: absolute;
                    top: calc(100% + 4px);
                    left: 0;
                    right: 0;
                    background: var(--surface-card);
                    border: 1px solid var(--surface-border);
                    border-radius: var(--radius-lg);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
                    z-index: 200;
                    overflow: hidden;
                    animation: addr-in 0.15s ease-out;
                }
                @keyframes addr-in {
                    from { opacity: 0; transform: translateY(-4px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                .addr-option {
                    width: 100%;
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 10px 14px;
                    background: none;
                    border: none;
                    cursor: pointer;
                    text-align: left;
                    transition: background 0.1s;
                    border-bottom: 1px solid var(--surface-border);
                }
                .addr-option:last-of-type { border-bottom: none; }
                .addr-option:hover,
                .addr-option.active {
                    background: var(--surface-elevated);
                }
                .addr-pin {
                    color: var(--accent);
                    flex-shrink: 0;
                    margin-top: 2px;
                }
                .addr-text {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    min-width: 0;
                }
                .addr-main {
                    font-size: 13px;
                    font-weight: 600;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .addr-secondary {
                    font-size: 12px;
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .addr-footer {
                    padding: 5px 14px;
                    font-size: 10px;
                    color: var(--text-muted);
                    background: var(--surface-elevated);
                    border-top: 1px solid var(--surface-border);
                    opacity: 0.7;
                }
            `}</style>
        </div>
    );
}

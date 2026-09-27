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
        municipality?: string;
        city_district?: string;
        county?: string;
        state?: string;
        postcode?: string;
    };
    lat: string;
    lon: string;
}

/**
 * Lo que se sabe del lugar elegido, además de la calle.
 *
 * La comuna viene como una lista de candidatas de MÁS a MENOS específica: el
 * proveedor la reparte entre varios campos según cómo esté mapeada la zona, y
 * quien recibe esto suele tener su propio catálogo con el que contrastarlas.
 *
 * El orden importa y no es el obvio. En el Gran Santiago `city` trae la
 * conurbación ("Santiago") y la comuna real queda en `suburb`: pidiendo
 * primero `city`, una dirección de Las Condes, Ñuñoa o Maipú se guardaba como
 * Santiago. Los barrios que ocupan `suburb` fuera de la capital ("Almendral"
 * en Valparaíso, "Rancagua Sur") no figuran en ningún catálogo de comunas, así
 * que no calzan y la búsqueda sigue hasta `city`.
 *
 * `county` queda fuera a propósito: en Chile trae la provincia, que a veces se
 * llama igual que una comuna que no es esta.
 */
export interface LugarElegido {
    direccion: string;
    region: string;
    comunaCandidatas: string[];
    lat: string;
    lon: string;
}

interface Props {
    value: string;
    onChange: (value: string) => void;
    /** Se dispara solo al elegir una sugerencia, no al escribir. */
    onSelect?: (lugar: LugarElegido) => void;
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

export default function AddressAutocomplete({ value, onChange, onSelect, placeholder = 'Ej: Av. Providencia 1234, Santiago', required, className }: Props) {
    const [query, setQuery] = useState(value);
    const [results, setResults] = useState<NominatimResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Con el debounce, una respuesta lenta de una consulta vieja puede llegar
    // después de una nueva: solo se pinta la del último pedido.
    const pedidoRef = useRef(0);

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
        clearTimeout(debounceRef.current);
        if (q.trim().length < 3) { setResults([]); setOpen(false); setLoading(false); return; }
        // La lista se abre YA, en «buscando», sin esperar al debounce ni a la
        // red. El buscador tarda un par de segundos y, sin esta señal, el campo
        // se lee como un texto libre cualquiera: nadie espera sugerencias que
        // no sabe que existen.
        setResults([]);
        setLoading(true);
        setOpen(true);
        setActiveIndex(-1);
        const pedido = ++pedidoRef.current;
        debounceRef.current = setTimeout(async () => {
            try {
                const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Chile')}&countrycodes=cl&format=json&addressdetails=1&limit=6&accept-language=es`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'BuildAndServe/1.0 (contacto@example.com)' }
                });
                const data: NominatimResult[] = await res.json();
                if (pedido !== pedidoRef.current) return;
                setResults(data);
                setActiveIndex(-1);
            } catch {
                if (pedido === pedidoRef.current) setResults([]);
            } finally {
                if (pedido === pedidoRef.current) setLoading(false);
            }
        }, 550);
    }, []);

    useEffect(() => () => clearTimeout(debounceRef.current), []);

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
        // La comuna y la región se veían en la sugerencia y se perdían al
        // elegirla: quedaba solo la calle y había que volver a tipearlas en sus
        // propios campos, teniéndolas ya a la vista.
        const a = result.address;
        onSelect?.({
            direccion: streetOnly,
            region: a.state || '',
            comunaCandidatas: [a.suburb, a.city_district, a.municipality, a.village, a.town, a.city]
                .filter((v): v is string => Boolean(v)),
            lat: result.lat,
            lon: result.lon,
        });
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

            {open && (
                <div className="addr-dropdown">
                    {loading && (
                        <div className="addr-estado">
                            <FiLoader size={14} style={{ animation: 'addr-spin 0.8s linear infinite', flexShrink: 0 }} />
                            Buscando direcciones…
                        </div>
                    )}
                    {!loading && results.length === 0 && (
                        <div className="addr-estado">
                            Sin resultados. Puedes escribir la dirección a mano.
                        </div>
                    )}
                    {!loading && results.map((r, i) => (
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
                /* Mientras busca y cuando no hay nada: una fila con el mismo
                   alto que una sugerencia, para que la lista no dé un salto al
                   llenarse. */
                .addr-estado {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 13px 14px;
                    font-size: 13px;
                    color: var(--text-secondary);
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

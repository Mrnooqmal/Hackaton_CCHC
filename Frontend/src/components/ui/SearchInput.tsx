import { FiSearch } from 'react-icons/fi';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
export interface SearchInputProps {
    /** Valor controlado */
    value: string;
    /** Callback al cambiar */
    onChange: (value: string) => void;
    /** Placeholder */
    placeholder?: string;
    /** Ancho maximo */
    maxWidth?: string;
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */
export default function SearchInput({
    value,
    onChange,
    placeholder = 'Buscar...',
    maxWidth = '300px',
}: SearchInputProps) {
    return (
        <div className="ui-search-input" style={{ maxWidth }}>
            <FiSearch className="ui-search-input-icon" />
            <input
                type="text"
                className="form-input"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                style={{ paddingLeft: '40px' }}
            />
        </div>
    );
}

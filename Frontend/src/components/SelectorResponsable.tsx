import { useEffect, useMemo, useState } from 'react';
import { workersApi, type Worker } from '../api/client';
import { Select } from './ui';

// Lo que trae `GET /personas`: además de `Worker`, campos que solo algunas fichas tienen.
type PersonaListada = Worker & { puesto?: string };

interface Props {
    value: string;
    onChange: (personaId: string) => void;
    disabled?: boolean;
    id?: string;
    placeholder?: string;
}

/**
 * Elige a una persona ACTIVA de la empresa para dejarla a cargo de algo (una medida,
 * la corrección de un hallazgo). Reutiliza el listado de personas que ya usan
 * `Incidents.tsx` e `IncidentReportar.tsx`. Quien no terminó de enrolarse o ya no
 * está en la empresa no aparece: el servidor tampoco la acepta.
 *
 * `persona.estado` puede venir ausente en fichas antiguas del listado: solo se
 * descartan las que dicen explícitamente otra cosa que "activo".
 */
export default function SelectorResponsable({ value, onChange, disabled, id, placeholder = 'Elige a una persona…' }: Props) {
    const [personas, setPersonas] = useState<PersonaListada[] | null>(null);

    useEffect(() => {
        let cancelado = false;
        workersApi.list().then((res) => {
            if (!cancelado) setPersonas(res.success && res.data ? (res.data as PersonaListada[]) : []);
        }).catch(() => {
            if (!cancelado) setPersonas([]);
        });
        return () => { cancelado = true; };
    }, []);

    const opciones = useMemo(() => (personas ?? [])
        .filter((p) => p.personaId && (!p.estado || p.estado === 'activo'))
        .map((p) => ({
            value: p.personaId,
            label: `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Sin nombre',
            description: p.cargo || p.puesto || undefined,
        })), [personas]);

    return (
        <Select
            id={id}
            ariaLabel="Persona responsable"
            value={value}
            onChange={onChange}
            options={opciones}
            placeholder={personas === null ? 'Cargando personas…' : placeholder}
            disabled={disabled || personas === null}
            searchable
        />
    );
}

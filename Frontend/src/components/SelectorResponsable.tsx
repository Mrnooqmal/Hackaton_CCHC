import { useEffect, useMemo, useState } from 'react';
import { incidentsApi, type Worker } from '../api/client';
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
 * Elige a una persona ACTIVA de la empresa para dejarla a cargo de algo (la corrección
 * de un hallazgo). Reutiliza el listado de personas que ya usan
 * `Incidents.tsx` e `IncidentReportar.tsx`. Quien no terminó de enrolarse o ya no
 * está en la empresa no aparece: el servidor tampoco la acepta.
 *
 * Solo aparecen las de estado `activo`, exactamente como lo exige el servidor, que es quien
 * las filtra (`estado=activo`): antes la pantalla dejaba pasar las fichas sin estado y las
 * pendientes, y el servidor las rechazaba al guardar.
 */
export default function SelectorResponsable({ value, onChange, disabled, id, placeholder = 'Elige a una persona…' }: Props) {
    const [personas, setPersonas] = useState<PersonaListada[] | null>(null);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.personasACargo().then((res) => {
            if (!cancelado) setPersonas(res.success && res.data ? (res.data as PersonaListada[]) : []);
        }).catch(() => {
            if (!cancelado) setPersonas([]);
        });
        return () => { cancelado = true; };
    }, []);

    const opciones = useMemo(() => (personas ?? [])
        .filter((p) => p.personaId)
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

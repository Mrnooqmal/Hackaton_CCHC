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
    nombreActual?: string | null;
}

/**
 * Elige a una persona ACTIVA de la empresa que pueda ver el historial de incidentes, para
 * dejarla a cargo de la corrección de un hallazgo. Reutiliza el listado de personas que ya usan
 * `Incidents.tsx` e `IncidentReportar.tsx`. Quien no terminó de enrolarse o ya no
 * está en la empresa no aparece: el servidor tampoco la acepta.
 *
 * Solo aparecen las de estado `activo`, exactamente como lo exige el servidor, que es quien
 * las filtra (`estado=activo`): antes la pantalla dejaba pasar las fichas sin estado y las
 * pendientes, y el servidor las rechazaba al guardar.
 */
export default function SelectorResponsable({ value, onChange, disabled, id, placeholder = 'Elige a una persona…', nombreActual }: Props) {
    const [personas, setPersonas] = useState<PersonaListada[] | null>(null);

    const [falloCarga, setFalloCarga] = useState(false);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.personasACargo().then((res) => {
            if (cancelado) return;
            setFalloCarga(!res.success);
            setPersonas(res.success && res.data ? (res.data as PersonaListada[]) : []);
        }).catch(() => {
            if (cancelado) return;
            setFalloCarga(true);
            setPersonas([]);
        });
        return () => { cancelado = true; };
    }, []);

    const opciones = useMemo(() => {
        const lista = (personas ?? [])
            .filter((p) => p.personaId)
            .map((p) => ({
                value: p.personaId,
                label: `${p.nombre || ''} ${p.apellido || ''}`.trim() || 'Sin nombre',
                description: p.cargo || p.puesto || undefined,
            }));
        if (personas !== null && value && nombreActual && !lista.some((o) => o.value === value)) {
            lista.unshift({ value, label: nombreActual, description: 'Asignación actual' });
        }
        return lista;
    }, [personas, value, nombreActual]);

    const sinOpciones = personas !== null && opciones.length === 0;

    return (
        <>
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
        {falloCarga && <p className="form-hint" role="alert">No pudimos cargar las personas. Revisa tu conexión y vuelve a abrir esta sección.</p>}
        {!falloCarga && sinOpciones && <p className="form-hint">Nadie activo puede ver el historial de incidentes. Pide a quien administra la empresa que dé ese permiso.</p>}
        </>
    );
}

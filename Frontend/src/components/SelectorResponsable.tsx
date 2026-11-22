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
    /**
     * Ofrece solo a las personas que pueden ver el caso (`incidentes.historial`). Es para las
     * medidas de un incidente: el aviso de la medida lleva a la persona al caso, y sin ese
     * permiso el caso le responde 404. Lo filtra el servidor, con la misma resolución de roles
     * que usa para aceptar al responsable: el navegador no tiene los roles de la empresa para
     * hacerlo solo. Sin esta opción se ofrece a todas las personas activas (el responsable de
     * un hallazgo no necesita el permiso).
     */
    soloQuienVeElCaso?: boolean;
}

/**
 * Elige a una persona ACTIVA de la empresa para dejarla a cargo de algo (una medida,
 * la corrección de un hallazgo). Reutiliza el listado de personas que ya usan
 * `Incidents.tsx` e `IncidentReportar.tsx`. Quien no terminó de enrolarse o ya no
 * está en la empresa no aparece: el servidor tampoco la acepta.
 *
 * Solo aparecen las de estado `activo`, exactamente como lo exige el servidor, que es quien
 * las filtra (`estado=activo`): antes la pantalla dejaba pasar las fichas sin estado y las
 * pendientes, y el servidor las rechazaba al guardar.
 */
export default function SelectorResponsable({ value, onChange, disabled, id, placeholder = 'Elige a una persona…', soloQuienVeElCaso }: Props) {
    const [personas, setPersonas] = useState<PersonaListada[] | null>(null);

    useEffect(() => {
        let cancelado = false;
        incidentsApi.personasACargo({ soloQuienVeElCaso }).then((res) => {
            if (!cancelado) setPersonas(res.success && res.data ? (res.data as PersonaListada[]) : []);
        }).catch(() => {
            if (!cancelado) setPersonas([]);
        });
        return () => { cancelado = true; };
    }, [soloQuienVeElCaso]);

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

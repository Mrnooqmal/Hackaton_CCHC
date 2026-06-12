import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { tenantsApi, type TenantCargo } from '../api/tenants.api';
import { DS44_CARGOS, DS44_CARGO_KITS, DS44_KIT_GENERICO } from '../utils/ds44';

// Semilla local (fallback) mientras carga / si falla el fetch. Igual a la que
// el backend siembra, para que la UI nunca quede sin cargos.
const SEED_CATALOG: TenantCargo[] = DS44_CARGOS.map((c) => ({
    codigo: c.codigo,
    label: c.label,
    legacy: c.legacy,
    seed: true,
    kit: DS44_CARGO_KITS[c.codigo] || DS44_KIT_GENERICO,
}));

let cache: TenantCargo[] | null = null;

/**
 * Catálogo de cargos del tenant (constructor). Carga una vez y cachea en módulo.
 * Devuelve los cargos editables + opciones {value,label} listas para <Select>.
 * Fallback a la semilla EBCO mientras carga o si no hay tenant.
 */
export function useCargoCatalog() {
    const { user } = useAuth();
    const tenantId = (user as any)?.tenantId as string | undefined;
    const [cargos, setCargos] = useState<TenantCargo[]>(cache || SEED_CATALOG);
    const [loading, setLoading] = useState(!cache);

    useEffect(() => {
        if (!tenantId || cache) { setLoading(false); return; }
        let alive = true;
        setLoading(true);
        tenantsApi.getCargos(tenantId)
            .then((res) => {
                if (!alive) return;
                const list = res?.data?.cargos;
                if (Array.isArray(list) && list.length) {
                    cache = list;
                    setCargos(list);
                }
            })
            .catch(() => { /* mantiene semilla */ })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [tenantId]);

    const options = cargos.map((c) => ({ value: c.codigo, label: c.label }));
    return { cargos, options, loading };
}

// Invalida el cache tras guardar en el constructor.
export function invalidateCargoCatalog() { cache = null; }

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { obrasApi } from '../api/client';
import { useAuth } from './AuthContext';
import { PERMISSIONS } from '../permissions';

export interface Obra {
  obraId: string;
  tenantId: string;
  nombre: string;
  codigo?: string;
  // Eje fisico (informativo). Canonico: etapaConstructivaActual; etapaActual es alias legacy.
  etapaConstructivaActual?: string;
  etapaActual: string;
  // Eje normativo (cumplimiento DS44)
  faseDeming?: string;
  estado: string;
  fasesConfig?: any;
  cumplimientoDS44?: any;
  [key: string]: any;
}

/**
 * Ámbito de trabajo elegido justo después del login.
 *
 *  - `'obra'`    → se opera una obra concreta (`selectedObraId`); toda la
 *                  plataforma muestra solo el contenido de esa obra.
 *  - `'empresa'` → vista global sin obra: gestión de la empresa (admin) o
 *                  usuario que todavía no pertenece a ninguna obra.
 *  - `null`      → aún no se ha elegido; la app muestra la pantalla de
 *                  selección (`/seleccionar-obra`) antes de dejar entrar.
 */
export type ObraScope = 'obra' | 'empresa' | null;

const STORAGE_OBRA = 'selectedObraId';
const STORAGE_SCOPE = 'obraScope';

interface ObraContextType {
  obras: Obra[];
  selectedObraId: string | null;
  selectedObra: Obra | null;
  setSelectedObraId: (id: string | null) => void;
  isLoadingObras: boolean;
  refreshObras: () => Promise<void>;
  /** Ámbito elegido tras el login (ver ObraScope). */
  scope: ObraScope;
  /** `false` mientras falte elegir ámbito: la app aún no debe renderizarse. */
  scopeElegido: boolean;
  /** Vista global de empresa (sin obra activa). */
  modoEmpresa: boolean;
  /** El usuario puede administrar la empresa (opción "Gestionar empresa"). */
  puedeGestionarEmpresa: boolean;
  /** Hay más de un ámbito posible, así que ofrecer "Cambiar de obra" tiene sentido. */
  puedeCambiarDeObra: boolean;
  elegirObra: (obraId: string) => void;
  elegirEmpresa: () => void;
  /** Vuelve al paso de selección posterior al login. */
  cambiarDeObra: () => void;
}

const ObraContext = createContext<ObraContextType | undefined>(undefined);

export const ObraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading, hasPermission } = useAuth();
  const [obras, setObras] = useState<Obra[]>([]);
  const [selectedObraId, setSelectedObraIdState] = useState<string | null>(null);
  const [scope, setScope] = useState<ObraScope>(null);
  const [isLoadingObras, setIsLoadingObras] = useState(false);

  // Quien puede ver Mi Empresa puede quedarse en la vista global: para esa
  // persona siempre hay al menos dos ámbitos entre los que elegir.
  const puedeGestionarEmpresa = hasPermission(PERMISSIONS.EMPRESA_VER);

  // Espejo del ámbito vigente para que refreshObras (que se vuelve a llamar al
  // crear una obra, por ejemplo) no arrastre valores viejos ni se recree.
  const scopeRef = useRef<ObraScope>(null);
  const obraIdRef = useRef<string | null>(null);

  const aplicar = useCallback((nextScope: ObraScope, obraId: string | null) => {
    scopeRef.current = nextScope;
    obraIdRef.current = obraId;
    setScope(nextScope);
    setSelectedObraIdState(obraId);

    if (!nextScope) {
      localStorage.removeItem(STORAGE_SCOPE);
      localStorage.removeItem(STORAGE_OBRA);
      return;
    }
    localStorage.setItem(STORAGE_SCOPE, nextScope);
    if (obraId) {
      localStorage.setItem(STORAGE_OBRA, obraId);
    } else {
      localStorage.removeItem(STORAGE_OBRA);
    }
  }, []);

  /**
   * Decide el ámbito a partir de las obras disponibles. Solo se pregunta
   * cuando hay verdaderamente más de una opción; con una sola (una obra, o
   * ninguna) se entra directo, sin pantalla intermedia.
   */
  const resolverScope = useCallback((lista: Obra[]): { scope: ObraScope; obraId: string | null } => {
    const existe = (id: string | null) => !!id && lista.some((o) => o.obraId === id);

    // 1. Ámbito ya elegido en esta sesión: se respeta mientras siga siendo válido.
    if (scopeRef.current === 'obra' && existe(obraIdRef.current)) {
      return { scope: 'obra', obraId: obraIdRef.current };
    }
    if (scopeRef.current === 'empresa') {
      return { scope: 'empresa', obraId: null };
    }

    // 2. Recarga de página con la sesión viva: se restaura lo último elegido.
    const scopeGuardado = localStorage.getItem(STORAGE_SCOPE) as ObraScope;
    const obraGuardada = localStorage.getItem(STORAGE_OBRA);
    if (scopeGuardado === 'obra' && existe(obraGuardada)) {
      return { scope: 'obra', obraId: obraGuardada };
    }
    if (scopeGuardado === 'empresa' && puedeGestionarEmpresa) {
      return { scope: 'empresa', obraId: null };
    }

    // 3. Sin nada que preguntar.
    if (lista.length === 0) return { scope: 'empresa', obraId: null };
    if (lista.length === 1 && !puedeGestionarEmpresa) {
      return { scope: 'obra', obraId: lista[0].obraId };
    }

    // 4. Varias obras (o obra + empresa): que elija la persona.
    return { scope: null, obraId: null };
  }, [puedeGestionarEmpresa]);

  const refreshObras = useCallback(async () => {
    if (!user) {
      setObras([]);
      // Solo al cerrar sesión se olvida el ámbito elegido. Mientras AuthContext
      // revalida el token todavía no hay usuario, y borrarlo ahí obligaría a
      // volver a elegir obra en cada recarga de página.
      if (!authLoading) aplicar(null, null);
      return;
    }

    setIsLoadingObras(true);
    try {
      const response = await obrasApi.list();
      if (response.success && response.data) {
        // response.data could be { total, obras: [...] } or [...] depending on backend.
        const obrasArray: Obra[] = Array.isArray(response.data) ? response.data : ((response.data as any).obras || []);
        setObras(obrasArray);
        const resuelto = resolverScope(obrasArray);
        aplicar(resuelto.scope, resuelto.obraId);
      }
    } catch (error) {
      console.error('Error fetching obras context:', error);
    } finally {
      setIsLoadingObras(false);
    }
  }, [user, authLoading, aplicar, resolverScope]);

  useEffect(() => {
    refreshObras();
  }, [refreshObras]);

  const elegirObra = useCallback((obraId: string) => aplicar('obra', obraId), [aplicar]);
  const elegirEmpresa = useCallback(() => aplicar('empresa', null), [aplicar]);
  const cambiarDeObra = useCallback(() => aplicar(null, null), [aplicar]);

  // Compatibilidad con las pantallas que fijan la obra activa al navegar
  // (por ejemplo el detalle de obra al agendar un ítem de onboarding).
  const setSelectedObraId = useCallback((id: string | null) => {
    if (id) aplicar('obra', id);
    else aplicar('empresa', null);
  }, [aplicar]);

  const selectedObra = selectedObraId ? obras.find((o) => o.obraId === selectedObraId) || null : null;
  const puedeCambiarDeObra = obras.length > 1 || (obras.length > 0 && puedeGestionarEmpresa);

  return (
    <ObraContext.Provider value={{
      obras,
      selectedObraId,
      selectedObra,
      setSelectedObraId,
      isLoadingObras,
      refreshObras,
      scope,
      scopeElegido: scope !== null,
      modoEmpresa: scope === 'empresa',
      puedeGestionarEmpresa,
      puedeCambiarDeObra,
      elegirObra,
      elegirEmpresa,
      cambiarDeObra,
    }}>
      {children}
    </ObraContext.Provider>
  );
};

export const useObraContext = () => {
  const context = useContext(ObraContext);
  if (context === undefined) {
    throw new Error('useObraContext must be used within an ObraProvider');
  }
  return context;
};

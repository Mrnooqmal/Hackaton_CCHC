import React, { createContext, useContext, useState, useEffect } from 'react';
import { obrasApi } from '../api/client';
import { useAuth } from './AuthContext';

export interface Obra {
  obraId: string;
  tenantId: string;
  nombre: string;
  codigo?: string;
  etapaActual: string;
  faseDeming?: string;
  estado: string;
  fasesConfig?: any;
  cumplimientoDS44?: any;
  [key: string]: any;
}

interface ObraContextType {
  obras: Obra[];
  selectedObraId: string | null;
  selectedObra: Obra | null;
  setSelectedObraId: (id: string | null) => void;
  isLoadingObras: boolean;
  refreshObras: () => Promise<void>;
}

const ObraContext = createContext<ObraContextType | undefined>(undefined);

export const ObraProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [obras, setObras] = useState<Obra[]>([]);
  const [selectedObraId, setSelectedObraIdState] = useState<string | null>(null);
  const [isLoadingObras, setIsLoadingObras] = useState(false);

  const refreshObras = async () => {
    if (!user) {
      setObras([]);
      return;
    }
    
    setIsLoadingObras(true);
    try {
      const response = await obrasApi.list();
      if (response.success && response.data) {
        // response.data could be { total, obras: [...] } or [...] depending on backend.
        const obrasArray = Array.isArray(response.data) ? response.data : ((response.data as any).obras || []);
        setObras(obrasArray);
        
        // Admin nunca auto-selecciona obra — siempre vista global de empresa
        const isAdminTenant = user?.rol === 'admin';

        if (!isAdminTenant) {
          // Solo auto-seleccionar para prevencionista/supervisor/trabajador
          const savedObraId = localStorage.getItem('selectedObraId');
          if (savedObraId && obrasArray.some((o: Obra) => o.obraId === savedObraId)) {
            setSelectedObraIdState(savedObraId);
          } else if (obrasArray.length === 1) {
            setSelectedObraIdState(obrasArray[0].obraId);
            localStorage.setItem('selectedObraId', obrasArray[0].obraId);
          } else if (obrasArray.length === 0) {
            setSelectedObraIdState(null);
            localStorage.removeItem('selectedObraId');
          }
        } else {
          // Admin nunca auto-selecciona obra
          setSelectedObraIdState(null);
          localStorage.removeItem('selectedObraId');
        }
      }
    } catch (error) {
      console.error('Error fetching obras context:', error);
    } finally {
      setIsLoadingObras(false);
    }
  };

  useEffect(() => {
    refreshObras();
  }, [user]);

  const setSelectedObraId = (id: string | null) => {
    setSelectedObraIdState(id);
    if (id) {
      localStorage.setItem('selectedObraId', id);
    } else {
      localStorage.removeItem('selectedObraId');
    }
  };

  const selectedObra = selectedObraId ? obras.find(o => o.obraId === selectedObraId) || null : null;

  return (
    <ObraContext.Provider value={{ obras, selectedObraId, selectedObra, setSelectedObraId, isLoadingObras, refreshObras }}>
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

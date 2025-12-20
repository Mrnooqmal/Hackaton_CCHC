import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para detectar el estado de conexión a internet
 */
export function useOnlineStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [wasOffline, setWasOffline] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            // Si estábamos offline, marcarlo para trigger de sync
            if (!isOnline) {
                setWasOffline(true);
            }
        };

        const handleOffline = () => {
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [isOnline]);

    const clearWasOffline = useCallback(() => {
        setWasOffline(false);
    }, []);

    return { isOnline, wasOffline, clearWasOffline };
}

/**
 * Hook para verificar conectividad real (no solo el estado del navegador)
 * Hace un ping al servidor para confirmar
 */
export function useRealConnectivity(apiUrl: string, checkInterval: number = 30000) {
    const [isConnected, setIsConnected] = useState(navigator.onLine);
    const [lastCheck, setLastCheck] = useState<Date | null>(null);
    const [checking, setChecking] = useState(false);

    const checkConnectivity = useCallback(async () => {
        if (checking) return isConnected;
        
        setChecking(true);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${apiUrl}/health`, {
                method: 'GET',
                signal: controller.signal,
            });
            
            clearTimeout(timeoutId);
            const connected = response.ok;
            setIsConnected(connected);
            setLastCheck(new Date());
            return connected;
        } catch {
            setIsConnected(false);
            setLastCheck(new Date());
            return false;
        } finally {
            setChecking(false);
        }
    }, [apiUrl, checking, isConnected]);

    useEffect(() => {
        // Check inicial
        checkConnectivity();

        // Check periódico
        const interval = setInterval(checkConnectivity, checkInterval);

        // También verificar cuando el navegador dice que hay conexión
        const handleOnline = () => {
            checkConnectivity();
        };

        const handleOffline = () => {
            setIsConnected(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            clearInterval(interval);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [checkConnectivity, checkInterval]);

    return { isConnected, lastCheck, checking, checkConnectivity };
}

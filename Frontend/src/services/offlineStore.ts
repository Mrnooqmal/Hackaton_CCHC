/**
 * Offline Store - IndexedDB wrapper para almacenar firmas offline
 * Permite recolectar firmas sin conexión y sincronizarlas después
 */

const DB_NAME = 'BuildServeOfflineDB';
const DB_VERSION = 1;
const STORES = {
    PENDING_REQUESTS: 'pendingRequests',
    CACHED_WORKERS: 'cachedWorkers',
    SYNC_LOG: 'syncLog',
};

export interface OfflineSignature {
    id: string;
    rut: string;
    pin: string; // Se guarda hasheado
    nombre?: string;
    timestampLocal: string;
    validated: boolean;
}

export interface OfflineRequest {
    id: string;
    tipo: string;
    titulo: string;
    descripcion: string;
    ubicacion: string;
    solicitanteId: string;
    solicitanteNombre: string;
    firmas: OfflineSignature[];
    fechaCreacion: string;
    syncStatus: 'pending' | 'syncing' | 'synced' | 'error';
    syncError?: string;
    syncedAt?: string;
    serverRequestId?: string;
}

export interface CachedWorker {
    oderId: string;
    rut: string;
    nombre: string;
    apellido?: string;
    pinHash: string;
    habilitado: boolean;
    cachedAt: string;
}

export interface SyncLogEntry {
    id: string;
    requestId: string;
    action: 'sync_start' | 'sync_success' | 'sync_error' | 'signature_error';
    message: string;
    timestamp: string;
    details?: Record<string, unknown>;
}

class OfflineStoreService {
    private db: IDBDatabase | null = null;
    private dbReady: Promise<IDBDatabase>;

    constructor() {
        this.dbReady = this.initDB();
    }

    private initDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error('Error opening IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Store para solicitudes pendientes
                if (!db.objectStoreNames.contains(STORES.PENDING_REQUESTS)) {
                    const requestStore = db.createObjectStore(STORES.PENDING_REQUESTS, { keyPath: 'id' });
                    requestStore.createIndex('syncStatus', 'syncStatus', { unique: false });
                    requestStore.createIndex('fechaCreacion', 'fechaCreacion', { unique: false });
                }

                // Store para trabajadores cacheados (para validación offline)
                if (!db.objectStoreNames.contains(STORES.CACHED_WORKERS)) {
                    const workerStore = db.createObjectStore(STORES.CACHED_WORKERS, { keyPath: 'rut' });
                    workerStore.createIndex('workerId', 'workerId', { unique: true });
                }

                // Store para log de sincronización
                if (!db.objectStoreNames.contains(STORES.SYNC_LOG)) {
                    const logStore = db.createObjectStore(STORES.SYNC_LOG, { keyPath: 'id' });
                    logStore.createIndex('requestId', 'requestId', { unique: false });
                    logStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
            };
        });
    }

    private async getDB(): Promise<IDBDatabase> {
        if (this.db) return this.db;
        return this.dbReady;
    }

    // ==================== PENDING REQUESTS ====================

    async createOfflineRequest(request: Omit<OfflineRequest, 'id' | 'syncStatus' | 'fechaCreacion'>): Promise<OfflineRequest> {
        const db = await this.getDB();
        const newRequest: OfflineRequest = {
            ...request,
            id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            fechaCreacion: new Date().toISOString(),
            syncStatus: 'pending',
            firmas: [],
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.PENDING_REQUESTS, 'readwrite');
            const store = transaction.objectStore(STORES.PENDING_REQUESTS);
            const addRequest = store.add(newRequest);

            addRequest.onsuccess = () => resolve(newRequest);
            addRequest.onerror = () => reject(addRequest.error);
        });
    }

    async getOfflineRequest(id: string): Promise<OfflineRequest | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.PENDING_REQUESTS, 'readonly');
            const store = transaction.objectStore(STORES.PENDING_REQUESTS);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllOfflineRequests(): Promise<OfflineRequest[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.PENDING_REQUESTS, 'readonly');
            const store = transaction.objectStore(STORES.PENDING_REQUESTS);
            const request = store.getAll();

            request.onsuccess = () => {
                const results = request.result || [];
                // Ordenar por fecha descendente
                results.sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime());
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getPendingRequests(): Promise<OfflineRequest[]> {
        const all = await this.getAllOfflineRequests();
        return all.filter(r => r.syncStatus === 'pending' || r.syncStatus === 'error');
    }

    async updateOfflineRequest(request: OfflineRequest): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.PENDING_REQUESTS, 'readwrite');
            const store = transaction.objectStore(STORES.PENDING_REQUESTS);
            const putRequest = store.put(request);

            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
        });
    }

    async deleteOfflineRequest(id: string): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.PENDING_REQUESTS, 'readwrite');
            const store = transaction.objectStore(STORES.PENDING_REQUESTS);
            const deleteRequest = store.delete(id);

            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
        });
    }

    async addSignatureToRequest(requestId: string, signature: Omit<OfflineSignature, 'id' | 'timestampLocal'>): Promise<OfflineSignature> {
        const request = await this.getOfflineRequest(requestId);
        if (!request) throw new Error('Solicitud no encontrada');

        const newSignature: OfflineSignature = {
            ...signature,
            id: `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestampLocal: new Date().toISOString(),
        };

        request.firmas.push(newSignature);
        await this.updateOfflineRequest(request);
        return newSignature;
    }

    async removeSignatureFromRequest(requestId: string, signatureId: string): Promise<void> {
        const request = await this.getOfflineRequest(requestId);
        if (!request) throw new Error('Solicitud no encontrada');

        request.firmas = request.firmas.filter(s => s.id !== signatureId);
        await this.updateOfflineRequest(request);
    }

    // ==================== CACHED WORKERS ====================

    async cacheWorkers(workers: CachedWorker[]): Promise<void> {
        const db = await this.getDB();
        const transaction = db.transaction(STORES.CACHED_WORKERS, 'readwrite');
        const store = transaction.objectStore(STORES.CACHED_WORKERS);

        for (const worker of workers) {
            store.put({
                ...worker,
                cachedAt: new Date().toISOString(),
            });
        }

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getCachedWorker(rut: string): Promise<CachedWorker | null> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.CACHED_WORKERS, 'readonly');
            const store = transaction.objectStore(STORES.CACHED_WORKERS);
            const request = store.get(rut);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllCachedWorkers(): Promise<CachedWorker[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.CACHED_WORKERS, 'readonly');
            const store = transaction.objectStore(STORES.CACHED_WORKERS);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async clearCachedWorkers(): Promise<void> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.CACHED_WORKERS, 'readwrite');
            const store = transaction.objectStore(STORES.CACHED_WORKERS);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== SYNC LOG ====================

    async addSyncLog(entry: Omit<SyncLogEntry, 'id' | 'timestamp'>): Promise<void> {
        const db = await this.getDB();
        const newEntry: SyncLogEntry = {
            ...entry,
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.SYNC_LOG, 'readwrite');
            const store = transaction.objectStore(STORES.SYNC_LOG);
            const request = store.add(newEntry);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getSyncLogs(requestId?: string): Promise<SyncLogEntry[]> {
        const db = await this.getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORES.SYNC_LOG, 'readonly');
            const store = transaction.objectStore(STORES.SYNC_LOG);
            
            let request: IDBRequest;
            if (requestId) {
                const index = store.index('requestId');
                request = index.getAll(requestId);
            } else {
                request = store.getAll();
            }

            request.onsuccess = () => {
                const results: SyncLogEntry[] = request.result || [];
                results.sort((a: SyncLogEntry, b: SyncLogEntry) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== UTILITIES ====================

    async getPendingCount(): Promise<number> {
        const pending = await this.getPendingRequests();
        return pending.length;
    }

    async getTotalPendingSignatures(): Promise<number> {
        const pending = await this.getPendingRequests();
        return pending.reduce((acc, req) => acc + req.firmas.length, 0);
    }

    // Limpiar solicitudes sincronizadas (mayores a 7 días)
    async cleanupSyncedRequests(daysOld: number = 7): Promise<number> {
        const all = await this.getAllOfflineRequests();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        let deleted = 0;
        for (const req of all) {
            if (req.syncStatus === 'synced' && req.syncedAt) {
                if (new Date(req.syncedAt) < cutoff) {
                    await this.deleteOfflineRequest(req.id);
                    deleted++;
                }
            }
        }
        return deleted;
    }
}

// Singleton
export const offlineStore = new OfflineStoreService();

// src/sync/ClientsSyncContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncClientsNow } from './clientSync';
import type { Client } from '../../types';


type Ctx = {
  syncing: boolean;
  error: string | null;
  clients: Client[];
  forceSync: () => Promise<void>;
};

const ClientsSyncContext = createContext<Ctx>({
  syncing: false,
  error: null,
  clients: [],
  forceSync: async () => {},
});

export const ClientsSyncProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null); // ← type timer RN safe

  const loadLocal = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('clients');
      const arr = raw ? JSON.parse(raw) : [];
      setClients(Array.isArray(arr) ? arr : []);
    } catch {
      setClients([]);
    }
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const res = await syncClientsNow(); // push + pull
      if (!res.ok) setError(res.error || 'SYNC_ERROR');
    } catch (e: any) {
      setError(e?.message || 'SYNC_ERROR');
    } finally {
      await loadLocal(); // maj locale quoi qu’il arrive
      setSyncing(false);
    }
  }, [syncing, loadLocal]);

  // 1) au démarrage
  useEffect(() => {
    loadLocal();
    // pas d’attente bloquante
    runSync();
  }, [loadLocal, runSync]);

  // 2) quand l’app revient au premier plan
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runSync();
    });
    return () => sub.remove();
  }, [runSync]);

  // 3) toutes les X minutes (10 min)
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(runSync, 10 * 60 * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [runSync]);

  const value: Ctx = {
    syncing,
    error,
    clients,
    forceSync: runSync,
  };

  return (
    <ClientsSyncContext.Provider value={value}>
      {children}
    </ClientsSyncContext.Provider>
  );
};

export const useClientsStore = () => useContext(ClientsSyncContext);

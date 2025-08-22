// src/sync/ClientsSyncContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

  const runningRef = useRef(false);
  const lastRunRef = useRef(0);
  const MIN_GAP_MS = 15_000;

  const loadLocal = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('clients');
      setClients(raw ? JSON.parse(raw) : []);
    } catch {
      setClients([]);
    }
  }, []);

  const runSync = useCallback(async () => {
    const now = Date.now();
    if (runningRef.current) return;
    if (now - lastRunRef.current < MIN_GAP_MS) return;

    runningRef.current = true;
    setSyncing(true);
    setError(null);

    const res = await syncClientsNow();
    if (!res.ok) setError(res.error || 'SYNC_ERROR');

    await loadLocal();

    setSyncing(false);
    runningRef.current = false;
    lastRunRef.current = Date.now();
  }, [loadLocal]);

  // au démarrage
  useEffect(() => { loadLocal(); runSync(); }, [loadLocal, runSync]);

  // retour au 1er plan
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') runSync(); });
    return () => sub.remove();
  }, [runSync]);

  // sync périodique
  useEffect(() => {
    const t = setInterval(runSync, 10 * 60 * 1000); // toutes les 10 min
    return () => clearInterval(t);
  }, [runSync]);

  return (
    <ClientsSyncContext.Provider value={{ syncing, error, clients, forceSync: runSync }}>
      {children}
    </ClientsSyncContext.Provider>
  );
};

export const useClientsStore = () => useContext(ClientsSyncContext);

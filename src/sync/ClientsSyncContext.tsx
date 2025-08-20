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
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const loadLocal = useCallback(async () => {
    const raw = await AsyncStorage.getItem('clients');
    setClients(raw ? JSON.parse(raw) : []);
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    const res = await syncClientsNow();
    if (!res.ok) setError(res.error || 'SYNC_ERROR');
    // maj locale (que le serveur ait répondu ou non)
    await loadLocal();
    setSyncing(false);
  }, [syncing, loadLocal]);

  // 1) au démarrage
  useEffect(() => {
    loadLocal();
    runSync();
  }, [loadLocal, runSync]);

  // 2) quand l’app revient au premier plan
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') runSync();
    });
    return () => sub.remove();
  }, [runSync]);

  // 3) toutes les X minutes
  useEffect(() => {
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(runSync, 10 * 60 * 1000); // 10 minutes
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
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

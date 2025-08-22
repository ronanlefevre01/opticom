// src/sync/clientSync.ts
// ClientSync.ts — ré-export de getClients + fonction de synchronisation
import AsyncStorage from '@react-native-async-storage/async-storage';

// ← utilise la même base que partout
const SERVER_BASE =
  process.env.EXPO_PUBLIC_SERVER_BASE ||
  'https://opticom-sms-server.onrender.com';

export type Client = {
  id: string;
  prenom?: string;
  nom?: string;
  phone?: string;
  email?: string;
  naissance?: string | null;
  lensStartDate?: string | null;
  lensEndDate?: string | null;
  lensDuration?: any;
  note?: string;
  updatedAt: string;
  deletedAt?: string | null;
};

// ---- Ré-export des fonctions de lecture (cache + dédoublonnage)
export {
  // permet: import { getClients } from './src/sync/clientSync'
  getClients,
  fetchClientsOnce,
  invalidateClientsCache,
} from '../services/clients';

// ---- Helpers locaux (pour la sync)
async function loadLocalClients(): Promise<Client[]> {
  try {
    const raw = await AsyncStorage.getItem('clients');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Synchronise les clients locaux avec le serveur :
 *  - push des clients locaux (si présents)
 *  - pull des clients du serveur puis mise à jour d'AsyncStorage
 *
 * @returns { ok, pushed, pulled }
 */
export async function syncClientsNow(licenceId?: string) {
  // récupère l’ID licence si non fourni
  if (!licenceId) {
    try {
      const licRaw = await AsyncStorage.getItem('licence');
      const lic = licRaw ? JSON.parse(licRaw) : null;
      licenceId = lic?.id || lic?.licence || lic?.licenceId || '';
    } catch {}
  }
  if (!licenceId) return { ok: false, error: 'NO_LICENCE_ID' };

  const locals = await loadLocalClients();

  // PUSH → serveur (toléré en cas d’échec)
  try {
    await fetch(`${SERVER_BASE}/api/clients/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenceId, clients: locals }),
    });
  } catch {
    // on tolère l’échec du push pour ne pas bloquer l’app
  }

  // PULL ← serveur
  try {
    const r = await fetch(
      `${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(licenceId)}`
    );
    if (r.ok) {
      const j = await r.json().catch(() => ({} as any));
      const items: Client[] = Array.isArray(j?.items) ? j.items : [];
      await AsyncStorage.setItem('clients', JSON.stringify(items));
      // on peut invalider le cache mémoire du service si tu l’utilises
      try {
        const { invalidateClientsCache } = await import('../services/clients');
        invalidateClientsCache(licenceId!);
      } catch {}
      return { ok: true, pushed: locals.length, pulled: items.length };
    }
  } catch {}

  return { ok: true, pushed: locals.length, pulled: 0 };
}

// Export par défaut pratique
export default {
  syncClientsNow,
  // ces membres existent grâce au ré-export ci-dessus
  // (TypeScript les résout correctement)
};

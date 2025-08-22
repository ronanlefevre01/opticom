// src/sync/clientSync.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

export type Client = {
  id: string;
  prenom?: string; nom?: string; phone?: string; email?: string;
  naissance?: string | null;
  lensStartDate?: string | null; lensEndDate?: string | null;
  lensDuration?: any;
  note?: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

// ---- cache local
async function loadLocalClients(): Promise<Client[]> {
  try {
    const raw = await AsyncStorage.getItem('clients');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
async function saveLocalClients(items: Client[]) {
  try { await AsyncStorage.setItem('clients', JSON.stringify(items)); } catch {}
}

// ---- dédoublonnage + anti-rafale
let inflight: Promise<{ ok: boolean; pushed?: number; pulled?: number; skipped?: boolean; error?: string }> | null = null;
let lastSyncAt = 0;
const MIN_SYNC_INTERVAL_MS = 15_000; // 15s
let lastPushedHash: string | null = null;

function hashJSON(obj: unknown) {
  try { return JSON.stringify(obj); } catch { return ''; }
}

// ✨ Fonction attendue par le reste de l’app
export async function syncClientsNow(licenceId?: string) {
  // dédoublonnage strict
  if (inflight) return inflight;

  // récupère l’ID licence si non fourni
  if (!licenceId) {
    try {
      const licRaw = await AsyncStorage.getItem('licence');
      const lic = licRaw ? JSON.parse(licRaw) : null;
      licenceId = lic?.id || lic?.licenceId || lic?.licence || '';
    } catch {}
  }
  if (!licenceId) return { ok: false, error: 'NO_LICENCE_ID' };

  const now = Date.now();
  if (now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true };
  }

  inflight = (async () => {
    const locals = await loadLocalClients();

    // P U S H : uniquement si ça a changé depuis la dernière fois
    const h = hashJSON(locals);
    if (h !== lastPushedHash && locals.length) {
      try {
        await fetch(`${SERVER_BASE}/api/clients/upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ licenceId, clients: locals }),
        });
        lastPushedHash = h;
      } catch {
        // on ne bloque pas la suite si le push rate-limite
      }
    }

    // P U L L : toujours tenter (pour récupérer les derniers merges)
    let pulled = 0;
    try {
      const r = await fetch(`${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(licenceId)}&_=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const items: Client[] = Array.isArray(j?.items) ? j.items : [];
        await saveLocalClients(items);
        pulled = items.length;
      }
    } catch {
      // silencieux
    }

    return { ok: true, pushed: locals.length, pulled };
  })();

  try {
    const res = await inflight;
    return res;
  } finally {
    lastSyncAt = Date.now();
    inflight = null;
  }
}

export default { syncClientsNow };

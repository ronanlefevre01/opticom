// ClientSync.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

export type Client = {
  id: string;
  prenom?: string; nom?: string; phone?: string; email?: string;
  naissance?: string | null;
  lensStartDate?: string | null; lensEndDate?: string | null;
  lensDuration?: any;
  note?: string;
  updatedAt: string;
  deletedAt?: string | null;
};

async function loadLocalClients(): Promise<Client[]> {
  try {
    const raw = await AsyncStorage.getItem('clients');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ✨ Fonction attendue par le reste de l’app
export async function syncClientsNow(licenceId?: string) {
  // récupère l’ID licence si non fourni
  if (!licenceId) {
    try {
      const licRaw = await AsyncStorage.getItem('licence');
      const lic = licRaw ? JSON.parse(licRaw) : null;
      licenceId = lic?.id || lic?.licenceId || '';
    } catch {}
  }
  if (!licenceId) return { ok: false, error: 'NO_LICENCE_ID' };

  const locals = await loadLocalClients();

  // push → serveur
  try {
    await fetch(`${SERVER_BASE}/api/clients/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenceId, clients: locals }),
    });
  } catch {
    // on tolère l’échec du push pour ne pas bloquer l’app
  }

  // pull ← serveur
  try {
    const r = await fetch(`${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(licenceId)}`);
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      const items = Array.isArray(j?.items) ? j.items : [];
      await AsyncStorage.setItem('clients', JSON.stringify(items));
      return { ok: true, pushed: locals.length, pulled: items.length };
    }
  } catch {}

  return { ok: true, pushed: locals.length, pulled: 0 };
}

// Compat avec différents styles d’import
export default { syncClientsNow };

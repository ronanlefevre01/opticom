import { fetchClientsOnce, invalidateClientsCache, ClientRow } from '../services/clients';

const SERVER_BASE =
  process.env.EXPO_PUBLIC_SERVER_BASE ||
  'https://opticom-sms-server.onrender.com';

// Sérialise les upserts pour une licence donnée (évite les rafales POST)
const upsertChain = new Map<string, Promise<void>>();

/** Pousse des clients vers le serveur sans enchaîner des POST en rafale */
export function upsertClients(
  licenceId: string,
  clients: any[]
): Promise<void> {
  if (!licenceId || !Array.isArray(clients) || clients.length === 0) {
    return Promise.resolve();
  }

  const job = async () => {
    await fetch(`${SERVER_BASE}/api/clients/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenceId, clients }),
    }).then(async (r) => {
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`upsert ${r.status}: ${t}`);
      }
      // invalide le cache local pour forcer un refresh propre (une seule requête)
      invalidateClientsCache(licenceId);
    });
  };

  const prev = upsertChain.get(licenceId) || Promise.resolve();
  const next = prev.then(job).catch(() => {}).then(() => {});
  upsertChain.set(licenceId, next);
  return next;
}

/** Lecture de la liste (utiliser PARTOUT cette fonction) */
export async function getClients(licenceId: string, force = false): Promise<ClientRow[]> {
  return fetchClientsOnce(licenceId, { force });
}

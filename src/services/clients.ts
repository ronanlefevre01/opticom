// Service unique pour lire la liste des clients sans spammer le serveur.
const SERVER_BASE =
  process.env.EXPO_PUBLIC_SERVER_BASE ||
  'https://opticom-sms-server.onrender.com';

export type ClientRow = {
  id: string;
  prenom?: string;
  nom?: string;
  phone?: string;
  telephone?: string;
  email?: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

type CacheEntry = { items: ClientRow[]; expires: number };

const CACHE_TTL = 15_000; // 15 s
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ClientRow[]>>();

/**
 * Lit les clients d'une licence avec:
 *  - cache mémoire (TTL 15s)
 *  - dédoublonnage des GET concurrents
 */
export async function fetchClientsOnce(
  licenceId: string,
  { force = false }: { force?: boolean } = {}
): Promise<ClientRow[]> {
  if (!licenceId) return [];

  const key = String(licenceId);
  const now = Date.now();

  // Cache hit
  if (!force) {
    const c = cache.get(key);
    if (c && c.expires > now) return c.items;
    const p = inflight.get(key);
    if (p) return p;
  }

  // Requête unique partagée
  const p = (async () => {
    const url = `${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error(`GET /api/clients failed: ${r.status}`);
    const j = await r.json().catch(() => ({} as any));
    const items: ClientRow[] = Array.isArray(j?.items) ? j.items : [];
    cache.set(key, { items, expires: Date.now() + CACHE_TTL });
    inflight.delete(key);
    return items;
  })().catch((e) => {
    inflight.delete(key);
    throw e;
  });

  inflight.set(key, p);
  return p;
}

/** Alias rétro-compat: certaines pages appellent getClients(...) */
export function getClients(
  licenceId: string,
  opts: { force?: boolean } = {}
) {
  return fetchClientsOnce(licenceId, opts);
}

/** Permet d'invalider manuellement le cache (ex. après un upsert). */
export function invalidateClientsCache(licenceId: string) {
  cache.delete(String(licenceId));
}

/** Export par défaut sous forme d'objet pour supporter y.getClients(...) */
const service = { fetchClientsOnce, getClients, invalidateClientsCache };
export default service;

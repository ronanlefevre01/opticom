// src/lib/licenceGuard.ts
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE from '../config/api';
import { resetTo } from '../navigationRef';

const LICENCE_CHECK_ROUTE = 'LicenceCheckPage'; // ← adapte si ton nom de route diffère
const CHECK_INTERVAL_MS = 60_000;

let installed = false;
let timer: any;
let appStateSub: any;

async function fetchLicenceExists(licenceId: string): Promise<boolean> {
  const urls = [
    `${API_BASE}/api/licence?id=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/licence?id=${encodeURIComponent(licenceId)}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status === 404 || r.status === 410) return false;

      const txt = await r.text();
      const j = JSON.parse(txt || '{}');
      const lic = j?.licence ?? j;
      if (!lic || lic.deletedAt || lic.revokedAt || lic.active === false) return false;

      return true;
    } catch {
      // erreur réseau → on ne déconnecte pas
    }
  }
  return true;
}

export function startLicenceGuard() {
  if (installed) return () => {};
  installed = true;

  const tick = async () => {
    try {
      const licId =
        (await AsyncStorage.getItem('licenceId')) ||
        (async () => {
          try {
            const raw = await AsyncStorage.getItem('licence');
            return raw ? JSON.parse(raw)?.id || null : null;
          } catch { return null; }
        })();

      const resolved = typeof licId === 'string' ? licId : await licId;
      if (!resolved) return;

      const exists = await fetchLicenceExists(String(resolved));
      if (!exists) {
        await AsyncStorage.multiRemove(['licence', 'licenceId', 'clients', 'messages']);
        resetTo(LICENCE_CHECK_ROUTE);
      }
    } catch {}
  };

  // 1ère vérif + périodique + retour premier plan
  tick();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  appStateSub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });

  return () => {
    if (timer) clearInterval(timer);
    appStateSub?.remove?.();
    installed = false;
  };
}

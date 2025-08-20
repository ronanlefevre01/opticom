// src/sync/clientSync.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE from '../config/api';
import type { Client } from '../../types';

const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};

const extractServerItems = (payload: any): any[] => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (payload.clients && Array.isArray(payload.clients)) return payload.clients;
  return [];
};

const serverToLocalClient = (s: any): Client => {
  const phone = sanitizePhone(s.phone || s.telephone || '');
  const lentilles: string[] = [];
  const dur = String(s.lensDuration || '').toLowerCase();
  if (dur === '30j') lentilles.push('30j');
  if (dur === '60j') lentilles.push('60j');
  if (dur === '90j') lentilles.push('90j');
  if (dur === '6mois') lentilles.push('6mois');
  if (dur === '1an') lentilles.push('1an');

  return {
    id: s.id || `srv-${phone}`,
    prenom: s.prenom || '',
    nom: s.nom || '',
    telephone: phone,
    email: s.email || '',
    dateNaissance: s.naissance || '',
    lunettes: !!s.lunettes,
    lentilles,
    consentementMarketing: !!s.consentementMarketing,
    consent: s.consent || {
      service_sms: { value: true },
      marketing_sms: { value: !!s.consentementMarketing },
    },
    messagesEnvoyes: Array.isArray(s.messagesEnvoyes) ? s.messagesEnvoyes : [],
    createdAt: s.createdAt || new Date().toISOString(),
  } as Client;
};

export const mergeLocalWithServer = (local: Client[], server: Client[]) => {
  const byPhone = new Map(server.map(c => [sanitizePhone(c.telephone), c] as const));
  const merged: Client[] = [];

  for (const s of server) {
    const key = sanitizePhone(s.telephone);
    const l = local.find(x => sanitizePhone(x.telephone) === key);
    if (l && Array.isArray(l.messagesEnvoyes) && l.messagesEnvoyes.length) {
      const seen = new Set(l.messagesEnvoyes.map(m => `${m.type}|${m.date}`));
      const out = Array.isArray(s.messagesEnvoyes) ? [...s.messagesEnvoyes] : [];
      for (const m of l.messagesEnvoyes) if (!seen.has(`${m.type}|${m.date}`)) out.push(m);
      merged.push({ ...s, messagesEnvoyes: out });
    } else {
      merged.push(s);
    }
  }

  for (const l of local) {
    const key = sanitizePhone(l.telephone);
    if (!byPhone.has(key)) merged.push(l);
  }
  return merged;
};

const getLicenceFromStorage = async () => {
  try {
    const raw = await AsyncStorage.getItem('licence');
    if (!raw) return { licenceId: null, cle: null };
    const lic = JSON.parse(raw);
    const licenceId = String(lic?.id || lic?.opticien?.id || '').trim() || null;
    const cle = String(lic?.licence || '').trim() || null;
    return { licenceId, cle };
  } catch {
    return { licenceId: null, cle: null };
  }
};

export const resolveLicenceId = async (): Promise<string | null> => {
  const { licenceId, cle } = await getLicenceFromStorage();
  if (licenceId) return licenceId;
  if (!cle) return null;
  const candidates = [
    `${API_BASE}/api/licence/by-key?key=${encodeURIComponent(cle)}`,
    `${API_BASE}/licence/by-key?key=${encodeURIComponent(cle)}`,
    `${API_BASE}/licence?key=${encodeURIComponent(cle)}`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      const t = await r.text();
      if (!r.ok) continue;
      const j = JSON.parse(t);
      const id = j?.licence?.id || j?.id;
      if (id) return String(id);
    } catch {}
  }
  return null;
};

const fetchClientsFromServer = async (licenceId: string): Promise<Client[] | null> => {
  const urls = [
    `${API_BASE}/api/clients?licenceId=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/clients?licenceId=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/licence/clients?licenceId=${encodeURIComponent(licenceId)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) continue;
      const data = JSON.parse(text);
      const items = extractServerItems(data);
      if (Array.isArray(items)) return items.map(serverToLocalClient);
    } catch {}
  }
  return null;
};

/** Exécute la synchro maintenant et retourne la liste fusionnée. */
export async function syncClientsNow(): Promise<{ ok: boolean; clients?: Client[]; error?: string }> {
  try {
    const licenceId = await resolveLicenceId();
    if (!licenceId) return { ok: false, error: 'LICENCE_NOT_FOUND' };

    const remote = await fetchClientsFromServer(licenceId);
    if (!remote) return { ok: false, error: 'SERVER_UNAVAILABLE' };

    const localStr = await AsyncStorage.getItem('clients');
    const local: Client[] = localStr ? JSON.parse(localStr) : [];
    const merged = mergeLocalWithServer(local, remote);

    await AsyncStorage.setItem('clients', JSON.stringify(merged));
    return { ok: true, clients: merged };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'UNKNOWN' };
  }
}

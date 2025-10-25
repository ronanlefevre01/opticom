// ClientListPage.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ActivityIndicator, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, NavigationProp } from '@react-navigation/native';

import type { Client, SMSCategory } from './types';
import API_BASE from './src/config/api';
import { fetchClientsOnce, type ClientRow } from './src/services/clients';

type RootStackParamList = {
  Home: undefined;
  ClientDetails: { client: Client };
};

const SEND_SMS_ENDPOINT = `${API_BASE}/send-sms`;

/* ------------ helpers ------------- */
const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};
const isPhone10 = (p: string) => /^\d{10}$/.test(p);
const toE164FR = (raw: string) => {
  const p = sanitizePhone(raw);
  if (/^0\d{9}$/.test(p)) return '+33' + p.slice(1);
  if (p.startsWith('+33')) return p;
  if (/^33\d{9}$/.test(p)) return '+' + p;
  return p;
};
const confirmAsync = (title: string, message: string, okText = 'Supprimer') =>
  new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') {
      // @ts-ignore web-only
      resolve(window.confirm(`${title}\n\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, style: 'destructive', onPress: () => resolve(true) },
      ]);
    }
  });

const getSignatureFromSettings = async (): Promise<string> => {
  try {
    const licStr = await AsyncStorage.getItem('licence');
    if (licStr) {
      const lic = JSON.parse(licStr);
      if (typeof lic?.signature === 'string' && lic.signature.trim()) {
        return lic.signature.trim();
      }
    }
    const localSig = await AsyncStorage.getItem('signature');
    return (localSig || '').trim();
  } catch { return ''; }
};

const appendSignature = (msg: string, sig: string) => {
  const m = (msg || '').trim();
  const s = (sig || '').trim();
  if (!s) return m;
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(m).endsWith(norm(s)) || norm(m).endsWith((' - ' + s).toLowerCase())) return m;
  const needsSpace = /[.!?]$/.test(m);
  const sep = needsSpace ? ' ' : ' - ';
  return `${m}${sep}${s}`;
};

/** LicenceId stable (avec cache local) */
const getStableLicenceId = async (): Promise<string | null> => {
  try {
    const cached = await AsyncStorage.getItem('licenceId');
    if (cached) return cached;

    const licStr = await AsyncStorage.getItem('licence');
    if (!licStr) return null;
    const lic = JSON.parse(licStr);

    if (lic?.id) {
      await AsyncStorage.setItem('licenceId', String(lic.id));
      return String(lic.id);
    }
    if (lic?.licence) {
      const urls = [
        `${API_BASE}/api/licence/by-key?key=${encodeURIComponent(lic.licence)}`,
        `${API_BASE}/licence/by-key?key=${encodeURIComponent(lic.licence)}`,
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!r.ok) continue;
          const j = await r.json().catch(() => ({} as any));
          const id = j?.licence?.id || j?.id;
          if (id) {
            await AsyncStorage.setItem('licenceId', String(id));
            return String(id);
          }
        } catch {}
      }
    }
  } catch {}
  return null;
};

/** ---- Historique SMS depuis la licence ---- */
type ServerSmsItem = {
  date: string;
  type: string;   // 'marketing' | 'transactional' | 'auto-anniv' | 'auto-renew' | ...
  numero: string;
  campaignName?: string; campaign?: string; title?: string; nom?: string; name?: string; template?: string;
};

const labelFromType = (t: string) => {
  if (t === 'marketing') return 'Marketing';
  if (t === 'transactional') return 'Transactionnel';
  if (t === 'auto-anniv') return 'Anniv auto';
  if (t === 'auto-renew') return 'Renouvellement auto';
  return 'SMS';
};

/** essaie d’inférer une catégorie lisible pour l’historique */
const coerceHistoryLabel = (rawType: string, label: string) => {
  const knownCats = ['Lunettes','Lentilles','SAV','Commande'] as const;
  if (knownCats.includes(label as any)) return label;
  if (rawType === 'marketing') return 'Marketing';
  if (rawType === 'transactional') return 'Transactionnel';
  if (rawType === 'auto-anniv') return 'Anniv auto';
  if (rawType === 'auto-renew') return 'Renouvellement auto';
  return label || 'SMS';
};

/** ✅ fonction BIEN définie et utilisée */
const fetchSmsHistoryFromLicence = async (
  licenceId: string,
  cle?: string | null
): Promise<ServerSmsItem[]> => {
  const urls: string[] = [
    `${API_BASE}/api/licence?id=${encodeURIComponent(licenceId)}`,
  ];
  if (cle) {
    urls.push(
      `${API_BASE}/api/licence?cle=${encodeURIComponent(cle)}`,
      `${API_BASE}/licence?cle=${encodeURIComponent(cle)}`
    );
  }

  for (const url of urls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;

      const data = await r.json();
      const lic = data?.licence ?? data;
      const items: any[] = Array.isArray(lic?.historiqueSms) ? lic.historiqueSms : [];
      return items as ServerSmsItem[];
    } catch {}
  }
  return [];
};

/* ---- mapping service row -> Client local ---- */
const rowToClient = (s: ClientRow): Client => {
  const tel = sanitizePhone((s as any).telephone || (s as any).phone || (s as any).numero || '');
  const birth = (s as any).dateNaissance || (s as any).naissance || (s as any).birthday || '';

  const srvMarketing =
    !!(s as any)?.consent?.marketing_sms?.value || !!(s as any)?.consentementMarketing;
  const srvService =
    (s as any)?.consent?.service_sms?.value ?? (s as any)?.consentementService ?? true;

  return {
    id: String((s as any).id || (s as any)._id || `loc-${tel}`),
    prenom: (s as any).prenom || '',
    nom: (s as any).nom || '',
    telephone: tel,
    email: (s as any).email || '',
    dateNaissance: birth,
    lunettes: !!(s as any).lunettes,
    lentilles: Array.isArray((s as any).lentilles) ? (s as any).lentilles : [],
    consentementMarketing: srvMarketing,
    consent: {
      service_sms:   { value: !!srvService },
      marketing_sms: { value: !!srvMarketing },
    },
    messagesEnvoyes: Array.isArray((s as any).messagesEnvoyes) ? (s as any).messagesEnvoyes : [],
    createdAt: (s as any).createdAt || (s as any).updatedAt || new Date().toISOString(),
    updatedAt: (s as any).updatedAt || new Date().toISOString(),
  };
};

/* ---- tombstones & resets locaux ---- */
const KEY_CLIENT_TOMBSTONES = 'clients.tombstones';
const KEY_SMS_HISTORY_RESETS = 'smsHistory.resets';
type ResetMap = Record<string, string>;

async function loadTombstones(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CLIENT_TOMBSTONES);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
async function saveTombstones(list: string[]) {
  try { await AsyncStorage.setItem(KEY_CLIENT_TOMBSTONES, JSON.stringify(Array.from(new Set(list)))); } catch {}
}
async function addTombstone(phoneKey: string) {
  const list = await loadTombstones();
  if (!list.includes(phoneKey)) { list.push(phoneKey); await saveTombstones(list); }
}
async function loadHistoryResets(): Promise<ResetMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SMS_HISTORY_RESETS);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
async function saveHistoryResets(map: ResetMap) {
  try { await AsyncStorage.setItem(KEY_SMS_HISTORY_RESETS, JSON.stringify(map)); } catch {}
}

/* ---- templates / filtres ---- */
const FILTER_TYPES: (SMSCategory | 'Tous')[] = ['Tous', 'Lunettes', 'Lentilles', 'SAV', 'Commande'];
const DEFAULT_TEMPLATES: Record<SMSCategory, string> = {
  Lunettes:  'Bonjour {prenom} {nom}, vos lunettes sont prêtes. A bientôt !',
  SAV:       'Bonjour {prenom} {nom}, votre SAV est terminé, vous pouvez venir le récupérer.',
  Lentilles: 'Bonjour {prenom} {nom}, vos lentilles sont disponibles en magasin.',
  Commande:  'Bonjour {prenom} {nom}, votre commande est arrivée !',
};

/* ======= Tri ======= */
type SortMode =
  | 'NAME_ASC'
  | 'NAME_DESC'
  | 'LAST_SMS_DESC'
  | 'LAST_SMS_ASC'
  | 'CREATED_DESC'
  | 'CREATED_ASC';

function getLastSmsDate(c: Client): number {
  const arr = Array.isArray(c.messagesEnvoyes) ? c.messagesEnvoyes : [];
  if (!arr.length) return 0;
  const ts = Math.max(...arr.map(m => new Date(m.date).getTime() || 0));
  return isFinite(ts) ? ts : 0;
}
function safeName(c: Client): string {
  return `${(c.nom||'').toLowerCase()} ${(c.prenom||'').toLowerCase()}`.trim();
}
function safeDate(s?: string): number {
  const t = s ? new Date(s).getTime() : 0;
  return isFinite(t) ? t : 0;
}

/* ======= Helpers sélection par ID ======= */
const getId = (c: Client, i?: number) =>
  String(c.id || `loc-${sanitizePhone(c.telephone)}-${i ?? 0}`);

export default function ClientListPage() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[]>([]); // IDs
  const [smsFilter, setSmsFilter] = useState<SMSCategory | 'Tous'>('Tous');
  const [sortMode, setSortMode] = useState<SortMode>('NAME_ASC');
  const [customMessages, setCustomMessages] = useState<Record<string, string | { title?: string; content: string }>>({});

  // Progress
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<'prep'|'send'|'done'|'error'>('prep');
  const [sendError, setSendError] = useState<string | null>(null);
  const [progressCount, setProgressCount] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [batchSummary, setBatchSummary] = useState<{sent:number; skipped:number; failed:number} | null>(null);

  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [customText, setCustomText] = useState('');
  const [typeModalVisible, setTypeModalVisible] = useState(false);

  // --- Preview ---
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewCategory, setPreviewCategory] = useState<SMSCategory | '__custom__' | null>(null);
  const [previewItems, setPreviewItems] = useState<{ name: string; phone: string; message: string }[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const PREVIEW_LIMIT = 8;

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  /** ---- SYNCHRO ---- */
  const syncFromServer = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      setSyncing(true);
      setSyncError(null);

      const licStr = await AsyncStorage.getItem('licence');
      const lic = licStr ? JSON.parse(licStr) : null;
      const cle = String(lic?.licence || '').trim() || null;
      const licenceId = await getStableLicenceId();
      if (!licenceId) { setSyncError('Licence introuvable'); return; }

      const [tombstones, resets] = await Promise.all([loadTombstones(), loadHistoryResets()]);
      const tombstoneSet = new Set(tombstones);

      // 1) Clients via service
      const rows = await fetchClientsOnce(licenceId, { force });
      const remote = (rows || [])
        .filter(r => !(r as any).deletedAt)
        .map(rowToClient)
        .filter(c => !tombstoneSet.has(sanitizePhone(c.telephone)));

      // 2) Historique licence
      const hist = await fetchSmsHistoryFromLicence(licenceId, cle);
      const byPhone = new Map<string, { date: string; type: string }[]>();
      for (const h of hist) {
        const key = sanitizePhone(h.numero || '');
        if (!key) continue;
        const resetAt = resets[key];
        if (resetAt && new Date(h.date) <= new Date(resetAt)) continue;

        const rawLabel =
          h.campaignName || h.campaign || h.title || h.nom || h.name || h.template || '';
        const coerced = coerceHistoryLabel(h.type, rawLabel);

        if (!byPhone.has(key)) byPhone.set(key, []);
        byPhone.get(key)!.push({ date: String(h.date || ''), type: coerced });
      }

      // 3) Injecter l’historique
      const withHistory = remote.map(c => {
        const logs = (byPhone.get(sanitizePhone(c.telephone)) || []).map(l => ({
          date: l.date,
          type: l.type,
        }));
        return { ...c, messagesEnvoyes: logs };
      });

      // 4) Merge avec local (le local prévaut)
      const localStr = await AsyncStorage.getItem('clients');
      const localRaw: any[] = localStr ? JSON.parse(localStr) : [];
      const local: Client[] = (Array.isArray(localRaw) ? localRaw : []).map((l: any) => {
        const tel = sanitizePhone(l.telephone || l.phone || '');
        return { ...l, telephone: tel };
      });

      const mergedById = new Map<string, Client>();
      for (const r of withHistory) mergedById.set(String(r.id), r);
      for (const l of local) {
        const id = String(l.id);
        const cur = mergedById.get(id);
        if (!cur) { mergedById.set(id, l); continue; }
        const svcLocal = !!l?.consent?.service_sms?.value;
        const mktLocal = !!l?.consent?.marketing_sms?.value || !!l?.consentementMarketing;
        const svcRemote = !!cur?.consent?.service_sms?.value;
        const mktRemote = !!cur?.consent?.marketing_sms?.value || !!cur?.consentementMarketing;

        mergedById.set(id, {
          ...cur,
          ...l,
          dateNaissance: l.dateNaissance || cur.dateNaissance || '',
          lunettes: l.lunettes ?? cur.lunettes,
          lentilles: (l.lentilles && l.lentilles.length) ? l.lentilles : cur.lentilles,
          consentementMarketing: mktLocal || mktRemote,
          consent: {
            service_sms:   { value: svcLocal || svcRemote },
            marketing_sms: { value: mktLocal || mktRemote },
          },
          messagesEnvoyes: (() => {
            const a = Array.isArray(cur.messagesEnvoyes) ? cur.messagesEnvoyes : [];
            const b = Array.isArray(l.messagesEnvoyes) ? l.messagesEnvoyes : [];
            const seen = new Set(a.map(m => `${m.type}|${m.date}`));
            const out = [...a];
            for (const m of b) {
              const id = `${m.type}|${m.date}`;
              if (!seen.has(id)) out.push(m);
            }
            return out;
          })(),
        });
      }

      const merged = Array.from(mergedById.values());
      await AsyncStorage.setItem('clients', JSON.stringify(merged));
      setClients(merged);
    } catch (e: any) {
      setSyncError(e?.message || 'Erreur inconnue');
    } finally {
      inFlightRef.current = false;
      setSyncing(false);
    }
  }, []);

  // Chargement local + première synchro
  useEffect(() => {
    (async () => {
      const clientData = await AsyncStorage.getItem('clients');
      const messageData = await AsyncStorage.getItem('messages');
      if (clientData) {
  try {
    const parsed: any[] = JSON.parse(clientData);
    const normalized: Client[] = (Array.isArray(parsed) ? parsed : []).map((c: any) => {
      const tel = sanitizePhone(c.telephone || c.phone || '');
      return {
        ...c,
        id: c.id || `c-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        telephone: tel,
      };
    });
    setClients(normalized);
    await AsyncStorage.setItem('clients', JSON.stringify(normalized));
  } catch {
    setClients([]);
  }
}

      if (messageData) {
        try { setCustomMessages(JSON.parse(messageData)); } catch {}
      }
      await syncFromServer(true);
    })();
  }, [syncFromServer]);

  // Filtrage + Tri
  useEffect(() => {
    const lower = searchQuery.toLowerCase();

    let result = clients.filter(
      (client) =>
        (client.nom || '').toLowerCase().includes(lower) ||
        (client.prenom || '').toLowerCase().includes(lower) ||
        (client.telephone || '').includes(lower)
    );

    if (smsFilter !== 'Tous') {
      result = result.filter((client) =>
        client.messagesEnvoyes?.some((msg) => msg.type === smsFilter)
      );
    }

    result = [...result].sort((a, b) => {
      switch (sortMode) {
        case 'NAME_ASC':
          return safeName(a).localeCompare(safeName(b), 'fr', { sensitivity: 'base' });
        case 'NAME_DESC':
          return safeName(b).localeCompare(safeName(a), 'fr', { sensitivity: 'base' });
        case 'LAST_SMS_DESC': {
          const ta = getLastSmsDate(a), tb = getLastSmsDate(b);
          if (ta === tb) return safeName(a).localeCompare(safeName(b), 'fr', { sensitivity: 'base' });
          return tb - ta;
        }
        case 'LAST_SMS_ASC': {
          const ta = getLastSmsDate(a), tb = getLastSmsDate(b);
          if (ta === tb) return safeName(a).localeCompare(safeName(b), 'fr', { sensitivity: 'base' });
          return ta - tb;
        }
        case 'CREATED_DESC': {
          const ta = safeDate(a.createdAt), tb = safeDate(b.createdAt);
          if (ta === tb) return safeName(a).localeCompare(safeName(b), 'fr', { sensitivity: 'base' });
          return tb - ta;
        }
        case 'CREATED_ASC': {
          const ta = safeDate(a.createdAt), tb = safeDate(b.createdAt);
          if (ta === tb) return safeName(a).localeCompare(safeName(b), 'fr', { sensitivity: 'base' });
          return ta - tb;
        }
        default:
          return 0;
      }
    });

    setFilteredClients(result);
  }, [searchQuery, smsFilter, clients, sortMode]);

  const toggleSelect = (id: string) => {
    setSelectedClients((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // suppression (par téléphone conservée)
  // ❌ ancien deleteClient(rawPhone: string)
// ✅ nouveau : on supprime par id unique
const deleteClient = async (clientId: string) => {
  const ok = await confirmAsync('Supprimer ce client ?', 'Cette action est definitive.');
  if (!ok) return;

  // Optimiste local : on retire uniquement l’ID visé
  const updated = clients.filter(c => String(c.id) !== String(clientId));
  setClients(updated);
  await AsyncStorage.setItem('clients', JSON.stringify(updated));

  try {
    const licenceId = await getStableLicenceId();
    if (!licenceId) throw new Error('LICENCE_ID_MISSING');

    // Suppression serveur par ID si possible
    const del = await fetch(
      `${API_BASE}/api/clients/${encodeURIComponent(String(clientId))}?licenceId=${encodeURIComponent(licenceId)}`,
      { method: 'DELETE' }
    );
    if (!del.ok) throw new Error(`HTTP ${del.status}`);
  } catch {
    // en cas d’échec réseau on ne tente PAS de tombstone par téléphone
    // car cela impacterait d’autres fiches partageant le même numéro
  }
};


  const resetClientHistory = async (rawPhone: string) => {
    const ok = await confirmAsync('Reinitialiser l’historique ?', 'Effacer l’historique des SMS de ce client ?', 'Reinitialiser');
    if (!ok) return;

    const phone = sanitizePhone(rawPhone);

    const updated = clients.map((c) =>
      sanitizePhone(c.telephone) === phone ? { ...c, messagesEnvoyes: [] } : c
    );
    setClients(updated);
    await AsyncStorage.setItem('clients', JSON.stringify(updated));

    const resets = await loadHistoryResets();
    resets[phone] = new Date().toISOString();
    await saveHistoryResets(resets);

    try {
      const licenceId = await getStableLicenceId();
      if (!licenceId) throw new Error('LICENCE_ID_MISSING');
      const numero = toE164FR(phone);

      const tries = [
        { url: `${API_BASE}/api/sms-history/erase-for-number`, body: { licenceId, numero } },
        { url: `${API_BASE}/api/sms-history/erase`,           body: { licenceId, numero } },
        { url: `${API_BASE}/licence/history/erase-for-number`, body: { licenceId, numero } },
        { url: `${API_BASE}/api/licence/history/erase`,        body: { licenceId, numero } },
      ];
      for (const t of tries) {
        try {
          const r = await fetch(t.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(t.body),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && (j?.ok === true || j?.removed >= 0)) break;
        } catch {}
      }
    } catch {}
  };

  /* --------- Envoi SMS --------- */
  const getTemplateString = (key: SMSCategory) => {
    const v = customMessages[key];
    if (typeof v === 'string') return v || DEFAULT_TEMPLATES[key];
    if (v && typeof v === 'object' && 'content' in v) {
      return (v.content as string) || DEFAULT_TEMPLATES[key];
    }
    return DEFAULT_TEMPLATES[key];
  };
  const buildMessageForClient = (tpl: string, c: Client) =>
    (tpl || 'Bonjour, votre opticien vous contacte.')
      .replace('{prenom}', c.prenom || '')
      .replace('{nom}', c.nom || '')
      .replace(/\s*\{prenom\}\s*/g, '')
      .replace(/\s*\{nom\}\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const openSmsDialog = () => {
    if (selectedClients.length === 0) {
      Alert.alert('Info', 'Selectionne au moins un client.');
      return;
    }
    setTypeModalVisible(true);
  };

  /** Prévisualisation (clients sélectionnés par ID) */
  const openPreviewForCategory = async (category: SMSCategory | '__custom__') => {
    const idSet = new Set(selectedClients);
    const batch = clients.filter((c) => idSet.has(getId(c)));
    if (batch.length === 0) {
      Alert.alert('Info', 'Selectionne au moins un client.');
      return;
    }

    const signature = await getSignatureFromSettings();

    const items = batch.slice(0, PREVIEW_LIMIT).map((c) => {
      const tpl = category === '__custom__' ? (customText || '') : getTemplateString(category as SMSCategory);
      let message = buildMessageForClient(tpl, c);
      message = appendSignature(message, signature);
      return {
        name: `${c.prenom ?? ''} ${c.nom ?? ''}`.trim() || '(sans nom)',
        phone: sanitizePhone(c.telephone || ''),
        message,
      };
    });

    setPreviewItems(items);
    setPreviewTotal(batch.length);
    setPreviewCategory(category);
    setPreviewVisible(true);
  };

  const sendOne = async ({
    licenceId,
    phoneNumber,
    message,
    category,
  }:{
    licenceId: string;
    phoneNumber: string;
    message: string;
    category?: string;
  }) => {
    const e164 = toE164FR(phoneNumber);
    const payload: any = { licenceId, phoneNumber: e164, message, category };

    const resp = await fetch(SEND_SMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({} as any));
    if (!resp.ok || data?.success === false || data?.ok === false) {
      const errMsg = data?.error || data?.message || `HTTP ${resp.status}`;
      throw new Error(errMsg);
    }
    return true;
  };

  const fetchCreditsFromServer = async (licenceId: string): Promise<number | null> => {
    const urls = [
      `${API_BASE}/api/licence?id=${encodeURIComponent(licenceId)}`,
      `${API_BASE}/licence?id=${encodeURIComponent(licenceId)}`
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        const t = await r.text();
        if (!r.ok) continue;
        const j = JSON.parse(t);
        const lic = j?.licence ?? j;
        const credits = lic?.credits;
        if (typeof credits === 'number') return credits;
      } catch {}
    }
    return null;
  };

  const sendBatch = async (category: SMSCategory | '__custom__') => {
    const idSet = new Set(selectedClients);
    const batch = clients.filter((c) => idSet.has(getId(c)));
    if (batch.length === 0) {
      Alert.alert('Info', 'Selectionne au moins un client.');
      return;
    }

    const licenceId = await getStableLicenceId();
    if (!licenceId) { Alert.alert('Erreur', 'Licence introuvable.'); return; }

    const credits = await fetchCreditsFromServer(licenceId);
    if (credits !== null && credits < batch.length) {
      Alert.alert('Credits insuffisants', `Credits: ${credits}, SMS requis: ${batch.length}.`);
      return;
    }

    const signature = await getSignatureFromSettings();

    setSending(true);
    setTypeModalVisible(false);
    setPreviewVisible(false);
    setSendError(null);
    setSendStep('prep');
    setProgressTotal(batch.length);
    setProgressCount(0);
    setBatchSummary(null);

    const nowIso = new Date().toISOString();
    let sent = 0, skippedConsent = 0, failed = 0;
    const updated = [...clients];

    try {
      setSendStep('send');

      for (const c of batch) {
        const okService = !!c?.consent?.service_sms?.value;
        const phone = sanitizePhone(c.telephone || '');
        if (!okService || !isPhone10(phone)) {
          skippedConsent++;
          setProgressCount((x) => x + 1);
          continue;
        }

        const tpl = category === '__custom__' ? (customText || '') : getTemplateString(category as SMSCategory);
        let message = buildMessageForClient(tpl, c);
        message = appendSignature(message, signature);
        if (!message) { failed++; setProgressCount((x) => x + 1); continue; }

        try {
          await sendOne({
            licenceId,
            phoneNumber: phone,
            message,
            category: category === '__custom__' ? 'Personnalisé' : (category as string),
          });

          const idx = updated.findIndex((u) => String(u.id) === String(c.id));
          if (idx !== -1) {
            const ref = updated[idx] as any;
            if (!Array.isArray(ref.messagesEnvoyes)) ref.messagesEnvoyes = [];
            ref.messagesEnvoyes.push({
              type: category === '__custom__' ? ('Personnalisé' as SMSCategory) : (category as SMSCategory),
              date: nowIso,
            });
            if (!ref.premierMessage) ref.premierMessage = nowIso;
          }

          sent++;
        } catch (e) {
          console.warn(`Echec SMS ${c.telephone}:`, (e as Error).message);
          failed++;
        } finally {
          setProgressCount((x) => x + 1);
        }
      }

      await AsyncStorage.setItem('clients', JSON.stringify(updated));
      setClients(updated);
      setSelectedClients([]);

      setBatchSummary({ sent, skipped: skippedConsent, failed });
      setSendStep('done');
      setTimeout(() => setSending(false), 1000);
    } catch (e:any) {
      setSendError(e?.message || 'Erreur inconnue');
      setSendStep('error');
    }
  };

  const renderItem = ({ item, index }: { item: Client; index: number }) => {
    const id = getId(item, index);
    const checked = selectedClients.includes(id);
    return (
      <View style={styles.clientItem}>
        <View style={styles.clientRow}>
          <TouchableOpacity onPress={() => toggleSelect(id)} style={{ flex: 1 }}>
            <Text style={styles.clientText}>
              {checked ? '☑ ' : '☐ '}
              {item.prenom} {item.nom} {item.telephone ? `(${item.telephone})` : ''}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('ClientDetails', { client: item })}
            style={styles.editButton}
            hitSlop={{top:8,bottom:8,left:8,right:8}}
          >
            <Text style={styles.editButtonText}>Modifier</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => resetClientHistory(item.telephone)}
            style={[styles.editButton, { marginLeft: 6 }]}
            hitSlop={{top:8,bottom:8,left:8,right:8}}
          >
            <Text style={styles.editButtonText}>Reinitialiser</Text>
          </TouchableOpacity>

          <TouchableOpacity
  onPress={() => deleteClient(String(item.id))}
  style={[styles.deleteBtn, { marginLeft: 6 }]}
  hitSlop={{top:8,bottom:8,left:8,right:8}}
>
  <Text style={styles.deleteBtnText}>Supprimer</Text>
</TouchableOpacity>

        </View>

        {item.messagesEnvoyes?.length > 0 && (
          <View style={styles.smsHistory}>
            {[...item.messagesEnvoyes]
              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
              .map((msg, idx) => {
                const date = new Date(msg.date);
                const formatted = `${date.toLocaleDateString()} a ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
                return (
                  <Text key={idx} style={styles.smsHistoryText}>
                    - {msg.type} le {formatted}
                  </Text>
                );
              })}
          </View>
        )}
      </View>
    );
  };

  const selectedCount = selectedClients.length;
  const hasSelection = selectedCount > 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Mes Clients</Text>
        <TouchableOpacity onPress={() => syncFromServer(true)} style={styles.syncBtn} disabled={syncing}>
          <Text style={styles.syncBtnText}>{syncing ? '…' : '↻ Sync'}</Text>
        </TouchableOpacity>
      </View>
      {syncError ? <Text style={styles.syncError}>⚠ {syncError}</Text> : null}

      <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.homeButtonText}>← Accueil</Text>
      </TouchableOpacity>

      <View style={styles.topActionBar}>
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Trier :</Text>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'NAME_ASC' && styles.sortChipActive]} onPress={() => setSortMode('NAME_ASC')}>
            <Text style={styles.sortChipText}>A → Z</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'NAME_DESC' && styles.sortChipActive]} onPress={() => setSortMode('NAME_DESC')}>
            <Text style={styles.sortChipText}>Z → A</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'LAST_SMS_DESC' && styles.sortChipActive]} onPress={() => setSortMode('LAST_SMS_DESC')}>
            <Text style={styles.sortChipText}>Dernier SMS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'LAST_SMS_ASC' && styles.sortChipActive]} onPress={() => setSortMode('LAST_SMS_ASC')}>
            <Text style={styles.sortChipText}>Premier SMS</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'CREATED_DESC' && styles.sortChipActive]} onPress={() => setSortMode('CREATED_DESC')}>
            <Text style={styles.sortChipText}>Récents</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.sortChip, sortMode === 'CREATED_ASC' && styles.sortChipActive]} onPress={() => setSortMode('CREATED_ASC')}>
            <Text style={styles.sortChipText}>Anciens</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.smsButtonTop, !hasSelection && styles.smsButtonDisabled]}
          onPress={openSmsDialog}
          disabled={!hasSelection}
          accessibilityState={{ disabled: !hasSelection }}
        >
          <Text style={styles.smsText}>Envoyer SMS{hasSelection ? ` (${selectedCount})` : ''}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Rechercher un client..."
        placeholderTextColor="#888"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <View style={styles.filterRow}>
        {FILTER_TYPES.map((type) => (
          <TouchableOpacity
            key={type}
            style={[styles.filterButton, smsFilter === type && styles.filterButtonActive]}
            onPress={() => setSmsFilter(type)}
          >
            <Text style={smsFilter === type ? styles.filterTextActive : styles.filterText}>
              {type}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
  data={filteredClients}
  keyExtractor={(item, i) => String(item.id || `${sanitizePhone(item.telephone)}-${i}`)}
  renderItem={renderItem}
/>


      {/* Modale choix type -> ouvre la PREVIEW */}
      <Modal visible={typeModalVisible} transparent animationType="fade" onRequestClose={() => setTypeModalVisible(false)}>
        <View style={styles.customOverlay}>
          <View style={styles.customCard}>
            <Text style={styles.customTitle}>Type de message</Text>
            {(['Lunettes','SAV','Lentilles','Commande'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={styles.typeBtn}
                onPress={() => { setTypeModalVisible(false); setTimeout(() => openPreviewForCategory(t), 50); }}
              >
                <Text style={styles.customBtnText}>{t}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.typeBtn, { backgroundColor: '#555' }]}
              onPress={() => { setTypeModalVisible(false); setCustomModalVisible(true); }}
            >
              <Text style={styles.customBtnText}>Personnalisé</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeBtn, { backgroundColor: '#3b0d0d' }]}
              onPress={() => setTypeModalVisible(false)}
            >
              <Text style={[styles.customBtnText, { color: '#ffb4b4' }]}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale “Personnalisé” -> déclenche PREVIEW */}
      <Modal visible={customModalVisible} transparent animationType="fade" onRequestClose={() => setCustomModalVisible(false)}>
        <View style={styles.customOverlay}>
          <View style={styles.customCard}>
            <Text style={styles.customTitle}>Message personnalisé</Text>
            <Text style={styles.customHint}>Placeholders : {'{prenom}'} et {'{nom}'}</Text>
            <TextInput
              style={styles.customInput}
              multiline
              placeholder="Tapez votre message…"
              placeholderTextColor="#aaa"
              value={customText}
              onChangeText={setCustomText}
            />
            <View style={styles.customRow}>
              <TouchableOpacity
                style={[styles.customBtn, { backgroundColor: '#28a745' }]}
                onPress={() => { setCustomModalVisible(false); setTimeout(() => openPreviewForCategory('__custom__'), 50); }}
              >
                <Text style={styles.customBtnText}>Prévisualiser</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customBtn, { backgroundColor: '#555' }]}
                onPress={() => setCustomModalVisible(false)}
              >
                <Text style={styles.customBtnText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modale Prévisualisation */}
      <Modal visible={previewVisible} transparent animationType="fade" onRequestClose={() => setPreviewVisible(false)}>
        <View style={styles.customOverlay}>
          <View style={[styles.customCard, { width: '90%' }]}>
            <Text style={styles.customTitle}>Prévisualisation</Text>
            <Text style={styles.customHint}>
              Type : {previewCategory === '__custom__' ? 'Personnalisé' : previewCategory} — Destinataires : {previewTotal}
            </Text>

            <View style={{ maxHeight: 320, marginTop: 10 }}>
              {previewItems.map((it, idx) => (
                <View
                  key={idx}
                  style={{ marginBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333', paddingBottom: 8 }}
                >
                  <Text style={{ color: '#cdeafe', fontWeight: '700' }}>
                    {it.name} ({it.phone})
                  </Text>
                  <Text style={{ color: '#eee', marginTop: 4 }}>{it.message}</Text>
                </View>
              ))}
              {previewTotal > previewItems.length && (
                <Text style={{ color: '#bbb', marginTop: 4 }}>
                  … et {previewTotal - previewItems.length} autres.
                </Text>
              )}
            </View>

            <View style={styles.customRow}>
              <TouchableOpacity
                style={[styles.customBtn, { backgroundColor: '#28a745' }]}
                onPress={() => {
                  const cat = previewCategory;
                  setPreviewVisible(false);
                  if (cat) setTimeout(() => sendBatch(cat), 60);
                }}
              >
                <Text style={styles.customBtnText}>Confirmer l’envoi</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.customBtn, { backgroundColor: '#555' }]}
                onPress={() => setPreviewVisible(false)}
              >
                <Text style={styles.customBtnText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Progress envoi */}
      <Modal visible={sending} transparent animationType="fade" onRequestClose={() => { if (sendStep !== 'send') setSending(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Envoi des SMS…</Text>
            {sendStep !== 'done' && sendStep !== 'error' && <ActivityIndicator size="large" color="#fff" />}
            <View style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={styles.progressLine}>{sendStep === 'prep' ? '• Preparation…' : '✓ Preparation'}</Text>
              <Text style={styles.progressLine}>{sendStep === 'send' ? '• Envoi au serveur…' : (sendStep === 'prep' ? '• Envoi au serveur' : '✓ Envoi au serveur')}</Text>
              <Text style={[styles.progressLine, { marginTop: 8 }]}>{progressCount} / {progressTotal}</Text>
              {sendStep === 'done' && batchSummary && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.progressOk}>✓ Terminé</Text>
                  <Text style={styles.progressLine}>Envoyés : {batchSummary.sent}</Text>
                  <Text style={styles.progressLine}>Ignorés (consentement/tel) : {batchSummary.skipped}</Text>
                  <Text style={styles.progressLine}>Échecs : {batchSummary.failed}</Text>
                </View>
              )}
              {sendStep === 'error' && <Text style={styles.progressErr}>✗ {sendError || 'Erreur inconnue'}</Text>}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#000' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  homeButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1a1a1a', borderRadius: 6, marginBottom: 12, marginTop: 8 },
  homeButtonText: { fontSize: 14, color: '#00BFFF' },

  topActionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  sortRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, flex: 1 },
  sortLabel: { color: '#ddd', marginRight: 6 },
  sortChip: { backgroundColor: '#1f2937', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  sortChipActive: { backgroundColor: '#00BFFF' },
  sortChipText: { color: '#fff', fontWeight: '600', fontSize: 12 },

  smsButtonTop: { backgroundColor: '#00BFFF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center' },
  smsButtonDisabled: { backgroundColor: '#3a3a3a', opacity: 0.6 },
  smsText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  searchInput: { backgroundColor: '#1a1a1a', padding: 10, marginBottom: 12, borderRadius: 8, color: '#fff' },
  filterRow: { flexDirection: 'row', marginBottom: 12, flexWrap: 'wrap', gap: 6 },
  filterButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#222', marginRight: 8, marginBottom: 6 },
  filterButtonActive: { backgroundColor: '#00BFFF' },
  filterText: { color: '#ccc' },
  filterTextActive: { color: '#fff', fontWeight: 'bold' },

  clientItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#333' },
  clientRow: { flexDirection: 'row', alignItems: 'center' },
  clientText: { fontSize: 16, color: '#fff' },
  editButton: { marginLeft: 6, padding: 6, backgroundColor: '#1a1a1a', borderRadius: 4 },
  editButtonText: { fontSize: 14, color: '#00BFFF' },
  deleteBtn: { padding: 6, backgroundColor: '#3b0d0d', borderRadius: 4 },
  deleteBtnText: { fontSize: 14, color: '#ff6b6b', fontWeight: '700' },
  smsHistory: { marginTop: 4, paddingLeft: 10 },
  smsHistoryText: { fontSize: 13, color: '#aaa' },

  // Sync
  syncBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1f2937', borderRadius: 6 },
  syncBtnText: { color: '#cdeafe', fontWeight: '600' },
  syncError: { color: '#ff6b6b', marginTop: 4 },

  // Custom/modal
  customOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  customCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '85%' },
  customTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 6 },
  customHint: { color: '#bbb', marginBottom: 8 },
  customInput: { minHeight: 90, borderWidth: 1, borderColor: '#555', borderRadius: 8, padding: 10, color: '#fff', backgroundColor: '#111' },
  customRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, gap: 10 },
  customBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  customBtnText: { color: '#fff', fontWeight: '700' },
  typeBtn: { paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#007AFF', marginTop: 8 },

  // Progress modal
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  progressCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '80%', alignItems: 'center' },
  progressTitle: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 10 },
  progressLine: { color: '#ddd', marginTop: 2 },
  progressOk: { color: '#3ddc84', marginTop: 6, fontWeight: '700' },
  progressErr: { color: '#ff6b6b', marginTop: 6, fontWeight: '700' },
});

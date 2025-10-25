// AddClientPage.tsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, View,
  ActivityIndicator, Platform, Alert
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { Client } from './types';

/* =========================
 * Constantes & helpers
 * ========================= */

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

const sanitizePhone = (raw: string): string => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};
const toE164FR = (raw: string): string => {
  const p = sanitizePhone(raw);
  if (/^0\d{9}$/.test(p)) return '+33' + p.slice(1);
  if (/^33\d{9}$/.test(p)) return '+' + p;
  if (p.startsWith('+33')) return p;
  return p;
};
const isPhone10 = (p: string) => /^\d{10}$/.test(p);

const phoneMatches = (p: string, q: string) => {
  const sp = sanitizePhone(p);
  const sq = sanitizePhone(q);
  if (!sq) return false;
  if (sq.length < 6) return false;
  if (sp.startsWith(sq)) return true;
  if (sq.startsWith(sp) && sp.length >= 6) return true;
  return toE164FR(sp).startsWith(toE164FR(sq));
};

const DEFAULT_TEMPLATES: Record<'Lunettes' | 'SAV' | 'Lentilles' | 'Commande', string> = {
  Lunettes:  'Bonjour {prenom} {nom}, vos lunettes sont prêtes. À bientôt !',
  SAV:       'Bonjour {prenom} {nom}, votre SAV est terminé, vous pouvez venir le récupérer.',
  Lentilles: 'Bonjour {prenom} {nom}, vos lentilles sont disponibles en magasin.',
  Commande:  'Bonjour {prenom} {nom}, votre commande est arrivée !',
};

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
  if (norm(m).endsWith(norm(s))) return m;
  const needsSpace = /[.!?]\s*$/.test(m);
  const sep = needsSpace ? ' ' : ' — ';
  return `${m}${sep}${s}`;
};

/** Récupère (ou résout) un licenceId stable et le cache (AsyncStorage + ref) */
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
      const r = await fetch(
        `${SERVER_BASE}/api/licence/by-key?key=${encodeURIComponent(lic.licence)}&_=${Date.now()}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' }
      );
      if (r.ok) {
        const j = await r.json().catch(() => ({} as any));
        const id = j?.licence?.id || j?.id;
        if (id) {
          await AsyncStorage.setItem('licenceId', String(id));
          return String(id);
        }
      }
    }
  } catch {}
  return null;
};

/** Coercition des consentements depuis différentes formes possibles */
const coerceConsent = (src: any) => {
  // service
  const service =
    !!src?.consent?.service_sms?.value ||
    src?.service_sms === true ||
    src?.service === true ||
    src?.consentService === true ||
    src?.consentementService === true ||
    src?.service_sms === 1 || src?.service_sms === '1' ||
    String(src?.service_sms).toLowerCase?.() === 'oui';

  // marketing
  const marketing =
    !!src?.consent?.marketing_sms?.value ||
    src?.marketing_sms === true ||
    src?.marketing === true ||
    src?.consentMarketing === true ||
    src?.consentementMarketing === true ||
    src?.marketing_sms === 1 || src?.marketing_sms === '1' ||
    String(src?.marketing_sms).toLowerCase?.() === 'oui';

  return { service, marketing };
};

/** Map vers le format serveur /api/clients/upsert (inclut consent) */
const toServerClient = (local: any, stableId?: string) => {
  const now = new Date().toISOString();
  const lensDuration =
    local.journ30 ? '30j' :
    local.journ60 ? '60j' :
    local.journ90 ? '90j' :
    local.mens6  ? '6mois' :
    local.mens12 ? '1an'   : null;

  const consent = {
    service_sms: {
      value: !!local?.consent?.service_sms?.value,
      collectedAt: local?.consent?.service_sms?.collectedAt || now,
      source: local?.consent?.service_sms?.source || 'in_store',
      proof: local?.consent?.service_sms?.proof || 'case-cochée-app',
      unsubscribedAt: local?.consent?.service_sms?.unsubscribedAt || null,
    },
    marketing_sms: {
      value: !!local?.consent?.marketing_sms?.value || !!local?.consentementMarketing,
      collectedAt: local?.consent?.marketing_sms?.collectedAt || now,
      source: local?.consent?.marketing_sms?.source || 'in_store',
      proof: local?.consent?.marketing_sms?.proof || 'case-cochée-app',
      unsubscribedAt: local?.consent?.marketing_sms?.unsubscribedAt || null,
    },
  };

  return {
    id: stableId || local.id || `c-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    prenom: String(local.prenom || ''),
    nom: String(local.nom || ''),
    phone: sanitizePhone(local.telephone || ''),
    email: String(local.email || ''),
    naissance: local.dateNaissance || null,
    lensStartDate: null,
    lensEndDate: null,
    lensDuration,
    note: '',
    consent,
    updatedAt: now,
  };
};

/* =========================
 * Page
 * ========================= */

type RouteParams = { mode?: 'edit' | 'new'; client?: Client };

export default function AddClientPage() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { mode, client }: RouteParams = route.params || {};

  // licence cache
  const licenceIdRef = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!licenceIdRef.current) {
        const id = await getStableLicenceId();
        if (alive) licenceIdRef.current = id;
      }
    })();
    return () => { alive = false; };
  }, []);

  // Identité
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');

  // Date de naissance
  const [bDay, setBDay] = useState('');
  const [bMonth, setBMonth] = useState('');
  const [bYear, setBYear] = useState('');
  const dateNaissance = useMemo(() => (bDay && bMonth && bYear ? `${bDay}/${bMonth}/${bYear}` : ''), [bDay, bMonth, bYear]);
  const [pickerOpen, setPickerOpen] = useState<null | 'day' | 'month' | 'year'>(null);

  // Produits
  const [lunettes, setLunettes] = useState(false);
  const [journ30, setJourn30] = useState(false);
  const [journ60, setJourn60] = useState(false);
  const [journ90, setJourn90] = useState(false);
  const [mens6, setMens6] = useState(false);
  const [mens12, setMens12] = useState(false);

  // Consentements (cases à cocher)
  const [consentService, setConsentService] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  // Envoi express
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [messages, setMessages] = useState<Record<string, { title: string; content: string }>>({});

  // Modale "Personnalisé"
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customText, setCustomText] = useState('');

  // Toast
  const [toast, setToast] = useState<{ visible: boolean; text: string }>({ visible: false, text: '' });
  const showToast = useCallback((text: string, ms = 1500) => {
    setToast({ visible: true, text });
    const t = setTimeout(() => setToast({ visible: false, text: '' }), ms);
    return () => clearTimeout(t);
  }, []);

  // Progress envoi SMS
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<'prep' | 'send' | 'done' | 'error'>('prep');
  const [sendError, setSendError] = useState<string | null>(null);

  // ========= SUGGESTIONS =========
  type LightClient = {
    id?: string; prenom?: string; nom?: string; phone?: string; telephone?: string; email?: string;
    lunettes?: boolean; lentilles?: any[]; dateNaissance?: string; consent?: any; consentementMarketing?: boolean;
    consentService?: boolean; consentMarketing?: boolean; service_sms?: any; marketing_sms?: any;
  };
  const [suggestions, setSuggestions] = useState<LightClient[]>([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const debounceRef = useRef<any>(null);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);

  const fetchClientById = useCallback(async (id: string): Promise<LightClient | null> => {
    const lic = licenceIdRef.current || await getStableLicenceId();
    licenceIdRef.current = lic;
    if (!lic || !id) return null;

    const tryParse = (j: any): any => j?.client || j?.data || j;
    const urls = [
      `${SERVER_BASE}/api/clients/by-id?licenceId=${encodeURIComponent(lic)}&id=${encodeURIComponent(id)}`,
      `${SERVER_BASE}/api/clients/get?id=${encodeURIComponent(id)}&licenceId=${encodeURIComponent(lic)}`,
      `${SERVER_BASE}/api/clients/${encodeURIComponent(id)}?licenceId=${encodeURIComponent(lic)}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({}));
        const obj = tryParse(j);
        if (obj && typeof obj === 'object') {
          const phone = sanitizePhone(obj.phone || obj.telephone || '');
          return { ...obj, phone };
        }
      } catch {}
    }
    try {
      const raw = await AsyncStorage.getItem('clients');
      const local: any[] = raw ? JSON.parse(raw) : [];
      const found = (local || []).find((c) => String(c.id) === String(id));
      if (found) return { ...found, phone: sanitizePhone(found.phone || found.telephone || '') };
    } catch {}
    return null;
  }, []);

  const searchClientsRemote = useCallback(async (q: string): Promise<LightClient[]> => {
    const lic = licenceIdRef.current || await getStableLicenceId();
    licenceIdRef.current = lic;
    if (!lic) return [];

    const clean = sanitizePhone(q);
    const tryParse = (j: any): LightClient[] => {
      if (Array.isArray(j)) return j as any[];
      if (Array.isArray(j?.clients)) return j.clients as any[];
      if (Array.isArray(j?.items)) return j.items as any[];
      if (Array.isArray(j?.data)) return j.data as any[];
      return [];
    };
    const normalize = (c: any) => ({ ...c, phone: sanitizePhone(c.phone || c.telephone || '') });

    const postFilter = (arr: any[]): LightClient[] =>
      (arr || []).map(normalize).filter((c: any) => phoneMatches(c.phone, clean));

    const urls = [
      `${SERVER_BASE}/api/clients/by-phone?licenceId=${encodeURIComponent(lic)}&phone=${encodeURIComponent(clean)}`,
      `${SERVER_BASE}/api/clients/search?licenceId=${encodeURIComponent(lic)}&q=${encodeURIComponent(clean)}`,
      `${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(lic)}&q=${encodeURIComponent(clean)}`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({}));
        const arr = postFilter(tryParse(j));
        if (arr.length) return arr;
      } catch {}
    }

    try {
      const r = await fetch(`${SERVER_BASE}/api/clients?licenceId=${encodeURIComponent(lic)}`);
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const arr = postFilter(tryParse(j));
        if (arr.length) return arr;
      }
    } catch {}

    try {
      const data = await AsyncStorage.getItem('clients');
      const local: any[] = data ? JSON.parse(data) : [];
      return (local || [])
        .map((c) => ({ ...c, phone: sanitizePhone(c.phone || c.telephone || '') }))
        .filter((c) => phoneMatches(c.phone, clean));
    } catch { return []; }
  }, []);

  const handlePhoneChange = useCallback((val: string) => {
  const clean = sanitizePhone(val);
  setTelephone(clean);

  // 🚫 Si on modifie un client existant, ne pas déclencher la recherche
  if (selectedExistingId) {
    return; // on laisse l’utilisateur modifier librement son numéro
  }

  if (debounceRef.current) clearTimeout(debounceRef.current);

  if (clean.length < 6) {
    setSuggestions([]);
    setShowSug(false);
    return;
  }

  debounceRef.current = setTimeout(async () => {
    setLoadingSug(true);
    const res = await searchClientsRemote(clean);
    setSuggestions(res || []);
    setShowSug(true);
    setLoadingSug(false);
  }, 220);
}, [searchClientsRemote, selectedExistingId]);


  /** Remplit tous les champs depuis un objet "complet" (inclut consentements coercés) */
  // ⛔️ ancienne version : dépendait de [telephone] et utilisait ... || telephone
// ✅ nouvelle version : pas de dépendances, pas de fallback sur l'état courant
const hydrateFrom = useCallback((c: any) => {
  const phone = sanitizePhone(c.phone || c.telephone || ''); // <- plus de "|| telephone"
  setSelectedExistingId(String(c.id || ''));
  setTelephone(phone);
  setNom(String(c.nom || ''));
  setPrenom(String(c.prenom || ''));
  setEmail(String(c.email || ''));

  // Produits / lentilles
  setLunettes(!!c.lunettes);
  const arr: string[] = Array.isArray(c.lentilles) ? c.lentilles : [];
  setJourn30(arr.includes('30j'));
  setJourn60(arr.includes('60j'));
  setJourn90(arr.includes('90j'));
  setMens6(arr.includes('6mois'));
  setMens12(arr.includes('1an'));

  // Consentements
  const cc = coerceConsent(c);
  setConsentService(!!cc.service);
  setConsentMarketing(!!cc.marketing);

  // Date de naissance
  const dn = String(c.dateNaissance || c.naissance || '');
  const mt = dn.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mt) { setBDay(mt[1].padStart(2,'0')); setBMonth(mt[2].padStart(2,'0')); setBYear(mt[3]); }
  else { setBDay(''); setBMonth(''); setBYear(''); }
}, []); // <- AUCUNE dépendance


  const selectSuggestion = useCallback(async (c: LightClient) => {
    setShowSug(false);
    const id = String(c.id || '');
    let full: any = null;

    if (id) {
      full = await fetchClientById(id);
    }
    if (!full) full = c;

    hydrateFrom(full);
    setSelectedExistingId(String(full.id || ''));

    setToast({ visible: true, text: '📂 Dossier chargé' });
    setTimeout(() => setToast({ visible: false, text: '' }), 1200);
  }, [fetchClientById, hydrateFrom]);

  // Pré-remplissage + chargement modèles
  useEffect(() => {
  if (mode === 'edit' && client) {
    hydrateFrom(client as any);
  }
  AsyncStorage.getItem('messages').then((data) => {
    if (!data) return;
    try { setMessages(JSON.parse(data)); } catch {}
  });
}, [mode, client]); // <- enlever "hydrateFrom" des deps


  const toggle = (setter: React.Dispatch<React.SetStateAction<boolean>>) => setter(prev => !prev);

  /** SAVE + SYNC SERVEUR */
 const handleSave = useCallback(async () => {
  const tel = sanitizePhone(telephone.trim());
  if (!tel) return showToast('☎ Numéro obligatoire');
  if (!isPhone10(tel)) return showToast('❌ Numéro invalide');
  if (!nom.trim() || !prenom.trim()) return showToast('❌ Nom et prénom requis');

  const now = new Date().toISOString();

  const localClient: any = {
    id: selectedExistingId || (client as any)?.id,
    nom, prenom, telephone: tel, email,
    dateNaissance,
    lunettes,
    lentilles: [journ30 && '30j', journ60 && '60j', journ90 && '90j', mens6 && '6mois', mens12 && '1an'].filter(Boolean),
    consentementMarketing: consentMarketing,
    consent: {
      service_sms:   { value: consentService,   collectedAt: consentService ? now   : undefined, source: 'in_store', proof: consentService   ? 'case-cochée-app' : undefined, unsubscribedAt: null },
      marketing_sms: { value: consentMarketing, collectedAt: consentMarketing ? now : undefined, source: 'in_store', proof: consentMarketing ? 'case-cochée-app' : undefined, unsubscribedAt: null },
    },
    messagesEnvoyes: mode === 'edit' ? (client as any)?.messagesEnvoyes || [] : [],
    createdAt:      mode === 'edit' ? (client as any)?.createdAt      || now : now,
    updatedAt: now,
  };

  // 1) 💾 Sauvegarde locale — UPDATE par id uniquement, sinon CREATE
  try {
    const data = await AsyncStorage.getItem('clients');
    let clients: any[] = data ? JSON.parse(data) : [];

    // ✅ on ne cherche PLUS par téléphone ici
    let idxExisting = -1;
    if (localClient.id) {
      idxExisting = clients.findIndex((c) => c.id === localClient.id);
    }

    if (idxExisting >= 0) {
      clients[idxExisting] = { ...clients[idxExisting], ...localClient };
    } else {
      localClient.id = localClient.id || `c-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      clients.push(localClient);
    }
    await AsyncStorage.setItem('clients', JSON.stringify(clients));
    showToast('💾 Client enregistré (local)');
  } catch (error) {
    console.error('Erreur de sauvegarde locale :', error);
    return showToast('❌ Échec sauvegarde locale');
  }

  // 2) ☁️ Push serveur (inclut consent)
  try {
    const licenceId = licenceIdRef.current || await getStableLicenceId();
    licenceIdRef.current = licenceId;
    if (!licenceId) { console.warn('LicenceId introuvable'); return; }

    const serverClient = toServerClient(
      { ...localClient, journ30, journ60, journ90, mens6, mens12 },
      localClient.id
    );

    const resp = await fetch(`${SERVER_BASE}/api/clients/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenceId, clients: [serverClient] }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      console.error('Push serveur KO:', resp.status, t);
      return showToast('⚠️ Synchro serveur échouée');
    }

    // ✅ Mise à jour locale par id UNIQUEMENT (surtout pas par téléphone)
    const data2 = await AsyncStorage.getItem('clients');
    let clients2: any[] = data2 ? JSON.parse(data2) : [];
    const j = clients2.findIndex((c) => c.id === serverClient.id);
    if (j >= 0) {
      clients2[j].id = serverClient.id;
      clients2[j].updatedAt = serverClient.updatedAt;
      await AsyncStorage.setItem('clients', JSON.stringify(clients2));
    }
    showToast('☁️ Synchro serveur OK');
  } catch (e) {
    console.error('Synchro serveur erreur:', e);
    showToast('⚠️ Pas de réseau / synchro différée');
  }
}, [
  telephone, nom, prenom, email, dateNaissance,
  lunettes, journ30, journ60, journ90, mens6, mens12,
  consentMarketing, consentService, client, mode, showToast, selectedExistingId
]);


  /* =========================
   * Envoi SMS (transactionnel)
   * ========================= */

  const buildMessageFromTemplate = (template: string) => {
    let msg = template || 'Bonjour, votre opticien vous contacte.';
    if (prenom) msg = msg.replace('{prenom}', prenom);
    if (nom) msg = msg.replace('{nom}', nom);
    return msg.replace(/\s*\{prenom\}\s*/g, '').replace(/\s*\{nom\}\s*/g, '').replace(/\s+/g, ' ').trim();
  };

  const sendTransactionalSMS = useCallback(async (phone: string, body: string) => {
    const phoneNumber = sanitizePhone(phone);
    if (!isPhone10(phoneNumber)) { showToast('❌ Numéro invalide'); return false; }
    const message = (body || '').trim();
    if (!message) { showToast('❌ Message vide'); return false; }

    const id = licenceIdRef.current || await getStableLicenceId();
    licenceIdRef.current = id;
    if (!id) { showToast('❌ Licence introuvable'); return false; }

    setSending(true);
    setSendError(null);
    setSendStep('prep');

    try {
      setSendStep('send');
      const response = await fetch(`${SERVER_BASE}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, message, licenceId: id }),
      });

      const data = await response.json().catch(() => ({} as any));
      if (response.ok && (data?.success ?? true)) {
        setSendStep('done');
        showToast('📨 SMS envoyé');
        setTimeout(() => setSending(false), 900);
        return true;
      }

      const errMsg =
        data?.error ||
        (response.status === 403 ? 'Licence inactive ou crédits insuffisants.' : 'Échec de l’envoi.');
      setSendError(errMsg);
      setSendStep('error');
      return false;
    } catch {
      setSendError("Impossible d'envoyer le SMS (réseau).");
      setSendStep('error');
      return false;
    }
  }, [showToast]);

  const logMessageSend = useCallback(async (templateKey: string) => {
    try {
      const data = await AsyncStorage.getItem('clients');
      let clients: any[] = data ? JSON.parse(data) : [];
      const tel = sanitizePhone(telephone.trim());

      // on privilégie l'id sélectionné (ou celui du client passé en param)
      const idPref = selectedExistingId || (client as any)?.id;
      let idx = -1;
      if (idPref) {
        idx = clients.findIndex((c) => c.id === idPref);
      } else {
        // sinon, seulement si un UNIQUE client possède ce numéro
        const matches = clients
          .map((c, i) => ({ i, tel: sanitizePhone(c.telephone) }))
          .filter(x => x.tel === tel);
        if (matches.length === 1) idx = matches[0].i;
      }

      if (idx >= 0) {
        const iso = new Date().toISOString();
        clients[idx].messagesEnvoyes = Array.isArray(clients[idx].messagesEnvoyes)
          ? clients[idx].messagesEnvoyes
          : [];
        clients[idx].messagesEnvoyes.push({ type: templateKey, date: iso });
        await AsyncStorage.setItem('clients', JSON.stringify(clients));
      }
    } catch {}
  }, [telephone, selectedExistingId, client]);

  const sendTemplate = useCallback(async (templateKey: 'Lunettes' | 'SAV' | 'Lentilles' | 'Commande') => {
    if (!consentService) { showToast('⛔ Consentement Service requis'); return; }
    const fromStore = messages[templateKey]?.content;
    const template = fromStore && typeof fromStore === 'string' ? fromStore : DEFAULT_TEMPLATES[templateKey];
    const sig = await getSignatureFromSettings();
    const finalMessage = appendSignature(buildMessageFromTemplate(template), sig);
    const ok = await sendTransactionalSMS(telephone.trim(), finalMessage);
    if (ok) await logMessageSend(templateKey);
  }, [messages, consentService, telephone, buildMessageFromTemplate, sendTransactionalSMS, logMessageSend, showToast]);

  const sendCustom = useCallback(async () => {
    if (!consentService) { showToast('⛔ Consentement Service requis'); return; }
    const sig = await getSignatureFromSettings();
    const finalMessage = appendSignature(buildMessageFromTemplate(customText), sig);
    setSending(true); setSendStep('prep'); setSendError(null);
    const ok = await sendTransactionalSMS(telephone.trim(), finalMessage);
    if (ok) { await logMessageSend('Personnalisé'); setShowCustomModal(false); }
  }, [consentService, customText, telephone, buildMessageFromTemplate, sendTransactionalSMS, logMessageSend, showToast]);

  const handleExpressSMS = useCallback(() => {
    if (!consentService) {
      Alert.alert('Consentement requis', 'Activez “Service (commande prête, SAV…)” pour envoyer un SMS.');
      return;
    }
    const tel = sanitizePhone(telephone.trim());
    if (!tel) return showToast('☎ Veuillez saisir un numéro');
    if (!isPhone10(tel)) return showToast('❌ Téléphone invalide');
    setShowSMSModal(true);
  }, [consentService, telephone, showToast]);

  /* =========================
   * UI
   * ========================= */

  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, i) => {
    const v = String(i + 1).padStart(2, '0');
    return { value: v, label: v };
  }), []);
  const monthOptions = useMemo(() =>
    ([
      ['01', 'Jan.'], ['02', 'Fév.'], ['03', 'Mars'], ['04', 'Avr.'], ['05', 'Mai'], ['06', 'Juin'],
      ['07', 'Juil.'], ['08', 'Août'], ['09', 'Sept.'], ['10', 'Oct.'], ['11', 'Nov.'], ['12', 'Déc.'],
    ] as const).map(([v, l]) => ({ value: v, label: `${v} — ${l}` })), []);
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 1900 + 1 }, (_, i) => {
      const y = String(currentYear - i);
      return { value: y, label: y };
    });
  }, []);
  const pickerList =
    pickerOpen === 'day' ? dayOptions :
    pickerOpen === 'month' ? monthOptions :
    pickerOpen === 'year' ? yearOptions : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Téléphone *</Text>
      <View style={{ position: 'relative', zIndex: 50 }}>
        <TextInput
          style={styles.input}
          keyboardType={Platform.OS === 'web' ? 'text' : 'phone-pad'}
          value={telephone}
          onChangeText={handlePhoneChange}
          placeholder="0601020304"
          placeholderTextColor="#777"
        />
        {/* SUGGESTIONS */}
        {showSug && (
          <View style={styles.sugPanel}>
            {loadingSug && <Text style={styles.sugHint}>Recherche…</Text>}
            {!loadingSug && suggestions.length === 0 && (
              <Text style={styles.sugHint}>Aucun dossier trouvé</Text>
            )}

            <ScrollView style={{ maxHeight: 260 }}>
              {suggestions.slice(0, 20).map((c, idx) => {
                const p = sanitizePhone((c.phone as any) || (c.telephone as any) || '');
                return (
                  <TouchableOpacity
                    key={(c as any).id || p || idx}
                    style={styles.sugItem}
                    onPress={() => selectSuggestion(c)}
                  >
                    <Text style={styles.sugItemTitle}>
                      {(c.prenom || '').toString()} {(c.nom || '').toString()}
                    </Text>
                    <Text style={styles.sugItemSub}>{p || '—'}</Text>
                  </TouchableOpacity>
                );
              })}

              {isPhone10(telephone) && suggestions.some(s => sanitizePhone((s.phone as any) || (s.telephone as any)) === telephone) && (
                <TouchableOpacity
                  style={[styles.sugItem, { backgroundColor: '#0f172a' }]}
                  onPress={() => { setSelectedExistingId(null); setShowSug(false); }}
                >
                  <Text style={[styles.sugItemTitle, { color: '#93c5fd' }]}>Créer un nouveau dossier avec ce numéro</Text>
                  <Text style={styles.sugItemSub}>Ex : enfant / parent de la même famille</Text>
                </TouchableOpacity>
              )}
            </ScrollView>

            <TouchableOpacity style={styles.sugClose} onPress={() => setShowSug(false)}>
              <Text style={{ color: '#9ca3af', fontWeight: '600' }}>Fermer</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.smsButton} onPress={handleExpressSMS}>
        <Text style={styles.buttonText}>📤 Envoi express (cocher “Service”)</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Nom</Text>
      <TextInput style={styles.input} value={nom} onChangeText={setNom} />

      <Text style={styles.label}>Prénom</Text>
      <TextInput style={styles.input} value={prenom} onChangeText={setPrenom} />

      <Text style={styles.label}>Date de naissance</Text>
      <View style={styles.dobRow}>
        <TouchableOpacity style={styles.dobSelect} onPress={() => setPickerOpen('day')}>
          <Text style={styles.dobSelectText}>{bDay || 'JJ'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dobSelect} onPress={() => setPickerOpen('month')}>
          <Text style={styles.dobSelectText}>{bMonth || 'MM'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dobSelect} onPress={() => setPickerOpen('year')}>
          <Text style={styles.dobSelectText}>{bYear || 'AAAA'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        keyboardType={Platform.OS === 'web' ? 'text' : 'email-address'}
        value={email}
        onChangeText={setEmail}
      />

      {/* Consentements */}
      <Text style={[styles.subLabel, { marginTop: 20 }]}>Consentements SMS</Text>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setConsentService)}>
        <Text style={styles.checkboxText}>{consentService ? '☑' : '☐'} Service (commande prête, SAV…)</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setConsentMarketing)}>
        <Text style={styles.checkboxText}>{consentMarketing ? '☑' : '☐'} Marketing (promos / relances)</Text>
      </TouchableOpacity>

      {/* Produits */}
      <Text style={styles.label}>Produits :</Text>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setLunettes)}>
        <Text style={styles.checkboxText}>{lunettes ? '☑' : '☐'} Lunettes</Text>
      </TouchableOpacity>

      <Text style={styles.subLabel}>Lentilles journalières :</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn30)}>
          <Text style={styles.checkboxText}>{journ30 ? '☑' : '☐'} 30j</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn60)}>
          <Text style={styles.checkboxText}>{journ60 ? '☑' : '☐'} 60j</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn90)}>
          <Text style={styles.checkboxText}>{journ90 ? '☑' : '☐'} 90j</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subLabel}>Lentilles mensuelles :</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setMens6)}>
          <Text style={styles.checkboxText}>{mens6 ? '☑' : '☐'} 6 mois</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setMens12)}>
          <Text style={styles.checkboxText}>{mens12 ? '☑' : '☐'} 1 an</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Enregistrer le client</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.homeButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>

      {/* Modales & progress & toast */}
      <Modal visible={showSMSModal} transparent animationType="fade" onRequestClose={() => setShowSMSModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Type de message :</Text>
            {(['Lunettes','SAV','Lentilles','Commande'] as const).map((label) => (
              <TouchableOpacity
                key={label}
                style={styles.modalButton}
                onPress={() => {
                  setShowSMSModal(false);
                  setSending(true); setSendStep('prep'); setSendError(null);
                  setTimeout(() => sendTemplate(label), 60);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.modalButtonText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.modalButton, { marginTop: 8 }]}
              onPress={() => { setShowSMSModal(false); setCustomText(''); setTimeout(() => setShowCustomModal(true), 50); }}
            >
              <Text style={styles.modalButtonText}>Personnalisé</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSMSModal(false)}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showCustomModal} transparent animationType="fade" onRequestClose={() => setShowCustomModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Message personnalisé</Text>
            <Text style={[styles.modalSubtitle, { marginBottom: 6 }]}>Placeholders: {'{prenom}'} et {'{nom}'}.</Text>
            <TextInput
              style={[styles.input, { width: '100%' }]}
              value={customText}
              onChangeText={setCustomText}
              placeholder="Tapez votre message…"
              placeholderTextColor="#aaa"
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.modalActionBtn, { backgroundColor: '#28a745', flex: 1 }]} onPress={sendCustom}>
                <Text style={styles.modalActionText}>Envoyer</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setShowCustomModal(false)}>
              <Text style={[styles.modalCancel, { marginTop: 10 }]}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={pickerOpen !== null} transparent animationType="fade" onRequestClose={() => setPickerOpen(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.pickerCard}>
            <Text style={styles.modalTitle}>
              {pickerOpen === 'day' ? 'Sélectionner le jour' : pickerOpen === 'month' ? 'Sélectionner le mois' : 'Sélectionner l’année'}
            </Text>
            <ScrollView style={{ maxHeight: 300, alignSelf: 'stretch' }}>
              {pickerList.map((opt: any) => (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.pickerItem}
                  onPress={() => {
                    if (pickerOpen === 'day') setBDay(opt.value);
                    if (pickerOpen === 'month') setBMonth(opt.value);
                    if (pickerOpen === 'year') setBYear(opt.value);
                    setPickerOpen(null);
                  }}
                >
                  <Text style={styles.pickerItemText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setPickerOpen(null)}>
              <Text style={[styles.modalCancel, { marginTop: 8 }]}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={sending} transparent animationType="fade" onRequestClose={() => { if (sendStep !== 'send') setSending(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Envoi du SMS…</Text>
            {sendStep !== 'done' && sendStep !== 'error' && <ActivityIndicator size="large" color="#fff" />}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.progressLine}>{sendStep === 'prep' ? '• Préparation…' : '✓ Préparation'}</Text>
              <Text style={styles.progressLine}>
                {sendStep === 'send' ? '• Envoi au serveur…' : (sendStep === 'prep' ? '• Envoi au serveur' : '✓ Envoi au serveur')}
              </Text>
              {sendStep === 'done' && <Text style={styles.progressOk}>✓ Terminé</Text>}
              {sendStep === 'error' && <Text style={styles.progressErr}>✗ {sendError || 'Erreur inconnue'}</Text>}
            </View>
            {sendStep === 'error' && (
              <TouchableOpacity
                style={[styles.modalActionBtn, { backgroundColor: '#ff3b30', marginTop: 12 }]}
                onPress={() => setSending(false)}
              >
                <Text style={styles.modalActionText}>Fermer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {toast.visible && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/* =========================
 * Styles
 * ========================= */

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#000', flexGrow: 1 },
  label: { fontWeight: 'bold', marginTop: 16, color: '#fff' },
  subLabel: { marginTop: 12, fontWeight: '600', color: '#ccc' },
  input: {
    borderWidth: 1, borderColor: '#555', borderRadius: 6,
    padding: 10, marginTop: 4, color: '#fff', backgroundColor: '#111',
  },

  // SUGGESTIONS
  sugPanel: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingVertical: 8,
    zIndex: 999,
    elevation: 12,
  },
  sugHint: { color: '#9ca3af', textAlign: 'center', paddingVertical: 8 },
  sugItem: { paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#374151' },
  sugItemTitle: { color: '#e5e7eb', fontWeight: '700' },
  sugItemSub: { color: '#9ca3af', marginTop: 2 },
  sugClose: {
    alignSelf: 'center',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#0b0b0b',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#333',
  },

  // Date of birth selects
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dobSelect: {
    flex: 1, borderWidth: 1, borderColor: '#555', borderRadius: 6,
    paddingVertical: 10, alignItems: 'center', backgroundColor: '#111',
  },
  dobSelectText: { color: '#fff', fontWeight: '600' },

  checkbox: { marginTop: 10 },
  checkboxText: { color: '#fff', fontSize: 16 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
  checkboxInline: { paddingVertical: 6 },

  button: {
    marginTop: 24, backgroundColor: '#007AFF', padding: 14,
    borderRadius: 10, alignItems: 'center',
  },
  smsButton: {
    marginTop: 12, backgroundColor: '#28a745', padding: 14,
    borderRadius: 10, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  homeButton: {
    marginTop: 30, backgroundColor: '#1a1a1a', padding: 14,
    borderRadius: 10, alignItems: 'center',
  },
  homeButtonText: { color: '#00BFFF', fontWeight: '600', fontSize: 16 },

  // Modals
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalContent: { backgroundColor: '#222', padding: 24, borderRadius: 12, width: '85%', alignItems: 'center' },
  modalTitle: { color: '#fff', fontWeight: 'bold', fontSize: 16, marginBottom: 6 },
  modalSubtitle: { color: '#ddd', marginBottom: 8 },
  modalButton: { paddingVertical: 12, width: '100%', alignItems: 'center' },
  modalButtonText: { color: '#fff', fontSize: 16 },
  modalCancel: { marginTop: 10, color: '#ff5a5f', fontWeight: '600' },

  modalActionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  modalActionText: { color: '#fff', fontWeight: '700' },

  // Picker modal
  pickerCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '80%', alignItems: 'center' },
  pickerItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333', alignItems: 'center' },
  pickerItemText: { color: '#fff', fontSize: 16 },

  // Progress card
  progressCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '80%', alignItems: 'center' },
  progressTitle: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 10 },
  progressLine: { color: '#ddd', marginTop: 2 },
  progressOk: { color: '#3ddc84', marginTop: 6, fontWeight: '700' },
  progressErr: { color: '#ff6b6b', marginTop: 6, fontWeight: '700' },

  // Toast
  toast: {
    position: 'absolute', left: 20, right: 20, bottom: 30,
    backgroundColor: '#1f2937', paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, borderColor: '#374151', alignItems: 'center',
  },
  toastText: { color: '#fff', fontWeight: '600' },
});

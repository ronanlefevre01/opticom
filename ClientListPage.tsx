// ClientListPage.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, ActivityIndicator, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Client, SMSCategory } from './types';
import { NavigationProps } from './navigationTypes';
import API_BASE from './src/config/api';

const SEND_SMS_ENDPOINT = `${API_BASE}/send-sms`;

/* ------------ helpers ------------- */
const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};
const isPhone10 = (p: string) => /^\d{10}$/.test(p);

const getLicenceFromStorage = async (): Promise<{ licenceId: string | null; cle: string | null }> => {
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

/** Résout un licenceId fiable (si on n’a que la clé) */
const resolveLicenceId = async (): Promise<string | null> => {
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
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) continue;
      const data = JSON.parse(text);
      const id = data?.licence?.id || data?.id;
      if (id) return String(id);
    } catch {}
  }
  return null;
};

const getSignatureFromSettings = async (): Promise<string> => {
  try {
    const licStr = await AsyncStorage.getItem('licence');
    if (licStr) {
      const lic = JSON.parse(licStr);
      if (typeof lic?.signature === 'string' && lic.signature.trim().length > 0) {
        return lic.signature.trim();
      }
    }
    const localSig = await AsyncStorage.getItem('signature');
    return (localSig || '').trim();
  } catch {
    return '';
  }
};

const appendSignature = (msg: string, sig: string) => {
  const m = (msg || '').trim();
  const s = (sig || '').trim();
  if (!s) return m;
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
  if (norm(m).endsWith(norm(s)) || norm(m).includes(norm(' — ' + s))) return m;
  const needsSpace = /[.!?]$/.test(m);
  const sep = needsSpace ? ' ' : ' — ';
  return `${m}${sep}${s}`;
};

/* confirm cross-platform (Web/Native) */
const confirmAsync = (title: string, message: string, okText = 'Supprimer') =>
  new Promise<boolean>((resolve) => {
    if (Platform.OS === 'web') {
      // @ts-ignore web only
      resolve(window.confirm(`${title}\n\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, style: 'destructive', onPress: () => resolve(true) },
      ]);
    }
  });

const fetchCreditsFromServer = async (licenceId: string): Promise<number | null> => {
  const urls = [
    `${API_BASE}/licence/credits?licenceId=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/licence-credits?licenceId=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/credits?licenceId=${encodeURIComponent(licenceId)}`,
  ];
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}: ${text}`); continue; }
      let data: any = {};
      try { data = JSON.parse(text); } catch { continue; }
      const credits = data?.credits ?? data?.remaining ?? data?.solde ?? (typeof data === 'number' ? data : null);
      if (typeof credits === 'number') return credits;
    } catch (e) { lastErr = e; }
  }
  console.warn('Credits endpoint unavailable:', lastErr?.message || lastErr);
  return null;
};

const FILTER_TYPES: (SMSCategory | 'Tous')[] = ['Tous', 'Lunettes', 'Lentilles', 'SAV', 'Commande'];

const DEFAULT_TEMPLATES: Record<SMSCategory, string> = {
  Lunettes:  'Bonjour {prenom} {nom}, vos lunettes sont prêtes. À bientôt !',
  SAV:       'Bonjour {prenom} {nom}, votre SAV est terminé, vous pouvez venir le récupérer.',
  Lentilles: 'Bonjour {prenom} {nom}, vos lentilles sont disponibles en magasin.',
  Commande:  'Bonjour {prenom} {nom}, votre commande est arrivée !',
};

/** ---- parsing & mapping clients serveur -> local ---- */
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

/** Merge serveur + local par téléphone (on garde l’historique local) */
const mergeLocalWithServer = (local: Client[], server: Client[]) => {
  const byPhone = new Map<string, Client>();
  for (const c of server) byPhone.set(sanitizePhone(c.telephone), c);

  const merged: Client[] = [];

  // Inject serveur, en fusionnant historique depuis local
  for (const s of server) {
    const key = sanitizePhone(s.telephone);
    const l = local.find((x) => sanitizePhone(x.telephone) === key);
    if (l && Array.isArray(l.messagesEnvoyes) && l.messagesEnvoyes.length) {
      const seen = new Set((Array.isArray(s.messagesEnvoyes) ? s.messagesEnvoyes : []).map((m: any) => `${m.type}|${m.date}`));
      const out = Array.isArray(s.messagesEnvoyes) ? [...s.messagesEnvoyes] : [];
      for (const m of l.messagesEnvoyes) {
        const id = `${m.type}|${m.date}`;
        if (!seen.has(id)) out.push(m);
      }
      merged.push({ ...s, messagesEnvoyes: out });
    } else {
      merged.push(s);
    }
  }

  // Ajoute locaux “non présents serveur”
  for (const l of local) {
    const key = sanitizePhone(l.telephone);
    if (!byPhone.has(key)) merged.push(l);
  }

  return merged;
};

/** GET clients depuis serveur (avec fallbacks d’URL) */
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
      if (!Array.isArray(items)) continue;
      return items.map(serverToLocalClient);
    } catch {}
  }
  return null;
};

/** ---- Historique SMS serveur ---- */
type ServerSmsItem = { date: string; type: string; numero: string; emetteur?: string; textHash?: string };

const fetchSmsHistory = async (licenceId: string): Promise<ServerSmsItem[]> => {
  const urls = [
    `${API_BASE}/api/licence/sms-history?licenceId=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/licence/sms-history?licenceId=${encodeURIComponent(licenceId)}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url);
      const txt = await r.text();
      if (!r.ok) continue;
      const data = JSON.parse(txt);
      const items: ServerSmsItem[] = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      return items;
    } catch {}
  }
  return [];
};

const labelFromType = (t: string) => {
  if (t === 'marketing') return 'Marketing';
  if (t === 'transactional') return 'Transactionnel';
  if (t === 'auto-anniv') return 'Anniv auto';
  if (t === 'auto-renew') return 'Renouvellement auto';
  return 'SMS';
};

export default function ClientListPage() {
  const navigation = useNavigation<NavigationProps>();

  const [clients, setClients] = useState<Client[]>([]);
  const [filteredClients, setFilteredClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClients, setSelectedClients] = useState<string[]>([]); // téléphones sanitisés
  const [smsFilter, setSmsFilter] = useState<SMSCategory | 'Tous'>('Tous');

  const [customMessages, setCustomMessages] = useState<Record<string, string | { title?: string; content: string }>>({});

  // Progress (même look que AddClientPage)
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<'prep'|'send'|'done'|'error'>('prep');
  const [sendError, setSendError] = useState<string | null>(null);
  const [progressCount, setProgressCount] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [batchSummary, setBatchSummary] = useState<{sent:number; skipped:number; failed:number} | null>(null);

  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [customText, setCustomText] = useState('');

  // ✅ nouvelle modale de choix de type (web-friendly)
  const [typeModalVisible, setTypeModalVisible] = useState(false);

  // 🔄 état sync liste depuis serveur
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Chargement local + synchro serveur au montage
  useEffect(() => {
    const loadData = async () => {
      const clientData = await AsyncStorage.getItem('clients');
      const messageData = await AsyncStorage.getItem('messages');
      if (clientData) {
        const parsed: Client[] = JSON.parse(clientData);
        setClients(parsed);
        setFilteredClients(parsed);
      }
      if (messageData) {
        try { setCustomMessages(JSON.parse(messageData)); } catch {}
      }
      // Lance une première synchro
      await syncFromServer();
    };
    loadData();
  }, []);

  // Filtrage recherche / type
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
    setFilteredClients(result);
  }, [searchQuery, smsFilter, clients]);

  const syncFromServer = async () => {
    try {
      setSyncing(true);
      setSyncError(null);

      const licenceId = await resolveLicenceId();
      if (!licenceId) {
        setSyncError('Licence introuvable');
        setSyncing(false);
        return;
      }
      const remote = await fetchClientsFromServer(licenceId);
      if (!remote) {
        setSyncError('Serveur indisponible');
        setSyncing(false);
        return;
      }

      // ➊ Charger l’historique serveur
      const history = await fetchSmsHistory(licenceId);

      // ➋ Indexer par téléphone (sanitisé)
      const byPhone = new Map<string, { date: string; type: string }[]>();
      for (const h of history) {
        const key = sanitizePhone(h.numero || '');
        if (!key) continue;
        if (!byPhone.has(key)) byPhone.set(key, []);
        byPhone.get(key)!.push({ date: h.date, type: labelFromType(h.type) });
      }

      // ➌ Injecter l’historique serveur dans les clients “remote”
      const remoteWithHistory = (remote || []).map(c => {
        const key = sanitizePhone(c.telephone);
        const logs = byPhone.get(key) || [];
        const prev = Array.isArray(c.messagesEnvoyes) ? c.messagesEnvoyes : [];
        // fusion simple (évite doublons par (type|date))
        const seen = new Set(prev.map((m: any) => `${m.type}|${m.date}`));
        const mergedLogs = [...prev];
        for (const m of logs) {
          const id = `${m.type}|${m.date}`;
          if (!seen.has(id)) mergedLogs.push({ type: m.type as any, date: m.date });
        }
        return { ...c, messagesEnvoyes: mergedLogs };
      });

      // ➍ Merger avec le local
      const localStr = await AsyncStorage.getItem('clients');
      const local: Client[] = localStr ? JSON.parse(localStr) : [];
      const merged = mergeLocalWithServer(local, remoteWithHistory);

      await AsyncStorage.setItem('clients', JSON.stringify(merged));
      setClients(merged);
      setFilteredClients(merged);
    } catch (e: any) {
      setSyncError(e?.message || 'Erreur inconnue');
    } finally {
      setSyncing(false);
    }
  };

  const toggleSelect = (rawPhone: string) => {
    const phone = sanitizePhone(rawPhone);
    setSelectedClients((prev) =>
      prev.includes(phone) ? prev.filter((p) => p !== phone) : [...prev, phone]
    );
  };

  /* ---- Supprimer client (ligne) ---- */
  const deleteClient = async (rawPhone: string) => {
    const ok = await confirmAsync('Supprimer ce client ?', 'Cette action est définitive.');
    if (!ok) return;
    const phone = sanitizePhone(rawPhone);
    const updated = clients.filter(c => sanitizePhone(c.telephone) !== phone);
    setClients(updated);
    setFilteredClients(updated);
    setSelectedClients(prev => prev.filter(t => t !== phone));
    await AsyncStorage.setItem('clients', JSON.stringify(updated));
    // (optionnel) appeler une route DELETE côté serveur si disponible
  };

  const resetClientHistory = async (rawPhone: string) => {
    const ok = await confirmAsync('Réinitialiser l’historique ?', 'Effacer l’historique des SMS de ce client ?', 'Réinitialiser');
    if (!ok) return;
    const phone = sanitizePhone(rawPhone);
    const updated = clients.map((client) =>
      sanitizePhone(client.telephone) === phone ? { ...client, messagesEnvoyes: [] } : client
    );
    setClients(updated);
    setFilteredClients(updated);
    await AsyncStorage.setItem('clients', JSON.stringify(updated));
  };

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

  /* --------- Choix type (modale au lieu d'Alert) --------- */
  const openSmsDialog = () => {
    if (selectedClients.length === 0) {
      Alert.alert('Info', 'Sélectionne au moins un client.');
      return;
    }
    setTypeModalVisible(true);
  };

  const sendOne = async ({
    licenceId, cle, phoneNumber, message,
  }: { licenceId: string | null; cle: string | null; phoneNumber: string; message: string; }) => {
    const payload: any = { phoneNumber, message };
    if (licenceId) payload.licenceId = licenceId;
    if (cle) payload.cle = cle;
    const resp = await fetch(SEND_SMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({} as any));
    if (!resp.ok || (data?.success === false)) {
      const err = data?.error || (resp.status === 403 ? 'Consentement/crédits/licence.' : "Échec de l’envoi.");
      throw new Error(err);
    }
    return true;
  };

  const sendBatch = async (category: SMSCategory | '__custom__') => {
    const batch = clients.filter((c) => selectedClients.includes(sanitizePhone(c.telephone)));
    if (batch.length === 0) {
      Alert.alert('Info', 'Sélectionne au moins un client.');
      return;
    }

    const { licenceId, cle } = await getLicenceFromStorage();
    const resolvedId = licenceId || (await resolveLicenceId());
    if (!resolvedId && !cle) {
      Alert.alert('Erreur', 'Licence introuvable.');
      return;
    }

    if (resolvedId) {
      const credits = await fetchCreditsFromServer(resolvedId);
      if (credits !== null && credits < batch.length) {
        Alert.alert('Crédits insuffisants', `Crédits: ${credits}, SMS requis: ${batch.length}.`);
        return;
      }
    }

    const signature = await getSignatureFromSettings();

    setSending(true);
    setTypeModalVisible(false);
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
          await sendOne({ licenceId: resolvedId, cle, phoneNumber: phone, message });

          const idx = updated.findIndex((u) => sanitizePhone(u.telephone) === phone);
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
          console.warn(`Échec SMS ${c.telephone}:`, (e as Error).message);
          failed++;
        } finally {
          setProgressCount((x) => x + 1);
        }
      }

      await AsyncStorage.setItem('clients', JSON.stringify(updated));
      setClients(updated);
      setFilteredClients(updated);
      setSelectedClients([]);

      setBatchSummary({ sent, skipped: skippedConsent, failed });
      setSendStep('done');
      setTimeout(() => setSending(false), 1000);
    } catch (e:any) {
      setSendError(e?.message || 'Erreur inconnue');
      setSendStep('error');
    }
  };

  const renderItem = ({ item }: { item: Client }) => (
    <View style={styles.clientItem}>
      <View style={styles.clientRow}>
        <TouchableOpacity onPress={() => toggleSelect(item.telephone)} style={{ flex: 1 }}>
          <Text style={styles.clientText}>
            {selectedClients.includes(sanitizePhone(item.telephone)) ? '☑ ' : '☐ '}
            {item.prenom} {item.nom} ({item.telephone})
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
          <Text style={styles.editButtonText}>Réinitialiser</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => deleteClient(item.telephone)}
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
              const formatted = `${date.toLocaleDateString()} à ${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
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

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={styles.title}>Clients enregistrés</Text>
        <TouchableOpacity onPress={syncFromServer} style={styles.syncBtn}>
          <Text style={styles.syncBtnText}>{syncing ? '…' : '↻ Sync'}</Text>
        </TouchableOpacity>
      </View>

      {syncError ? <Text style={styles.syncError}>⚠ {syncError}</Text> : null}

      <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.homeButtonText}>← Accueil</Text>
      </TouchableOpacity>

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
        keyExtractor={(item) => sanitizePhone(item.telephone)}
        renderItem={renderItem}
      />

      {selectedClients.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <TouchableOpacity style={styles.smsButton} onPress={openSmsDialog}>
            <Text style={styles.smsText}>Envoyer SMS</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modale de choix du type de message */}
      <Modal
        visible={typeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTypeModalVisible(false)}
      >
        <View style={styles.customOverlay}>
          <View style={styles.customCard}>
            <Text style={styles.customTitle}>Type de message</Text>
            {(['Lunettes','SAV','Lentilles','Commande'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={styles.typeBtn}
                onPress={() => sendBatch(t)}
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

      {/* Modale “Personnalisé” */}
      <Modal
        visible={customModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModalVisible(false)}
      >
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
                onPress={() => { setCustomModalVisible(false); setTimeout(() => sendBatch('__custom__'), 60); }}
              >
                <Text style={styles.customBtnText}>Envoyer</Text>
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

      {/* Progress envoi */}
      <Modal visible={sending} transparent animationType="fade" onRequestClose={() => { if (sendStep !== 'send') setSending(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Envoi des SMS…</Text>
            {sendStep !== 'done' && sendStep !== 'error' && <ActivityIndicator size="large" color="#fff" />}
            <View style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={styles.progressLine}>{sendStep === 'prep' ? '• Préparation…' : '✓ Préparation'}</Text>
              <Text style={styles.progressLine}>{sendStep === 'send' ? '• Envoi au serveur…' : (sendStep === 'prep' ? '• Envoi au serveur' : '✓ Envoi au serveur')}</Text>
              <Text style={[styles.progressLine, { marginTop: 8 }]}>{progressCount} / {progressTotal}</Text>
              {sendStep === 'done' && batchSummary && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.progressOk}>✓ Terminé</Text>
                  <Text style={styles.progressLine}>Envoyés : {batchSummary.sent}</Text>
                  <Text style={styles.progressLine}>Ignorés (consentement/tél) : {batchSummary.skipped}</Text>
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
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  homeButton: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1a1a1a', borderRadius: 6, marginBottom: 12 },
  homeButtonText: { fontSize: 14, color: '#00BFFF' },
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
  smsButton: { backgroundColor: '#00BFFF', padding: 14, borderRadius: 10, alignItems: 'center' },
  smsText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  // Sync
  syncBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1f2937', borderRadius: 6 },
  syncBtnText: { color: '#cdeafe', fontWeight: '600' },
  syncError: { color: '#ff6b6b', marginTop: 4 },

  // Custom/modal shared styles
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
  modalActionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  modalActionText: { color: '#fff', fontWeight: '700' },
});

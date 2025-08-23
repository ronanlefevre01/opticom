// CampagnePage.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet,
  Modal, TextInput, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { consumeCredits } from './CreditManager';
import { Client } from './types';
import API_BASE from './src/config/api';

/* ===================== ENDPOINTS ===================== */
const SEND_SMS_ENDPOINT = `${API_BASE}/send-sms`;

/* ===================== Helpers ===================== */
const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};
const isPhone10 = (p: string) => /^\d{10}$/.test(p);

const normalizeSender = (raw?: string) => {
  let s = String(raw ?? 'OptiCOM').replace(/[^a-zA-Z0-9]/g, '');
  if (s.length < 3) s = 'OptiCOM';
  if (s.length > 11) s = s.slice(0, 11);
  return s;
};

const getSenderLabelFromSettings = async (): Promise<string> => {
  try {
    const storedLicence = await AsyncStorage.getItem('licence');
    if (storedLicence) {
      const parsed = JSON.parse(storedLicence);
      const candidate =
        parsed?.libelleExpediteur || parsed?.opticien?.enseigne || parsed?.nom || 'OptiCOM';
      return normalizeSender(candidate);
    }
  } catch {}
  return normalizeSender('OptiCOM');
};

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

// ===== Helpers (ajoute ceci dans CampagnePage.tsx) =====
const getRawPhone = (c: any): string => {
  const candidates: any[] = [
    c?.telephone, c?.phoneNumber, c?.phone, c?.mobile, c?.portable, c?.gsm,
    c?.tel, c?.tel1, c?.tel2, c?.numero, c?.num, c?.numTel, c?.numTelephone,
    c?.contact?.phone, c?.contact?.mobile,
    c?.coordonnees?.telephone, c?.coordonnees?.mobile,
  ].filter(Boolean);

  for (const v of candidates) {
    const s = String(v);
    const m = s.match(/\+33\s?[1-9](?:[\s.-]?\d){8}|0[1-9](?:[\s.-]?\d){8}/);
    if (m) return m[0];
  }
  try {
    const flat = JSON.stringify(c);
    const m = flat.match(/\+33\s?[1-9](?:[\s.-]?\d){8}|0[1-9](?:[\s.-]?\d){8}/);
    if (m) return m[0];
  } catch {}
  return '';
};

const toE164FR = (raw: string): string | null => {
  const s = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\+33[1-9]\d{8}$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (/^0[1-9]\d{8}$/.test(d)) return '+33' + d.slice(1);
  if (/^33[1-9]\d{8}$/.test(d)) return '+' + d;
  return null;
};


const ensureStopClause = (m: string) =>
  /stop\s+au\s+36111/i.test(m) ? m : `${m} STOP au 36111`;


/* ===================== Crédit (server pre-check) ===================== */
const fetchCreditsFromServer = async (licenceId: string): Promise<number | null> => {
  const urls = [
    `${API_BASE}/api/licence?id=${encodeURIComponent(licenceId)}`,
    `${API_BASE}/licence?id=${encodeURIComponent(licenceId)}`, // fallback
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      const txt = await res.text();
      if (!res.ok) continue;
      const data = JSON.parse(txt);
      const lic = data?.licence ?? data;
      if (lic && typeof lic.credits === 'number') return lic.credits;
      if (lic?.abonnement === 'Illimitée') return Number.MAX_SAFE_INTEGER; // on traite comme "illimité"
    } catch {}
  }
  console.warn('Credits endpoint unavailable');
  return null;
};



/* ===================== HTTP send ===================== */
const sendSMS = async ({
  phoneNumber, message, emetteur, licenceId, cle, isPromo, category, marketingConsent,
}: {
  phoneNumber: string;
  message: string;
  emetteur?: string;
  licenceId: string | null;
  cle: string | null;
  isPromo: boolean;
  category?: string;
  marketingConsent?: boolean;
}) => {
  const endpoint = isPromo ? `${API_BASE}/send-promotional` : `${API_BASE}/send-sms`;

  const payload: any = {
    phoneNumber,
    message,
    categorie: category,
    category,
    ...(emetteur ? { emetteur } : {}),
    ...(licenceId ? { licenceId } : {}),
    ...(cle ? { cle } : {}),
    ...(isPromo ? { marketingConsent: marketingConsent === true } : {}),
  };

  // log utile pendant le debug
  console.log('[SEND]', { endpoint, payload });

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e:any) {
    // ex: CORS sur Web, DNS, offline…
    throw new Error(`NETWORK_ERROR: ${e?.message || e}`);
  }

  const text = await resp.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}

  if (!resp.ok || data?.success === false) {
    throw new Error(data?.error || `HTTP_${resp.status}: ${text}`);
  }
  return true;
};



/* ===================== Modèles ===================== */
const campagnes = [
  { id: 'anniversaire', titre: '🎂 Anniversaire',
    messageParDefaut: "Bonjour {prenom}, l'équipe de votre opticien vous souhaite un joyeux anniversaire ! Profitez de -20% sur vos lunettes jusqu'à la fin du mois." },
  { id: 'lentilles', titre: '👁️ Lentilles',
    messageParDefaut: "Bonjour {prenom}, c'est bientôt le moment de renouveler vos lentilles. Profitez de -15% en commandant aujourd'hui !" },
  { id: 'noel', titre: '🎄 Noël',
    messageParDefaut: "Bonjour {prenom}, pour Noël, profitez de -25% sur une deuxième paire. Offre valable jusqu'au 24 décembre." },
  { id: 'soldes_ete', titre: "☀️ Soldes d'été",
    messageParDefaut: "Bonjour {prenom}, les soldes d'été commencent ! Jusqu'à -50% sur une sélection de montures. Venez vite en magasin !" },
  { id: 'soldes_hiver', titre: "❄️ Soldes d'hiver",
    messageParDefaut: "Bonjour {prenom}, ne manquez pas les soldes d'hiver : jusqu'à -40% sur vos lunettes préférées !" },
  { id: 'rentree', titre: '🎓 Rentrée scolaire',
    messageParDefaut: "Bonjour {prenom}, c'est la rentrée ! Offrez à vos enfants des lunettes stylées avec -20% sur les montures enfant." },
];

const relanceLentilles = [
  { id: 'jour_30',  titre: '📅 30 jours (Journalières)', messageParDefaut: 'Bonjour {prenom}, pensez à renouveler vos lentilles journalières. -10% cette semaine chez votre opticien !' },
  { id: 'jour_60',  titre: '📅 60 jours (Journalières)', messageParDefaut: 'Bonjour {prenom}, vos lentilles journalières sont bientôt terminées. Pensez à les renouveler.' },
  { id: 'jour_90',  titre: '📅 90 jours (Journalières)', messageParDefaut: 'Bonjour {prenom}, vos lentilles journalières datent d’il y a 3 mois. C’est le moment de faire le plein !' },
  { id: 'mensuel_6',  titre: '📅 6 mois (Mensuelles)',  messageParDefaut: 'Bonjour {prenom}, vos lentilles mensuelles arrivent à échéance. Pensez à les renouveler.' },
  { id: 'mensuel_12', titre: '📅 1 an (Mensuelles)',     messageParDefaut: 'Bonjour {prenom}, vos lentilles mensuelles datent d’un an. Pensez à les renouveler.' },
];

const campagnesSaisonnieres = [
  { id: 'ete', titre: '☀️ Soldes d’été', messageParDefaut: 'Bonjour {prenom}, les soldes d’été sont là ! Jusqu’à -50% sur nos montures solaires. Profitez-en vite !', type: 'promotionnelle' },
  { id: 'hiver', titre: '❄️ Soldes d’hiver', messageParDefaut: 'Bonjour {prenom}, les soldes d’hiver continuent ! Jusqu’à -40% sur une sélection de lunettes.', type: 'promotionnelle' },
  { id: 'fete_meres', titre: '👩‍👧‍👦 Fête des Mères', messageParDefaut: 'Bonjour {prenom}, pour la fête des mères, offrez une paire élégante avec -25%.', type: 'promotionnelle' },
  { id: 'fete_peres', titre: '👨‍👧‍👦 Fête des Pères', messageParDefaut: 'Bonjour {prenom}, pour la fête des pères, -25% sur les solaires homme ce week-end seulement !', type: 'promotionnelle' },
  { id: 'saintvalentin', titre: '❤️ Saint-Valentin', messageParDefaut: 'Bonjour {prenom}, pour la Saint-Valentin, -20% sur une deuxième paire à offrir à votre moitié !', type: 'promotionnelle' },
  { id: 'noel_saison', titre: '🎄 Noël', messageParDefaut: 'Bonjour {prenom}, offrez (ou offrez-vous) une nouvelle monture à -30% avant le 24 décembre !', type: 'promotionnelle' },
  { id: 'rentree_scolaire', titre: '🎒 Rentrée scolaire', messageParDefaut: 'Bonjour {prenom}, pour la rentrée, profitez de -20% sur les montures enfants.', type: 'promotionnelle' },
];

type MessagesDict = Record<string, { title?: string; content: string }>;
type SelectedMap  = Record<string, boolean>;

export default function CampagnePage() {
  const navigation = useNavigation();
  const [messages, setMessages] = useState<MessagesDict>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCampagneId, setSelectedCampagneId] = useState<string | null>(null);
  const [selectedClients, setSelectedClients] = useState<SelectedMap>({});
  const [editMessageVisible, setEditMessageVisible] = useState(false);
  const [editedMessage, setEditedMessage] = useState('');
  const [activeFilter, setActiveFilter] = useState<'TOUS' | '6M' | '2A' | 'PLUS2A'>('TOUS');

  // Progress modal (même UX qu’AddClientPage)
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<'prep'|'send'|'done'|'error'>('prep');
  const [sendError, setSendError] = useState<string | null>(null);
  const [progressCount, setProgressCount] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [batchSummary, setBatchSummary] = useState<{sent:number; skipped:number; failed:number} | null>(null);

  // ✅ Preview modal state (fix for web & native)
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewText, setPreviewText] = useState('');

  useEffect(() => {
    const loadData = async () => {
      const msgData = await AsyncStorage.getItem('messages');
      if (msgData) { try { setMessages(JSON.parse(msgData)); } catch {} }
      const clientData = await AsyncStorage.getItem('clients');
      if (clientData) { try { setClients(JSON.parse(clientData)); } catch {} }
    };
    loadData();
  }, []);

  const getMessageForClient = (template: string, client: Client) =>
    (template || '')
      .replace('{prenom}', client.prenom || '')
      .replace('{nom}', client.nom || '')
      .replace(/\s*\{prenom\}\s*/g, '')
      .replace(/\s*\{nom\}\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const getMessageById = (id: string) => {
    const all = [...campagnes, ...relanceLentilles, ...campagnesSaisonnieres];
    const found = all.find((c) => c.id === id);
    return messages[id]?.content || found?.messageParDefaut || '';
  };

  // 🔧 NEW: robust preview using a modal (not Alert)
  const handlePreview = async (id: string) => {
    const raw = getMessageById(id);
    const sig = await getSignatureFromSettings();
    // If it's a promo campaign, show STOP in preview too
    const isPromo = campagnesSaisonnieres.some(c => c.id === id && c.type === 'promotionnelle');
    let text = raw.replace('{prenom}', 'Jean').replace('{nom}', 'Dupont');
    text = appendSignature(text, sig);
    if (isPromo) text = ensureStopClause(text);
    setPreviewText(text || '— (message vide) —');
    setPreviewVisible(true);
  };

  const handleParametrage = (id: string) => {
    const msg = getMessageById(id);
    setEditedMessage(msg);
    setSelectedCampagneId(id);
    setEditMessageVisible(true);
  };

  const saveEditedMessage = async () => {
    if (!selectedCampagneId) return;
    const updated: MessagesDict = {
      ...messages,
      [selectedCampagneId]: { ...(messages[selectedCampagneId] || {}), content: editedMessage },
    };
    await AsyncStorage.setItem('messages', JSON.stringify(updated));
    setMessages(updated);
    setEditMessageVisible(false);
  };

  const handleEnvoyer = (id: string) => {
    setSelectedCampagneId(id);
    setModalVisible(true);
  };

  // Filtrage “fraîcheur”
  const now = new Date();
  const filteredClients = clients.filter((client) => {
    const dateStr =
      (client as any).premierMessage ||
      (client as any).datePremierMessage ||
      (client as any).createdAt ||
      (client as any).date;
    if (!dateStr) return true;
    const dateMessage = new Date(dateStr);
    if (isNaN(dateMessage.getTime())) return true;
    const diffMois = (now.getTime() - dateMessage.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    switch (activeFilter) {
      case '6M':     return diffMois <= 6;
      case '2A':     return diffMois <= 24;
      case 'PLUS2A': return diffMois > 24;
      default:       return true;
    }
  });

  const confirmerEnvoi = async () => {
  if (!selectedCampagneId) return;

  const campagne = [...campagnes, ...relanceLentilles, ...campagnesSaisonnieres]
    .find((c) => c.id === selectedCampagneId);

  const messageTemplate = getMessageById(selectedCampagneId);
  const clientsCibles = filteredClients.filter((c) => selectedClients[getClientKey(c)]);

  const { licenceId, cle } = await getLicenceFromStorage();
  if (!licenceId && !cle) {
    Alert.alert('Erreur', 'Licence introuvable.');
    return;
  }

  // Pré-check crédits (optionnel)
  if (licenceId) {
    const creditsActuels = await fetchCreditsFromServer(licenceId);
    if (creditsActuels !== null && creditsActuels < clientsCibles.length) {
      Alert.alert('Crédits insuffisants',
        `Il vous reste ${creditsActuels} crédits, mais ${clientsCibles.length} sont nécessaires.`);
      return;
    }
  }

  const emetteur  = await getSenderLabelFromSettings();
  const signature = await getSignatureFromSettings();
  const isPromo   = (campagne as any)?.type === 'promotionnelle';

  // Reset UI progression
  setProgressCount(0);
  setProgressTotal(clientsCibles.length);
  setBatchSummary(null);
  setSendError(null);
  setSendStep('prep');
  setSending(true);

  let sent = 0, skipped = 0, failed = 0;

  try {
    setSendStep('send');

    for (const client of clientsCibles) {
      const phone = sanitizePhone(client.telephone || '');
      if (!isPhone10(phone)) { skipped++; setProgressCount((p)=>p+1); continue; }

      // Consentements
      const hasMarketing = !!(client as any)?.consentementMarketing
                        || !!(client as any)?.consent?.marketing_sms?.value;
      const hasService   = !!(client as any)?.consent?.service_sms?.value;

      if ((isPromo && !hasMarketing) || (!isPromo && !hasService)) {
        skipped++; setProgressCount((p)=>p+1); continue;
      }

      // Message final
      let messageFinal = (messageTemplate || '')
        .replace('{prenom}', client.prenom || '')
        .replace('{nom}', client.nom || '')
        .replace(/\s*\{prenom\}\s*/g, '')
        .replace(/\s*\{nom\}\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      messageFinal = appendSignature(messageFinal, signature);
      if (isPromo) messageFinal = ensureStopClause(messageFinal);
      if (!messageFinal) { failed++; setProgressCount((p)=>p+1); continue; }

      const e164 = toE164FR(phone);
      if (!e164) { skipped++; setProgressCount((p)=>p+1); continue; }


      try {
  await sendSMS({
    phoneNumber: e164,
    message: messageFinal,
    emetteur,
    licenceId,
    cle,
    isPromo,
    category: selectedCampagneId || (campagne?.id ?? 'autre'),
    marketingConsent: hasMarketing,
  });
  sent++;
} catch (e: any) {
  const msg = String(e?.message ?? '');
  if (msg.includes('ENVOI_INTERDIT_HORAIRES')) {
    Alert.alert(
      'Envoi bloqué',
      'Les envois promotionnels sont autorisés de 08:00 à 20:00 (heure FR).'
    );
  } else if (msg.startsWith('NETWORK_ERROR')) {
    Alert.alert('Problème réseau', msg);
  }
  console.warn(`Échec SMS à ${phone}:`, msg);
  failed++;
} finally {
  setProgressCount((p) => p + 1);
  await new Promise((r) => setTimeout(r, 120));
}

    } // ← fin du for

    if (sent > 0) { try { await consumeCredits(sent); } catch {} }

    setBatchSummary({ sent, skipped, failed });
    setSendStep('done');
    setTimeout(() => setSending(false), 1000);
    setModalVisible(false);
  } catch (e:any) {
    setSendError(e?.message || 'Erreur inconnue');
    setSendStep('error');
  }
};


  const getClientKey = (c: Client) => String((c as any).id || c.telephone || '').trim();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🎯 Campagnes SMS</Text>

      <View style={styles.annivBox}>
        <Text style={styles.subTitle}>🎂 Campagne Anniversaire</Text>
        <Text style={styles.description}>SMS automatique ou envoi immédiat.</Text>
        <TouchableOpacity style={styles.button} onPress={() => handlePreview('anniversaire')}>
          <Text style={styles.buttonText}>👁 Prévisualiser</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => handleParametrage('anniversaire')}>
          <Text style={styles.buttonText}>⚙ Modifier le message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => handleEnvoyer('anniversaire')}>
          <Text style={styles.buttonText}>📤 Envoyer maintenant</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.annivBox}>
        <Text style={styles.subTitle}>🔁 Relance Lentilles</Text>
        <Text style={styles.description}>Relances selon la durée de port.</Text>
        {relanceLentilles.map((r) => (
          <View key={r.id} style={{ marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>{r.titre}</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.smallButton} onPress={() => handlePreview(r.id)}>
                <Text style={styles.buttonText}>👁 Prévisualiser</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => handleParametrage(r.id)}>
                <Text style={styles.buttonText}>⚙ Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => handleEnvoyer(r.id)}>
                <Text style={styles.buttonText}>📤 Envoyer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.annivBox}>
        <Text style={styles.subTitle}>📅 Campagnes saisonnières</Text>
        <Text style={styles.description}>Offres spéciales (promo → STOP obligatoire géré automatiquement).</Text>
        {campagnesSaisonnieres.map((c) => (
          <View key={c.id} style={{ marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>{c.titre}</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.smallButton} onPress={() => handlePreview(c.id)}>
                <Text style={styles.buttonText}>👁 Prévisualiser</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => handleParametrage(c.id)}>
                <Text style={styles.buttonText}>⚙ Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={() => handleEnvoyer(c.id)}>
                <Text style={styles.buttonText}>📤 Envoyer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {/* Modal édition message */}
      <Modal visible={editMessageVisible} transparent animationType="slide" onRequestClose={()=>setEditMessageVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 10 }}>
            <Text style={{ fontWeight: 'bold', marginBottom: 10 }}>Modifier le message</Text>
            <TextInput
              value={editedMessage}
              onChangeText={setEditedMessage}
              multiline
              numberOfLines={6}
              style={{ borderColor: '#ccc', borderWidth: 1, borderRadius: 8, padding: 10 }}
            />
            <TouchableOpacity style={[styles.button, { marginTop: 10 }]} onPress={saveEditedMessage}>
              <Text style={styles.buttonText}>💾 Enregistrer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { marginTop: 10, backgroundColor: '#999' }]}
              onPress={() => {
                const def = [...campagnes, ...relanceLentilles, ...campagnesSaisonnieres]
                  .find((c) => c.id === selectedCampagneId)?.messageParDefaut;
                if (def) setEditedMessage(def);
              }}
            >
              <Text style={styles.buttonText}>♻️ Réinitialiser</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TouchableOpacity
        style={[styles.button, { marginTop: 30, backgroundColor: '#333' }]}
        onPress={() => navigation.navigate('Home' as never)}
      >
        <Text style={styles.buttonText}>🏠 Retour à l'accueil</Text>
      </TouchableOpacity>

      {/* Modal sélection clients */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={()=>setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000dd', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 10, maxHeight: '90%' }}>
            <Text style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 10 }}>
              📤 Sélectionner les clients
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, gap: 6 }}>
              {(['TOUS', '6M', '2A', 'PLUS2A'] as const).map((key) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setActiveFilter(key)}
                  style={{
                    padding: 6, borderRadius: 6,
                    backgroundColor: activeFilter === key ? '#007AFF' : '#ccc',
                    flex: 1, alignItems: 'center',
                  }}
                >
                  <Text style={{ color: activeFilter === key ? '#fff' : '#000', fontSize: 12 }}>
                    {key === 'TOUS' ? 'Tous' : key === '6M' ? '< 6 mois' : key === '2A' ? '< 2 ans' : '> 2 ans'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
              <TouchableOpacity
                onPress={() => {
                  const batch: SelectedMap = {};
                  filteredClients.forEach((c) => { batch[getClientKey(c)] = true; });
                  setSelectedClients((prev) => ({ ...prev, ...batch }));
                }}
              >
                <Text style={{ color: '#007AFF', fontWeight: 'bold' }}>✅ Tout sélectionner</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const batch: SelectedMap = {};
                  filteredClients.forEach((c) => { batch[getClientKey(c)] = false; });
                  setSelectedClients((prev) => ({ ...prev, ...batch }));
                }}
              >
                <Text style={{ color: '#FF3B30', fontWeight: 'bold' }}>❌ Tout désélectionner</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 250, marginBottom: 16 }}>
              {filteredClients.map((client, index) => {
                const key = getClientKey(client) || String(index);
                const checked = !!selectedClients[key];
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelectedClients((prev) => ({ ...prev, [key]: !prev[key] }))}
                    style={{
                      paddingVertical: 6, borderBottomColor: '#ddd', borderBottomWidth: 1,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>
                      {client.prenom} {client.nom} — {getRawPhone(client) || '—'}
                    </Text>
                    <Text>{checked ? '✅' : '⬜'}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={[styles.button, { marginTop: 10 }]} onPress={confirmerEnvoi}>
              <Text style={styles.buttonText}>📤 Confirmer l'envoi</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { marginTop: 10, backgroundColor: '#999' }]}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.buttonText}>❌ Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ✅ Preview Modal (works on Web & Native) */}
      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Prévisualisation</Text>
            <ScrollView style={{ maxHeight: 200, alignSelf: 'stretch' }}>
              <Text style={styles.previewText}>{previewText}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalActionBtn, { backgroundColor: '#007AFF', marginTop: 12 }]}
              onPress={() => setPreviewVisible(false)}
            >
              <Text style={styles.modalActionText}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale de progression — même look qu’AddClientPage */}
      <Modal
        visible={sending}
        transparent
        animationType="fade"
        onRequestClose={() => { if (sendStep !== 'send') setSending(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Envoi des SMS…</Text>
            {sendStep !== 'done' && sendStep !== 'error' && <ActivityIndicator size="large" color="#fff" />}
            <View style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={styles.progressLine}>{sendStep === 'prep' ? '• Préparation…' : '✓ Préparation'}</Text>
              <Text style={styles.progressLine}>
                {sendStep === 'send' ? '• Envoi au serveur…' : (sendStep === 'prep' ? '• Envoi au serveur' : '✓ Envoi au serveur')}
              </Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 16 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  subTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  description: { color: '#ccc', marginVertical: 6 },
  annivBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 20 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  button: { marginTop: 10, backgroundColor: '#007AFF', padding: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  smallButton: { flexGrow: 1, backgroundColor: '#333', padding: 10, borderRadius: 6, marginVertical: 4, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // Overlay / cards
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  progressCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '80%', alignItems: 'center' },
  progressTitle: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 10 },
  progressLine: { color: '#ddd', marginTop: 2 },
  progressOk: { color: '#3ddc84', marginTop: 6, fontWeight: '700' },
  progressErr: { color: '#ff6b6b', marginTop: 6, fontWeight: '700' },
  modalActionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  modalActionText: { color: '#fff', fontWeight: '700' },

  // Preview modal
  previewCard: { backgroundColor: '#222', padding: 22, borderRadius: 12, width: '85%', alignItems: 'center' },
  previewTitle: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 10, alignSelf: 'flex-start' },
  previewText: { color: '#fff', fontSize: 15, lineHeight: 22 },
});

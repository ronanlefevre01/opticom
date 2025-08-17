import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Modal,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { consumeCredits } from './CreditManager';
import { Client } from './types';
import API_BASE from './src/config/api';

/* ===================== ENDPOINTS SERVEUR ===================== */
const SEND_SMS_ENDPOINT = `${API_BASE}/send-sms`;

/* ===================== Helpers communs ===================== */
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

const getLicenceIdFromStorage = async (): Promise<string | null> => {
  try {
    const raw = await AsyncStorage.getItem('licence');
    if (!raw) return null;
    const lic = JSON.parse(raw);
    const id = String(lic?.id || lic?.opticien?.id || '').trim();
    return id || null;
  } catch {
    return null;
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

/* ===================== Crédit via serveur ===================== */
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
      const credits =
        data?.credits ?? data?.remaining ?? data?.solde ?? (typeof data === 'number' ? data : null);
      if (typeof credits === 'number') return credits;
    } catch (e) {
      lastErr = e;
    }
  }
  console.warn('Credits endpoint unavailable:', lastErr?.message || lastErr);
  return null;
};

/* ===================== Envoi HTTP ===================== */
const sendTransactionalOrPromoSMS = async ({
  phoneNumber,
  message,
  emetteur,
  licenceId,
}: {
  phoneNumber: string;
  message: string;
  emetteur: string;
  licenceId: string;
}) => {
  const payload = { phoneNumber, message, emetteur, licenceId };
  const resp = await fetch(SEND_SMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok || !data?.success) {
    const err =
      data?.error ||
      (resp.status === 403 ? 'Licence introuvable / crédits insuffisants.' : "Échec de l’envoi.");
    throw new Error(err);
  }
  return data;
};

/* ===================== Modèles ===================== */
const campagnes = [
  { id: 'anniversaire', titre: '🎂 Anniversaire', messageParDefaut:
    "Bonjour {prenom}, l'équipe de votre opticien vous souhaite un joyeux anniversaire ! Profitez de -20% sur vos lunettes jusqu'à la fin du mois.",
    automatique: true },
  { id: 'lentilles', titre: '👁️ Lentilles', messageParDefaut:
    "Bonjour {prenom}, c'est bientôt le moment de renouveler vos lentilles. Profitez de -15% en commandant aujourd'hui !" },
  { id: 'noel', titre: '🎄 Noël', messageParDefaut:
    "Bonjour {prenom}, pour Noël, profitez de -25% sur une deuxième paire. Offre valable jusqu'au 24 décembre." },
  { id: 'soldes_ete', titre: "☀️ Soldes d'été", messageParDefaut:
    "Bonjour {prenom}, les soldes d'été commencent ! Jusqu'à -50% sur une sélection de montures. Venez vite en magasin !" },
  { id: 'soldes_hiver', titre: "❄️ Soldes d'hiver", messageParDefaut:
    "Bonjour {prenom}, ne manquez pas les soldes d'hiver : jusqu'à -40% sur vos lunettes préférées !" },
  { id: 'rentree', titre: '🎓 Rentrée scolaire', messageParDefaut:
    "Bonjour {prenom}, c'est la rentrée ! Offrez à vos enfants des lunettes stylées avec -20% sur les montures enfant." },
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
type SelectedMap = Record<string, boolean>;

export default function CampagnePage() {
  const navigation = useNavigation();
  const [messages, setMessages] = useState<MessagesDict>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCampagneId, setSelectedCampagneId] = useState<string | null>(null);
  const [selectedClients, setSelectedClients] = useState<SelectedMap>({});
  const [editMessageVisible, setEditMessageVisible] = useState(false);
  const [editedMessage, setEditedMessage] = useState('');
  const [progressModalVisible, setProgressModalVisible] = useState(false);
  const [progressCount, setProgressCount] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'TOUS' | '6M' | '2A' | 'PLUS2A'>('TOUS');

  useEffect(() => {
    const loadData = async () => {
      const msgData = await AsyncStorage.getItem('messages');
      if (msgData) {
        try { setMessages(JSON.parse(msgData)); } catch {}
      }
      const clientData = await AsyncStorage.getItem('clients');
      if (clientData) {
        try { setClients(JSON.parse(clientData)); } catch {}
      }
    };
    loadData();
  }, []);

  const getMessageForClient = (template: string, client: Client) =>
    template
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

  const handlePreview = (id: string) => {
    const msg = getMessageById(id);
    Alert.alert('Prévisualisation', msg.replace('{prenom}', 'Jean'));
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

    const diffMois =
      (now.getTime() - dateMessage.getTime()) / (1000 * 60 * 60 * 24 * 30.44);

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

    const messageTemplate =
      messages[selectedCampagneId]?.content || campagne?.messageParDefaut || '';

    const clientsCibles = filteredClients.filter((c) => selectedClients[getClientKey(c)]);

    const licenceId = await getLicenceIdFromStorage();
    if (!licenceId) {
      Alert.alert('Erreur', 'Identifiant opticien (licenceId) introuvable.');
      return;
    }

    // Pré-check (optionnel)
    let creditsActuels: number | null = null;
    try {
      creditsActuels = await fetchCreditsFromServer(licenceId);
    } catch {}
    if (creditsActuels !== null && creditsActuels < clientsCibles.length) {
      Alert.alert(
        'Crédits insuffisants',
        `Il vous reste ${creditsActuels} crédits, mais ${clientsCibles.length} sont nécessaires.`
      );
      return;
    }

    const emetteur = await getSenderLabelFromSettings();
    const signature = await getSignatureFromSettings();
    const isPromo = campagne?.type === 'promotionnelle';

    setProgressCount(0);
    setProgressTotal(clientsCibles.length);
    setProgressModalVisible(true);

    let succes = 0;

    for (const client of clientsCibles) {
      if (!client?.telephone) {
        setProgressCount((p) => p + 1);
        continue;
      }
      if (isPromo && !client?.consentementMarketing) {
        setProgressCount((p) => p + 1);
        continue;
      }

      let messageFinal = getMessageForClient(messageTemplate, client);
      // ajoute la signature
      messageFinal = appendSignature(messageFinal, signature);
      // pour les promos, assure que STOP est en dernier
      if (isPromo && !/stop\s+au\s+36111/i.test(messageFinal)) {
        messageFinal = `${messageFinal} STOP au 36111`;
      }

      try {
        await sendTransactionalOrPromoSMS({
          phoneNumber: client.telephone,
          message: messageFinal,
          emetteur,
          licenceId,
        });
        succes++;
      } catch (e) {
        console.warn(`Échec SMS à ${client.telephone}:`, (e as Error).message);
      }

      setProgressCount((p) => p + 1);
      await new Promise((r) => setTimeout(r, 120));
    }

    if (succes > 0) {
      await consumeCredits(succes);
    }

    setProgressModalVisible(false);

    let creditsRestants: number | null = null;
    try { creditsRestants = await fetchCreditsFromServer(licenceId); } catch {}

    Alert.alert(
      'Envoi terminé',
      `📤 ${succes} SMS envoyés sur ${clientsCibles.length}.${creditsRestants !== null ? `\nCrédits restants : ${creditsRestants}` : ''}`
    );
    setModalVisible(false);
  };

  const getClientKey = (c: Client) => String((c as any).id || c.telephone || '').trim();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>🎯 Campagnes SMS</Text>

      <View style={styles.annivBox}>
        <Text style={styles.subTitle}>🎂 Campagne Anniversaire</Text>
        <Text style={styles.description}>SMS automatique à la date d'anniversaire du client.</Text>
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
        <Text style={styles.description}>Messages de relance personnalisés selon la durée de port.</Text>
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
        <Text style={styles.description}>Messages ponctuels avec offres spéciales (modifiables).</Text>
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
      <Modal visible={editMessageVisible} transparent animationType="slide">
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
              <Text style={styles.buttonText}>♻️ Réinitialiser le message</Text>
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
      <Modal visible={modalVisible} transparent animationType="slide">
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
                    padding: 6,
                    borderRadius: 6,
                    backgroundColor: activeFilter === key ? '#007AFF' : '#ccc',
                    flex: 1,
                    alignItems: 'center',
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
                    onPress={() =>
                      setSelectedClients((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                    style={{
                      paddingVertical: 6,
                      borderBottomColor: '#ddd',
                      borderBottomWidth: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>
                      {client.prenom} {client.nom} — {client.telephone}
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

      {/* Progression */}
      <Modal visible={progressModalVisible} transparent animationType="fade">
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: '#fff', padding: 20, borderRadius: 10, width: '80%' }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
              Envoi des SMS en cours...
            </Text>
            <Text>{progressCount} / {progressTotal} envoyés</Text>
            <View style={{ height: 10, backgroundColor: '#ddd', borderRadius: 5, marginVertical: 10, overflow: 'hidden' }}>
              <View
                style={{
                  height: '100%',
                  width: `${progressTotal ? (progressCount / progressTotal) * 100 : 0}%`,
                  backgroundColor: '#4caf50',
                  borderRadius: 5,
                }}
              />
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
});

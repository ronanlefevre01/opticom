import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from './types';
import {
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  View,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

/* =========================
 * Helpers
 * ========================= */

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};
const isPhone10 = (p: string) => /^\d{10}$/.test(p);

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

/** Modèles par défaut */
const DEFAULT_TEMPLATES: Record<string, string> = {
  Lunettes:  'Bonjour {prenom} {nom}, vos lunettes sont prêtes. À bientôt !',
  SAV:       'Bonjour {prenom} {nom}, votre SAV est terminé, vous pouvez venir le récupérer.',
  Lentilles: 'Bonjour {prenom} {nom}, vos lentilles sont disponibles en magasin.',
  Commande:  'Bonjour {prenom} {nom}, votre commande est arrivée !',
};

/* =========================
 * Page
 * ========================= */

type RouteParams = {
  mode?: 'edit' | 'new';
  client?: Client;
};

export default function AddClientPage() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { mode, client }: RouteParams = route.params || {};

  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');

  // Date de naissance (JJ/MM/AAAA via 3 menus)
  const [dateNaissance, setDateNaissance] = useState('');
  const [bDay, setBDay] = useState<string>('');
  const [bMonth, setBMonth] = useState<string>('');
  const [bYear, setBYear] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState<null | 'day' | 'month' | 'year'>(null);

  // Produits
  const [lunettes, setLunettes] = useState(false);
  const [journ30, setJourn30] = useState(false);
  const [journ60, setJourn60] = useState(false);
  const [journ90, setJourn90] = useState(false);
  const [mens6, setMens6] = useState(false);
  const [mens12, setMens12] = useState(false);

  // Consentements
  const [consentService, setConsentService] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);

  // Envoi express
  const [showSMSModal, setShowSMSModal] = useState(false);
  const [messages, setMessages] = useState<Record<string, { title: string; content: string }>>({});

  // Modale "Personnalisé"
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customText, setCustomText] = useState('');

  // Toast
  const [toast, setToast] = useState<{visible: boolean; text: string}>({visible: false, text: ''});
  const showToast = (text: string, ms = 1500) => {
    setToast({ visible: true, text });
    setTimeout(() => setToast({ visible: false, text: '' }), ms);
  };

  // Progress envoi SMS
  const [sending, setSending] = useState(false);
  const [sendStep, setSendStep] = useState<'prep'|'send'|'done'|'error'>('prep');
  const [sendError, setSendError] = useState<string | null>(null);

  // Options date
  const dayOptions = Array.from({ length: 31 }, (_, i) => {
    const v = String(i + 1).padStart(2, '0');
    return { value: v, label: v };
  });
  const monthOptions = [
    ['01','Jan.'],['02','Fév.'],['03','Mars'],['04','Avr.'],['05','Mai'],['06','Juin'],
    ['07','Juil.'],['08','Août'],['09','Sept.'],['10','Oct.'],['11','Nov.'],['12','Déc.'],
  ].map(([v,l]) => ({ value: v, label: `${v} — ${l}` }));
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: currentYear - 1900 + 1 }, (_, i) => {
    const y = String(currentYear - i);
    return { value: y, label: y };
  });

  const syncBirthdate = (d = bDay, m = bMonth, y = bYear) => {
    if (d && m && y) setDateNaissance(`${d}/${m}/${y}`);
    else setDateNaissance('');
  };

  useEffect(() => {
    if (mode === 'edit' && client) {
      const c = client as any;

      setNom(String(c.nom || ''));
      setPrenom(String(c.prenom || ''));
      setTelephone(String(c.telephone || ''));
      setEmail(String(c.email || ''));

      // parse date existante
      const dn = String(c.dateNaissance || '');
      const mt = dn.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
      if (mt) {
        const d = mt[1].padStart(2, '0');
        const m = mt[2].padStart(2, '0');
        const y = mt[3];
        setBDay(d); setBMonth(m); setBYear(y);
        setDateNaissance(`${d}/${m}/${y}`);
      } else {
        setBDay(''); setBMonth(''); setBYear(''); setDateNaissance('');
      }

      setLunettes(!!c.lunettes);

      const arr = Array.isArray(c.lentilles) ? c.lentilles : [];
      setJourn30(arr.includes('30j'));
      setJourn60(arr.includes('60j'));
      setJourn90(arr.includes('90j'));
      setMens6(arr.includes('6mois'));
      setMens12(arr.includes('1an'));

      const serviceFromObj = !!c?.consent?.service_sms?.value;
      const marketingFromObj = !!c?.consent?.marketing_sms?.value;
      setConsentService(serviceFromObj);
      setConsentMarketing(marketingFromObj || !!c.consentementMarketing);
    }

    // Charger modèles
    AsyncStorage.getItem('messages').then((data) => {
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        setMessages(parsed);
      } catch {}
    });
  }, [mode, client]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<boolean>>, value: boolean) =>
    setter(!value);

  const handleSave = async () => {
    const tel = sanitizePhone(telephone.trim());
    if (!tel) return showToast('☎ Numéro obligatoire');
    if (!isPhone10(tel)) return showToast('❌ Numéro invalide');
    if (!nom.trim() || !prenom.trim()) return showToast('❌ Nom et prénom requis');

    const now = new Date().toISOString();

    const nouveauClient: any = {
      nom,
      prenom,
      telephone: tel,
      email,
      dateNaissance, // JJ/MM/AAAA
      lunettes,
      lentilles: [
        journ30 ? '30j' : null,
        journ60 ? '60j' : null,
        journ90 ? '90j' : null,
        mens6 ? '6mois' : null,
        mens12 ? '1an' : null,
      ].filter(Boolean),
      consentementMarketing: consentMarketing,
      consent: {
        service_sms: {
          value: consentService,
          collectedAt: consentService ? now : undefined,
          source: 'in_store',
          proof: consentService ? 'case-cochée-app' : undefined,
          unsubscribedAt: null,
        },
        marketing_sms: {
          value: consentMarketing,
          collectedAt: consentMarketing ? now : undefined,
          source: 'in_store',
          proof: consentMarketing ? 'case-cochée-app' : undefined,
          unsubscribedAt: null,
        },
      },
      messagesEnvoyes: mode === 'edit' ? (client as any)?.messagesEnvoyes || [] : [],
      createdAt: mode === 'edit' ? (client as any)?.createdAt || now : now,
    };

    try {
      const data = await AsyncStorage.getItem('clients');
      let clients: any[] = data ? JSON.parse(data) : [];

      if (mode === 'edit' && (client as any)?.telephone) {
        clients = clients.filter((c) => c.telephone !== (client as any).telephone);
      }

      clients.push(nouveauClient);
      await AsyncStorage.setItem('clients', JSON.stringify(clients));

      showToast('✅ Client enregistré');
    } catch (error) {
      console.error('Erreur de sauvegarde :', error);
      showToast('❌ Échec sauvegarde');
    }
  };

  /* =========================
   * Envoi SMS (transactionnel)
   * ========================= */

  const buildMessageFromTemplate = (template: string) => {
    let msg = template || 'Bonjour, votre opticien vous contacte.';
    if (prenom) msg = msg.replace('{prenom}', prenom);
    if (nom) msg = msg.replace('{nom}', nom);
    msg = msg.replace(/\s*\{prenom\}\s*/g, '').replace(/\s*\{nom\}\s*/g, '').replace(/\s+/g, ' ').trim();
    return msg;
  };

  const sendTransactionalSMS = async (phone: string, body: string) => {
    const phoneNumber = sanitizePhone(phone);
    if (!isPhone10(phoneNumber)) { showToast('❌ Numéro invalide'); return false; }
    const message = (body || '').trim();
    if (!message) { showToast('❌ Message vide'); return false; }

    const licStr = await AsyncStorage.getItem('licence');
    const lic = licStr ? JSON.parse(licStr) : null;
    const cle = lic?.licence || '';
    const licenceId = lic?.id || lic?.opticien?.id || cle;
    if (!licenceId && !cle) { showToast('❌ Licence introuvable'); return false; }

    // Progress
    setSending(true);
    setSendError(null);
    setSendStep('prep');

    try {
      setSendStep('send');
      const response = await fetch(`${SERVER_BASE}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, message, licenceId, cle }),
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
    } catch (e) {
      setSendError("Impossible d'envoyer le SMS (réseau).");
      setSendStep('error');
      return false;
    }
  };

  const logMessageSend = async (templateKey: string) => {
    try {
      const data = await AsyncStorage.getItem('clients');
      let clients: any[] = data ? JSON.parse(data) : [];
      const tel = sanitizePhone(telephone.trim());
      const idx = clients.findIndex((c) => sanitizePhone(c.telephone) === tel);
      if (idx >= 0) {
        const iso = new Date().toISOString();
        clients[idx].messagesEnvoyes = Array.isArray(clients[idx].messagesEnvoyes)
          ? clients[idx].messagesEnvoyes
          : [];
        clients[idx].messagesEnvoyes.push({ type: templateKey, date: iso });
        await AsyncStorage.setItem('clients', JSON.stringify(clients));
      }
    } catch {}
  };

  const sendTemplate = async (templateKey: 'Lunettes'|'SAV'|'Lentilles'|'Commande') => {
    const fromStore = messages[templateKey]?.content;
    const template = fromStore && typeof fromStore === 'string'
      ? fromStore
      : DEFAULT_TEMPLATES[templateKey];

    if (!consentService) {
      showToast('⛔ Consentement Service requis');
      return;
    }

    const sig = await getSignatureFromSettings();
    const finalMessage = appendSignature(buildMessageFromTemplate(template), sig);

    const ok = await sendTransactionalSMS(telephone.trim(), finalMessage);
    if (ok) await logMessageSend(templateKey);
  };

  const sendCustom = async () => {
    if (!consentService) {
      showToast('⛔ Consentement Service requis');
      return;
    }
    const sig = await getSignatureFromSettings();
    const finalMessage = appendSignature(buildMessageFromTemplate(customText), sig);

    // montrer la progression immédiatement
    setSending(true);
    setSendStep('prep');
    setSendError(null);

    const ok = await sendTransactionalSMS(telephone.trim(), finalMessage);
    if (ok) {
      await logMessageSend('Personnalisé' as any);
      setShowCustomModal(false);
    }
  };

  const handleExpressSMS = () => {
    // ✅ Alerte si consentement Service non coché
    if (!consentService) {
      Alert.alert(
        'Consentement requis',
        'Activez “Service (commande prête, SAV…)” pour envoyer un SMS.'
      );
      return;
    }
    const tel = sanitizePhone(telephone.trim());
    if (!tel) return showToast('☎ Veuillez saisir un numéro');
    if (!isPhone10(tel)) return showToast('❌ Téléphone invalide');
    setShowSMSModal(true);
  };

  /* =========================
   * UI
   * ========================= */

  // liste pour la modale de sélection (jour/mois/année)
  const pickerList =
    pickerOpen === 'day' ? dayOptions :
    pickerOpen === 'month' ? monthOptions :
    pickerOpen === 'year' ? yearOptions : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.label}>Téléphone *</Text>
      <TextInput
        style={styles.input}
        keyboardType={Platform.OS === 'web' ? 'text' : 'phone-pad'}
        value={telephone}
        onChangeText={setTelephone}
        placeholder="0601020304"
        placeholderTextColor="#777"
      />

      <TouchableOpacity style={styles.smsButton} onPress={handleExpressSMS}>
        <Text style={styles.buttonText}>📤 Envoi express cocher la case de consentement service</Text>
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
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setConsentService, consentService)}>
        <Text style={styles.checkboxText}>
          {consentService ? '☑' : '☐'} Service (commande prête, SAV…)
        </Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setConsentMarketing, consentMarketing)}>
        <Text style={styles.checkboxText}>
          {consentMarketing ? '☑' : '☐'} Marketing (promos / relances)
        </Text>
      </TouchableOpacity>

      {/* Produits */}
      <Text style={styles.label}>Produits :</Text>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggle(setLunettes, lunettes)}>
        <Text style={styles.checkboxText}>{lunettes ? '☑' : '☐'} Lunettes</Text>
      </TouchableOpacity>

      <Text style={styles.subLabel}>Lentilles journalières :</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn30, journ30)}>
          <Text style={styles.checkboxText}>{journ30 ? '☑' : '☐'} 30j</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn60, journ60)}>
          <Text style={styles.checkboxText}>{journ60 ? '☑' : '☐'} 60j</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setJourn90, journ90)}>
          <Text style={styles.checkboxText}>{journ90 ? '☑' : '☐'} 90j</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.subLabel}>Lentilles mensuelles :</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setMens6, mens6)}>
          <Text style={styles.checkboxText}>{mens6 ? '☑' : '☐'} 6 mois</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.checkboxInline} onPress={() => toggle(setMens12, mens12)}>
          <Text style={styles.checkboxText}>{mens12 ? '☑' : '☐'} 1 an</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Enregistrer le client</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.homeButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>

      {/* Modale choix (4 + personnalisé) */}
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
                  // affiche la progression immédiatement
                  setSending(true);
                  setSendStep('prep');
                  setSendError(null);
                  setTimeout(() => sendTemplate(label), 60);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.modalButtonText}>{label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.modalButton, { marginTop: 8 }]}
              onPress={() => {
                setShowSMSModal(false);
                setCustomText('');
                setTimeout(() => setShowCustomModal(true), 50);
              }}
            >
              <Text style={styles.modalButtonText}>Personnalisé</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowSMSModal(false)} accessibilityRole="button">
              <Text style={styles.modalCancel}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale "Personnalisé" */}
      <Modal visible={showCustomModal} transparent animationType="fade" onRequestClose={() => setShowCustomModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Message personnalisé</Text>
            <Text style={[styles.modalSubtitle, { marginBottom: 6 }]}>
              Placeholders: {'{prenom}'} et {'{nom}'}.
            </Text>
            <TextInput
              style={[styles.input, { width: '100%' }]}
              value={customText}
              onChangeText={setCustomText}
              placeholder="Tapez votre message…"
              placeholderTextColor="#aaa"
              multiline
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.modalActionBtn, { backgroundColor: '#28a745', flex: 1 }]}
                onPress={sendCustom}
              >
                <Text style={styles.modalActionText}>Envoyer</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setShowCustomModal(false)} accessibilityRole="button">
              <Text style={[styles.modalCancel, { marginTop: 10 }]}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modale de sélection jour/mois/année */}
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
                    const d = pickerOpen === 'day' ? opt.value : bDay;
                    const m = pickerOpen === 'month' ? opt.value : bMonth;
                    const y = pickerOpen === 'year' ? opt.value : bYear;
                    if (d && m && y) setDateNaissance(`${d}/${m}/${y}`);
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

      {/* Progress envoi SMS */}
      <Modal visible={sending} transparent animationType="fade" onRequestClose={() => { if (sendStep !== 'send') setSending(false); }}>
        <View style={styles.modalOverlay}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Envoi du SMS…</Text>
            {sendStep !== 'done' && sendStep !== 'error' && <ActivityIndicator size="large" color="#fff" />}
            <View style={{ marginTop: 12 }}>
              <Text style={styles.progressLine}>
                {sendStep === 'prep' ? '• Préparation…' : '✓ Préparation'}
              </Text>
              <Text style={styles.progressLine}>
                {sendStep === 'send' ? '• Envoi au serveur…' : (sendStep === 'prep' ? '• Envoi au serveur' : '✓ Envoi au serveur')}
              </Text>
              {sendStep === 'done' && <Text style={styles.progressOk}>✓ Terminé</Text>}
              {sendStep === 'error' && <Text style={styles.progressErr}>✗ {sendError || 'Erreur inconnue'}</Text>}
            </View>

            {sendStep === 'error' && (
              <TouchableOpacity style={[styles.modalActionBtn, { backgroundColor: '#ff3b30', marginTop: 12 }]} onPress={() => setSending(false)}>
                <Text style={styles.modalActionText}>Fermer</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Toast */}
      {toast.visible && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast.text}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#000', flexGrow: 1 },
  label: { fontWeight: 'bold', marginTop: 16, color: '#fff' },
  subLabel: { marginTop: 12, fontWeight: '600', color: '#ccc' },
  input: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    color: '#fff',
    backgroundColor: '#111',
  },
  // Date of birth selects
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dobSelect: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#111',
  },
  dobSelectText: { color: '#fff', fontWeight: '600' },

  checkbox: { marginTop: 10 },
  checkboxText: { color: '#fff', fontSize: 16 },
  button: {
    marginTop: 24,
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  smsButton: {
    marginTop: 12,
    backgroundColor: '#28a745',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  homeButton: {
    marginTop: 30,
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  homeButtonText: { color: '#00BFFF', fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
  checkboxInline: { paddingVertical: 6 },

  // Modals (génériques)
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
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 30,
    backgroundColor: '#1f2937',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  toastText: { color: '#fff', fontWeight: '600' },
});

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Modal,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkAndRenewCredits } from './CreditManager';

// 🌐 Serveur
const API_BASE = 'https://opticom-sms-server.onrender.com';
// 🔁 Nom de l'écran où l'utilisateur accepte les CGV
const LICENCE_SCREEN_NAME = 'Licence';

// Endpoints support (ordre de tentative)
const FEEDBACK_ENDPOINTS = [
  `${API_BASE}/support/messages`,
  `${API_BASE}/api/support/messages`,
  `${API_BASE}/support/feedback`,
  `${API_BASE}/feedback`,
];

// Helper: récupère l'id licence quels que soient les champs stockés
async function getLicenceIdFlex(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem('licence');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const id =
      obj?.id ||
      obj?.licence ||
      obj?.opticien?.id ||
      obj?.opticienId ||
      '';
    return id ? String(id).trim() : null;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const navigation = useNavigation<any>();

  // --- UI "Nous joindre"
  const [contactVisible, setContactVisible] = useState(false);
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // crédits
    checkAndRenewCredits();

    // charge email de contact mémorisé
    AsyncStorage.getItem('supportEmail').then((v) => setContactEmail(v || ''));

    // garde-fou CGV
    (async () => {
      try {
        const licenceId = await getLicenceIdFlex();
        if (!licenceId) return;

        const r = await fetch(
          `${API_BASE}/licence/cgv-status?licenceId=${encodeURIComponent(licenceId)}`
        );
        const j = await r.json();

        // Si version non acceptée → on renvoie sur l’écran d’acceptation
        if (r.ok && (!j.accepted || j.currentVersion !== j.acceptedVersion)) {
          navigation.reset({ index: 0, routes: [{ name: LICENCE_SCREEN_NAME }] });
        }
      } catch {
        // offline: on ne bloque pas
      }
    })();
  }, [navigation]);

  const sendFeedback = async () => {
    const msg = contactMessage.trim();
    if (msg.length < 10) {
      Alert.alert('Message trop court', 'Merci de détailler votre suggestion (min. 10 caractères).');
      return;
    }

    const licenceId = await getLicenceIdFlex();
    if (!licenceId) {
      Alert.alert('Erreur', "Identifiant licence introuvable sur l’appareil.");
      return;
    }

    setSending(true);
    try {
      // récup info enseigne pour contexte (si présentes)
      let opticien: Record<string, any> = {};
      try {
        const raw = await AsyncStorage.getItem('licence');
        if (raw) {
          const lic = JSON.parse(raw);
          opticien = {
            enseigne: lic?.opticien?.enseigne || lic?.nom || '',
            ville: lic?.opticien?.ville || '',
          };
        }
      } catch {}

      const payload = {
        licenceId,                                 // accepté par le serveur (alias gérés côté serveur)
        subject: contactSubject.trim() || 'Suggestion / Contact',
        message: msg,
        email: contactEmail.trim(),
        platform: Platform.OS,
        appVersion: '1.0.0',
        app: 'OptiCOM',
        opticien,
        createdAt: new Date().toISOString(),
      };

      let lastErr: any = null;
      for (const url of FEEDBACK_ENDPOINTS) {
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const text = await resp.text();
          let data: any = {};
          try { data = JSON.parse(text); } catch {}

          if (resp.ok && (data?.success || data?.ok || data?.entry)) {
            await AsyncStorage.setItem('supportEmail', contactEmail.trim());
            setContactVisible(false);
            setContactSubject('');
            setContactMessage('');
            Alert.alert('Merci !', 'Votre message a bien été envoyé à l’équipe OptiCOM.');
            return;
          }
          lastErr = new Error(data?.error || `HTTP ${resp.status}`);
        } catch (e) {
          lastErr = e;
        }
      }

      const hint = lastErr?.message ? `\n(${String(lastErr.message)})` : '';
      Alert.alert('Erreur', "Impossible d'envoyer votre message pour le moment." + hint);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <Image source={require('./assets/logo.png')} style={styles.logo} resizeMode="contain" />

      <Text style={styles.title}>👋 Votre assistant en magasin !</Text>

      <View style={styles.grid}>
        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('AddClient')}>
          <Text style={styles.buttonText}>👤 Ajouter un client</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('ClientList')}>
          <Text style={styles.buttonText}>📋 Voir les clients</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Subscription')}>
          <Text style={styles.buttonText}>📊 Mon abonnement</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.gridButton} onPress={() => navigation.navigate('Campagne')}>
          <Text style={styles.buttonText}>📆 Campagnes</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.gridButton, styles.settingsButton]}
        onPress={() => navigation.navigate('Settings')}
      >
        <Text style={styles.buttonText}>⚙️ Paramètres</Text>
      </TouchableOpacity>

      {/* CTA Nous joindre / Suggestions */}
      <TouchableOpacity style={[styles.gridButton, styles.contactButton]} onPress={() => setContactVisible(true)}>
        <Text style={styles.buttonText}>📨 Nous joindre / Vos suggestions</Text>
      </TouchableOpacity>

      {/* Modale contact */}
      <Modal visible={contactVisible} transparent animationType="fade" onRequestClose={() => setContactVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.modalTitle}>Nous joindre</Text>

            <Text style={styles.label}>Sujet (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : Idée d’amélioration, bug, question…"
              placeholderTextColor="#888"
              value={contactSubject}
              onChangeText={setContactSubject}
            />

            <Text style={styles.label}>Votre message *</Text>
            <TextInput
              style={[styles.input, { minHeight: 120 }]}
              placeholder="Décrivez votre suggestion ou votre problème…"
              placeholderTextColor="#888"
              value={contactMessage}
              onChangeText={setContactMessage}
              multiline
            />

            <Text style={styles.label}>Email de contact (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="vous@domaine.fr"
              placeholderTextColor="#888"
              value={contactEmail}
              onChangeText={setContactEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#007AFF' }]}
                onPress={sendFeedback}
                disabled={sending}
              >
                <Text style={styles.btnText}>{sending ? 'Envoi…' : 'Envoyer'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#444' }]}
                onPress={() => setContactVisible(false)}
                disabled={sending}
              >
                <Text style={styles.btnText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', paddingHorizontal: 20, paddingTop: 40 },
  logo: { width: 300, height: 300, marginBottom: 10 },
  title: { fontSize: 22, color: '#fff', fontWeight: 'bold', marginBottom: 30, textAlign: 'center' },
  grid: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, paddingHorizontal: 10 },
  gridButton: {
    backgroundColor: '#1E90FF',
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderRadius: 12,
    width: '48%',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  settingsButton: { width: '100%', marginTop: 10 },
  contactButton: { width: '100%', backgroundColor: '#00BFFF' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },

  // modal styles
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#222', width: '88%', borderRadius: 12, padding: 18 },
  modalTitle: { color: '#fff', fontWeight: 'bold', fontSize: 18, marginBottom: 8, textAlign: 'center' },
  label: { color: '#ccc', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#111', borderColor: '#555', borderWidth: 1, borderRadius: 8, color: '#fff', padding: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});

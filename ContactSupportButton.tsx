import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput, StyleSheet, Alert, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import API_BASE from './src/config/api';

const CANDIDATE_ENDPOINTS = [
  `${API_BASE}/feedback`,
  `${API_BASE}/support/feedback`,
  `${API_BASE}/support/contact`,
  `${API_BASE}/admin/feedback`,
];

async function postFeedback(payload: any) {
  let lastErr: any = null;
  for (const url of CANDIDATE_ENDPOINTS) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}
      if (resp.ok && (data?.ok || data?.success !== false)) return true;
      lastErr = new Error(data?.error || `HTTP ${resp.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Envoi impossible');
}

export default function ContactSupportButton() {
  const [visible, setVisible] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const savedEmail = (await AsyncStorage.getItem('supportEmail')) || '';
      setEmail(savedEmail);
    })();
  }, []);

  const send = async () => {
    const msg = message.trim();
    if (msg.length < 10) {
      Alert.alert('Message trop court', 'Merci de détailler votre suggestion (min. 10 caractères).');
      return;
    }
    setSending(true);

    // Récupère licence + quelques infos d’identification
    let licenceId: string | null = null;
    let opticien: Record<string, any> = {};
    try {
      const raw = await AsyncStorage.getItem('licence');
      if (raw) {
        const lic = JSON.parse(raw);
        licenceId = lic?.id || lic?.opticien?.id || null;
        opticien = {
          enseigne: lic?.opticien?.enseigne || lic?.nom || '',
          ville: lic?.opticien?.ville || '',
        };
      }
    } catch {}

    const payload = {
      licenceId,
      subject: subject.trim() || 'Suggestion / Contact',
      message: msg,
      email: email.trim(),
      opticien,
      app: 'OptiCOM',
      platform: Platform.OS,
      createdAt: new Date().toISOString(),
    };

    try {
      await postFeedback(payload);
      await AsyncStorage.setItem('supportEmail', email.trim());
      setVisible(false);
      setSubject('');
      setMessage('');
      Alert.alert('Merci !', 'Votre message a bien été envoyé à l’équipe OptiCom.');
    } catch {
      Alert.alert('Erreur', "Impossible d'envoyer votre message pour le moment.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.cta} onPress={() => setVisible(true)}>
        <Text style={styles.ctaText}>📨 Nous joindre / Vos suggestions</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>Nous joindre</Text>

            <Text style={styles.label}>Sujet (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex : Idée d’amélioration, bug, question…"
              placeholderTextColor="#888"
              value={subject}
              onChangeText={setSubject}
            />

            <Text style={styles.label}>Votre message *</Text>
            <TextInput
              style={[styles.input, { minHeight: 120 }]}
              placeholder="Décrivez votre suggestion ou votre problème…"
              placeholderTextColor="#888"
              value={message}
              onChangeText={setMessage}
              multiline
            />

            <Text style={styles.label}>Email de contact (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="vous@domaine.fr"
              placeholderTextColor="#888"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#007AFF' }]}
                onPress={send}
                disabled={sending}
              >
                <Text style={styles.btnText}>{sending ? 'Envoi…' : 'Envoyer'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#444' }]}
                onPress={() => setVisible(false)}
                disabled={sending}
              >
                <Text style={styles.btnText}>Annuler</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  cta: { marginTop: 12, backgroundColor: '#00BFFF', padding: 14, borderRadius: 10, alignItems: 'center' },
  ctaText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#222', width: '88%', borderRadius: 12, padding: 18 },
  title: { color: '#fff', fontWeight: 'bold', fontSize: 18, marginBottom: 8, textAlign: 'center' },
  label: { color: '#ccc', marginTop: 8, marginBottom: 4 },
  input: { backgroundColor: '#111', borderColor: '#555', borderWidth: 1, borderRadius: 8, color: '#fff', padding: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});

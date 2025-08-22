// LicenceCheckPage.tsx — inscription + login email/mot de passe + SecureStore
import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, Modal, ScrollView, Platform, SafeAreaView, KeyboardAvoidingView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { saveSubscriptionData } from './CreditManager';
import * as SecureStore from 'expo-secure-store';

async function saveLicenceKey(key: string) {
  try { await SecureStore.setItemAsync('licenceKey', key); } catch {}
  try { await AsyncStorage.setItem('licenceKey', key); } catch {}
}
async function loadLicenceKey(): Promise<string | null> {
  try { const k = await SecureStore.getItemAsync('licenceKey'); if (k) return k; } catch {}
  try { const k = await AsyncStorage.getItem('licenceKey'); if (k) return k; } catch {}
  return null;
}

const formulas = [
  { id: 'starter',  name: 'Starter',  price: 14.9, credits: 100 },
  { id: 'pro',      name: 'Pro',      price: 39.9, credits: 300 },
  { id: 'premium',  name: 'Premium',  price: 69.9, credits: 600 },
  { id: 'alacarte', name: 'À la carte', price: 0.17, credits: 100, isOneShot: true },
];

const API_URL = 'https://opticom-sms-server.onrender.com';

// ---- Helpers API tolérants
const licenceByKeyCandidates = (key: string) => [
  `${API_URL}/api/licence/by-key?key=${encodeURIComponent(key)}`,
  `${API_URL}/licence/by-key?key=${encodeURIComponent(key)}`,
  `${API_URL}/licence-by-key?cle=${encodeURIComponent(key)}`,
];
async function fetchLicenceByKey(key: string) {
  for (const url of licenceByKeyCandidates(key)) {
    try {
      const res  = await fetch(url);
      const text = await res.text();
      if (!res.ok) continue;
      const data = text ? JSON.parse(text) : null;
      const lic  = data?.licence ?? data ?? null;
      if (lic) return lic;
    } catch {}
  }
  return null;
}
function extractKeyFromURL(url?: string | null) {
  if (!url) return null;
  const parsed = Linking.parse(url);
  const qp: any = parsed?.queryParams || {};
  return (qp.licence || qp.key || qp.cle || '').toString().trim() || null;
}

// ---- Expéditeur/signature
const PENDING_SMS_SETTINGS_KEY = 'pendingSenderSettings';
const normalizeSenderUpper = (raw = '') =>
  String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11);

export default function LicenceCheckPage() {
  const navigation = useNavigation<any>();

  const [form, setForm] = useState({
    nomMagasin: '', adresse: '', codePostal: '', ville: '',
    telephone: '', email: '', siret: '', pays: 'FR',
  });
  const [selectedFormula, setSelectedFormula] = useState('starter');
  const [loading, setLoading] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditQuantity, setCreditQuantity] = useState(1);
  const [verifTerminee, setVerifTerminee] = useState(false);

  // Nouveaux champs (inscription)
  const [libelleExpediteur, setLibelleExpediteur] = useState('');
  const [signature, setSignature] = useState('');
  const senderPreview = normalizeSenderUpper(libelleExpediteur);
  const senderValid = senderPreview.length >= 3;

  // --- Login modal (email + mot de passe)
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleChange = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  // helper: persiste & route Home
  const persistLicenceAndGoHome = useMemo(() => {
    return async (licence: any, fallbackKey?: string | null) => {
      try {
        const key = String(licence?.licence || licence?.cle || fallbackKey || '').trim() || null;

        // Si des réglages SMS sont en attente → bootstrap côté serveur
        try {
          const pendingRaw = await AsyncStorage.getItem(PENDING_SMS_SETTINGS_KEY);
          if (pendingRaw && licence?.id) {
            const pending = JSON.parse(pendingRaw);
            if (pending?.libelleExpediteur || pending?.signature) {
              await fetch(`${API_URL}/api/licence/bootstrap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  licenceId: licence.id,
                  libelleExpediteur: pending.libelleExpediteur || undefined,
                  signature: pending.signature || undefined,
                }),
              }).catch(() => {});
            }
            await AsyncStorage.removeItem(PENDING_SMS_SETTINGS_KEY);
          }
        } catch {}

        // ✅ persistance locale + SecureStore
        await AsyncStorage.setItem('licence', JSON.stringify(licence ?? (key ? { licence: key, cle: key } : {})));
        if (key) {
          await AsyncStorage.setItem('licenceKey', key);
          await saveLicenceKey(key);
        }

        try {
          await saveSubscriptionData({
            creditsRestants: licence?.creditsRestants ?? null,
            renouvellement: licence?.renouvellement ?? null,
            historique: Array.isArray(licence?.historique) ? licence.historique : [],
          });
        } catch {}

        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } catch {
        Alert.alert('Erreur', 'Impossible d’enregistrer la licence localement.');
      }
    };
  }, [navigation]);

  // Au montage : 0) auto-login par token, puis 1/2/3 clés/deeplink/legacy
  useEffect(() => {
    (async () => {
      try {
        // 0) token JWT => /api/auth/me
        try {
          const token = await SecureStore.getItemAsync('authToken');
          if (token) {
            const r = await fetch(`${API_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const j = await r.json().catch(() => ({} as any));
            if (r.ok && j?.ok && j.licence) {
              await AsyncStorage.setItem('licence', JSON.stringify(j.licence));
              const k = String(j.licence.licence || j.licence.cle || '');
              if (k) await saveLicenceKey(k);
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              return;
            }
          }
        } catch {}

        // 1) licence déjà stockée (objet)
        const stored = await AsyncStorage.getItem('licence');
        if (stored) {
          try {
            const obj = JSON.parse(stored);
            if (obj?.cle || obj?.licence || obj?.id || obj?.opticien?.id) {
              navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
              return;
            }
          } catch {}
        }

        // 2) Deep link ?
        const initialUrl = await Linking.getInitialURL();
        const urlKey = extractKeyFromURL(initialUrl);
        if (urlKey) {
          const lic = await fetchLicenceByKey(urlKey);
          if (lic) { await persistLicenceAndGoHome(lic, urlKey); return; }
          await persistLicenceAndGoHome(null, urlKey); return;
        }

        // 3) Clé en SecureStore / AsyncStorage
        const legacy = await loadLicenceKey();
        if (legacy) {
          const lic = await fetchLicenceByKey(legacy);
          if (lic) { await persistLicenceAndGoHome(lic, legacy); return; }
          await persistLicenceAndGoHome(null, legacy); return;
        }
      } catch (e) {
        console.log('Licence bootstrap error:', e);
      } finally {
        setVerifTerminee(true);
      }
    })();
  }, [persistLicenceAndGoHome, navigation]);

  // --- Connexion par e-mail + mot de passe
  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError('Adresse e-mail et mot de passe requis.');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const r = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'IDENTIFIANTS_INVALIDES');

      // 🔐 token pour auto-login futur
      if (j?.token) {
        try { await SecureStore.setItemAsync('authToken', j.token); } catch {}
      }

      // L’API peut renvoyer la licence directement, ou bien une clé
      const lic = j?.licence || j?.data?.licence || null;
      const licenceKey = j?.licenceKey || lic?.licence || null;

      if (lic) {
        await persistLicenceAndGoHome(lic, licenceKey);
      } else if (licenceKey) {
        const fetched = await fetchLicenceByKey(licenceKey);
        if (fetched) await persistLicenceAndGoHome(fetched, licenceKey);
        else await persistLicenceAndGoHome(null, licenceKey);
      } else {
        throw new Error('Réponse serveur incomplète.');
      }

      try { await AsyncStorage.setItem('authEmail', loginEmail.trim()); } catch {}
      setShowLoginModal(false);
      setLoginPassword('');
    } catch (e: any) {
      setLoginError(e?.message || 'Connexion impossible.');
    } finally {
      setLoginLoading(false);
    }
  };

  // Soumission inscription + mandat SEPA
  const handleSubmit = async () => {
    const { nomMagasin, adresse, codePostal, ville, telephone, email, siret, pays } = form;
    if (!nomMagasin || !adresse || !codePostal || !ville || !telephone || !email || !siret) {
      Alert.alert('Erreur', 'Tous les champs sont obligatoires.');
      return;
    }
    if (!senderValid) {
      Alert.alert('Expéditeur invalide', 'Le libellé expéditeur doit contenir 3 à 11 caractères (A-Z / 0-9).');
      return;
    }
    if (selectedFormula === 'alacarte') {
      setShowCreditModal(true);
      return;
    }

    setLoading(true);
    try {
      // On garde les réglages en attente pour bootstrap après retour (deep link)
      await AsyncStorage.setItem(
        PENDING_SMS_SETTINGS_KEY,
        JSON.stringify({ libelleExpediteur: senderPreview, signature: signature?.trim() || '' })
      );

      // Crée un mandat SEPA (abonnement) — expéditeur & signature inclus
      const r = await fetch(`${API_URL}/create-mandat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomMagasin, email, telephone, adresse, ville, codePostal, siret,
          pays: (pays || 'FR').toUpperCase(),
          formuleId: selectedFormula || 'starter',
          // noms attendus côté serveur
          libelleFromClient: senderPreview,
          signatureFromClient: signature?.trim() || '',
          // alias compat
          libelleExpediteur: senderPreview,
          signature: signature?.trim() || ''
        }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok && j?.url) {
        Linking.openURL(j.url);
      } else {
        await AsyncStorage.removeItem(PENDING_SMS_SETTINGS_KEY);
        Alert.alert('Erreur', j?.error || 'Création du mandat impossible.');
      }
    } catch (e) {
      console.error(e);
      await AsyncStorage.removeItem(PENDING_SMS_SETTINGS_KEY);
      Alert.alert('Erreur', 'Impossible de contacter le serveur.');
    } finally {
      setLoading(false);
    }
  };

  const handleStripePayment = async () => {
    setShowCreditModal(false);
    const qty = Math.max(1, parseInt(String(creditQuantity), 10) || 1);
    try {
      const r = await fetch(`${API_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientEmail: form.email, quantity: qty }),
      });
      const j = await r.json().catch(() => ({} as any));
      if (r.ok && j?.url) {
        Linking.openURL(j.url);
      } else {
        Alert.alert('Erreur', j?.error || 'Paiement impossible.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Erreur', 'Impossible de contacter Stripe.');
    }
  };

  if (!verifTerminee) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 18 }}>🔄 Vérification de la licence…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 160 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          <Text style={styles.title}>🔐 Inscription à OptiCOM</Text>

          {/* Identité magasin */}
          <View style={styles.row}>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Nom du magasin" placeholderTextColor="#666"
                value={form.nomMagasin} onChangeText={(v) => handleChange('nomMagasin', v)} />
            </View>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Adresse" placeholderTextColor="#666"
                value={form.adresse} onChangeText={(v) => handleChange('adresse', v)} />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Code postal" placeholderTextColor="#666"
                keyboardType="number-pad" value={form.codePostal} onChangeText={(v) => handleChange('codePostal', v)} />
            </View>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Ville" placeholderTextColor="#666"
                value={form.ville} onChangeText={(v) => handleChange('ville', v)} />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Téléphone" placeholderTextColor="#666"
                keyboardType="phone-pad" value={form.telephone} onChangeText={(v) => handleChange('telephone', v)} />
            </View>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666"
                keyboardType="email-address" autoCapitalize="none"
                value={form.email} onChangeText={(v) => handleChange('email', v)} />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="SIRET" placeholderTextColor="#666"
                keyboardType="number-pad" value={form.siret} onChangeText={(v) => handleChange('siret', v)} />
            </View>
            <View style={styles.col}>
              <TextInput style={styles.input} placeholder="Pays (ex: FR)" placeholderTextColor="#666"
                autoCapitalize="characters" value={form.pays} onChangeText={(v) => handleChange('pays', v)} />
            </View>
          </View>

          {/* Identité d'envoi SMS */}
          <Text style={styles.subtitle}>Identité d’envoi SMS</Text>
          <View style={styles.row}>
            <View style={styles.col}>
              <TextInput
                style={styles.input}
                placeholder="Libellé expéditeur (A-Z/0-9, 3–11)"
                placeholderTextColor="#666"
                autoCapitalize="characters"
                value={libelleExpediteur}
                onChangeText={(v) => setLibelleExpediteur(v)}
                onBlur={() => setLibelleExpediteur(senderPreview)}
              />
              <Text style={styles.hint}>
                Aperçu: <Text style={senderValid ? styles.hintOk : styles.hintErr}>{senderPreview || '—'}</Text>
              </Text>
            </View>
            <View style={styles.col}>
              <TextInput
                style={[styles.input, { minHeight: 48 }]}
                placeholder="Signature (ajoutée à la fin du SMS)"
                placeholderTextColor="#666"
                value={signature}
                onChangeText={setSignature}
                multiline
              />
            </View>
          </View>

          {/* Formules (compactes) */}
          <Text style={styles.subtitle}>Formule</Text>
          <View style={styles.formulaRow}>
            {formulas.map((f) => (
              <TouchableOpacity
                key={f.id}
                onPress={() => setSelectedFormula(f.id)}
                style={[
                  styles.formulaCard,
                  selectedFormula === f.id && styles.formulaCardSelected,
                ]}
              >
                <Text style={styles.formulaTitle}>{f.name}</Text>
                <Text style={styles.formulaDetail}>
                  {f.isOneShot ? `${f.credits} crédits à ${f.price}€ / crédit` : `${f.credits} crédits / mois`}
                </Text>
                {!f.isOneShot && <Text style={styles.formulaPrice}>{f.price} € / mois</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Chargement…' : 'Valider'}</Text>
          </TouchableOpacity>

          {/* Liens sous le formulaire */}
          <TouchableOpacity style={{ marginTop: 20, padding: 10 }} onPress={() => navigation.navigate('LicencePage')}>
            <Text style={{ color: '#00BFFF', textAlign: 'center', fontSize: 16 }}>
              🔑 J’ai déjà une licence
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ padding: 10 }} onPress={() => setShowLoginModal(true)}>
            <Text style={{ color: '#00BFFF', textAlign: 'center', fontSize: 16 }}>
              🔐 Se connecter (e-mail + mot de passe)
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal Stripe (À la carte) */}
      <Modal visible={showCreditModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000c', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#222', padding: 20, borderRadius: 10, width: '85%', maxWidth: 420 }}>
            <Text style={{ color: '#fff', marginBottom: 10 }}>Nombre de lots de 100 crédits :</Text>
            <TextInput
              keyboardType="numeric"
              value={String(creditQuantity)}
              onChangeText={(t) => setCreditQuantity(Math.max(1, parseInt(t || '1', 10) || 1))}
              style={styles.input}
            />
            <TouchableOpacity style={styles.button} onPress={handleStripePayment}>
              <Text style={styles.buttonText}>Payer avec Stripe</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Login */}
      <Modal visible={showLoginModal} transparent animationType="fade" onRequestClose={() => setShowLoginModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#1a1a1a', padding: 20, borderRadius: 10, width: '90%', maxWidth: 420 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Se connecter</Text>
            <TextInput
              style={styles.input}
              placeholder="Adresse e-mail"
              placeholderTextColor="#666"
              autoCapitalize="none"
              keyboardType="email-address"
              value={loginEmail}
              onChangeText={setLoginEmail}
            />
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder="Mot de passe"
              placeholderTextColor="#666"
              secureTextEntry
              value={loginPassword}
              onChangeText={setLoginPassword}
            />
            {loginError ? <Text style={{ color: '#ff6b6b', marginTop: 8 }}>{loginError}</Text> : null}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 10 }}>
              <TouchableOpacity onPress={() => setShowLoginModal(false)} style={[styles.button, { backgroundColor: '#333' }]}>
                <Text style={styles.buttonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLogin} style={styles.button} disabled={loginLoading}>
                <Text style={styles.buttonText}>{loginLoading ? 'Connexion…' : 'Se connecter'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const CARD_MAX = Platform.OS === 'web' ? 220 : 220;

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  col: { flex: 1, minWidth: 0 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333' },
  hint: { color: '#9aa', fontSize: 12, marginTop: 6 },
  hintOk: { color: '#8ef' },
  hintErr: { color: '#ff6b6b' },
  subtitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginTop: 16, marginBottom: 10 },
  formulaRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', columnGap: 12, rowGap: 12, marginBottom: 8 },
  formulaCard: { backgroundColor: '#222', borderRadius: 16, padding: 14, width: '100%', maxWidth: CARD_MAX, borderWidth: 1, borderColor: '#444' },
  formulaCardSelected: { backgroundColor: '#00BFFF', borderColor: '#00BFFF' },
  formulaTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  formulaDetail: { color: '#fff', fontSize: 13 },
  formulaPrice: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 6 },
  button: { backgroundColor: '#00BFFF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

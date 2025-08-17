// LicenceCheckPage.tsx (scroll garanti + cartes compactes)
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, Modal, ScrollView, Platform, SafeAreaView, KeyboardAvoidingView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { saveSubscriptionData } from './CreditManager';

const formulas = [
  { id: 'starter',  name: 'Starter',  price: 14.9, credits: 100 },
  { id: 'pro',      name: 'Pro',      price: 39.9, credits: 300 },
  { id: 'premium',  name: 'Premium',  price: 69.9, credits: 600 },
  { id: 'alacarte', name: 'À la carte', price: 0.17, credits: 100, isOneShot: true },
];

const API_URL = 'https://opticom-sms-server.onrender.com';
const licenceByKeyEndpoint = (key: string) =>
  `${API_URL}/licence-by-key?cle=${encodeURIComponent(key)}`;

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

  const persistLicenceAndGoHome = async (licence: any) => {
    await AsyncStorage.setItem('licence', JSON.stringify(licence));
    if (licence?.cle) await AsyncStorage.setItem('licenceKey', String(licence.cle));
    await saveSubscriptionData({
      creditsRestants: licence.creditsRestants,
      renouvellement: licence.renouvellement,
      historique: licence.historique || [],
    });
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  const fetchLicenceByKey = async (key: string) => {
    const r = await fetch(licenceByKeyEndpoint(key));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const licence = j?.licence ?? j;
    return licence?.cle ? licence : null;
  };

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('licence');
        if (stored && JSON.parse(stored)?.cle) {
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          return;
        }
        const url = await Linking.getInitialURL();
        if (url) {
          const key = (Linking.parse(url)?.queryParams?.licence ?? '') as string;
          if (key) {
            const lic = await fetchLicenceByKey(key);
            if (lic) { await persistLicenceAndGoHome(lic); return; }
            Alert.alert('Erreur', 'Licence introuvable après redirection.');
          }
        }
        const legacy = await AsyncStorage.getItem('licenceKey');
        if (legacy) {
          const lic = await fetchLicenceByKey(legacy);
          if (lic) { await persistLicenceAndGoHome(lic); return; }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setVerifTerminee(true);
      }
    })();
  }, [navigation]);

  const handleChange = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  const handleSubmit = async () => {
    const { nomMagasin, adresse, codePostal, ville, telephone, email, siret, pays } = form;
    if (!nomMagasin || !adresse || !codePostal || !ville || !telephone || !email || !siret) {
      Alert.alert('Erreur', 'Tous les champs sont obligatoires.'); return;
    }
    if (selectedFormula === 'alacarte') { setShowCreditModal(true); return; }

    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/create-mandat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nomMagasin, email, telephone, adresse, ville, codePostal, siret,
          pays: pays || 'FR', formuleId: selectedFormula || 'starter',
        }),
      });
      const j = await r.json();
      if (r.ok && j.url) Linking.openURL(j.url);
      else Alert.alert('Erreur', j.error || 'Création du mandat impossible.');
    } catch (e) {
      console.error(e); Alert.alert('Erreur', 'Impossible de contacter le serveur.');
    } finally { setLoading(false); }
  };

  const handleStripePayment = async () => {
    setShowCreditModal(false);
    const qty = Math.max(1, parseInt(String(creditQuantity), 10) || 1);
    try {
      const r = await fetch(`${API_URL}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ← le backend attend `clientEmail`
        body: JSON.stringify({ clientEmail: form.email, quantity: qty }),
      });
      const j = await r.json();
      if (j.url) Linking.openURL(j.url);
      else Alert.alert('Erreur', j.error || 'Paiement impossible.');
    } catch (e) { console.error(e); Alert.alert('Erreur', 'Impossible de contacter Stripe.'); }
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

          {/* Formulaire */}
          <TextInput style={styles.input} placeholder="Nom du magasin" placeholderTextColor="#666"
            value={form.nomMagasin} onChangeText={(v) => handleChange('nomMagasin', v)} />
          <TextInput style={styles.input} placeholder="Adresse" placeholderTextColor="#666"
            value={form.adresse} onChangeText={(v) => handleChange('adresse', v)} />
          <TextInput style={styles.input} placeholder="Code postal" placeholderTextColor="#666" keyboardType="number-pad"
            value={form.codePostal} onChangeText={(v) => handleChange('codePostal', v)} />
          <TextInput style={styles.input} placeholder="Ville" placeholderTextColor="#666"
            value={form.ville} onChangeText={(v) => handleChange('ville', v)} />
          <TextInput style={styles.input} placeholder="Téléphone" placeholderTextColor="#666" keyboardType="phone-pad"
            value={form.telephone} onChangeText={(v) => handleChange('telephone', v)} />
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#666" keyboardType="email-address" autoCapitalize="none"
            value={form.email} onChangeText={(v) => handleChange('email', v)} />
          <TextInput style={styles.input} placeholder="SIRET" placeholderTextColor="#666" keyboardType="number-pad"
            value={form.siret} onChangeText={(v) => handleChange('siret', v)} />
          <TextInput style={styles.input} placeholder="Pays (ex: FR)" placeholderTextColor="#666" autoCapitalize="characters"
            value={form.pays} onChangeText={(v) => handleChange('pays', v)} />

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

          <TouchableOpacity style={{ marginTop: 20, padding: 10 }} onPress={() => navigation.navigate('LicencePage')}>
            <Text style={{ color: '#00BFFF', textAlign: 'center', fontSize: 16 }}>🔑 J’ai déjà une licence</Text>
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
    </SafeAreaView>
  );
}

const CARD_MAX = Platform.OS === 'web' ? 220 : 220; // compact partout

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 10 },
  input: {
    backgroundColor: '#1a1a1a', color: '#fff', padding: 12, marginBottom: 12,
    borderRadius: 8, borderWidth: 1, borderColor: '#333',
  },
  subtitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginTop: 20, marginBottom: 10 },
  formulaRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start',
    columnGap: 12, rowGap: 12, marginBottom: 20,
  },
  formulaCard: {
    backgroundColor: '#222', borderRadius: 16, padding: 14,
    width: '100%', maxWidth: CARD_MAX, borderWidth: 1, borderColor: '#444',
  },
  formulaCardSelected: { backgroundColor: '#00BFFF', borderColor: '#00BFFF' },
  formulaTitle: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 6 },
  formulaDetail: { color: '#fff', fontSize: 13 },
  formulaPrice: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginTop: 6 },
  button: { backgroundColor: '#00BFFF', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

// SettingsPage.tsx — API unifiée "cle" + compat pour CGV/prefs
// - GET  /api/licence?cle=...
// - PUT  /api/licence/expediteur { cle, expediteur }
// - PUT  /api/licence/signature  { cle, signature }
// - GET  /api/licence/prefs?cle=...&licenceId=...
// - POST /api/licence/prefs      { cle, licenceId, ... }

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Modal, Pressable, Text, TextInput, StyleSheet,
  TouchableOpacity, Alert, ScrollView, Linking, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

// --- URLs ---
const MENTIONS_URL = `${SERVER_BASE}/legal/mentions.md`;
const PRIVACY_URL  = `${SERVER_BASE}/legal/privacy.md`;
const CGV_LATEST_URL = `${SERVER_BASE}/legal/cgv-2025-08-14.md`;

// Compat: certains endpoints acceptent `cle`, d'autres `id`/`licenceId`
const CGV_STATUS = (cle?: string, id?: string) => {
  const sp = new URLSearchParams();
  if (cle) sp.set('cle', cle);
  if (id)  { sp.set('id', id); sp.set('licenceId', id); }
  return `${SERVER_BASE}/licence/cgv-status?${sp.toString()}`;
};
const LICENCE_PREFS_GET = (cle?: string, id?: string) => {
  const sp = new URLSearchParams();
  if (cle) sp.set('cle', cle);
  if (id)  sp.set('licenceId', id);
  return `${SERVER_BASE}/api/licence/prefs?${sp.toString()}`;
};
const LICENCE_PREFS_POST = `${SERVER_BASE}/api/licence/prefs`;

type CustomMessage = { title: string; content: string };

const safeParseJSON = <T = any,>(raw: string | null): T | null => {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

const normalizeSender = (raw?: string) => {
  let s = String(raw ?? 'OptiCOM').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 3) s = 'OPTICOM';
  if (s.length > 11) s = s.slice(0, 11);
  return s;
};

async function openURLSafe(url: string) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) return Linking.openURL(url);
    Alert.alert('Lien', "Impossible d’ouvrir l’URL.");
  } catch {
    Alert.alert('Lien', "Impossible d’ouvrir l’URL.");
  }
}

// Helpers fetch
async function getJSON(url: string) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}
async function putJSON(path: string, body: any) {
  const r = await fetch(`${SERVER_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}

export default function SettingsPage() {
  const [licence, setLicence] = useState<any>(null); // contient la clé sous licence.licence
  const [expediteurRaw, setExpediteurRaw] = useState('');
  const [signature, setSignature] = useState('');
  const [messages, setMessages] = useState<Record<string, CustomMessage>>({});
  const navigation = useNavigation();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Automatisations (serveur)
  const [autoBirthday, setAutoBirthday] = useState(false);
  const [autoLensRenewal, setAutoLensRenewal] = useState(false);
  const [autoBirthdayMessage, setAutoBirthdayMessage] = useState('Joyeux anniversaire {prenom} !');
  const [autoLensMessage, setAutoLensMessage] = useState('Bonjour {prenom}, pensez au renouvellement de vos lentilles.');
  const [lensAdvanceDays, setLensAdvanceDays] = useState<number>(10);
  const [loadingPrefs, setLoadingPrefs] = useState(false);

  const [cgvInfo, setCgvInfo] = useState<{ accepted?: boolean; acceptedVersion?: string; acceptedAt?: string; currentVersion?: string } | null>(null);

  const expediteurNormalized = useMemo(() => normalizeSender(expediteurRaw), [expediteurRaw]);

  // charge licence & local
  useEffect(() => {
    const loadData = async () => {
      try {
        const [storedLicenceRaw, storedSignature, storedMessagesRaw] = await Promise.all([
          AsyncStorage.getItem('licence'),
          AsyncStorage.getItem('signature'),
          AsyncStorage.getItem('messages'),
        ]);

        const parsedLicence = safeParseJSON<any>(storedLicenceRaw);
        if (parsedLicence) {
          setLicence(parsedLicence);
          const candidate =
            parsedLicence.libelleExpediteur ||
            parsedLicence.opticien?.enseigne ||
            parsedLicence.nom || 'OptiCOM';
          setExpediteurRaw(String(candidate));
          if (typeof parsedLicence.signature === 'string' && parsedLicence.signature.length > 0) {
            setSignature(parsedLicence.signature);
          } else if (typeof storedSignature === 'string') {
            setSignature(storedSignature);
          }
        } else {
          setExpediteurRaw('OptiCOM');
          if (typeof storedSignature === 'string') setSignature(storedSignature);
        }

        if (storedMessagesRaw) {
          const parsed = safeParseJSON<any>(storedMessagesRaw);
          if (parsed && typeof parsed === 'object') {
            const migrated: Record<string, CustomMessage> = {};
            for (const key of Object.keys(parsed)) {
              const value = parsed[key];
              if (typeof value === 'string') {
                migrated[key] = { title: key, content: value };
              } else if (value && typeof value === 'object' && 'content' in value) {
                migrated[key] = { title: value.title || key, content: String(value.content ?? '') };
              }
            }
            setMessages(migrated);
            await AsyncStorage.setItem('messages', JSON.stringify(migrated));
          }
        } else {
          const defaults: Record<string, CustomMessage> = {
            Lunettes:  { title: 'Lunettes',  content: 'Bonjour {prenom} {nom}, vos lunettes sont prêtes. À bientôt !' },
            Lentilles: { title: 'Lentilles', content: 'Bonjour {prenom} {nom}, vos lentilles sont disponibles en magasin.' },
            SAV:       { title: 'SAV',       content: 'Bonjour {prenom} {nom}, votre SAV est terminé, vous pouvez venir le récupérer.' },
            Commande:  { title: 'Commande',  content: 'Bonjour {prenom} {nom}, votre commande est arrivée !' },
          };
          setMessages(defaults);
          await AsyncStorage.setItem('messages', JSON.stringify(defaults));
        }
      } catch (e) {
        console.log('Settings load error:', e);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // IDs (réévalués à chaque render)
  const cleLicence = String(licence?.licence || '').trim();
  const licenceId = String(licence?.id || licence?.opticien?.id || '').trim();

  // --- CGV depuis le serveur (clé/id requis selon handler) ---
  useEffect(() => {
    if (!cleLicence && !licenceId) { setCgvInfo(null); return; }
    (async () => {
      try {
        const r = await fetch(CGV_STATUS(cleLicence, licenceId));
        const j = await r.json();
        if (r.ok) {
          setCgvInfo({
            accepted: !!j.accepted,
            acceptedVersion: j.acceptedVersion || undefined,
            acceptedAt: j.acceptedAt || undefined,
            currentVersion: j.currentVersion || undefined,
          });
        } else {
          setCgvInfo(null);
        }
      } catch {
        setCgvInfo(null);
      }
    })();
  }, [cleLicence, licenceId]);

  // --- Prefs automations (serveur) ---
  useEffect(() => {
    if (!cleLicence && !licenceId) return;

    const loadPrefs = async () => {
      setLoadingPrefs(true);
      try {
        const r = await fetch(LICENCE_PREFS_GET(cleLicence, licenceId));
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

        setAutoBirthday(!!j.autoBirthdayEnabled);
        setAutoLensRenewal(!!j.autoLensRenewalEnabled);
        setAutoBirthdayMessage(String(j.messageBirthday || 'Joyeux anniversaire {prenom} !'));
        setAutoLensMessage(String(j.messageLensRenewal || 'Bonjour {prenom}, pensez au renouvellement de vos lentilles.'));
        const lad = Number.isFinite(+j.lensAdvanceDays) ? Math.max(0, Math.min(60, +j.lensAdvanceDays)) : 10;
        setLensAdvanceDays(lad);

        await AsyncStorage.multiSet([
          ['autoBirthdayEnabled', j.autoBirthdayEnabled ? '1' : '0'],
          ['autoLensRenewalEnabled', j.autoLensRenewalEnabled ? '1' : '0'],
          ['autoBirthdayMessage', String(j.messageBirthday || '')],
          ['autoLensMessage', String(j.messageLensRenewal || '')],
          ['lensAdvanceDays', String(lad)],
        ]);
      } catch {
        // fallback local
        const [b, l, mb, ml, lad] = await Promise.all([
          AsyncStorage.getItem('autoBirthdayEnabled'),
          AsyncStorage.getItem('autoLensRenewalEnabled'),
          AsyncStorage.getItem('autoBirthdayMessage'),
          AsyncStorage.getItem('autoLensMessage'),
          AsyncStorage.getItem('lensAdvanceDays'),
        ]);
        setAutoBirthday(b === '1');
        setAutoLensRenewal(l === '1');
        if (mb) setAutoBirthdayMessage(mb);
        if (ml) setAutoLensMessage(ml);
        setLensAdvanceDays(Number.isFinite(+lad!) ? Math.max(0, Math.min(60, +lad!)) : 10);
      } finally {
        setLoadingPrefs(false);
      }
    };

    loadPrefs();
  }, [cleLicence, licenceId]);

  // --- Sauvegardes côté serveur (utilisent cle; id toléré, ignoré sinon) ---
  const saveSenderRemote = useCallback(
    async (normalized: string) => {
      if (!cleLicence) return false;
      try {
        const data = await putJSON(`/api/licence/expediteur`, { cle: cleLicence, expediteur: normalized, licenceId });
        if ((data?.ok ?? true) && data?.licence) {
          setLicence(data.licence);
          try { await AsyncStorage.setItem('licence', JSON.stringify(data.licence)); } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },
    [cleLicence, licenceId]
  );

  const saveSignatureRemote = useCallback(
    async (sig: string) => {
      if (!cleLicence) return false;
      try {
        const data = await putJSON(`/api/licence/signature`, { cle: cleLicence, signature: sig, licenceId });
        if ((data?.ok ?? true) && data?.licence) {
          setLicence(data.licence);
          try { await AsyncStorage.setItem('licence', JSON.stringify(data.licence)); } catch {}
        }
        return true;
      } catch {
        return false;
      }
    },
    [cleLicence, licenceId]
  );

  const handleSaveBasics = async () => {
    try {
      const normalized = normalizeSender(expediteurRaw);
      if (normalized.length < 3) {
        Alert.alert('Expéditeur', 'Doit contenir 3 à 11 caractères alphanumériques.');
        return;
      }

      await AsyncStorage.setItem('signature', signature);
      if (licence) {
        const updated = { ...licence, libelleExpediteur: normalized, signature };
        await AsyncStorage.setItem('licence', JSON.stringify(updated));
        setLicence(updated);
      }
      setExpediteurRaw(normalized);

      const [okSender, okSig] = await Promise.all([
        saveSenderRemote(normalized),
        saveSignatureRemote(signature),
      ]);

      if (okSender || okSig) {
        Alert.alert('Paramètres', 'Enregistrés avec succès.');
      } else {
        Alert.alert('Paramètres', 'Enregistré localement. (Serveur indisponible)');
      }
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder les paramètres.');
    }
  };

  const handleSaveAutomations = async () => {
    try {
      if (!cleLicence) {
        Alert.alert('Licence', 'Veuillez vous connecter à une licence avant de sauvegarder.');
        return;
      }

      const lad = Math.max(0, Math.min(60, Number.isFinite(+lensAdvanceDays) ? +lensAdvanceDays : 10));

      const res = await fetch(LICENCE_PREFS_POST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cle: cleLicence,
          licenceId, // compat serveur
          autoBirthdayEnabled: autoBirthday,
          autoLensRenewalEnabled: autoLensRenewal,
          lensAdvanceDays: lad,
          messageBirthday: autoBirthdayMessage,
          messageLensRenewal: autoLensMessage,
        }),
      });

      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j?.error || 'SERVER_ERROR');

      await AsyncStorage.multiSet([
        ['autoBirthdayEnabled', autoBirthday ? '1' : '0'],
        ['autoLensRenewalEnabled', autoLensRenewal ? '1' : '0'],
        ['autoBirthdayMessage', autoBirthdayMessage],
        ['autoLensMessage', autoLensMessage],
        ['lensAdvanceDays', String(lad)],
      ]);

      Alert.alert('Automatisations', 'Préférences enregistrées.');
    } catch (e) {
      console.log('Save automations error:', e);
      Alert.alert('Erreur', "Impossible d’enregistrer les automatisations.");
    }
  };

  const handleMessagesSave = async () => {
    try {
      await AsyncStorage.setItem('messages', JSON.stringify(messages));
      Alert.alert('Sauvegardé', 'Messages personnalisés enregistrés.');
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder les messages.');
    }
  };

  const handleAddMessage = () => {
    const newKey = 'MessagePerso' + Date.now();
    setMessages((prev) => ({ ...prev, [newKey]: { title: 'Nouveau message', content: '' } }));
  };

  const handleDeleteMessage = (key: string) => {
    setMessages((prev) => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
  };

  const handleReturnHome = () => {
    // @ts-ignore
    navigation.navigate('Home');
  };

  const handleGoToLicence = () => {
    // @ts-ignore
    navigation.reset({ index: 0, routes: [{ name: 'LicenceCheckPage' }] });
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('licence');
      await AsyncStorage.removeItem('licence.key'); // au cas où
      await AsyncStorage.removeItem('signature');
      // @ts-ignore
      navigation.reset({ index: 0, routes: [{ name: 'LicenceCheckPage' }] });
    } catch {
      Alert.alert('Erreur', 'Impossible de se déconnecter.');
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { flex: 1, justifyContent: 'center', backgroundColor: '#000' }]}>
        <Text style={styles.title}>Chargement des infos…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: '#000' }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>⚙️ Paramètres OptiCOM</Text>

      {!licence && (
        <View style={[styles.block, { borderColor: '#444', borderWidth: 1 }]}>
          <Text style={[styles.value, { marginBottom: 8 }]}>Aucune licence détectée</Text>
          <Text style={styles.label}>
            Connectez-vous pour associer une licence et activer toutes les fonctionnalités.
          </Text>
          <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={handleGoToLicence}>
            <Text style={styles.buttonText}>🔑 Se connecter / Vérifier la licence</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.block}>
        <Text style={styles.label}>Magasin :</Text>
        <Text style={styles.value}>{licence?.opticien?.enseigne || 'Non renseigné'}</Text>

        <Text style={styles.label}>ID licence (interne) :</Text>
        <Text style={styles.value}>{licenceId || 'ID manquant'}</Text>

        <Text style={styles.label}>Clé de licence :</Text>
        <Text style={styles.value}>{cleLicence || 'Clé manquante'}</Text>

        {!!cgvInfo && (
          <>
            <Text style={[styles.label, { marginTop: 14 }]}>CGV :</Text>
            <Text style={styles.value}>
              {cgvInfo.accepted ? `✅ Acceptées (version ${cgvInfo.acceptedVersion || 'n/c'})` : '❌ Non acceptées'}
            </Text>
            {cgvInfo.acceptedAt ? (
              <Text style={[styles.label, { color: '#888' }]}>Le {new Date(cgvInfo.acceptedAt).toLocaleString('fr-FR')}</Text>
            ) : null}
            {cgvInfo.currentVersion && cgvInfo.acceptedVersion !== cgvInfo.currentVersion ? (
              <Text style={[styles.label, { color: '#f6b' }]}>
                Nouvelle version disponible : {cgvInfo.currentVersion}
              </Text>
            ) : null}
          </>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Libellé d’expéditeur pour les SMS :</Text>
        <TextInput
          style={styles.input}
          value={expediteurRaw}
          onChangeText={setExpediteurRaw}
          placeholder="Nom qui apparaîtra dans les SMS"
          placeholderTextColor="#aaa"
          maxLength={11}
        />
        <Text style={[styles.label, { marginTop: 6 }]}>
          Aperçu normalisé : <Text style={{ color: '#fff' }}>{expediteurNormalized}</Text> ({expediteurNormalized.length}/11)
        </Text>

        <Text style={[styles.label, { marginTop: 14 }]}>
          Signature SMS (ajoutée à la fin de chaque message) :
        </Text>
        <TextInput
          style={styles.input}
          value={signature}
          onChangeText={setSignature}
          placeholder="Ex: L’équipe Vision Plus"
          placeholderTextColor="#aaa"
          maxLength={120}
        />

        <TouchableOpacity style={styles.button} onPress={handleSaveBasics}>
          <Text style={styles.buttonText}>💾 Sauvegarder</Text>
        </TouchableOpacity>

        {!!licence?.libelleExpediteur && (
          <Text style={[styles.label, { marginTop: 10 }]}>
            Actuel : <Text style={{ color: '#fff', fontWeight: 'bold' }}>{licence.libelleExpediteur}</Text>
          </Text>
        )}
        {!!licence?.signature && (
          <Text style={[styles.label, { marginTop: 4 }]}>
            Signature : <Text style={{ color: '#fff' }}>{licence.signature}</Text>
          </Text>
        )}
      </View>

      {/* Automatisations */}
      <View style={styles.block}>
        <Text style={[styles.value, { marginBottom: 8 }]}>Automatisations</Text>

        <View style={styles.row}>
          <Text style={styles.label}>Envoi auto — Anniversaire</Text>
          <Switch value={autoBirthday} onValueChange={setAutoBirthday} />
        </View>
        <Text style={[styles.label, { marginTop: 8 }]}>Message anniversaire :</Text>
        <TextInput
          style={styles.input}
          value={autoBirthdayMessage}
          onChangeText={setAutoBirthdayMessage}
          placeholder="Joyeux anniversaire {prenom} !"
          placeholderTextColor="#aaa"
          multiline
        />

        <View style={[styles.row, { marginTop: 12 }]}>
          <Text style={styles.label}>Envoi auto — Renouvellement lentilles</Text>
          <Switch value={autoLensRenewal} onValueChange={setAutoLensRenewal} />
        </View>

        <Text style={[styles.label, { marginTop: 8 }]}>Message renouvellement :</Text>
        <TextInput
          style={styles.input}
          value={autoLensMessage}
          onChangeText={setAutoLensMessage}
          placeholder="Bonjour {prenom}, pensez au renouvellement de vos lentilles."
          placeholderTextColor="#aaa"
          multiline
        />

        <Text style={[styles.label, { marginTop: 8 }]}>Délai avant fin (J-X) :</Text>
        <TextInput
          style={styles.input}
          value={String(lensAdvanceDays)}
          onChangeText={(t) => {
            const n = Math.max(0, Math.min(60, parseInt(t || '0', 10)));
            setLensAdvanceDays(Number.isFinite(n) ? n : 10);
          }}
          keyboardType="number-pad"
          placeholder="10"
          placeholderTextColor="#aaa"
        />
        <Text style={[styles.label, { marginTop: 4, color: '#8aa' }]}>
          Ex. durée 90 jours → SMS à J-10 (80e jour). Durée 6 mois → SMS à 5 mois et 20 jours.
        </Text>

        <TouchableOpacity style={[styles.button, { marginTop: 12, opacity: loadingPrefs ? 0.7 : 1 }]} onPress={handleSaveAutomations} disabled={loadingPrefs}>
          <Text style={styles.buttonText}>{loadingPrefs ? '⏳ Sauvegarde…' : '💾 Sauvegarder les automatisations'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.block}>
        <Text style={styles.label}>Messages personnalisés (manuels) :</Text>

        {Object.entries(messages).map(([key, msg]) => (
          <View key={key} style={styles.messageBlock}>
            <TextInput
              style={styles.input}
              value={msg.title}
              onChangeText={(text) => setMessages((prev) => ({ ...prev, [key]: { ...msg, title: text } }))}
              placeholder="Titre du message"
              placeholderTextColor="#aaa"
            />
            <TextInput
              style={[styles.input, { marginTop: 6 }]}
              value={msg.content}
              onChangeText={(text) => setMessages((prev) => ({ ...prev, [key]: { ...msg, content: text } }))}
              placeholder="Contenu du message"
              placeholderTextColor="#aaa"
              multiline
            />
            <TouchableOpacity style={styles.deleteButton} onPress={() => handleDeleteMessage(key)}>
              <Text style={styles.deleteButtonText}>🗑️ Supprimer</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TouchableOpacity style={styles.addButton} onPress={handleAddMessage}>
          <Text style={styles.buttonText}>➕ Ajouter un message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={handleMessagesSave}>
          <Text style={styles.buttonText}>💾 Enregistrer les messages</Text>
        </TouchableOpacity>
        <Text style={[styles.label, { marginTop: 6, color: '#8aa' }]}>
          Placeholders disponibles : {'{prenom}'} et {'{nom}'}.
        </Text>
      </View>

      {/* Légal */}
      <View style={styles.block}>
        <Text style={styles.label}>Informations légales :</Text>

        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(MENTIONS_URL)}>
          <Text style={styles.linkText}>📜 Mentions légales</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(PRIVACY_URL)}>
          <Text style={styles.linkText}>🔒 Politique de confidentialité</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(CGV_LATEST_URL)}>
          <Text style={styles.linkText}>📄 Conditions Générales de Vente (CGV)</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleReturnHome}>
        <Text style={styles.secondaryButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={() => setShowLogoutModal(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="exit-to-app" size={20} color="#fff" />
          <Text style={styles.logoutButtonText}>Se déconnecter</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={showLogoutModal} transparent animationType="fade" onRequestClose={() => setShowLogoutModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Confirmation</Text>
            <Text style={{ marginBottom: 20 }}>Voulez-vous vraiment vous déconnecter ?</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Pressable onPress={() => setShowLogoutModal(false)} style={{ marginRight: 20 }}>
                <Text style={{ color: 'blue' }}>Annuler</Text>
              </Pressable>
              <Pressable onPress={handleLogout}>
                <Text style={{ color: 'red' }}>Se déconnecter</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 30, paddingBottom: 50 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20, textAlign: 'center' },

  block: { backgroundColor: '#1a1a1a', padding: 20, marginBottom: 25, borderRadius: 12 },

  label: { fontSize: 14, color: '#aaa', marginTop: 10 },
  value: { fontSize: 16, fontWeight: '600', color: '#fff' },

  input: {
    borderColor: '#555',
    borderWidth: 1,
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#111',
    color: '#fff',
  },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  button: { backgroundColor: '#007AFF', marginTop: 15, padding: 12, borderRadius: 8, alignItems: 'center' },
  addButton: { backgroundColor: '#28a745', marginTop: 15, padding: 12, borderRadius: 8, alignItems: 'center' },
  deleteButton: { backgroundColor: '#FF3B30', padding: 10, borderRadius: 6, alignItems: 'center', marginTop: 8 },
  deleteButtonText: { color: '#fff', fontWeight: 'bold' },
  buttonText: { color: '#fff', fontWeight: 'bold' },

  secondaryButton: { padding: 12, borderRadius: 8, backgroundColor: '#333', alignItems: 'center', marginBottom: 10 },
  secondaryButtonText: { color: '#00BFFF', fontWeight: '600' },

  logoutButton: { backgroundColor: '#FF3B30', padding: 12, borderRadius: 8, alignItems: 'center' },
  logoutButtonText: { color: '#fff', fontWeight: 'bold' },

  messageBlock: { marginTop: 15 },

  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: { backgroundColor: 'white', padding: 20, borderRadius: 10, width: '80%', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },

  linkRow: { paddingVertical: 10 },
  linkText: { color: '#1E90FF', fontSize: 16, fontWeight: '600' },
});

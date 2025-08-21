// SettingsPage.tsx — prefs & templates (synchro serveur) — SANS expéditeur/signature

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Modal, Pressable, Text, TextInput, StyleSheet,
  TouchableOpacity, Alert, ScrollView, Linking, Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, CommonActions, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const SERVER_BASE = 'https://opticom-sms-server.onrender.com';

// --- Route racine de l’écran de connexion/licence ---
const LICENCE_ROUTE_NAME = 'LicenceCheckPage';

// --- URLs légales ---
const MENTIONS_URL = `${SERVER_BASE}/legal/mentions.md`;
const PRIVACY_URL  = `${SERVER_BASE}/legal/privacy.md`;
const CGV_LATEST_URL = `${SERVER_BASE}/legal/cgv-2025-08-14.md`;

// --- API builders ---
const LICENCE_GET = (cle?: string, id?: string, bust?: number) => {
  const sp = new URLSearchParams();
  if (cle) sp.set('cle', cle);
  if (id)  sp.set('id', id);
  if (bust) sp.set('_', String(bust)); // anti-cache
  return `${SERVER_BASE}/api/licence?${sp.toString()}`;
};
const CGV_STATUS = (cle?: string, id?: string) => {
  const sp = new URLSearchParams();
  if (cle) sp.set('cle', cle);
  if (id)  sp.set('licenceId', id);
  return `${SERVER_BASE}/licence/cgv-status?${sp.toString()}`;
};
const LICENCE_PREFS_GET  = (licenceId: string) => `${SERVER_BASE}/api/licence/prefs?licenceId=${encodeURIComponent(licenceId)}`;
const LICENCE_PREFS_POST = `${SERVER_BASE}/api/licence/prefs`;
const TEMPLATES_GET  = (licenceId: string) => `${SERVER_BASE}/api/templates?licenceId=${encodeURIComponent(licenceId)}`;
const TEMPLATES_SAVE = `${SERVER_BASE}/api/templates/save`;

// --- Types ---
type CustomMessage = { title: string; content: string };
type TemplateItem  = { id: string; label: string; text: string };

// ✅ parse JSON sûr
function safeParseJSON<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

async function openURLSafe(url: string) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) return Linking.openURL(url);
  } catch {}
  Alert.alert('Lien', 'Impossible d’ouvrir l’URL.');
}

async function getJSON(url: string) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}

export default function SettingsPage() {
  const navigation = useNavigation<any>();

  // --- Flag pour stopper toute sync après logout (évite une reco auto) ---
  const logoutRef = useRef(false);

  // --- Helper pour RESET au niveau du NAVIGATEUR RACINE ---
  const resetToLicenceCheck = useCallback(() => {
    let nav: any = navigation;
    let parent = nav?.getParent?.();
    while (parent) {
      nav = parent;
      parent = nav.getParent?.();
    }
    nav?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: LICENCE_ROUTE_NAME }],
      })
    );
  }, [navigation]);

  const [licence, setLicence] = useState<any>(null);
  const [messages, setMessages] = useState<Record<string, CustomMessage>>({});
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Automatisations
  const [autoBirthday, setAutoBirthday] = useState(false);
  const [autoLensRenewal, setAutoLensRenewal] = useState(false);
  const [autoBirthdayMessage, setAutoBirthdayMessage] = useState('Joyeux anniversaire {prenom} !');
  const [autoLensMessage, setAutoLensMessage] = useState('Bonjour {prenom}, pensez au renouvellement de vos lentilles.');
  const [lensAdvanceDays, setLensAdvanceDays] = useState<number>(10);

  const [cgvInfo, setCgvInfo] = useState<{ accepted?: boolean; acceptedVersion?: string; acceptedAt?: string; currentVersion?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // IDs dérivés
  const cleLicence = String(licence?.licence || '').trim();
  const licenceId  = String(licence?.id || '').trim();

  // -------- helpers ID --------
  const ensureLicenceId = useCallback(async (): Promise<string> => {
    if (logoutRef.current) throw new Error('LOGGED_OUT');
    if (licence?.id) return String(licence.id);

    const local = safeParseJSON<any>(await AsyncStorage.getItem('licence'));
    if (local?.id) return String(local.id);

    const key = String(local?.licence || licence?.licence || '').trim();
    if (!key) throw new Error('NO_LICENCE_KEY');

    const r = await fetch(`${SERVER_BASE}/api/licence?cle=${encodeURIComponent(key)}&_=${Date.now()}`);
    const j = await r.json().catch(() => ({}));
    const id = String((j?.licence ?? j)?.id || '').trim();
    if (!id) throw new Error('LICENCE_NOT_FOUND');
    return id;
  }, [licence]);

  const ensureLicenceKey = useCallback(async (): Promise<string> => {
    if (licence?.licence) return String(licence.licence);
    const loc = safeParseJSON<any>(await AsyncStorage.getItem('licence'));
    if (loc?.licence) return String(loc.licence);
    const raw = await AsyncStorage.getItem('licence.key');
    if (raw) return String(raw);
    throw new Error('NO_LICENCE_KEY');
  }, [licence]);

  // -------- Garde: si pas de licence => redirection immédiate vers LicenceCheck --------
  useFocusEffect(
    useCallback(() => {
      let stopped = false;
      (async () => {
        const stored = safeParseJSON<any>(await AsyncStorage.getItem('licence'));
        if (!stopped && (!stored?.id && !stored?.licence)) {
          resetToLicenceCheck();
        }
      })();
      return () => { stopped = true; };
    }, [resetToLicenceCheck])
  );

  // -------- chargement local + 1er sync --------
  useEffect(() => {
    (async () => {
      try {
        const [storedLicenceRaw, storedMessagesRaw] = await Promise.all([
          AsyncStorage.getItem('licence'),
          AsyncStorage.getItem('messages'),
        ]);

        const parsedLicence = safeParseJSON<any>(storedLicenceRaw);
        if (parsedLicence) {
          setLicence(parsedLicence);
        }

        if (storedMessagesRaw) {
          const parsed = safeParseJSON<any>(storedMessagesRaw);
          if (parsed && typeof parsed === 'object') {
            const migrated: Record<string, CustomMessage> = {};
            for (const key of Object.keys(parsed)) {
              const v = parsed[key];
              migrated[key] =
                typeof v === 'string'
                  ? { title: key, content: v }
                  : { title: v?.title || key, content: String(v?.content ?? '') };
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

      await syncFromServer(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- CGV depuis le serveur ---
  useEffect(() => {
    if (!cleLicence && !licenceId) { setCgvInfo(null); return; }
    (async () => {
      try {
        if (logoutRef.current) return;
        const r = await fetch(CGV_STATUS(cleLicence, licenceId));
        if (logoutRef.current) return;
        const j = await r.json();
        if (r.ok) {
          setCgvInfo({
            accepted: !!j.accepted,
            acceptedVersion: j.acceptedVersion || undefined,
            acceptedAt: j.acceptedAt || undefined,
            currentVersion: j.currentVersion || undefined,
          });
        } else setCgvInfo(null);
      } catch { setCgvInfo(null); }
    })();
  }, [cleLicence, licenceId]);

  // --- Templates : save helper (utilisé aussi par sync) ---
  const saveTemplatesToServer = useCallback(async (licId: string, map: Record<string, CustomMessage>) => {
    if (logoutRef.current) return;
    const items: TemplateItem[] = Object.entries(map).map(([id, v]) => ({ id, label: v.title ?? id, text: v.content ?? '' }));
    const r = await fetch(TEMPLATES_SAVE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenceId: licId, items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }, []);

  // --- Sync licence + prefs + templates ---
  const syncFromServer = useCallback(async (initial = false) => {
    if (logoutRef.current) return;
    if (!cleLicence && !licenceId) return;
    try {
      setSyncing(true); setSyncError(null);

      // 1) licence
      try {
        const licResp = await getJSON(LICENCE_GET(cleLicence, licenceId, Date.now()));
        if (logoutRef.current) return;
        const newLicence = licResp?.licence ?? licResp;
        if (newLicence) {
          setLicence(newLicence);
          await AsyncStorage.setItem('licence', JSON.stringify(newLicence));
        }
      } catch (e) { if (!initial) console.warn('Licence GET failed:', (e as Error).message); }

      // 2) prefs
      if (!logoutRef.current && licenceId) {
        try {
          const prefs = await getJSON(LICENCE_PREFS_GET(licenceId));
          if (logoutRef.current) return;
          setAutoBirthday(!!prefs.autoBirthdayEnabled);
          setAutoLensRenewal(!!prefs.autoLensRenewalEnabled);
          setAutoBirthdayMessage(String(prefs.messageBirthday || 'Joyeux anniversaire {prenom} !'));
          setAutoLensMessage(String(prefs.messageLensRenewal || 'Bonjour {prenom}, pensez au renouvellement de vos lentilles.'));
          const lad = Number.isFinite(+prefs.lensAdvanceDays) ? Math.max(0, Math.min(60, +prefs.lensAdvanceDays)) : 10;
          setLensAdvanceDays(lad);
          await AsyncStorage.multiSet([
            ['autoBirthdayEnabled', prefs.autoBirthdayEnabled ? '1' : '0'],
            ['autoLensRenewalEnabled', prefs.autoLensRenewalEnabled ? '1' : '0'],
            ['autoBirthdayMessage', String(prefs.messageBirthday || '')],
            ['autoLensMessage', String(prefs.messageLensRenewal || '')],
            ['lensAdvanceDays', String(lad)],
          ]);
        } catch (e) { if (!initial) console.warn('Prefs GET failed:', (e as Error).message); }
      }

      // 3) templates
      if (!logoutRef.current && licenceId) {
        try {
          const t = await getJSON(TEMPLATES_GET(licenceId));
          if (logoutRef.current) return;
          const items: TemplateItem[] = Array.isArray(t?.items) ? t.items : [];
          if (items.length) {
            const next: Record<string, CustomMessage> = {};
            for (const it of items) next[it.id] = { title: String(it.label || ''), content: String(it.text || '') };
            setMessages(next);
            await AsyncStorage.setItem('messages', JSON.stringify(next));
          } else if (initial) {
            await saveTemplatesToServer(licenceId, messages);
          }
        } catch (e) { if (!initial) console.warn('Templates GET failed:', (e as Error).message); }
      }
    } catch (e: any) { if (!logoutRef.current) setSyncError(e?.message || 'Erreur inconnue'); }
    finally { if (!logoutRef.current) setSyncing(false); }
  }, [cleLicence, licenceId, messages, saveTemplatesToServer]);

  // --- Automatisations ---
  const handleSaveAutomations = async () => {
    try {
      const id = await ensureLicenceId();
      const lad = Math.max(0, Math.min(60, Number.isFinite(+lensAdvanceDays) ? +lensAdvanceDays : 10));
      const res = await fetch(LICENCE_PREFS_POST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenceId: id,
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
      const id = await ensureLicenceId().catch(() => null);
      if (id) {
        await saveTemplatesToServer(id, messages);
        const t = await getJSON(TEMPLATES_GET(id));
        const items: TemplateItem[] = Array.isArray(t?.items) ? t.items : [];
        const next: Record<string, CustomMessage> = {};
        for (const it of items) next[it.id] = { title: String(it.label || ''), content: String(it.text || '') };
        if (Object.keys(next).length) { setMessages(next); await AsyncStorage.setItem('messages', JSON.stringify(next)); }
      }
      Alert.alert('Sauvegardé', 'Messages personnalisés enregistrés (partagés).');
    } catch (e) {
      console.log('Templates save error:', e);
      Alert.alert('Erreur', 'Impossible de sauvegarder les messages.');
    }
  };

  // --- Navigation helpers ---
  const handleReturnHome = () => { navigation.navigate('Home' as never); };

  const handleGoToLicence = () => {
    resetToLicenceCheck();
  };

  const handleLogout = async () => {
    try {
      logoutRef.current = true; // bloque toute sync/POST qui traîne

      // Nettoyage *total* du stockage de l’app (évite clés oubliées)
      const keys = await AsyncStorage.getAllKeys();
      if (keys && keys.length) await AsyncStorage.multiRemove(keys);

      // Purge état local + fermer la modale
      setShowLogoutModal(false);
      setLicence(null);
      setMessages({});

      // attendre un tick pour laisser React appliquer l’état
      await new Promise(r => setTimeout(r, 0));

      // Reset global vers l’écran de licence
      resetToLicenceCheck();
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
    <ScrollView style={{ backgroundColor: '#000' }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.title}>⚙️ Paramètres OptiCOM</Text>
        <TouchableOpacity onPress={() => syncFromServer()} style={styles.syncBtn}>
          <Text style={styles.syncBtnText}>{syncing ? '…' : '↻ Sync'}</Text>
        </TouchableOpacity>
      </View>
      {syncError ? <Text style={styles.syncError}>⚠ {syncError}</Text> : null}

      {!licence && (
        <View style={[styles.block, { borderColor: '#444', borderWidth: 1 }]}>
          <Text style={[styles.value, { marginBottom: 8 }]}>Aucune licence détectée</Text>
          <Text style={styles.label}>Connectez-vous pour associer une licence et activer toutes les fonctionnalités.</Text>
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
            <Text style={styles.value}>{cgvInfo.accepted ? `✅ Acceptées (version ${cgvInfo.acceptedVersion || 'n/c'})` : '❌ Non acceptées'}</Text>
            {cgvInfo.acceptedAt ? <Text style={[styles.label, { color: '#888' }]}>Le {new Date(cgvInfo.acceptedAt).toLocaleString('fr-FR')}</Text> : null}
            {cgvInfo.currentVersion && cgvInfo.acceptedVersion !== cgvInfo.currentVersion ? (
              <Text style={[styles.label, { color: '#f6b' }]}>Nouvelle version disponible : {cgvInfo.currentVersion}</Text>
            ) : null}
          </>
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
        <TextInput style={styles.input} value={autoBirthdayMessage} onChangeText={setAutoBirthdayMessage} placeholder="Joyeux anniversaire {prenom} !" placeholderTextColor="#aaa" multiline />

        <View style={[styles.row, { marginTop: 12 }]}>
          <Text style={styles.label}>Envoi auto — Renouvellement lentilles</Text>
          <Switch value={autoLensRenewal} onValueChange={setAutoLensRenewal} />
        </View>

        <Text style={[styles.label, { marginTop: 8 }]}>Message renouvellement :</Text>
        <TextInput style={styles.input} value={autoLensMessage} onChangeText={setAutoLensMessage} placeholder="Bonjour {prenom}, pensez au renouvellement de vos lentilles." placeholderTextColor="#aaa" multiline />

        <Text style={[styles.label, { marginTop: 8 }]}>Délai avant fin (J-X) :</Text>
        <TextInput
          style={styles.input}
          value={String(lensAdvanceDays)}
          onChangeText={(t) => { const n = Math.max(0, Math.min(60, parseInt(t || '0', 10))); setLensAdvanceDays(Number.isFinite(n) ? n : 10); }}
          keyboardType="number-pad"
          placeholder="10"
          placeholderTextColor="#aaa"
        />
        <Text style={[styles.label, { marginTop: 4, color: '#8aa' }]}>
          Ex. durée 90 jours → SMS à J-10 (80e jour). Durée 6 mois → SMS à 5 mois et 20 jours.
        </Text>

        <TouchableOpacity style={[styles.button, { marginTop: 12 }]} onPress={handleSaveAutomations}>
          <Text style={styles.buttonText}>💾 Sauvegarder les automatisations</Text>
        </TouchableOpacity>
      </View>

      {/* Messages manuels (templates) */}
      <View style={styles.block}>
        <Text style={styles.label}>Messages personnalisés (manuels) :</Text>
        {Object.entries(messages).map(([key, msg]) => (
          <View key={key} style={styles.messageBlock}>
            <TextInput style={styles.input} value={msg.title} onChangeText={(text) => setMessages((p) => ({ ...p, [key]: { ...msg, title: text } }))} placeholder="Titre du message" placeholderTextColor="#aaa" />
            <TextInput style={[styles.input, { marginTop: 6 }]} value={msg.content} onChangeText={(text) => setMessages((p) => ({ ...p, [key]: { ...msg, content: text } }))} placeholder="Contenu du message" placeholderTextColor="#aaa" multiline />
            <TouchableOpacity style={styles.deleteButton} onPress={() => { setMessages((p) => { const u = { ...p }; delete u[key]; return u; }); }}>
              <Text style={styles.deleteButtonText}>🗑️ Supprimer</Text>
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.addButton} onPress={() => setMessages((p) => ({ ...p, ['msg-' + Date.now()]: { title: 'Nouveau message', content: '' } }))}>
          <Text style={styles.buttonText}>➕ Ajouter un message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={handleMessagesSave}>
          <Text style={styles.buttonText}>💾 Enregistrer les messages (partagés)</Text>
        </TouchableOpacity>
        <Text style={[styles.label, { marginTop: 6, color: '#8aa' }]}>
          Placeholders : {'{prenom}'} et {'{nom}'}.
        </Text>
      </View>

      {/* Légal */}
      <View style={styles.block}>
        <Text style={styles.label}>Informations légales :</Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(MENTIONS_URL)}><Text style={styles.linkText}>📜 Mentions légales</Text></TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(PRIVACY_URL)}><Text style={styles.linkText}>🔒 Politique de confidentialité</Text></TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => openURLSafe(CGV_LATEST_URL)}><Text style={styles.linkText}>📄 Conditions Générales de Vente (CGV)</Text></TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.secondaryButton} onPress={handleReturnHome}>
        <Text style={styles.secondaryButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={() => setShowLogoutModal(true)}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
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

/* ========== styles ========== */
const styles = StyleSheet.create({
  container: { padding: 30, paddingBottom: 50 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 20, textAlign: 'center' },
  block: { backgroundColor: '#1a1a1a', padding: 20, marginBottom: 25, borderRadius: 12 },
  label: { fontSize: 14, color: '#aaa', marginTop: 10 },
  value: { fontSize: 16, fontWeight: '600', color: '#fff' },
  input: { borderColor: '#555', borderWidth: 1, marginTop: 10, padding: 10, borderRadius: 8, backgroundColor: '#111', color: '#fff' },
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
  syncBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#1f2937', borderRadius: 6 },
  syncBtnText: { color: '#cdeafe', fontWeight: '600' },
  syncError: { color: '#ff6b6b', marginTop: 6 },
});

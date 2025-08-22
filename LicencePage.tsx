import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  ScrollView,
  ActivityIndicator,
  Linking,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import { Licence } from './types';
import API_BASE from './src/config/api';

/* ───────── helpers SecureStore ───────── */
async function saveLicenceKeySecure(key: string) {
  try { await SecureStore.setItemAsync('licenceKey', key); } catch {}
  try { await AsyncStorage.setItem('licenceKey', key); } catch {}
}

/* ───────── CGV Modal ───────── */
function CGVModalRN({
  visible,
  licenceId,
  version,
  textUrl,
  serverTextHash,
  onAccepted,
  onCancel,
}: {
  visible: boolean;
  licenceId: string;
  version: string;
  textUrl: string;
  serverTextHash: string | null;
  onAccepted: () => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState<string>('');
  const [checked, setChecked] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setChecked(false);
    setScrolled(false);
    setLoading(false);
    setText('');
    fetch(textUrl)
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Erreur de chargement des CGV.'));
  }, [visible, textUrl, version]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const fitsScreen = contentSize.height <= layoutMeasurement.height + 2;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 12;
    if (fitsScreen || atBottom) setScrolled(true);
  };

  const accept = async () => {
    if (!serverTextHash) {
      Alert.alert('Erreur', 'Hash CGV indisponible sur le serveur.');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/licence/cgv-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenceId, version, textHash: serverTextHash }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Erreur', j.error || 'Enregistrement impossible.');
        setLoading(false);
        return;
      }
      await AsyncStorage.setItem('cgvAcceptedVersion', version);
      onAccepted();
    } catch {
      Alert.alert('Erreur', 'Problème réseau.');
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Conditions Générales de Vente</Text>
          <Text style={styles.modalSubtitle}>Version : {version}</Text>

          <View style={styles.modalBox}>
            {!text ? (
              <View style={{ padding: 16, alignItems: 'center' }}>
                <ActivityIndicator />
                <Text style={{ marginTop: 8 }}>Chargement…</Text>
              </View>
            ) : (
              <ScrollView onScroll={handleScroll} scrollEventThrottle={16} contentContainerStyle={{ padding: 12 }}>
                <Text style={styles.mono}>{text}</Text>
              </ScrollView>
            )}
          </View>

          <TouchableOpacity style={styles.checkRow} onPress={() => setChecked((c) => !c)} activeOpacity={0.7}>
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
              {checked && <Text style={{ color: '#fff' }}>✓</Text>}
            </View>
            <Text style={{ flex: 1 }}>J’ai lu et j’accepte les CGV.</Text>
          </TouchableOpacity>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openURL(textUrl)}>
              <Text style={styles.secondaryBtnText}>Ouvrir</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, (!checked || !scrolled || loading) && styles.btnDisabled]}
              disabled={!checked || !scrolled || loading}
              onPress={accept}
            >
              <Text style={styles.primaryBtnText}>{loading ? 'Enregistrement…' : 'Accepter'}</Text>
            </TouchableOpacity>
          </View>

          {onCancel ? (
            <TouchableOpacity style={{ marginTop: 6 }} onPress={onCancel}>
              <Text style={styles.cancelText}>Annuler</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.helper}>(Faites défiler jusqu’en bas et cochez la case pour valider.)</Text>
        </View>
      </View>
    </Modal>
  );
}

/* ───────── Modal création de compte (après CGV) ───────── */
function CreateAccountModal({
  visible,
  defaultEmail,
  licenceIdOrKey,
  onDone,
  onSkip,
}: {
  visible: boolean;
  defaultEmail?: string | null;
  licenceIdOrKey: string;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail || '');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setEmail(defaultEmail || '');
      setPwd('');
      setPwd2('');
      setErr(null);
      setLoading(false);
    }
  }, [visible, defaultEmail]);

  const submit = async () => {
    setErr(null);
    const e = email.trim();
    if (!e || !/.+@.+\..+/.test(e)) { setErr('Adresse e-mail invalide.'); return; }
    if (!pwd || pwd.length < 8) { setErr('Mot de passe trop court (min. 8 caractères).'); return; }
    if (pwd !== pwd2) { setErr('Les mots de passe ne correspondent pas.'); return; }

    setLoading(true);
    try {
      const body: any = { email: e, password: pwd };
      // on envoie licenceId ou licenceKey selon ce qu’on a
      if (/^[0-9a-f-]{16,}$/i.test(licenceIdOrKey)) body.licenceId = licenceIdOrKey;
      else body.licenceKey = licenceIdOrKey;

      const r = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok || j?.ok === false) {
        const msg = j?.error || (r.status === 409 ? 'Cet e-mail est déjà utilisé.' : 'Création de compte impossible.');
        setErr(msg);
        setLoading(false);
        return;
      }

      try { await AsyncStorage.setItem('authEmail', e); } catch {}
      Alert.alert('Compte créé', 'Votre compte a été créé. Vous pourrez vous connecter depuis l’écran d’accueil.');
      onDone();
    } catch (e: any) {
      setErr(e?.message || 'Erreur réseau.');
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Créer votre compte</Text>
          <Text style={styles.modalSubtitle}>Cela vous permettra de vous reconnecter facilement (e-mail + mot de passe).</Text>

          <TextInput
            style={styles.input}
            placeholder="Adresse e-mail"
            placeholderTextColor="#666"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Mot de passe (min. 8 caractères)"
            placeholderTextColor="#666"
            secureTextEntry
            value={pwd}
            onChangeText={setPwd}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            placeholder="Confirmer le mot de passe"
            placeholderTextColor="#666"
            secureTextEntry
            value={pwd2}
            onChangeText={setPwd2}
          />
          {err ? <Text style={{ color: '#d00', marginTop: 8 }}>{err}</Text> : null}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onSkip} disabled={loading}>
              <Text style={styles.secondaryBtnText}>Plus tard</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={loading}>
              <Text style={styles.primaryBtnText}>{loading ? 'Création…' : 'Créer le compte'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ───────── Page Licence ───────── */
export default function LicencePage() {
  const [cle, setCle] = useState('');
  const [licence, setLicence] = useState<Licence | null>(null);
  const [showCGV, setShowCGV] = useState(false);
  const [cgvMeta, setCgvMeta] = useState<{ version: string; textUrl: string; serverTextHash: string | null }>({
    version: '',
    textUrl: '',
    serverTextHash: null,
  });

  // création de compte
  const [showCreateAccount, setShowCreateAccount] = useState(false);

  const navigation = useNavigation<any>();

  useEffect(() => {
    (async () => {
      try {
        const data = await AsyncStorage.getItem('licence');
        if (data) {
          const parsed: any = JSON.parse(data);
          const storedKeyForDisplay = String(parsed.licence ?? parsed.cle ?? parsed.key ?? '');
          setLicence(parsed);
          setCle(storedKeyForDisplay);
        }
      } catch (error) {
        console.error('Erreur lors du chargement local :', error);
      }
    })();
  }, []);

  const verifierLicence = async () => {
    const keyInput = (cle || '').trim();
    if (!keyInput) {
      Alert.alert('Erreur', 'Merci de saisir votre clé de licence.');
      return;
    }

    const key = keyInput.replace(/\s+/g, '');

    // Stub local (hors-ligne)
    await AsyncStorage.setItem('licenceKey', key);
    await saveLicenceKeySecure(key);
    await AsyncStorage.setItem('licence', JSON.stringify({ cle: key }));

    let trouvee: Licence | undefined;
    let lastErrText = '';

    const paths = [
      `/api/licence/by-key?cle=${encodeURIComponent(key)}`,
      `/licence/by-key?cle=${encodeURIComponent(key)}`,
      `/licence?cle=${encodeURIComponent(key)}`,
    ];

    for (const p of paths) {
      const url = `${API_BASE}${p}${p.includes('?') ? '&' : '?'}t=${Date.now()}`;
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } as any });
        const ct = res.headers.get('content-type') || '';
        const bodyText = await res.text();

        if (!res.ok) {
          lastErrText = `${res.status} ${bodyText.slice(0, 160)}`;
          continue;
        }
        if (!/application\/json/i.test(ct)) {
          lastErrText = `Réponse non JSON (${ct})`;
          continue;
        }

        let j: any = {};
        try { j = JSON.parse(bodyText); } catch { lastErrText = 'JSON invalide'; continue; }
        const lic = j?.licence ?? j;
        if (lic && (lic.cle || lic.licence || lic.key || lic.id)) {
          trouvee = lic as Licence;
          break;
        }
      } catch (e: any) {
        lastErrText = e?.message || String(e);
      }
    }

    if (!trouvee) {
      console.log('Lookup licence échec:', lastErrText);
      Alert.alert('Erreur', 'Licence introuvable.');
      return;
    }

    const resolvedKeyRaw = String(
      (trouvee as any).licence ?? (trouvee as any).cle ?? (trouvee as any).key ?? key
    );
    await AsyncStorage.setItem('licence', JSON.stringify(trouvee));
    await AsyncStorage.setItem('licenceKey', resolvedKeyRaw);
    await saveLicenceKeySecure(resolvedKeyRaw);
    await AsyncStorage.setItem('localLicence', JSON.stringify(trouvee));
    setLicence(trouvee);

    const licenceIdForCgv = resolvedKeyRaw || String((trouvee as any).id || '');

    try {
      const r = await fetch(
        `${API_BASE}/licence/cgv-status?licenceId=${encodeURIComponent(licenceIdForCgv)}&t=${Date.now()}`
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        Alert.alert('Erreur', j.error || 'Statut CGV indisponible.');
        return;
      }

      if (!j.accepted || j.currentVersion !== j.acceptedVersion) {
        setCgvMeta({
          version: j.currentVersion,
          textUrl: j.textUrl,
          serverTextHash: j.serverTextHash || null,
        });
        setShowCGV(true);
      } else {
        await AsyncStorage.setItem('cgvAcceptedVersion', j.acceptedVersion || j.currentVersion);
        // 👉 si CGV déjà ok, on tente de savoir si un compte existe
        await maybeShowCreateAccount(trouvee, resolvedKeyRaw);
      }
    } catch {
      const acceptedVersion = await AsyncStorage.getItem('cgvAcceptedVersion');
      if (acceptedVersion) {
        // pas de réseau, on passe quand même
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } else {
        Alert.alert('Erreur', 'Impossible de vérifier les CGV.');
      }
    }
  };

  const maybeShowCreateAccount = async (lic: Licence | null, licenceKeyOrId: string) => {
    // Essaie de détecter si un compte existe déjà. Si l’endpoint n’existe pas → on affiche la création.
    try {
      const res = await fetch(
        `${API_BASE}/auth/has-account?licenceId=${encodeURIComponent(
          (lic as any)?.id || licenceKeyOrId
        )}`
      );
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.accountExists) {
          Alert.alert('Licence activée', `Bienvenue ${lic?.opticien?.enseigne || ''}`);
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          return;
        }
      }
    } catch {}
    // soit endpoint KO, soit pas de compte → on propose de créer
    setShowCreateAccount(true);
  };

  const onCgvAccepted = async () => {
    setShowCGV(false);
    if (cgvMeta.version) await AsyncStorage.setItem('cgvAcceptedVersion', cgvMeta.version);

    const keyOrId =
      String((licence as any)?.licence || (licence as any)?.cle || (licence as any)?.key || (licence as any)?.id || '');
    // Après CGV → étape création compte (si pas déjà existant)
    await maybeShowCreateAccount(licence, keyOrId);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Paramètres / Licence</Text>

      <Text style={styles.label}>Clé de licence :</Text>
      <TextInput
        style={styles.input}
        value={cle}
        onChangeText={setCle}
        placeholder="ex: OPTICOM-12345"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity style={styles.button} onPress={verifierLicence}>
        <Text style={styles.buttonText}>Vérifier la licence</Text>
      </TouchableOpacity>

      <TouchableOpacity style={{ marginTop: 20 }} onPress={() => navigation.goBack()}>
        <Text style={{ color: '#999' }}>⬅️ Retour</Text>
      </TouchableOpacity>

      <CGVModalRN
        visible={showCGV}
        licenceId={String(
          (licence as any)?.licence ??
          (licence as any)?.cle ??
          (licence as any)?.key ??
          (licence as any)?.id ??
          ''
        )}
        version={cgvMeta.version}
        textUrl={cgvMeta.textUrl}
        serverTextHash={cgvMeta.serverTextHash}
        onAccepted={onCgvAccepted}
      />

      <CreateAccountModal
        visible={showCreateAccount}
        defaultEmail={(licence as any)?.opticien?.email || ''}
        licenceIdOrKey={String(
          (licence as any)?.id ||
          (licence as any)?.licence ||
          (licence as any)?.cle ||
          (licence as any)?.key ||
          ''
        )}
        onDone={() => {
          setShowCreateAccount(false);
          Alert.alert('Licence activée', `Bienvenue ${licence?.opticien?.enseigne || ''}`);
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        }}
        onSkip={() => {
          setShowCreateAccount(false);
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        }}
      />
    </View>
  );
}

/* ───────── Styles ───────── */
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 20 },
  label: { fontSize: 16, marginTop: 15 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 6,
    marginTop: 5,
  },
  button: {
    marginTop: 15,
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: 'bold' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: 'white',
    width: '100%',
    maxWidth: 720,
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  modalSubtitle: { fontSize: 12, color: '#666', marginTop: 4, marginBottom: 8 },
  modalBox: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    height: 320,
    backgroundColor: '#F7F7F7',
  },
  mono: { fontFamily: 'System', fontSize: 13, lineHeight: 18, color: '#111' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  checkboxChecked: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  primaryBtn: { backgroundColor: '#2563EB', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  secondaryBtn: { borderWidth: 1, borderColor: '#ccc', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  secondaryBtnText: { color: '#111' },
  btnDisabled: { opacity: 0.5 },
  cancelText: { textAlign: 'center', color: '#999' },
  helper: { fontSize: 11, color: '#777', marginTop: 6, textAlign: 'center' },
});

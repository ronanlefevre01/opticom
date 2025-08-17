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
import { Licence } from './types';
import API_BASE from './src/config/api';

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
        Alert.alert('Erreur', j.error || "Enregistrement impossible.");
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

    // On enlève seulement les espaces (on garde tirets & casse)
    const key = keyInput.replace(/\s+/g, '');

    // Stub local pour passer le gate si reboot hors-ligne
    await AsyncStorage.setItem('licenceKey', key);
    await AsyncStorage.setItem('licence', JSON.stringify({ cle: key }));

    let trouvee: Licence | undefined;
    let lastErrText = '';

    // ✅ Priorité à /api/licence/by-key (c’est celle qui fonctionne chez toi)
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

    // 🔄 Sauvegarde locale + cache hors-ligne
    const resolvedKeyRaw = String(
      (trouvee as any).licence ?? (trouvee as any).cle ?? (trouvee as any).key ?? key
    );
    await AsyncStorage.setItem('licence', JSON.stringify(trouvee));
    await AsyncStorage.setItem('licenceKey', resolvedKeyRaw);
    await AsyncStorage.setItem('localLicence', JSON.stringify(trouvee));
    setLicence(trouvee);

    // 👉 Pour le check CGV, on envoie la clé telle qu’elle est (sinon l’id)
    const licenceIdForCgv =
      resolvedKeyRaw || String((trouvee as any).id || '');

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
        Alert.alert('Licence activée', `Bienvenue ${trouvee.opticien?.enseigne || ''}`);
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    } catch {
      const acceptedVersion = await AsyncStorage.getItem('cgvAcceptedVersion');
      if (acceptedVersion) {
        Alert.alert('Mode hors-ligne', 'Accès accordé (CGV déjà acceptées).');
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } else {
        Alert.alert('Erreur', 'Impossible de vérifier les CGV.');
      }
    }
  };

  const onCgvAccepted = async () => {
    setShowCGV(false);
    if (cgvMeta.version) {
      await AsyncStorage.setItem('cgvAcceptedVersion', cgvMeta.version);
    }
    Alert.alert('Licence activée', `Bienvenue ${licence?.opticien?.enseigne || ''}`);
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
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

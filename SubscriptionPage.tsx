import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Modal, Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import API_BASE from './src/config/api';

/* ================= Config serveur ================= */
const SERVER_BASE = API_BASE; // centralisé

/* 💰 Tarifs (affichage uniquement) */
const PRICE_HT_PER_PACK = 6.0; // € HT / 100 SMS
const TVA_RATE = 0.20;

const formulas = [
  { id: 'starter', name: 'Starter', credits: 100 },
  { id: 'pro', name: 'Pro', credits: 300 },
  { id: 'premium', name: 'Premium', credits: 600 },
  { id: 'alacarte', name: 'À la carte', credits: 0 },
];

type FactureItem = {
  id?: string;
  date?: string;
  type?: string;      // "Abonnement" | "GoCardless" | "Stripe" | ...
  url?: string;       // ancien schéma éventuel: /factures/XYZ.pdf (relatif)
  urlPdf?: string;    // nouveau schéma: URL absolue
  fichierPdf?: string;// nouveau schéma: nom de fichier (à préfixer)
  montantHT?: number;
  tva?: number;
  montantTTC?: number;
  credits?: number;
};

function ymKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabelFR(d: Date) {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(d);
}
function safeInvoiceUrl(f: FactureItem) {
  if (f?.urlPdf) return f.urlPdf;
  if (f?.fichierPdf) return `${SERVER_BASE}/factures/${f.fichierPdf}`;
  if (f?.url) return `${SERVER_BASE}${f.url.startsWith('/') ? '' : '/'}${f.url}`;
  return null;
}

/* ====== calcule le premier mois à afficher selon licence + historique ====== */
function firstMonthFrom(licence: any, data: any) {
  const candidates: (string | Date | undefined)[] = [
    licence?.dateCreation,
    licence?.createdAt,
    licence?.created,
  ];
  const allDates: Date[] = candidates
    .filter(Boolean)
    .map((x: any) => new Date(x))
    .filter((d) => !isNaN(+d));

  const scan = (arr: any[], key: string) =>
    (arr || []).map((x) => new Date(x?.[key] || '')).filter((d) => !isNaN(+d));

  allDates.push(
    ...scan(data?.historiqueSms, 'date'),
    ...scan(data?.historique, 'date'),
    ...scan(data?.achats, 'date'),
    ...scan(data?.factures, 'date')
  );

  if (allDates.length === 0) return null;
  const min = allDates.reduce((a, b) => (a < b ? a : b));
  return new Date(min.getFullYear(), min.getMonth(), 1);
}

/* ====== fetch licence depuis TON serveur (plus de JSONBin direct) ====== */
async function fetchLicenceFromServer(localLic: any): Promise<any | null> {
  const id = String(localLic?.id || localLic?.opticien?.id || '').trim();
  const rawKey = String(localLic?.licence || localLic?.cle || localLic?.key || '').trim();
  const keyNorm = rawKey ? rawKey.replace(/\s+/g, '') : '';

  const paths: string[] = [];
  if (id) {
    paths.push(`/licence/by-id?licenceId=${encodeURIComponent(id)}`);
    paths.push(`/licence-by-id?licenceId=${encodeURIComponent(id)}`);
    paths.push(`/licence?licenceId=${encodeURIComponent(id)}`);
  }
  if (keyNorm) {
    paths.push(`/licence/by-key?cle=${encodeURIComponent(keyNorm)}`);
    paths.push(`/licence-by-key?cle=${encodeURIComponent(keyNorm)}`);
  }

  let lastErr: any = null;
  for (const p of paths) {
    try {
      const res = await fetch(`${SERVER_BASE}${p}`);
      const text = await res.text();
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}: ${text}`); continue; }
      let j: any = {};
      try { j = JSON.parse(text); } catch { continue; }
      const lic = j?.licence ?? j;
      if (lic) return lic;
    } catch (e) { lastErr = e; }
  }
  console.warn('fetchLicenceFromServer failed:', lastErr?.message || lastErr);
  return null;
}

export default function SubscriptionPage() {
  const navigation = useNavigation();
  const [licence, setLicence] = useState<any>(null);
  const [formuleName, setFormuleName] = useState('');
  const [credits, setCredits] = useState(0);
  const [data, setData] = useState<{
    formule: string;
    renouvellement: string | null;
    resiliationDate: string | null;
    historiqueSms: any[];
    achats: any[];
    factures: FactureItem[];
  } | null>(null);

  const [buyModalVisible, setBuyModalVisible] = useState(false);
  const [resiliationModal, setResiliationModal] = useState(false);
  const [resiliationLoading, setResiliationLoading] = useState(false);
  const [successModalVisible, setSuccessModalVisible] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const [changeModalVisible, setChangeModalVisible] = useState(false);
  const [nextFormula, setNextFormula] = useState<'starter' | 'pro' | 'premium'>('starter');
  const [changeLoading, setChangeLoading] = useState(false);

  const formulaLabel = (id: string) =>
    ({ starter: 'Starter', pro: 'Pro', premium: 'Premium', alacarte: 'À la carte' } as any)[id] || id;

  const totalHT = +(PRICE_HT_PER_PACK * quantity).toFixed(2);
  const totalTVA = +(totalHT * TVA_RATE).toFixed(2);
  const totalTTC = +(totalHT + totalTVA).toFixed(2);

  const applyLicence = useCallback(async (lic: any) => {
    if (!lic) return;
    setLicence(lic);

    const safeCredits = Number.isFinite(Number(lic.credits ?? lic.creditsRestants))
      ? Number(lic.credits ?? lic.creditsRestants)
      : 0;
    setCredits(safeCredits);
    setEmail(lic.opticien?.email || lic.email || '');

    const rawFormule = String(lic.abonnement || lic.formule || lic.formuleId || '').trim().toLowerCase();
    const f = formulas.find((x) => x.id === rawFormule);
    setFormuleName(f?.name || lic.abonnement || lic.formule || 'Formule inconnue');

    setData({
      formule: rawFormule,
      renouvellement: lic.renouvellement || lic.next_payment_date || null,
      resiliationDate: lic.resiliationDate || lic.resiliationAt || null,
      historiqueSms: Array.isArray(lic.historiqueSms)
        ? lic.historiqueSms
        : Array.isArray(lic.historique)
        ? lic.historique
        : [],
      achats: Array.isArray(lic.achats) ? lic.achats : [],
      factures: Array.isArray(lic.factures) ? lic.factures : [],
    });

    try { await AsyncStorage.setItem('licence', JSON.stringify(lic)); } catch {}
  }, []);

  const refreshFromRemote = useCallback(async () => {
    const local = await AsyncStorage.getItem('licence');
    const lic = local ? JSON.parse(local) : null;
    if (!lic) return;
    const remote = await fetchLicenceFromServer(lic);
    if (remote) await applyLicence(remote);
  }, [applyLicence]);

  const refreshCredits = useCallback(async () => {
    if (!licence) return;
    const remote = await fetchLicenceFromServer(licence);
    if (remote) await applyLicence(remote);
  }, [licence, applyLicence]);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const local = await AsyncStorage.getItem('licence');
      const localLic = local ? JSON.parse(local) : null;
      if (localLic) await applyLicence(localLic);
      const remote = await fetchLicenceFromServer(localLic || {});
      if (remote) await applyLicence(remote);
    } finally {
      setLoading(false);
    }
  }, [applyLicence]);

  useEffect(() => { bootstrap(); }, [bootstrap]);
  useFocusEffect(useCallback(() => { (async () => { await refreshFromRemote(); })(); }, [refreshFromRemote]));

  /* ====== Agrégation “mois par mois” ====== */
  const monthlyRows = useMemo(() => {
    if (!licence || !data) return [];
    const start = firstMonthFrom(licence, data);
    if (!start) return [];

    const now = new Date();
    const nowFirst = new Date(now.getFullYear(), now.getMonth(), 1);
    const map = new Map<string, { key: string; moisLabel: string; sent: number; bought: number; invoice?: FactureItem | null }>();

    // préremplissage
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= nowFirst) {
      const key = ymKey(d);
      map.set(key, { key, moisLabel: monthLabelFR(d), sent: 0, bought: 0, invoice: null });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    for (const m of data.historiqueSms) {
      const dd = new Date(m.date || m.mois || '');
      if (isNaN(+dd)) continue;
      const key = ymKey(new Date(dd.getFullYear(), dd.getMonth(), 1));
      if (!map.has(key)) continue;
      map.get(key)!.sent += Number(m.credits || m.envoyes || 0);
    }

    for (const a of data.achats) {
      const dd = new Date(a.date || '');
      if (isNaN(+dd)) continue;
      const key = ymKey(new Date(dd.getFullYear(), dd.getMonth(), 1));
      if (!map.has(key)) continue;
      map.get(key)!.bought += Number(a.credits || 0);
    }

    for (const f of data.factures) {
      if (!/abonnement/i.test(String(f.type || ''))) continue;
      const dd = new Date(f.date || '');
      if (isNaN(+dd)) continue;
      const key = ymKey(new Date(dd.getFullYear(), dd.getMonth(), 1));
      if (!map.has(key)) continue;
      const prev = map.get(key)!.invoice;
      if (!prev || new Date(f.date!) > new Date(prev.date!)) map.get(key)!.invoice = f;
    }

    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [licence, data]);

  const purchaseInvoices = useMemo<FactureItem[]>(
    () =>
      (data?.factures || [])
        .filter((f) => /gocardless|stripe/i.test(String(f.type || '')))
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()),
    [data?.factures]
  );

  const handleRefresh = async () => {
    if (!licence) return;
    setLoading(true);
    await refreshCredits();
    setLoading(false);
  };

  const handlePaiement = async () => {
    setBuyModalVisible(false);
    if (!licence || !data) return;

    const lots = Math.max(1, quantity);
    const isALaCarte = String(data.formule || '').includes('carte');

    if (isALaCarte) {
      try {
        const res = await axios.post(`${SERVER_BASE}/create-checkout-session`, {
          clientEmail: email, quantity: lots,
        });
        if (res.data?.url) Linking.openURL(res.data.url);
        else Alert.alert('Paiement', 'Impossible d’ouvrir la page de paiement.');
      } catch {
        Alert.alert('Paiement', 'Erreur lors du paiement Stripe.');
      }
      return;
    }

    try {
      const res = await axios.post(`${SERVER_BASE}/achat-credits-gocardless`, { email, quantity: lots });
      if (res.status === 409 || res.data?.error === 'MANDATE_INACTIVE') {
        const renewUrl = res.data?.renew_redirect_url;
        Alert.alert('Mandat inactif', 'Votre mandat GoCardless est inactif.', renewUrl ? [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Renouveler', onPress: () => Linking.openURL(renewUrl) }
        ] : [{ text: 'OK' }]);
        return;
      }
      if (res.data?.success) {
        await refreshCredits(); setSuccessModalVisible(true);
      } else {
        Alert.alert('Paiement', 'Réponse inattendue du serveur.');
      }
    } catch (err: any) {
      Alert.alert('GoCardless', err?.response?.data?.error || 'Erreur GoCardless.');
    }
  };

  const confirmResiliation = async () => {
    if (!email) { Alert.alert('Résiliation', "Email de la licence introuvable."); return; }
    setResiliationLoading(true);
    try {
      const res = await axios.post(`${SERVER_BASE}/resiliation-abonnement`, { email });
      setResiliationModal(false);
      if (res.data?.success) {
        await refreshCredits();
        Alert.alert('Résiliation',
          res.data?.message || (res.data?.resiliationDate
            ? `Résiliation programmée pour le ${res.data.resiliationDate}.`
            : 'Résiliation programmée à la prochaine échéance.'));
      } else {
        Alert.alert('Résiliation', res.data?.error || 'Impossible de programmer la résiliation.');
      }
    } catch (e: any) {
      Alert.alert('Résiliation', e?.response?.data?.error || 'Erreur réseau.');
    } finally {
      setResiliationLoading(false);
    }
  };

  const handleChangerFormule = async () => {
    if (!email) { Alert.alert('Formule', "Email de la licence introuvable."); return; }
    setChangeLoading(true);
    try {
      const res = await axios.post(`${SERVER_BASE}/changer-formule`, {
        email,
        nouvelleFormule: formulaLabel(nextFormula),
      });
      if (res.data?.success) {
        await refreshCredits();
        Alert.alert('Changement programmé', res.data?.message || 'La formule sera modifiée à la prochaine échéance.');
        setChangeModalVisible(false);
      } else {
        Alert.alert('Erreur', res.data?.error || 'Impossible de programmer le changement.');
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.error || 'Erreur réseau.');
    } finally {
      setChangeLoading(false);
    }
  };

  // Deep link Stripe success: opticom://merci-achat
  useEffect(() => {
    const handler = async ({ url }: { url: string }) => {
      if (url?.startsWith('opticom://merci-achat')) {
        await refreshCredits(); setSuccessModalVisible(true);
      }
    };
    const sub = Linking.addEventListener('url', handler);
    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial?.startsWith('opticom://merci-achat')) {
        await refreshCredits(); setSuccessModalVisible(true);
      }
    })();
    return () => sub.remove();
  }, [refreshCredits]);

  if (!licence || !data) return <Text style={styles.text}>Chargement...</Text>;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>📦 Abonnement actuel</Text>

      <View style={styles.box}>
        {!!data.resiliationDate && (
          <View style={{ backgroundColor: '#402', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <Text style={{ color: '#f99', fontWeight: '600' }}>
              ⚠️ Résiliation programmée pour le {data.resiliationDate}
            </Text>
            <Text style={{ color: '#f2c', marginTop: 4 }}>
              L’application reste active jusqu’à cette date.
            </Text>
          </View>
        )}

        <Text style={styles.label}>Formule :</Text>
        <Text style={styles.value}>{formuleName}</Text>

        <Text style={styles.label}>Crédits restants :</Text>
        <Text style={styles.value}>{credits} SMS</Text>

        <View style={{ marginTop: 14 }}>
          <Text style={styles.priceLine}>
            💰 <Text style={{ fontWeight: 'bold' }}>Tarif :</Text> 100 SMS = {PRICE_HT_PER_PACK.toFixed(2)} € HT ({(PRICE_HT_PER_PACK * (1 + TVA_RATE)).toFixed(2)} € TTC)
          </Text>
        </View>

        {!!data.renouvellement && (
          <>
            <Text style={styles.label}>Renouvellement :</Text>
            <Text style={styles.value}>{data.renouvellement}</Text>
          </>
        )}

        <TouchableOpacity style={[styles.buyButton, { backgroundColor: '#444' }]} onPress={handleRefresh} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? '⏳ Rafraîchissement...' : '🔄 Rafraîchir'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.buyButton} onPress={() => setBuyModalVisible(true)} disabled={loading}>
          <Text style={styles.buttonText}>➕ Acheter des crédits</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.buyButton, { backgroundColor: '#333' }]} onPress={() => setChangeModalVisible(true)}>
          <Text style={styles.buttonText}>🔁 Changer de formule</Text>
        </TouchableOpacity>

        {!String(data.formule || '').includes('carte') && (
          <TouchableOpacity style={[styles.buyButton, { backgroundColor: '#800' }]} onPress={() => setResiliationModal(true)}>
            <Text style={styles.buttonText}>❌ Résilier mon abonnement</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.title}>📊 Suivi mensuel</Text>
      <View style={styles.tableHeader}>
        <Text style={[styles.tableCell, { flex: 1 }]}>Mois</Text>
        <Text style={[styles.tableCell, { flex: 1 }]}>Facture</Text>
      </View>

      {monthlyRows.length === 0 && <Text style={{ color: '#888', marginTop: 8 }}>Aucune donnée pour le moment.</Text>}

      {monthlyRows.map((row) => {
        const url = row.invoice ? safeInvoiceUrl(row.invoice) : null;
        return (
          <View key={row.key} style={styles.tableRow}>
            <Text style={[styles.tableCell, { flex: 1 }]}>{row.moisLabel}</Text>
            <View style={[styles.tableCell, { flex: 1, alignItems: 'center' }]}>
              {url ? (
                <TouchableOpacity onPress={() => Linking.openURL(url)}>
                  <Text style={styles.link}>📥</Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ color: '#555' }}>—</Text>
              )}
            </View>
          </View>
        );
      })}

      {/* FACTURES — Achats ponctuels */}
      {purchaseInvoices.length > 0 && (
        <>
          <Text style={styles.title}>🧾 Factures — Achats ponctuels</Text>
          {purchaseInvoices.map((f, idx) => {
            const url = safeInvoiceUrl(f);
            return (
              <View key={idx} style={styles.invoiceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceText}>
                    {new Date(f.date || Date.now()).toLocaleDateString('fr-FR')} • {f.type}
                  </Text>
                  <Text style={[styles.invoiceText, { color: '#bbb' }]}>
                    {f.credits ? `${f.credits} crédits` : ''} {f.montantTTC ? `— ${f.montantTTC.toFixed(2)} € TTC` : ''}
                  </Text>
                </View>
                {url && (
                  <TouchableOpacity onPress={() => Linking.openURL(url)}>
                    <Text style={styles.link}>📥</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </>
      )}

      <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Home' as never)}>
        <Text style={styles.backButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>

      {/* Achat crédits */}
      <Modal visible={buyModalVisible} transparent animationType="slide" onRequestClose={() => setBuyModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={{ color: '#fff', fontSize: 18, marginBottom: 12 }}>Combien de lots de 100 SMS ?</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity onPress={() => setQuantity(Math.max(1, quantity - 1))}><Text style={styles.qtyButton}>➖</Text></TouchableOpacity>
              <Text style={styles.qtyText}>{quantity}</Text>
              <TouchableOpacity onPress={() => setQuantity(quantity + 1)}><Text style={styles.qtyButton}>➕</Text></TouchableOpacity>
            </View>
            <View style={{ width: '100%', marginTop: 8 }}>
              <Text style={styles.recapLine}>• {quantity * 100} SMS</Text>
              <Text style={styles.recapLine}>• Total HT : {totalHT.toFixed(2)} €</Text>
              <Text style={styles.recapLine}>• TVA (20%) : {totalTVA.toFixed(2)} €</Text>
              <Text style={[styles.recapLine, { fontWeight: 'bold' }]}>• Total TTC : {totalTTC.toFixed(2)} €</Text>
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setBuyModalVisible(false)}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity onPress={handlePaiement}><Text style={styles.confirmText}>Valider</Text></TouchableOpacity>
            </View>
            <Text style={{ color: '#888', marginTop: 8, fontSize: 12 }}>
              * Prix : {PRICE_HT_PER_PACK.toFixed(2)} € HT / 100 SMS ({(PRICE_HT_PER_PACK * (1 + TVA_RATE)).toFixed(2)} € TTC)
            </Text>
          </View>
        </View>
      </Modal>

      {/* Modale changement de formule */}
      <Modal visible={changeModalVisible} transparent animationType="slide" onRequestClose={() => setChangeModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={{ color: '#fff', fontSize: 18, marginBottom: 12 }}>Choisir la nouvelle formule</Text>
            <View style={{ width: '100%' }}>
              {(['starter','pro','premium'] as const).map((id) => (
                <TouchableOpacity
                  key={id}
                  onPress={() => setNextFormula(id)}
                  style={{
                    padding: 12, borderRadius: 8, marginBottom: 8,
                    backgroundColor: nextFormula === id ? '#1E90FF' : '#333'
                  }}
                >
                  <Text style={{ color: '#fff', fontWeight: 'bold' }}>{formulaLabel(id)}</Text>
                  <Text style={{ color: '#bbb', marginTop: 2 }}>
                    {id === 'starter' ? '100 SMS / mois  14.9€ HT'
                      : id === 'pro' ? '300 SMS / mois  39.9€ HT'
                      : '600 SMS / mois  69.9€ HT'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setChangeModalVisible(false)}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity disabled={changeLoading} onPress={handleChangerFormule}>
                <Text style={styles.confirmText}>{changeLoading ? '⏳...' : 'Valider'}</Text>
              </TouchableOpacity>
            </View>
            {!!data?.renouvellement && (
              <Text style={{ color: '#888', marginTop: 10, fontSize: 12 }}>
                Le changement s’appliquera à l’échéance : {data.renouvellement}
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Modale de résiliation */}
      <Modal visible={resiliationModal} transparent animationType="slide" onRequestClose={() => setResiliationModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={{ color: '#fff', fontSize: 16, marginBottom: 20 }}>
              Êtes-vous sûr de vouloir résilier votre abonnement ?
              {'\n'}• Les prélèvements automatiques s’arrêteront à la prochaine échéance.
              {'\n'}• L’application restera active jusqu’à cette date.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setResiliationModal(false)}><Text style={styles.cancelText}>Annuler</Text></TouchableOpacity>
              <TouchableOpacity disabled={resiliationLoading} onPress={confirmResiliation}>
                <Text style={styles.confirmText}>{resiliationLoading ? '⏳...' : 'Confirmer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ✅ Modale validation achat */}
      <Modal
        visible={successModalVisible}
        transparent
        animationType="fade"
        onRequestClose={async () => { setSuccessModalVisible(false); await refreshCredits(); }}
      >
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <Text style={{ fontSize: 22, marginBottom: 8 }}>✅ Achat validé</Text>
            <Text style={{ textAlign: 'center' }}>Vos crédits ont été ajoutés à votre compte.</Text>
            <TouchableOpacity
              style={[styles.buyButton, { marginTop: 16 }]}
              onPress={async () => { setSuccessModalVisible(false); await refreshCredits(); }}
            >
              <Text style={styles.buttonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 16 },
  box: { backgroundColor: '#111', padding: 16, borderRadius: 10, marginBottom: 30 },
  label: { color: '#999', marginTop: 10, fontSize: 14 },
  value: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  priceLine: { color: '#ddd', fontSize: 14 },
  buyButton: { backgroundColor: '#1E90FF', padding: 12, borderRadius: 8, marginTop: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold' },

  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#555', paddingBottom: 6, marginBottom: 4 },
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#333', alignItems: 'center' },
  tableCell: { color: '#fff', fontSize: 14, textAlign: 'center' },
  link: { color: '#1E90FF', fontSize: 18 },

  text: { color: '#fff', textAlign: 'center', marginTop: 40 },
  backButton: { marginTop: 30, backgroundColor: '#444', padding: 14, borderRadius: 10, alignItems: 'center' },
  backButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' },
  modalContent: { backgroundColor: '#222', padding: 24, borderRadius: 12, alignItems: 'center', width: '85%' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  qtyButton: { fontSize: 30, color: '#1E90FF', marginHorizontal: 20 },
  qtyText: { color: '#fff', fontSize: 22 },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 },
  cancelText: { color: '#999', fontSize: 16 },
  confirmText: { color: '#1E90FF', fontSize: 16, fontWeight: 'bold' },

  recapLine: { color: '#fff', fontSize: 14, marginTop: 4 },

  successOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  successCard: { backgroundColor: '#fff', padding: 20, borderRadius: 12, width: '80%', alignItems: 'center' },

  invoiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#333' },
  invoiceText: { color: '#fff', fontSize: 14 },
});

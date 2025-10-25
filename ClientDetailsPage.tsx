import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, NavigationProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Client } from './types';
import API_BASE from './src/config/api';

type RootStackParamList = {
  Home: undefined;
  AddClient: { mode: 'edit'; client: Client };
  ClientList: undefined;
};

const sanitizePhone = (raw: string) => {
  let p = (raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return p.replace(/\D/g, '');
};

const getStableLicenceId = async (): Promise<string | null> => {
  try {
    const cached = await AsyncStorage.getItem('licenceId');
    if (cached) return cached;

    const licStr = await AsyncStorage.getItem('licence');
    if (!licStr) return null;
    const lic = JSON.parse(licStr);

    if (lic?.id) {
      await AsyncStorage.setItem('licenceId', String(lic.id));
      return String(lic.id);
    }
    if (lic?.licence) {
      const urls = [
        `${API_BASE}/api/licence/by-key?key=${encodeURIComponent(lic.licence)}`,
        `${API_BASE}/licence/by-key?key=${encodeURIComponent(lic.licence)}`,
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!r.ok) continue;
          const j = await r.json().catch(() => ({} as any));
          const id = j?.licence?.id || j?.id;
          if (id) {
            await AsyncStorage.setItem('licenceId', String(id));
            return String(id);
          }
        } catch {}
      }
    }
  } catch {}
  return null;
};

export default function ClientDetailsPage() {
  const route = useRoute();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client } = route.params as { client: Client };

  const handleEdit = () => {
    // Ouverture de l’éditeur : le numéro est modifiable dans AddClient (mode 'edit')
    navigation.navigate('AddClient', { mode: 'edit', client });
  };

  const handleDelete = async () => {
    Alert.alert(
      'Supprimer le client',
      `Confirmer la suppression de ${client.prenom} ${client.nom} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const stored = await AsyncStorage.getItem('clients');
              const list: Client[] = stored ? JSON.parse(stored) : [];

              // ➜ suppression par ID pour ne PAS supprimer les autres fiches avec le même numéro
              const targetId = String(client.id || '');
              const updated = targetId
                ? list.filter((c) => String(c.id) !== targetId)
                : list.filter((c) => sanitizePhone(c.telephone) !== sanitizePhone(client.telephone));

              await AsyncStorage.setItem('clients', JSON.stringify(updated));

              // Tentative de suppression côté serveur (best-effort)
              try {
                const licenceId = await getStableLicenceId();
                if (licenceId && targetId) {
                  const resp = await fetch(
                    `${API_BASE}/api/clients/${encodeURIComponent(targetId)}?licenceId=${encodeURIComponent(licenceId)}`,
                    { method: 'DELETE' }
                  );
                  // Pas de blocage si erreur serveur : on reste en cohérence locale
                  if (!resp.ok) {
                    console.warn('Suppression serveur non confirmée:', resp.status);
                  }
                }
              } catch (e) {
                console.warn('Erreur suppression serveur:', e);
              }

              Alert.alert('Client supprimé');
              navigation.navigate('ClientList');
            } catch (e) {
              Alert.alert('Erreur', 'Impossible de supprimer ce client.');
            }
          },
        },
      ]
    );
  };

  const produits =
    client.lunettes || client.lentilles?.length
      ? [
          client.lunettes ? 'Lunettes' : null,
          ...(client.lentilles?.length ? client.lentilles : []),
        ]
          .filter(Boolean)
          .join(' | ')
      : 'Aucun produit sélectionné';

  const consentService = !!client?.consent?.service_sms?.value;
  const consentMarketing = !!client?.consent?.marketing_sms?.value || !!client?.consentementMarketing;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Détails du client</Text>

      <Text style={styles.detail}>👤 Nom : <Text style={styles.value}>{client.nom}</Text></Text>
      <Text style={styles.detail}>🧍 Prénom : <Text style={styles.value}>{client.prenom}</Text></Text>
      <Text style={styles.detail}>📞 Téléphone : <Text style={styles.value}>{client.telephone}</Text></Text>
      <Text style={styles.detail}>📧 Email : <Text style={styles.value}>{client.email || 'Non renseigné'}</Text></Text>
      <Text style={styles.detail}>🎂 Naissance : <Text style={styles.value}>{client.dateNaissance || 'Non renseignée'}</Text></Text>
      <Text style={styles.detail}>🛍️ Produits : <Text style={styles.value}>{produits}</Text></Text>
      <Text style={styles.detail}>✅ Consentement Service : <Text style={styles.value}>{consentService ? 'Oui' : 'Non'}</Text></Text>
      <Text style={styles.detail}>💬 Consentement Marketing : <Text style={styles.value}>{consentMarketing ? 'Oui' : 'Non'}</Text></Text>

      <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
        <Text style={styles.editButtonText}>📝 Modifier ce client</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
        <Text style={styles.deleteButtonText}>🗑️ Supprimer ce client</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.homeButton} onPress={() => navigation.navigate('Home')}>
        <Text style={styles.homeButtonText}>🏠 Retour à l’accueil</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#000', flex: 1 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 20 },
  detail: { color: '#ccc', fontSize: 16, marginBottom: 6 },
  value: { color: '#fff' },
  editButton: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 30,
  },
  editButtonText: { color: '#fff', fontWeight: 'bold' },
  deleteButton: {
    backgroundColor: '#FF3B30',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 15,
  },
  deleteButtonText: { color: '#fff', fontWeight: 'bold' },
  homeButton: {
    marginTop: 30,
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  homeButtonText: { color: '#00BFFF', fontWeight: '600', fontSize: 16 },
});

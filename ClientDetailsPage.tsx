import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, NavigationProp } from '@react-navigation/native';
import { Client } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';

type RootStackParamList = {
  Home: undefined;
  AddClient: { mode: 'edit'; client: Client };
  ClientList: undefined;
};

export default function ClientDetailsPage() {
  const route = useRoute();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { client } = route.params as { client: Client };

  const handleEdit = () => {
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
            const stored = await AsyncStorage.getItem('clients');
            const list: Client[] = stored ? JSON.parse(stored) : [];
            const updated = list.filter((c) => c.telephone !== client.telephone);
            await AsyncStorage.setItem('clients', JSON.stringify(updated));
            Alert.alert('Client supprimé');
            navigation.navigate('ClientList');
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Détails du client</Text>
      <Text style={styles.detail}>👤 Nom : <Text style={styles.value}>{client.nom}</Text></Text>
      <Text style={styles.detail}>🧍 Prénom : <Text style={styles.value}>{client.prenom}</Text></Text>
      <Text style={styles.detail}>📞 Téléphone : <Text style={styles.value}>{client.telephone}</Text></Text>
      <Text style={styles.detail}>📧 Email : <Text style={styles.value}>{client.email || 'Non renseigné'}</Text></Text>
      <Text style={styles.detail}>🛍️ Produits : <Text style={styles.value}>{produits}</Text></Text>

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
  container: {
    padding: 20,
    backgroundColor: '#000',
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  detail: {
    color: '#ccc',
    fontSize: 16,
    marginBottom: 6,
  },
  value: {
    color: '#fff',
  },
  editButton: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 30,
  },
  editButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 15,
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  homeButton: {
    marginTop: 30,
    backgroundColor: '#1a1a1a',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  homeButtonText: {
    color: '#00BFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});

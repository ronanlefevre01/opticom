import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function MerciPage() {
  const navigation = useNavigation();
  const route = useRoute();
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    const confirmMandat = async () => {
      try {
        const redirectFlowId = route?.params?.redirect_flow_id;

        if (!redirectFlowId) {
          throw new Error("redirect_flow_id introuvable.");
        }

        const response = await fetch('https://opticom-sms-server.onrender.com/confirm-mandat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirect_flow_id: redirectFlowId }),
        });

        const data = await response.json();
        if (data.success) {
          setConfirmed(true);
        } else {
          throw new Error(data.error || 'Erreur inconnue');
        }
      } catch (err: any) {
        Alert.alert("Erreur", err.message);
      } finally {
        setLoading(false);
      }
    };

    confirmMandat();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎉 Merci !</Text>
      {loading ? (
        <ActivityIndicator color="#00BFFF" size="large" />
      ) : confirmed ? (
        <>
          <Text style={styles.text}>
            Votre mandat a été confirmé. Votre licence est maintenant active ✅
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('LicencePage')}>
            <Text style={styles.buttonText}>Saisir ma clé de licence</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.text}>❌ Impossible de valider le mandat.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#000' },
  title: { fontSize: 28, color: '#00BFFF', marginBottom: 20, fontWeight: 'bold' },
  text: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 30 },
  button: {
    backgroundColor: '#00BFFF',
    padding: 14,
    borderRadius: 10,
    paddingHorizontal: 30,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

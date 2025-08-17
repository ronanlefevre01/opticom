import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';

type RootStackParamList = {
  MandateValidationPage: { redirect_flow_id: string; session_token: string };
};

const MandateValidationPage = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'MandateValidationPage'>>();

  useEffect(() => {
    const validateMandate = async () => {
      const redirectFlowId = route.params?.redirect_flow_id;
      const sessionToken = route.params?.session_token;

      if (!redirectFlowId || !sessionToken) {
        Alert.alert("Erreur", "Paramètres manquants pour valider le mandat.");
        return;
      }

      console.log('🔁 redirect_flow_id :', redirectFlowId);
      console.log('🧪 session_token :', sessionToken);

      try {
        const response = await fetch(`https://opticom-sms-server.onrender.com/validation-mandat?redirect_flow_id=${redirectFlowId}&session_token=${sessionToken}`);

        if (!response.ok) {
          throw new Error(`Erreur HTTP : ${response.status}`);
        }

        const licence = await response.json();

        if (!licence || !licence.cle) {
          Alert.alert("Erreur", "Licence invalide reçue.");
          return;
        }

        await AsyncStorage.setItem('licence', JSON.stringify(licence));
        console.log('✅ Licence sauvegardée avec succès');

        // Petit délai visuel (optionnel)
        setTimeout(() => {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Home' as never }],
          });
        }, 500);

      } catch (error) {
        console.error('❌ Erreur validation mandat :', error);
        Alert.alert("Erreur", "Impossible de valider le mandat. Veuillez réessayer.");
      }
    };

    validateMandate();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Validation du mandat en cours...</Text>
      <ActivityIndicator size="large" color="#0000ff" />
    </View>
  );
};

export default MandateValidationPage;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  text: {
    marginBottom: 20,
    fontSize: 16,
    textAlign: 'center',
  },
});

// App.tsx
import './src/compat/patchApi'; // doit être importé avant tout le reste
import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState } from 'react';
import { View, ActivityIndicator, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';

// ✅ wrapper scroll/safe-area/clavier
import Screen from './components/Screen';

// Pages
import HomePage from './HomePage';
import AddClientPage from './AddClientPage';
import ClientListPage from './ClientListPage';
import ClientDetailsPage from './ClientDetailsPage';
import SettingsPage from './SettingsPage';
import LicencePage from './LicencePage';
import LicenceCheckPage from './LicenceCheckPage';
import CampagnePage from './CampagnePage';
import SubscriptionPage from './SubscriptionPage';
import MerciPage from './MerciPage';
import MandateValidationPage from './MandateValidationPage';

// 🔄 Sync auto (étape 2)
import { ClientsSyncProvider } from './src/sync/ClientsSyncContext';

if (Platform.OS === 'web') {
  // @ts-ignore
  require('./app.web.css');
}

const Stack = createStackNavigator();

// Linking de base
const linkingBase = {
  // ajoute le prefix Expo (createURL) en plus du schéma custom
  prefixes: ['opticom://', Linking.createURL('/')],
  config: {
    screens: {
      LicenceCheckPage: 'licence',
      Home: 'home',
      AddClient: 'add-client',
      ClientList: 'clients',
      ClientDetails: 'client/:id',
      Settings: 'settings',
      LicencePage: 'licence-page',
      Campagne: 'campagnes',
      Subscription: 'abonnement',
      Merci: 'merci',
      MandateValidationPage: 'MandateValidationPage',
    },
  },
};

// API Render → licence par clé (+ fallbacks)
const API_URL = 'https://opticom-sms-server.onrender.com';
const licenceByKeyCandidates = (key: string) => [
  `${API_URL}/api/licence/by-key?key=${encodeURIComponent(key)}`,
  `${API_URL}/licence/by-key?key=${encodeURIComponent(key)}`,
  `${API_URL}/licence-by-key?cle=${encodeURIComponent(key)}`,
];

async function fetchLicenceByKey(key: string) {
  for (const url of licenceByKeyCandidates(key)) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) continue;
      const data = text ? JSON.parse(text) : null;
      // tolère { licence: {...} } ou directement l’objet
      return data?.licence ?? data ?? null;
    } catch {
      // essaie l’URL suivante
    }
  }
  return null;
}

// petit helper pour envelopper chaque écran dans <Screen/>
const wrap =
  (Comp: React.ComponentType<any>, scroll = true) =>
  (props: any) =>
    (
      <Screen scroll={scroll}>
        <Comp {...props} />
      </Screen>
    );

export default function App() {
  const [booting, setBooting] = useState(true);
  const [hasLicense, setHasLicense] = useState(false);

  // Boot: licence déjà présente ?
  useEffect(() => {
    (async () => {
      try {
        // 1) objet licence déjà stocké ?
        const raw = await AsyncStorage.getItem('licence');
        if (raw) {
          try {
            const obj = JSON.parse(raw);
            if (obj?.cle || obj?.key || obj?.licence || obj?.licenceKey || obj?.id) {
              setHasLicense(true);
              return;
            }
          } catch {}
        }

        // 2) ancienne clé simple ?
        const legacyKey = await AsyncStorage.getItem('licenceKey');
        if (legacyKey) {
          setHasLicense(true); // on laisse entrer

          // complète l’objet en tâche de fond (fallback multi-routes)
          (async () => {
            try {
              const licence = await fetchLicenceByKey(legacyKey);
              await AsyncStorage.setItem(
                'licence',
                JSON.stringify(
                  licence ?? {
                    // garde compat avec le reste de l’app
                    licence: legacyKey,
                    cle: legacyKey,
                  }
                )
              );
            } catch {
              await AsyncStorage.setItem(
                'licence',
                JSON.stringify({ licence: legacyKey, cle: legacyKey })
              );
            }
          })();

          return;
        }

        // 3) rien
        setHasLicense(false);
      } catch (err) {
        console.log('❗Erreur lecture licence :', err);
        setHasLicense(false);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Linking: ignorer les liens vers les écrans "licence" si déjà licencié
  const linking = useMemo(() => {
    const isLicencePath = (url: string) => {
      const parsed = Linking.parse(url);
      const p = (parsed?.path || '').toLowerCase();
      return p === 'licence' || p === 'licence-page';
    };

    return {
      ...linkingBase,
      getInitialURL: async () => {
        const url = await Linking.getInitialURL();
        if (!url) return null;
        if (hasLicense && isLicencePath(url)) return null;
        return url;
      },
      subscribe: (listener: (url: string) => void) => {
        const onReceiveURL = ({ url }: { url: string }) => {
          if (hasLicense && isLicencePath(url)) return;
          listener(url);
        };
        const sub = Linking.addEventListener('url', onReceiveURL);
        return () => sub.remove();
      },
    };
  }, [hasLicense]);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ClientsSyncProvider>
      <NavigationContainer linking={linking}>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={hasLicense ? 'Home' : 'LicenceCheckPage'}
        >
          {/* Public */}
          <Stack.Screen name="LicenceCheckPage" component={wrap(LicenceCheckPage)} />
          <Stack.Screen name="MandateValidationPage" component={wrap(MandateValidationPage)} />

          {/* Privé */}
          <Stack.Screen name="Home" component={wrap(HomePage)} />
          <Stack.Screen name="AddClient" component={wrap(AddClientPage)} />
          <Stack.Screen name="ClientList" component={wrap(ClientListPage)} />
          <Stack.Screen name="ClientDetails" component={wrap(ClientDetailsPage)} />
          <Stack.Screen name="Settings" component={wrap(SettingsPage)} />
          <Stack.Screen name="LicencePage" component={wrap(LicencePage)} />
          <Stack.Screen name="Campagne" component={wrap(CampagnePage)} />
          <Stack.Screen name="Subscription" component={wrap(SubscriptionPage)} />
          <Stack.Screen name="Merci" component={wrap(MerciPage)} />
        </Stack.Navigator>
      </NavigationContainer>
    </ClientsSyncProvider>
  );
}

// creditManager.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_CREDITS = 500; // Par défaut pour un abonnement standard

export async function getSubscriptionData() {
  const saved = await AsyncStorage.getItem('subscription');
  if (saved) return JSON.parse(saved);
  return null;
}

export async function saveSubscriptionData(data) {
  await AsyncStorage.setItem('subscription', JSON.stringify(data));
}

export async function checkAndRenewCredits() {
  const data = await getSubscriptionData();
  if (!data) return;

  const today = new Date();
  const nextRenewal = new Date(data.renouvellement);

  if (today >= nextRenewal) {
    // Ajouter des crédits à l'abonnement
    data.creditsRestants += DEFAULT_CREDITS;

    // Mettre à jour la date de renouvellement (mois suivant)
    nextRenewal.setMonth(nextRenewal.getMonth() + 1);
    data.renouvellement = nextRenewal.toISOString().split('T')[0];

    // Ajouter une nouvelle ligne dans l'historique
    const mois = today.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
    data.historique.unshift({ mois, envoyes: 0, achetes: 0 });

    await saveSubscriptionData(data);
  }
}

export async function consumeCredits(n = 1) {
  const data = await getSubscriptionData();
  if (!data) return false;

  if (data.creditsRestants >= n) {
    data.creditsRestants -= n;

    const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
    const current = data.historique.find(h => h.mois === mois);
    if (current) current.envoyes += n;

    await saveSubscriptionData(data);
    return true;
  } else {
    return false; // Pas assez de crédits
  }
}

export async function addCredits(n) {
  const data = await getSubscriptionData();
  if (!data) return;

  data.creditsRestants += n;

  const mois = new Date().toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const current = data.historique.find(h => h.mois === mois);
  if (current) current.achetes += n;

  await saveSubscriptionData(data);
}

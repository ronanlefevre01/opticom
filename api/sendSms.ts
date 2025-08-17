// api/sendSms.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export const sendSms = async ({
  phoneNumber,
  message,
  emetteur = 'Opticien',
}: {
  phoneNumber: string;
  message: string;
  emetteur?: string;
}) => {
  try {
    const licenceJson = await AsyncStorage.getItem('licence');
    if (!licenceJson) throw new Error('Licence introuvable.');

    const licence = JSON.parse(licenceJson);
    const licenceKey = licence.cleLicence;

    const response = await fetch('https://opticom-sms-server.onrender.com/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber,
        message,
        emetteur,
        licenceKey,
      }),
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error || 'Erreur inconnue');
    return result;
  } catch (error) {
    console.error('❌ Erreur envoi SMS :', error);
    throw error;
  }
};

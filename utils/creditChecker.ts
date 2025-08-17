export const checkAvailableCredits = async (opticienId: string): Promise<number | null> => {
  try {
    const response = await fetch('https://opticom-admin.vercel.app/licences.json');
    const data = await response.json();

    const licence = data.find((item: any) => item.opticienId === opticienId);
    return licence?.credits ?? null;
  } catch (error) {
    console.error('Erreur lors de la récupération des crédits :', error);
    return null;
  }
};

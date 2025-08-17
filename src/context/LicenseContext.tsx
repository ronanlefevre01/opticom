import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type License = {
  key: string;
  opticienId?: string;
  endDate?: string; // ou tout autre champ que tu utilises
  // ...ajoute tes propriétés
};

type LicenseContextType = {
  license: License | null;
  loading: boolean;
  setLicenseAndSave: (lic: License) => Promise<void>;
  clearLicense: () => Promise<void>;
};

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export const LICENSE_STORAGE_KEY = "opti_license"; // clé unique et stable

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [license, setLicense] = useState<License | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LICENSE_STORAGE_KEY);
        if (raw) {
          const parsed: License = JSON.parse(raw);
          setLicense(parsed);
        }
      } catch (e) {
        console.warn("Erreur lecture licence:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setLicenseAndSave = async (lic: License) => {
    setLicense(lic);
    await AsyncStorage.setItem(LICENSE_STORAGE_KEY, JSON.stringify(lic));
  };

  const clearLicense = async () => {
    setLicense(null);
    await AsyncStorage.removeItem(LICENSE_STORAGE_KEY);
  };

  return (
    <LicenseContext.Provider value={{ license, loading, setLicenseAndSave, clearLicense }}>
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicense = () => {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within LicenseProvider");
  return ctx;
};

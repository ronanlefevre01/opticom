// types.ts

// =====================
// Produits & catégories
// =====================
export type ProduitType =
  | 'Lunettes'
  | 'Journ30'
  | 'Journ60'
  | 'Journ90'
  | 'Mens6'
  | 'Mens12';

export type SMSCategory = 'Lunettes' | 'Lentilles' | 'SAV' | 'Commande';

export type MessageLog = {
  type: SMSCategory;
  date: string; // ISO
};

// =====================
// Consentements SMS
// =====================
export type SMSConsent = {
  /** true = consentement donné ; false = pas de consentement */
  value: boolean;
  /** date de collecte (ISO) */
  collectedAt?: string;
  /** où/comment obtenu */
  source?: 'in_store' | 'online' | 'import';
  /** preuve (ex: "case cochée en boutique", "bon signé") */
  proof?: string;
  /** jeton pour désinscription (si tu mets un lien d’opt-out) */
  token?: string;
  /** date d’opposition si la personne s’est désinscrite */
  unsubscribedAt?: string | null;
};

// =====================
// Client
// =====================
export type Client = {
  nom: string;
  prenom: string;
  telephone: string;
  email?: string;
  produits?: ProduitType[];
  messagesEnvoyes?: MessageLog[]; // historique SMS envoyés
  createdAt?: string;             // date de création du client
  premierMessage?: string;        // date du 1er SMS

  /**
   * Consentements :
   * - service_sms : notifications de service (commande prête, SAV…)
   * - marketing_sms : promos / relances (opt-in obligatoire)
   *
   * Optionnel pour compat rétro ; initialise-le via une migration au démarrage.
   */
  consent?: {
    service_sms: SMSConsent;
    marketing_sms: SMSConsent;
  };
};

// ==============
// Licence
// ==============
export type OpticienInfo = {
  enseigne?: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  siret?: string;
};

export type Licence = {
  /** Identifiant unique (utilisé côté serveur) */
  id: string;

  /** Clé de licence (alias : certains écrans l'appellent "licence") */
  cle: string;
  licence?: string; // alias facultatif pour compatibilité

  /** Nom de l’opticien (ancienne forme) */
  nomOpticien: string;

  /** Détails optionnels (nouvelle forme) */
  opticien?: OpticienInfo;

  /** Date de validité (AAAA-MM-JJ) */
  dateValidite: string;

  /** Libellé expéditeur (3..11 chars alphanum) */
  libelleExpediteur: string;

  /** Crédits restants */
  credits?: number;

  /** Type d’abonnement */
  abonnement?: 'Illimitée' | 'A la carte' | 'Starter' | 'Pro' | 'Premium';

  /** Modules activés */
  modulesActifs: {
    sms: boolean;
    ocr: boolean;
    rappelAuto: boolean;
  };

  /** (facultatif) Suivi d’acceptation des CGV côté app */
  cgv?: {
    accepted?: boolean;
    acceptedVersion?: string;
    acceptedAt?: string; // ISO
  };
};

// =====================
// Helpers (facultatifs)
// =====================

/** Consent par défaut (à utiliser lors d’une migration ou création client) */
export const defaultSMSConsent = (): SMSConsent => ({
  value: false,
  source: 'in_store',
  unsubscribedAt: null,
});

/** Vrai si on peut envoyer un SMS de service */
export const canSendService = (c: Client) =>
  c.consent?.service_sms?.value === true;

/** Vrai si on peut envoyer un SMS marketing (opt-in + pas désinscrit) */
export const canSendMarketing = (c: Client) =>
  c.consent?.marketing_sms?.value === true && !c.consent?.marketing_sms?.unsubscribedAt;

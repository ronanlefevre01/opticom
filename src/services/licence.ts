// src/services/licence.ts
import API_BASE from "@/config/api";

async function getJSON(url: string) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}

async function postJSON(path: string, body: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}

/** Lecture licence — ATTENTION: le serveur attend ?cle= ou ?id= */
export function fetchLicenceFromServer(cle: string) {
  if (!cle) throw new Error("Aucune clé licence trouvée");
  return getJSON(`${API_BASE}/api/licence?cle=${encodeURIComponent(cle)}`);
}

/** MAJ expéditeur
 *  Serveur: POST /licence/expediteur
 *  Payload accepté: { cle?: string, licenceId?: string, libelleExpediteur: string, opticienId?: string }
 *  On conserve la compat v1 en envoyant la clé + libelleExpediteur.
 */
export function updateExpediteur(cle: string, expediteur: string) {
  if (!cle) throw new Error("Aucune clé licence");
  return postJSON("/licence/expediteur", {
    cle,
    libelleExpediteur: expediteur,
  });
}

/** MAJ signature
 *  Serveur: POST /licence/signature
 *  Payload accepté: { cle?: string, licenceId?: string, signature: string, opticienId?: string }
 */
export function updateSignature(cle: string, signature: string) {
  if (!cle) throw new Error("Aucune clé licence");
  return postJSON("/licence/signature", {
    cle,
    signature,
  });
}

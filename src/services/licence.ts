// src/services/licence.ts
import API_BASE from "@/config/api";

async function getJSON(url: string) {
  const r = await fetch(url);
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : {};
}
async function putJSON(path: string, body: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
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

/** MAJ expéditeur: body = { cle, expediteur } */
export function updateExpediteur(cle: string, expediteur: string) {
  if (!cle) throw new Error("Aucune clé licence");
  return putJSON("/api/licence/expediteur", { cle, expediteur });
}

/** MAJ signature: body = { cle, signature } */
export function updateSignature(cle: string, signature: string) {
  if (!cle) throw new Error("Aucune clé licence");
  return putJSON("/api/licence/signature", { cle, signature });
}

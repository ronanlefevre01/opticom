// src/services/licence.ts
import API_BASE from "@/config/api";

/* --- helpers HTTP --- */
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

/* --- API licence (lecture) ---
   Le serveur supporte /api/licence?cle=... ou ?id=... */
export function fetchLicenceFromServer(cle: string) {
  if (!cle) throw new Error("Aucune clé licence trouvée");
  return getJSON(`${API_BASE}/api/licence?cle=${encodeURIComponent(cle)}`);
}

/* Résout l'ID interne à partir d'une clé, si besoin */
async function ensureLicenceId(opts: { licenceId?: string; cle?: string }) {
  if (opts.licenceId) return opts.licenceId;
  if (!opts.cle) throw new Error("Aucune clé licence");
  const j = await getJSON(`${API_BASE}/api/licence?cle=${encodeURIComponent(opts.cle)}`);
  const id = String((j?.licence ?? j)?.id || "");
  if (!id) throw new Error("LICENCE_NOT_FOUND");
  return id;
}

/* --- MAJ expéditeur ---
   Serveur: POST /licence/expediteur
   Payload: { licenceId, libelleExpediteur, opticienId? }
*/
export async function updateExpediteur(
  cleOrOpts: string | { licenceId?: string; cle?: string; opticienId?: string },
  expediteur: string
) {
  const opts =
    typeof cleOrOpts === "string" ? { cle: cleOrOpts } : cleOrOpts || {};
  const licenceId = await ensureLicenceId(opts);
  const body: any = {
    licenceId,
    libelleExpediteur: expediteur,
  };
  if (opts.opticienId) body.opticienId = opts.opticienId;
  return postJSON("/licence/expediteur", body);
}

/* --- MAJ signature ---
   Serveur: POST /licence/signature
   Payload: { licenceId, signature, opticienId? }
*/
export async function updateSignature(
  cleOrOpts: string | { licenceId?: string; cle?: string; opticienId?: string },
  signature: string
) {
  const opts =
    typeof cleOrOpts === "string" ? { cle: cleOrOpts } : cleOrOpts || {};
  const licenceId = await ensureLicenceId(opts);
  const body: any = { licenceId, signature };
  if (opts.opticienId) body.opticienId = opts.opticienId;
  return postJSON("/licence/signature", body);
}

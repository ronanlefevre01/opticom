// src/services/licence.ts
import API_BASE from "@/config/api";

/* http utils */
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

/** Lecture licence — ?cle= ou ?id= */
export function fetchLicenceFromServer(cleOrId: string, byId = false) {
  const qs = byId ? `id=${encodeURIComponent(cleOrId)}` : `cle=${encodeURIComponent(cleOrId)}`;
  return getJSON(`${API_BASE}/api/licence?${qs}`);
}

/** Resolve ID from cle if needed */
async function ensureLicenceId(opts: { licenceId?: string; cle?: string }) {
  if (opts.licenceId) return opts.licenceId;
  if (!opts.cle) throw new Error("Aucune clé licence");
  const j = await getJSON(`${API_BASE}/api/licence?cle=${encodeURIComponent(opts.cle)}`);
  const id = String((j?.licence ?? j)?.id || "");
  if (!id) throw new Error("LICENCE_NOT_FOUND");
  return id;
}

/** MAJ expéditeur — serveur: POST /licence/expediteur */
export async function updateExpediteur(
  opts: { licenceId?: string; cle?: string; opticienId?: string },
  expediteur: string
) {
  const licenceId = await ensureLicenceId(opts);
  // On envoie TOUT: id + cle + 2 noms de champ (compat v1/v2)
  const body: any = {
    licenceId,
    cle: opts.cle,
    libelleExpediteur: expediteur,
    expediteur, // compat anciennes routes
  };
  if (opts.opticienId) body.opticienId = opts.opticienId;
  return postJSON("/licence/expediteur", body);
}

/** MAJ signature — serveur: POST /licence/signature */
export async function updateSignature(
  opts: { licenceId?: string; cle?: string; opticienId?: string },
  signature: string
) {
  const licenceId = await ensureLicenceId(opts);
  const body: any = {
    licenceId,
    cle: opts.cle,
    signature,
  };
  if (opts.opticienId) body.opticienId = opts.opticienId;
  return postJSON("/licence/signature", body);
}

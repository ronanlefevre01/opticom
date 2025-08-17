// src/compat/patchApi.ts
// Réécrit les appels vers opticom-sms-server pour parler le dialecte "cle" + /api
if (typeof window !== "undefined" && typeof window.fetch === "function") {
  const API_HOST = "opticom-sms-server.onrender.com";
  const ENABLE_LOGS = false;
  const origFetch = window.fetch.bind(window);

  function parseJSONSafe(t: any){ try{return JSON.parse(t);}catch{return null;} }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === "string" ? input : String(input);
    let opts: RequestInit = { ...(init || {}) };

    try {
      const u = new URL(url, window.location.origin);
      const isAPI = u.hostname === API_HOST;

      if (isAPI) {
        const method = (opts.method || "GET").toUpperCase();
        const path = u.pathname; // ex: /licence/expediteur

        // Récupère/normalise la clé licence
        let bodyObj: any = {};
        if (opts.body && typeof opts.body === "string") {
          bodyObj = parseJSONSafe(opts.body) ?? {};
        }
        const q = u.searchParams;
        const cle =
          bodyObj.cle || q.get("cle") ||
          bodyObj.licenceId || q.get("licenceId") ||
          q.get("id") || bodyObj.licence || bodyObj.licenceKey || "";

        // Force préfixe /api sur les routes licence connues
        const ensureApi = (p: string) => p.startsWith("/api/") ? p : `/api${p}`;

        // ---- GET /api/licence ----
        if (method === "GET" && (path.endsWith("/licence") || path.endsWith("/api/licence"))) {
          u.pathname = ensureApi(path.endsWith("/api/licence") ? path : "/licence");
          if (cle) { u.searchParams.set("cle", cle); }
          u.searchParams.delete("licenceId");
          u.searchParams.delete("licenceKey");
          url = u.toString();
        }

        // ---- prefs GET ----
        if (method === "GET" && (path.includes("/licence/prefs") || path.includes("/api/licence/prefs"))) {
          u.pathname = ensureApi(path.replace("/licence/prefs", "/licence/prefs"));
          if (cle) { u.searchParams.set("cle", cle); }
          u.searchParams.delete("licenceId");
          url = u.toString();
        }

        // Prépare body JSON
        const headers = new Headers(opts.headers || {});
        headers.set("Content-Type", "application/json");

        // ---- expéditeur ----
        if ((/\/licence\/expediteur$/.test(path) || /\/api\/licence\/expediteur$/.test(path))
            && (method === "POST" || method === "PUT")) {
          const expediteur = bodyObj.expediteur || bodyObj.libelleExpediteur || "";
          const newBody = JSON.stringify({ cle, expediteur });
          opts = { ...opts, method: "PUT", headers, body: newBody };
          u.pathname = ensureApi("/licence/expediteur");
          url = u.toString();
        }

        // ---- signature ----
        if ((/\/licence\/signature$/.test(path) || /\/api\/licence\/signature$/.test(path))
            && (method === "POST" || method === "PUT")) {
          const signature = bodyObj.signature || "";
          const newBody = JSON.stringify({ cle, signature });
          opts = { ...opts, method: "PUT", headers, body: newBody };
          u.pathname = ensureApi("/licence/signature");
          url = u.toString();
        }

        // ---- prefs POST ----
        if ((/\/licence\/prefs$/.test(path) || /\/api\/licence\/prefs$/.test(path))
            && (method === "POST")) {
          const newBody = JSON.stringify({ cle, ...bodyObj, licenceId: undefined });
          opts = { ...opts, method: "POST", headers, body: newBody };
          u.pathname = ensureApi("/licence/prefs");
          url = u.toString();
        }

        if (ENABLE_LOGS) console.log("[API compat]", path, "=>", new URL(url).pathname, opts);
      }
    } catch (e) {
      // si parsing URL échoue, on laisse passer tel quel
    }

    return origFetch(url, opts);
  };
}

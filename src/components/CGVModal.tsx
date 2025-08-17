import React, { useEffect, useRef, useState } from 'react';
import API_BASE from '../config/api'; // ajuste le chemin si besoin

type Props = {
  licenceId: string;
  version: string;
  textUrl: string;                 // URL du .md servi par le serveur
  serverTextHash: string | null;   // ⬅︎ hash renvoyé par /licence/cgv-status
  onAccepted: () => void;
};

export default function CGVModal({
  licenceId,
  version,
  textUrl,
  serverTextHash,
  onAccepted,
}: Props) {
  const [text, setText] = useState('');
  const [checked, setChecked] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // charge le texte et reset les états quand la version/URL change
  useEffect(() => {
    setChecked(false);
    setScrolled(false);
    setLoading(false);
    setText('');

    fetch(textUrl, { cache: 'no-store' })
      .then((r) => r.text())
      .then(setText)
      .catch(() => setText('Erreur de chargement des CGV.'));
  }, [textUrl, version]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setScrolled(true);
  };

  async function accept() {
    setLoading(true);
    try {
      if (!serverTextHash) {
        alert("Hash des CGV indisponible. Réessayez plus tard.");
        setLoading(false);
        return;
      }

      const r = await fetch(`${API_BASE}/licence/cgv-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenceId, version, textHash: serverTextHash }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error || 'Erreur enregistrement');
        setLoading(false);
        return;
      }

      onAccepted(); // laisse passer vers la Home
    } catch {
      alert('Erreur réseau');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-lg shadow-lg p-4">
        <h2 className="text-xl font-semibold mb-2">Conditions Générales de Vente</h2>
        <div className="text-xs text-gray-600 mb-2">Version : {version}</div>

        <div
          ref={boxRef}
          onScroll={onScroll}
          className="border rounded p-3 h-72 overflow-auto whitespace-pre-wrap text-sm bg-gray-50"
        >
          {text || 'Chargement…'}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <input
            id="cgv-ok"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <label htmlFor="cgv-ok" className="text-sm">
            J’ai lu et j’accepte les CGV.
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <a className="px-3 py-2 border rounded" href={textUrl} target="_blank" rel="noreferrer">
            Ouvrir
          </a>
          <button
            className="px-4 py-2 rounded text-white disabled:opacity-50"
            style={{ background: '#2563eb' }}
            disabled={!checked || !scrolled || loading}
            onClick={accept}
          >
            {loading ? 'Enregistrement…' : 'Accepter'}
          </button>
        </div>

        <p className="text-xs text-gray-500 mt-2">
          (Faites défiler jusqu’en bas et cochez la case pour valider.)
        </p>
      </div>
    </div>
  );
}

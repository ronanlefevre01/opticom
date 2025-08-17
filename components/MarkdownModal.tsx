import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type Props = {
  open: boolean;
  title: string;
  url: string; // ex: /legal/privacy.md
  onClose: () => void;
};

// Type local minimal pour le renderer `code`
type MyCodeProps = {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: any;
  [key: string]: any;
};

export default function MarkdownModal({ open, title, url, onClose }: Props) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();

    setLoading(true);
    setErr(null);
    setText("");

    fetch(url, { cache: "no-store", signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => !ac.signal.aborted && setText(t))
      .catch((e) => {
        if (!ac.signal.aborted) setErr(`Impossible de charger le document (${e.message}).`);
      })
      .finally(() => !ac.signal.aborted && setLoading(false));

    return () => ac.abort();
  }, [open, url]);

  if (!open) return null;

  const mdComponents: Components = {
    a: ({ node, ...props }) => (
      <a
        {...props}
        className="text-blue-600 underline"
        target="_blank"
        rel="noreferrer noopener"
      />
    ),
    code: ({ inline, className, children, ...props }: MyCodeProps) => {
      if (inline) {
        return (
          <code className={`bg-gray-100 px-1 rounded ${className ?? ""}`} {...props}>
            {children}
          </code>
        );
      }
      return (
        <pre className="bg-gray-100 p-2 rounded overflow-auto">
          <code className={className ?? ""} {...props}>
            {children}
          </code>
        </pre>
      );
    },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div
        className="bg-white w-full max-w-3xl rounded-lg shadow-lg overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="md-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 id="md-title" className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded border hover:bg-gray-50"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div className="p-4 max-h-[70vh] overflow-auto prose prose-sm sm:prose-base">
          {loading && <div>Chargement…</div>}
          {err && <div className="text-red-600">{err}</div>}
          {!loading && !err && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {text}
            </ReactMarkdown>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 px-4 py-3 border-t">
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm underline text-gray-600"
            title="Ouvrir dans un nouvel onglet"
          >
            Ouvrir le fichier brut
          </a>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-white"
            style={{ background: "#2563eb" }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from "react";
import MarkdownModal from "./MarkdownModal";

export default function FooterLegal() {
  const [open, setOpen] = useState<null | {title: string; url: string}>(null);

  // adapte le chemin si besoin
  const LINKS = [
    { label: "CGV",            title: "Conditions Générales de Vente", url: "/legal/cgv-2025-08-14.md" },
    { label: "Confidentialité", title: "Politique de confidentialité",  url: "/legal/privacy.md" },
    { label: "Mentions légales",title: "Mentions légales",              url: "/legal/mentions.md" },
  ];

  return (
    <>
      <div className="mt-8 pt-4 border-t text-xs text-gray-500 flex flex-wrap gap-4">
        {LINKS.map(link => (
          <button
            key={link.label}
            onClick={() => setOpen({ title: link.title, url: link.url })}
            className="underline hover:text-gray-700"
          >
            {link.label}
          </button>
        ))}
        <span className="opacity-60">© {new Date().getFullYear()} OVE Distribution</span>
      </div>

      <MarkdownModal
        open={!!open}
        title={open?.title || ""}
        url={open?.url || ""}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

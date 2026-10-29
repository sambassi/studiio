'use client';

/**
 * CINEMA IA — AIDE A LA REDACTION DE L'HISTOIRE (point d'entree discret).
 *
 * ⚠️ AUCUN APPEL RESEAU, AUCUNE IA PAYANTE. Tout se calcule dans le navigateur, avec la
 * MEME segmentation que le scenario (`phrases`, `citation` de `lib/cinema/scenario`) :
 * ce que l'aide annonce (« 7 plans », « 2 repliques ») est exactement ce que le serveur
 * decoupera. Une future aide generative passera par une action explicite et un cout
 * affiche — jamais par ce bouton.
 *
 * UX premium (`docs/UX-PREMIUM.md`) : une petite icone SVG, le detail a la demande dans un
 * panneau fermable (bouton, Echap, clic exterieur), clavier et mobile, libelles accessibles.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles, X, AlignLeft, MessageSquareQuote, Lightbulb } from 'lucide-react';
import { phrases, citation } from '@/lib/cinema/scenario';

/** Une phrase par ligne : meme decoupage que le scenario, donc aucun plan ne change. */
export function unePhraseParLigne(histoire: string): string {
  return phrases(histoire).join('\n');
}

/** Ajoute une replique a completer, au format reconnu par le scenario (guillemets). */
export function ajouterReplique(histoire: string, nom: string): string {
  const qui = nom.trim() || 'Nina';
  // ⚠️ Le point APRES le guillemet fermant : `phrases` coupe apres « . », et un point place
  // avant « » » laisserait la citation ouverte — la replique deviendrait de la narration.
  const ligne = `${qui} dit : « Votre replique ici ».`;
  const base = histoire.replace(/\s+$/, '');
  return base ? `${base}\n${ligne}` : ligne;
}

export function resumeTexte(histoire: string): { plans: number; repliques: number } {
  const ps = phrases(histoire);
  return { plans: ps.length, repliques: ps.filter((p) => citation(p) !== null).length };
}

const CONSEILS = [
  'Une action visible par phrase : elle devient un plan.',
  'Nommez le lieu et la lumiere (« a l’aube, dans la salle vide »).',
  'Une replique s’ecrit entre guillemets apres le nom du personnage.',
];

export default function AideRedaction({ histoire, surChanger, personnages = [] }: {
  histoire: string;
  surChanger: (texte: string) => void;
  personnages?: string[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const panneauId = useId();
  const racine = useRef<HTMLDivElement | null>(null);
  const bouton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOuvert(false); bouton.current?.focus(); }
    };
    const surClic = (e: MouseEvent | TouchEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('keydown', surTouche);
    document.addEventListener('mousedown', surClic);
    document.addEventListener('touchstart', surClic);
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.removeEventListener('mousedown', surClic);
      document.removeEventListener('touchstart', surClic);
    };
  }, [ouvert]);

  const { plans, repliques } = resumeTexte(histoire);
  const vide = plans === 0;
  const action = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-violet-500/10 disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <div ref={racine} className="absolute top-2 right-2">
      <button
        ref={bouton}
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-label="Aide a la redaction"
        title="Aide a la redaction"
        aria-expanded={ouvert}
        aria-controls={panneauId}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
          ouvert
            ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
            : 'border-slate-700/80 bg-slate-900/80 text-violet-300 hover:border-violet-500/60 hover:text-violet-200'
        }`}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </button>

      {ouvert && (
        <div
          id={panneauId}
          role="dialog"
          aria-label="Aide a la redaction"
          // `maxWidth` en ligne : jamais plus large que l'ecran du telephone. Pas de classe
          // Tailwind arbitraire (purgee en production, piege connu de CLAUDE.md).
          className="absolute right-0 top-9 z-20 w-72 rounded-xl border border-slate-700 bg-slate-950/95 p-3 shadow-xl backdrop-blur-sm"
          style={{ maxWidth: 'calc(100vw - 2rem)' }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-200">
              <Sparkles className="w-3.5 h-3.5" /> Aide a la redaction
            </span>
            <button
              type="button"
              onClick={() => { setOuvert(false); bouton.current?.focus(); }}
              aria-label="Fermer l’aide"
              className="text-slate-500 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="mb-2 text-[11px] text-slate-400">
            {vide ? 'Votre histoire est vide.' : `${plans} plan${plans > 1 ? 's' : ''} · ${repliques} replique${repliques > 1 ? 's' : ''}`}
          </p>

          <button type="button" disabled={vide} className={action} onClick={() => surChanger(unePhraseParLigne(histoire))}>
            <AlignLeft className="w-4 h-4 text-violet-300 shrink-0" /> Une phrase par ligne
          </button>
          <button type="button" className={action} onClick={() => surChanger(ajouterReplique(histoire, personnages[0] ?? ''))}>
            <MessageSquareQuote className="w-4 h-4 text-violet-300 shrink-0" /> Ajouter une replique
          </button>

          <div className="mt-2 border-t border-slate-800 pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <Lightbulb className="w-3.5 h-3.5 text-amber-300" /> Conseils
            </div>
            <ul className="space-y-1 text-[11px] leading-snug text-slate-400">
              {CONSEILS.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>

          <p className="mt-2 text-[10px] text-slate-500">Calcule sur votre appareil — aucune IA payante.</p>
        </div>
      )}
    </div>
  );
}

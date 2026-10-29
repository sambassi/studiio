'use client';

/**
 * CINEMA IA — AIDE A LA REDACTION DE L'HISTOIRE (point d'entree discret).
 *
 * DEUX FAMILLES D'ACTIONS, dans le meme panneau :
 *
 *   - MISE EN FORME, calculee dans le navigateur : aucun appel, aucune IA. Elle utilise la
 *     MEME segmentation que le scenario (`phrases`, `citation`), donc ce qu'elle annonce
 *     (« 7 plans », « 2 repliques ») est exactement ce que le serveur decoupera.
 *   - REDACTION ASSISTEE, qui appelle `/api/cinema/redaction` — le moteur de texte PARTAGE
 *     de Studiio (celui de « Creer »), avec la cle du serveur : aucun nouveau fournisseur,
 *     AUCUN credit debite. Le contexte du film (genre, personnages, nombre de scenes, texte
 *     deja saisi) part avec la demande.
 *
 * ⚠️ LE TEXTE DE L'UTILISATEUR N'EST JAMAIS REMPLACE AUTOMATIQUEMENT. Une proposition
 * s'affiche en APERCU, modifiable, avec ce que le decoupage en ferait ; elle ne remplace
 * l'histoire que sur « Appliquer ». « Rejeter » la jette, le texte d'origine est intact.
 *
 * UX premium (`docs/UX-PREMIUM.md`) : une petite icone SVG, le detail a la demande dans un
 * panneau fermable (bouton, Echap, clic exterieur), clavier et mobile, libelles accessibles.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles, X, AlignLeft, MessageSquareQuote, Lightbulb, Loader2, Check, Wand2, AlertTriangle } from 'lucide-react';
import { phrases, citation } from '@/lib/cinema/scenario';
import { ACTIONS_REDACTION, type DiagnosticProposition, type IdActionRedaction } from '@/lib/cinema/redaction';
import type { IdStyleCinema } from '@/lib/cinema/types';

/** Ce que l'aide envoie au moteur partage : le film tel qu'il est a l'ecran. */
export interface ContexteAide {
  titre?: string;
  styleCinema?: IdStyleCinema | null;
  nbScenes?: number;
  format?: string;
  casting?: ReadonlyArray<{ nom: string; role?: string; description?: string }>;
}

interface Proposition { action: IdActionRedaction; texte: string; diagnostic: DiagnosticProposition }

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

export default function AideRedaction({ histoire, surChanger, personnages = [], contexte }: {
  histoire: string;
  surChanger: (texte: string) => void;
  personnages?: string[];
  /** Absent : seules les actions locales sont proposees (aucun appel possible). */
  contexte?: ContexteAide;
}) {
  const [ouvert, setOuvert] = useState(false);
  /** Action IA en cours — une seule a la fois, pour ne pas lancer deux demandes. */
  const [enCours, setEnCours] = useState<IdActionRedaction | null>(null);
  const [proposition, setProposition] = useState<Proposition | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const panneauId = useId();
  const racine = useRef<HTMLDivElement | null>(null);
  const bouton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    const surTouche = (e: KeyboardEvent) => {
      // Une proposition a l'ecran : Echap la REJETTE d'abord (sans fermer), sinon on
      // perdrait le texte propose d'un coup de touche, sans l'avoir decide.
      if (e.key !== 'Escape') return;
      if (proposition) { setProposition(null); return; }
      setOuvert(false); bouton.current?.focus();
    };
    const surClic = (e: MouseEvent | TouchEvent) => {
      if (proposition) return; // un clic a cote ne jette pas une proposition
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
  }, [ouvert, proposition]);

  /**
   * Demande UNE proposition au moteur partage. Rien n'est applique ici : la reponse
   * s'affiche en apercu. Une erreur est DITE, jamais avalee, et le texte reste intact.
   */
  const demander = async (id: IdActionRedaction) => {
    if (!contexte || enCours) return;
    setEnCours(id); setErreur(null);
    try {
      const r = await fetch('/api/cinema/redaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: id,
          histoire,
          personnages: (contexte.casting ?? []).filter((c) => c.nom?.trim()),
          styleCinema: contexte.styleCinema ?? null,
          nbScenes: contexte.nbScenes,
          format: contexte.format,
          titre: contexte.titre,
        }),
      });
      const d = await r.json().catch(() => null);
      if (d?.ok && typeof d.texte === 'string' && d.texte.trim()) {
        setProposition({ action: id, texte: d.texte, diagnostic: d.diagnostic });
      } else {
        setErreur(typeof d?.erreur === 'string' ? d.erreur : 'L’aide IA n’a pas pu repondre. Votre texte n’a pas ete modifie.');
      }
    } catch {
      setErreur('L’aide IA est injoignable. Votre texte n’a pas ete modifie.');
    } finally {
      setEnCours(null);
    }
  };

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

          {contexte && (
            <div className="mt-2 border-t border-slate-800 pt-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <Wand2 className="w-3.5 h-3.5 text-violet-300" /> Rédaction assistée
              </div>

              {proposition ? (
                <div data-aide="apercu">
                  <p className="mb-1 text-[11px] text-slate-400">
                    Proposition · {ACTIONS_REDACTION.find((a) => a.id === proposition.action)?.libelle}
                  </p>
                  {/* Modifiable AVANT d'appliquer : accepter, corriger ou rejeter. */}
                  <textarea
                    value={proposition.texte}
                    onChange={(e) => setProposition({ ...proposition, texte: e.target.value })}
                    aria-label="Proposition de l’aide à la rédaction"
                    rows={6}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[11px] leading-relaxed"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    {proposition.diagnostic.plans} plan{proposition.diagnostic.plans > 1 ? 's' : ''} · {proposition.diagnostic.repliques} replique{proposition.diagnostic.repliques > 1 ? 's' : ''}
                  </p>
                  {proposition.diagnostic.inconnus.length > 0 && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      Noms hors casting : {proposition.diagnostic.inconnus.join(', ')} — ils n’apparaitront dans aucun plan.
                    </p>
                  )}
                  {proposition.diagnostic.repliquesCassees > 0 && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      {proposition.diagnostic.repliquesCassees} replique(s) avec un point dans les guillemets : elles seraient lues comme de la narration.
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { surChanger(proposition.texte); setProposition(null); }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/60 px-2 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-500/20"
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Appliquer
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposition(null)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" /> Rejeter
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">Votre texte reste intact tant que vous n’appliquez pas.</p>
                </div>
              ) : (
                <>
                  {ACTIONS_REDACTION.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={enCours !== null || (a.exigeTexte && vide)}
                      title={a.exigeTexte && vide ? 'Ecrivez d’abord quelques mots' : a.resume}
                      className={action}
                      onClick={() => demander(a.id)}
                    >
                      {enCours === a.id
                        ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-violet-300" />
                        : <Sparkles className="w-4 h-4 shrink-0 text-violet-300" />}
                      {a.libelle}
                    </button>
                  ))}
                  {erreur && (
                    <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-300" role="status">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {erreur}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-500">
                    Votre texte est envoyé à l’IA de Studiio. Aucun crédit n’est débité, et rien n’est remplacé sans votre accord.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="mt-2 border-t border-slate-800 pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
              <Lightbulb className="w-3.5 h-3.5 text-amber-300" /> Conseils
            </div>
            <ul className="space-y-1 text-[11px] leading-snug text-slate-400">
              {CONSEILS.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>

          <p className="mt-2 text-[10px] text-slate-500">Mise en forme calculee sur votre appareil — aucun credit.</p>
        </div>
      )}
    </div>
  );
}

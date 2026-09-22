'use client';

import { useCallback, useRef, useState } from 'react';
import { Loader2, RotateCcw, Sparkles, Check } from 'lucide-react';

/**
 * Photo d'affiche GENEREE PAR L'IA — le troisieme chemin, a cote de « Ma
 * photo » (envoi) et de la mediatheque.
 *
 * Reutilise l'action `generate-bg` de `/api/ai/image` (texte → image, au
 * format de la video : 9:16, 1:1 ou 16:9). Le serveur copie lui-meme l'image
 * produite dans le stockage Studiio et renvoie une URL DURABLE (`resultUrl`)
 * — le composant ne fait que le tour de l'utilisateur : consigne → Generer
 * (etat visible) → resultat → Regenerer ou « Utiliser comme affiche ». C'est
 * l'appelant qui range l'URL dans le brouillon (`onUtiliser`) ; il n'a plus
 * rien a recopier.
 *
 * Garde-fous cote client :
 *  - un verrou synchrone (`enVolRef`) : deux clics quasi simultanes ne
 *    lancent qu'UNE requete (donc un seul debit de credits) ;
 *  - un delai de 100 s (`AbortController`), juste au-dessus des ~90 s du
 *    serveur, pour que l'erreur serveur — qui dit la verite sur le debit —
 *    l'emporte normalement ; passe ce delai, le bouton est rendu ;
 *  - « Regenerer » est une nouvelle requete (5 credits) — jamais de reprise
 *    automatique.
 */

export type AfficheIAFormat = '9:16' | '1:1' | '16:9';

/** Ratio CSS (`aspect-ratio`) de l'apercu, par format. */
const ASPECT_RATIO: Record<AfficheIAFormat, string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

/** Delai client, un peu au-dessus des ~90 s que peut prendre le serveur. */
export const AFFICHE_IA_TIMEOUT_MS = 100_000;

export const AFFICHE_IA_MESSAGE_DELAI =
  'La génération a pris trop de temps. Réessayez — aucun crédit n’est débité si l’image n’a pas été produite.';

export interface AfficheIAProps {
  /** Suggestion de consigne (sujet de la video). */
  suggestion?: string;
  /** L'image retenue — l'appelant la persiste et l'applique. */
  onUtiliser: (url: string) => Promise<void> | void;
  /** Format de la video : dicte le format de l'image demandee et de l'apercu. */
  format?: AfficheIAFormat;
  /**
   * Photo de RÉFÉRENCE de l'utilisateur (son affiche/photo courante). Quand
   * elle existe et que « Partir de ma photo » est coché, la génération part de
   * cette image (modèle flux-kontext-pro) pour préserver le sujet — visage,
   * vêtements, identité — au lieu de partir d'un texte seul. Absente : l'option
   * reste proposée mais inerte, avec une consigne pour choisir d'abord une photo.
   */
  referenceUrl?: string | null;
  disabled?: boolean;
}

type Etat =
  | { statut: 'repos' }
  | { statut: 'generation' }
  | { statut: 'resultat'; url: string; creditsRemaining?: number }
  | { statut: 'application'; url: string }
  | { statut: 'erreur'; message: string; url?: string };

class DelaiDepasse extends Error {
  constructor() {
    super(AFFICHE_IA_MESSAGE_DELAI);
    this.name = 'DelaiDepasse';
  }
}

export default function AfficheIA({ suggestion = '', onUtiliser, format = '9:16', referenceUrl = null, disabled }: AfficheIAProps) {
  const [prompt, setPrompt] = useState('');
  const [etat, setEtat] = useState<Etat>({ statut: 'repos' });
  // « Partir de ma photo » : génération à partir de la photo de référence, pour
  // préserver le sujet. N'a d'effet que si `referenceUrl` existe.
  const [modeReference, setModeReference] = useState(false);
  const partirDeMaPhoto = modeReference && !!referenceUrl;
  /**
   * Verrou SYNCHRONE : `disabled` ne suffit pas, React ne re-rend pas entre
   * deux clics du meme tour d'evenements. Pose au tout debut de l'action,
   * leve dans `finally`.
   */
  const enVolRef = useRef(false);

  const generer = useCallback(async () => {
    if (enVolRef.current) return;
    enVolRef.current = true;
    // Le dernier resultat, pas encore applique : un « Regenerer » qui echoue
    // ne doit pas le faire disparaitre — l'utilisateur garde ce qu'il avait.
    const precedente = etat.statut === 'resultat' || etat.statut === 'erreur' ? etat.url : undefined;
    try {
      const consigne = (prompt.trim() || suggestion).trim();
      if (!consigne) {
        setEtat({ statut: 'erreur', message: 'Décrivez l’image souhaitée.' });
        return;
      }
      setEtat({ statut: 'generation' });

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const delai = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DelaiDepasse());
        }, AFFICHE_IA_TIMEOUT_MS);
      });

      try {
        const res = await Promise.race([
          fetch('/api/ai/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate-bg',
              prompt: consigne,
              format,
              // « Partir de ma photo » : la référence part au serveur, qui
              // bascule alors sur le modèle qui préserve le sujet.
              ...(partirDeMaPhoto ? { imageUrl: referenceUrl } : null),
            }),
            signal: controller.signal,
          }),
          delai,
        ]);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success || !data.resultUrl) {
          throw new Error(data?.error || `Erreur ${res.status}`);
        }
        setEtat({
          statut: 'resultat',
          url: data.resultUrl,
          creditsRemaining: typeof data.creditsRemaining === 'number' ? data.creditsRemaining : undefined,
        });
      } catch (err) {
        const message =
          err instanceof DelaiDepasse || (err instanceof Error && err.name === 'AbortError')
            ? AFFICHE_IA_MESSAGE_DELAI
            : err instanceof Error ? err.message : 'Génération impossible.';
        setEtat({ statut: 'erreur', message, url: precedente });
      } finally {
        if (timer) clearTimeout(timer);
      }
    } finally {
      enVolRef.current = false;
    }
  }, [prompt, suggestion, format, etat, partirDeMaPhoto, referenceUrl]);

  const utiliser = useCallback(async (url: string) => {
    if (enVolRef.current) return;
    enVolRef.current = true;
    setEtat({ statut: 'application', url });
    try {
      await onUtiliser(url);
      setEtat({ statut: 'resultat', url });
    } catch (err) {
      setEtat({ statut: 'erreur', message: err instanceof Error ? err.message : 'Image non appliquée.', url });
    } finally {
      enVolRef.current = false;
    }
  }, [onUtiliser]);

  const enCours = etat.statut === 'generation' || etat.statut === 'application';
  const url = 'url' in etat ? etat.url : null;
  const creditsRemaining = etat.statut === 'resultat' ? etat.creditsRemaining : undefined;

  return (
    <div className="space-y-2" data-affiche-ia data-affiche-ia-format={format}>
      <label className="block text-xs text-gray-400">
        Décrivez l’affiche (ambiance, lieu, lumière…)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          disabled={disabled || enCours}
          placeholder={suggestion ? `ex : ${suggestion}` : 'ex : salle de sport sombre, néons violets, énergie'}
          data-affiche-ia-prompt
          className="mt-1 w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none px-2.5 py-2 text-sm text-gray-100 resize-none"
        />
      </label>

      {/* « Partir de ma photo » : préserve le sujet (visage, vêtements) à
          partir de la photo/affiche courante, au lieu d'un texte seul. */}
      <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer" data-affiche-ia-mode-reference>
        <input
          type="checkbox"
          checked={modeReference}
          onChange={(e) => setModeReference(e.target.checked)}
          disabled={disabled || enCours}
          className="h-3.5 w-3.5 accent-purple-500"
        />
        Partir de ma photo (préserve mon visage / mes vêtements)
      </label>
      {modeReference && !referenceUrl && (
        <p className="text-[11px] text-amber-300" data-affiche-ia-reference-manquante>
          Choisissez d’abord une photo ou une affiche : elle servira de référence.
        </p>
      )}
      {partirDeMaPhoto && (
        <div className="flex items-center gap-2 text-[11px] text-gray-400" data-affiche-ia-reference-ok>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={referenceUrl ?? ''} alt="Référence" className="h-8 w-8 rounded object-cover border border-gray-700" />
          Référence : votre photo actuelle.
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void generer()}
          disabled={disabled || enCours || (modeReference && !referenceUrl)}
          data-affiche-ia-generer
          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-600/15 px-3 py-1.5 text-xs text-white hover:bg-purple-600/25 disabled:opacity-40 transition-colors"
        >
          {etat.statut === 'generation'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : url ? <RotateCcw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          {etat.statut === 'generation' ? 'Génération…' : url ? 'Régénérer' : 'Générer'}
        </button>
        <span className="text-[11px] text-gray-500">
          5 crédits par image
          {creditsRemaining !== undefined && (
            <span data-affiche-ia-credits-restants> · {creditsRemaining} restants</span>
          )}
        </span>
      </div>

      {etat.statut === 'generation' && (
        <p className="text-xs text-gray-400" role="status" data-affiche-ia-etat="generation">
          L’image se prépare — une vingtaine de secondes.
        </p>
      )}

      {etat.statut === 'erreur' && (
        <p className="text-xs text-amber-300" role="alert" data-affiche-ia-etat="erreur">{etat.message}</p>
      )}

      {url && (
        <div className="space-y-2" data-affiche-ia-resultat>
          {/* Le resultat, au ratio de la video (meme format que la demande), sans rognage. */}
          <div
            className="w-full max-w-[220px] rounded-xl overflow-hidden bg-black border border-gray-800"
            style={{ aspectRatio: ASPECT_RATIO[format] }}
            data-affiche-ia-apercu
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Affiche générée" className="w-full h-full object-contain" />
          </div>
          <button
            type="button"
            onClick={() => void utiliser(url)}
            disabled={disabled || enCours}
            data-affiche-ia-utiliser
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
          >
            {etat.statut === 'application' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {etat.statut === 'application' ? 'Enregistrement…' : 'Utiliser comme affiche'}
          </button>
        </div>
      )}
    </div>
  );
}

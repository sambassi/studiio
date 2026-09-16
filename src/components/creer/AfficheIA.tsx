'use client';

import { useCallback, useState } from 'react';
import { Loader2, RotateCcw, Sparkles, Check } from 'lucide-react';

/**
 * Photo d'affiche GENEREE PAR L'IA — le troisieme chemin, a cote de « Ma
 * photo » (envoi) et de la mediatheque.
 *
 * Reutilise l'action `generate-bg` de `/api/ai/image` (texte → image, 9:16,
 * la meme que la « Retouche IA »). Le composant ne fait que le tour de
 * l'utilisateur : consigne → Generer (etat visible) → resultat → Regenerer
 * ou « Utiliser comme affiche ». C'est l'appelant qui range l'image dans le
 * brouillon (`onUtiliser`), car l'URL renvoyee par le modele est temporaire :
 * il la copie au stockage, comme une photo envoyee.
 */

export interface AfficheIAProps {
  /** Suggestion de consigne (sujet de la video). */
  suggestion?: string;
  /** L'image retenue — l'appelant la persiste et l'applique. */
  onUtiliser: (url: string) => Promise<void> | void;
  disabled?: boolean;
}

type Etat =
  | { statut: 'repos' }
  | { statut: 'generation' }
  | { statut: 'resultat'; url: string }
  | { statut: 'application'; url: string }
  | { statut: 'erreur'; message: string; url?: string };

export default function AfficheIA({ suggestion = '', onUtiliser, disabled }: AfficheIAProps) {
  const [prompt, setPrompt] = useState('');
  const [etat, setEtat] = useState<Etat>({ statut: 'repos' });

  const generer = useCallback(async () => {
    const consigne = (prompt.trim() || suggestion).trim();
    if (!consigne) {
      setEtat({ statut: 'erreur', message: 'Décrivez l’image souhaitée.' });
      return;
    }
    setEtat({ statut: 'generation' });
    try {
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-bg', prompt: consigne }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data.resultUrl) {
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      setEtat({ statut: 'resultat', url: data.resultUrl });
    } catch (err) {
      setEtat({ statut: 'erreur', message: err instanceof Error ? err.message : 'Génération impossible.' });
    }
  }, [prompt, suggestion]);

  const utiliser = useCallback(async (url: string) => {
    setEtat({ statut: 'application', url });
    try {
      await onUtiliser(url);
      setEtat({ statut: 'resultat', url });
    } catch (err) {
      setEtat({ statut: 'erreur', message: err instanceof Error ? err.message : 'Image non appliquée.', url });
    }
  }, [onUtiliser]);

  const enCours = etat.statut === 'generation' || etat.statut === 'application';
  const url = 'url' in etat ? etat.url : null;

  return (
    <div className="space-y-2" data-affiche-ia>
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={generer}
          disabled={disabled || enCours}
          data-affiche-ia-generer
          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-600/15 px-3 py-1.5 text-xs text-white hover:bg-purple-600/25 disabled:opacity-40 transition-colors"
        >
          {etat.statut === 'generation'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : url ? <RotateCcw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
          {etat.statut === 'generation' ? 'Génération…' : url ? 'Régénérer' : 'Générer'}
        </button>
        <span className="text-[11px] text-gray-500">5 crédits par image</span>
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
          {/* Le resultat, au ratio de la video, sans rognage. */}
          <div className="w-full max-w-[220px] rounded-xl overflow-hidden bg-black border border-gray-800" style={{ aspectRatio: '9 / 16' }}>
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

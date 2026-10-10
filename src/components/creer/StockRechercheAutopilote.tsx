'use client';

import { useCallback, useState } from 'react';
import { Check, ExternalLink, Info, Loader2, Plus, Search, X } from 'lucide-react';
import { importerStockClient, rechercherStockClient } from '@/lib/stock/client';
import type { FormatStock, MediaStock, TypeStock } from '@/lib/stock/types';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';

/**
 * Rechercher et RETENIR des médias stock pour l'Autopilote — vidéos Pexels,
 * photos Pexels et Unsplash.
 *
 * ⚠️ PAR LES ROUTES STUDIIO UNIQUEMENT. La recherche passe par
 * `/api/stock/recherche` (le moteur commun à Créer), la sélection par
 * `/api/stock/importer` — jamais un appel direct à api.pexels.com ou
 * api.unsplash.com depuis le navigateur.
 *
 *   - vidéo Pexels : importée dans la Médiathèque (URL de stockage Studiio),
 *     elle rejoint aussi la banque de rushes ;
 *   - photo Unsplash : `importer` SIGNALE le téléchargement (règle Unsplash)
 *     et rend l'URL hotlink ; rien n'est recopié ;
 *   - photo Pexels : aucune importation, l'URL Pexels est retenue telle quelle.
 *
 * ⚠️ JAMAIS BLOQUANT. Fournisseur en panne : un message discret, rien d'autre.
 */

export const MESSAGE_RECHERCHE_INDISPONIBLE = 'Recherche Pexels / Unsplash indisponible pour le moment. Réessayez plus tard.';

export function cleMediaStock(m: { provider: string; type: string; providerAssetId: string }): string {
  return `${m.provider}-${m.type}-${m.providerAssetId}`;
}

function nomFournisseur(p: string): string {
  return p === 'unsplash' ? 'Unsplash' : 'Pexels';
}

/** « Vidéo de X sur Pexels » — l'attribution affichée partout où le média est montré. */
export function libelleAttribution(m: { type: string; auteur: string; provider: string }): string {
  return `${m.type === 'video' ? 'Vidéo' : 'Photo'} de ${m.auteur || 'auteur inconnu'} sur ${nomFournisseur(m.provider)}`;
}

type Mode = 'video' | 'photo';

export default function StockRechercheAutopilote({
  sujet, format, accent, dejaRetenus, onRetenir, titre, onFermer, ident = 'general',
}: {
  sujet: string;
  format: FormatStock;
  accent: string;
  /** Clés (`cleMediaStock`) des médias déjà retenus. */
  dejaRetenus: string[];
  /** Reçoit le média prêt à enregistrer (URL d'import pour une vidéo). */
  onRetenir: (m: MediaStockRetenu) => void;
  titre?: string;
  onFermer?: () => void;
  ident?: string;
}) {
  const [requete, setRequete] = useState(sujet);
  const [mode, setMode] = useState<Mode>('video');
  const [resultats, setResultats] = useState<MediaStock[] | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [imports, setImports] = useState<Record<string, 'import' | 'erreur'>>({});

  const chercher = useCallback(async (type: TypeStock, q: string) => {
    const texte = q.trim().slice(0, 80);
    if (!texte) return;
    setEnCours(true);
    setMessage(null);
    const r = await rechercherStockClient({
      requete: texte, type, format, fournisseurs: type === 'video' ? ['pexels'] : ['pexels', 'unsplash'],
    });
    // Unsplash ne sert QUE des photos : une « vidéo Unsplash » n'existe pas.
    const medias = r.medias.filter((m) => m.type === type && (type === 'photo' || m.provider === 'pexels'));
    setResultats(medias.slice(0, 8));
    if (medias.length === 0) setMessage(r.echecs.length > 0 ? MESSAGE_RECHERCHE_INDISPONIBLE : 'Aucun résultat pour cette recherche.');
    else if (r.echecs.length > 0) setMessage('Un fournisseur ne répond pas : résultats partiels.');
    setEnCours(false);
  }, [format]);

  const retenir = useCallback(async (m: MediaStock) => {
    const cle = cleMediaStock(m);
    let url = m.fichierUrl;
    // Vidéo Pexels → Médiathèque ; photo Unsplash → téléchargement signalé.
    if (m.type === 'video' || m.provider === 'unsplash') {
      setImports((x) => ({ ...x, [cle]: 'import' }));
      const r = await importerStockClient({ provider: m.provider, type: m.type, providerAssetId: m.providerAssetId });
      if ('erreur' in r || !r.url) {
        setImports((x) => ({ ...x, [cle]: 'erreur' }));
        return;
      }
      url = r.url;
    }
    setImports((x) => { const y = { ...x }; delete y[cle]; return y; });
    onRetenir({
      url,
      type: m.type,
      provider: m.provider,
      providerAssetId: m.providerAssetId,
      auteur: m.auteur,
      sourceUrl: m.sourceUrl,
      licence: m.licence,
      vignetteUrl: m.vignetteUrl,
    });
  }, [onRetenir]);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-2 space-y-2 min-w-0" data-autopilot-stock-recherche={ident}>
      {(titre || onFermer) && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-gray-300 min-w-0 truncate">{titre}</p>
          {onFermer && (
            <button type="button" onClick={onFermer} aria-label="Fermer la recherche" className="shrink-0 text-gray-500 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex gap-1" role="group" aria-label="Type de média">
        {(['video', 'photo'] as Mode[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={mode === t}
            onClick={() => { setMode(t); setResultats(null); setMessage(null); }}
            data-autopilot-stock-mode={t}
            className={`rounded px-2 py-0.5 text-[10px] border ${mode === t ? 'border-purple-500 text-white bg-purple-500/10' : 'border-gray-800 text-gray-400 hover:text-white'}`}
          >
            {t === 'video' ? 'Vidéos Pexels' : 'Photos Pexels / Unsplash'}
          </button>
        ))}
      </div>
      <form
        className="flex gap-1 min-w-0"
        onSubmit={(e) => { e.preventDefault(); void chercher(mode, requete); }}
      >
        <input
          type="text"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Ex. : danse en studio"
          aria-label="Rechercher un média stock"
          data-autopilot-stock-requete={ident}
          className="flex-1 min-w-0 rounded border border-gray-800 bg-gray-950 px-1.5 py-1 text-[11px] text-gray-200 placeholder:text-gray-600"
        />
        <button
          type="submit"
          disabled={enCours}
          data-autopilot-stock-lancer={ident}
          className="shrink-0 flex items-center gap-1 rounded border border-gray-800 px-2 py-1 text-[10px] text-gray-300 hover:text-white disabled:opacity-40"
        >
          {enCours ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Rechercher
        </button>
      </form>
      {message && (
        <p className="flex items-start gap-1.5 text-[11px] text-gray-400" data-autopilot-stock-recherche-message>
          <Info className="w-3 h-3 mt-0.5 shrink-0" /> {message}
        </p>
      )}
      {resultats && resultats.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {resultats.map((m) => {
            const cle = cleMediaStock(m);
            const deja = dejaRetenus.includes(cle);
            const etat = imports[cle];
            return (
              <li key={cle} className="flex gap-2 rounded border border-gray-800 p-1.5 min-w-0" data-autopilot-stock-resultat={cle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.vignetteUrl} alt={m.description || libelleAttribution(m)} className="w-10 h-14 rounded object-cover bg-gray-800 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1 text-[10px] text-gray-400">
                  <p className="break-words">
                    {m.type === 'video' ? 'Vidéo' : 'Photo'} de {m.auteur} sur{' '}
                    <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline hover:text-white">
                      {nomFournisseur(m.provider)} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </p>
                  {deja ? (
                    <p className="flex items-center gap-1 text-emerald-400"><Check className="w-3 h-3" /> Retenu</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { void retenir(m); }}
                      disabled={etat === 'import'}
                      data-autopilot-stock-retenir={cle}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
                      style={{ backgroundColor: accent }}
                    >
                      {etat === 'import' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Plus className="w-2.5 h-2.5" />} Retenir
                    </button>
                  )}
                  {etat === 'erreur' && <p className="text-amber-400" data-autopilot-stock-retenir-erreur>Import impossible pour le moment — réessayez.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

/**
 * A_3d2 — LA BIBLIOTHÈQUE DE TRANSITIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'APERÇU EST UN RENDU, PAS UNE ANIMATION CSS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `circleopen`, un `pixelize` ou un `hblur` sont des transformations par
 * pixel : aucune règle CSS ne les reproduit. Chaque carte affiche donc une
 * image animée fabriquée par la route d'aperçu — le MÊME ffmpeg, le MÊME
 * filtre, la MÊME durée que le montage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ RIEN N'EST TÉLÉCHARGÉ AVANT D'ÊTRE REGARDÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Vingt-neuf aperçus font près de deux méga-octets. La carte ne demande donc
 * son image que lorsqu'elle est ACTIVE — survolée, au clavier, ou déjà
 * choisie — ou lorsqu'elle fait partie des six premières de « Pour vous ».
 * Les autres montrent leur nom sur un fond, et rien ne part sur le réseau.
 *
 * L'adresse porte l'identifiant, la version du catalogue et la durée : deux
 * aperçus identiques ont la même adresse, et le navigateur ne la redemande
 * pas au second survol.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check, Film } from 'lucide-react';
import {
  TRANSITIONS_CREATIVES, VERSION_TRANSITIONS, type TransitionCreative,
} from '@/lib/creatif/transitions';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

/** Les cartes qui chargent leur aperçu d'emblée, dans « Pour vous ». */
export const APERCUS_IMMEDIATS = 6;

/**
 * L'adresse d'un aperçu — déterministe, donc cachable.
 *
 * Exportée pour être testée : c'est ici que le cache pourrait se mettre à
 * manquer, et un test vaut mieux qu'une relecture.
 */
export function adresseApercu(
  id: string, dureeMs: number, analyseId?: string | null,
): string {
  const q = new URLSearchParams({ duree: String(Math.round(dureeMs)), v: VERSION_TRANSITIONS });
  if (analyseId) q.set('analyse', analyseId);
  return `/api/creatif/transitions/${encodeURIComponent(id)}/apercu?${q.toString()}`;
}

export interface BibliothequeTransitionsProps {
  transitionActive: string | null;
  onChoisir: (id: string, dureeDefautMs: number) => void;
  dureeMs?: number;
  analyseId?: string | null;
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  recents?: readonly string[];
}

type Rayon = 'pour-vous' | 'favoris' | 'recents' | CategorieCreative | 'tout';

export default function BibliothequeTransitions({
  transitionActive, onChoisir, dureeMs, analyseId = null,
  favoris = [], onBasculerFavori, recents = [],
}: BibliothequeTransitionsProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');
  /** Les cartes que la personne a regardées : elles seules chargent. */
  const [eveillees, setEveillees] = useState<readonly string[]>([]);

  const visibles = useMemo(() => {
    const cherchees = chercher(TRANSITIONS_CREATIVES, requete);
    if (requete.trim() !== '') return trierEntrees(cherchees);
    if (rayon === 'favoris') return trierEntrees(cherchees.filter((x) => favoris.includes(x.id)));
    if (rayon === 'recents') {
      return recents
        .map((id) => cherchees.find((x) => x.id === id))
        .filter((x): x is TransitionCreative => x !== undefined);
    }
    if (rayon === 'pour-vous') {
      // La transition ACTIVE d'abord : sinon la grille s'ouvre sans montrer
      // ce qui est déjà appliqué.
      const ordre = [transitionActive ?? 'cut', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: TransitionCreative[] = [];
      for (const id of ordre) {
        const x = cherchees.find((y) => y.id === id);
        if (x && !mis.has(x.id)) { sortie.push(x); mis.add(x.id); }
      }
      for (const x of trierEntrees(cherchees)) {
        if (sortie.length >= 10) break;
        if (!mis.has(x.id)) { sortie.push(x); mis.add(x.id); }
      }
      return sortie;
    }
    if (rayon === 'tout') return trierEntrees(cherchees);
    return trierEntrees(cherchees.filter((x) => x.categorie === rayon));
  }, [requete, rayon, favoris, recents, transitionActive]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  const eveiller = (id: string) => setEveillees(
    (e) => (e.includes(id) ? e : [...e, id]),
  );

  return (
    <div
      className="space-y-2"
      data-bibliotheque-transitions
      data-transitions-visibles={visibles.length}
    >
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher — fondu, glisse, cercle, zoom…"
          data-transitions-recherche
          aria-label="Chercher une transition"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons de transitions">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-transitions-rayon={r.cle}
            onClick={() => setRayon(r.cle)}
            className={`rounded-full px-2 py-1 text-[10px] leading-none transition ${
              rayon === r.cle
                ? 'bg-purple-500/20 text-purple-300'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {r.libelle}
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p data-transitions-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucune transition ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {visibles.map((tr, rang) => {
            const choisi = transitionActive === tr.id
              || (transitionActive === null && tr.id === 'cut');
            const favori = favoris.includes(tr.id);
            /* ⚠️ LE CHARGEMENT EST DIFFÉRÉ, ET C'EST LE POINT. Vingt-neuf
               aperçus feraient près de deux méga-octets d'un coup. */
            const charge = choisi || eveillees.includes(tr.id)
              || (rayon === 'pour-vous' && requete === '' && rang < APERCUS_IMMEDIATS);
            const src = adresseApercu(tr.id, dureeMs ?? tr.dureeDefautMs, analyseId);
            return (
              <li key={tr.id} className="relative">
                <button
                  type="button"
                  onClick={() => onChoisir(tr.id, tr.dureeDefautMs)}
                  onMouseEnter={() => eveiller(tr.id)}
                  onFocus={() => eveiller(tr.id)}
                  aria-pressed={choisi}
                  aria-label={`${tr.nom} — ${tr.description}`}
                  title={tr.description}
                  data-transition-carte={tr.id}
                  data-transition-chargee={charge ? 'oui' : 'non'}
                  className={`block w-full overflow-hidden rounded-lg border text-left transition
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                    choisi
                      ? 'border-purple-500/70 bg-purple-500/[0.06]'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span
                    className="flex items-center justify-center overflow-hidden bg-black/50"
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {charge ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        data-transition-apercu={tr.id}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Film className="h-4 w-4 text-gray-700" aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-1">
                    {choisi && <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />}
                    <span className="truncate text-[10px] text-gray-300">{tr.nom}</span>
                  </span>
                </button>
                {onBasculerFavori && (
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(tr.id)}
                    aria-pressed={favori}
                    aria-label={favori
                      ? `Retirer ${tr.nom} des favoris` : `Ajouter ${tr.nom} aux favoris`}
                    data-transition-favori={tr.id}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1
                      text-gray-300 transition hover:text-pink-300
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                  >
                    <Heart
                      className={`h-3 w-3 ${favori ? 'fill-pink-400 text-pink-400' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

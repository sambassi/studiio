'use client';

/**
 * A_4c — LA BIBLIOTHÈQUE DE SOUS-TITRES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'APERÇU EST UN RENDU, PAS UNE IMITATION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un karaoké se remplit avec `\kf`, un mot actif repeint une portion de
 * texte : ni l'un ni l'autre ne s'imite en CSS. Chaque carte affiche donc une
 * image animée fabriquée par le MÊME `documentCaptions` que la vidéo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ DEUX RAYONS QUI NE SONT PAS DES CATÉGORIES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « Mot actif » et « Karaoké » ne décrivent pas une ambiance mais une
 * TECHNIQUE — c'est ce qu'on vient chercher. Ils se dérivent du champ
 * `surbrillance`, sans inventer deux catégories de plus dans le contrat
 * créatif partagé.
 *
 * ⚠️ RIEN N'EST TÉLÉCHARGÉ AVANT D'ÊTRE REGARDÉ. Trente et un aperçus font
 * plus d'un méga-octet. Une carte ne demande son image que si elle est
 * active, survolée, au clavier, ou parmi les six premières.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check, Subtitles } from 'lucide-react';
import {
  STYLES_CAPTION, VERSION_CAPTIONS, type StyleCaption,
} from '@/lib/creatif/captions';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

export const APERCUS_IMMEDIATS = 6;

/** L'adresse d'un aperçu — déterministe, donc cachable. */
export function adresseApercuCaption(
  id: string, position: string, couleurTexte: string, couleurAccent: string,
): string {
  const q = new URLSearchParams({
    position, texte: couleurTexte, accent: couleurAccent, v: VERSION_CAPTIONS,
  });
  return `/api/creatif/captions/${encodeURIComponent(id)}/apercu?${q.toString()}`;
}

export interface BibliothequeCaptionsProps {
  styleActif: string | null;
  onChoisir: (id: string) => void;
  position?: string;
  couleurTexte?: string;
  couleurAccent?: string;
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  recents?: readonly string[];
}

type Rayon =
  | 'pour-vous' | 'favoris' | 'recents'
  | 'mot-actif' | 'karaoke' | CategorieCreative | 'tout';

export default function BibliothequeCaptions({
  styleActif, onChoisir, position = 'centre-bas',
  couleurTexte = '#FFFFFF', couleurAccent = '#EC4899',
  favoris = [], onBasculerFavori, recents = [],
}: BibliothequeCaptionsProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');
  const [eveillees, setEveillees] = useState<readonly string[]>([]);

  const visibles = useMemo(() => {
    const cherchees = chercher(STYLES_CAPTION, requete);
    if (requete.trim() !== '') return trierEntrees(cherchees);
    if (rayon === 'favoris') return trierEntrees(cherchees.filter((x) => favoris.includes(x.id)));
    if (rayon === 'recents') {
      return recents
        .map((id) => cherchees.find((x) => x.id === id))
        .filter((x): x is StyleCaption => x !== undefined);
    }
    if (rayon === 'mot-actif') {
      return trierEntrees(cherchees.filter((x) => x.surbrillance.startsWith('mot-actif')));
    }
    if (rayon === 'karaoke') {
      return trierEntrees(cherchees.filter((x) => x.surbrillance === 'karaoke'));
    }
    if (rayon === 'pour-vous') {
      // Le style ACTIF d'abord : sinon la grille s'ouvre sans montrer ce qui
      // est déjà appliqué.
      const ordre = [styleActif ?? '', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: StyleCaption[] = [];
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
  }, [requete, rayon, favoris, recents, styleActif]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    { cle: 'mot-actif', libelle: 'Mot actif' },
    { cle: 'karaoke', libelle: 'Karaoké' },
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  const eveiller = (id: string) => setEveillees((e) => (e.includes(id) ? e : [...e, id]));

  return (
    <div className="space-y-2" data-bibliotheque-captions data-captions-visibles={visibles.length}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher — karaoké, mot actif, minimal, cinéma…"
          data-captions-recherche
          aria-label="Chercher un style de sous-titre"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons de sous-titres">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-captions-rayon={r.cle}
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
        <p data-captions-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucun style ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {visibles.map((st, rang) => {
            const choisi = styleActif === st.id;
            const favori = favoris.includes(st.id);
            const charge = choisi || eveillees.includes(st.id)
              || (rayon === 'pour-vous' && requete === '' && rang < APERCUS_IMMEDIATS);
            const src = adresseApercuCaption(st.id, position, couleurTexte, couleurAccent);
            return (
              <li key={st.id} className="relative">
                <button
                  type="button"
                  onClick={() => onChoisir(st.id)}
                  onMouseEnter={() => eveiller(st.id)}
                  onFocus={() => eveiller(st.id)}
                  aria-pressed={choisi}
                  aria-label={`${st.nom} — ${st.description}`}
                  title={st.description}
                  data-caption-carte={st.id}
                  data-caption-chargee={charge ? 'oui' : 'non'}
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
                        data-caption-apercu={st.id}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Subtitles className="h-4 w-4 text-gray-700" aria-hidden="true" />
                    )}
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-1">
                    {choisi && <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />}
                    <span className="truncate text-[10px] text-gray-300">{st.nom}</span>
                  </span>
                </button>
                {onBasculerFavori && (
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(st.id)}
                    aria-pressed={favori}
                    aria-label={favori
                      ? `Retirer ${st.nom} des favoris` : `Ajouter ${st.nom} aux favoris`}
                    data-caption-favori={st.id}
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

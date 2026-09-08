'use client';

/**
 * A_3b — LA BIBLIOTHÈQUE DE STYLES DE TEXTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CHAQUE CARTE MONTRE LE TEXTE DE LA PERSONNE, PAS UN MOT GÉNÉRIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « Aa » ne dit rien : ni la casse, ni la longueur, ni ce que le style fait
 * d'une vraie phrase. La carte affiche donc l'accroche déjà saisie — et à
 * défaut un exemple court, jamais un alphabet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'APERÇU TRADUIT LE MÊME CONTRAT QUE `drawtext`, CHAMP PAR CHAMP
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   `contour`  → `borderw`/`bordercolor`  → `-webkit-text-stroke`
 *   `ombre`    → `shadowx/y`/`shadowcolor`→ `text-shadow`
 *   `fond`     → `box`/`boxcolor`         → `background-color` + `padding`
 *   `casse`    → texte mis en capitales AVANT écriture du fichier
 *   `echelle`  → `fontsize`               → taille relative
 *
 * Ce sont des traductions, pas des approximations décoratives : chaque ligne
 * de CSS correspond à une option que le moteur émet réellement. Un aperçu
 * qui ajouterait un dégradé ou un arrondi promettrait ce que `drawtext` ne
 * sait pas faire.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check } from 'lucide-react';
import { STYLES_TEXTE, type StyleTexteCreatif } from '@/lib/creatif/styles-texte';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

/** Les piles navigateur les plus proches des trois familles serveur. */
const PILES = {
  sans: 'Liberation Sans, Arial, Helvetica, sans-serif',
  serif: 'Liberation Serif, Times New Roman, Times, serif',
  mono: 'Liberation Mono, Courier New, Courier, monospace',
} as const;

const TEINTES = { noir: '0,0,0', blanc: '255,255,255' } as const;

/**
 * Le style CSS d'une carte — la traduction du contrat, et rien de plus.
 *
 * Exporté pour être testé : c'est ici que l'aperçu pourrait se mettre à
 * mentir, et un test vaut mieux qu'une relecture.
 */
export function apparenceStyle(
  st: StyleTexteCreatif, couleur: string,
): React.CSSProperties {
  const app: React.CSSProperties = {
    fontFamily: PILES[st.police],
    fontWeight: st.graisse === 'grasse' ? 700 : 400,
    color: couleur,
    fontSize: `${Math.round(11 * st.echelle)}px`,
    textTransform: st.casse === 'majuscules' ? 'uppercase' : 'none',
  };
  if (st.contour) {
    // `borderw` dessine un liseré autour du glyphe : `text-stroke` est son
    // équivalent exact côté navigateur.
    app.WebkitTextStroke = `${st.contour.largeur / 2}px rgb(${TEINTES[st.contour.teinte]})`;
  }
  if (st.ombre) {
    const d = st.ombre.decalage;
    app.textShadow = `${d}px ${d}px ${d}px rgba(${TEINTES[st.ombre.teinte]},${st.ombre.opacite})`;
  }
  if (st.fond) {
    app.backgroundColor = `rgba(${TEINTES[st.fond.teinte]},${st.fond.opacite})`;
    app.padding = `${Math.round(st.fond.marge / 3)}px ${Math.round(st.fond.marge / 2)}px`;
  }
  return app;
}

export interface BibliothequeStylesTexteProps {
  styleActif: string | null;
  onChoisir: (id: string) => void;
  /** L'accroche déjà saisie : la carte montre CE texte. */
  exemple?: string;
  /** La couleur de marque : la même que le rendu appliquera. */
  couleur?: string;
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  recents?: readonly string[];
}

type Rayon = 'pour-vous' | 'favoris' | 'recents' | CategorieCreative | 'tout';

export default function BibliothequeStylesTexte({
  styleActif, onChoisir, exemple, couleur = '#FFFFFF',
  favoris = [], onBasculerFavori, recents = [],
}: BibliothequeStylesTexteProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');

  const texte = (exemple ?? '').trim() || 'Votre texte ici';

  const visibles = useMemo(() => {
    const rendus = STYLES_TEXTE.filter((x) => x.rendu);
    const cherches = chercher(rendus, requete);
    if (requete.trim() !== '') return trierEntrees(cherches);
    if (rayon === 'favoris') return trierEntrees(cherches.filter((x) => favoris.includes(x.id)));
    if (rayon === 'recents') {
      return recents
        .map((id) => cherches.find((x) => x.id === id))
        .filter((x): x is StyleTexteCreatif => x !== undefined);
    }
    if (rayon === 'pour-vous') {
      /* ⚠️ LE STYLE ACTIF PASSE TOUJOURS EN TÊTE. Sans cela, ouvrir la
         bibliothèque montrait dix cartes dont aucune n'était sélectionnée —
         alors qu'un style EST bien appliqué. On paraissait avoir perdu son
         réglage. Le défaut « Standard » est en catégorie « sobre », donc
         classé en dernier : il ne serait jamais apparu. */
      const ordre = [styleActif ?? 'defaut', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: StyleTexteCreatif[] = [];
      for (const id of ordre) {
        const x = cherches.find((y) => y.id === id);
        if (x && !mis.has(x.id)) { sortie.push(x); mis.add(x.id); }
      }
      for (const x of trierEntrees(cherches)) {
        if (sortie.length >= 10) break;
        if (!mis.has(x.id)) { sortie.push(x); mis.add(x.id); }
      }
      return sortie;
    }
    if (rayon === 'tout') return trierEntrees(cherches);
    return trierEntrees(cherches.filter((x) => x.categorie === rayon));
  }, [requete, rayon, favoris, recents, styleActif]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  return (
    <div className="space-y-2" data-bibliotheque-styles data-styles-visibles={visibles.length}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher un style — gras, sobre, sport…"
          data-styles-recherche
          aria-label="Chercher un style de texte"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons de styles">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-styles-rayon={r.cle}
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
        <p data-styles-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucun style ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {visibles.map((st) => {
            const choisi = styleActif === st.id
              || (styleActif === null && st.id === 'defaut');
            const favori = favoris.includes(st.id);
            return (
              <li key={st.id} className="relative">
                <button
                  type="button"
                  onClick={() => onChoisir(st.id)}
                  aria-pressed={choisi}
                  aria-label={`${st.nom} — ${st.description}`}
                  title={st.description}
                  data-style-carte={st.id}
                  className={`block w-full overflow-hidden rounded-lg border text-left transition
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                    choisi
                      ? 'border-purple-500/70 bg-purple-500/[0.06]'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span
                    className="flex items-center justify-center overflow-hidden bg-black/50 px-2"
                    style={{ aspectRatio: '16 / 7' }}
                  >
                    <span
                      data-style-apercu={st.id}
                      className="max-w-full truncate text-center leading-tight"
                      style={apparenceStyle(st, couleur)}
                    >
                      {texte}
                    </span>
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
                    data-style-favori={st.id}
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

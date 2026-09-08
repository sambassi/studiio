'use client';

/**
 * A_3c1 — LA BIBLIOTHÈQUE D'ANIMATIONS DE TEXTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'APERÇU DÉRIVE DU MÊME `GesteBloc` QUE LE RENDU
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur transforme le geste en expressions `alpha` / `x` / `y` /
 * `fontsize` pour `drawtext` ; l'aperçu le transforme en images-clés CSS. Les
 * DEUX lisent la même définition — opacité de départ, décalage en pourcent,
 * échelle de départ, dépassement, durée d'entrée.
 *
 * Une animation CSS écrite à la main finirait par montrer un mouvement que
 * le MP4 ne fait pas : c'est exactement le mensonge que ce lot refuse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `prefers-reduced-motion`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les cartes cessent de bouger quand le système le demande — mais le rendu
 * final, lui, garde l'animation choisie : c'est une préférence d'affichage,
 * pas un réglage de montage.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check } from 'lucide-react';
import {
  ANIMATIONS_TEXTE, type AnimationTexteCreative,
} from '@/lib/creatif/animations-texte';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

/**
 * Les images-clés d'un geste, en CSS — la traduction du contrat.
 *
 * Exportée pour être testée : c'est ici que l'aperçu pourrait diverger du
 * moteur, et un test vaut mieux qu'une relecture.
 */
export function imagesClesGeste(anim: AnimationTexteCreative): {
  depart: React.CSSProperties; arrivee: React.CSSProperties; dureeMs: number;
} {
  const g = anim.geste;
  /* Le décalage est en part du CADRE côté moteur ; ici, le cadre est la
     carte. Le pourcentage se transpose donc tel quel — c'est la même
     grandeur relative, ce qui est précisément l'intérêt de l'exprimer en
     pourcentage plutôt qu'en pixels. */
  const dx = g.decalageXPct;
  const dy = g.decalageYPct;
  return {
    depart: {
      opacity: g.alphaDepart,
      transform: `translate(${dx}%, ${dy}%) scale(${g.echelleDepart})`,
    },
    arrivee: {
      opacity: 1,
      transform: 'translate(0%, 0%) scale(1)',
    },
    dureeMs: Math.max(120, Math.round(anim.dureeEntreeSecondes * 1000)),
  };
}

export interface BibliothequeAnimationsTexteProps {
  animationActive: string | null;
  onChoisir: (id: string) => void;
  exemple?: string;
  couleur?: string;
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  recents?: readonly string[];
}

type Rayon = 'pour-vous' | 'favoris' | 'recents' | CategorieCreative | 'tout';

export default function BibliothequeAnimationsTexte({
  animationActive, onChoisir, exemple, couleur = '#FFFFFF',
  favoris = [], onBasculerFavori, recents = [],
}: BibliothequeAnimationsTexteProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');
  /** Relancer l'animation d'une carte au survol ou au focus. */
  const [rejoue, setRejoue] = useState<string | null>(null);

  const texte = (exemple ?? '').trim() || 'Votre texte ici';

  const visibles = useMemo(() => {
    const rendues = ANIMATIONS_TEXTE.filter((x) => x.rendu);
    const cherchees = chercher(rendues, requete);
    if (requete.trim() !== '') return trierEntrees(cherchees);
    if (rayon === 'favoris') return trierEntrees(cherchees.filter((x) => favoris.includes(x.id)));
    if (rayon === 'recents') {
      return recents
        .map((id) => cherchees.find((x) => x.id === id))
        .filter((x): x is AnimationTexteCreative => x !== undefined);
    }
    if (rayon === 'pour-vous') {
      // L'animation ACTIVE d'abord : sinon la grille s'ouvre sans montrer
      // ce qui est déjà appliqué.
      const ordre = [animationActive ?? 'aucune', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: AnimationTexteCreative[] = [];
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
  }, [requete, rayon, favoris, recents, animationActive]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  return (
    <div className="space-y-2" data-bibliotheque-animations data-animations-visibles={visibles.length}>
      <style>{`
        @keyframes studiio-anim-carte {
          from { opacity: var(--a0); transform: var(--t0); }
          to   { opacity: 1; transform: none; }
        }
        [data-animation-apercu] { animation: studiio-anim-carte var(--d) ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          /* ⚠️ LA CARTE SE FIGE, LE RENDU NON. C'est une préférence
             d'affichage, pas un réglage de montage. */
          [data-animation-apercu] { animation: none; opacity: 1; transform: none; }
        }
      `}</style>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher une animation — fondu, glisse, pop…"
          data-animations-recherche
          aria-label="Chercher une animation de texte"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons d’animations">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-animations-rayon={r.cle}
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
        <p data-animations-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucune animation ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {visibles.map((an) => {
            const choisi = animationActive === an.id
              || (animationActive === null && an.id === 'aucune');
            const favori = favoris.includes(an.id);
            const { depart, dureeMs } = imagesClesGeste(an);
            return (
              <li key={an.id} className="relative">
                <button
                  type="button"
                  onClick={() => onChoisir(an.id)}
                  onMouseEnter={() => setRejoue(an.id)}
                  onFocus={() => setRejoue(an.id)}
                  aria-pressed={choisi}
                  aria-label={`${an.nom} — ${an.description}`}
                  title={an.description}
                  data-animation-carte={an.id}
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
                      // La clé force le remontage : c'est ce qui rejoue
                      // l'animation au survol, sans minuterie.
                      key={`${an.id}-${rejoue === an.id ? 'rejoue' : 'repos'}`}
                      data-animation-apercu={an.id}
                      className="max-w-full truncate text-center text-[11px] font-semibold leading-tight"
                      style={{
                        color: couleur,
                        ['--a0' as string]: String(depart.opacity),
                        ['--t0' as string]: String(depart.transform),
                        ['--d' as string]: `${dureeMs}ms`,
                      }}
                    >
                      {texte}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-1">
                    {choisi && <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />}
                    <span className="truncate text-[10px] text-gray-300">{an.nom}</span>
                  </span>
                </button>
                {onBasculerFavori && (
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(an.id)}
                    aria-pressed={favori}
                    aria-label={favori
                      ? `Retirer ${an.nom} des favoris` : `Ajouter ${an.nom} aux favoris`}
                    data-animation-favori={an.id}
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

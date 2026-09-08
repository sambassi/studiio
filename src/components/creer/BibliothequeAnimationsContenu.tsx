'use client';

/**
 * A_3c2 — LA BIBLIOTHÈQUE D'APPARITION DU TEXTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'APERÇU CONSOMME LE MÊME SÉQUENCEUR QUE LE RENDU
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `decouperContenu` découpe le texte et place les étapes ; le moteur en fait
 * des événements ASS, cette carte en fait des `animation-delay`. Les deux
 * lisent la MÊME fonction, sur le MÊME texte : le nombre de mots, le rythme
 * et l'ordre ne peuvent pas diverger.
 *
 * Écrire ici une animation CSS « à peu près pareille » aurait produit un
 * aperçu qui ment — exactement ce que ce lot refuse.
 *
 * ⚠️ ET LE TEXTE EST CELUI QUE LE MOTEUR VERRA : `decouperContenu` applique
 * l'échappement ASS. Une accroche contenant une accolade s'affiche ici avec
 * la parenthèse qu'elle deviendra dans la vidéo, et non avec l'accolade que
 * la vidéo ne montrera jamais.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check } from 'lucide-react';
import {
  ANIMATIONS_CONTENU, decouperContenu, type AnimationContenuCreative,
} from '@/lib/creatif/animations-contenu';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

/** La durée de la démonstration, en secondes. Assez pour lire, assez court. */
const DUREE_APERCU = 2.4;

/**
 * Le calendrier d'une carte : pour chaque unité, quand elle arrive.
 *
 * Exportée pour être testée — c'est le seul endroit où l'aperçu pourrait
 * diverger du moteur, et une mesure vaut mieux qu'une relecture.
 */
export function calendrierApercu(anim: AnimationContenuCreative, texte: string): {
  unites: readonly string[]; separateur: string;
  delaisMs: readonly number[]; dureeMs: number;
} {
  const d = decouperContenu(anim, texte, 0, DUREE_APERCU);
  const pas = Math.max(1, Math.round(anim.unitesParEtape));
  const delais = d.unites.map((_, i) => {
    const e = d.etapes[Math.min(d.etapes.length - 1, Math.floor(i / pas))];
    return e ? Math.round(e.debutSecondes * 1000) : 0;
  });
  const premiere = d.etapes[0];
  const dureeEtape = premiere
    ? Math.round((premiere.finSecondes - premiere.debutSecondes) * 1000) : 200;
  return {
    unites: d.unites,
    separateur: d.separateur,
    delaisMs: delais,
    // Une apparition sèche est brève ; un fondu dure toute son étape.
    dureeMs: anim.revelation === 'apparition' ? 60 : Math.max(90, dureeEtape),
  };
}

export interface BibliothequeAnimationsContenuProps {
  animationActive: string | null;
  onChoisir: (id: string) => void;
  exemple?: string;
  couleur?: string;
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  recents?: readonly string[];
}

type Rayon = 'pour-vous' | 'favoris' | 'recents' | CategorieCreative | 'tout';

/** L'entrée « Aucune » : le texte apparaît d'un bloc, comme avant ce lot. */
const AUCUNE: AnimationContenuCreative = {
  id: 'aucune', nom: 'Aucune', famille: 'animation-texte', categorie: 'sobre',
  tags: ['aucune', 'net', 'bloc'], description: 'Le texte apparaît d’un bloc.',
  rendu: true, version: 'anim-contenu-v1', type: 'contenu',
  progression: 'mot', revelation: 'apparition', partRevelation: 0.05,
  unitesParEtape: 999,
};

export default function BibliothequeAnimationsContenu({
  animationActive, onChoisir, exemple, couleur = '#FFFFFF',
  favoris = [], onBasculerFavori, recents = [],
}: BibliothequeAnimationsContenuProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');
  const [rejoue, setRejoue] = useState<string | null>(null);

  const texte = (exemple ?? '').trim() || 'Votre texte ici';
  const toutes = useMemo(() => [AUCUNE, ...ANIMATIONS_CONTENU], []);

  const visibles = useMemo(() => {
    const cherchees = chercher(toutes, requete);
    if (requete.trim() !== '') return trierEntrees(cherchees);
    if (rayon === 'favoris') return trierEntrees(cherchees.filter((x) => favoris.includes(x.id)));
    if (rayon === 'recents') {
      return recents
        .map((id) => cherchees.find((x) => x.id === id))
        .filter((x): x is AnimationContenuCreative => x !== undefined);
    }
    if (rayon === 'pour-vous') {
      // L'animation ACTIVE d'abord : sans cela, la grille s'ouvre sans
      // montrer ce qui est déjà appliqué.
      const ordre = [animationActive ?? 'aucune', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: AnimationContenuCreative[] = [];
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
  }, [toutes, requete, rayon, favoris, recents, animationActive]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  return (
    <div
      className="space-y-2"
      data-bibliotheque-contenu
      data-contenu-visibles={visibles.length}
    >
      <style>{`
        @keyframes studiio-contenu-apparition {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes studiio-contenu-surbrillance {
          0% { opacity: .4; } 35% { opacity: 1; } 100% { opacity: .4; }
        }
        [data-contenu-unite] { animation-fill-mode: both; animation-timing-function: ease-out; }
        @media (prefers-reduced-motion: reduce) {
          /* ⚠️ LA CARTE SE FIGE SUR LE TEXTE ENTIER, LE RENDU NON. C'est une
             préférence d'affichage, pas un réglage de montage. */
          [data-contenu-unite] { animation: none !important; opacity: 1 !important; }
        }
      `}</style>

      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher — machine à écrire, mot par mot, surbrillance…"
          data-contenu-recherche
          aria-label="Chercher une apparition de texte"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons d’apparitions">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-contenu-rayon={r.cle}
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
        <p data-contenu-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucune apparition ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {visibles.map((an) => {
            const choisi = animationActive === an.id
              || (animationActive === null && an.id === 'aucune');
            const favori = favoris.includes(an.id);
            const cal = calendrierApercu(an, texte);
            const nomKeyframes = an.revelation === 'surbrillance'
              ? 'studiio-contenu-surbrillance' : 'studiio-contenu-apparition';
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
                  data-contenu-carte={an.id}
                  data-contenu-unites={cal.unites.length}
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
                    {/* ⚠️ LE BLOC NE BOUGE PAS, SEULES LES UNITÉS S'ALLUMENT.
                        C'est la même règle que dans le rendu : la mise en
                        page est celle du texte final dès la première image. */}
                    <span
                      // La clé force le remontage : c'est ce qui rejoue
                      // l'apparition au survol, sans minuterie.
                      key={`${an.id}-${rejoue === an.id ? 'rejoue' : 'repos'}`}
                      data-contenu-apercu={an.id}
                      className="max-w-full truncate text-center text-[11px] font-semibold leading-tight"
                      style={{ color: couleur }}
                    >
                      {cal.unites.map((u, i) => (
                        <span
                          // eslint-disable-next-line react/no-array-index-key
                          key={i}
                          data-contenu-unite
                          style={{
                            animationName: nomKeyframes,
                            animationDuration: `${cal.dureeMs}ms`,
                            animationDelay: `${cal.delaisMs[i]}ms`,
                          }}
                        >
                          {u}
                          {cal.separateur !== '' && i < cal.unites.length - 1
                            ? cal.separateur : ''}
                        </span>
                      ))}
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
                    data-contenu-favori={an.id}
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

'use client';

/**
 * A_3a — LA BIBLIOTHÈQUE DE LOOKS, AVEC DE VRAIS APERÇUS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CHAQUE VIGNETTE VIENT DU MOTEUR, PAS D'UN FILTRE CSS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `filter: saturate(1.3)` coûte trois lignes et ment : le navigateur ne
 * connaît ni `lut3d`, ni l'interpolation tétraédrique, ni l'espace de
 * couleur du rendu. La grille montrerait des vignettes qui ne ressemblent
 * pas au résultat, et chaque écart passerait pour un bug.
 *
 * Chaque carte demande donc son image à `/api/creatif/looks/<id>/apercu`,
 * qui applique LE fichier `.cube` que la vidéo appliquera — sur la vignette
 * du rush choisi quand il y en a un. « Comment MON image réagit », pas
 * « comment une photo d'illustration réagirait ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TRENTE-QUATRE LOOKS, ET PAS TRENTE-QUATRE REQUÊTES AU CHARGEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les images sont en `loading="lazy"` et la grille n'est montée qu'une fois
 * la bibliothèque ouverte. Le navigateur ne demande donc que ce qui entre à
 * l'écran, et la réponse est mise en cache un jour : le second affichage est
 * instantané.
 */
import { useMemo, useState } from 'react';
import { Search, Heart, Check } from 'lucide-react';
import {
  LOOKS_CREATIFS, type LookCreatif,
} from '@/lib/creatif/looks';
import {
  chercher, trierEntrees, CATEGORIES_CREATIVES, LIBELLES_CATEGORIE,
  type CategorieCreative,
} from '@/lib/creatif/catalogue-contrat';

export interface BibliothequeLooksProps {
  /** Le look actif, ou `null` pour « aucun ». */
  lookActif: string | null;
  onChoisir: (id: string) => void;
  /** Les favoris de la personne. Vide tant qu'elle n'en a pas posé. */
  favoris?: readonly string[];
  onBasculerFavori?: (id: string) => void;
  /** Les derniers utilisés, du plus récent au plus ancien. */
  recents?: readonly string[];
  /** L'analyse du rush choisi : ses images servent de fond aux aperçus. */
  analyseApercuId?: string | null;
}

/** Les rayons, plus les deux qui dépendent de la personne. */
type Rayon = 'pour-vous' | 'favoris' | 'recents' | CategorieCreative | 'tout';

export default function BibliothequeLooks({
  lookActif, onChoisir, favoris = [], onBasculerFavori,
  recents = [], analyseApercuId = null,
}: BibliothequeLooksProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');

  const visibles = useMemo(() => {
    // ⚠️ SEULS LES LOOKS RÉELLEMENT RENDUS. Une carte qui ne changerait rien
    // à la vidéo se découvrirait après le rendu — pire qu'une absence.
    const rendus = LOOKS_CREATIFS.filter((l) => l.rendu);
    const cherches = chercher(rendus, requete);

    /* Une recherche en cours ignore le rayon : chercher « nuit » puis ne rien
       trouver parce qu'on était dans « Portrait » donnerait l'impression que
       le look n'existe pas. */
    if (requete.trim() !== '') return trierEntrees(cherches);

    if (rayon === 'favoris') return trierEntrees(cherches.filter((l) => favoris.includes(l.id)));
    if (rayon === 'recents') {
      // L'ordre des récents EST l'information : on ne le retrie pas.
      return recents
        .map((id) => cherches.find((l) => l.id === id))
        .filter((l): l is LookCreatif => l !== undefined);
    }
    if (rayon === 'pour-vous') {
      /* ⚠️ AUCUN MODÈLE, AUCUNE DEVINETTE. « Pour vous » est déterministe :
         ce que la personne a mis en favori, puis ce qu'elle vient d'utiliser,
         puis un début de catalogue. Une recommandation apprise viendra
         quand il y aura de quoi apprendre. */
      const ordre = [...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: LookCreatif[] = [];
      for (const id of ordre) {
        const l = cherches.find((x) => x.id === id);
        if (l && !mis.has(l.id)) { sortie.push(l); mis.add(l.id); }
      }
      for (const l of trierEntrees(cherches)) {
        if (sortie.length >= 12) break;
        if (!mis.has(l.id)) { sortie.push(l); mis.add(l.id); }
      }
      return sortie;
    }
    if (rayon === 'tout') return trierEntrees(cherches);
    return trierEntrees(cherches.filter((l) => l.categorie === rayon));
  }, [requete, rayon, favoris, recents]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...CATEGORIES_CREATIVES.map((c) => ({ cle: c as Rayon, libelle: LIBELLES_CATEGORIE[c] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  return (
    <div className="space-y-2" data-bibliotheque-looks data-looks-visibles={visibles.length}>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher un look — cinéma, chaud, sport…"
          data-looks-recherche
          aria-label="Chercher un look"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-looks-rayon={r.cle}
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
        <p data-looks-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucun look ne correspond.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5">
          {visibles.map((l) => {
            const choisi = lookActif === l.id;
            const favori = favoris.includes(l.id);
            return (
              <li key={l.id} className="relative">
                <button
                  type="button"
                  onClick={() => onChoisir(l.id)}
                  aria-pressed={choisi}
                  aria-label={`${l.nom} — ${l.description}`}
                  title={l.description}
                  data-look-carte={l.id}
                  className={`block w-full overflow-hidden rounded-lg border text-left transition
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                    choisi
                      ? 'border-purple-500/70 bg-purple-500/[0.06]'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span
                    className="flex items-center justify-center overflow-hidden bg-black/40"
                    style={{ aspectRatio: '16 / 9' }}
                  >
                    {l.fichier === null ? (
                      /* « Aucun look » n'a pas d'aperçu à calculer : c'est
                         l'image telle quelle, et le dire vaut mieux que de
                         demander au serveur une transformation vide. */
                      <span data-look-neutre className="text-[9px] text-gray-500">Sans look</span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/creatif/looks/${l.id}/apercu${
                          analyseApercuId ? `?analyse=${analyseApercuId}` : ''}`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        data-look-apercu={l.id}
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="flex items-center gap-1 px-1.5 py-1">
                    {choisi && <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />}
                    <span className="truncate text-[10px] text-gray-300">{l.nom}</span>
                  </span>
                </button>
                {onBasculerFavori && (
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(l.id)}
                    aria-pressed={favori}
                    aria-label={favori ? `Retirer ${l.nom} des favoris` : `Ajouter ${l.nom} aux favoris`}
                    data-look-favori={l.id}
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

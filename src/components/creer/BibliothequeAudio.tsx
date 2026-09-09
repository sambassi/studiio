'use client';

/**
 * A_5b — LA BANQUE AUDIO À L'ÉCRAN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN SEUL MORCEAU À LA FOIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `<audio>` par carte laisserait deux musiques jouer ensemble dès le
 * second clic — et vingt fichiers se télécharger au chargement. Il y a donc
 * UN élément audio pour toute la grille : lancer une piste arrête la
 * précédente, par construction et non par précaution.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ RIEN N'EST TÉLÉCHARGÉ AVANT D'ÊTRE ÉCOUTÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La `src` n'est posée qu'au moment où l'on appuie sur lire. Le proxy de
 * stockage répond en `Accept-Ranges: bytes`, donc le navigateur ne descend
 * que ce qu'il écoute — la même mécanique que le lecteur vidéo, qui n'est pas
 * touché.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ L'ÉCOUTE COMMENCE APRÈS LE BLANC
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Beaucoup de fichiers exportés d'un DAW commencent par un silence. Le rendu
 * le coupe déjà ; ici on se contente de POSITIONNER la lecture après lui —
 * le fichier n'est pas modifié, et l'écoute ne donne pas l'impression que la
 * musique est cassée.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Search, Heart, Play, Pause, Pencil, Trash2, Check, Plus, Loader2, Tags,
} from 'lucide-react';
import {
  MOODS_AUDIO, LIBELLES_MOOD, chercherPistes, dureeLisible, decoderFormeOnde,
  moodsPresents, POINTS_FORME_ONDE, PISTES_AUDIO_MAX, MOODS_PAR_PISTE_MAX,
  type PisteAudio, type MoodAudio,
} from '@/lib/creatif/audio';
import { BUCKET_MUSIQUE } from '@/lib/autopilot/analyse/recette-audio';

/**
 * CE QUE LA LISTE DES MUSIQUES A LE DROIT D'OCCUPER — CREER_PREMIUM_3F.
 *
 * ⚠️ MESURÉE, PAS CHOISIE AU JUGÉ. Une ligne fait 64 px dans le navigateur
 * (bouton d'écoute, nom, durée, forme d'onde) et l'écart vertical 4 px : six
 * lignes tiennent donc dans 25 rem, et la septième est coupée en bas — ce qui
 * est exactement le signal qu'il y en a d'autres.
 *
 * ⚠️ CE PLAFOND EST CE QUI TIENT L'INVARIANT DE LA PAGE. Sans lui, la hauteur
 * du formulaire suit le nombre de musiques : la banque en accepte deux cents,
 * et l'aperçu `sticky` de droite sortait de l'écran bien avant. La règle de la
 * page Créer est que l'aperçu ne quitte JAMAIS la vue à cause de la longueur du
 * formulaire ; une collection qui peut grandir sans limite défile donc chez
 * elle.
 */
export const HAUTEUR_LISTE_AUDIO = '25rem';

/**
 * L'adresse d'écoute — celle du proxy de stockage, qui gère déjà les
 * requêtes partielles. Aucune route de plus, aucune URL signée.
 */
export function adresseEcoute(cle: string): string {
  return `/storage/v1/object/public/${BUCKET_MUSIQUE}/${
    cle.split('/').map(encodeURIComponent).join('/')}`;
}

/** Le tracé de la forme d'onde, en coordonnées SVG. */
export function traceFormeOnde(points: readonly number[], hauteur = 24): string {
  if (points.length === 0) return '';
  return points.map((v, i) => {
    const h = Math.max(1, (v / 255) * hauteur);
    return `M${i} ${(hauteur - h) / 2}v${h}`;
  }).join('');
}

export interface BibliothequeAudioProps {
  pistes: readonly PisteAudio[];
  cleActive: string | null;
  onChoisir: (cle: string | null) => void;
  favoris?: readonly string[];
  recents?: readonly string[];
  onBasculerFavori?: (cle: string) => void;
  onRenommer?: (cle: string, nom: string) => void;
  onRetirer?: (cle: string) => void;
  /** Ouvre le sélecteur de médias. Absent = pas de bouton d'ajout. */
  onAjouter?: () => void;
  /** Les ambiances se règlent APRÈS l'ajout, sans réanalyser le fichier. */
  onMoods?: (cle: string, moods: readonly MoodAudio[]) => void;
  /** La clé en cours d'analyse, s'il y en a une. */
  enAnalyse?: string | null;
}

type Rayon = 'pour-vous' | 'favoris' | 'recents' | MoodAudio | 'tout';

export default function BibliothequeAudio({
  pistes, cleActive, onChoisir,
  favoris = [], recents = [], onBasculerFavori, onRenommer, onRetirer,
  onAjouter, onMoods, enAnalyse = null,
}: BibliothequeAudioProps) {
  const [requete, setRequete] = useState('');
  const [rayon, setRayon] = useState<Rayon>('pour-vous');
  const [enLecture, setEnLecture] = useState<string | null>(null);
  const [renomme, setRenomme] = useState<string | null>(null);
  const [reglageMoods, setReglageMoods] = useState<string | null>(null);
  const [nouveauNom, setNouveauNom] = useState('');
  // ⚠️ UN SEUL ÉLÉMENT AUDIO POUR TOUTE LA GRILLE.
  const lecteur = useRef<HTMLAudioElement | null>(null);

  const visibles = useMemo(() => {
    const trouvees = chercherPistes(pistes, requete);
    if (requete.trim() !== '') return trouvees;
    if (rayon === 'favoris') return trouvees.filter((p) => favoris.includes(p.cle));
    if (rayon === 'recents') {
      return recents
        .map((c) => trouvees.find((p) => p.cle === c))
        .filter((p): p is PisteAudio => p !== undefined);
    }
    if (rayon === 'pour-vous') {
      // La piste ACTIVE d'abord : sinon la grille s'ouvre sans montrer ce qui
      // est déjà choisi.
      const ordre = [cleActive ?? '', ...favoris, ...recents];
      const mis = new Set<string>();
      const sortie: PisteAudio[] = [];
      for (const c of ordre) {
        const p = trouvees.find((x) => x.cle === c);
        if (p && !mis.has(p.cle)) { sortie.push(p); mis.add(p.cle); }
      }
      for (const p of trouvees) {
        if (sortie.length >= 10) break;
        if (!mis.has(p.cle)) { sortie.push(p); mis.add(p.cle); }
      }
      return sortie;
    }
    if (rayon === 'tout') return trouvees;
    return trouvees.filter((p) => p.moods.includes(rayon));
  }, [pistes, requete, rayon, favoris, recents, cleActive]);

  const rayons: { cle: Rayon; libelle: string }[] = [
    { cle: 'pour-vous', libelle: 'Pour vous' },
    ...(favoris.length > 0 ? [{ cle: 'favoris' as Rayon, libelle: 'Favoris' }] : []),
    ...(recents.length > 0 ? [{ cle: 'recents' as Rayon, libelle: 'Récents' }] : []),
    ...moodsPresents(pistes).map((m) => ({ cle: m as Rayon, libelle: LIBELLES_MOOD[m] })),
    { cle: 'tout', libelle: 'Tout' },
  ];

  const basculerEcoute = (p: PisteAudio) => {
    const audio = lecteur.current;
    if (!audio) return;
    if (enLecture === p.cle) { audio.pause(); setEnLecture(null); return; }
    /* Poser la `src` ICI, et seulement ici : la grille n'a rien téléchargé
       tant que personne n'a appuyé sur lire. */
    audio.src = adresseEcoute(p.cle);
    // L'écoute commence APRÈS le blanc — le fichier, lui, n'est pas touché.
    audio.currentTime = Math.max(0, p.silenceInitialMs / 1000);
    void audio.play().then(() => setEnLecture(p.cle)).catch(() => setEnLecture(null));
  };

  return (
    <div className="space-y-2" data-bibliotheque-audio data-audio-visibles={visibles.length}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={lecteur}
        preload="none"
        data-audio-lecteur
        onEnded={() => setEnLecture(null)}
        onPause={() => setEnLecture(null)}
      />

      {/* ⚠️ LE BOUTON EST TOUJOURS LA, PAS SEULEMENT QUAND LA BANQUE EST VIDE.
          Une banque de trois morceaux se complete aussi souvent qu'une banque
          vide se remplit. */}
      {onAjouter && (
        <button
          type="button"
          onClick={onAjouter}
          disabled={enAnalyse !== null || pistes.length >= PISTES_AUDIO_MAX}
          data-audio-ajouter
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border
            border-dashed border-gray-700 px-2 py-1.5 text-[11px] text-gray-300 transition
            hover:border-purple-500/50 hover:text-purple-200 disabled:opacity-40
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          {enAnalyse !== null ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Analyse de la musique…
            </>
          ) : (
            <>
              <Plus className="h-3 w-3" aria-hidden="true" />
              Ajouter une musique
            </>
          )}
        </button>
      )}
      {pistes.length >= PISTES_AUDIO_MAX && (
        <p data-audio-limite className="text-[10px] text-amber-400">
          Ta banque contient déjà le nombre maximum de musiques.
          Retires-en une pour en ajouter.
        </p>
      )}

      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5
          -translate-y-1/2 text-gray-500" aria-hidden="true" />
        <input
          type="search"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Chercher — titre, ambiance…"
          data-audio-recherche
          aria-label="Chercher une musique"
          className="w-full rounded-lg border border-gray-800 bg-gray-900/60 py-1.5 pl-7 pr-2
            text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
      </label>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Rayons de musiques">
        {rayons.map((r) => (
          <button
            key={r.cle}
            type="button"
            role="tab"
            aria-selected={rayon === r.cle}
            data-audio-rayon={r.cle}
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

      {pistes.length === 0 ? (
        <div data-audio-banque-vide className="px-1 py-4 text-center">
          <p className="text-[12px] text-gray-300">Ta banque musicale est vide</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Ajoute les musiques que tu veux utiliser dans tes vidéos.
          </p>
        </div>
      ) : visibles.length === 0 ? (
        <p data-audio-vide className="px-1 py-3 text-center text-[11px] text-gray-500">
          Aucune musique ne correspond.
        </p>
      ) : (
        /* ⚠️ LA LISTE DEFILE DANS SA PROPRE ZONE — CREER_PREMIUM_3F.

           Elle poussait le reste du formulaire vers le bas : huit musiques
           faisaient deja 540 px, et la banque en accepte DEUX CENTS. L'apercu,
           qui vit a droite en `sticky`, finissait hors de l'ecran — et
           l'invariant de la page Creer est justement qu'il n'en sorte jamais a
           cause de la longueur du formulaire.

           `HAUTEUR_LISTE_AUDIO` vaut ~6 lignes mesurees (64 px + 4 px
           d'ecart) : assez pour choisir sans defiler dans le cas courant, et
           la ligne coupee en bas dit qu'il y en a d'autres. La barre de
           recherche et les rayons restent AU-DESSUS, donc toujours atteignables
           quelle que soit la position du defilement.

           La barre elle-meme est deja fine et discrete : `globals.css` la pose
           pour toute l'application, il n'y a rien a redefinir ici. */
        <ul
          data-audio-liste
          style={{ maxHeight: HAUTEUR_LISTE_AUDIO }}
          className="space-y-1 overflow-y-auto overscroll-contain pr-1">
          {visibles.map((p) => {
            const choisie = cleActive === p.cle;
            const favorite = favoris.includes(p.cle);
            const onde = decoderFormeOnde(p.formeOnde);
            return (
              <li
                key={p.cle}
                data-audio-carte={p.cle}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                  choisie ? 'border-purple-500/70 bg-purple-500/[0.06]' : 'border-gray-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => basculerEcoute(p)}
                  aria-label={enLecture === p.cle ? `Arrêter ${p.nom}` : `Écouter ${p.nom}`}
                  data-audio-ecouter={p.cle}
                  className="shrink-0 rounded-full bg-gray-800 p-1.5 text-gray-300
                    transition hover:text-purple-300 focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  {enLecture === p.cle
                    ? <Pause className="h-3 w-3" aria-hidden="true" />
                    : <Play className="h-3 w-3" aria-hidden="true" />}
                </button>

                <button
                  type="button"
                  onClick={() => onChoisir(choisie ? null : p.cle)}
                  aria-pressed={choisie}
                  data-audio-choisir={p.cle}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  {renomme === p.cle ? null : (
                    <span className="flex items-center gap-1">
                      {choisie && (
                        <Check className="h-3 w-3 shrink-0 text-purple-300" aria-hidden="true" />
                      )}
                      <span className="truncate text-[11px] text-gray-200">{p.nom}</span>
                    </span>
                  )}
                  {/* La forme d'onde, tracée depuis le VRAI signal analysé à
                      l'import — pas une décoration aléatoire. */}
                  {onde.length > 0 && (
                    <svg
                      viewBox={`0 0 ${POINTS_FORME_ONDE} 24`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      data-audio-onde={p.cle}
                      className="mt-0.5 h-4 w-full text-purple-400/50"
                    >
                      <path d={traceFormeOnde(onde)} stroke="currentColor" strokeWidth="0.7" />
                    </svg>
                  )}
                  <span className="mt-0.5 flex items-center gap-1 text-[9px] text-gray-500">
                    <span>{dureeLisible(p.dureeMs)}</span>
                    {p.moods.length > 0 && (
                      <span className="truncate">
                        · {p.moods.map((m) => LIBELLES_MOOD[m]).join(', ')}
                      </span>
                    )}
                  </span>
                </button>

                {renomme === p.cle && (
                  <>
                    <input
                      value={nouveauNom}
                      onChange={(e) => setNouveauNom(e.target.value)}
                      aria-label={`Nouveau nom de ${p.nom}`}
                      data-audio-renommer-champ={p.cle}
                      className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900/60
                        px-2 py-1 text-[11px] text-gray-200 focus:border-purple-500/50
                        focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => { onRenommer?.(p.cle, nouveauNom); setRenomme(null); }}
                      data-audio-renommer-valider={p.cle}
                      className="shrink-0 rounded-lg border border-gray-800 px-2 py-1
                        text-[10px] text-gray-300"
                    >
                      OK
                    </button>
                  </>
                )}

                {onMoods && reglageMoods === p.cle && (
                  <span className="flex flex-wrap gap-1" data-audio-moods={p.cle}>
                    {MOODS_AUDIO.map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={p.moods.includes(m)}
                        data-audio-mood={`${p.cle}:${m}`}
                        onClick={() => onMoods(p.cle, p.moods.includes(m)
                          ? p.moods.filter((x) => x !== m)
                          : [...p.moods, m].slice(-MOODS_PAR_PISTE_MAX))}
                        className={`rounded-full px-1.5 py-0.5 text-[9px] leading-none ${
                          p.moods.includes(m)
                            ? 'bg-purple-500/20 text-purple-300'
                            : 'bg-gray-800 text-gray-500'
                        }`}
                      >
                        {LIBELLES_MOOD[m]}
                      </button>
                    ))}
                  </span>
                )}
                {onMoods && (
                  <button
                    type="button"
                    onClick={() => setReglageMoods(reglageMoods === p.cle ? null : p.cle)}
                    aria-expanded={reglageMoods === p.cle}
                    aria-label={`Ambiances de ${p.nom}`}
                    data-audio-regler-moods={p.cle}
                    className="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-200"
                  >
                    <Tags className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                {onBasculerFavori && (
                  <button
                    type="button"
                    onClick={() => onBasculerFavori(p.cle)}
                    aria-pressed={favorite}
                    aria-label={favorite
                      ? `Retirer ${p.nom} des favoris` : `Ajouter ${p.nom} aux favoris`}
                    data-audio-favori={p.cle}
                    className="shrink-0 rounded-full p-1 text-gray-400 transition
                      hover:text-pink-300"
                  >
                    <Heart
                      className={`h-3 w-3 ${favorite ? 'fill-pink-400 text-pink-400' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {onRenommer && renomme !== p.cle && (
                  <button
                    type="button"
                    onClick={() => { setRenomme(p.cle); setNouveauNom(p.nom); }}
                    aria-label={`Renommer ${p.nom}`}
                    data-audio-renommer={p.cle}
                    className="shrink-0 rounded-full p-1 text-gray-400 hover:text-gray-200"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                {onRetirer && (
                  <button
                    type="button"
                    onClick={() => onRetirer(p.cle)}
                    aria-label={`Retirer ${p.nom} de la banque`}
                    data-audio-retirer={p.cle}
                    className="shrink-0 rounded-full p-1 text-gray-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
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

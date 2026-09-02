'use client';

/**
 * UX-A1 — « Tes vidéos ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il ne LANCE rien. Pas de bouton « Créer ma vidéo », pas d'enchaînement
 * coupes → clips → plan → rendu, pas de relance. Il ne MODIFIE rien : pas de
 * bouton « Modifier », aucun post créé, aucun crédit touché. Il montre ce qui
 * existe déjà, et deux gestes dessus : regarder, télécharger.
 *
 * Poser un bouton de plus maintenant promettrait ce qui n'est pas branché —
 * et une relance est de toute façon impossible ici : elle demande le plan de
 * montage, que `renduPublic` masque délibérément.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN MOT DE MACHINE À L'ÉCRAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni `rendu_interrompu`, ni `capacite_saturee`, ni CRF, ni compartiment, ni
 * clé de stockage, ni timecode, ni dimensions en pixels, ni identifiant de
 * rendu. La traduction vit dans `rendu-passerelle`, testée à part.
 *
 * ⚠️ ET AUCUN POURCENTAGE. Le serveur ne connaît que son ÉTAPE. Une barre à
 * 43 % serait une mesure sans mesure.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE LECTEUR NE SE MONTE QU'AU CLIC
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route qui sert les octets répond `Accept-Ranges: none` : elle rend le
 * fichier d'un bloc, et le navigateur ne peut pas s'y déplacer. Monter le
 * `<video>` d'entrée ferait donc télécharger plusieurs mégaoctets à chaque
 * affichage de la liste, sur mobile compris, pour une vidéo que personne n'a
 * demandé à voir. « Regarder » est ce qui déclenche la lecture — et c'est
 * aussi ce qui rend le geste explicite.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Download, Film, Loader2, Play,
} from 'lucide-react';
import {
  DELAI_SUIVI_MS, formaterDuree, lireRenduDeSession, messageEchec,
  orientation, phraseEnCours, renduEnCours,
  type Fetcher, type RenduEcran,
} from '@/lib/autopilot/analyse/rendu-passerelle';

interface Props {
  /** La session de tournage regardée. */
  sessionId: string;
  /** La session ne porte aucun rush : l'écran le dit plutôt que de se taire. */
  aucunRush: boolean;
  /** Injectable pour les tests. Le défaut est le `fetch` du navigateur. */
  fetcher?: Fetcher;
}

type Etat =
  | { sorte: 'chargement' }
  | { sorte: 'aucun' }
  | { sorte: 'indisponible' }
  | { sorte: 'trouve'; rendu: RenduEcran }
  | { sorte: 'erreur'; message: string };

export default function VideosPretes({ sessionId, aucunRush, fetcher }: Props) {
  const [etat, setEtat] = useState<Etat>({ sorte: 'chargement' });
  const [lecture, setLecture] = useState(false);

  /**
   * Vivant tant que le composant est monté.
   *
   * Le motif de `AnalyseRush` : sans lui, un tour de sondage en vol au moment
   * où l'on change de session écrit dans un composant démonté, et la minuterie
   * suivante repart sur une session qu'on ne regarde plus.
   */
  const vivantRef = useRef(true);
  const minuterieRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafraichirRef = useRef<() => void>(() => {});

  useEffect(() => {
    vivantRef.current = true;
    return () => {
      vivantRef.current = false;
      if (minuterieRef.current) {
        clearTimeout(minuterieRef.current);
        minuterieRef.current = null;
      }
    };
  }, []);

  /**
   * Programme le tour suivant — et un seul.
   *
   * La minuterie précédente est toujours annulée d'abord : sans ça, deux
   * boucles courraient en parallèle après un changement de session.
   */
  const planifier = useCallback((suivant: RenduEcran | null) => {
    if (minuterieRef.current) {
      clearTimeout(minuterieRef.current);
      minuterieRef.current = null;
    }
    if (!vivantRef.current) return;
    // ⚠️ ON NE SONDE QUE CE QUI BOUGE. Un état terminal — réussi, échoué,
    // annulé — ne changera plus : continuer à interroger le serveur pour lui
    // faire répéter la même réponse est du bruit permanent.
    if (!renduEnCours(suivant)) return;
    minuterieRef.current = setTimeout(() => { rafraichirRef.current(); }, DELAI_SUIVI_MS);
  }, []);

  const rafraichir = useCallback(async () => {
    const r = await lireRenduDeSession(sessionId, fetcher);
    if (!vivantRef.current) return;

    if (r.sorte === 'trouve') {
      setEtat({ sorte: 'trouve', rendu: r.rendu });
      planifier(r.rendu);
      return;
    }
    if (r.sorte === 'aucun') setEtat({ sorte: 'aucun' });
    else if (r.sorte === 'indisponible') setEtat({ sorte: 'indisponible' });
    else setEtat({ sorte: 'erreur', message: r.message });
    planifier(null);
  }, [sessionId, fetcher, planifier]);

  rafraichirRef.current = rafraichir;

  // Un changement de session repart de zéro : l'écran ne doit jamais montrer
  // la vidéo du tournage précédent pendant que la nouvelle charge.
  useEffect(() => {
    setEtat({ sorte: 'chargement' });
    setLecture(false);
    // ⚠️ SANS RUSH, ON N'INTERROGE PAS. Une session vide ne peut avoir produit
    // aucune vidéo : la réponse est connue d'avance, et la demander quand même
    // ferait une requête par tournage ouvert, pour rien.
    if (aucunRush) return;
    rafraichirRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, aucunRush]);

  // ── Aucun rush : rien n'a pu être créé, et on le dit ───────────────────
  if (aucunRush) {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="aucun_rush">
        <Titre />
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Ajoute des rushes : Studiio en fera une vidéo.
        </p>
      </section>
    );
  }

  // Le premier tour, et le serveur qui n'a rien à dire : l'écran se tait
  // plutôt que d'afficher un bloc vide sous chaque tournage.
  if (etat.sorte === 'chargement' || etat.sorte === 'indisponible') return null;

  if (etat.sorte === 'erreur') {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="erreur">
        <Titre />
        <p
          className="flex items-start gap-1.5 text-[11px] text-amber-300 leading-relaxed"
          data-videos-message
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="min-w-0">{etat.message}</span>
        </p>
      </section>
    );
  }

  if (etat.sorte === 'aucun') {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="aucune_video">
        <Titre />
        <p className="text-[11px] text-gray-500 leading-relaxed" data-videos-message>
          Aucune vidéo pour l’instant.
        </p>
      </section>
    );
  }

  const { rendu } = etat;

  // ── En cours : une étape, jamais un pourcentage ────────────────────────
  if (rendu.etat === 'en_attente' || rendu.etat === 'en_cours') {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="en_cours">
        <Titre />
        <p
          className="flex items-center gap-1.5 text-[11px] text-gray-300"
          data-videos-etape={rendu.etape ?? ''}
          data-videos-message
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" />
          {rendu.etat === 'en_attente'
            ? 'Ta vidéo va démarrer…'
            : phraseEnCours(rendu.etape)}
        </p>
      </section>
    );
  }

  // ── Échoué ou annulé : une phrase humaine, aucun code ──────────────────
  //
  // ⚠️ AUCUN BOUTON, RELANÇABLE OU NON. La distinction se lit dans la
  // PHRASE : « Réessaie » n'apparaît que là où recommencer peut changer le
  // résultat. Poser un bouton de relance demanderait le plan de montage, que
  // la projection publique masque — et un bouton qui rendrait 404 serait pire
  // que pas de bouton du tout.
  if (!rendu.video) {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="echec">
        <Titre />
        <p
          className="flex items-start gap-1.5 text-[11px] text-amber-300 leading-relaxed"
          data-videos-motif={rendu.motif ?? ''}
          data-videos-message
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="min-w-0">{messageEchec(rendu.motif)}</span>
        </p>
      </section>
    );
  }

  // ── Prête ──────────────────────────────────────────────────────────────
  const { video } = rendu;
  const forme = orientation(video.largeur, video.hauteur);
  const duree = formaterDuree(video.dureeSecondes);

  return (
    <section className="space-y-1.5" data-videos-pretes data-videos-etat="prete">
      <Titre />
      <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-2 space-y-2">
        {lecture ? (
          // ⚠️ `controls` ET `playsInline`. Sans le second, iOS passe en
          // plein écran de force et sort la personne de la page.
          //
          // `preload="none"` reste cohérent avec le geste : c'est le clic qui
          // demande les octets, et la route les rend d'un bloc.
          <video
            src={video.chemin}
            controls
            autoPlay
            playsInline
            preload="none"
            data-videos-lecteur
            className="w-full rounded-md bg-black"
            style={{ aspectRatio: `${video.largeur} / ${video.hauteur}`, maxHeight: '60vh' }}
          />
        ) : (
          <div
            className="flex w-full items-center justify-center rounded-md bg-gray-900/60"
            style={{ aspectRatio: `${video.largeur} / ${video.hauteur}`, maxHeight: '60vh' }}
            data-videos-placeholder
          >
            <Film className="w-6 h-6 text-gray-700" />
          </div>
        )}

        <p className="text-[11px] text-gray-400" data-videos-resume>
          {[duree, forme].filter(Boolean).join(' · ')}
        </p>

        <div className="flex flex-wrap gap-1.5">
          {/* Cibles tactiles : `min-h-[36px]` et un remplissage confortable —
              cette carte se lit d'abord sur un téléphone. */}
          <button
            type="button"
            onClick={() => setLecture(true)}
            disabled={lecture}
            data-videos-regarder
            className="flex flex-1 min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-200 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
          >
            <Play className="w-3.5 h-3.5 shrink-0" /> Regarder
          </button>

          {/* ⚠️ L'ADRESSE VIENT DU SERVEUR, telle quelle. Aucune URL de
              stockage, aucune signature, rien à faire expirer — et rien à
              persister dans le navigateur.

              `download` sur un lien de MÊME ORIGINE prime sur le
              `Content-Disposition: inline` de la route : le fichier est
              enregistré au lieu d'ouvrir un onglet. */}
          <a
            href={video.chemin}
            download="ma-video.mp4"
            data-videos-telecharger
            className="flex flex-1 min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-200 hover:text-white hover:border-gray-700 transition-colors"
          >
            <Download className="w-3.5 h-3.5 shrink-0" /> Télécharger
          </a>
        </div>
      </div>
    </section>
  );
}

function Titre() {
  return (
    <h4 className="text-[10px] uppercase tracking-wide text-gray-500">
      Tes vidéos
    </h4>
  );
}

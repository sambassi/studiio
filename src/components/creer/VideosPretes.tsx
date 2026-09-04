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
 * demandé à voir. « Regarder » est ce qui déclenche le chargement — et c'est
 * aussi ce qui rend le geste explicite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ NI `autoPlay`, NI `preload="none"` — LES DEUX ENSEMBLE NE CHARGEAIENT RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mesuré en production : le lecteur restait à `readyState: 0`, `buffered: 0`,
 * indéfiniment, sur un fichier de 14 Mo pourtant servi en 200 et encodé en
 * `+faststart`. La cause est la RENCONTRE des deux attributs :
 *
 *   • `preload="none"` dit au navigateur de ne RIEN chercher tant que la
 *     lecture n'est pas demandée ;
 *   • `autoPlay` demandait cette lecture — mais sans `muted`, Chrome REFUSE
 *     de démarrer une vidéo qu'aucun geste n'a réclamée.
 *
 * La demande étant refusée, le chargement n'était jamais déclenché : un
 * lecteur qui tourne à vide, sans erreur, sans image, sans fin.
 *
 * On ne rattrape PAS cela en ajoutant `muted` — cela ferait démarrer du son
 * coupé sans que personne l'ait demandé. On l'enlève :
 *
 *   • `autoPlay` disparaît. Aucun `play()` n'est appelé, ni ici ni ailleurs :
 *     c'est le bouton natif de `controls` qui lance la lecture, donc un vrai
 *     geste, que Chrome n'a aucune raison de refuser.
 *   • `preload` passe à `auto`. Ce n'est plus le compromis d'avant : le
 *     `<video>` n'existe QUE si l'on a cliqué « Regarder », et à cet instant
 *     télécharger la vidéo est exactement ce qui a été demandé.
 *
 * ⚠️ ET L'ÉTAT DU MÉDIA EST DIT. Un octet qui n'arrive pas, un fichier
 * illisible : sans `onError`, l'écran restait noir et muet. La phrase
 * remplace le silence, et « Télécharger » reste la porte de sortie.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarPlus, Download, Film, Loader2, Play,
} from 'lucide-react';
import MenuActions from '@/components/ui/MenuActions';
import {
  RATIOS_APERCU, geometrieApercu,
} from '@/lib/creer/apercu-geometrie';
import {
  DELAI_SUIVI_MS, creerBrouillonPlanification, formaterDuree,
  lireRenduDeSession, messageEchec, orientation, phraseEnCours, renduEnCours,
  type Fetcher, type RenduEcran,
} from '@/lib/autopilot/analyse/rendu-passerelle';

interface Props {
  /** La session de tournage regardée. */
  sessionId: string;
  /** La session ne porte aucun rush : l'écran le dit plutôt que de se taire. */
  aucunRush: boolean;
  /**
   * Le format DEMANDE dans le formulaire — « 9:16 », « 1:1 », « 16:9 ».
   *
   * ⚠️ IL NE SERT QU'AU CADRE VIDE. Une vidéo existante porte SES dimensions,
   * et c'est elle qui a raison : afficher un rendu 1920×1080 dans un cadre
   * vertical parce que le formulaire dit « 9:16 » serait le meme mensonge,
   * dans l'autre sens. Le cadre vide, lui, doit montrer ce qu'on a demande —
   * sinon on choisit « Vertical » devant un rectangle horizontal.
   */
  formatSouhaite?: string;
  /**
   * Compteur de réveil. Chaque incrément relance une lecture.
   *
   * Nécessaire parce que le sondage S'ARRÊTE sur un état terminal — et
   * « aucune vidéo » en est un. Sans ce signal, une vidéo lancée depuis le
   * rush juste au-dessus n'apparaîtrait qu'au rechargement de la page.
   */
  relance?: number;
  /**
   * Remonte l'état courant, pour que la colonne d'aperçu sache qui afficher.
   *
   * ⚠️ C'EST LA CLÉ DE L'APERÇU UNIQUE. Ce composant est toujours monté — il
   * doit sonder — mais il ne rend rien tant qu'il n'a rien à montrer. Le
   * parent a besoin de le savoir pour laisser, ou non, l'aperçu du projet à
   * sa place.
   */
  onEtat?: (etat: 'vide' | 'en_cours' | 'prete' | 'echec') => void;
  /** Injectable pour les tests. Le défaut est le `fetch` du navigateur. */
  fetcher?: Fetcher;
}

type Etat =
  | { sorte: 'chargement' }
  | { sorte: 'aucun' }
  | { sorte: 'indisponible' }
  | { sorte: 'trouve'; rendu: RenduEcran }
  | { sorte: 'erreur'; message: string };

export default function VideosPretes({
  sessionId, aucunRush, relance = 0, onEtat, fetcher, formatSouhaite,
}: Props) {
  const [etat, setEtat] = useState<Etat>({ sorte: 'chargement' });
  const [lecture, setLecture] = useState(false);
  const [detail, setDetail] = useState(false);
  /**
   * Ce que le `<video>` a réussi à faire des octets.
   *
   * ⚠️ TROIS ÉTATS, PAS UN BOOLÉEN. « pas encore chargé » et « ne chargera
   * jamais » demandent deux phrases différentes : la première fait patienter,
   * la seconde renvoie vers le téléchargement.
   */
  const [media, setMedia] = useState<'chargement' | 'pret' | 'erreur'>('chargement');
  const [planif, setPlanif] = useState<
    { sorte: 'inactif' } | { sorte: 'encours' } | { sorte: 'dit'; texte: string; alerte: boolean }
  >({ sorte: 'inactif' });
  /** Le verrou du bouton, pour la même raison qu'ailleurs : une `ref`. */
  const verrouPlanifRef = useRef(false);

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

  // Le parent n'a pas à deviner ce que ce composant montre : on le lui dit.
  const courant = etat.sorte === 'trouve' ? etat.rendu : null;
  const sorteAffichee: 'vide' | 'en_cours' | 'prete' | 'echec' = (() => {
    if (aucunRush || !courant) return 'vide';
    if (courant.etat === 'en_attente' || courant.etat === 'en_cours') return 'en_cours';
    return courant.video ? 'prete' : 'echec';
  })();
  useEffect(() => { onEtat?.(sorteAffichee); }, [sorteAffichee, onEtat]);

  // Un changement de session repart de zéro : l'écran ne doit jamais montrer
  // la vidéo du tournage précédent pendant que la nouvelle charge.
  useEffect(() => {
    setEtat({ sorte: 'chargement' });
    setLecture(false);
    setMedia('chargement');
    // ⚠️ SANS RUSH, ON N'INTERROGE PAS. Une session vide ne peut avoir produit
    // aucune vidéo : la réponse est connue d'avance, et la demander quand même
    // ferait une requête par tournage ouvert, pour rien.
    if (aucunRush) return;
    rafraichirRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, aucunRush, relance]);

  /**
   * Pose la vidéo dans le Calendrier, et rien de plus.
   *
   * ⚠️ AUCUN SYSTÈME DE PUBLICATION N'EST CRÉÉ ICI. `scheduled_posts`, le
   * Calendrier et son choix de plateforme/date/heure existent déjà : on y
   * dépose un BROUILLON, l'utilisateur y finit son geste.
   */
  const ouvrirPlanification = useCallback(async (rendu: RenduEcran) => {
    if (verrouPlanifRef.current) return;
    verrouPlanifRef.current = true;
    setPlanif({ sorte: 'encours' });
    try {
      const r = await creerBrouillonPlanification(rendu, fetcher);
      if (!vivantRef.current) return;
      if (r.sorte === 'creee') {
        setPlanif({
          sorte: 'dit',
          texte: 'Brouillon créé. Ouverture du Calendrier…',
          alerte: false,
        });
        // Le Calendrier prend le relais : c'est LUI qui porte la plateforme,
        // la date et l'heure.
        window.location.href = '/dashboard/calendar';
        return;
      }
      setPlanif({ sorte: 'dit', texte: r.message, alerte: true });
    } finally {
      verrouPlanifRef.current = false;
    }
  }, [fetcher]);

  /**
   * Le cadre du format DEMANDE, montré tant qu'aucune vidéo ne répond.
   *
   * ⚠️ IL REMPLACE UN MENSONGE, PAS UN VIDE. Avant, la colonne n'affichait
   * rien avant le premier rendu, puis reprenait les dimensions du rendu
   * PRECEDENT : choisir « Vertical » laissait donc un rectangle horizontal a
   * l'ecran, et c'est ce qui a fait croire a un rendu au mauvais format.
   */
  const CadreFormat = ({ enfant }: { enfant?: React.ReactNode }) => {
    const [l, h] = RATIOS_APERCU[formatSouhaite ?? ''] ?? RATIOS_APERCU['9:16'];
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.02]"
        style={geometrieApercu(l, h)}
        data-videos-cadre={formatSouhaite ?? '9:16'}
      >
        {enfant ?? <Film className="h-6 w-6 text-gray-700" aria-hidden="true" />}
      </div>
    );
  };

  // ── Aucun rush : rien n'a pu être créé, et on le dit ───────────────────
  if (aucunRush) {
    return (
      <section className="space-y-1.5" data-videos-pretes data-videos-etat="aucun_rush">
        <Titre texte="Votre vidéo" />
        <CadreFormat />
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
        <Titre texte="Votre vidéo" />
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
        <Titre texte="Votre vidéo" />
        <CadreFormat />
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
        <Titre texte="Création en cours" fort />
        <CadreFormat enfant={<Loader2 className="h-5 w-5 animate-spin text-purple-400" aria-hidden="true" />} />
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
        <Titre texte="La création n’a pas abouti" fort />
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
      <div className="flex items-center justify-between gap-2">
        <Titre texte="Votre vidéo est prête" fort />
        {/* ⚠️ AUCUN IDENTIFIANT ICI. Ni rendu, ni plan, ni algorithme : ce
            sont des reperes de diagnostic, pas des informations d'usage. Ce
            que le menu montre — duree, dimensions, poids — est ce qu'on lit
            sur une fiche de fichier. */}
        <MenuActions
          compact
          marqueur="rendu"
          etiquette="Actions de la vidéo"
          actions={[{
            libelle: detail ? 'Masquer les détails' : 'Détails du rendu',
            onClick: () => setDetail((d) => !d),
          }]}
        />
      </div>
      <div className="space-y-2">
        {lecture ? (
          <div className="space-y-1">
            {/* ⚠️ `controls` ET `playsInline`. Sans le second, iOS passe en
                plein écran de force et sort la personne de la page.

                ⚠️ PAS D'`autoPlay`, ET `preload="auto"` — voir l'en-tête du
                fichier. C'est la lecture demandée par le bouton natif qui
                démarre la vidéo ; rien ici n'appelle `play()`. */}
            {/* ⚠️ `controlsList="nodownload"` SEULEMENT. Lecture, position,
                volume et plein ecran restent : on retire l'entree du menu
                natif qui doublait le bouton « Telecharger », pas les
                commandes du lecteur. */}
            <video
              src={video.chemin}
              controls
              controlsList="nodownload"
              playsInline
              preload="auto"
              onLoadedMetadata={() => setMedia('pret')}
              onError={() => setMedia('erreur')}
              data-videos-lecteur
              data-videos-media={media}
              className="rounded-md bg-black"
              style={geometrieApercu(video.largeur, video.hauteur)}
            />
            {media !== 'pret' && (
              <p
                className={`flex items-start gap-1.5 text-[10px] leading-relaxed ${
                  media === 'erreur' ? 'text-amber-300' : 'text-gray-500'
                }`}
                data-videos-media-message
              >
                {media === 'erreur' ? (
                  <>
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                    <span className="min-w-0">
                      La vidéo ne s’ouvre pas ici. Télécharge-la pour la regarder.
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-3 h-3 shrink-0 mt-px animate-spin" />
                    <span className="min-w-0">La vidéo se charge…</span>
                  </>
                )}
              </p>
            )}
          </div>
        ) : (
          /* ⚠️ « REGARDER » RESTE, MAIS DEVIENT LE CADRE LUI-MEME.
             Le bouton n'etait pas redondant : c'est LUI qui evite de
             telecharger plusieurs megaoctets a chaque affichage de la page,
             puisque le `<video>` n'existe qu'apres le clic. Le supprimer
             aurait remis cette charge sur tout le monde. Le fondre dans
             l'affiche retire un bouton de la rangee sans rien perdre. */
          <button
            type="button"
            onClick={() => { setMedia('chargement'); setLecture(true); }}
            data-videos-regarder
            data-videos-placeholder
            aria-label="Lire la vidéo"
            title="Lire la vidéo"
            className="group flex items-center justify-center rounded-lg border
              border-white/10 bg-white/[0.02] transition-colors hover:border-purple-500/50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            style={geometrieApercu(video.largeur, video.hauteur)}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full
              border border-white/20 text-gray-300 group-hover:border-purple-400 group-hover:text-white">
              <Play className="ml-0.5 h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        )}

        <p className="text-[11px] text-gray-400" data-videos-resume>
          {[duree, forme].filter(Boolean).join(' · ')}
        </p>

        {detail && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1" data-videos-detail>
            {[
              ['Dimensions', `${video.largeur} × ${video.hauteur}`],
              ['Durée', duree],
              ['Format', forme],
            ].map(([libelle, valeur]) => (
              <div key={libelle} className="min-w-0">
                <dt className="truncate text-[10px] uppercase tracking-wide text-gray-500">{libelle}</dt>
                <dd className="truncate text-[11px] text-gray-200">{valeur}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex flex-wrap gap-1.5">
          {/* Cibles tactiles : `min-h-[36px]` et un remplissage confortable —
              cette carte se lit d'abord sur un téléphone. */}
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

          {/* ── La suite du parcours, nommée ────────────────────────────
              Sans ce bouton, quelqu'un qui vient d'obtenir sa vidéo ne sait
              pas quoi faire ensuite : rien à l'écran ne mène au Calendrier. */}
          <button
            type="button"
            onClick={() => ouvrirPlanification(rendu)}
            disabled={planif.sorte === 'encours'}
            data-videos-planifier
            className="flex w-full min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
          >
            <CalendarPlus className="w-3.5 h-3.5 shrink-0" />
            {planif.sorte === 'encours' ? 'Préparation…' : 'Planifier la publication'}
          </button>
        </div>

        {planif.sorte === 'dit' && (
          <p
            className={`text-[10px] leading-relaxed ${planif.alerte ? 'text-amber-400/80' : 'text-gray-400'}`}
            data-videos-planif-message
          >
            {planif.texte}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Le titre du bloc.
 *
 * ⚠️ IL DIT L'ÉTAT, il ne nomme pas une rubrique. « Tes vidéos » laissait
 * l'utilisateur déduire, d'un cadre gris ou d'un texte minuscule, si quelque
 * chose était en train de se passer. Le titre porte désormais l'information
 * principale, et c'est lui qu'on lit en arrivant.
 */
function Titre({ texte, fort = false }: { texte: string; fort?: boolean }) {
  if (fort) {
    return (
      <h4 className="text-sm font-semibold text-white" data-videos-titre>
        {texte}
      </h4>
    );
  }
  return (
    <h4 className="text-[10px] uppercase tracking-wide text-gray-500" data-videos-titre>
      {texte}
    </h4>
  );
}

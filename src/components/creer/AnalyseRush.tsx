'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, ScanSearch,
} from 'lucide-react';
import {
  lireAnalyse, lancerAnalyse, vignettesAffichables, conduiteApresLancement,
  analyseEnCours, DELAI_SUIVI_MS,
  type AnalyseEcran, type VignetteAffichable,
} from '@/lib/autopilot/analyse/passerelle';
import {
  phraseEnCours, messageEchec, relanceCoherente, formaterTechnique,
  extraireContenuInterprete, contenuInterpreteVide,
} from '@/lib/autopilot/analyse/presentation';
import PassagesSuggeres from './PassagesSuggeres';
import type { AutopilotMontageStyle } from '@/lib/autopilot/textStyle';
import type { RecetteAudio } from '@/lib/autopilot/analyse/recette-audio';

/**
 * L'analyse d'UN rush, greffée sous sa ligne dans les sessions de tournage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE COMPOSANT EXISTE PAR RUSH, ET NON UNE FOIS POUR LA LISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Parce que le suivi périodique doit s'arrêter tout seul, et qu'il ne
 * s'arrête proprement que s'il appartient à ce qui disparaît. Un suivi tenu
 * par la liste devrait savoir quels rushes sont encore actifs, se
 * réabonner quand la liste change, et se démonter quand elle se vide — trois
 * occasions d'oublier. Ici, le rush qui quitte l'écran emporte sa minuterie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE STATUT NE VIT PAS DANS REACT — IL VIT SUR LE SERVEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Au montage, le composant DEMANDE l'analyse (`GET`). Il ne suppose rien à
 * partir de ce qui s'est passé dans la page : une analyse lancée avant un
 * rechargement, ou depuis un autre onglet, se retrouve intacte. Un état tenu
 * en mémoire aurait affiché « Analyser » sur un rush en train d'être mesuré,
 * et le clic suivant aurait pris un 409 sans que personne comprenne pourquoi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE SUIVI NE FAIT QUE LIRE. JAMAIS D'ÉCRITURE AUTOMATIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La minuterie appelle `lireAnalyse`, et cette fonction ne connaît que `GET`.
 * C'est un invariant, pas une précaution : un `POST` rejoué toutes les trois
 * secondes consommerait une place d'extraction à chaque tour, et créerait des
 * analyses que personne n'a demandées. Aucune réponse — pas même un 429 avec
 * son `Retry-After` — ne déclenche de relance. Relancer est un geste.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUCUN POURCENTAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le serveur connaît des ÉTAPES, pas une progression. « 67 % » serait une
 * invention : il n'avancerait au rythme de rien, et se figerait au milieu
 * d'une étape longue. On nomme l'étape en cours, et c'est tout ce qu'on sait.
 */

interface Props {
  rushId: string;
  /**
   * Format et durée voulus pour la vidéo. Passe-plat vers `PassagesSuggeres`,
   * qui les remet à la chaîne — ce composant n'en fait rien.
   */
  montage?: AutopilotMontageStyle;
  /** Passe-plat, comme `montage` : ce composant n'en fait rien. */
  audioDefaut?: RecetteAudio;
  onEnregistrerAudioDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  /**
   * Passe-plat vers `PassagesSuggeres`, qui porte le bouton « Créer ma
   * vidéo ». Ce composant-ci ne lance rien et ne sait rien de la chaîne : il
   * transmet, c'est tout.
   */
  onVideoLancee?: () => void;
  /**
   * `chaine` = la page principale refondue : l'etat de l'analyse et la
   * chaine de creation, RIEN d'autre. `complete` = l'ancien rendu, avec le
   * releve technique et les vignettes deplies sur place.
   *
   * ⚠️ AUCUNE FONCTION N'EST PERDUE EN `chaine`. Le releve, les vignettes et
   * les passages vivent dans le tiroir « Voir l'analyse » ; ce sont les
   * MEMES donnees, lues par les memes routes, montrees quand on les demande.
   */
  variante?: 'chaine' | 'complete';
  /** Ouvre le tiroir d'analyse de ce rush. Absent = le lien ne s'affiche pas. */
  onVoirAnalyse?: () => void;
  /**
   * Compteur de relance venu du « ⋯ » de la carte du rush.
   *
   * ⚠️ UN COMPTEUR, PAS UN BOOLEEN. Deux relances de suite portent deux
   * valeurs differentes ; un booleen remis a `false` par le parent ferait un
   * aller-retour de plus, et deux clics rapproches n'en declencheraient
   * qu'un. La valeur initiale ne declenche rien : seul un CHANGEMENT lance.
   */
  relance?: number;
}

/** Le plafond dur du moteur (`VIGNETTES_MAX`), redit ici pour l'affichage. */
const VIGNETTES_AFFICHEES = 8;

interface Refus {
  message: string;
  relancable: boolean;
  retryApresSecondes: number | null;
}

export default function AnalyseRush({
  rushId, montage, onVideoLancee, audioDefaut, onEnregistrerAudioDefaut,
  variante = 'complete', onVoirAnalyse, relance,
}: Props) {
  const chaine = variante === 'chaine';
  const [analyse, setAnalyse] = useState<AnalyseEcran | null>(null);
  const [chargement, setChargement] = useState(true);
  const [indisponible, setIndisponible] = useState<string | null>(null);
  const [demande, setDemande] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);
  const [vignettes, setVignettes] = useState<VignetteAffichable[] | null>(null);
  const [vignettesManquantes, setVignettesManquantes] = useState(false);

  const vivantRef = useRef(true);
  const minuterieRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyseRef = useRef<AnalyseEcran | null>(null);
  const demandeRef = useRef(false);
  const rafraichirRef = useRef<() => void>(() => {});
  const vignettesPourRef = useRef<string | null>(null);

  /**
   * Programme — ou ne programme pas — la prochaine lecture.
   *
   * Le tour suivant n'est armé QUE si l'analyse est encore active. `reussie`,
   * `echouee` et `annulee` ne se rouvrent pas : continuer à interroger serait
   * une requête toutes les trois secondes, pour toujours, sur un résultat qui
   * ne bougera plus.
   *
   * La minuterie précédente est toujours annulée d'abord : sans ça, un clic
   * pendant un tour en vol ferait courir deux boucles en parallèle, et la
   * seconde survivrait au démontage.
   */
  const planifier = useCallback((suivante: AnalyseEcran | null) => {
    if (minuterieRef.current) {
      clearTimeout(minuterieRef.current);
      minuterieRef.current = null;
    }
    if (!vivantRef.current) return;
    if (!analyseEnCours(suivante)) return;
    minuterieRef.current = setTimeout(() => { rafraichirRef.current(); }, DELAI_SUIVI_MS);
  }, []);

  const rafraichir = useCallback(async () => {
    const r = await lireAnalyse(rushId);
    // Le composant a pu être démonté pendant la requête. Écrire ici
    // provoquerait un avertissement React et, pire, rearmerait la minuterie.
    if (!vivantRef.current) return;
    setChargement(false);

    if (r.sorte === 'indisponible') {
      setIndisponible(r.message);
      // Une lecture ratée n'arrête pas le suivi d'une analyse qu'on savait
      // active : le réseau flanche plus souvent que le serveur.
      planifier(analyseRef.current);
      return;
    }
    setIndisponible(null);
    const suivante = r.sorte === 'trouvee' ? r.analyse : null;
    analyseRef.current = suivante;
    setAnalyse(suivante);
    planifier(suivante);
  }, [rushId, planifier]);

  rafraichirRef.current = rafraichir;

  useEffect(() => {
    vivantRef.current = true;
    rafraichir();
    return () => {
      vivantRef.current = false;
      if (minuterieRef.current) {
        clearTimeout(minuterieRef.current);
        minuterieRef.current = null;
      }
    };
  }, [rafraichir]);

  /**
   * Le clic — un `POST`, et un seul, même si l'on clique trois fois.
   *
   * Le garde-fou est un `ref` et non l'état `demande` : deux clics dans le
   * même tour de rendu liraient tous les deux `false`, et deux requêtes
   * partiraient. La seconde prendrait un 409, ce qui n'est pas grave, mais
   * elle aurait aussi occupé une place d'extraction pour rien.
   */
  const analyser = useCallback(async () => {
    if (demandeRef.current) return;
    demandeRef.current = true;
    setDemande(true);
    setRefus(null);
    setIndisponible(null);

    const conduite = conduiteApresLancement(await lancerAnalyse(rushId));
    if (vivantRef.current) {
      if (conduite.suite === 'relire') {
        // 201 comme 409 : dans les deux cas une analyse existe, et c'est le
        // serveur qui dit laquelle — pas le corps de la réponse au POST.
        await rafraichir();
      } else {
        setRefus({
          message: conduite.message,
          relancable: conduite.relancable,
          retryApresSecondes: conduite.retryApresSecondes,
        });
        setChargement(false);
      }
    }
    demandeRef.current = false;
    if (vivantRef.current) setDemande(false);
  }, [rushId, rafraichir]);

  /**
   * La relance demandee par le « ⋯ » de la carte.
   *
   * ⚠️ ON IGNORE LA PREMIERE VALEUR. Monter le composant ne doit pas lancer
   * une analyse que personne n'a demandee — c'est l'invariant de tout ce
   * fichier, et un `useEffect` naif sur une prop le casserait au montage.
   */
  const relanceVueRef = useRef<number | undefined>(relance);
  useEffect(() => {
    if (relance === undefined) return;
    if (relanceVueRef.current === relance) return;
    relanceVueRef.current = relance;
    analyser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relance]);

  /**
   * Les vignettes : demandées une seule fois par analyse, et seulement quand
   * il y en a.
   *
   * Les URL sont signées et courtes — elles ne sont donc ni mises en cache ni
   * conservées d'une analyse à l'autre. `vignettesPourRef` empêche que chaque
   * rendu en redemande un jeu neuf.
   */
  useEffect(() => {
    // ⚠️ LA CLÉ EST L'ANALYSE AFFICHÉE, PAS « CELLE QUI A DES IMAGES ».
    //
    // La sortie anticipée sur `nombre <= 0` se faisait AVANT de mettre à jour
    // `vignettesPourRef` et sans jamais toucher à `vignettes`. Une analyse
    // réussie SANS aucun aperçu laissait donc à l'écran les images de la
    // version précédente — sous les mesures de la nouvelle, à des adresses
    // qui répondent encore. Tant qu'on ne pouvait relancer que depuis
    // `echouee` ou `annulee`, où il n'y a jamais d'image à l'écran, la
    // situation n'existait pas. Depuis `reussie`, elle est ordinaire : c'est
    // même exactement le cas qu'on relance — une mesure qui a réussi et dont
    // les huit vignettes ont échoué.
    const affichee = analyse && analyse.etat === 'reussie' ? analyse.id : null;
    if (vignettesPourRef.current === affichee) return undefined;
    vignettesPourRef.current = affichee;
    // Une image cassée n'appartient qu'à l'analyse qui l'a produite : sans
    // cette remise à zéro, sa note collerait à la suivante.
    setVignettesManquantes(false);
    // ⚠️ AUCUN ALLER-RETOUR. Les adresses se déduisent de l'analyse déjà lue :
    // le serveur sert chaque image à `…/analyses/<id>/vignettes/<i>` en
    // relisant la clé lui-même. Une requête de plus par rush, toutes les
    // trois secondes, pour reconstruire des adresses déterministes serait du
    // trafic pur. Un échec image se voit sur le `<img>`, pas ici.
    setVignettes(
      affichee && analyse && analyse.vignettes.nombre > 0
        ? vignettesAffichables(affichee, analyse.vignettes.nombre, analyse.vignettes.secondes)
          .slice(0, VIGNETTES_AFFICHEES)
        : null,
    );
    return undefined;
  }, [analyse]);

  const etatAffiche = chargement ? 'chargement' : analyse ? analyse.etat : 'aucune';

  const boutonAnalyse = (libelle: string, relance: boolean) => (
    <button
      type="button"
      onClick={analyser}
      disabled={demande}
      data-analyse-lancer={relance ? 'relance' : 'premiere'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-800 px-2.5 py-2 min-h-[36px] text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-50 transition-colors"
    >
      {demande
        ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        : relance
          ? <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          : <ScanSearch className="w-3.5 h-3.5 shrink-0" />}
      {demande ? 'Analyse demandée…' : libelle}
    </button>
  );

  const contenu = analyse ? extraireContenuInterprete(analyse) : null;
  const aVenir = contenu === null || contenuInterpreteVide(contenu);
  const { mesures, details } = analyse
    ? formaterTechnique(analyse.technique, analyse.dureeSecondes)
    : { mesures: [], details: [] };

  return (
    <div
      className="mt-1.5 space-y-1.5"
      data-analyse-rush={rushId}
      data-analyse-etat={etatAffiche}
    >
      {chargement && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Statut de l’analyse…
        </span>
      )}

      {/* Jamais analysé : le seul endroit où « Analyser » est une première fois. */}
      {!chargement && !analyse && !refus && boutonAnalyse('Analyser', false)}

      {analyse?.etat === 'en_attente' && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
          <Clock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          Analyse en attente
        </span>
      )}

      {analyse?.etat === 'en_cours' && (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-300" data-analyse-etape={analyse.etape ?? ''}>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" />
          {/* Une ÉTAPE, jamais un pourcentage. */}
          {phraseEnCours(analyse.etape)}
        </span>
      )}

      {analyse?.etat === 'echouee' && (
        <div className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-300" data-analyse-echec={analyse.motifEchec ?? ''}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="min-w-0">{messageEchec(analyse.motifEchec)}</span>
          </p>
          {/* Relancer n'est proposé que si recommencer peut changer le
              résultat. Un fichier illisible le restera. */}
          {relanceCoherente(analyse.motifEchec) && boutonAnalyse('Relancer l’analyse', true)}
        </div>
      )}

      {analyse?.etat === 'annulee' && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-gray-400">Analyse annulée.</p>
          {boutonAnalyse('Relancer l’analyse', true)}
        </div>
      )}

      {/* Le refus du POST : distinct de l'échec d'une analyse, parce qu'il n'y
          a rien eu à analyser. `Retry-After` informe, il ne relance pas. */}
      {refus && (
        <div className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-300" data-analyse-message>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span className="min-w-0">{refus.message}</span>
          </p>
          {refus.retryApresSecondes !== null && (
            <p className="text-[10px] text-gray-500" data-analyse-retry={refus.retryApresSecondes}>
              Le serveur suggère de revenir dans {Math.max(1, Math.round(refus.retryApresSecondes / 60))} min.
            </p>
          )}
          {refus.relancable && boutonAnalyse('Réessayer', true)}
        </div>
      )}

      {indisponible && !refus && (
        <p className="text-[11px] text-gray-500" data-analyse-indisponible>{indisponible}</p>
      )}

      {analyse?.etat === 'reussie' && (
        <div className={chaine ? 'space-y-2' : 'rounded-lg border border-gray-800 bg-gray-950/40 p-2 space-y-2'}>
          {/* L'état à gauche, l'action à droite — le même ordre que sous
              `echouee` et `annulee`, où le bouton suit immédiatement la phrase
              d'état.

              Une mesure réussie n'est pas définitive : le rush a pu être
              remplacé, et une extraction peut réussir sa mesure sans produire
              un seul aperçu. Relancer crée une version de plus — c'est le
              serveur qui la numérote (`version = max + 1`), le client ne
              demande qu'« une nouvelle analyse » et ne choisit rien.

              Le bouton s'AJOUTE au résultat, il ne s'y substitue pas : ce
              qu'on veut comparer à la mesure suivante doit rester lisible
              pendant qu'on la demande.

              ⚠️ `!refus?.relancable`, ET SURTOUT PAS `!refus`.

              Le bloc de refus, rendu plus haut, porte son propre bouton —
              mais SEULEMENT quand le refus est relançable. Céder la place à
              `refus` tout court laissait donc un écran SANS ISSUE sur un
              refus définitif : ni bouton dans le bloc de refus, ni bouton
              dans la carte, et `refus` n'est remis à `null` que par le
              gestionnaire de clic, devenu inatteignable — le sondage, lui,
              est arrêté sur un état terminal. Une session expirée (401)
              condamnait ainsi l'écran jusqu'au rechargement de la page.

              Ce que la condition garantit, et c'est un invariant total :
              sur une analyse réussie, il y a EXACTEMENT un bouton de
              lancement. Jamais zéro, jamais deux. */}
          {/* ⚠️ EN VARIANTE `chaine`, NI BADGE NI BOUTON ICI. « Analysé » est
              deja dit par le ✓ de la carte du rush, et « Relancer l'analyse »
              vit dans le « ⋯ » de cette meme carte. Les repeter ajouterait
              deux elements a l'ecran pour zero information de plus.
              L'invariant « exactement un bouton de lancement sur une analyse
              reussie » tient toujours : en `chaine` il est dans le menu. */}
          {!chaine && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-300" data-analyse-badge>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                Analysé
              </span>
              {!refus?.relancable && boutonAnalyse('Relancer l’analyse', true)}
            </div>
          )}

          {/* ── TOUT LE DÉTAIL EST REPLIÉ ──────────────────────────────────
              Mesuré sur le rush de production : ce bloc faisait 1 289 px de
              haut — près de deux écrans — pour UN rush, et repoussait la
              vidéo produite à 4,6 écrans du haut de page. Codec, débit,
              fréquence d'échantillonnage et taille de fichier ne disent rien
              à quelqu'un qui veut monter une vidéo ; ils restent lisibles
              d'un clic pour qui diagnostique.

              ⚠️ RIEN N'EST SUPPRIMÉ. Les mêmes noeuds, les mêmes attributs
              `data-*`, la même mesure — seulement repliés. Les tests qui les
              interrogent continuent de les trouver. */}
          <details data-analyse-detail className={chaine ? 'hidden' : undefined}>
            <summary className="cursor-pointer list-none text-[10px] text-gray-500 hover:text-gray-300 min-h-[28px] flex items-center">
              Voir l’analyse détaillée
            </summary>
            <div className="mt-1.5 space-y-2">

          {mesures.length > 0 && (
            <dl
              className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5"
              data-analyse-technique
            >
              {mesures.map((l) => (
                <div key={l.cle} className="min-w-0" data-analyse-mesure={l.cle}>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-500 truncate">{l.libelle}</dt>
                  <dd className="text-[11px] text-gray-200 truncate">{l.valeur}</dd>
                </div>
              ))}
            </dl>
          )}

          {details.length > 0 && (
            <details data-analyse-details>
              {/* Repliés : la sonde utilisée intéresse le diagnostic, pas
                  l'usage courant — et sur un téléphone, chaque ligne compte. */}
              <summary className="cursor-pointer list-none text-[10px] text-gray-500 hover:text-gray-300 min-h-[28px] flex items-center">
                Détails de la mesure
              </summary>
              <dl className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1.5">
                {details.map((l) => (
                  <div key={l.cle} className="min-w-0" data-analyse-mesure={l.cle}>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-500 truncate">{l.libelle}</dt>
                    <dd className="text-[11px] text-gray-200 truncate">{l.valeur}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          {vignettes && vignettes.length > 0 && (
            <ul className="grid grid-cols-4 sm:grid-cols-8 gap-1" data-analyse-vignettes>
              {vignettes.map((v, i) => (
                <li key={v.url}>
                  {/* Un `<img>` nu, et non `next/image`. L'adresse est servie
                      par notre propre route, qui relit la clé côté serveur et
                      rend les octets : l'optimiseur d'images irait chercher
                      l'objet sans la session, et n'obtiendrait qu'un 401. */}
                  <img
                    src={v.url}
                    alt={v.seconde === null ? `Aperçu ${i + 1}` : `Aperçu à ${Math.round(v.seconde)} s`}
                    loading="lazy"
                    decoding="async"
                    data-analyse-vignette={i}
                    // Une image qui ne vient pas — objet disparu, stockage
                    // injoignable — ne doit pas laisser un carré vide sans
                    // explication. La mesure, elle, reste affichée.
                    onError={() => setVignettesManquantes(true)}
                    className="w-full rounded object-cover bg-gray-900"
                    style={{ aspectRatio: '1 / 1' }}
                  />
                </li>
              ))}
            </ul>
          )}

          {vignettesManquantes && (
            <p className="text-[10px] text-gray-500" data-analyse-vignettes-absentes>
              Aperçus indisponibles pour l’instant. La mesure, elle, est complète.
            </p>
          )}

          {/* ── Ce qui viendra, dit comme tel ────────────────────────────── */}
          {aVenir ? (
            <p className="text-[10px] text-gray-500 leading-relaxed" data-analyse-a-venir>
              Compréhension du contenu, parole et qualité : ces analyses arriveront
              à une étape suivante.
            </p>
          ) : (
            <div className="space-y-1.5" data-analyse-interprete>
              {(contenu?.resume || (contenu?.textes.length ?? 0) > 0) && (
                <section className="space-y-1" data-analyse-section="comprehension">
                  <h4 className="text-[10px] uppercase tracking-wide text-gray-500">
                    Compréhension du contenu
                  </h4>
                  {contenu?.resume && (
                    <p className="text-[11px] text-gray-300 leading-relaxed">{contenu.resume}</p>
                  )}
                  {(contenu?.textes.length ?? 0) > 0 && (
                    <ul className="flex flex-wrap gap-1">
                      {contenu?.textes.slice(0, 8).map((t) => (
                        <li key={t} className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-400 max-w-full truncate">
                          {t}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              {contenu?.paroleTexte && (
                <section className="space-y-1" data-analyse-section="parole">
                  <h4 className="text-[10px] uppercase tracking-wide text-gray-500">Parole</h4>
                  <p className="text-[11px] text-gray-300 leading-relaxed">{contenu.paroleTexte}</p>
                </section>
              )}
            </div>
          )}

            </div>
          </details>

          {/* ── M3-C : les passages candidats ──────────────────────────────
              Uniquement sur une analyse RÉUSSIE : la route les refuse
              autrement, et un bouton qui mène à un 409 est un bouton qui
              ment. */}
          {analyse.etat === 'reussie' && (
            <PassagesSuggeres
              analyseId={analyse.id}
              montage={montage}
              audioDefaut={audioDefaut}
              onEnregistrerAudioDefaut={onEnregistrerAudioDefaut}
              onVideoLancee={onVideoLancee}
              variante={chaine ? 'compacte' : 'complete'}
              onVoirAnalyse={onVoirAnalyse}
            />
          )}
        </div>
      )}
    </div>
  );
}

'use client';

/**
 * M3-C — « Passages suggérés ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pas de lecteur vidéo, pas de timeline éditable, pas de glisser-déposer,
 * pas de découpe, pas de rendu. M3-C propose des passages ; il n'en coupe
 * aucun. Un écran qui laisserait déplacer une borne laisserait croire que le
 * déplacement est enregistré quelque part — il ne le serait pas.
 *
 * ⚠️ AUCUNE VALEUR N'EST FABRIQUÉE. Un champ absent ne devient pas zéro, et
 * une génération sans candidat ne s'affiche pas comme une réussite vide : le
 * `filter(candidatValide)` de la passerelle a déjà écarté ce qui n'est pas
 * affichable, et ce qui reste vient de la base.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lireCandidats, lancerCandidats, formaterInstant,
  type GenerationEcran,
} from '@/lib/autopilot/analyse/candidat-passerelle';
import {
  creerVideo, phraseChaine, type EtapeChaine,
} from '@/lib/autopilot/analyse/chaine-passerelle';
import type { AutopilotMontageStyle } from '@/lib/autopilot/textStyle';
import {
  RECETTE_AUDIO_DEFAUT, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import ReglagesAudio from './ReglagesAudio';
import EtapesCreation from './EtapesCreation';

interface Props {
  /** L'analyse source. Toujours `reussie` — l'appelant s'en assure. */
  analyseId: string;
  /**
   * Format et durée cible. Omis = les valeurs par défaut de la chaîne.
   *
   * ⚠️ CE SONT LES DEUX SEULS RÉGLAGES QUE LE MOTEUR HONORE. Ils partent tels
   * quels vers `POST /clips/[id]/montage`, qui les refuse s'ils sortent de
   * son vocabulaire.
   */
  montage?: AutopilotMontageStyle;
  /**
   * Le reglage audio PAR DEFAUT du compte. Point de depart de l'ecran.
   *
   * ⚠️ IL N'EST PAS LA DEMANDE. Ce qui part au rendu est l'etat local
   * ci-dessous : l'utilisateur peut en devier pour CETTE video sans que ses
   * habitudes changent. Seul `onEnregistrerAudioDefaut` les reecrit.
   */
  audioDefaut?: RecetteAudio;
  /** Enregistre la recette comme defaut. Absent = le bouton ne s'affiche pas. */
  onEnregistrerAudioDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  /**
   * Prévient l'écran des vidéos qu'un rendu vient de partir.
   *
   * Sans ce signal, `VideosPretes` a déjà conclu « aucune vidéo » et cessé de
   * sonder : le rendu lancé n'apparaîtrait qu'au rechargement de la page.
   */
  onVideoLancee?: () => void;
  /**
   * `compacte` = la page principale : Audio + « Creer ma video », SANS la
   * liste des passages ni le releve. `complete` = l'ancien rendu, conserve
   * pour les usages qui l'attendent encore.
   *
   * ⚠️ LA LISTE N'EST PAS SUPPRIMEE, ELLE DEMENAGE. Elle vit dans le tiroir
   * « Voir l'analyse », qui la rend AVEC les images — ce qu'une liste de
   * timecodes empilee sur la page principale ne faisait pas.
   */
  variante?: 'compacte' | 'complete';
  /** Ouvre le tiroir d'analyse. Absent = le lien ne s'affiche pas. */
  onVoirAnalyse?: () => void;
}

/**
 * L'état du bouton « Créer ma vidéo ».
 *
 * ⚠️ `encours` PORTE L'ÉTAPE, PAS UN POURCENTAGE. Aucune des trois routes ne
 * sait dire où elle en est dans son travail ; elle sait seulement lequel des
 * trois elle fait.
 */
type EtatChaine =
  | { sorte: 'inactif' }
  | { sorte: 'encours'; etape: EtapeChaine }
  | { sorte: 'dit'; texte: string; alerte: boolean };

export default function PassagesSuggeres({
  analyseId, montage, audioDefaut, onEnregistrerAudioDefaut, onVideoLancee,
  variante = 'complete', onVoirAnalyse,
}: Props) {
  // ⚠️ RESYNCHRONISE SUR LA VALEUR SERIALISEE, comme le fait deja le wizard
  // pour `designStyle` : l'objet change d'identite a chaque relecture de la
  // configuration, et se caler dessus reinitialiserait le reglage en cours
  // d'edition a chaque rafraichissement.
  const signatureDefaut = JSON.stringify(audioDefaut ?? null);
  const [audio, setAudio] = useState<RecetteAudio>(audioDefaut ?? RECETTE_AUDIO_DEFAUT);
  useEffect(() => {
    setAudio(audioDefaut ?? RECETTE_AUDIO_DEFAUT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureDefaut]);
  const [generation, setGeneration] = useState<GenerationEcran | null>(null);
  const [chargement, setChargement] = useState(true);
  const [indisponible, setIndisponible] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demande, setDemande] = useState(false);
  const [chaine, setChaine] = useState<EtatChaine>({ sorte: 'inactif' });
  /** Le verrou du bouton. Une `ref` : elle bascule dans le tick du clic. */
  const verrouRef = useRef(false);

  const vivantRef = useRef(true);

  useEffect(() => {
    vivantRef.current = true;
    return () => { vivantRef.current = false; };
  }, []);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setIndisponible(null);
    setErreur(null);
    setGeneration(null);

    (async () => {
      const r = await lireCandidats(analyseId);
      if (annule || !vivantRef.current) return;
      if (r.sorte === 'indisponible') setIndisponible(r.message);
      else if (r.sorte === 'erreur') setErreur(r.message);
      else if (r.sorte === 'trouvee') setGeneration(r.generation);
      setChargement(false);
    })();

    return () => { annule = true; };
  }, [analyseId]);

  const chercher = useCallback(async () => {
    // ⚠️ UN SEUL ENVOI. Le garde local évite le double clic ; l'index unique
    // de la base est ce qui le garantit vraiment.
    if (demande) return;
    setDemande(true);
    setErreur(null);
    setIndisponible(null);

    const r = await lancerCandidats(analyseId);
    if (!vivantRef.current) return;

    if (r.sorte === 'lancee') setGeneration(r.generation);
    else if (r.sorte === 'indisponible') setIndisponible(r.message);
    else if (r.sorte === 'deja_en_cours') {
      setErreur('Une recherche est déjà en cours pour cette analyse.');
    } else setErreur(r.message);

    setDemande(false);
  }, [analyseId, demande]);

  /**
   * Enchaîne découpage → montage → rendu.
   *
   * ⚠️ LE VERROU EST UNE `ref`, PAS L'ÉTAT — ET UN TEST L'A EXIGÉ.
   *
   * `if (chaine.sorte === 'encours')` semblait suffire. Il ne suffit pas :
   * React regroupe les mises à jour d'un même tick, donc trois clics rapides
   * lisent tous la MÊME closure, où `chaine` vaut encore `inactif`. Trois
   * chaînes partaient. Une `ref` bascule, elle, immédiatement : le deuxième
   * clic la voit déjà levée.
   *
   * Les trois routes s'en protègent aussi de leur côté, chacune par un index
   * unique en base — mais compter là-dessus laisserait trois requêtes partir
   * pour se faire refuser, et le message affiché serait celui du refus.
   *
   * ⚠️ ET LE `finally` NE TOUCHE QUE LE VERROU. Remettre `chaine` à
   * « inactif » effacerait le message que chaque issue vient de poser.
   */
  const creer = useCallback(async () => {
    if (verrouRef.current) return;
    // ⚠️ LE JEU DE PASSAGES, PAS L'ANALYSE — ET LES DEUX SONT DES UUID.
    //
    // La route des clips est `/api/autopilot/candidats/[candidateSetId]/clips`.
    // Lui donner `analyseId` produit un 404 « Passages introuvables » : elle
    // cherche un jeu de candidats sous un identifiant d'analyse. Rien dans le
    // typage ne l'empêche, les deux sont des chaînes — c'est en production que
    // ça se voit.
    //
    // `generation.id` EST le jeu de candidats : c'est ce que rend
    // `GET /analyses/[id]/candidats`, et ce que `generationDepuisReponse`
    // recopie dans `id`.
    const jeuPassages = generation?.id;
    if (!jeuPassages) return;
    verrouRef.current = true;
    setChaine({ sorte: 'encours', etape: 'decoupage' });

    try {
      const r = await creerVideo({
        candidateSetId: jeuPassages,
        format: montage?.format,
        dureeCibleSecondes: montage?.dureeSecondes,
        // ⚠️ LA RECETTE DE CETTE VIDEO, PAS LE DEFAUT DU COMPTE.
        audio,
        signalerEtape: (etape) => {
          if (vivantRef.current) setChaine({ sorte: 'encours', etape });
        },
      });
      if (!vivantRef.current) return;

      if (r.sorte === 'lancee') {
        setChaine({
          sorte: 'dit',
          texte: 'Ta vidéo est en cours de création, juste en dessous.',
          alerte: false,
        });
        onVideoLancee?.();
        return;
      }
      if (r.sorte === 'deja_prete') {
        setChaine({
          sorte: 'dit', texte: 'Ta vidéo est déjà prête, juste en dessous.', alerte: false,
        });
        onVideoLancee?.();
        return;
      }
      if (r.sorte === 'deja_en_cours') {
        setChaine({
          sorte: 'dit', texte: 'Une création est déjà en cours pour ce montage.', alerte: false,
        });
        onVideoLancee?.();
        return;
      }
      setChaine({ sorte: 'dit', texte: r.message, alerte: true });
    } finally {
      verrouRef.current = false;
    }
  }, [generation?.id, montage?.format, montage?.dureeSecondes, audio, onVideoLancee]);

  if (chargement) return null;

  const candidats = generation?.candidats ?? [];
  const aReussi = generation?.etat === 'reussie';

  const compacte = variante === 'compacte';

  return (
    <section className="space-y-1.5" data-analyse-section="passages" data-passages-variante={variante}>
      {/* ⚠️ EN COMPACTE, L'EN-TETE NE S'AFFICHE QUE TANT QU'IL RESTE UNE
          DECISION A PRENDRE : sans passage, le bouton EST le chemin. Une fois
          les passages trouves, ni le compte ni « Chercher a nouveau » ne
          servent au geste suivant — ils partent dans le tiroir. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          compacte && candidats.length > 0 ? 'hidden' : ''}`}
      >
        <h4 className="text-[10px] uppercase tracking-wide text-gray-500">
          {/* Le compte est l'information utile : « analyse terminée » ne dit
              pas s'il y a de quoi monter une vidéo. */}
          Passages suggérés
          {candidats.length > 0 && (
            <span className="ml-1 text-gray-400" data-passages-compte>
              · {candidats.length} trouvé{candidats.length > 1 ? 's' : ''}
            </span>
          )}
        </h4>
        {!indisponible && (
          <button
            type="button"
            onClick={chercher}
            disabled={demande}
            data-passages-bouton
            className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 hover:bg-gray-700 disabled:opacity-50"
          >
            {demande
              ? 'Recherche…'
              : candidats.length > 0
                ? 'Chercher à nouveau'
                : 'Trouver les meilleurs passages'}
          </button>
        )}
      </div>

      {/* ── Pas installé : on le dit, on ne fabrique pas un faux succès ─── */}
      {indisponible && (
        <p className="text-[10px] text-gray-500 leading-relaxed" data-passages-indisponible>
          {indisponible}
        </p>
      )}

      {erreur && (
        <p className="text-[10px] text-amber-400/80 leading-relaxed" data-passages-erreur>
          {erreur}
        </p>
      )}

      {!indisponible && !erreur && candidats.length === 0 && (
        <p className="text-[10px] text-gray-500 leading-relaxed" data-passages-vide>
          Aucun passage proposé pour l’instant.
        </p>
      )}

      {candidats.length > 0 && !compacte && (
        <ul className="space-y-1" data-passages-liste>
          {candidats.map((c) => (
            <li
              key={`${c.rang}-${c.secondeReference}`}
              className="rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5"
              data-passage-rang={c.rang}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[11px] text-gray-200">
                  <span className="text-gray-500">#{c.rang}</span>{' '}
                  {formaterInstant(c.debutSecondes)} → {formaterInstant(c.finSecondes)}
                </span>
                <span className="text-[10px] text-gray-400">{c.scoreMontage}/100</span>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400 leading-relaxed">{c.raison}</p>
            </li>
          ))}
        </ul>
      )}

      {/* ── CRÉER MA VIDÉO ────────────────────────────────────────────
          Ici, et pas ailleurs : c'est l'écran où le jeu de passages existe,
          et c'est de LUI que part la chaîne. Le poser au niveau de la session
          obligerait à retrouver quel jeu utiliser — une décision que personne
          n'a prise. */}
      {compacte && candidats.length > 0 && onVoirAnalyse && (
        <button
          type="button"
          onClick={onVoirAnalyse}
          data-passages-voir
          className="text-[11px] text-gray-500 underline underline-offset-2
            hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-purple-500 rounded transition-colors"
        >
          {candidats.length} passage{candidats.length > 1 ? 's' : ''} suggéré{candidats.length > 1 ? 's' : ''} — voir l’analyse
        </button>
      )}

      {candidats.length > 0 && (
        <div className="space-y-2" data-chaine>
          {/* ⚠️ AVANT LE BOUTON, ET DANS LA MEME COLONNE. L'apercu colle a
              droite reste ce qu'il est : ce lot n'ajoute aucun second
              apercu, et ne touche pas a celui qui existe. */}
          <ReglagesAudio
            valeur={audio}
            onChange={setAudio}
            onEnregistrerDefaut={onEnregistrerAudioDefaut}
            desactive={chaine.sorte === 'encours'}
          />
          {/* ⚠️ LA PROGRESSION REMPLACE UNE PHRASE UNIQUE. « Découpage des
              meilleurs passages… » ne disait ni combien d'étapes restaient,
              ni si quelque chose avançait encore. Les étapes, elles, sont
              celles que la chaîne et le moteur annoncent vraiment. */}
          {chaine.sorte === 'encours' && <EtapesCreation jalon={chaine.etape} />}
          <button
            type="button"
            onClick={creer}
            disabled={chaine.sorte === 'encours'}
            data-chaine-bouton
            data-chaine-etat={chaine.sorte}
            className="w-full min-h-[36px] rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
          >
            {chaine.sorte === 'encours'
              ? phraseChaine(chaine.etape)
              : 'Créer ma vidéo'}
          </button>
          {chaine.sorte === 'dit' && (
            <p
              className={`text-[10px] leading-relaxed ${chaine.alerte ? 'text-amber-400/80' : 'text-gray-400'}`}
              data-chaine-message
            >
              {chaine.texte}
            </p>
          )}
        </div>
      )}

      {/* Le modèle qui a proposé, quand il est connu. Jamais deviné. */}
      {aReussi && !compacte && generation?.modele && (
        <p className="text-[9px] text-gray-600" data-passages-modele>
          Proposé par {generation.modele}.
        </p>
      )}
    </section>
  );
}

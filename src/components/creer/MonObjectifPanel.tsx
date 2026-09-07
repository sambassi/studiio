'use client';

import {
  useCallback, useEffect, useMemo, useState, type KeyboardEvent,
} from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronUp, Loader2, Target } from 'lucide-react';
import {
  OBJECTIF_DEFAUT, TYPE_OBJECTIF_GENERIQUE, TYPES_OBJECTIF,
  TEXTE_COURT_MAX, TEXTE_LONG_MAX,
  estObjectifGenerique, normaliserObjectif,
  type ObjectifCommunication, type PreuveSouhaitee, type PrioriteNarrative,
  type TypeObjectif,
} from '@/lib/autopilot/analyse/objectif-communication';
import {
  POLITIQUES_PREUVE, POLITIQUES_PRIORITE, objectifPeutChangerLeMontage,
} from '@/lib/autopilot/analyse/objectif-score';

/**
 * LOT 2B ÉTAPE 4E — « MON OBJECTIF », EN TROIS QUESTIONS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUE CETTE REFONTE CORRIGE, ET POURQUOI CE N'ÉTAIT PAS COSMÉTIQUE
 * ---------------------------------------------------------------------------
 *
 * L'écran précédent posait TOUTES les questions en même temps : quinze types,
 * sept priorités, quatre preuves, trois champs libres, et deux gros boutons
 * concurrents. Deux paires de contrôles s'y ressemblaient au point d'être
 * interchangeables à l'œil :
 *
 *   • la tuile de TYPE « Mettre en avant un témoignage »
 *     et la case de PREUVE « Un témoignage » ;
 *   • « Pour cette vidéo seulement »
 *     et « Enregistrer comme mon objectif par défaut ».
 *
 * Mesuré en production le 2026-09-07 : l'utilisateur voulait un montage
 * témoignage pour UNE vidéo. Il a coché la preuve au lieu de choisir le type,
 * puis appuyé sur le bouton violet. Résultat — son objectif par défaut est
 * devenu `evenement + preuve temoignage`, et le montage n'a pas bougé d'un
 * pixel, parce que ces poids-là additionnés laissaient le classement
 * inchangé. Deux erreurs, aucun message : l'écran avait l'air d'avoir obéi.
 *
 * D'où trois règles, tenues par ce fichier :
 *
 *   1. UNE décision par étape. Le type d'abord ; ce qu'on privilégie ensuite,
 *      et seulement ce qui a du sens pour le type choisi ; l'application en
 *      dernier, sur un résumé qu'on relit.
 *   2. AUCUN doublon de sens à l'écran. Une preuve dont le critère est déjà
 *      porté par le type — ou par une priorité du même nom — n'est pas
 *      proposée. Voir `optionsContexte`.
 *   3. UN SEUL bouton d'action, et il ne touche QUE la vidéo en cours. Le
 *      défaut du compte se change par une case à cocher, décochée d'office,
 *      posée sous le bouton et écrite en toutes lettres.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LES LIBELLÉS SONT DE L'AFFICHAGE, LES IDENTIFIANTS SONT LA VÉRITÉ
 * ---------------------------------------------------------------------------
 *
 * `LIBELLES_TYPE` traduit les identifiants du catalogue serveur ; il n'en
 * invente aucun, et un test vérifie que les deux listes coïncident exactement.
 * Le jour où un type serait ajouté au contrat sans libellé, il apparaîtrait
 * ici sous son identifiant plutôt que de disparaître de l'écran — un réglage
 * invisible est pire qu'un réglage mal nommé.
 *
 * ⚠️ AUCUNE DONNÉE MÉTIER N'A CHANGÉ dans ce lot. Mêmes identifiants, mêmes
 * champs, mêmes routes, même scoring. Seule la façon de les demander change.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUNE DONNÉE TECHNIQUE N'EST MONTRÉE
 * ---------------------------------------------------------------------------
 *
 * Ni `objectiveScore`, ni `m3g-v3`, ni couverture de signaux, ni empreinte.
 * Ces valeurs existent, elles sont relevées dans `usage` pour qu'on puisse
 * répondre « pourquoi ce passage ? » — mais un écran qui les affiche demande
 * à l'utilisateur de comprendre un moteur au lieu de décrire son intention.
 */

/**
 * Les libellés français, un par identifiant du catalogue.
 *
 * ⚠️ `Record<TypeObjectif, string>` — DONC EXHAUSTIF PAR CONSTRUCTION. Ajouter
 * un type au contrat sans libellé ne compilerait pas.
 */
const LIBELLES_TYPE: Record<TypeObjectif, string> = {
  evenement: 'Promouvoir un événement',
  produit: 'Présenter un produit',
  service: 'Promouvoir un service',
  notoriete: 'Développer ma notoriété',
  abonnes: 'Gagner des abonnés',
  inscriptions: 'Obtenir des inscriptions',
  reservations: 'Obtenir des réservations',
  leads: 'Générer des prospects',
  ventes: 'Générer des ventes',
  offre: 'Promouvoir une offre',
  temoignage: 'Mettre en avant un témoignage',
  education: 'Éduquer / expliquer',
  engagement: 'Créer de l’engagement',
  coulisses: 'Montrer les coulisses',
  personnalise: 'Objectif personnalisé',
};

/**
 * Les six premiers, visibles d'emblée. Les neuf autres derrière « Voir plus ».
 *
 * ⚠️ UN ORDRE D'AFFICHAGE, ET RIEN DE PLUS. Aucune logique serveur ne le lit :
 * ce sont les mêmes identifiants, dans un ordre qui met devant ceux que
 * l'analyse sait aujourd'hui distinguer à l'image. Quinze cases d'un coup se
 * lisent comme un formulaire administratif ; six se lisent comme une question.
 */
const TYPES_EN_AVANT: readonly TypeObjectif[] = [
  'evenement', 'offre', 'produit', 'service', 'reservations', 'temoignage',
];

/** Les priorités narratives que le moteur sait réellement lire aujourd'hui. */
const PRIORITES_UTILES = Object.keys(POLITIQUES_PRIORITE) as PrioriteNarrative[];
/** Les preuves souhaitées que l'analyse sait réellement reconnaître. */
const PREUVES_UTILES = Object.keys(POLITIQUES_PREUVE) as PreuveSouhaitee[];

const LIBELLES_PRIORITE: Partial<Record<PrioriteNarrative, string>> = {
  foule: 'Du monde, de l’ambiance',
  produit: 'Le produit bien visible',
  demonstration: 'Une démonstration, des gestes',
  identite: 'Ma marque bien visible',
  personnalite: 'Une personne, un visage',
  information: 'De l’information claire',
  pedagogie: 'Des explications parlées',
};

const LIBELLES_PREUVE: Partial<Record<PreuveSouhaitee, string>> = {
  temoignage: 'Quelqu’un qui témoigne',
  foule: 'Du monde',
  demonstration: 'Une démonstration',
  chiffres: 'Des chiffres à l’écran',
};

// ---------------------------------------------------------------------------
// L'étape 2 — ce qu'on privilégie, et RIEN qui fasse doublon
// ---------------------------------------------------------------------------

/**
 * Une option de l'étape 2 : un champ du contrat, une valeur, un libellé.
 *
 * ⚠️ LA CLÉ PORTE LE CHAMP. `foule` existe à la fois comme priorité et comme
 * preuve : sans préfixe, deux options différentes auraient la même clé React
 * et le même `data-`, et un test ne saurait plus laquelle il coche.
 */
interface OptionContexte {
  champ: 'priorite' | 'preuve';
  valeur: PrioriteNarrative | PreuveSouhaitee;
  libelle: string;
}

const cleOption = (champ: 'priorite' | 'preuve', valeur: string) => `${champ}:${valeur}`;

const CATALOGUE_CONTEXTE: Record<string, OptionContexte> = {
  ...Object.fromEntries(PRIORITES_UTILES.map((v) => [
    cleOption('priorite', v),
    { champ: 'priorite' as const, valeur: v, libelle: LIBELLES_PRIORITE[v] ?? v },
  ])),
  ...Object.fromEntries(PREUVES_UTILES.map((v) => [
    cleOption('preuve', v),
    { champ: 'preuve' as const, valeur: v, libelle: LIBELLES_PREUVE[v] ?? v },
  ])),
};

/**
 * Les deux ou trois options qui comptent, POUR CE TYPE, mises en avant.
 *
 * ⚠️ CE N'EST PAS UN FILTRE DE SÉCURITÉ, c'est un ordre de lecture : tout ce
 * qui n'est pas ici reste atteignable derrière « Voir plus ». Rien du contrat
 * n'est retiré à l'utilisateur — on cesse seulement de tout lui montrer à la
 * fois.
 */
const CONTEXTE_PAR_TYPE: Partial<Record<TypeObjectif, readonly string[]>> = {
  evenement: ['priorite:foule', 'priorite:personnalite', 'priorite:identite'],
  temoignage: ['priorite:personnalite', 'priorite:pedagogie', 'priorite:identite'],
  produit: ['priorite:produit', 'priorite:demonstration', 'preuve:chiffres'],
  service: ['priorite:demonstration', 'priorite:personnalite', 'priorite:identite'],
  offre: ['preuve:chiffres', 'priorite:produit', 'priorite:identite'],
  ventes: ['priorite:produit', 'preuve:chiffres', 'priorite:identite'],
  notoriete: ['priorite:identite', 'priorite:foule', 'priorite:personnalite'],
  education: ['priorite:pedagogie', 'priorite:information', 'priorite:personnalite'],
  coulisses: ['priorite:demonstration', 'priorite:personnalite', 'priorite:identite'],
  abonnes: ['priorite:personnalite', 'priorite:identite', 'priorite:foule'],
  inscriptions: ['priorite:foule', 'priorite:personnalite', 'preuve:chiffres'],
  reservations: ['priorite:foule', 'priorite:personnalite', 'preuve:chiffres'],
  leads: ['priorite:information', 'preuve:chiffres', 'priorite:identite'],
  engagement: ['priorite:personnalite', 'priorite:foule', 'priorite:identite'],
  personnalise: ['priorite:personnalite', 'priorite:foule', 'priorite:produit'],
};

/**
 * Les options que le TYPE choisi rend redondantes — donc jamais affichées.
 *
 * ⚠️ C'EST LA RÈGLE QUI A COÛTÉ UN OBJECTIF DE COMPTE. « Mettre en avant un
 * témoignage » et « Un témoignage » disaient la même chose à un mot près, et
 * la seconde était une case anodine à côté d'une tuile qui, elle, changeait
 * tout. Choisir le type témoignage retire donc la preuve témoignage de
 * l'écran : il n'y a plus deux façons de dire la même intention.
 */
const REDONDANT_AVEC_TYPE: Partial<Record<TypeObjectif, readonly string[]>> = {
  temoignage: ['preuve:temoignage'],
};

/**
 * Les options réellement affichables pour un type, en avant puis en secondaire.
 *
 * ⚠️ UNE PREUVE DONT LA PRIORITÉ HOMONYME EXISTE N'EST JAMAIS PROPOSÉE.
 * `POLITIQUES_PREUVE.foule` et `POLITIQUES_PRIORITE.foule` portent le MÊME
 * critère avec le MÊME poids (`groupe_visible: 3`) ; idem pour
 * `demonstration`. Deux contrôles au libellé quasi identique pour un effet
 * strictement identique, c'est exactement la confusion que ce lot ferme. Les
 * valeurs déjà enregistrées sur un compte ne sont jamais retirées : le
 * brouillon les conserve, seul l'écran cesse de les proposer.
 */
function optionsContexte(type: ObjectifCommunication['type']): {
  avant: string[]; secondaires: string[];
} {
  if (type === TYPE_OBJECTIF_GENERIQUE) return { avant: [], secondaires: [] };
  const exclues = new Set(REDONDANT_AVEC_TYPE[type as TypeObjectif] ?? []);
  const avant = (CONTEXTE_PAR_TYPE[type as TypeObjectif] ?? [])
    .filter((c) => !exclues.has(c) && CATALOGUE_CONTEXTE[c]);
  const misEnAvant = new Set(avant);
  const secondaires = Object.keys(CATALOGUE_CONTEXTE).filter((c) => {
    if (misEnAvant.has(c) || exclues.has(c)) return false;
    const o = CATALOGUE_CONTEXTE[c];
    if (o.champ === 'preuve' && CATALOGUE_CONTEXTE[cleOption('priorite', o.valeur)]) {
      return false;
    }
    return true;
  });
  return { avant, secondaires };
}

/**
 * Les champs de contexte à montrer, selon le type choisi.
 *
 * ⚠️ ILS SONT DESCRIPTIFS, ET LE PANNEAU LE DIT. Ces textes nourriront un
 * jour l'écriture des accroches ; ils ne pèsent RIEN sur le choix des
 * passages, et le contrat de `objectif-score` ne les lit même pas. Laisser
 * croire le contraire ferait écrire des consignes à un moteur qui ne les lit
 * pas. Ils vivent donc derrière un dépliant, après la vraie question.
 */
type ChampLibre = 'objectifPrincipal' | 'contexte' | 'messagePrincipal';

const CHAMPS_PAR_TYPE: Partial<Record<TypeObjectif, readonly ChampLibre[]>> = {
  evenement: ['contexte', 'messagePrincipal'],
  produit: ['objectifPrincipal', 'messagePrincipal'],
  service: ['objectifPrincipal', 'messagePrincipal'],
  offre: ['objectifPrincipal', 'messagePrincipal'],
  ventes: ['objectifPrincipal', 'messagePrincipal'],
  temoignage: ['messagePrincipal'],
  education: ['messagePrincipal'],
  personnalise: ['objectifPrincipal', 'contexte', 'messagePrincipal'],
};

const LIBELLES_CHAMP: Record<ChampLibre, { titre: string; exemple: string; long: boolean }> = {
  objectifPrincipal: {
    titre: 'Ce que tu veux obtenir',
    exemple: 'Ex. faire connaître ma nouvelle formule',
    long: false,
  },
  contexte: {
    titre: 'Le contexte',
    exemple: 'Ex. soirée d’ouverture, samedi, salle comble',
    long: true,
  },
  messagePrincipal: {
    titre: 'Le message à retenir',
    exemple: 'Ex. « Réserve ta place »',
    long: false,
  },
};

const ETAPES = [
  { n: 1 as const, titre: 'Objectif' },
  { n: 2 as const, titre: 'Priorités' },
  { n: 3 as const, titre: 'Confirmation' },
];
type Etape = (typeof ETAPES)[number]['n'];

const QUESTIONS: Record<Etape, string> = {
  1: 'Quel est le but de cette vidéo ?',
  2: 'Que veux-tu privilégier ?',
  3: 'Vérifier et appliquer',
};

/** Le nom lisible d'un objectif, jamais son identifiant brut si on l'a. */
function nommer(o: ObjectifCommunication | null): string {
  if (!o || estObjectifGenerique(o)) return 'Objectif général';
  return LIBELLES_TYPE[o.type as TypeObjectif] ?? String(o.type);
}

const CADRE_CHOIX = 'flex min-h-[44px] items-center rounded-lg border px-2.5 py-2 text-left'
  + ' transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';
const CHOISI = 'border-purple-500/50 bg-gray-800';
const NON_CHOISI = 'border-gray-800 hover:border-gray-700';

export interface MonObjectifPanelProps {
  /** L'objectif du compte, ou `null` s'il n'en a jamais déclaré. */
  objectifEnregistre: ObjectifCommunication | null;
  chargement: boolean;
  /** Le geste EXPLICITE qui change le défaut du compte. */
  onEnregistrerDefaut: (objectif: ObjectifCommunication) => Promise<boolean>;
  /** L'objectif de la seule vidéo en cours. N'écrit rien côté compte. */
  onAppliquerACetteVideo?: (objectif: ObjectifCommunication | null) => void;
  /**
   * L'objectif DÉJÀ appliqué à la vidéo en cours, s'il y en a un.
   *
   * ⚠️ IL SERT À LES DISTINGUER À L'ŒIL. Sans lui, le résumé ne pouvait
   * afficher que le défaut du compte — et un utilisateur qui venait
   * d'appliquer un objectif à sa vidéo lisait, en gros, l'objectif de toutes
   * les AUTRES. C'est ce qui rendait les deux notions confondables.
   */
  objectifCetteVideo?: ObjectifCommunication | null;
}

export default function MonObjectifPanel({
  objectifEnregistre, chargement, onEnregistrerDefaut, onAppliquerACetteVideo,
  objectifCetteVideo = null,
}: MonObjectifPanelProps) {
  const [ouvert, setOuvert] = useState(false);
  const [etape, setEtape] = useState<Etape>(1);
  const [voirTout, setVoirTout] = useState(false);
  const [voirPlusContexte, setVoirPlusContexte] = useState(false);
  const [voirMessage, setVoirMessage] = useState(false);
  const [aussiDefaut, setAussiDefaut] = useState(false);
  const [brouillon, setBrouillon] = useState<ObjectifCommunication>(
    objectifCetteVideo ?? objectifEnregistre ?? { ...OBJECTIF_DEFAUT },
  );
  const [enregistrement, setEnregistrement] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [appliqueVideo, setAppliqueVideo] = useState(false);

  const signature = JSON.stringify(objectifEnregistre ?? null);
  useEffect(() => {
    setBrouillon(objectifEnregistre ?? { ...OBJECTIF_DEFAUT });
    setEnregistre(false);
    setAppliqueVideo(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const modifier = useCallback((patch: Partial<ObjectifCommunication>) => {
    setEnregistre(false);
    setAppliqueVideo(false);
    // ⚠️ RENORMALISE A CHAQUE TOUCHE, comme « Mon style ». L'écran ne peut
    // donc pas fabriquer un état que le serveur refuserait.
    setBrouillon((c) => normaliserObjectif({ ...c, ...patch }));
  }, []);

  const aUnObjectif = objectifEnregistre !== null && !estObjectifGenerique(objectifEnregistre);
  const aUnObjectifVideo = objectifCetteVideo !== null
    && !estObjectifGenerique(objectifCetteVideo);
  const typeChoisi = brouillon.type;
  const champs = CHAMPS_PAR_TYPE[typeChoisi as TypeObjectif] ?? [];
  const brouillonGenerique = estObjectifGenerique(brouillon);
  /** Le panneau pilote-t-il une vidéo, ou seulement le réglage du compte ? */
  const pourUneVideo = typeof onAppliquerACetteVideo === 'function';

  /**
   * Ce type sait-il, aujourd'hui, changer le choix des passages ?
   *
   * ⚠️ DIT HONNÊTEMENT, PLUTÔT QUE PROMIS. `inscriptions`, `réservations`,
   * `prospects` et `abonnés` sont de vraies intentions — mais rien, dans une
   * image, ne les distingue les unes des autres. Le montage sera le même ;
   * l'écran le dit au lieu de laisser espérer un effet qui ne viendra pas.
   */
  const agitSurLeMontage = useMemo(
    () => objectifPeutChangerLeMontage(brouillon), [brouillon],
  );

  const visibles = voirTout
    ? (TYPES_OBJECTIF as readonly TypeObjectif[])
    : TYPES_EN_AVANT;

  const { avant, secondaires } = useMemo(
    () => optionsContexte(typeChoisi), [typeChoisi],
  );

  const optionActive = useCallback((cle: string) => {
    const o = CATALOGUE_CONTEXTE[cle];
    if (!o) return false;
    return o.champ === 'priorite'
      ? brouillon.priorites.includes(o.valeur as PrioriteNarrative)
      : brouillon.preuveSouhaitee.includes(o.valeur as PreuveSouhaitee);
  }, [brouillon.priorites, brouillon.preuveSouhaitee]);

  const basculerOption = useCallback((cle: string) => {
    const o = CATALOGUE_CONTEXTE[cle];
    if (!o) return;
    const bascule = <T extends string>(liste: readonly T[], valeur: T): T[] => (
      liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur]
    );
    if (o.champ === 'priorite') {
      modifier({ priorites: bascule(brouillon.priorites, o.valeur as PrioriteNarrative) });
    } else {
      modifier({
        preuveSouhaitee: bascule(brouillon.preuveSouhaitee, o.valeur as PreuveSouhaitee),
      });
    }
  }, [brouillon.priorites, brouillon.preuveSouhaitee, modifier]);

  const fermer = useCallback(() => {
    // ⚠️ FERMER N'ÉCRIT RIEN, NI POUR LA VIDÉO NI POUR LE COMPTE. Le brouillon
    // survit en mémoire — c'est un confort local, pas une mutation.
    setOuvert(false);
    setEtape(1);
  }, []);

  const surTouche = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
  }, [fermer]);

  /**
   * L'action principale — ET LA SEULE.
   *
   * ⚠️ L'ORDRE COMPTE. La vidéo d'abord, le compte ensuite et seulement si la
   * case est cochée : si l'écriture du défaut échoue, l'objectif de la vidéo
   * en cours a malgré tout été appliqué, et l'utilisateur n'a pas perdu son
   * geste. L'inverse aurait fait dépendre une action locale d'un aller-retour
   * réseau.
   */
  const appliquer = useCallback(async () => {
    const pourLeServeur = brouillonGenerique ? null : brouillon;
    if (pourUneVideo) onAppliquerACetteVideo?.(pourLeServeur);
    setAppliqueVideo(true);
    if (aussiDefaut || !pourUneVideo) {
      setEnregistrement(true);
      try {
        setEnregistre(await onEnregistrerDefaut(brouillon));
      } finally {
        setEnregistrement(false);
      }
    }
    setOuvert(false);
    setEtape(1);
  }, [
    aussiDefaut, brouillon, brouillonGenerique, onAppliquerACetteVideo,
    onEnregistrerDefaut, pourUneVideo,
  ]);

  return (
    <div className="pt-3 border-t border-gray-800" data-mon-objectif>
      {/* ══ LE RÉSUMÉ — DEUX LIGNES QU'ON NE PEUT PLUS CONFONDRE ═══════════
          La vidéo en cours EN HAUT et en clair ; le défaut du compte en
          dessous, en gris, annoncé comme tel. L'écran précédent n'affichait
          que la seconde, ce qui la faisait lire comme la première. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-purple-400 shrink-0" aria-hidden="true" />
            <p className="text-xs font-medium text-gray-300">
              {pourUneVideo ? 'Objectif de cette vidéo' : 'Objectif'}
            </p>
            {chargement ? (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" aria-hidden="true" />
            ) : pourUneVideo ? (
              <span
                data-mon-objectif-video={aUnObjectifVideo ? 'personnel' : 'defaut'}
                className={`truncate text-[11px] ${
                  aUnObjectifVideo ? 'text-purple-300' : 'text-gray-400'}`}
              >
                {aUnObjectifVideo ? nommer(objectifCetteVideo) : nommer(objectifEnregistre)}
              </span>
            ) : (
              <span
                data-mon-objectif-etat={aUnObjectif ? 'personnel' : 'defaut'}
                className={`truncate text-[11px] ${
                  aUnObjectif ? 'text-purple-300' : 'text-gray-400'}`}
              >
                {nommer(objectifEnregistre)}
              </span>
            )}
            {aUnObjectifVideo && (
              <Check className="w-3 h-3 text-purple-400 shrink-0" aria-hidden="true" />
            )}
          </div>
          {pourUneVideo && (
            <p className="pl-5 text-[10px] text-gray-400">
              Objectif par défaut&nbsp;:{' '}
              <span data-mon-objectif-etat={aUnObjectif ? 'personnel' : 'defaut'}>
                {nommer(objectifEnregistre)}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => (ouvert ? fermer() : setOuvert(true))}
          aria-expanded={ouvert}
          data-mon-objectif-toggle
          // ⚠️ `min-h-[44px]`, MESURE AU BANC CHROMIUM ET NON DEVINEE.
          //
          // Le padding seul donnait 28 px : au-dessus des 19 px qu'un lot
          // precedent avait laisses passer, mais toujours sous le seuil ou
          // un doigt vise sans rater. Le texte reste a 11 px — c'est la
          // CIBLE qui grandit, pas le libelle.
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-gray-800
            px-2.5 py-1.5 text-[11px] text-gray-300 transition-colors hover:border-gray-700
            hover:text-white focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-purple-500"
        >
          {ouvert ? <ChevronUp className="w-3 h-3" aria-hidden="true" />
            : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
          {ouvert ? 'Fermer' : (aUnObjectifVideo || aUnObjectif) ? 'Modifier' : 'Configurer'}
        </button>
      </div>

      {!ouvert && (
        <p className="mt-1.5 text-[11px] text-gray-400" data-mon-objectif-resume>
          {appliqueVideo && pourUneVideo
            ? 'Appliqué à cette vidéo.'
            : aUnObjectif
              ? 'Utilisé automatiquement pour tes prochaines vidéos.'
              : 'Dis-le une fois : tes prochaines vidéos s’y adapteront.'}
        </p>
      )}

      {ouvert && (
        <div className="mt-3 space-y-4" onKeyDown={surTouche} data-mon-objectif-wizard>
          {/* ══ LA PROGRESSION ═════════════════════════════════════════════
              Trois pastilles et un titre. Sur 375 px, les libellés des étapes
              non courantes disparaissent : le numéro suffit à situer, et rien
              ne déborde. */}
          <ol className="flex items-center gap-1.5" data-mon-objectif-etape={etape}>
            {ETAPES.map((e, i) => {
              const courante = e.n === etape;
              const faite = e.n < etape;
              return (
                <li key={e.n} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span aria-hidden="true" className="text-gray-700">›</span>}
                  <button
                    type="button"
                    // ⚠️ ON NE SAUTE PAS EN AVANT. Revenir sur une étape déjà
                    // franchie est une correction ; aller au-delà serait
                    // valider des questions qu'on n'a pas posées.
                    disabled={!faite}
                    onClick={() => setEtape(e.n)}
                    aria-current={courante ? 'step' : undefined}
                    data-mon-objectif-jalon={e.n}
                    className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-2 py-1
                      text-[10px] transition-colors focus-visible:outline-none
                      focus-visible:ring-2 focus-visible:ring-purple-500 ${
                      courante ? 'bg-gray-800 text-gray-100'
                        : faite ? 'text-purple-300 hover:text-purple-200' : 'text-gray-400'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center
                      rounded-full text-[10px] ${
                      courante || faite ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                      {e.n}
                    </span>
                    <span className={courante ? 'truncate' : 'hidden truncate sm:inline'}>
                      {e.titre}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <p className="text-[11px] font-medium text-gray-300" data-mon-objectif-question>
            {QUESTIONS[etape]}
          </p>

          {/* ══ ÉTAPE 1 — LE BUT ═══════════════════════════════════════════ */}
          {etape === 1 && (
            <section className="space-y-1.5">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {visibles.map((t) => (
                  <button
                    key={t}
                    type="button"
                    data-mon-objectif-type={t}
                    aria-pressed={typeChoisi === t}
                    onClick={() => modifier({ type: t })}
                    className={`${CADRE_CHOIX} ${typeChoisi === t ? CHOISI : NON_CHOISI}`}
                  >
                    <span className="block text-[11px] font-medium text-gray-200">
                      {LIBELLES_TYPE[t] ?? t}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  data-mon-objectif-type={TYPE_OBJECTIF_GENERIQUE}
                  aria-pressed={typeChoisi === TYPE_OBJECTIF_GENERIQUE}
                  onClick={() => modifier({ type: TYPE_OBJECTIF_GENERIQUE })}
                  className={`${CADRE_CHOIX} ${
                    typeChoisi === TYPE_OBJECTIF_GENERIQUE ? CHOISI : NON_CHOISI}`}
                >
                  <span className="block text-[11px] font-medium text-gray-200">
                    Aucun objectif particulier
                  </span>
                </button>
              </div>
              {!voirTout && (
                <button
                  type="button"
                  data-mon-objectif-voir-tout
                  onClick={() => setVoirTout(true)}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-2 py-2 text-left
                    text-[11px] text-purple-300 transition-colors hover:text-purple-200
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500
                    md:w-auto"
                >
                  Voir plus d’objectifs
                </button>
              )}
              {!brouillonGenerique && (
                <p
                  data-mon-objectif-effet={agitSurLeMontage ? 'montage' : 'aucun'}
                  className="text-[11px] text-gray-400"
                >
                  {agitSurLeMontage
                    ? 'Les passages seront choisis en fonction de cet objectif.'
                    : 'Cet objectif est enregistré, mais il ne change pas encore le choix des passages.'}
                </p>
              )}
            </section>
          )}

          {/* ══ ÉTAPE 2 — CE QU'ON PRIVILÉGIE, ET LE MESSAGE EN OPTION ═════ */}
          {etape === 2 && (
            <section className="space-y-3">
              {brouillonGenerique ? (
                <p className="text-[11px] text-gray-400" data-mon-objectif-sans-priorite>
                  Sans objectif particulier, il n’y a rien à privilégier :
                  Studiio garde son montage habituel.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {avant.map((cle) => {
                      const o = CATALOGUE_CONTEXTE[cle];
                      const actif = optionActive(cle);
                      return (
                        <button
                          key={cle}
                          type="button"
                          data-mon-objectif-option={cle}
                          {...(o.champ === 'priorite'
                            ? { 'data-mon-objectif-priorite': o.valeur }
                            : { 'data-mon-objectif-preuve': o.valeur })}
                          aria-pressed={actif}
                          onClick={() => basculerOption(cle)}
                          className={`${CADRE_CHOIX} text-[11px] ${
                            actif ? `${CHOISI} text-gray-200` : `${NON_CHOISI} text-gray-400`}`}
                        >
                          {o.libelle}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Facultatif. Sans rien cocher, Studiio s’en tient à ton objectif.
                  </p>

                  {/* ── LES DEUX ACTIONS SECONDAIRES, EMPILEES SOUS 768 PX ──
                      ⚠️ MESURE, PAS SUPPOSITION. Sans conteneur, deux
                      `<button>` restent des elements en ligne : ils se
                      posaient sur la MEME ligne a toutes les largeurs — 320
                      px compris — bord a bord, zero pixel entre eux, et 40 px
                      de haut. Deux cibles collees sous le seuil tactile, la
                      ou l'on croyait deux liens distincts. */}
                  {((secondaires.length > 0 && !voirPlusContexte)
                    || (champs.length > 0 && !voirMessage)) && (
                    <div
                      data-mon-objectif-actions-secondaires
                      className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3"
                    >
                      {secondaires.length > 0 && !voirPlusContexte && (
                        <button
                          type="button"
                          data-mon-objectif-voir-plus-contexte
                          onClick={() => setVoirPlusContexte(true)}
                          className="flex min-h-[44px] w-full items-center rounded-lg px-2 py-2
                            text-left text-[11px] text-purple-300 transition-colors
                            hover:text-purple-200 focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-purple-500 md:w-auto"
                        >
                          Voir plus de priorités
                        </button>
                      )}
                      {champs.length > 0 && !voirMessage && (
                        <button
                          type="button"
                          data-mon-objectif-voir-message
                          onClick={() => setVoirMessage(true)}
                          className="flex min-h-[44px] w-full items-center rounded-lg px-2 py-2
                            text-left text-[11px] text-gray-400 transition-colors
                            hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2
                            focus-visible:ring-purple-500 md:w-auto"
                        >
                          + Ajouter un message
                        </button>
                      )}
                    </div>
                  )}
                  {voirPlusContexte && secondaires.length > 0 && (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {secondaires.map((cle) => {
                        const o = CATALOGUE_CONTEXTE[cle];
                        const actif = optionActive(cle);
                        return (
                          <button
                            key={cle}
                            type="button"
                            data-mon-objectif-option={cle}
                            {...(o.champ === 'priorite'
                              ? { 'data-mon-objectif-priorite': o.valeur }
                              : { 'data-mon-objectif-preuve': o.valeur })}
                            aria-pressed={actif}
                            onClick={() => basculerOption(cle)}
                            className={`${CADRE_CHOIX} text-[11px] ${
                              actif ? `${CHOISI} text-gray-200` : `${NON_CHOISI} text-gray-400`}`}
                          >
                            {o.libelle}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* ── LE MESSAGE — APRÈS, ET REPLIÉ ───────────────────── */}
                  {champs.length > 0 && voirMessage && (
                    <div className="space-y-2">
                      {champs.map((c) => {
                        const l = LIBELLES_CHAMP[c];
                        return (
                          <label key={c} className="block text-[11px] text-gray-400">
                            {l.titre}
                            <input
                              type="text"
                              data-mon-objectif-champ={c}
                              value={brouillon[c] ?? ''}
                              maxLength={l.long ? TEXTE_LONG_MAX : TEXTE_COURT_MAX}
                              placeholder={l.exemple}
                              onChange={(e) => modifier({ [c]: e.target.value || null } as never)}
                              className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-900
                                px-2 py-2 text-[11px] text-gray-200 placeholder:text-gray-500
                                focus:border-purple-500/50 focus:outline-none"
                            />
                          </label>
                        );
                      })}
                      <p className="text-[11px] text-gray-400">
                        Ces textes servent à écrire tes accroches. Ils ne changent pas
                        le choix des passages.
                      </p>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* ══ ÉTAPE 3 — RELIRE, PUIS APPLIQUER ═══════════════════════════ */}
          {etape === 3 && (
            <section className="space-y-3" data-mon-objectif-recap>
              <dl className="space-y-2 rounded-lg border border-gray-800 bg-gray-900/40 p-2.5">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-gray-400">Objectif</dt>
                  <dd className="text-[11px] text-gray-200" data-mon-objectif-recap-type>
                    {nommer(brouillon)}
                  </dd>
                </div>
                {(brouillon.priorites.length > 0 || brouillon.preuveSouhaitee.length > 0) && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400">
                      Priorités
                    </dt>
                    <dd className="text-[11px] text-gray-200" data-mon-objectif-recap-priorites>
                      {[
                        ...brouillon.priorites.map(
                          (p) => CATALOGUE_CONTEXTE[cleOption('priorite', p)]?.libelle ?? p,
                        ),
                        ...brouillon.preuveSouhaitee.map(
                          (p) => CATALOGUE_CONTEXTE[cleOption('preuve', p)]?.libelle ?? p,
                        ),
                      ].join(' · ')}
                    </dd>
                  </div>
                )}
                {brouillon.messagePrincipal && (
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400">Message</dt>
                    <dd className="text-[11px] text-gray-200" data-mon-objectif-recap-message>
                      {brouillon.messagePrincipal}
                    </dd>
                  </div>
                )}
              </dl>

              {/* ── OÙ L'APPLIQUER ──────────────────────────────────────
                  UN bouton, UNE case. L'écran précédent posait deux boutons
                  de même taille, l'un local et l'autre définitif : le plus
                  visible des deux était celui qui engageait le compte. */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">
                  Où appliquer cet objectif ?
                </p>
                <button
                  type="button"
                  onClick={appliquer}
                  disabled={enregistrement}
                  {...(pourUneVideo
                    ? { 'data-mon-objectif-cette-video': true }
                    : { 'data-mon-objectif-enregistrer': true })}
                  className="flex min-h-[44px] w-full items-center justify-center gap-1.5
                    rounded-lg bg-purple-600 px-3 py-2.5 text-[11px] font-medium text-white
                    transition-colors hover:bg-purple-500 disabled:opacity-40
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                >
                  {enregistrement && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                  {pourUneVideo ? 'Utiliser pour cette vidéo' : 'Enregistrer comme mon objectif'}
                </button>
                {pourUneVideo && (
                  <>
                    <p className="text-[11px] text-gray-400">
                      Cela ne modifiera pas tes prochaines vidéos.
                    </p>
                    <label className="flex min-h-[44px] cursor-pointer items-start gap-2 text-[11px] text-gray-400">
                      <input
                        type="checkbox"
                        data-mon-objectif-aussi-defaut
                        checked={aussiDefaut}
                        onChange={(e) => setAussiDefaut(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-700 bg-gray-900
                          accent-purple-600 focus-visible:outline-none focus-visible:ring-2
                          focus-visible:ring-purple-500"
                      />
                      <span>
                        Utiliser aussi comme objectif par défaut
                        <span className="block text-[10px] text-gray-400">
                          Les prochaines vidéos utiliseront automatiquement cet objectif.
                        </span>
                      </span>
                    </label>
                  </>
                )}
                {enregistre && (
                  <p className="flex items-center gap-1 text-[11px] text-purple-300">
                    <Check className="w-3 h-3" aria-hidden="true" /> Objectif par défaut enregistré
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ══ LA NAVIGATION ══════════════════════════════════════════════ */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              data-mon-objectif-retour
              onClick={() => (etape === 1 ? fermer() : setEtape((n) => (n - 1) as Etape))}
              className="flex min-h-[44px] items-center gap-1 rounded-lg px-2 py-1.5 text-[11px]
                text-gray-400 transition-colors hover:text-gray-200 focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-purple-500"
            >
              <ChevronLeft className="w-3 h-3" aria-hidden="true" />
              {etape === 1 ? 'Annuler' : 'Retour'}
            </button>
            {etape < 3 && (
              <button
                type="button"
                data-mon-objectif-suivant
                onClick={() => setEtape((n) => (n + 1) as Etape)}
                className="flex min-h-[44px] items-center justify-center rounded-lg border
                  border-gray-700 px-4 py-2.5 text-[11px] font-medium text-gray-200
                  transition-colors hover:border-gray-600 hover:text-white
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                Continuer
              </button>
            )}
          </div>

          <p className="text-[11px] text-gray-400">
            Rien n’est enregistré tant que tu n’as pas appliqué.
          </p>
        </div>
      )}
    </div>
  );
}

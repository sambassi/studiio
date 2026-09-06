'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Target } from 'lucide-react';
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
 * LOT 2B ÉTAPE 4C — L'ÉCRAN « MON OBJECTIF ».
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
 * ---------------------------------------------------------------------------
 * ⚠️ « ENREGISTRER » EST UN GESTE, PAS UN EFFET DE BORD
 * ---------------------------------------------------------------------------
 *
 * Deux boutons, et la différence est écrite en toutes lettres à l'écran :
 *
 *   « Pour cette vidéo »  → l'objectif ne vaut que pour la vidéo en cours.
 *   « Enregistrer … »     → le seul geste qui change le défaut du compte.
 *
 * Rien ne part vers le serveur avant l'un des deux. Essayer un objectif sur
 * une vidéo ne redéfinit jamais l'intention de toutes les suivantes.
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
  'evenement', 'produit', 'service', 'notoriete', 'temoignage', 'education',
];

/** Les priorités narratives que le moteur sait réellement lire aujourd'hui. */
const PRIORITES_UTILES = Object.keys(POLITIQUES_PRIORITE) as PrioriteNarrative[];
/** Les preuves souhaitées que l'analyse sait réellement reconnaître. */
const PREUVES_UTILES = Object.keys(POLITIQUES_PREUVE) as PreuveSouhaitee[];

const LIBELLES_PRIORITE: Partial<Record<PrioriteNarrative, string>> = {
  foule: 'Du monde, de l’affluence',
  produit: 'Le produit bien visible',
  demonstration: 'Une démonstration',
  identite: 'Ma marque reconnaissable',
  personnalite: 'Une personne, un visage',
  information: 'De l’information claire',
  pedagogie: 'De la pédagogie',
};

const LIBELLES_PREUVE: Partial<Record<PreuveSouhaitee, string>> = {
  temoignage: 'Un témoignage',
  foule: 'Du monde',
  demonstration: 'Une démonstration',
  chiffres: 'Des chiffres à l’écran',
};

/**
 * Les champs de contexte à montrer, selon le type choisi.
 *
 * ⚠️ ILS SONT DESCRIPTIFS, ET LE PANNEAU LE DIT. Ces textes nourriront un
 * jour l'écriture des accroches ; ils ne pèsent RIEN sur le choix des
 * passages, et le contrat de `objectif-score` ne les lit même pas. Laisser
 * croire le contraire ferait écrire des consignes à un moteur qui ne les lit
 * pas.
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
    exemple: 'Ex. c’est simple, c’est rapide, c’est pour tout le monde',
    long: false,
  },
};

export interface MonObjectifPanelProps {
  /** L'objectif du compte, ou `null` s'il n'en a jamais déclaré. */
  objectifEnregistre: ObjectifCommunication | null;
  chargement: boolean;
  /** Le geste EXPLICITE qui change le défaut du compte. */
  onEnregistrerDefaut: (objectif: ObjectifCommunication) => Promise<boolean>;
  /** L'objectif de la seule vidéo en cours. N'écrit rien côté compte. */
  onAppliquerACetteVideo?: (objectif: ObjectifCommunication | null) => void;
}

export default function MonObjectifPanel({
  objectifEnregistre, chargement, onEnregistrerDefaut, onAppliquerACetteVideo,
}: MonObjectifPanelProps) {
  const [ouvert, setOuvert] = useState(false);
  const [voirTout, setVoirTout] = useState(false);
  const [brouillon, setBrouillon] = useState<ObjectifCommunication>(
    objectifEnregistre ?? { ...OBJECTIF_DEFAUT },
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
  const typeChoisi = brouillon.type;
  const champs = CHAMPS_PAR_TYPE[typeChoisi as TypeObjectif] ?? [];
  const brouillonGenerique = estObjectifGenerique(brouillon);

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

  const enregistrerDefaut = useCallback(async () => {
    setEnregistrement(true);
    try {
      const ok = await onEnregistrerDefaut(brouillon);
      setEnregistre(ok);
    } finally {
      setEnregistrement(false);
    }
  }, [brouillon, onEnregistrerDefaut]);

  const appliquerACetteVideo = useCallback(() => {
    onAppliquerACetteVideo?.(brouillonGenerique ? null : brouillon);
    setAppliqueVideo(true);
  }, [brouillon, brouillonGenerique, onAppliquerACetteVideo]);

  const basculerListe = useCallback(
    <T extends string>(liste: readonly T[], valeur: T): T[] => (
      liste.includes(valeur) ? liste.filter((v) => v !== valeur) : [...liste, valeur]
    ), [],
  );

  return (
    <div className="pt-3 border-t border-gray-800" data-mon-objectif>
      {/* ── L'état, en une ligne ─────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Target className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <p className="text-xs font-medium text-gray-300">Objectif</p>
          {chargement ? (
            <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
          ) : (
            <span
              data-mon-objectif-etat={aUnObjectif ? 'personnel' : 'defaut'}
              className={`truncate text-[11px] ${aUnObjectif ? 'text-purple-300' : 'text-gray-500'}`}
            >
              {aUnObjectif
                ? LIBELLES_TYPE[objectifEnregistre.type as TypeObjectif]
                  ?? String(objectifEnregistre.type)
                : 'Objectif général'}
            </span>
          )}
          {aUnObjectif && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
        </div>
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          data-mon-objectif-toggle
          // ⚠️ `min-h-[44px]`, MESURE AU BANC CHROMIUM ET NON DEVINEE.
          //
          // Le padding seul donnait 28 px : au-dessus des 19 px qu'un lot
          // precedent avait laisses passer, mais toujours sous le seuil ou
          // un doigt vise sans rater. Le texte reste a 11 px — c'est la
          // CIBLE qui grandit, pas le libelle.
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg border border-gray-800 px-2.5 py-1.5 text-[11px] text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
        >
          {ouvert ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {aUnObjectif ? 'Modifier' : 'Configurer'}
        </button>
      </div>

      {!ouvert && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          {aUnObjectif
            ? 'Utilisé automatiquement pour tes prochaines vidéos.'
            : 'Dis-le une fois : tes prochaines vidéos s’y adapteront.'}
        </p>
      )}

      {ouvert && (
        <div className="mt-3 space-y-4">
          <p className="text-[11px] font-medium text-gray-300">
            Que veux-tu obtenir avec cette vidéo ?
          </p>

          {/* ── LE TYPE ───────────────────────────────────────────────── */}
          <section>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <button
                type="button"
                data-mon-objectif-type={TYPE_OBJECTIF_GENERIQUE}
                aria-pressed={typeChoisi === TYPE_OBJECTIF_GENERIQUE}
                onClick={() => modifier({ type: TYPE_OBJECTIF_GENERIQUE })}
                className={`flex min-h-[40px] items-center rounded-lg border px-2.5 py-2 text-left transition ${
                  typeChoisi === TYPE_OBJECTIF_GENERIQUE
                    ? 'border-purple-500/50 bg-gray-800'
                    : 'border-gray-800 hover:border-gray-700'
                }`}
              >
                <span className="block text-[11px] font-medium text-gray-200">
                  Aucun objectif particulier
                </span>
              </button>
              {visibles.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-mon-objectif-type={t}
                  aria-pressed={typeChoisi === t}
                  onClick={() => modifier({ type: t })}
                  className={`flex min-h-[40px] items-center rounded-lg border px-2.5 py-2 text-left transition ${
                    typeChoisi === t
                      ? 'border-purple-500/50 bg-gray-800'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span className="block text-[11px] font-medium text-gray-200">
                    {LIBELLES_TYPE[t] ?? t}
                  </span>
                </button>
              ))}
            </div>
            {!voirTout && (
              <button
                type="button"
                data-mon-objectif-voir-tout
                onClick={() => setVoirTout(true)}
                className="mt-1.5 min-h-[40px] rounded-lg px-1 py-1.5 text-[11px] text-purple-300 transition-colors hover:text-purple-200"
              >
                Voir tous les objectifs
              </button>
            )}
          </section>

          {/* ── CE QUE ÇA CHANGE, DIT HONNÊTEMENT ─────────────────────── */}
          {!brouillonGenerique && (
            <p
              data-mon-objectif-effet={agitSurLeMontage ? 'montage' : 'aucun'}
              className="text-[11px] text-gray-500"
            >
              {agitSurLeMontage
                ? 'Les passages seront choisis en fonction de cet objectif.'
                : 'Cet objectif est enregistré, mais il ne change pas encore le choix des passages.'}
            </p>
          )}

          {/* ── LES CHAMPS DE CONTEXTE, SELON LE TYPE ─────────────────── */}
          {champs.length > 0 && (
            <section className="space-y-2">
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
                      className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-900 px-2 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-600 focus:border-purple-500/50 focus:outline-none"
                    />
                  </label>
                );
              })}
              <p className="text-[11px] text-gray-600">
                Ces textes servent à écrire tes accroches. Ils ne changent pas
                le choix des passages.
              </p>
            </section>
          )}

          {/* ── CE QU'IL FAUT MONTRER ─────────────────────────────────── */}
          {!brouillonGenerique && (
            <section>
              <p className="mb-1.5 text-[11px] font-medium text-gray-400">
                À privilégier dans la vidéo
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PRIORITES_UTILES.map((p) => {
                  const actif = brouillon.priorites.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      data-mon-objectif-priorite={p}
                      aria-pressed={actif}
                      onClick={() => modifier({
                        priorites: basculerListe(brouillon.priorites, p),
                      })}
                      className={`flex min-h-[40px] items-center rounded-lg border px-2.5 py-2 text-left text-[11px] transition ${
                        actif
                          ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      {LIBELLES_PRIORITE[p] ?? p}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── LES PREUVES ───────────────────────────────────────────── */}
          {!brouillonGenerique && (
            <section>
              <p className="mb-1.5 text-[11px] font-medium text-gray-400">
                Ce que tu veux prouver
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {PREUVES_UTILES.map((p) => {
                  const actif = brouillon.preuveSouhaitee.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      data-mon-objectif-preuve={p}
                      aria-pressed={actif}
                      onClick={() => modifier({
                        preuveSouhaitee: basculerListe(brouillon.preuveSouhaitee, p),
                      })}
                      className={`flex min-h-[40px] items-center rounded-lg border px-2.5 py-2 text-left text-[11px] transition ${
                        actif
                          ? 'border-purple-500/50 bg-gray-800 text-gray-200'
                          : 'border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      {LIBELLES_PREUVE[p] ?? p}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── LES DEUX GESTES, ET LEUR DIFFÉRENCE ───────────────────── */}
          <div className="space-y-1.5 pt-1">
            {onAppliquerACetteVideo && (
              <button
                type="button"
                onClick={appliquerACetteVideo}
                data-mon-objectif-cette-video
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2.5 text-[11px] font-medium text-gray-200 transition-colors hover:border-gray-600 hover:text-white"
              >
                {appliqueVideo && <Check className="w-3 h-3 text-purple-400" />}
                {appliqueVideo ? 'Appliqué à cette vidéo' : 'Pour cette vidéo seulement'}
              </button>
            )}
            <button
              type="button"
              onClick={enregistrerDefaut}
              disabled={enregistrement}
              data-mon-objectif-enregistrer
              className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2.5 text-[11px] font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-40"
            >
              {enregistrement && <Loader2 className="w-3 h-3 animate-spin" />}
              {enregistre && !enregistrement && <Check className="w-3 h-3" />}
              {enregistre && !enregistrement
                ? 'Enregistré'
                : 'Enregistrer comme mon objectif par défaut'}
            </button>
            <p className="text-[11px] text-gray-500">
              Tant que tu ne l’enregistres pas, rien ne change pour ton compte.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

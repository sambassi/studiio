'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarRange, Check, Crop, Loader2, Plus, Save, Settings2,
} from 'lucide-react';
import { uploadFile } from '@/lib/storage/uploadFile';
import AnalyseRush from '@/components/creer/AnalyseRush';
import BandeRushes, { type AnalyseCarte } from '@/components/creer/BandeRushes';
import ContenuAnalyse from '@/components/creer/ContenuAnalyse';
import AideAutopilote from '@/components/creer/AideAutopilote';
import DrawerLateral from '@/components/ui/DrawerLateral';
import MenuActions from '@/components/ui/MenuActions';
import { lireAnalyse } from '@/lib/autopilot/analyse/passerelle';
import {
  MONTAGE_DEFAUT, type AutopilotMontageStyle,
} from '@/lib/autopilot/textStyle';
import {
  RECETTE_AUDIO_DEFAUT, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';
import {
  ecrireBrouillon, lireBrouillon,
} from '@/lib/autopilot/brouillon-video';
import {
  lireObjectif, normaliserObjectif, type ObjectifCommunication,
} from '@/lib/autopilot/analyse/objectif-communication';
import type { ShootSession, Rush } from '@/lib/autopilot/tournage/contrat';

/**
 * Sessions de tournage — l'écran minimal du socle M3-A.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nommer un tournage, y déposer des rushes, voir ceux qui sont indexés, et —
 * depuis M3-B3 — demander l'analyse d'un rush vérifié puis en suivre l'état.
 * Rien d'autre : ni sélection de moments, ni montage, ni « créer 10 vidéos ».
 * Ces boutons viendront avec les fonctionnalités qui les portent — les poser
 * maintenant promettrait ce qui n'existe pas.
 *
 * L'analyse elle-même vit dans `AnalyseRush`, un composant par ligne : c'est
 * lui qui interroge le serveur et qui arrête son suivi en disparaissant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEPUIS N'IMPORTE QUEL VOLUME, SANS COPIE LOCALE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `<input type="file" multiple>` ordinaire. C'est le sélecteur du système
 * qui s'ouvre : SSD externe, carte SD, clé USB, disque interne — tout volume
 * monté est atteignable, et rien à écrire pour ça.
 *
 * Le fichier n'est PAS copié sur le disque interne, et n'est pas chargé en
 * mémoire : `uploadFile` découpe au-delà de 8 Mio et envoie chaque morceau
 * par `file.slice()`, que le navigateur lit paresseusement depuis le volume
 * d'origine. Quelqu'un dont le disque est plein peut donc téléverser
 * plusieurs centaines de gigaoctets depuis une carte mémoire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÉBRANCHER LA CARTE PENDANT L'ENVOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La lecture échoue, l'envoi s'interrompt, et le morceau n'arrive pas. Aucun
 * rush n'est indexé pour autant : l'indexation est demandée APRÈS l'envoi, et
 * le serveur ne l'accepte qu'après avoir REGARDÉ l'objet dans le stockage. Un
 * fichier absent ou tronqué est refusé — l'écran le dit, et la liste ne
 * contient que ce qui existe vraiment.
 */

interface EnCours {
  nom: string;
  pourcent: number;
  erreur?: string;
}

/**
 * Ce que l'écran propose, et RIEN DE PLUS.
 *
 * ⚠️ AUCUN RÉGLAGE DE TEXTE, D'AUDIO, DE VOIX NI DE LOOK. Le moteur des
 * rushes concatène des morceaux recadrés : sa commande ffmpeg n'a ni
 * `drawtext`, ni `amix`, ni `lut3d`. Un contrôle de plus serait enregistré et
 * ignoré au rendu — exactement le genre de réglage qui fait croire à une
 * panne. Le format et la durée, eux, sont de vrais paramètres de M3-G.
 */
const FORMATS = [
  { valeur: '9:16', libelle: 'Vertical' },
  { valeur: '1:1', libelle: 'Carré' },
  { valeur: '16:9', libelle: 'Horizontal' },
] as const;

/** Trois durées usuelles, toutes dans les bornes du contrat (1–120 s). */
const DUREES = [15, 30, 60] as const;

interface Props {
  /** Le réglage enregistré de l'utilisateur, ou le défaut. */
  montageDefaut?: AutopilotMontageStyle;
  /** Enregistre le réglage courant comme défaut. Absent = bouton masqué. */
  onEnregistrerDefaut?: (m: AutopilotMontageStyle) => void | Promise<void>;
  /**
   * Rend a son proprietaire l'objectif relu dans le brouillon de ce rush.
   *
   * ⚠️ IL REMONTE, IL N'EST PAS DECIDE ICI. `objectifCetteVideo` vit dans
   * `AutopilotPanel` avec le wizard qui l'ecrit ; ce panneau sait seulement
   * QUEL rush on regarde, donc quel brouillon relire. Il rend sa trouvaille
   * et n'en fait rien d'autre.
   */
  onObjectifRestaure?: (objectif: ObjectifCommunication | null) => void;
  /**
   * Les DECISIONS qui suivent le choix du rush : objectif, puis style.
   *
   * ⚠️ UN CRENEAU, ET NON UN IMPORT. Ces deux panneaux appartiennent a
   * `AutopilotPanel` — ils portent son etat, ses routes, ses erreurs. Les
   * importer ici en ferait des enfants de ce composant et deplacerait leur
   * etat avec eux. Le creneau ne deplace que leur POSITION.
   *
   * ⚠️ ET LA POSITION EST LA DECISION. Objectif et style vivaient APRES le
   * format, la duree, l'audio et le bouton « Creer ma video » : on choisissait
   * comment monter avant d'avoir dit pourquoi la video existe, et le bouton
   * qui lance tout se presentait au milieu des reglages. Mesure en direct par
   * Bassi le 2026-09-07 : « Creer ma video apparait trop tot ».
   */
  decisions?: React.ReactNode;
  /** Passe-plat : bloque « Creer ma video » tant qu un objectif est en edition. */
  actionBloquee?: boolean;
  /** Le réglage AUDIO enregistré du compte. Passe-plat vers `AnalyseRush`. */
  audioDefaut?: RecetteAudio;
  /** Enregistre la recette audio comme défaut. Absent = bouton masqué. */
  onEnregistrerAudioDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  /**
   * L'objectif de CETTE vidéo. Passe-plat jusqu'à `PassagesSuggeres`.
   *
   * ⚠️ Absent = le défaut du compte, chargé par le SERVEUR. L'écran n'a rien
   * à renvoyer quand il n'a rien à dire.
   */
  objectifCetteVideo?: unknown;
  /**
   * Remonte la session regardée, pour que l'aperçu de la colonne de droite
   * sache quoi montrer. C'est ce qui permet d'avoir UN SEUL aperçu.
   */
  onSessionChange?: (etat: {
    sessionId: string | null;
    aucunRush: boolean;
    /**
     * L'analyse du rush CHOISI, pour que l'apercu montre une image de CE
     * rush plutot qu'un cadre vide. `null` tant qu'aucun rush n'est choisi
     * ou qu'il n'a pas encore d'analyse.
     */
    analyseApercuId: string | null;
    /**
     * Le format CHOISI a l'instant, pas celui du dernier rendu.
     *
     * ⚠️ C'EST CE QUI CORRIGE L'APERCU QUI MENTAIT. Le cadre de droite se
     * calait sur les dimensions du rendu EXISTANT : on choisissait 9:16 et
     * il restait horizontal, parce que la derniere video l'etait. Le cadre
     * suit desormais la demande tant qu'aucune video ne repond.
     */
    format: string;
  }) => void;
  /**
   * Prévient que la création d'une vidéo vient de partir.
   *
   * L'aperçu vit désormais dans la colonne de droite : c'est LUI qu'il faut
   * réveiller, et il n'est plus dans cet arbre. Le signal remonte donc.
   */
  onVideoLancee?: () => void;
  /**
   * Ce que le tiroir « Avancé » contient.
   *
   * ⚠️ C'EST UN RECEPTACLE, PAS UNE FONCTION. LUT, texte, branding, voix
   * viendront ici — et n'allongeront donc jamais la page principale. Il est
   * decide maintenant, pendant qu'il ne coute rien.
   */
  avance?: React.ReactNode;
}

export default function SessionsTournagePanel({
  montageDefaut, onEnregistrerDefaut, onSessionChange, onVideoLancee, audioDefaut,
  onEnregistrerAudioDefaut, avance, decisions, actionBloquee,
  objectifCetteVideo, onObjectifRestaure,
}: Props = {}) {
  const [sessions, setSessions] = useState<ShootSession[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [rushes, setRushes] = useState<Rush[]>([]);
  const [titre, setTitre] = useState('');
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envois, setEnvois] = useState<EnCours[]>([]);
  /**
   * Le réglage de CETTE vidéo.
   *
   * ⚠️ IL NE S'ENREGISTRE PAS TOUT SEUL. Changer le format pour un montage ne
   * doit pas changer tous les montages suivants : l'écriture dans la
   * configuration demande un second geste, explicite.
   */
  const [montage, setMontage] = useState<AutopilotMontageStyle>(
    montageDefaut ?? MONTAGE_DEFAUT,
  );
  const [defautEnregistre, setDefautEnregistre] = useState(false);
  /** Le rush qu'on regarde : il pilote la chaine et le bouton unique. */
  const [rushChoisi, setRushChoisi] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalyseCarte | null>>({});
  const [tiroir, setTiroir] = useState<'analyse' | 'avance' | null>(null);
  const [relances, setRelances] = useState<Record<string, number>>({});
  /**
   * La recette audio de CETTE video, telle que l'ecran la porte a l'instant.
   *
   * Elle vit dans `PassagesSuggeres`, deux niveaux plus bas — ce panneau ne
   * la decide pas, il l'apprend pour pouvoir l'ecrire dans le brouillon.
   */
  const [audioVideo, setAudioVideo] = useState<RecetteAudio | null>(null);
  /**
   * La recette relue du brouillon, passee EN BAS comme point de depart.
   *
   * ⚠️ DISTINCTE DE `audioVideo`. L'une descend (ce qu'on restaure), l'autre
   * remonte (ce que l'utilisateur regle). Les confondre ferait une boucle :
   * on redescendrait ce qui vient de remonter, et le reglage se figerait.
   */
  const [audioBrouillon, setAudioBrouillon] = useState<RecetteAudio | null>(null);
  /**
   * Le rush dont le brouillon est DEJA relu.
   *
   * ⚠️ SANS CE GARDE, L'HYDRATATION S'ECRASE ELLE-MEME. L'effet d'ecriture
   * se declenche des que le format ou l'audio changent — c'est-a-dire au tour
   * de rendu qui SUIT la restauration. Sans savoir qu'on vient de restaurer,
   * il reecrirait le brouillon avec les valeurs par defaut affichees une
   * fraction de seconde plus tot, et la perte serait la meme qu'avant, en
   * moins visible.
   */
  const rushHydrateRef = useRef<string | null>(null);
  const [nouvelleSession, setNouvelleSession] = useState(false);

  // Le réglage enregistré arrive après le premier rendu (la config se charge
  // en réseau) : on s'y accorde tant que l'utilisateur n'a rien touché.
  const toucheRef = useRef(false);
  useEffect(() => {
    if (!toucheRef.current && montageDefaut) setMontage(montageDefaut);
  }, [montageDefaut]);

  const changerMontage = (patch: Partial<AutopilotMontageStyle>) => {
    toucheRef.current = true;
    setDefautEnregistre(false);
    setMontage((m) => ({ ...m, ...patch }));
  };

  const chargerSessions = useCallback(async () => {
    setChargement(true);
    try {
      const d = await fetch('/api/autopilot/sessions').then((r) => r.json());
      if (d?.ok && Array.isArray(d.sessions)) {
        setSessions(d.sessions);
        setErreur(null);
      } else {
        setSessions([]);
        setErreur(d?.error || 'Sessions indisponibles.');
      }
    } catch {
      setErreur('Sessions indisponibles.');
    } finally {
      setChargement(false);
    }
  }, []);

  const chargerRushes = useCallback(async (id: string) => {
    try {
      const d = await fetch(`/api/autopilot/sessions/${id}/rushes`).then((r) => r.json());
      setRushes(d?.ok && Array.isArray(d.rushes) ? d.rushes : []);
    } catch {
      setRushes([]);
    }
  }, []);

  useEffect(() => { chargerSessions(); }, [chargerSessions]);

  /**
   * La premiere session s'ouvre d'elle-meme.
   *
   * ⚠️ LE SELECTEUR L'EXIGE. Avec une liste de boutons, ne rien choisir etait
   * un etat lisible : rien n'etait surligne. Un `<select>` sans valeur, lui,
   * AFFICHE quand meme sa premiere option — l'ecran aurait donc nomme un
   * tournage tout en n'en ayant ouvert aucun, et la bande de rushes serait
   * restee vide sans raison visible.
   */
  useEffect(() => {
    setSelection((actuelle) => {
      if (actuelle && sessions.some((x) => x.id === actuelle)) return actuelle;
      return sessions[0]?.id ?? null;
    });
  }, [sessions]);
  useEffect(() => { if (selection) chargerRushes(selection); }, [selection, chargerRushes]);

  /**
   * Le rush regarde par defaut : le premier qui soit exploitable.
   *
   * ⚠️ UN SEUL RUSH A LA FOIS, ET C'EST LE FOND DE LA REFONTE. L'ecran
   * montait auparavant la chaine COMPLETE — analyse, passages, audio, bouton
   * — pour CHAQUE rush verifie. Trois rushes faisaient trois panneaux audio
   * et trois « Creer ma video », alors que le moteur, lui, part d'UN rush.
   * L'ecran dit desormais la meme chose que le moteur.
   */
  useEffect(() => {
    setRushChoisi((actuel) => {
      if (actuel && rushes.some((r) => r.id === actuel)) return actuel;
      return rushes.find((r) => r.etat === 'verifie')?.id ?? rushes[0]?.id ?? null;
    });
  }, [rushes]);

  /**
   * L'etat d'analyse de CHAQUE rush — pour la miniature et le ✓ des cartes.
   *
   * ⚠️ `GET` UNIQUEMENT, ET MOINS DE REQUETES QU'AVANT. Chaque rush verifie
   * montait un `AnalyseRush` qui sondait pour son compte ; ici une passe de
   * lecture suffit, et elle ne se repete que tant qu'une analyse bouge.
   */
  const chargerAnalyses = useCallback(async (liste: Rush[]) => {
    const paires = await Promise.all(liste.map(async (r) => {
      const a = await lireAnalyse(r.id);
      const carte: AnalyseCarte | null = a.sorte === 'trouvee'
        ? { id: a.analyse.id, etat: a.analyse.etat, dureeSecondes: a.analyse.dureeSecondes }
        : null;
      return [r.id, carte] as const;
    }));
    setAnalyses(Object.fromEntries(paires));
  }, []);

  useEffect(() => {
    if (rushes.length === 0) { setAnalyses({}); return; }
    chargerAnalyses(rushes);
  }, [rushes, chargerAnalyses]);

  /**
   * ⚠️ ON NE SONDE QUE TANT QU'UNE ANALYSE BOUGE. `reussie`, `echouee` et
   * `annulee` ne se rouvrent pas : continuer serait une requete toutes les
   * huit secondes, pour toujours, sur un resultat fige.
   */
  const enVol = Object.values(analyses)
    .some((a) => a !== null && (a.etat === 'en_cours' || a.etat === 'en_attente'));
  useEffect(() => {
    if (!enVol || rushes.length === 0) return undefined;
    const t = setInterval(() => chargerAnalyses(rushes), 8000);
    return () => clearInterval(t);
  }, [enVol, rushes, chargerAnalyses]);

  /**
   * ── LE BROUILLON DE CE RUSH, RELU AU CHANGEMENT DE RUSH ────────────────
   *
   * Ordre d'hydratation, et il compte : les defauts du compte d'abord — ils
   * sont deja dans `montage` et descendent dans `audioDefaut` — puis le
   * brouillon de CETTE video s'il existe. Un rush sans brouillon garde donc
   * les defauts du compte, et ne recupere JAMAIS les reglages du rush
   * precedent : chaque rush lit sa propre cle.
   */
  useEffect(() => {
    if (!rushChoisi) return;
    if (rushHydrateRef.current === rushChoisi) return;
    rushHydrateRef.current = rushChoisi;
    const brouillon = lireBrouillon(rushChoisi);
    if (!brouillon) {
      /**
       * ⚠️ PAS DE BROUILLON : ON NE POSE RIEN, ON REMET LE COMPTEUR A ZERO.
       *
       * Le premier jet ecrivait ici `setMontage(montageDefaut ?? …)`. Quatre
       * tests l'ont refuse, et ils avaient raison : ce panneau applique deja
       * le defaut du compte, mais SEULEMENT tant que l'utilisateur n'a rien
       * touche (`toucheRef`). Ecrire par-dessus revenait a effacer un choix
       * delibere — et a le faire au moment ou le defaut du compte arrive en
       * retard du reseau, donc de facon imprevisible.
       *
       * Rendre `toucheRef` a `false` suffit : le rush suivant redevient
       * vierge, l'effet existant repose le defaut du compte, et un choix fait
       * APRES ce point reste intact. Ce qui ne doit surtout pas survivre au
       * changement de rush, ce sont l'objectif et l'audio de la video
       * precedente — eux, on les efface explicitement.
       */
      toucheRef.current = false;
      setAudioBrouillon(null);
      setAudioVideo(null);
      onObjectifRestaure?.(null);
      return;
    }
    // Un brouillon EST un choix delibere : il compte comme « touche », faute
    // de quoi le defaut du compte arriverait ensuite l'ecraser.
    toucheRef.current = true;
    setMontage(brouillon.montage);
    setAudioBrouillon(brouillon.audio);
    setAudioVideo(brouillon.audio);
    onObjectifRestaure?.(brouillon.objectif);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rushChoisi]);

  /**
   * ── L'ECRITURE, A CHAQUE REGLAGE ──────────────────────────────────────
   *
   * ⚠️ ELLE N'ECRIT QUE DANS `localStorage`. Aucune route, aucun defaut de
   * compte : le seul geste qui change l'objectif habituel reste la case du
   * wizard. Un brouillon ne doit jamais devenir une habitude a l'insu de son
   * auteur — c'est la confusion qui a coute un objectif de compte.
   *
   * Le declenchement est cible : format, duree, objectif, recette audio. Pas
   * de minuterie, pas de debounce — ces valeurs changent au clic, quelques
   * fois par minute, jamais par image.
   */
  useEffect(() => {
    if (!rushChoisi) return;
    if (rushHydrateRef.current !== rushChoisi) return;
    /**
     * ⚠️ L'OBJECTIF REPASSE PAR SON VALIDATEUR AVANT D'ETRE ECRIT.
     *
     * `objectifCetteVideo` arrive ici en `unknown` — c'est un passe-plat, ce
     * panneau ne le decide pas. Ecrire tel quel mettrait dans le brouillon
     * une forme que la relecture refuserait ensuite en silence : le reglage
     * paraitrait enregistre et ne reviendrait jamais.
     */
    const lu = objectifCetteVideo === undefined || objectifCetteVideo === null
      ? null : lireObjectif(objectifCetteVideo);
    ecrireBrouillon(rushChoisi, {
      objectif: lu && lu.ok ? normaliserObjectif(lu.objectif) : null,
      montage,
      audio: audioVideo ?? audioDefaut ?? RECETTE_AUDIO_DEFAUT,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rushChoisi, montage.format, montage.dureeSecondes,
    JSON.stringify(objectifCetteVideo ?? null), JSON.stringify(audioVideo ?? null)]);

  // L'aperçu unique de la colonne de droite a besoin de savoir QUEL tournage
  // on regarde. Sans ce signal, il faudrait un second lecteur ici.
  useEffect(() => {
    onSessionChange?.({
      sessionId: selection,
      aucunRush: rushes.length === 0,
      format: montage.format,
      /* ⚠️ LE RUSH CHOISI, PAS LE PREMIER DE LA LISTE : l'apercu doit suivre
         la selection, sinon changer de rush laisse l'image de l'ancien. */
      analyseApercuId: (rushChoisi ? analyses[rushChoisi]?.id : null) ?? null,
    });
  }, [selection, rushes.length, montage.format, rushChoisi,
    rushChoisi ? analyses[rushChoisi]?.id : null, onSessionChange]);

  const creer = async () => {
    const t = titre.trim();
    if (!t) return;
    setErreur(null);
    try {
      const d = await fetch('/api/autopilot/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre: t }),
      }).then((r) => r.json());
      if (!d?.ok || !d.session) { setErreur(d?.error || 'Création impossible.'); return; }
      setTitre('');
      setSessions((prev) => [d.session, ...prev]);
      setSelection(d.session.id);
    } catch {
      setErreur('Création impossible.');
    }
  };

  /**
   * Téléverse puis indexe, fichier par fichier.
   *
   * Séquentiel, et c'est voulu : dix envois simultanés depuis une carte
   * mémoire se disputent le même bus et finissent plus lentement que dix
   * envois à la suite — en plus de rendre la progression illisible.
   */
  const ajouterFichiers = async (fichiers: File[]) => {
    if (!selection || fichiers.length === 0) return;
    setEnvois(fichiers.map((f) => ({ nom: f.name, pourcent: 0 })));

    for (let i = 0; i < fichiers.length; i += 1) {
      const f = fichiers[i];
      const majEtat = (patch: Partial<EnCours>) => {
        setEnvois((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const envoye = await uploadFile(f, {
          purpose: 'rush',
          onProgress: (p) => majEtat({ pourcent: Math.round(p) }),
        });
        // L'indexation vient APRÈS l'envoi, et le serveur vérifiera lui-même
        // que l'objet est là. Un envoi interrompu n'arrive jamais ici, et s'il
        // y arrivait, la vérification le refuserait.
        // eslint-disable-next-line no-await-in-loop
        const d = await fetch(`/api/autopilot/sessions/${selection}/rushes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bucket: envoye.bucket, path: envoye.path, nomOrigine: f.name,
          }),
        }).then((r) => r.json());
        if (!d?.ok) { majEtat({ erreur: d?.error || 'Indexation refusée.' }); continue; }
        majEtat({ pourcent: 100 });
      } catch (e) {
        // Volume débranché, fichier illisible, réseau coupé : on le dit, et
        // on ne fabrique aucun rush.
        majEtat({ erreur: e instanceof Error ? e.message : 'Envoi interrompu.' });
      }
    }
    if (selection) await chargerRushes(selection);
  };

  const rushActif = rushes.find((r) => r.id === rushChoisi) ?? null;
  const nomRushActif = rushActif
    ? (rushActif.nomOrigine || rushActif.cleObjet.split('/').pop() || 'rush')
      .replace(/^\d{10,}-/, '')
    : '';

  /* « Avancé » + la phrase de validation humaine. La ligne descend au ras du
     bouton « Créer ma vidéo » quand la chaîne est là — c'est l'ordre demandé.
     ⚠️ MAIS elle doit exister AUSSI quand aucun rush n'est encore vérifié :
     sinon les réglages avancés deviennent inatteignables tant que l'analyse
     tourne. Les deux emplacements sont mutuellement exclusifs, jamais en
     double : `chaineVisible` arbitre. */
  const chaineVisible = rushActif !== null && rushActif !== undefined
    && rushActif.etat === 'verifie';
  const ligneAvance = (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTiroir('avance')}
                data-ouvrir-avance
                className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px]
                  text-gray-500 hover:text-gray-300 focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" /> Avancé
              </button>
              {/* La validation humaine, dite une fois, en petit. */}
              <p className="text-[10px] text-gray-600" data-validation-humaine>
                Studiio prépare la vidéo. Vous la vérifiez avant publication.
              </p>
            </div>
  );

  return (
    <div className="space-y-4" data-tournage-panel>
      {/* ══ EN-TETE ══════════════════════════════════════════════════════
          Une ligne : la session qu'on regarde, et un « ⋯ » pour ce qui la
          concerne. Creer et nommer un tournage sont des gestes rares ; ils
          n'ont pas a occuper deux champs en permanence. */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="session-active">Session de tournage</label>
        <select
          id="session-active"
          value={selection ?? ''}
          onChange={(e) => setSelection(e.target.value || null)}
          data-tournage-selecteur
          disabled={sessions.length === 0}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 py-1.5
            text-[13px] text-gray-100 outline-none focus:border-purple-500 disabled:opacity-40"
        >
          {sessions.length === 0 && <option value="">Aucune session</option>}
          {sessions.map((x) => (
            <option key={x.id} value={x.id}>{x.titre}</option>
          ))}
        </select>
        <AideAutopilote />
        <MenuActions
          marqueur="session"
          etiquette="Réglages de la session"
          titreGroupe="Session"
          icone={<CalendarRange className="h-4 w-4" />}
          actions={[
            {
              libelle: 'Nouvelle session',
              icone: <Plus className="h-3.5 w-3.5" />,
              onClick: () => setNouvelleSession(true),
            },
          ]}
        />
      </div>

      {nouvelleSession && (
        <div className="flex items-center gap-2" data-tournage-nouvelle>
          <input
            type="text"
            autoFocus
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); creer(); setNouvelleSession(false); }
              if (e.key === 'Escape') setNouvelleSession(false);
            }}
            placeholder="Nom du tournage — ex : cours du samedi"
            data-tournage-titre
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5
              text-[13px] outline-none focus:border-purple-500"
          />
          <button
            type="button"
            onClick={() => { creer(); setNouvelleSession(false); }}
            disabled={!titre.trim()}
            data-tournage-creer
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-gray-300
              hover:border-white/20 hover:text-white disabled:opacity-40 transition-colors"
          >
            Créer
          </button>
        </div>
      )}

      {erreur && <p className="text-[11px] text-gray-500" data-tournage-erreur>{erreur}</p>}
      {chargement && <Loader2 className="h-4 w-4 animate-spin text-gray-500" aria-hidden="true" />}

      {selection && (
        <>
          {/* ══ RUSHES ═══════════════════════════════════════════════════ */}
          <BandeRushes
            rushes={rushes}
            analyses={analyses}
            selection={rushChoisi}
            onSelectionner={setRushChoisi}
            onVoirAnalyse={(id) => { setRushChoisi(id); setTiroir('analyse'); }}
            onReanalyser={(id) => {
              setRushChoisi(id);
              setRelances((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }));
            }}
            onAjouterFichiers={ajouterFichiers}
            envois={envois}
          />

          {/* ══ OBJECTIF, PUIS STYLE ═════════════════════════════════════
              Le rush dit AVEC QUOI. L'objectif dit POURQUOI, le style dit
              A QUOI CA RESSEMBLE. Les trois se decident avant de parler de
              format, de duree ou de son. */}
          {decisions}

          {/* ══ FORMAT ET DUREE ══════════════════════════════════════════
              Une ligne, deux menus. La carte « Reglages de la video » qui les
              entourait n'apportait qu'un cadre et un titre. */}
          <div className="flex flex-wrap items-center gap-3" data-montage-reglages>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Format</span>
              <select
                value={montage.format}
                onChange={(e) => changerMontage({ format: e.target.value })}
                data-montage-format
                className="rounded-lg border border-white/10 bg-transparent px-2 py-1
                  text-[12px] text-gray-100 outline-none focus:border-purple-500"
              >
                {FORMATS.map((f) => (
                  <option key={f.valeur} value={f.valeur}>{f.libelle} {f.valeur}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Durée</span>
              <select
                value={String(montage.dureeSecondes)}
                onChange={(e) => changerMontage({ dureeSecondes: Number(e.target.value) })}
                data-montage-duree
                className="rounded-lg border border-white/10 bg-transparent px-2 py-1
                  text-[12px] text-gray-100 outline-none focus:border-purple-500"
              >
                {DUREES.map((d) => (
                  <option key={d} value={d}>{d} s</option>
                ))}
              </select>
            </label>
            {onEnregistrerDefaut && (
              <MenuActions
                compact
                marqueur="montage"
                etiquette="Format et durée"
                titreGroupe="Format et durée"
                icone={<Crop className="h-3.5 w-3.5" />}
                actions={[{
                  libelle: defautEnregistre
                    ? 'Réglage par défaut enregistré'
                    : 'Enregistrer comme réglage par défaut',
                  icone: defautEnregistre
                    ? <Check className="h-3.5 w-3.5" />
                    : <Save className="h-3.5 w-3.5" />,
                  onClick: async () => {
                    await onEnregistrerDefaut(montage);
                    setDefautEnregistre(true);
                  },
                }]}
              />
            )}
          </div>

          {/* ══ AUDIO + ACTION PRINCIPALE ════════════════════════════════
              Portes par la chaine du rush regarde. UN panneau audio, UN
              bouton — quel que soit le nombre de rushes. */}
          {rushActif && rushActif.etat === 'verifie' && (
            <AnalyseRush
              key={rushActif.id}
              rushId={rushActif.id}
              montage={montage}
              audioDefaut={audioDefaut}
              audioInitial={audioBrouillon}
              onAudioChange={setAudioVideo}
              /* ⚠️ « AVANCE » DESCEND ENTRE L'AUDIO ET LE BOUTON, et c'est la
                 seule facon d'obtenir l'ordre demande sans casser en deux un
                 composant qui tient l'etat audio ET l'action. « Creer ma
                 video » redevient ainsi la DERNIERE chose de l'ecran, apres
                 le rush, l'objectif, le style, le format, la duree, le son et
                 les reglages avances. */
              actionBloquee={actionBloquee}
              avantAction={ligneAvance}
              onEnregistrerAudioDefaut={onEnregistrerAudioDefaut}
              onVideoLancee={onVideoLancee}
              objectifCetteVideo={objectifCetteVideo}
              variante="chaine"
              relance={relances[rushActif.id]}
              onVoirAnalyse={() => setTiroir('analyse')}
            />
          )}
          {rushActif && rushActif.etat !== 'verifie' && (
            <p className="text-[11px] text-gray-500" data-rush-non-verifie={rushActif.etat}>
              Ce rush est encore « {rushActif.etat} ». Studiio le vérifie avant de pouvoir le monter.
            </p>
          )}

          {!chaineVisible && ligneAvance}

        </>
      )}

      {/* ══ TIROIRS ══════════════════════════════════════════════════════ */}
      <DrawerLateral
        ouvert={tiroir === 'analyse'}
        onFermer={() => setTiroir(null)}
        titre={nomRushActif ? `Analyse — ${nomRushActif}` : 'Analyse'}
        marqueur="analyse"
      >
        {rushActif && <ContenuAnalyse rushId={rushActif.id} nom={nomRushActif} />}
      </DrawerLateral>

      <DrawerLateral
        ouvert={tiroir === 'avance'}
        onFermer={() => setTiroir(null)}
        titre="Réglages avancés"
        marqueur="avance"
      >
        {avance ?? (
          <p className="text-[12px] text-gray-500">
            Rien à régler pour l’instant. Les réglages créatifs viendront ici.
          </p>
        )}
      </DrawerLateral>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { classesCarteOption } from '@/lib/ui/etats';
import {
  Rocket, Loader2, Check, AlertTriangle, Film, Trash2, Plus, Music, Mic, ImageIcon,
  Sparkles, Clapperboard, CalendarDays,
} from 'lucide-react';
import { annonceCout } from '@/lib/facturation/annonce';
import { politiqueAffichable } from '@/lib/facturation/libelles';
import type { Politique } from '@/lib/facturation/politique';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import SessionsTournagePanel from '@/components/creer/SessionsTournagePanel';
import JumeauAutopilote from '@/components/creer/JumeauAutopilote';
import BriefVideo, { BriefRecurrentRecap } from '@/components/creer/BriefVideo';
import AudioMixPreview from '@/components/creer/AudioMixPreview';
import { montageDepuisStyle } from '@/lib/autopilot/textStyle';
import { CardIcon } from '@/components/ui/CardIcon';
import ColorWheel from '@/components/ui/ColorWheel';
import { THEMES, themeLabel, isCustomTopic } from '@/lib/themes';
import { urlPubliqueAbsolue } from '@/lib/creer/posterUpload';
import { dedupeParCleObjet } from '@/lib/storage/cle-objet-client';
import { DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import {
  sanitizeConfig, statusMessage, DEFAULT_CONFIG, MAX_PER_CYCLE, pickRush,
  CADENCES, CADENCE_LABELS,
  INTENTIONS, INTENTION_LABELS, INTENTION_HINTS, INTENTION_MODE,
  intentionDiffusion, patchPourIntention, sanitizePublishTime,
  sanitizeStartDate, localDate, slotDate,
  POSTER_MODES, POSTER_MODE_LABELS, POSTER_MODE_HINTS, type AutopilotPosterMode,
  type AutopilotConfig, type AutopilotCadence, type AutopilotIntention,
} from '@/lib/autopilot/rules';

/** Une voix clonée, telle que la rend `GET /api/voice/clone`. */
interface VoixClonee {
  /** L'identifiant Studiio (`elevenlabs-<provider_voice_id>`) — celui que la configuration enregistre. */
  id: string;
  /** L'identifiant DU COMPTE (`user_voices.id`) — celui que le contrat Jumeau désigne. */
  accountVoiceId?: string;
  name: string;
  lang: string | null;
}

/**
 * La voix que désigne `config.voiceId` : par son identifiant Studiio, ou — pour
 * une configuration plus ancienne où le Jumeau avait posé l'identifiant de
 * compte — par `accountVoiceId`. Rien n'est réécrit à l'affichage : le prochain
 * geste de l'utilisateur enregistre l'identifiant Studiio.
 */
function voixDeConfig(voix: VoixClonee[], voiceId: string | null): VoixClonee | undefined {
  if (!voiceId) return undefined;
  return voix.find((v) => v.id === voiceId || (!!v.accountVoiceId && v.accountVoiceId === voiceId));
}

/** Le nom d'un fichier, à partir de son adresse — pour ne pas afficher l'URL. */
function nomDeFichier(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url.split('/').pop() || url;
  }
}

/**
 * Configuration de l'Autopilote.
 *
 * L'écran ne fait que régler : le moteur qui produit est livré séparément.
 * Il s'appuie sur les MÊMES règles (`lib/autopilot/rules`) que ce moteur —
 * l'état annoncé ici (« prochaine génération… ») est donc calculé par le code
 * qui décidera réellement, et non par une seconde estimation qui finirait par
 * ne plus dire la même chose.
 */

/**
 * Les etapes du wizard.
 *
 * ⚠️ CE N'EST QU'UNE MISE EN PAGE. Les reglages, les gestionnaires et
 * l'enregistrement automatique sont ceux d'avant : sept blocs empiles
 * faisaient une page qu'on ne lisait pas jusqu'au bout, pas sept reglages de
 * trop.
 */
const ETAPES = [
  { titre: 'Sujets', question: 'De quoi Studiio doit-il parler ?', aide: 'Choisissez un ou plusieurs sujets.' },
  { titre: 'Rushes', question: 'Ajoutez les vidéos que Studiio pourra utiliser', aide: 'Au moins un rush est nécessaire.' },
  // ⚠️ CETTE ETAPE EST CELLE DE CE QUI NE CHANGE PAS. Les trois autres
  // reglent ce que l'Autopilote fait VARIER ; celle-ci, l'identite que
  // toutes les videos partagent.
  { titre: 'Style', question: 'À quoi ressembleront vos vidéos ?', aide: 'Ces réglages valent pour toutes les futures vidéos.' },
  { titre: 'Publication', question: 'Quand et où publier ?', aide: 'Fréquence, validation, réseaux.' },
  { titre: 'Options', question: 'Options facultatives', aide: 'Vous pouvez passer cette étape.' },
  { titre: 'Vérification', question: 'Tout est-il prêt ?', aide: 'Vérifiez, puis lancez l’Autopilote.' },
] as const;

/**
 * Le libelle du bouton qui fait avancer — jamais un « Suivant » nu : il dit
 * ou il mene. La derniere etape n'en a pas, elle porte « Lancer ».
 */
function libelleContinuer(etape: number): string {
  if (etape >= ETAPES.length - 1) return '';
  if (etape === ETAPES.length - 2) return 'Vérifier ma configuration';
  return `Continuer vers ${ETAPES[etape + 1].titre}`;
}

/** « Instagram, TikTok » — les réseaux choisis, par leur nom. */
function nomsReseaux(platforms: string[]): string {
  return platforms.map((p) => PLATEFORMES.find((x) => x.id === p)?.label ?? p).join(', ');
}

/**
 * La phrase de diffusion, lue comme l'utilisateur la lira — « 1 vidéo chaque
 * jour, produite à 08:00, programmée le lendemain à 18:45 sur Instagram —
 * publication automatique ». Calculee depuis la configuration — la meme
 * source que le recapitulatif ; rien n'y est ecrit en dur.
 *
 * ⚠️ DEUX HEURES, DITES SÉPARÉMENT. La phrase disait « [cadence] à 08:00 …
 * publiée automatiquement » : 08:00 est l'heure de PRODUCTION, et la
 * publication se faisait à 18:00 le lendemain, en dur. Confondre les deux
 * faisait attendre une vidéo à une heure où rien ne partait.
 */
function phraseDiffusion(config: AutopilotConfig): string {
  const n = config.countPerCycle;
  const s = n > 1 ? 's' : '';
  const videos = `${n} vidéo${s}`;
  const cadence = CADENCE_LABELS[config.cadence].toLowerCase();
  // La date de début, quand elle est encore à venir : la phrase dirait
  // sinon « chaque jour » pour un Autopilote qui ne fera rien avant lundi.
  const debut = dateDebutAVenir(config) ? ` à partir du ${dateLisible(config.startDate!)}` : '';
  const production = `produite${s} à ${heureLisible(config.runHour)}${debut}`;
  const heure = heurePublicationLisible(config);
  let suite: string;
  switch (intentionDiffusion(config)) {
    case 'publier':
      suite = config.platforms.length
        ? `programmée${s} le lendemain à ${heure} sur ${nomsReseaux(config.platforms)} — publication automatique`
        : `programmée${s} le lendemain à ${heure} — mais AUCUN réseau choisi : rien ne partira`;
      break;
    case 'valider':
      suite = `déposée${s} en brouillon dans le Calendrier pour ${nomsReseaux(config.platforms)}, le lendemain à ${heure} — rien ne part sans votre validation`;
      break;
    default:
      suite = `déposée${s} en brouillon dans le Calendrier, sans réseau — à télécharger`;
  }
  return `${videos} ${cadence}, ${production}, ${suite}.`;
}

/**
 * La check-list de preparation. Chaque ligne vient de la configuration ; la
 * seule condition BLOQUANTE pour la production est le rush (le moteur refuse
 * de tourner sans : `shouldRun` → `sans-rush`). Le reste a toujours une
 * valeur — recommandee ou choisie — et ne bloque rien.
 */
function checklistPreparation(config: AutopilotConfig): Array<{ cle: string; ok: boolean; texte: string; bloquant: boolean }> {
  const n = config.rushUrls.length;
  return [
    { cle: 'sujets', ok: true, bloquant: false,
      texte: config.topics.length === 0 ? 'Sujets : tous les thèmes, en rotation' : `Sujets : ${config.topics.length} choisi${config.topics.length > 1 ? 's' : ''}` },
    { cle: 'rushes', ok: n > 0, bloquant: true,
      texte: n === 0 ? 'Aucun rush — rien ne sera produit' : `${n} rush${n > 1 ? 'es' : ''} prêt${n > 1 ? 's' : ''}` },
    { cle: 'style', ok: true, bloquant: false, texte: 'Style configuré (couleurs, affiche, son)' },
    { cle: 'publication', ok: true, bloquant: false,
      texte: config.platforms.length ? `Publication : ${config.platforms.length} réseau${config.platforms.length > 1 ? 'x' : ''}` : 'Publication : dans le Calendrier seulement (aucun réseau)' },
  ];
}

/** « 80 % » — un niveau du mixeur, tel que l'utilisateur le lit. */
function pourcent(v: number): string {
  return `${Math.round(v * 100)} %`;
}

/** « 08:00 » — l'heure de PRODUCTION (entière) telle que l'utilisateur la lit. */
function heureLisible(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * « 18:45 » — l'heure de PUBLICATION, minutes comprises.
 *
 * Relue par `sanitizePublishTime` plutôt qu'affichée telle quelle : l'état
 * local est déjà assaini, mais une valeur vide pendant la saisie (le
 * navigateur rend `''` sur un champ `time` incomplet) s'afficherait comme un
 * trou dans la phrase.
 */
function heurePublicationLisible(config: Pick<AutopilotConfig, 'publishTime'>): string {
  return sanitizePublishTime(config.publishTime);
}

/**
 * « lundi 5 octobre 2026 » — une date « YYYY-MM-DD », sans heure.
 *
 * Posée à MIDI UTC et lue en UTC : un jour civil n'a pas de fuseau, et la
 * lire dans celui du navigateur ferait reculer d'un jour toute date affichée
 * à l'ouest de Greenwich.
 */
function dateLisible(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** La date de début est-elle encore à venir, chez l'utilisateur ? */
function dateDebutAVenir(
  config: Pick<AutopilotConfig, 'startDate' | 'runTimezone'>,
  maintenant: Date = new Date(),
): boolean {
  const debut = sanitizeStartDate(config.startDate);
  return !!debut && localDate(maintenant.getTime(), config.runTimezone) < debut;
}

/**
 * L'INSTANT du prochain depart, dans le fuseau de l'utilisateur.
 *
 * ⚠️ ON CHERCHE L'INSTANT, PAS L'HEURE. Ajouter « runHour heures » a minuit
 * local supposerait des journees de 24 h : les jours de changement d'heure
 * elles en font 23 ou 25, et l'annonce se decalerait. On avance donc heure
 * par heure jusqu'a ce que l'horloge du fuseau affiche l'heure voulue — au
 * plus 48 essais, ce qui couvre tous les cas.
 *
 * ⚠️ LA DATE DE DÉBUT, QUAND ELLE EST À VENIR, DÉPLACE LE POINT DE DÉPART :
 * la recherche repart de la veille de ce jour (le moteur refuse de produire
 * avant, `avant-la-date-de-debut`), et le même balayage heure par heure
 * trouve l'instant où l'horloge locale affiche `runHour` le jour dit.
 */
function prochainDepartInstant(
  runHour: number,
  timezone: string,
  maintenant: Date = new Date(),
  startDate: string | null = null,
): Date {
  const heureLocale = (d: Date) => {
    try {
      return Number(new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', hour12: false, timeZone: timezone,
      }).format(d));
    } catch {
      return d.getUTCHours();
    }
  };
  const debut = sanitizeStartDate(startDate);
  const d = new Date(maintenant);
  d.setMinutes(0, 0, 0);
  // Toujours STRICTEMENT dans le futur : a l'heure pile, le passage courant
  // est deja fait ou en cours.
  d.setHours(d.getHours() + 1);
  if (debut && localDate(d.getTime(), timezone) < debut) {
    // La veille du jour de début, à midi UTC : au plus 36 h à balayer
    // jusqu'à `runHour` le jour dit, dans n'importe quel fuseau.
    d.setTime(Date.parse(`${debut}T12:00:00Z`) - 24 * 3_600_000);
    d.setMinutes(0, 0, 0);
    for (let i = 0; i < 72 && localDate(d.getTime(), timezone) < debut; i += 1) {
      d.setHours(d.getHours() + 1);
    }
  }
  for (let i = 0; i < 48 && heureLocale(d) !== runHour; i += 1) {
    d.setHours(d.getHours() + 1);
  }
  return d;
}

/** « lundi 5 octobre 2026 à 08:00 » — un instant, lu dans le fuseau demandé. */
function instantLisible(d: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  };
  try {
    return d.toLocaleString('fr-FR', { timeZone: timezone, ...options });
  } catch {
    return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', ...options });
  }
}

/** Prochain depart, en toutes lettres — voir `prochainDepartInstant`. */
function prochainDepart(
  runHour: number,
  timezone: string,
  maintenant: Date = new Date(),
  startDate: string | null = null,
): string {
  return instantLisible(prochainDepartInstant(runHour, timezone, maintenant, startDate), timezone);
}

/**
 * Les deux prochaines échéances : la PRODUCTION (l'instant où le moteur
 * tourne) et la PUBLICATION (le créneau du premier post qu'il déposera).
 *
 * ⚠️ LA PUBLICATION EST CALCULÉE PAR LA RÈGLE DU MOTEUR, `slotDate` : le
 * lendemain de la production chez l'utilisateur — ou la date de début si
 * elle est plus tard — à `publishTime`, minutes comprises. Une seconde
 * estimation écrite ici aurait fini par annoncer autre chose que ce que le
 * cron écrit dans `scheduled_date` / `scheduled_time`.
 */
function prochainesEcheances(
  config: Pick<AutopilotConfig, 'runHour' | 'runTimezone' | 'publishTime' | 'startDate'>,
  maintenant: Date = new Date(),
): { production: string; publicationDate: string; publicationTime: string; publication: string } {
  const instant = prochainDepartInstant(config.runHour, config.runTimezone, maintenant, config.startDate);
  const publicationDate = slotDate(instant, 0, config.runTimezone, config.startDate);
  const publicationTime = heurePublicationLisible(config);
  return {
    production: `${instantLisible(instant, config.runTimezone)} (${config.runTimezone})`,
    publicationDate,
    publicationTime,
    publication: `${dateLisible(publicationDate)} à ${publicationTime} (${config.runTimezone})`,
  };
}

/**
 * Ce que l'utilisateur doit pouvoir relire d'un coup d'oeil avant d'activer.
 *
 * ⚠️ LE RECAP EST COUPE EN DEUX, ET C'EST LE POINT. « Ce qui change » et « ce
 * qui ne change jamais » repondent a la seule question qu'on se pose avant
 * d'activer un pilote automatique : qu'est-ce qui va se ressembler d'une
 * video a l'autre ? Une liste unique de quinze lignes ne repondait pas.
 */
function RECAP_VARIABLE(config: AutopilotConfig): Array<[string, string]> {
  const n = config.rushUrls.length;
  return [
    ['Thèmes', config.topics.length === 0
      ? 'Tous (12 thèmes)'
      : config.topics.map(themeLabel).join(', ')],
    ['Affiche', config.posterMode === 'custom' && config.posterUrls.length > 0
      ? `Vos ${config.posterUrls.length} photo${config.posterUrls.length > 1 ? 's' : ''}, en rotation`
      : 'Choisie par Studiio selon le thème'],
    ['Textes', 'Différents à chaque vidéo'],
    ['Rushes', n === 0
      ? 'Aucun — rien ne sera produit'
      : n === 1
        ? '1 seul — il sera répété sur toutes les vidéos'
        : `${n} en rotation — jamais deux fois de suite le même`],
  ];
}

function RECAP_CONSTANT(
  config: AutopilotConfig,
  voix: VoixClonee[],
): Array<[string, string]> {
  const choisie = voixDeConfig(voix, config.voiceId);
  return [
    ['Couleurs', `${config.cardGradientStart} → ${config.cardGradientEnd}, titre ${config.titleColor}`],
    ['Fond des cartes', config.cardsShowPoster ? 'L’affiche' : 'Les couleurs choisies'],
    ['Musique', config.musicUrl ? `${nomDeFichier(config.musicUrl)} · ${pourcent(config.musicVolume)}` : 'Aucune'],
    ['Voix off', config.voiceEnabled
      ? `${choisie ? choisie.name : 'Voix par défaut'} · ${pourcent(config.voiceVolume)} (payante)`
      : 'Désactivée'],
    ['Son du rush', config.keepRushAudio ? `Gardé · ${pourcent(config.rushVolume)}` : 'Coupé'],
  ];
}

function RECAP_DIFFUSION(config: AutopilotConfig): Array<[string, string]> {
  const intention = intentionDiffusion(config);
  return [
    ['Rythme', CADENCE_LABELS[config.cadence]],
    // La date de début : « dès le prochain passage » sans date — le
    // comportement d'avant, dit tel quel plutôt que laissé vide.
    ['Date de début', config.startDate ? dateLisible(config.startDate) : 'Dès le prochain passage'],
    // Deux lignes, deux heures : la production et la publication ne sont
    // pas le même moment, et le récapitulatif les confondait.
    ['Heure de départ', `${heureLisible(config.runHour)} (${config.runTimezone})`],
    ['Heure de publication', `${heurePublicationLisible(config)} (${config.runTimezone}), le lendemain de la production`],
    ['Par cycle', `${config.countPerCycle} vidéo${config.countPerCycle > 1 ? 's' : ''}`],
    ['Diffusion', INTENTION_LABELS[intention]],
    ['Plateformes', config.platforms.length
      ? config.platforms.join(', ')
      : intention === 'produire'
        ? 'Aucune — brouillons à télécharger depuis le Calendrier'
        : 'Aucune — les vidéos restent dans le Calendrier'],
    ['Seuil de crédits', `${config.creditFloor} crédits`],
  ];
}

const PLATEFORMES = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'youtube', label: 'YouTube' },
];

export default function AutopilotPanel({
  accent, onConfigChange, onPatchReady, onSessionChange, onVideoLancee,
}: {
  accent: string;
  /**
   * Remonte le tournage regardé, et le départ d'une création.
   *
   * ⚠️ C'EST CE QUI PERMET UN SEUL APERÇU. Le lecteur de la vidéo produite
   * vit dans la colonne de droite, hors de cet arbre : sans ces deux signaux,
   * il faudrait un second lecteur ici — la duplication qu'on vient d'enlever.
   */
  onSessionChange?: (etat: { sessionId: string | null; aucunRush: boolean }) => void;
  onVideoLancee?: () => void;
  /**
   * Remonte la configuration à chaque changement — c'est ce qui alimente
   * l'aperçu de la colonne de droite.
   *
   * ⚠️ APPELÉ SUR L'ÉTAT LOCAL, PAS APRÈS L'ENREGISTREMENT. L'aperçu doit
   * suivre la roue chromatique PENDANT qu'on la tourne ; les couleurs, elles,
   * ne partent au serveur qu'au relâchement. Attendre la réponse aurait figé
   * l'aperçu pendant tout le réglage — exactement le moment où il sert.
   *
   * Absent, le panneau se comporte exactement comme avant.
   */
  onConfigChange?: (config: AutopilotConfig) => void;
  /**
   * Remonte la fonction d'enregistrement — c'est elle que l'aperçu appelle
   * pour écrire police, taille, positions et icônes.
   *
   * ⚠️ UN SEUL ÉCRIVAIN, ET C'EST CELUI-CI. L'aperçu vit dans une autre
   * colonne de l'écran ; lui donner son propre `fetch` aurait fait deux
   * sources de vérité pour la même configuration, et le dernier à écrire
   * aurait gagné au hasard des rendus. Il emprunte donc CETTE fonction —
   * celle qui possède déjà l'état, la fusion et l'appel réseau.
   *
   * Rappelé à chaque changement de `config` : `enregistrer` se referme
   * dessus, et une référence gardée trop longtemps enverrait une
   * configuration périmée.
   */
  onPatchReady?: (patch: (p: Partial<AutopilotConfig>) => void) => void;
}) {
  const [config, setConfig] = useState<AutopilotConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Quelle médiathèque est ouverte, et pour quoi.
   *
   * ⚠️ PAS UN BOOLEEN. Il y a maintenant DEUX points d'ouverture — les rushes
   * (vidéo) et la musique (audio) — et un seul drapeau les ferait s'ouvrir
   * ensemble, l'un filtré par le type de l'autre.
   */
  const [libOpen, setLibOpen] = useState<null | 'rush' | 'musique' | 'affiche'>(null);
  const [etape, setEtape] = useState(0);
  /**
   * Les « Réglages avancés » de l'étape Style sont-ils dépliés ? Le lecteur
   * du mixage n'existe QUE dépliés : replier le bloc doit couper le son, pas
   * le laisser jouer derrière un résumé.
   */
  const [avanceOuvert, setAvanceOuvert] = useState(false);
  const [themePerso, setThemePerso] = useState('');
  /** Les colonnes d'identité existent-elles en base ? Voir `brandingReady`. */
  const [identiteReady, setIdentiteReady] = useState(true);
  /** La colonne `publish_time` existe-t-elle ? Voir `publishTimeReady` dans la route. */
  const [heurePublicationReady, setHeurePublicationReady] = useState(true);
  /** La colonne `start_date` existe-t-elle ? Voir `startDateReady` dans la route. */
  const [dateDebutReady, setDateDebutReady] = useState(true);
  /**
   * « Produire un brouillon maintenant » — où en est-on.
   *
   *   repos → confirmation (le coût est affiché, rien n'est parti)
   *         → en-cours (UN POST en vol) → fait | erreur → repos.
   */
  const [produire, setProduire] = useState<
    | { etat: 'repos' }
    | { etat: 'confirmation' }
    | { etat: 'en-cours' }
    | { etat: 'fait'; postId: string | null; date: string; time: string; timezone: string; calendrierUrl: string }
    | { etat: 'erreur'; message: string }
  >({ etat: 'repos' });
  /**
   * ⚠️ VERROU SYNCHRONE CONTRE LE DOUBLE CLIC. `disabled` suit l'état React,
   * qui n'est pas encore rendu quand le second clic arrive dans la même
   * tâche ; la ref, elle, est lue et posée dans le gestionnaire lui-même.
   * Un seul `fetch` part, quoi qu'il arrive — et le serveur a son propre
   * verrou (409) derrière.
   */
  const produireEnVolRef = useRef(false);
  /**
   * Le DEVIS : le coût que le serveur débitera, tel qu'il le dit lui-même
   * (`GET /api/autopilot/produire-maintenant`). `null` tant qu'il n'a pas
   * répondu : l'écran écrit alors « Tarif confirmé au rendu » plutôt qu'un
   * nombre qu'il aurait inventé.
   */
  const [devis, setDevis] = useState<{ politique: Politique; cout: number; solde: number | null } | null>(null);
  /** La colonne `brief` existe-t-elle ? Voir `briefReady` dans la route. */
  const [briefReady, setBriefReady] = useState(true);
  /**
   * Le brief tel qu'il a été ENREGISTRÉ — pour n'envoyer un PUT à la perte
   * du focus que si quelque chose a changé, pas à chaque passage de champ.
   */
  const [briefEnregistre, setBriefEnregistre] = useState<string>('');
  /**
   * La carte d'intention que l'utilisateur a CLIQUÉE — `null` tant qu'il n'a
   * rien cliqué : on lit alors l'intention que dit la configuration.
   *
   * ⚠️ SANS CET ÉTAT, LE SÉLECTEUR DE RÉSEAUX DISPARAÎT POUR TOUJOURS.
   * L'intention se DÉRIVE de `(mode, platforms)` : `review` sans réseau se
   * lit « produire seulement », et c'est aussi la configuration PAR DÉFAUT.
   * Masquer les réseaux sur cette seule lecture rendrait impossible d'en
   * choisir un : cliquer « me laisser valider » n'écrit que `mode: review`,
   * qui ne change rien, et la lecture resterait « produire ». La carte
   * cliquée gouverne donc l'AFFICHAGE (carte en surbrillance, bloc des
   * réseaux) ; la configuration reste la seule vérité pour la phrase et le
   * récapitulatif.
   */
  const [intentionCliquee, setIntentionCliquee] = useState<AutopilotIntention | null>(null);
  const [voixClonees, setVoixClonees] = useState<VoixClonee[]>([]);
  /** La liste des voix a été relue (même vide) : le bloc Jumeau peut se prononcer. */
  const [voixChargees, setVoixChargees] = useState(false);
  /**
   * L'accessibilité de chaque rush de la banque : `true` accessible, `false`
   * expiré (404/410 au stockage), absent = pas encore vérifié.
   *
   * ⚠️ SIGNALER, JAMAIS EFFACER. Un rush sous la rétention de 24 h reste
   * écrit dans `rush_urls` alors que le fichier a disparu — l'utilisateur
   * croit alors « qu'il ne sert pas ». On le DIT ici (« expiré — réimportez-le »)
   * et on ne le retire que sur clic, via l'`enregistrer` habituel. Rien n'est
   * supprimé automatiquement.
   */
  const [rushAccessible, setRushAccessible] = useState<Record<string, boolean>>({});

  // ⚠️ UN SEUL POINT DE REMONTÉE, sur l'état lui-même. Le panneau écrit
  // `config` par une demi-douzaine de chemins — `enregistrer`, les roues
  // chromatiques, les curseurs du mixeur, la relecture au montage. Appeler le
  // parent depuis chacun d'eux aurait garanti qu'on en oublie un, et l'aperçu
  // aurait cessé de suivre ce réglage-là sans que rien ne le signale.
  useEffect(() => { onConfigChange?.(config); }, [config, onConfigChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/autopilot/config');
        const data = await res.json();
        if (cancelled) return;
        setReady(data?.ready !== false);
        setIdentiteReady(data?.brandingReady !== false);
        setHeurePublicationReady(data?.publishTimeReady !== false);
        setDateDebutReady(data?.startDateReady !== false);
        setBriefReady(data?.briefReady !== false);
        if (data?.config) {
          const propre = sanitizeConfig(data.config);
          setConfig(propre);
          setBriefEnregistre(JSON.stringify(propre.brief));
        }
      } catch {
        if (!cancelled) setReady(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Vérifie l'accessibilité des rushes de la banque — HEAD côté serveur, via
   * `POST /api/autopilot/rush/verifier`. Silencieux en cas d'échec : le
   * contrôle est un CONFORT, pas une condition ; sans lui, l'écran reste
   * exactement celui d'avant. Le serveur ne HEAD que les rushes du compte.
   */
  const verifierRushes = useCallback(async (urls: string[]) => {
    if (urls.length === 0) { setRushAccessible({}); return; }
    try {
      const res = await fetch('/api/autopilot/rush/verifier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.resultats && typeof data.resultats === 'object') {
        setRushAccessible(data.resultats as Record<string, boolean>);
      }
    } catch {
      // Réseau indisponible : on n'affiche aucun état plutôt qu'un faux
      // « expiré » — le doute profite au rush, comme côté serveur.
    }
  }, []);

  // ⚠️ REVÉRIFIE À CHAQUE CHANGEMENT DE LA BANQUE, pas seulement au montage :
  // un rush ajouté doit être contrôlé, et un rush retiré doit disparaître de
  // l'état. La clé jointe évite de relancer sur un rendu qui ne touche pas la
  // banque. Attend que la configuration soit lue (`ready`, `!loading`).
  const cleRushes = config.rushUrls.join('\n');
  useEffect(() => {
    if (loading || !ready) return;
    verifierRushes(config.rushUrls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleRushes, loading, ready, verifierRushes]);

  // Les voix clonées du compte. Silencieux en cas d'échec : le sélecteur
  // reste vide et l'Autopilote retombe sur la voix par défaut du serveur —
  // une liste indisponible ne doit pas empêcher de régler le reste.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/voice/clone')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.success && Array.isArray(d.voices)) setVoixClonees(d.voices as VoixClonee[]);
        setVoixChargees(true);
      })
      .catch(() => { if (!cancelled) setVoixChargees(true); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Enregistre. Le champ modifié est passé en argument plutôt que lu dans
   * l'état : un `setState` n'est pas encore visible dans la même tâche, et on
   * enverrait la valeur d'AVANT le clic.
   */
  const enregistrer = useCallback(async (patch: Partial<AutopilotConfig>) => {
    const suivant = sanitizeConfig({ ...config, ...patch });
    setConfig(suivant);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/autopilot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(suivant),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      if (data.config) setConfig(sanitizeConfig(data.config));
      // Le serveur dit s'il a pu écrire l'heure de publication : sans la
      // colonne, l'écran doit continuer à l'annoncer non conservée.
      if (typeof data.publishTimeReady === 'boolean') setHeurePublicationReady(data.publishTimeReady);
      if (typeof data.startDateReady === 'boolean') setDateDebutReady(data.startDateReady);
      if (typeof data.briefReady === 'boolean') setBriefReady(data.briefReady);
      setBriefEnregistre(JSON.stringify(suivant.brief));
      setNotice('Enregistré.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }, [config]);

  // ⚠️ APRES `enregistrer`, ET A CHAQUE CHANGEMENT. La fonction se referme sur
  // `config` : la publier une seule fois au montage aurait fige la
  // configuration de depart, et l'apercu aurait ecrase tous les reglages faits
  // entre-temps a chaque geste.
  useEffect(() => { onPatchReady?.(enregistrer); }, [enregistrer, onPatchReady]);

  const etat = statusMessage(config, Date.now(), (d) =>
    d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));

  /**
   * Ajoute des rushes à la banque — en UN enregistrement.
   *
   * Absolues d'abord : en production la Médiathèque peut recevoir une URL
   * relative du stockage, que `sanitizeConfig` (`^https?://`) écarterait
   * sans un mot. Dédoublonnées ensuite par clé d'objet : le même fichier
   * arrive en relatif par l'envoi et en absolu par la grille, et deux
   * écritures du même rush feraient tomber deux rangs de la rotation sur la
   * même vidéo.
   */
  const ajouterRushes = useCallback((urls: string[]) => {
    const absolues = urls
      .map((u) => urlPubliqueAbsolue(u, window.location.origin))
      .filter((u): u is string => !!u);
    if (absolues.length === 0) return;
    const banque = dedupeParCleObjet([...config.rushUrls, ...absolues]);
    // Rien de nouveau (le même rush re-choisi) : pas d'enregistrement pour rien.
    const avant = dedupeParCleObjet(config.rushUrls);
    if (banque.length === avant.length && banque.every((u, i) => u === avant[i])) return;
    enregistrer({ rushUrls: banque });
  }, [config.rushUrls, enregistrer]);

  /**
   * Ce que l'écoute du mixage doit rendre — LA MÊME CHOSE QUE LE RENDU.
   *
   * Le cron (`buildAutopilotDesign`) transmet trois volumes statiques et
   * `rushMuted: !keepRushAudio`, sans image-clé ; le serveur (`mixAt`) les
   * lit tels quels. Le lecteur, lui, ne connaît que des images-clés : une
   * seule, à t=0, portant ces mêmes valeurs, et le rush à 0 quand son son
   * est coupé — c'est ainsi que `rushMuted` s'entend. Un test de parité
   * vérifie que `mixAt(0, …)` donne les mêmes nombres.
   *
   * ⚠️ MÉMORISÉ : le lecteur redémarre à chaque changement d'IDENTITÉ du
   * tableau — un tableau neuf à chaque rendu le ferait repartir en boucle.
   */
  const imagesClesMixage = useMemo<AudioKeyframe[]>(() => [{
    id: 'autopilote-0',
    time: 0,
    musicVolume: config.musicVolume,
    rushVolume: config.keepRushAudio ? config.rushVolume : 0,
    voiceVolume: config.voiceVolume,
  }], [config.musicVolume, config.rushVolume, config.voiceVolume, config.keepRushAudio]);

  /**
   * Le rush que l'écoute fait entendre : celui que le cron prendrait au
   * prochain passage (`pickRush`, même règle) — et seulement si son son est
   * gardé. Aucune voix : elle n'existe pas avant le rendu payant
   * (`buildAutopilotVoices` ne tourne que dans le cron) et l'écoute ne
   * déclenche jamais une génération.
   */
  const rushEcoute = config.keepRushAudio
    ? (pickRush(config.rushUrls, config.lastRushUrl, 0) ?? null)
    : null;
  const dureesEcoute = useMemo(() => {
    const video = config.rushUrls.length > 0 ? RUSH_SEQUENCE_SECONDS.fallback : 0;
    const { intro, cards, cta } = DEFAULT_SEQUENCE_SECONDS;
    return { intro, cards, cta, video, videoStart: intro + cards, total: intro + cards + video + cta };
  }, [config.rushUrls.length]);

  /**
   * Les rushes reconnus expirés, et ceux qui restent — dérivés de l'état
   * d'accessibilité. `false` = 404/410 au stockage ; tout le reste (accessible
   * OU non encore vérifié) est traité comme vivant : on ne retire jamais un
   * rush sur un doute.
   */
  const rushExpires = config.rushUrls.filter((u) => rushAccessible[u] === false);
  const rushVivants = config.rushUrls.filter((u) => rushAccessible[u] !== false);

  /** Ajoute ou retire un theme de la rotation. */
  const basculerTheme = useCallback((topic: string) => {
    setConfig((c) => {
      const suivant = c.topics.includes(topic)
        ? c.topics.filter((t) => t !== topic)
        : [...c.topics, topic];
      enregistrer({ topics: suivant });
      return { ...c, topics: suivant };
    });
  }, [enregistrer]);

  const ajouterThemePerso = useCallback(() => {
    const propre = themePerso.trim().slice(0, 40);
    // Rien a ajouter, ou deja present : on vide le champ sans rien ecrire.
    if (propre && !config.topics.includes(propre)) basculerTheme(propre);
    setThemePerso('');
  }, [themePerso, config.topics, basculerTheme]);

  /** Thèmes écrits à la main — affichés en puces retirables. */
  const persos = config.topics.filter(isCustomTopic);

  /**
   * Le brief récurrent : la frappe ne fait que mettre l'état à jour ; la
   * perte de focus ENREGISTRE — et seulement si le brief a changé. Un PUT par
   * frappe aurait écrit la configuration entière des dizaines de fois par
   * phrase.
   */
  const poserBrief = useCallback((brief: AutopilotConfig['brief']) => {
    setConfig((c) => ({ ...c, brief }));
  }, []);
  const enregistrerBrief = useCallback((brief: AutopilotConfig['brief']) => {
    const propre = sanitizeConfig({ ...config, brief }).brief;
    if (JSON.stringify(propre) === briefEnregistre) return;
    enregistrer({ brief: propre });
  }, [config, briefEnregistre, enregistrer]);

  // L'etape des rushes est la seule qui BLOQUE : sans rush, l'Autopilote ne
  // produit rien, et le laisser avancer serait promettre une production qui
  // n'aura pas lieu.
  const bloqueEtape = etape === 1 && config.rushUrls.length === 0;

  /**
   * Le devis de « Produire un brouillon maintenant » — demandé UNE fois, à
   * l'ouverture de la confirmation, pas au montage : la plupart des visites
   * ne cliquent pas. Un échec laisse `devis` à `null` : « Tarif confirmé au
   * rendu », jamais un chiffre deviné.
   */
  useEffect(() => {
    if (produire.etat !== 'confirmation' || devis) return;
    let vivant = true;
    fetch('/api/autopilot/produire-maintenant')
      .then((r) => r.json())
      .then((d) => {
        if (!vivant || !d?.success || typeof d.cout !== 'number') return;
        setDevis({
          politique: politiqueAffichable(d.politique),
          cout: d.cout,
          solde: typeof d.solde === 'number' ? d.solde : null,
        });
      })
      .catch(() => { /* « Tarif confirmé au rendu » */ });
    return () => { vivant = false; };
  }, [produire.etat, devis]);

  /**
   * Lance UNE production manuelle — brouillon forcé, aucun réseau.
   *
   * ⚠️ LA REF EST LUE ET POSÉE ICI, SYNCHRONEMENT, avant tout `await` : deux
   * clics dans la même tâche ne peuvent pas passer tous les deux. Le
   * `disabled` du bouton est un confort visuel ; c'est la ref qui garantit
   * qu'un seul POST part.
   */
  const produireMaintenant = useCallback(async () => {
    if (produireEnVolRef.current) return;
    produireEnVolRef.current = true;
    setProduire({ etat: 'en-cours' });
    setError(null);
    try {
      const res = await fetch('/api/autopilot/produire-maintenant', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      setProduire({
        etat: 'fait',
        postId: typeof data.postId === 'string' ? data.postId : null,
        date: String(data.scheduledDate ?? ''),
        time: String(data.scheduledTime ?? ''),
        timezone: String(data.timezone ?? config.runTimezone),
        calendrierUrl: typeof data.calendrierUrl === 'string' ? data.calendrierUrl : '/dashboard/calendar',
      });
      // Le solde a bougé : le prochain devis le relit.
      setDevis(null);
    } catch (err) {
      setProduire({ etat: 'erreur', message: err instanceof Error ? err.message : 'Production impossible.' });
    } finally {
      produireEnVolRef.current = false;
    }
  }, [config.runTimezone]);

  /**
   * Le bloc « prochaines échéances » + « Produire un brouillon maintenant »,
   * rendu à l'étape Publication ET à l'étape Vérification. Une fonction et
   * non un composant : il lit l'état du panneau (devis, production) et n'a
   * pas d'état propre — un composant aurait demandé huit props pour le même
   * résultat.
   */
  const rendreProchaines = () => {
    const echeances = prochainesEcheances(config);
    const sansRush = config.rushUrls.length === 0;
    return (
      <div className="space-y-2">
        {/* ── Les DEUX prochaines échéances, une par ligne ───────────────
            Production = l'instant où le moteur tourne ; publication = le
            créneau du premier post, calculé par la règle du moteur
            (`slotDate`). Deux lignes, parce que ce sont deux moments. */}
        <dl
          className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-[11px] space-y-1"
          data-autopilot-prochaines
        >
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500 shrink-0">Prochaine production</dt>
            <dd className="text-right text-gray-200" data-autopilot-prochaine-production>{echeances.production}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500 shrink-0">Prochaine publication</dt>
            <dd
              className="text-right text-gray-200"
              data-autopilot-prochaine-publication
              data-date={echeances.publicationDate}
              data-time={echeances.publicationTime}
            >
              {echeances.publication}
            </dd>
          </div>
          {!config.enabled && (
            <p className="text-[10px] text-gray-500 pt-0.5">
              En pause : ces échéances valent une fois l’Autopilote lancé.
            </p>
          )}
        </dl>

        {/* ── Produire un brouillon MAINTENANT ───────────────────────────
            Ni l'heure de production ni celle de publication ne sont des
            commandes : ce bouton, seul, produit tout de suite. Brouillon
            forcé, aucun réseau, coût annoncé AVANT — et un seul POST, quoi
            qu'on clique. */}
        {produire.etat === 'repos' || produire.etat === 'fait' || produire.etat === 'erreur' ? (
          <button
            type="button"
            onClick={() => setProduire({ etat: 'confirmation' })}
            disabled={!ready || sansRush}
            title={sansRush ? 'Ajoutez au moins un rush pour produire.' : undefined}
            data-autopilot-produire-maintenant
            className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            Produire un brouillon maintenant
          </button>
        ) : null}
        {produire.etat === 'confirmation' && (
          <div
            className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-3 space-y-2 text-xs"
            data-autopilot-produire-confirmation
          >
            <p className="text-purple-100">
              Une vidéo est rendue tout de suite avec vos rushes et votre style,
              puis déposée en <strong>brouillon</strong> dans le Calendrier, sans
              aucun réseau : rien ne sera publié.
            </p>
            <p className="text-purple-100" data-autopilot-produire-cout>
              Coût : <strong>{devis
                ? annonceCout(devis.politique, { reel: devis.cout, tv: devis.cout }, 'reel', 1)
                : annonceCout('credits', null, 'reel', 1)}</strong>
              {devis?.solde !== null && devis?.solde !== undefined && devis.politique === 'credits'
                ? ` · solde actuel : ${devis.solde} crédits`
                : ''}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void produireMaintenant(); }}
                disabled={!ready || sansRush}
                data-autopilot-produire-confirmer
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                style={{ backgroundColor: accent }}
              >
                Lancer le rendu
              </button>
              <button
                type="button"
                onClick={() => setProduire({ etat: 'repos' })}
                data-autopilot-produire-annuler
                className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
        {produire.etat === 'en-cours' && (
          <p className="flex items-center gap-1.5 text-xs text-gray-300" data-autopilot-produire-en-cours>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Rendu en cours — quelques minutes. Vous pouvez continuer à régler l’Autopilote.
          </p>
        )}
        {produire.etat === 'fait' && (
          <p className="flex items-start gap-1.5 text-xs text-emerald-400" data-autopilot-produire-resultat data-post-id={produire.postId ?? ''}>
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Brouillon déposé dans le Calendrier le {produire.date ? dateLisible(produire.date) : 'aujourd’hui'}
              {produire.time ? ` à ${produire.time}` : ''} ({produire.timezone}).
              {' '}
              <a href={produire.calendrierUrl} className="underline hover:text-white" data-autopilot-produire-lien>
                <CalendarDays className="inline w-3.5 h-3.5 mr-0.5 align-text-bottom" />Ouvrir le Calendrier
              </a>
            </span>
          </p>
        )}
        {produire.etat === 'erreur' && (
          <p className="flex items-start gap-1.5 text-xs text-red-400" data-autopilot-produire-erreur>
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {produire.message}
          </p>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-4" data-autopilot-panel>
      {!ready && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          L’Autopilote n’est pas encore disponible sur ce serveur : la migration
          <code className="mx-1">autopilot_config</code> n’a pas été appliquée.
        </p>
      )}
      {/* Le DIRE plutôt que de laisser croire que c'est enregistré : sans les
          colonnes, l'écran accepte les réglages de style et le serveur les
          jette. Un formulaire silencieusement sans effet est pire qu'un
          formulaire absent. */}
      {ready && !identiteReady && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400" data-autopilot-identite-absente>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Couleurs, musique, voix et mixeur ne seront pas conservés : la migration
          <code className="mx-1">2026-08-07-autopilot-branding</code> n’a pas été appliquée.
        </p>
      )}

      {/* ── Fil d'Ariane ─────────────────────────────────────────────── */}
      <ol className="flex items-center gap-1" data-autopilot-etapes>
        {ETAPES.map((e, i) => {
          const courante = i === etape;
          const franchie = i < etape;
          return (
            <li key={e.titre} className="flex-1">
              <button
                type="button"
                onClick={() => setEtape(i)}
                disabled={!ready}
                aria-current={courante ? 'step' : undefined}
                data-autopilot-etape={i}
                title={e.titre}
                className={`w-full rounded-full transition disabled:opacity-40 ${
                  courante ? 'h-1.5' : 'h-1'
                }`}
                style={{
                  backgroundColor: courante || franchie ? accent : '#1F2937',
                  opacity: franchie ? 0.55 : 1,
                }}
              />
            </li>
          );
        })}
      </ol>
      {/* Les NOMS des etapes, pas seulement des barres : ou l'on est, ce qui
          est fait, ce qui vient. Sur mobile, une ligne compacte dit la meme
          chose. */}
      <ol className="hidden sm:flex items-center gap-1 text-[10px]" data-autopilot-etapes-noms>
        {ETAPES.map((e, i) => (
          <li
            key={e.titre}
            className={`flex-1 truncate ${i === etape ? 'text-white font-medium' : i < etape ? 'text-gray-400' : 'text-gray-600'}`}
            aria-current={i === etape ? 'step' : undefined}
          >
            {i < etape ? '✓ ' : `${i + 1}. `}{e.titre}
          </li>
        ))}
      </ol>
      <p className="sm:hidden text-[11px] text-gray-400" data-autopilot-etapes-compact>
        Étape {etape + 1} sur {ETAPES.length} · <span className="text-white">{ETAPES[etape].titre}</span>
        {etape < ETAPES.length - 1 && <> — Prochaine : {ETAPES[etape + 1].titre}</>}
      </p>

      {/* UX : CHAQUE ecran = un objectif (la question), une explication tres
          courte, puis une action principale. Meme place, meme forme. */}
      <div data-autopilot-a-faire>
        <p className="text-sm font-medium text-white">{ETAPES[etape].question}</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{ETAPES[etape].aide}</p>
      </div>

      {/* ── Étape 1 · Thèmes ─────────────────────────────────────────── */}
      {etape === 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400" data-autopilot-topics-compte>
            {config.topics.length === 0
              ? 'Aucun sujet choisi : Studiio fait tourner les douze thèmes. Cochez-en pour le restreindre.'
              : `${config.topics.length} thème${config.topics.length > 1 ? 's' : ''} sélectionné${config.topics.length > 1 ? 's' : ''}.`}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {THEMES.map((t) => {
              const retenu = config.topics.includes(t.topic);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => basculerTheme(t.topic)}
                  disabled={!ready || saving}
                  aria-pressed={retenu}
                  data-autopilot-topic={t.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${classesCarteOption(retenu)}`}
                >
                  <CardIcon name={t.icon} size={14} color={retenu ? accent : '#9CA3AF'} className="" />
                  <span className="text-[11px] leading-tight">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Thèmes écrits à la main — le pendant du `customTopic` de Créer
              simple, mais cumulable puisque l'Autopilote tourne. */}
          <div>
            <label htmlFor="autopilot-topic-perso" className="block text-xs font-medium text-gray-300 mb-1.5">
              Ajouter un thème
            </label>
            <div className="flex gap-1.5">
              <input
                id="autopilot-topic-perso"
                type="text"
                value={themePerso}
                onChange={(e) => setThemePerso(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterThemePerso(); } }}
                placeholder="Ex. : récupération après le sport"
                disabled={!ready || saving}
                data-autopilot-topic-input
                className="flex-1 rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              />
              <button
                type="button"
                onClick={ajouterThemePerso}
                disabled={!ready || saving || !themePerso.trim()}
                data-autopilot-topic-add
                className="rounded-lg border border-gray-800 px-2.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {persos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {persos.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-full border border-gray-800 bg-gray-900 px-2 py-1 text-[11px] text-gray-300"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => basculerTheme(t)}
                      disabled={saving}
                      aria-label={`Retirer ${t}`}
                      className="text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── BRIEF RÉCURRENT ──────────────────────────────────────
              Le sujet dit DE QUOI parle chaque vidéo ; le brief dit ce
              qu'elles doivent toutes transmettre, à qui, et vers quoi. Il
              est commun à toutes les vidéos ; le script de chacune est
              généré à sa production. Rien n'est généré ni facturé ici. */}
          {ready && !briefReady && (
            <p className="flex items-start gap-1.5 text-xs text-amber-400" data-autopilot-brief-absent>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Le brief ne sera pas conservé : la migration
              <code className="mx-1">2026-09-21-autopilot-brief</code> n’a pas été appliquée.
            </p>
          )}
          <BriefVideo
            brief={config.brief}
            onChange={poserBrief}
            onCommit={enregistrerBrief}
            disabled={!ready || saving}
            titre="Brief récurrent"
            aide="Commun à toutes les vidéos produites. Le script de chaque vidéo est généré à sa production, à partir de ce brief et du sujet du jour."
            idPrefix="autopilot-brief"
          />
          <BriefRecurrentRecap brief={config.brief} />
        </div>
      )}

      {/* ── Étape 2 · Vos rushes ─────────────────────────────────────── */}
      {etape === 1 && (
        <div className="space-y-3">
{/* ── Banque de rushes ─────────────────────────────────────────── */}
          <div>
            {/* L'etat en un mot, puis L'ACTION. Sans rush, « Ajouter des
                rushes » est LE bouton principal de l'ecran ; avec, il
                redevient secondaire et « Continuer vers Style » prend
                la place. */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-gray-300" data-autopilot-rushes-etat={config.rushUrls.length > 0 ? 'pret' : 'a-faire'}>
                Banque de rushes
                <span className={`ml-1.5 ${config.rushUrls.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {config.rushUrls.length === 0
                    ? '0 rush — au moins un est nécessaire'
                    : `${config.rushUrls.length} rush${config.rushUrls.length > 1 ? 'es' : ''} prêt${config.rushUrls.length > 1 ? 's' : ''}`}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setLibOpen('rush')}
                disabled={!ready || saving}
                data-autopilot-add-rush
                data-cta={config.rushUrls.length === 0 ? 'principal' : 'secondaire'}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                  config.rushUrls.length === 0
                    ? 'text-white'
                    : 'border border-gray-800 text-gray-300 hover:text-white hover:border-gray-700'
                }`}
                style={config.rushUrls.length === 0 ? { backgroundColor: accent } : undefined}
              >
                <Plus className="w-3 h-3" /> Ajouter des rushes
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mb-2">
              L’Autopilote y pioche à tour de rôle pour chaque vidéo. Sans rush, il ne produit rien —
              il vous le dira plutôt que de générer des montages sans image.
            </p>
            {/* ⚠️ LA LIMITE DU RUSH UNIQUE, DITE AVANT QU'ELLE SURPRENNE.
                Avec un seul rush, la rotation n'a pas le choix : toutes les
                vidéos partagent la même séquence vidéo. L'utilisateur qui
                attendait « des rushes différents » doit l'apprendre ici, pas
                en découvrant deux montages identiques dans son Calendrier. */}
            {config.rushUrls.length === 1 && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mb-2" data-autopilot-rush-unique>
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                Un seul rush : il sera repris sur toutes les vidéos. Ajoutez-en un
                second pour qu’ils alternent.
              </p>
            )}
            {/* ⚠️ RETRAIT DES EXPIRÉS EN UN CLIC, ET EN UN SEUL `enregistrer`.
                Un rush « expiré » a disparu du stockage (rétention 24 h) mais
                traîne encore dans la banque ; l'utilisateur ne peut pas le
                deviner. Le bouton retire TOUS les expirés d'un coup —
                `rushVivants` est calculé sur l'état d'accessibilité, jamais
                une suppression automatique. */}
            {rushExpires.length > 0 && (
              <div className="flex items-start justify-between gap-2 mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5" data-autopilot-rush-expire-lot>
                <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {rushExpires.length === 1
                    ? '1 rush a expiré (rétention 24 h) et n’est plus utilisé — réimportez-le.'
                    : `${rushExpires.length} rushes ont expiré (rétention 24 h) et ne sont plus utilisés — réimportez-les.`}
                </p>
                <button
                  type="button"
                  onClick={() => enregistrer({ rushUrls: rushVivants })}
                  disabled={saving}
                  data-autopilot-retirer-expires
                  className="shrink-0 rounded-lg border border-amber-500/50 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                >
                  Retirer {rushExpires.length > 1 ? 'les expirés' : 'l’expiré'}
                </button>
              </div>
            )}
            {config.rushUrls.length > 0 && (
              <ul className="space-y-1">
                {config.rushUrls.map((url) => {
                  const expire = rushAccessible[url] === false;
                  const verifie = url in rushAccessible;
                  return (
                    <li
                      key={url}
                      className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 border ${
                        expire ? 'bg-amber-500/5 border-amber-500/40' : 'bg-gray-900 border-gray-800'
                      }`}
                    >
                      <span className="flex flex-col min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                          <Film className="w-3 h-3 shrink-0" />
                          <span className="truncate">{url.split('/').pop()}</span>
                        </span>
                        {/* L'état, sous le nom : « accessible » ou « expiré ». Tant que
                            la vérification n'a pas répondu, on n'affiche rien plutôt
                            qu'un état faux. */}
                        {expire ? (
                          <span className="ml-5 text-[10px] text-amber-400" data-autopilot-rush-expire={url}>
                            Expiré (rétention 24 h) — réimportez-le
                          </span>
                        ) : verifie ? (
                          <span className="ml-5 text-[10px] text-emerald-500/80" data-autopilot-rush-accessible={url}>
                            Accessible
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => enregistrer({ rushUrls: config.rushUrls.filter((u) => u !== url) })}
                        disabled={saving}
                        aria-label="Retirer ce rush"
                        className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {/* ⚠️ UN SEUL `enregistrer` POUR TOUT LE LOT. `enregistrer` se
                referme sur `config` : N appels dans la même tâche liraient
                tous la MÊME banque de départ, et seul le dernier rush
                survivrait. `onSelectMany` livre le lot en un appel. Le clic
                sur la grille (`onSelect`) reste le chemin d'un rush à la fois. */}
            <MediaLibrary
              isOpen={libOpen === 'rush'}
              onClose={() => setLibOpen(null)}
              mediaType="video"
              onSelect={(url) => {
                setLibOpen(null);
                if (url) ajouterRushes([url]);
              }}
              onSelectMany={(items) => ajouterRushes(items.map((i) => i.url))}
            />
          </div>

{/* ── VIDEO PONCTUELLE A PARTIR D'UN RUSH (sessions de tournage) ───
              Le socle M3-A, INTACT — mais repliee et nommee pour ce qu'elle
              est : un parcours ponctuel (analyser un rush, choisir des
              passages, produire UNE video), independant de la rotation de
              l'Autopilote. Placee au-dessus de la banque, avec ses boutons
              violets par rush, elle passait pour l'etape obligatoire. */}
          <details className="rounded-xl border border-gray-800 bg-gray-900/30" data-autopilot-sessions>
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-300 hover:text-white">
              Créer une vidéo manuellement à partir d’un rush
              <span className="ml-1.5 font-normal text-gray-500">— facultatif, indépendant de l’Autopilote</span>
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <p className="text-[11px] text-gray-500">
                Analysez un rush, laissez Studiio proposer les meilleurs passages, puis
                générez une vidéo de ce rush. L’Autopilote, lui, n’a pas besoin de cette
                étape : il pioche dans la banque ci-dessus.
              </p>
              <SessionsTournagePanel
                montageDefaut={montageDepuisStyle(config.designStyle)}
                onEnregistrerDefaut={(m) => enregistrer({
                  // ⚠️ FUSION, JAMAIS REMPLACEMENT : `designStyle` porte aussi
                  // les polices et les icônes de cartes. Les écraser ici les
                  // perdrait sans un mot.
                  designStyle: { ...config.designStyle, montage: m },
                })}
                onSessionChange={onSessionChange}
                onVideoLancee={onVideoLancee}
              />
            </div>
          </details>

        </div>
      )}

      {/* ── Étape 3 · Style & médias — L'IDENTITÉ CONSTANTE ───────────
          Tout ce qui est réglé ici vaut pour TOUTES les futures vidéos. Le
          reste du wizard décrit ce qui varie ; cette étape, ce qui reste. */}
      {etape === 2 && (
        <div className="space-y-4">
          {/* ESSENTIEL : ce que l'utilisateur choisit vraiment. Le reste a une
              valeur recommandee et vit replie plus bas. */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500" data-autopilot-style-essentiel>
            Essentiel
          </p>

{/* ── VOS AFFICHES ─────────────────────────────────────────────
              ⚠️ L'AUTOPILOTE CHOISISSAIT SEUL. Il cherche une photo chez
              Pexels a partir du theme — un bon defaut, et ce n'en est qu'un :
              une marque qui a ses propres visuels veut les siens.

              Ici, et non dans une etape de plus : c'est la meme idee que la
              banque de rushes, au meme endroit. Le wizard reste a six
              etapes. */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Affiches</p>
            <div className="grid grid-cols-2 gap-1.5">
              {POSTER_MODES.map((m: AutopilotPosterMode) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => enregistrer({ posterMode: m })}
                  disabled={!ready || saving}
                  aria-pressed={config.posterMode === m}
                  data-autopilot-poster-mode={m}
                  className={`rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-40 ${
                    config.posterMode === m
                      ? 'border-purple-500/50 bg-gray-800'
                      : 'border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium">
                    {m === 'auto'
                      ? <Sparkles className="w-3 h-3" />
                      : <ImageIcon className="w-3 h-3" />}
                    {POSTER_MODE_LABELS[m]}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              {POSTER_MODE_HINTS[config.posterMode]}
            </p>

            {config.posterMode === 'custom' && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[11px] text-gray-400">
                    Vos affiches <span className="text-gray-500">({config.posterUrls.length})</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setLibOpen('affiche')}
                    disabled={!ready || saving}
                    data-autopilot-add-poster
                    className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Ajouter
                  </button>
                </div>
                {config.posterUrls.length === 0 ? (
                  // ⚠️ ON LE DIT PLUTOT QUE DE PRODUIRE UN MONTAGE SANS
                  // AFFICHE : le moteur retombe sur la recherche par theme
                  // tant que la banque est vide.
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-400">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    Aucune affiche : Studiio continue de les chercher par thème
                    tant que vous n’en ajoutez pas.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {config.posterUrls.map((url) => (
                        <li
                          key={url}
                          className="flex items-center justify-between gap-2 rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5"
                        >
                          <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                            <ImageIcon className="w-3 h-3 shrink-0" />
                            <span className="truncate">{nomDeFichier(url)}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => enregistrer({
                              posterUrls: config.posterUrls.filter((u) => u !== url),
                            })}
                            disabled={saving}
                            aria-label="Retirer cette affiche"
                            className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {config.posterUrls.length === 1 && (
                      <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mt-2">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        Une seule affiche : elle sera reprise sur toutes les vidéos.
                      </p>
                    )}
                  </>
                )}
                <MediaLibrary
                  isOpen={libOpen === 'affiche'}
                  onClose={() => setLibOpen(null)}
                  mediaType="image"
                  onSelect={(url) => {
                    setLibOpen(null);
                    if (url) enregistrer({ posterUrls: [...config.posterUrls, url] });
                  }}
                />
              </div>
            )}
          </div>

{/* ── Couleurs ─────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Couleurs des cartes</p>
            <div className="grid grid-cols-2 gap-3">
              <div data-autopilot-color-start>
                <ColorWheel
                  color={config.cardGradientStart}
                  onChange={(c) => setConfig((x) => ({ ...x, cardGradientStart: c }))}
                  label="Dégradé — début"
                />
              </div>
              <div data-autopilot-color-end>
                <ColorWheel
                  color={config.cardGradientEnd}
                  onChange={(c) => setConfig((x) => ({ ...x, cardGradientEnd: c }))}
                  label="Dégradé — fin"
                />
              </div>
            </div>
            <div className="mt-3" data-autopilot-color-title>
              <ColorWheel
                color={config.titleColor}
                onChange={(c) => setConfig((x) => ({ ...x, titleColor: c }))}
                label="Couleur du titre"
              />
            </div>
            {/* ⚠️ ENREGISTREMENT AU RELACHEMENT, PAS A CHAQUE PIXEL. Une roue
                chromatique émet une couleur par mouvement de souris :
                enregistrer sur `onChange` enverrait des centaines de requêtes
                pour un seul choix. L'état bouge en direct, la base au
                relâchement — comme le seuil de crédits juste à côté. */}
            <button
              type="button"
              onClick={() => enregistrer({
                cardGradientStart: config.cardGradientStart,
                cardGradientEnd: config.cardGradientEnd,
                titleColor: config.titleColor,
              })}
              disabled={!ready || saving}
              data-autopilot-colors-save
              className="mt-3 w-full rounded-lg border border-gray-800 px-3 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les couleurs'}
            </button>
          </div>

{/* ── Fond des cartes ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Fond des cartes</p>
            <button
              type="button"
              onClick={() => enregistrer({ cardsShowPoster: !config.cardsShowPoster })}
              disabled={!ready || saving}
              aria-pressed={config.cardsShowPoster}
              data-autopilot-cards-poster
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.cardsShowPoster ? 'border-purple-500/50 bg-gray-800' : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.cardsShowPoster ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.cardsShowPoster ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <ImageIcon className="w-3.5 h-3.5" />
                  Afficher l’affiche derrière les cartes
                </span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.cardsShowPoster
                    ? 'Les cartes se posent sur la photo d’affiche.'
                    : 'Les cartes se posent sur vos couleurs. L’affiche reste sur la séquence titre.'}
                </span>
              </span>
            </button>
          </div>

{/* ── RÉGLAGES AVANCÉS ──────────────────────────────────────────
              Musique, voix clonee, son du rush, mixeur : chacun a deja une
              valeur recommandee. Replies : l'utilisateur ne doit pas croire
              qu'il doit regler chaque curseur pour continuer. Rien n'est
              retire — les memes reglages, les memes gestionnaires. */}
          <details
            className="rounded-xl border border-gray-800 bg-gray-900/30"
            data-autopilot-style-avance
            open={avanceOuvert}
            // `toggle` est l'événement natif du <details> : il part au clic
            // sur le résumé comme à une ouverture programmée.
            onToggle={(e) => setAvanceOuvert((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-300 hover:text-white">
              Réglages avancés
              <span className="ml-1.5 font-normal text-gray-500">— musique, voix, son du rush, mixeur</span>
            </summary>
            <div className="px-3 pb-3 space-y-4">
              <p className="text-[11px] text-gray-500" data-autopilot-style-recommande>
                Valeurs actuelles : {RECAP_CONSTANT(config, voixClonees)
                  .filter(([cle]) => cle !== 'Couleurs' && cle !== 'Fond des cartes')
                  .map(([cle, v]) => `${cle.toLowerCase()} ${v.toLowerCase()}`).join(' · ')}.
                Vous pouvez les laisser telles quelles.
              </p>
{/* ── Musique ──────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-gray-300">Musique</p>
              <button
                type="button"
                onClick={() => setLibOpen('musique')}
                disabled={!ready || saving}
                data-autopilot-add-music
                className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-3 h-3" /> {config.musicUrl ? 'Changer' : 'Choisir'}
              </button>
            </div>
            {config.musicUrl ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5">
                <span className="flex items-center gap-1.5 min-w-0 text-[11px] text-gray-300">
                  <Music className="w-3 h-3 shrink-0" />
                  <span className="truncate">{nomDeFichier(config.musicUrl)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => enregistrer({ musicUrl: null })}
                  disabled={saving}
                  aria-label="Retirer la musique"
                  data-autopilot-remove-music
                  className="text-gray-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">
                Aucune musique — les vidéos sortiront sans fond sonore.
              </p>
            )}
            <MediaLibrary
              isOpen={libOpen === 'musique'}
              onClose={() => setLibOpen(null)}
              mediaType="audio"
              onSelect={(url) => {
                setLibOpen(null);
                if (url) enregistrer({ musicUrl: url });
              }}
            />
          </div>

{/* ── Mon jumeau ──────────────────────────────────────────────────
              Le meme etat serveur que dans Creer une video. L'interrupteur
              branche ce que le cron sait faire : la VOIX du jumeau (voiceEnabled
              + voiceId) — la video de l'avatar reste un chemin de Creer une video,
              et le bloc le dit. */}
          <JumeauAutopilote
            actif={config.voiceEnabled && !!voixDeConfig(voixClonees, config.voiceId)}
            voixCompte={voixChargees ? voixClonees : null}
            onChange={(actif, voixId) => {
              // `voixId` est TOUJOURS l'identifiant Studiio (`elevenlabs-…`) résolu par le bloc.
              if (actif && voixId) enregistrer({ voiceEnabled: true, voiceId: voixId });
              else enregistrer({ voiceEnabled: false });
            }}
          />

{/* ── Voix off clonée ──────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Voix off clonée</p>
            {voixClonees.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                Aucune voix clonée. Rendez-vous dans <span className="text-gray-300">Mon avatar</span> pour
                en enregistrer une — sans elle, la narration utilise la voix par défaut.
              </p>
            ) : (
              <>
                <select
                  id="autopilot-voice-id"
                  value={voixDeConfig(voixClonees, config.voiceId)?.id ?? ''}
                  onChange={(e) => enregistrer({ voiceId: e.target.value || null })}
                  disabled={!ready || saving}
                  data-autopilot-voice-id
                  className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
                >
                  <option value="">Voix par défaut</option>
                  {voixClonees.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}{v.lang ? ` (${v.lang})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  La même voix sur toutes les séquences de toutes les vidéos.
                </p>
              </>
            )}
            {!config.voiceEnabled && (
              <p className="flex items-start gap-1.5 text-[11px] text-gray-500 mt-1.5">
                <Mic className="w-3 h-3 mt-0.5 shrink-0" />
                La narration est désactivée : activez-la à l’étape <span className="text-gray-300">Options</span> pour
                que ce choix serve.
              </p>
            )}
          </div>

{/* ── Son du rush ──────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Son du rush</p>
            <button
              type="button"
              onClick={() => enregistrer({ keepRushAudio: !config.keepRushAudio })}
              disabled={!ready || saving}
              aria-pressed={config.keepRushAudio}
              data-autopilot-keep-rush-audio
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.keepRushAudio ? 'border-purple-500/50 bg-gray-800' : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.keepRushAudio ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.keepRushAudio ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">Garder le son du rush</span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.keepRushAudio
                    ? 'L’ambiance du rush se mélange à la musique et à la voix.'
                    : 'La séquence vidéo est muette : seules la musique et la voix s’entendent.'}
                </span>
              </span>
            </button>
          </div>

{/* ── Mixeur ───────────────────────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-1">Mixeur</p>
            <p className="text-[11px] text-gray-500 mb-2">
              Ces niveaux valent pour toutes les vidéos.
            </p>
            <div className="space-y-3">
              {/* ⚠️ L'ICONE EST RENDUE ICI, PAS PASSEE DANS LA TABLE. Un
                  composant destructure sous un nom local (`icone: Icone`) est
                  invisible au garde-fou « aucun composant employé sans être
                  défini » : il le lit comme un identifiant jamais importé.
                  Le garde a raison de ne pas savoir — c'est à ce code de
                  rester lisible pour lui. */}
              {([
                { cle: 'musicVolume', label: 'Musique', actif: true },
                { cle: 'voiceVolume', label: 'Voix off', actif: true },
                // ⚠️ GRISE, PAS CACHE. Le niveau du rush reste visible quand
                // le son est coupé : le masquer ferait croire qu'il n'existe
                // pas, et le réglage serait perdu de vue en le rallumant.
                { cle: 'rushVolume', label: 'Son du rush', actif: config.keepRushAudio },
              ] as const).map(({ cle, label, actif }) => (
                <div key={cle}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label
                      htmlFor={`autopilot-${cle}`}
                      className={`flex items-center gap-1.5 text-[11px] ${actif ? 'text-gray-300' : 'text-gray-600'}`}
                    >
                      {cle === 'musicVolume' && <Music className="w-3 h-3" />}
                      {cle === 'voiceVolume' && <Mic className="w-3 h-3" />}
                      {cle === 'rushVolume' && <Film className="w-3 h-3" />}
                      {label}
                    </label>
                    <span className={`text-[11px] tabular-nums ${actif ? 'text-gray-400' : 'text-gray-600'}`}>
                      {pourcent(config[cle])}
                    </span>
                  </div>
                  <input
                    id={`autopilot-${cle}`}
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(config[cle] * 100)}
                    onChange={(e) => setConfig((x) => ({ ...x, [cle]: Number(e.target.value) / 100 }))}
                    // Le relâchement enregistre — pas chaque pas du curseur.
                    onMouseUp={() => enregistrer({ [cle]: config[cle] })}
                    onTouchEnd={() => enregistrer({ [cle]: config[cle] })}
                    onKeyUp={() => enregistrer({ [cle]: config[cle] })}
                    disabled={!ready || saving || !actif}
                    data-autopilot-volume={cle}
                    className="w-full accent-purple-500 disabled:opacity-40"
                  />
                </div>
              ))}
            </div>
          </div>

{/* ── Écouter le mixage ────────────────────────────────────────────
              Le même lecteur que Créer une vidéo, sur les niveaux du mixeur
              ci-dessus. Rendu SEULEMENT quand le bloc est déplié : replier
              le démonte, et le démonter coupe le son (nettoyage complet
              de `AudioMixPreview`). Changer d'étape le démonte aussi. */}
          {avanceOuvert && (
            <div data-autopilot-ecoute-mixage>
              <p className="text-xs font-medium text-gray-300 mb-1">Écoute</p>
              {(config.musicUrl || rushEcoute) ? (
                <>
                  <p className="text-[11px] text-gray-500">
                    Les niveaux du mixeur, sur {config.musicUrl ? 'votre musique' : ''}
                    {config.musicUrl && rushEcoute ? ' et ' : ''}
                    {rushEcoute ? 'le prochain rush de la rotation' : ''}.
                  </p>
                  <AudioMixPreview
                    audioKeyframes={imagesClesMixage}
                    musicUrl={config.musicUrl}
                    voiceUrl={null}
                    rushUrl={rushEcoute}
                    introDuration={dureesEcoute.intro}
                    cardsDuration={dureesEcoute.cards}
                    ctaDuration={dureesEcoute.cta}
                    totalDuration={dureesEcoute.total}
                    videoSeqStart={dureesEcoute.videoStart}
                    videoSeqDuration={dureesEcoute.video}
                  />
                </>
              ) : (
                <p className="text-[11px] text-gray-500" data-autopilot-ecoute-vide>
                  Ajoutez une musique ou gardez le son du rush pour écouter le mixage.
                </p>
              )}
              {config.voiceEnabled && (
                <p className="flex items-start gap-1.5 text-[11px] text-gray-500 mt-1.5" data-autopilot-ecoute-voix>
                  <Mic className="w-3 h-3 mt-0.5 shrink-0" />
                  Voix off non incluse dans l’écoute : elle est générée au moment du rendu (option payante).
                </p>
              )}
            </div>
          )}
            </div>
          </details>
        </div>
      )}

      {/* ── Étape 4 · Rythme & diffusion ─────────────────────────────── */}
      {etape === 3 && (
        <div className="space-y-4">
          {/* La phrase que l'utilisateur doit pouvoir dire en lisant l'ecran,
              recalculee a chaque reglage — depuis la meme configuration que
              le recapitulatif. */}
          <p className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs text-purple-100" data-autopilot-phrase-diffusion>
            {phraseDiffusion(config)}
          </p>

{/* ── PRODUCTION ───────────────────────────────────────────────
              Deux blocs, deux moments. PRODUCTION = quand le moteur tourne
              (une date de debut, une heure) ; PUBLICATION = quand les posts
              produits sont programmes (une heure, le lendemain). La capture
              de l'utilisateur les montrait cote a cote sans les nommer, et
              une heure de publication se lisait comme un ordre de
              production. */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-3" data-autopilot-bloc-production>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Production — quand Studiio fabrique les vidéos
            </p>
            <div>
              <label htmlFor="autopilot-start-date" className="block text-xs font-medium text-gray-300 mb-1.5">
                Date de début
              </label>
              <input
                id="autopilot-start-date"
                type="date"
                value={config.startDate ?? ''}
                // Vide = « dès le prochain passage » : c'est un choix, pas
                // une saisie incomplete, et il s'enregistre (`null`). Une
                // date partielle rend aussi `''` dans certains navigateurs :
                // elle efface alors la date — on ne peut pas distinguer les
                // deux, et effacer est le moins surprenant.
                onChange={(e) => enregistrer({ startDate: e.target.value ? e.target.value : null })}
                disabled={!ready || saving}
                data-autopilot-start-date
                className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                {config.startDate
                  ? `Rien n’est produit avant le ${dateLisible(config.startDate)} ; la première publication est programmée au plus tôt ce jour-là.`
                  : 'Vide : dès le prochain passage. Choisissez un jour pour différer le départ.'}
              </p>
              {ready && !dateDebutReady && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mt-1" data-autopilot-start-date-absente>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  La date de début n’est pas encore conservée : la migration
                  <code className="mx-1">2026-09-21-autopilot-start-date</code> n’a pas été
                  appliquée. L’Autopilote part dès le prochain passage.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="autopilot-hour" className="block text-xs font-medium text-gray-300 mb-1.5">
                Heure de production
              </label>
              <select
                id="autopilot-hour"
                value={config.runHour}
                onChange={(e) => enregistrer({ runHour: Number(e.target.value) })}
                disabled={!ready || saving}
                data-autopilot-hour
                className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{heureLisible(h)}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                Heure de {config.runTimezone.replace('_', ' ')} à laquelle Studiio
                PRODUIT les vidéos. Ce n’est pas une heure de publication, et ce
                n’est pas une commande immédiate : pour tester tout de suite,
                utilisez « Produire un brouillon maintenant » ci-dessous.
              </p>
            </div>
          </div>

{/* ── PUBLICATION ──────────────────────────────────────────────
              DISTINCTE de l'heure de production : celle-ci est l'heure a
              laquelle les posts produits sont PROGRAMMES (le lendemain de la
              production). Un champ `time` et non une liste de 24 heures :
              les minutes comptent, et elles sont conservees telles quelles
              (« 18:45 »), jusqu'a `scheduled_time` et au cron. */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-3" data-autopilot-bloc-publication>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Publication — quand les vidéos produites sont programmées
            </p>
            <label htmlFor="autopilot-publish-time" className="block text-xs font-medium text-gray-300 mb-1.5">
              Heure de publication
            </label>
            <input
              id="autopilot-publish-time"
              type="time"
              step={60}
              value={config.publishTime}
              // Le navigateur rend `''` sur une saisie incomplete : on ne
              // l'enregistre pas — `sanitizePublishTime` la ramenerait a
              // 18:00 et ecraserait l'heure en cours de frappe.
              onChange={(e) => { if (e.target.value) enregistrer({ publishTime: e.target.value }); }}
              disabled={!ready || saving}
              data-autopilot-publish-time
              className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              Heure de {config.runTimezone.replace('_', ' ')} ; les minutes sont
              conservées. Chaque vidéo est programmée le lendemain de sa
              production, à cette heure.
            </p>
            {ready && !heurePublicationReady && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-400 mt-1" data-autopilot-publish-time-absente>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                L’heure de publication n’est pas encore conservée : la migration
                <code className="mx-1">2026-09-21-autopilot-publish-time</code> n’a pas été
                appliquée. Les vidéos restent programmées à 18:00.
              </p>
            )}
          </div>

          {/* Les deux prochaines échéances + « Produire un brouillon
              maintenant » — le même bloc qu'à l'étape Vérification. */}
          {rendreProchaines()}

          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Fréquence</p>
{/* ── Cadence et nombre ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="autopilot-cadence" className="block text-xs font-medium text-gray-300 mb-1.5">
                À quelle fréquence ?
              </label>
              <select
                id="autopilot-cadence"
                value={config.cadence}
                onChange={(e) => enregistrer({ cadence: e.target.value as AutopilotCadence })}
                disabled={!ready || saving}
                className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="autopilot-count" className="block text-xs font-medium text-gray-300 mb-1.5">
                Combien à chaque fois ?
              </label>
              <select
                id="autopilot-count"
                value={config.countPerCycle}
                onChange={(e) => enregistrer({ countPerCycle: Number(e.target.value) })}
                disabled={!ready || saving}
                className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              >
                {Array.from({ length: MAX_PER_CYCLE }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n} vidéo{n > 1 ? 's' : ''}</option>
                ))}
              </select>
            </div>
          </div>
{/* ── Intention ────────────────────────────────────────────────
              TROIS cartes, DEUX modes en base. « Produire seulement » n'est
              que `review` sans reseau : aucun statut, aucune colonne de plus
              (voir `intentionDiffusion` / `patchPourIntention`). Le choix
              s'ecrit en UN `enregistrer` — mode ET reseaux — pour ne jamais
              laisser, entre deux appels, une configuration qui se lirait
              autrement. */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Validation</p>
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Que fait Studiio des vidéos ?</p>
            <div className="space-y-1.5">
              {INTENTIONS.map((i: AutopilotIntention) => {
                const intention = intentionCliquee ?? intentionDiffusion(config);
                const choisie = intention === i;
                // Publier sans reseau : le cron marquerait chaque post
                // « failed » (aucune plateforme). On le dit, et on ne laisse
                // pas y entrer — sauf si la configuration y est DEJA, qu'il
                // faut pouvoir afficher telle qu'elle est.
                const sansReseau = i === 'publier' && config.platforms.length === 0 && !choisie;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setIntentionCliquee(i); enregistrer(patchPourIntention(i)); }}
                    disabled={!ready || saving || sansReseau}
                    aria-pressed={choisie}
                    data-autopilot-intention={i}
                    data-autopilot-mode={INTENTION_MODE[i]}
                    title={sansReseau ? 'Choisissez d’abord au moins un réseau (« Préparer et me laisser valider », puis les réseaux).' : undefined}
                    className={`w-full text-left rounded-lg border px-3 py-2 ${classesCarteOption(choisie)}`}
                  >
                    <span className="text-xs font-medium">{INTENTION_LABELS[i]}</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">{INTENTION_HINTS[i]}</span>
                    {sansReseau && (
                      <span className="block text-[11px] text-amber-400 mt-0.5" data-autopilot-intention-bloquee>
                        Aucun réseau choisi : rien ne partirait. Choisissez d’abord vos réseaux.
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
{/* ── Plateformes ──────────────────────────────────────────────
              Masquees sous « produire seulement » : l'intention VIENT de
              l'absence de reseau, en proposer un ici la contredirait. Le
              bloc revient des qu'une autre intention est choisie. */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Réseaux</p>
          {(intentionCliquee ?? intentionDiffusion(config)) === 'produire' ? (
            <p className="text-[11px] text-gray-500" data-autopilot-reseaux-masques>
              Aucun réseau : les vidéos arrivent en brouillon dans le Calendrier,
              à télécharger depuis l’export sécurisé. Choisissez « {INTENTION_LABELS.valider} »
              pour sélectionner des réseaux.
            </p>
          ) : (
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Où publier ?</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATEFORMES.map((p) => {
                const retenue = config.platforms.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => enregistrer({
                      platforms: retenue
                        ? config.platforms.filter((x) => x !== p.id)
                        : [...config.platforms, p.id],
                    })}
                    disabled={!ready || saving}
                    aria-pressed={retenue}
                    data-autopilot-platform={p.id}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition disabled:opacity-40 ${
                      retenue ? 'border-purple-500/50 bg-gray-800 text-white' : 'border-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          )}
        </div>
      )}

      {/* ── Étape 5 · Options & garde-fous ───────────────────────────── */}
      {etape === 4 && (
        <div className="space-y-4">
{/* ── Voix off ─────────────────────────────────────────────────
              OPTION PAYANTE, donc EXPLICITE et desactivee par defaut. La
              narration passe par ElevenLabs, facture a l'usage : l'activer
              d'office ferait payer une voix que personne n'a demandee. Le cout
              est ecrit dans l'etiquette, pas cache dans une aide au survol. */}
          <div>
            <p className="text-xs font-medium text-gray-300 mb-2">Voix off IA</p>
            <button
              type="button"
              onClick={() => enregistrer({ voiceEnabled: !config.voiceEnabled })}
              disabled={!ready || saving}
              aria-pressed={config.voiceEnabled}
              data-autopilot-voice
              className={`w-full flex items-start gap-3 text-left rounded-lg border px-3 py-2 transition disabled:opacity-40 ${
                config.voiceEnabled
                  ? 'border-purple-500/50 bg-gray-800'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full transition ${
                  config.voiceEnabled ? 'bg-purple-500' : 'bg-gray-700'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    config.voiceEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">
                  Voix off — <span className="text-amber-400">option payante</span>
                </span>
                <span className="block text-[11px] text-gray-500 mt-0.5">
                  {config.voiceEnabled
                    ? 'Chaque montage est narré par une voix IA (crédits ElevenLabs).'
                    : 'Aucune narration, aucun coût. Les vidéos sortent avec la musique seule.'}
                </span>
              </span>
            </button>
          </div>
{/* ── Seuil de crédits ─────────────────────────────────────────── */}
          <div>
            <label htmlFor="autopilot-floor" className="block text-xs font-medium text-gray-300 mb-1.5">
              Protection de mes crédits — ne jamais descendre sous
            </label>
            <div className="flex items-center gap-2">
              <input
                id="autopilot-floor"
                type="number"
                min={0}
                max={10000}
                value={config.creditFloor}
                onChange={(e) => setConfig((c) => ({ ...c, creditFloor: Number(e.target.value) }))}
                onBlur={() => enregistrer({ creditFloor: config.creditFloor })}
                disabled={!ready || saving}
                className="w-24 rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2 text-xs disabled:opacity-40"
              />
              <span className="text-xs text-gray-500">crédits</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              L’Autopilote s’arrête avant ce seuil, pour qu’il vous reste toujours
              de quoi produire à la main.
            </p>
          </div>
        </div>
      )}

      {/* ── Étape 6 · Récapitulatif & activation ─────────────────────── */}
      {etape === 5 && (
        <div className="space-y-3">
          {/* CHECK-LIST DE PRÉPARATION. Le rush est la seule condition
              bloquante pour la PRODUCTION (`shouldRun` → `sans-rush`) ; la
              regle metier autorise d'activer sans rush — l'Autopilote reste
              alors « actif, mais rien n'est produit ». On ne change pas cette
              regle ici : on la DIT, et on retire au bouton son air de
              « tout est pret » tant que ce n'est pas vrai. */}
          {(() => {
            const lignes = checklistPreparation(config);
            const pret = lignes.every((l) => l.ok || !l.bloquant);
            return (
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-1.5" data-autopilot-checklist data-autopilot-pret={pret ? 'oui' : 'non'}>
                <ul className="space-y-1 text-[11px]">
                  {lignes.map((l) => (
                    <li key={l.cle} className="flex items-start gap-2" data-autopilot-check={l.cle} data-autopilot-check-ok={l.ok ? 'oui' : 'non'}>
                      <span className={`shrink-0 ${l.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{l.ok ? '✓' : '✕'}</span>
                      <span className={l.ok ? 'text-gray-300' : 'text-amber-300'}>{l.texte}</span>
                    </li>
                  ))}
                </ul>
                {pret ? (
                  <p className="text-xs font-medium text-emerald-400 pt-1" data-autopilot-verdict="pret">
                    Votre Autopilote est prêt.
                  </p>
                ) : (
                  <p className="text-xs font-medium text-amber-300 pt-1" data-autopilot-verdict="pas-pret">
                    Votre Autopilote n’est pas encore prêt — ajoutez au moins un rush.
                    Vous pouvez l’activer dès maintenant : il démarrera au premier rush ajouté.
                  </p>
                )}
              </div>
            );
          })()}

          {([
            ['Ce qui change à chaque vidéo', RECAP_VARIABLE(config), 'variable'],
            ['Ce qui ne change jamais', RECAP_CONSTANT(config, voixClonees), 'constant'],
            ['Rythme & diffusion', RECAP_DIFFUSION(config), 'diffusion'],
          ] as Array<[string, Array<[string, string]>, string]>).map(([titre, lignes, jeton]) => (
            <dl
              key={jeton}
              data-autopilot-recap={jeton}
              className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-1.5 text-[11px]"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                {titre}
              </p>
              {lignes.map(([cle, valeur]) => (
                <div key={cle} className="flex items-baseline justify-between gap-3">
                  <dt className="text-gray-500 shrink-0">{cle}</dt>
                  <dd className="text-right text-gray-200">{valeur}</dd>
                </div>
              ))}
            </dl>
          ))}

{/* ── Interrupteur ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{config.enabled ? 'Actif' : 'En pause'}</p>
              <p className="text-xs text-gray-500 mt-0.5">{etat}</p>
            </div>
            <button
              type="button"
              onClick={() => enregistrer({ enabled: !config.enabled })}
              disabled={!ready || saving}
              aria-pressed={config.enabled}
              data-autopilot-toggle
              data-cta={!config.enabled && config.rushUrls.length > 0 ? 'principal' : 'secondaire'}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                config.enabled
                  ? { backgroundColor: '#1F2937', color: '#E5E7EB' }
                  // Sans rush : le bouton reste actif (regle metier inchangee)
                  // mais n'a plus l'air d'un « tout est pret ».
                  : config.rushUrls.length === 0
                    ? { backgroundColor: 'transparent', color: '#DDD6FE', boxShadow: `inset 0 0 0 1px ${accent}99` }
                    : { backgroundColor: accent, color: '#fff' }
              }
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : config.enabled ? 'Mettre en pause' : 'Lancer l’Autopilote'}
            </button>
          </div>

          {config.enabled && (
            <p className="flex items-start gap-1.5 text-[11px] text-gray-400" data-autopilot-depart>
              <Rocket className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Production à {heureLisible(config.runHour)} ({config.runTimezone}),
              {' '}{CADENCE_LABELS[config.cadence].toLowerCase()}.
              Prochaine production : {prochainDepart(config.runHour, config.runTimezone, new Date(), config.startDate)}.
              {' '}Publication des vidéos produites : le lendemain à {heurePublicationLisible(config)}.
            </p>
          )}

          {/* Les deux prochaines échéances, datées — et « Produire un
              brouillon maintenant » pour tester sans attendre le passage. */}
          {rendreProchaines()}
        </div>
      )}

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={() => setEtape((n) => Math.max(0, n - 1))}
          disabled={etape === 0}
          className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Précédent
        </button>
        {etape < ETAPES.length - 1 && (
          <div className="flex items-center gap-2 min-w-0">
            {bloqueEtape && (
              <span className="text-[11px] text-amber-400 truncate" data-autopilot-suivant-bloque>
                Ajoutez au moins un rush pour continuer
              </span>
            )}
            <button
              type="button"
              onClick={() => setEtape((n) => Math.min(ETAPES.length - 1, n + 1))}
              disabled={!ready || bloqueEtape}
              data-autopilot-suivant
              title={bloqueEtape ? 'Ajoutez au moins un rush pour continuer' : undefined}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
              style={{ backgroundColor: accent }}
            >
              {libelleContinuer(etape)}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {notice && !error && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <Check className="w-3.5 h-3.5" /> {notice}
        </p>
      )}
    </div>
  );
}

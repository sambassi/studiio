'use client';

import ConsentementJumeauAdmin from '@/components/avatar/ConsentementJumeauAdmin';
import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Onglets } from '@/components/ui/Onglets';
import {
  UserSquare2,
  Upload,
  Loader2,
  Sparkles,
  Download,
  RefreshCw,
  Image as ImageIcon,
  Clapperboard,
  Trash2,
  Mic,
} from 'lucide-react';
import VoiceCloneRecorder from '@/components/voice/VoiceCloneRecorder';
import MaVoixPanel from '@/components/voice/MaVoixPanel';
import AvatarVideoDid, { type EtapeDid } from '@/components/avatar/AvatarVideoDid';
import StatutAvatar, { type StatutAvatarCle, type LienStatut } from '@/components/avatar/StatutAvatar';
import { Notification, ProgressStatus, EnteteSection, FilEtapes, Consigne, ZoneApercu, DeuxColonnes, ColonneTravail, ColonneApercu, type EtapeProgression, type Etape, type EtatApercu, type NiveauNotification } from '@/components/ux';
import { envoyerFormulaire, detailEnvoi, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';
import { trahitUnFournisseur } from '@/lib/avatar/fournisseurs';
import Link from 'next/link';
import { lireEtatJumeau, genererEtAttendreVideoJumeau, attendreStatutJumeau, type EtatJumeau, type PhaseJumeau } from '@/lib/creer/jumeau';
import MesAvatars from '@/components/avatar/MesAvatars';
import PreparationPhoto from '@/components/avatar/studio/PreparationPhoto';
import { LIBELLE_EMBELLISSEMENT, type NiveauEmbellissement } from '@/lib/avatar/preparation-source-regles';
import { libelleAvatarActif, TITRE_SOURCE_AVATAR, TITRE_RENDU_RECENT, AUCUN_RENDU_RECENT, type RenduRecent } from '@/lib/avatar/identite';
import { CLASSES_LECTEUR_GENERATION, ratioCadre } from '@/lib/ui/lecteur-generation';
import {
  ETAPES_GENERATION_HEYGEN, ETAPES_GENERATION_JUMEAU, DETAIL_GENERATION, etapesGeneration, detailStatutFournisseur,
  CLE_GENERATION_EN_COURS, lireGenerationEnCours, type PhaseGenerationHeygen, type PhaseGenerationJumeau, type GenerationEnCours,
} from '@/lib/avatar/progression';

const AVATAR_VIDEO_COST = 40;
/** Valeur du sélecteur pour une voix clonée : `clone:<user_voices.id>` — jamais un identifiant fournisseur. */
const PREFIXE_VOIX_CLONEE = 'clone:';
const VOIX_CLONEE_INDISPONIBLE = 'Votre voix clonée n’est pas disponible pour le moment. Choisissez une autre voix.';
const VOIX_CLONEE_ILLISIBLE = 'Votre voix clonée n’a pas pu être vérifiée. Réessayez, ou choisissez une autre voix.';
const MAX_SCRIPT_CHARS = 1200;
/** Limite imposée par HeyGen sur l'envoi d'un asset. */
const MAX_VIDEO_MB = 32;
/** Limite documentée par D-ID (« Video buffer size exceeds 50MB »). */
const MAX_VIDEO_DID_MB = 50;

type AvatarKind = 'photo' | 'video';

/** Statuts HeyGen signifiant « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

interface AvatarRow {
  id: string;
  name: string | null;
  status: string;
  avatar_type?: AvatarKind;
  training_error?: string | null;
  /** L'état DÉRIVÉ par le serveur (`etatAvatar`) : l'écran ne le recalcule pas. */
  etat?: 'supprime' | 'source_prete' | 'entrainement' | 'entraine_non_valide' | 'valide' | 'echec';
  /** Le fournisseur de cet avatar : 'heygen' (photo/vidéo HeyGen) ou 'did' (avatar vidéo). */
  provider?: 'heygen' | 'did' | string;
  /** Jumeau vidéo : statut du consentement filmé (admin uniquement). */
  provider_group_consent?: string | null;
  /** Avatar D-ID : l'étape DÉRIVÉE par le serveur et la phrase de consentement à lire. */
  etape_did?: EtapeDid;
  provider_consent_text?: string | null;
  consent_name?: string | null;
  /** Fin de validité de la phrase de consentement (ISO), calculée par le serveur. */
  consent_expire_le?: string | null;
  version?: number;
  validated_at?: string | null;
  /** Horodatage RÉEL de l'import de la source (posé par le serveur à chaque version) : l'entraînement HeyGen démarre dans la même requête. */
  consent_at?: string | null;
  /**
   * ⚠️ L'aperçu de la source ne passe PLUS par une URL de la ligne : la
   * source (le visage) se lit par `/api/avatar/source`, authentifiée. Le
   * serveur ne renvoie plus `source_url` ; le champ n'existe plus ici.
   */
  created_at: string;
}

/**
 * L'adresse de MA source. Le paramètre `v` ne sert qu'au cache du navigateur
 * (changer d'avatar = nouvelle adresse) ; la route l'ignore et retrouve la
 * clé par la session, jamais par ce qu'on lui envoie.
 */
const SOURCE_AVATAR_URL = '/api/avatar/source';
const urlSourceAvatar = (avatar: Pick<AvatarRow, 'id'>) =>
  `${SOURCE_AVATAR_URL}?v=${encodeURIComponent(avatar.id)}`;

interface Voice {
  voiceId: string;
  name: string;
  language?: string;
}

type GenStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
type Qualite = 'standard' | 'qualite' | 'premium';
interface QualiteOfferte { qualite: Qualite; libelle: string; ouverte: boolean; recommandee?: boolean; motif?: string | null }
const lireQualites = (brut: unknown): QualiteOfferte[] => (Array.isArray(brut)
  ? (brut as QualiteOfferte[]).filter((q) => q && (q.qualite === 'standard' || q.qualite === 'qualite' || q.qualite === 'premium'))
  : []);

/** La génération en cours, mémorisée pour la reprise après rechargement (le stockage peut être indisponible). */
const memoriserGeneration = (g: GenerationEnCours | null) => {
  try {
    if (g) window.localStorage.setItem(CLE_GENERATION_EN_COURS, JSON.stringify(g));
    else window.localStorage.removeItem(CLE_GENERATION_EN_COURS);
  } catch { /* stockage indisponible : pas de reprise, rien d'autre */ }
};
const relireGeneration = (): GenerationEnCours | null => {
  try { return lireGenerationEnCours(window.localStorage.getItem(CLE_GENERATION_EN_COURS)); } catch { return null; }
};
/** Phase du moteur du jumeau → étape affichée dans Mon avatar (pas de montage ici). */
const phaseJumeauVersEtape = (p: PhaseJumeau): PhaseGenerationJumeau => (
  p === 'stockage' ? 'stockage' : p === 'traitement' ? 'traitement' : p === 'pret' || p === 'rendu' ? 'prete' : 'envoi'
);

export default function AvatarPage() {
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  /** « À partir d'une vidéo » n'est ouvert que si le serveur le dit (drapeau + clé D-ID). */
  const [didVideoActif, setDidVideoActif] = useState(false);
  /** Jumeau VIDÉO (digital twin) : TEMPORAIREMENT réservé à l'admin — le serveur le dit. */
  const [jumeauVideoActif, setJumeauVideoActif] = useState(false);
  /** Le nom du profil (rendu par le serveur) ne sert qu'à PRÉ-REMPLIR le nom de consentement D-ID : la personne le corrige. */
  const [nomProfil, setNomProfil] = useState<string | null>(null);

  // Création
  const [kind, setKind] = useState<AvatarKind>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mesAvatarsCle, setMesAvatarsCle] = useState(0);
  /** Première photo : « Embellir le visage » (facultatif ici) — l'original reste conservé à côté. */
  const [ameliorerPhoto, setAmeliorerPhoto] = useState(false);
  const [photoPreparee, setPhotoPreparee] = useState<{ cleOriginal: string; cleTraitee: string; embellissement: NiveauEmbellissement } | null>(null);

  // Génération
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState('');
  /**
   * MES VOIX — les voix clonées du compte (`GET /api/voice/clone`), chacune
   * PRÊTE ou non (`utilisable`, même règle que le serveur), et l'état du
   * moteur du jumeau (`GET /api/creer/jumeau`). Choisie, une voix fait passer
   * CETTE génération par le moteur du jumeau de Créer
   * (`POST /api/creer/jumeau/generer` + `voixId` : synthèse avec CETTE voix,
   * puis l'avatar animé sur cet audio). C'est un choix PONCTUEL : la voix
   * enregistrée du compte (Créer, Autopilote) n'est jamais modifiée.
   */
  const [etatJumeau, setEtatJumeau] = useState<EtatJumeau | null>(null);
  const [voixClonees, setVoixClonees] = useState<Array<{ id: string; nom: string; utilisable: boolean }>>([]);
  /** Le dernier refus du serveur pour la voix clonée choisie — dit tel quel, jamais remplacé par une autre voix. */
  const [refusVoixClonee, setRefusVoixClonee] = useState<string | null>(null);
  const [ratio, setRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  /**
   * QUALITÉ DE RENDU — Standard (avatar_iii) / Qualité (avatar_iv) / Premium
   * (avatar_v). Un réglage de CETTE génération, jamais de la version de
   * l'avatar. Le serveur dit lesquelles sont ouvertes ; il revérifie au clic.
   */
  const [qualitesHeygen, setQualitesHeygen] = useState<QualiteOfferte[]>([]);
  const [defautHeygen, setDefautHeygen] = useState<Qualite>('qualite');
  /** Voix clonée = moteur du jumeau (comme Créer) : ses propres qualités et SON défaut, inchangés. */
  const [qualitesClonee, setQualitesClonee] = useState<QualiteOfferte[]>([]);
  const [defautClonee, setDefautClonee] = useState<Qualite>('standard');
  const [qualite, setQualite] = useState<Qualite>('qualite');
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  /** Où en est la génération (étapes RÉELLES du parcours HeyGen ou du jumeau), et son début. */
  const [genEtape, setGenEtape] = useState<{ mode: 'heygen'; phase: PhaseGenerationHeygen } | { mode: 'jumeau'; phase: PhaseGenerationJumeau } | null>(null);
  const [genDebut, setGenDebut] = useState<number | null>(null);
  /** Le dernier statut rendu par le fournisseur (pending / processing), dit en clair. */
  const [statutFournisseur, setStatutFournisseur] = useState<string | null>(null);
  /** L'échec de la dernière génération : l'étape où elle s'est arrêtée et le motif. */
  const [genEchec, setGenEchec] = useState<string | null>(null);
  /** Ratio RÉEL de la source (dimensions lues sur l'image / la vidéo chargée) ; `null` tant qu'inconnu. */
  const [ratioSourceReel, setRatioSourceReel] = useState<string | null>(null);
  /** « Changer d'avatar » : ouvre la liste de MES avatars (incrémenté à chaque demande). */
  const [demandeChoixAvatar, setDemandeChoixAvatar] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  /**
   * L'aperçu RÉEL du clone (une vraie génération HeyGen sur le texte fixe de
   * Studiio) et la preuve de son ouverture. `jeton` n'existe qu'après
   * « Voir mon avatar » ; c'est lui, et lui seul, qui ouvre « Valider ».
   */
  type Apercu = { statut: 'aucun' } | { statut: 'en_cours'; generationId: string } | { statut: 'echec'; generationId: string; erreur: string | null } | { statut: 'indisponible'; generationId: string } | { statut: 'pret'; generationId: string; url: string };
  const [apercu, setApercu] = useState<Apercu | null>(null);
  /**
   * Avatar VALIDÉ : la dernière vidéo terminée de la VERSION ACTIVE — un
   * exemple de rendu, jamais présenté comme « l'avatar ». `null` = aucun.
   */
  const [renduRecent, setRenduRecent] = useState<RenduRecent | null>(null);
  /** « Voir mon avatar » a été cliqué : la vraie vidéo est affichée — sans jeton encore. */
  const [apercuVisible, setApercuVisible] = useState(false);
  /** Le jeton n'existe qu'après le DÉMARRAGE RÉEL de la lecture (`onPlaying`). */
  const [apercuOuvert, setApercuOuvert] = useState<{ jeton: string; version: number; generationId: string } | null>(null);
  const ouvertureEnCoursRef = useRef(false);
  const [apercuEnCours, setApercuEnCours] = useState(false);
  const [validationEnCours, setValidationEnCours] = useState(false);
  const apercuGenerationRef = useRef<string | null>(null);
  const [suppressionArmee, setSuppressionArmee] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  /**
   * Progression RÉELLE de la génération à la demande — uniquement si l'API
   * en rend une (`progress`). Sinon `null` : barre indéterminée. Plus aucune
   * estimation depuis le temps écoulé (cahier UX, Annexe A).
   */
  const [progress, setProgress] = useState<number | null>(null);
  /** L'envoi de la source vers Studiio : octets réellement transférés (XHR), ou null hors envoi. */
  const [envoiSource, setEnvoiSource] = useState<ProgressionEnvoi | null>(null);
  const maVoixRef = useRef<HTMLElement | null>(null);
  /**
   * Deux onglets : l'avatar vidéo, et la voix (clonage, prononciations). Les
   * deux panneaux restent MONTÉS (l'inactif est seulement masqué) : rien ne se
   * recharge ni ne se perd en passant de l'un à l'autre. `#ma-voix` (lien de
   * Créer > Audio) ouvre directement l'onglet de la voix.
   */
  const [onglet, setOnglet] = useState<'avatar' | 'voix'>('avatar');
  useEffect(() => {
    if (window.location.hash === '#ma-voix') setOnglet('voix');
  }, []);
  // Arrivée par `#ma-voix` : une fois la page chargée, on descend sur la section.
  useEffect(() => {
    if (!loading && window.location.hash === '#ma-voix') maVoixRef.current?.scrollIntoView({ block: 'start' });
  }, [loading]);

  /**
   * LA notification de la page (cahier UX, §2.3) : une seule à la fois, la
   * plus récente remplace. Les anciens `error` / `notice` / « voix manquante »
   * passent tous par ce slot ; `setError(null)` n'efface qu'une erreur.
   */
  type NotificationPage = { niveau: NiveauNotification; titre: string; detail?: string | string[]; motif?: string | null; action?: { libelle: string; onClick: () => void }; cle?: 'voix_manquante'; actionSecondaire?: boolean };
  const [notification, setNotification] = useState<NotificationPage | null>(null);
  const setError = (message: string | null) => {
    if (message) setNotification({ niveau: 'erreur', titre: message });
    else setNotification((n) => (n?.niveau === 'erreur' ? null : n));
  };
  const setNotice = (message: string | null) => {
    if (message) setNotification({ niveau: 'succes', titre: message });
    else setNotification((n) => (n?.niveau === 'succes' ? null : n));
  };
  const signalerVoixManquante = () => setNotification({
    cle: 'voix_manquante',
    niveau: 'avertissement',
    titre: "Votre voix personnelle est nécessaire pour l'aperçu.",
    detail: "L'aperçu fait parler votre avatar avec votre voix. Ajoutez ou choisissez-la dans « Ma voix ».",
    // L'onglet « Voix & Prononciation » est d'abord AFFICHÉ (rendu synchrone), puis on y descend.
    action: { libelle: 'Configurer ma voix', onClick: () => { flushSync(() => setOnglet('voix')); maVoixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); maVoixRef.current?.focus(); } },
  });

  const pollRef = useRef<NodeJS.Timeout | null>(null);
  /** Vrai une fois la page démontée : plus aucun `setState` depuis une réponse tardive. */
  const demonteRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const trainingPollRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Recharge l'avatar et les voix. Le GET rafraîchit au passage le statut
   * d'entraînement côté HeyGen — c'est ce qui permet de suivre la préparation
   * d'un avatar vidéo sans route dédiée.
   */
  /**
   * Suppression logique : la ligne quitte l'écran, la source (le visage) est
   * retirée du stockage, les vidéos déjà produites restent. Le serveur dit
   * ce qu'il ne fait pas — le clone chez le fournisseur n'est pas supprimé
   * automatiquement — et l'écran le répète mot pour mot.
   */
  const supprimerAvatar = async () => {
    setSuppressionEnCours(true);
    setError(null);
    try {
      const res = await fetch('/api/avatar', { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "La suppression de l'avatar a échoué.");
        return;
      }
      setAvatar(null);
      setVideoUrl(null);
      setProgress(null);
      setGenStatus('idle');
      const fournisseur = json.data?.fournisseur === 'non_disponible'
        ? " La copie de votre clone conservée par notre service de génération n'est pas supprimée automatiquement."
        : '';
      // Strictement vrai, rien de plus : aucun nettoyage automatique n'existe
      // aujourd'hui, on ne promet ni délai ni retrait futur. Ce qui est
      // garanti : l'avatar supprimé ne donne plus accès au fichier.
      const source = json.data?.sourceRetiree === false
        ? " Votre fichier source n'a pas pu être retiré automatiquement du stockage ; il n'est plus accessible via l'avatar supprimé."
        : ' Votre fichier source a été retiré du stockage.';
      setNotification({ niveau: 'succes', titre: 'Avatar supprimé.', detail: `Vos vidéos déjà générées sont conservées.${source}${fournisseur}`.trim() });
    } catch {
      setError("La suppression de l'avatar a échoué.");
    } finally {
      setSuppressionEnCours(false);
      setSuppressionArmee(false);
    }
  };

  const loadRenduRecent = useCallback(async () => {
    try {
      const res = await fetch('/api/avatar/apercu');
      const json = await res.json();
      setRenduRecent(json?.success && json.data?.renduRecent ? (json.data.renduRecent as RenduRecent) : null);
    } catch {
      setRenduRecent(null);
    }
  }, []);

  const loadApercu = useCallback(async () => {
    try {
      const res = await fetch('/api/avatar/apercu');
      const json = await res.json();
      if (!json.success) { setApercu(null); return null; }
      setApercu(json.data.apercu as Apercu);
      return json.data.apercu as Apercu;
    } catch {
      setApercu(null);
      return null;
    }
  }, []);

  /** « Générer l'aperçu » : une vraie génération HeyGen, une fois par version. */
  const genererApercu = async () => {
    if (!avatar || apercuEnCours) return;
    setApercuEnCours(true);
    setError(null);
    try {
      // Avatar D-ID : l'aperçu part sur MA voix (ElevenLabs) vers D-ID ; HeyGen sinon.
      const res = avatar.provider === 'did'
        ? await fetch('/api/avatar/did/apercu', { method: 'POST' })
        : await fetch('/api/avatar/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intention: 'apercu', voiceId: voiceId || undefined }),
        });
      const json = await res.json();
      if (!json.success) {
        // Sans voix personnelle, l'aperçu ne peut pas parler : on le dit avec la sortie (« Ma voix »), pas une erreur sèche.
        if (json.code === 'voix_indisponible') { signalerVoixManquante(); await loadApercu(); return; }
        setError(json.error || "L'aperçu n'a pas pu être lancé.");
        await loadApercu();
        return;
      }
      setNotification((n) => (n?.niveau === 'avertissement' ? null : n));
      apercuGenerationRef.current = json.data.generationId;
      setApercu({ statut: 'en_cours', generationId: json.data.generationId });
      poll(json.data.generationId);
    } catch {
      setError("L'aperçu n'a pas pu être lancé.");
    } finally {
      setApercuEnCours(false);
    }
  };

  /** « Voir mon avatar » : affiche la vraie vidéo. Rien d'autre — pas de jeton. */
  const voirApercu = () => {
    setError(null);
    setApercuVisible(true);
  };

  /**
   * La vidéo a RÉELLEMENT commencé à jouer (`onPlaying` du lecteur) : c'est
   * maintenant, et seulement maintenant, que le serveur est sollicité pour
   * le jeton d'ouverture — lié au compte, à l'avatar, à la version et à la
   * génération. Sans lecture, pas de jeton ; sans jeton, pas de « Valider ».
   */
  const apercuEnLecture = async () => {
    if (apercuOuvert || ouvertureEnCoursRef.current) return;
    ouvertureEnCoursRef.current = true;
    try {
      const res = await fetch('/api/avatar/apercu/ouverture', { method: 'POST' });
      const json = await res.json();
      if (!json.success) { setError(json.error || "L'ouverture de l'aperçu n'a pas pu être enregistrée."); await loadApercu(); return; }
      setApercuOuvert({ jeton: json.data.jeton, version: json.data.version, generationId: json.data.generationId });
    } catch {
      setError("L'ouverture de l'aperçu n'a pas pu être enregistrée.");
    } finally {
      ouvertureEnCoursRef.current = false;
    }
  };

  /** « Valider mon avatar » : avec le jeton d'ouverture, sur la version courante. */
  const validerAvatar = async () => {
    if (!apercuOuvert || validationEnCours) return;
    setValidationEnCours(true);
    setError(null);
    try {
      const res = await fetch('/api/avatar/validation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeton: apercuOuvert.jeton }),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error || 'La validation a échoué.'); await loadAvatar(false); return; }
      setNotification({ niveau: 'succes', titre: 'Avatar validé.', detail: 'Il est prêt pour vos vidéos.', action: { libelle: 'Créer une vidéo', onClick: () => window.location.assign('/dashboard/creer') }, actionSecondaire: true });
      setApercuOuvert(null);
      setApercuVisible(false);
      await loadAvatar(false);
    } catch {
      setError('La validation a échoué.');
    } finally {
      setValidationEnCours(false);
    }
  };

  const loadAvatar = useCallback(async (withVoices: boolean) => {
    const res = await fetch('/api/avatar/create');
    const json = await res.json();
    if (!json.success) return null;

    setAvatar(json.data.avatar);
    setDidVideoActif(json.data.didVideoActif === true);
    setJumeauVideoActif(json.data.jumeauVideoActif === true);
    setNomProfil(typeof json.data.nomProfil === 'string' ? json.data.nomProfil : null);
    if (Array.isArray(json.data.qualites)) {
      setQualitesHeygen(lireQualites(json.data.qualites));
      if (json.data.qualiteParDefaut) setDefautHeygen(json.data.qualiteParDefaut as Qualite);
      setQualitesClonee(lireQualites(json.data.qualitesVoixClonee));
      if (json.data.qualiteParDefautVoixClonee) setDefautClonee(json.data.qualiteParDefautVoixClonee as Qualite);
    }
    if (json.data.avatar?.etat === 'entraine_non_valide') void loadApercu();
    else setApercu(null);
    if (json.data.avatar?.etat === 'valide') void loadRenduRecent();
    else setRenduRecent(null);
    // Un jeton d'ouverture ne vaut que pour la version qui l'a délivré.
    setApercuOuvert((o) => (o && o.version === json.data.avatar?.version && json.data.avatar?.etat === 'entraine_non_valide' ? o : null));
    if (json.data.avatar?.etat !== 'entraine_non_valide') setApercuVisible(false);

    if (withVoices) {
      const list: Voice[] = json.data.voices || [];
      setVoices(list);
      // On présélectionne une vraie voix : aucun choix « vide » n'est proposé,
      // car un voice_id absent fait échouer HeyGen en 400.
      setVoiceId(json.data.defaultVoiceId || list[0]?.voiceId || '');
      if (list.length === 0) {
        setNotice(
          "Les voix n'ont pas pu être chargées. La génération utilisera une voix de secours — le résultat peut ne pas être en français.",
        );
      }
    }
    return json.data.avatar as AvatarRow | null;
  }, [loadApercu]);

  // ── Chargement initial ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!cancelled) await loadAvatar(true);
      } catch {
        // La page reste utilisable : l'utilisateur pourra réessayer.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAvatar]);

  // ── Suivi de l'entraînement ─────────────────────────────────────────
  // Un avatar vidéo (digital twin) s'entraîne pendant plusieurs minutes. Tant
  // qu'il n'est pas prêt, on réinterroge périodiquement — la génération reste
  // bloquée côté serveur (409) pendant ce temps.
  const training = !!avatar && !READY_STATUSES.includes(avatar.status);
  const trainingFailed = avatar?.status === 'failed';
  /** Avatar vidéo D-ID : ses étapes (consentement, création, entraînement) ont leur propre panneau. */
  const viaDid = avatar?.provider === 'did';

  useEffect(() => {
    if (!training || trainingFailed) return;
    let cancelled = false;

    const tick = async () => {
      try {
        await loadAvatar(false);
      } catch {
        // Erreur transitoire : on retentera au prochain tour.
      }
      if (!cancelled) trainingPollRef.current = setTimeout(tick, 10000);
    };

    trainingPollRef.current = setTimeout(tick, 10000);
    return () => {
      cancelled = true;
      if (trainingPollRef.current) clearTimeout(trainingPollRef.current);
    };
  }, [training, trainingFailed, loadAvatar]);

  // Nettoyage du timer de polling au démontage — évite une fuite si
  // l'utilisateur quitte la page pendant une génération. `demonteRef` coupe
  // aussi tout `setState` d'une réponse qui arriverait après le démontage.
  useEffect(() => {
    demonteRef.current = false;
    return () => {
      demonteRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
      apercuGenerationRef.current = null;
    };
  }, []);

  // ── Reprise du suivi d'un aperçu déjà EN COURS ──────────────────────
  // Après un rechargement (ou un retour sur la page), `loadApercu` rend
  // `en_cours` + generationId… et rien ne relançait `poll` : l'écran restait
  // sur « en cours de génération » alors que le fournisseur avait fini — vu en
  // production (aperçu D-ID `done`, statut local `processing`, jusqu'à un GET
  // manuel de /api/avatar/status). Ici : la génération EXISTANTE est suivie,
  // jamais relancée — aucun POST aperçu, aucun appel fournisseur.
  // `apercuGenerationRef` est le verrou : un seul suivi par génération, que le
  // lancement vienne d'un clic (`genererApercu` pose la ref avant `poll`) ou
  // d'une relecture ; deux rendus (StrictMode) ne démarrent pas deux boucles.
  useEffect(() => {
    if (apercu?.statut !== 'en_cours') return;
    const id = apercu.generationId;
    if (apercuGenerationRef.current === id) return;
    apercuGenerationRef.current = id;
    void poll(id);
    // `poll` est stable (useCallback sur loadApercu) ; il est déclaré plus bas
    // mais n'est appelé qu'à l'exécution de l'effet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apercu]);

  // Libère l'URL d'objet de l'aperçu quand elle change ou au démontage.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Aucune progression ESTIMÉE pendant la génération : le fournisseur ne
  // rend qu'un statut, la barre est donc indéterminée (`ProgressStatus` sans
  // `pourcentage`). Un pourcentage n'apparaît que si l'API en rend un réel
  // (`progress`, lu dans `poll`). L'ancienne courbe asymptotique depuis le
  // temps écoulé (90 × (1 − e^(−t/45))) a été retirée : elle mentait.

  // ── Création de l'avatar ────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);

    // Contrôle côté client de la limite HeyGen : évite un upload de plusieurs
    // dizaines de Mo pour rien.
    const videoDid = kind === 'video' && didVideoActif;
    const limiteMb = videoDid ? MAX_VIDEO_DID_MB : MAX_VIDEO_MB;
    if (f.type.startsWith('video/') && f.size > limiteMb * 1024 * 1024) {
      setError(
        videoDid
          ? `Vidéo trop lourde (${Math.round(f.size / 1024 / 1024)} Mo). ${MAX_VIDEO_DID_MB} Mo maximum — réduisez la durée ou la qualité.`
          : `Vidéo trop lourde (${Math.round(f.size / 1024 / 1024)} Mo). ${MAX_VIDEO_MB} Mo maximum — réduisez la durée ou la qualité.`,
      );
      e.target.value = '';
      return;
    }
    if (videoDid && f.type !== 'video/mp4' && f.type !== 'video/quicktime') {
      setError('Format vidéo non supporté pour l’avatar vidéo. Utilisez MP4 ou MOV.');
      e.target.value = '';
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setPhotoPreparee(null);
    setAmeliorerPhoto(false);
    setFile(f);
    // Aperçu local pour l'image comme pour la vidéo.
    setPreview(URL.createObjectURL(f));
  };

  const selectKind = (k: AvatarKind) => {
    if (k === kind) return;
    setKind(k);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setPhotoPreparee(null);
    setConsent(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreate = async () => {
    if (!file || !consent || creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      // Photo améliorée : la source est DÉJÀ en stockage — ses deux clés partent, pas le fichier.
      if (kind === 'photo' && photoPreparee) {
        fd.append('cleSource', photoPreparee.cleTraitee);
        fd.append('cleOriginal', photoPreparee.cleOriginal);
      } else {
        fd.append('file', file);
      }
      fd.append('consent', 'true');
      fd.append('name', kind === 'video' ? 'Mon avatar vidéo' : 'Mon avatar');
      // L'avatar vidéo passe par D-ID quand le serveur l'a ouvert ; la photo
      // reste HeyGen, à l'identique. Le serveur revérifie le drapeau.
      if (kind === 'video' && didVideoActif) fd.append('provider', 'did');

      // Envoi avec les octets RÉELLEMENT transférés (XHR) : la progression
      // affichée est celle de l'envoi vers Studiio, et s'arrête là — le
      // traitement fournisseur qui suit n'a pas de pourcentage.
      setEnvoiSource({ charges: 0, total: file.size, pourcentage: 0 });
      const res = await envoyerFormulaire<{ success?: boolean; error?: string; data?: { avatar: AvatarRow } }>('/api/avatar/create', fd, {
        onProgression: setEnvoiSource,
      });
      setEnvoiSource(null);
      const json = res.json ?? {};

      if (!json.success || !json.data) {
        setError(json.error || "La création de l'avatar a échoué.");
        return;
      }
      // Le compte avait déjà un avatar : le serveur a préparé une VERSION
      // CANDIDATE, l'actuelle reste utilisée. On relit, sans rien écraser.
      if (!json.data.avatar) {
        setNotice('Nouvelle version en préparation. Votre version actuelle reste utilisée en attendant.');
        setFile(null);
        setPhotoPreparee(null);
        if (preview) URL.revokeObjectURL(preview);
        setPreview(null);
        setConsent(false);
        setMesAvatarsCle((n) => n + 1);
        await loadAvatar(false);
        return;
      }
      setAvatar(json.data.avatar);
      setNotice(
        kind === 'video' && didVideoActif
          ? 'Vidéo importée. Prochaine étape : votre phrase de consentement.'
          : kind === 'video'
            ? "Vidéo importée. L'entraînement de votre avatar prend plusieurs minutes — la page se met à jour toute seule."
            : "Photo importée. Votre avatar est en préparation — vous pouvez déjà écrire votre texte.",
      );
      setFile(null);
      setPhotoPreparee(null);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      setConsent(false);
    } catch {
      setError('Connexion impossible. Réessayez.');
    } finally {
      setEnvoiSource(null);
      setCreating(false);
    }
  };

  // ── Génération de la vidéo ──────────────────────────────────────────
  const poll = useCallback(async (generationId: string) => {
    try {
      const res = await fetch(`/api/avatar/status?generationId=${generationId}`);
      const json = await res.json();
      if (demonteRef.current) return;

      if (!json.success) {
        // Erreur transitoire : on retente, le serveur ne marque pas d'échec.
        pollRef.current = setTimeout(() => poll(generationId), 8000);
        return;
      }

      const { status, videoUrl: url, error: errMsg, progress: realProgress } = json.data;
      const estApercu = apercuGenerationRef.current === generationId;

      if (status === 'completed' && url) {
        setProgress(null);
        if (!estApercu) { memoriserGeneration(null); setGenEtape({ mode: 'heygen', phase: 'prete' }); setStatutFournisseur(null); }
        if (apercuGenerationRef.current === generationId) {
          // C'était l'aperçu : il vit dans son bloc, pas dans « votre vidéo ».
          apercuGenerationRef.current = null;
          setGenStatus('idle');
          const suivant = await loadApercu();
          if (suivant?.statut === 'pret') {
            // Information seulement : le CTA « Voir mon aperçu » est dans la zone d'aperçu, à côté de la vidéo.
            setNotification({
              niveau: 'succes',
              titre: 'Votre aperçu est prêt.',
              detail: 'Regardez-le jusqu’au bout : le bouton « Valider mon avatar » apparaît dès que la lecture démarre.',
            });
          }
          return;
        }
        setVideoUrl(url);
        setGenStatus('completed');
        return;
      }
      if (status === 'failed') {
        if (!estApercu) { memoriserGeneration(null); setGenEchec(errMsg || 'La génération a échoué.'); setStatutFournisseur(null); }
        setGenStatus('failed');
        setError(errMsg || 'La génération a échoué.');
        if (apercuGenerationRef.current === generationId) { apercuGenerationRef.current = null; await loadApercu(); }
        return;
      }
      // Pourcentage RÉEL s'il existe un jour côté API — le seul qu'on affiche.
      if (typeof realProgress === 'number' && Number.isFinite(realProgress)) {
        setProgress(Math.min(99, Math.max(0, realProgress)));
      }
      if (!estApercu) { setStatutFournisseur(typeof status === 'string' ? status : null); setGenEtape({ mode: 'heygen', phase: 'generation' }); }
      setGenStatus('processing');
      pollRef.current = setTimeout(() => poll(generationId), 5000);
    } catch {
      if (demonteRef.current) return;
      pollRef.current = setTimeout(() => poll(generationId), 8000);
    }
  }, [loadApercu]);

  const handleGenerate = async () => {
    if (!avatar || !script.trim() || genStatus === 'pending' || genStatus === 'processing') return;
    setError(null);
    setNotice(null);
    setVideoUrl(null);
    setProgress(null);
    setGenEchec(null);
    setStatutFournisseur(null);
    setGenDebut(Date.now());
    setGenStatus('pending');
    // La qualité n'est envoyée que si le serveur l'a offerte ouverte ; il revérifie et refuse sinon.
    const qualiteEnvoyee = qualites.some((q) => q.qualite === qualite && q.ouverte) ? qualite : undefined;

    // MA voix (voix clonée) : le moteur du jumeau de Créer, tel quel.
    if (voiceId.startsWith(PREFIXE_VOIX_CLONEE)) {
      const choisie = voiceId.slice(PREFIXE_VOIX_CLONEE.length);
      setGenEtape({ mode: 'jumeau', phase: 'verification' });
      // Vérifiée MAINTENANT par le serveur, AVEC cette voix : du compte, prête,
      // jumeau prêt. Sinon, on le dit ; jamais une autre voix en silence.
      const etat = await lireEtatJumeau(fetch, avatar.id, choisie);
      if (demonteRef.current) return;
      const refus = !etat ? VOIX_CLONEE_ILLISIBLE
        : !etat.pret ? (etat.message || VOIX_CLONEE_INDISPONIBLE)
          : etat.jumeau && etat.jumeau.voix.id !== choisie ? VOIX_CLONEE_INDISPONIBLE
            : !etat.moteurDisponible ? (etat.messageMoteur || VOIX_CLONEE_INDISPONIBLE)
              : null;
      if (refus) {
        // La voix n'est plus utilisable : elle est marquée comme telle, la sélection reste affichée.
        setVoixClonees((liste) => liste.map((v) => (v.id === choisie ? { ...v, utilisable: false } : v)));
        setRefusVoixClonee(refus);
      }
      if (refus) {
        setGenEchec(refus);
        setGenStatus('failed');
        setError(refus);
        return;
      }
      setGenStatus('processing');
      setGenEtape({ mode: 'jumeau', phase: 'envoi' });
      try {
        const { url } = await genererEtAttendreVideoJumeau({
          textes: [script.trim()], aspectRatio: ratio, avatarId: avatar.id, voixId: choisie,
          ...(qualiteEnvoyee ? { qualite: qualiteEnvoyee } : {}),
          // Acceptée par le serveur : mémorisée pour reprendre le SUIVI après un rechargement.
          onLancee: (generationId) => memoriserGeneration({ generationId, mode: 'jumeau', avatarId: avatar.id, debutLe: Date.now() }),
          onPhase: (ph) => { if (!demonteRef.current) setGenEtape({ mode: 'jumeau', phase: phaseJumeauVersEtape(ph) }); },
        });
        memoriserGeneration(null);
        if (demonteRef.current) return;
        setVideoUrl(url);
        setGenEtape({ mode: 'jumeau', phase: 'prete' });
        setGenStatus('completed');
      } catch (e) {
        if (demonteRef.current) return;
        const message = e instanceof Error && e.message ? e.message : 'La génération a échoué.';
        // Une attente interrompue (réseau, session) ne dit rien de la génération : on garde de quoi la reprendre.
        const code = (e as { code?: string })?.code;
        if (code !== 'connexion' && code !== 'session' && code !== 'delai') memoriserGeneration(null);
        setGenEchec(message);
        setGenStatus('failed');
        setError(message);
      }
      return;
    }

    setGenEtape({ mode: 'heygen', phase: 'lancement' });
    try {
      const res = await fetch('/api/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarId: avatar.id,
          script: script.trim(),
          voiceId: voiceId || undefined,
          aspectRatio: ratio,
          ...(qualiteEnvoyee ? { qualite: qualiteEnvoyee } : {}),
        }),
      });
      const json = await res.json();

      if (!json.success) {
        const message = json.refunded
          ? `${json.error} Vos crédits ont été remboursés.`
          : json.error || 'La génération a échoué.';
        setGenEchec(message);
        setGenStatus('failed');
        setError(message);
        return;
      }
      memoriserGeneration({ generationId: json.data.generationId, mode: 'heygen', avatarId: avatar.id, debutLe: Date.now() });
      setGenEtape({ mode: 'heygen', phase: 'generation' });
      setStatutFournisseur(typeof json.data.status === 'string' ? json.data.status : null);
      setGenStatus('processing');
      poll(json.data.generationId);
    } catch {
      setGenEchec('Connexion impossible. Réessayez.');
      setGenStatus('failed');
      setError('Connexion impossible. Réessayez.');
    }
  };

  // ── Reprise après rechargement ──────────────────────────────────────
  // Une génération acceptée par le serveur a été mémorisée : on reprend son
  // SUIVI (lecture de statut), jamais un nouveau lancement — aucun débit. La
  // progression repart de l'étape RÉELLE (« Génération de l'avatar »), pas du début.
  const repriseFaiteRef = useRef(false);
  useEffect(() => {
    if (repriseFaiteRef.current || !avatar?.id || avatar.etat !== 'valide') return;
    repriseFaiteRef.current = true;
    const g = relireGeneration();
    if (!g || g.avatarId !== avatar.id) { if (g) memoriserGeneration(null); return; }
    setGenDebut(g.debutLe);
    setGenStatus('processing');
    if (g.mode === 'heygen') {
      setGenEtape({ mode: 'heygen', phase: 'generation' });
      void poll(g.generationId);
      return;
    }
    setGenEtape({ mode: 'jumeau', phase: 'traitement' });
    void attendreStatutJumeau({
      generationId: g.generationId,
      onPhase: (ph) => { if (!demonteRef.current) setGenEtape({ mode: 'jumeau', phase: phaseJumeauVersEtape(ph) }); },
    }).then(({ url }) => {
      memoriserGeneration(null);
      if (demonteRef.current) return;
      setVideoUrl(url);
      setGenEtape({ mode: 'jumeau', phase: 'prete' });
      setGenStatus('completed');
    }).catch((e: unknown) => {
      if (demonteRef.current) return;
      const message = e instanceof Error && e.message ? e.message : 'La génération a échoué.';
      const code = (e as { code?: string })?.code;
      if (code !== 'connexion' && code !== 'session' && code !== 'delai') memoriserGeneration(null);
      setGenEchec(message);
      setGenStatus('failed');
      setError(message);
    });
  }, [avatar?.id, avatar?.etat, poll]);

  const busy = genStatus === 'pending' || genStatus === 'processing';

  /**
   * Les qualités du PARCOURS choisi : voix HeyGen (défaut « Qualité » = Avatar IV,
   * le moteur déjà utilisé) ou voix clonée (moteur du jumeau, défaut du serveur
   * comme dans Créer). Changer de parcours reprend SON défaut : jamais de baisse
   * de qualité silencieuse.
   */
  const viaVoixClonee = voiceId.startsWith(PREFIXE_VOIX_CLONEE);
  const qualites = viaVoixClonee ? qualitesClonee : qualitesHeygen;
    useEffect(() => {
    const liste = viaVoixClonee ? qualitesClonee : qualitesHeygen;
    const defaut = viaVoixClonee ? defautClonee : defautHeygen;
    setQualite(liste.some((q) => q.qualite === defaut && q.ouverte) ? defaut : liste.find((q) => q.ouverte)?.qualite ?? defaut);
  }, [viaVoixClonee, qualitesClonee, qualitesHeygen, defautClonee, defautHeygen]);

  /** « Changer de source » : le geste existant (retour à l'import), aussi offert par les notifications. */
  const changerDeSource = () => {
    // Retour à l'import. Un avatar EXISTANT ne s'écrase plus pour autant
    // (incident du 2026-10-09) : le serveur prépare une VERSION CANDIDATE et
    // l'actuelle reste utilisée (voir `handleCreate`). Le parcours complet
    // (préparation de la vidéo, aperçu, choix) vit dans « Mes avatars ».
    setAvatar(null);
    setVideoUrl(null);
    setProgress(null);
    setGenStatus('idle');
    setError(null);
    setNotice(null);
  };

  /**
   * Les étapes RÉELLEMENT connues de Studiio pour un avatar photo en
   * entraînement : la source est là, le consentement Studiio est certifié
   * (à l'import), le fournisseur a bien reçu la source (`training` implique un
   * identifiant fournisseur). L'entraînement est en cours ; « Prêt » vient
   * après. Rien n'est marqué terminé par anticipation.
   */
  const etapesEntrainementHeygen: EtapeProgression[] = [
    { libelle: 'Source', etat: 'terminee' },
    { libelle: 'Consentement', etat: 'terminee' },
    { libelle: 'Création', etat: 'terminee' },
    { libelle: 'Entraînement', etat: 'courante' },
    { libelle: 'Prêt', etat: 'a_venir' },
  ];

  // ── Le fil d'étapes, dérivé de l'état SERVEUR (cahier UX §2.2) ─────────
  // Source → Consentement → Entraînement → Aperçu → Validation. Rien n'est
  // recalculé à l'écran : `etat` (serveur), `etape_did` (serveur) et
  // `apercu.statut` (serveur) décident. Une seule exception assumée : la
  // réponse de POST /api/avatar/create ne porte pas encore `etat` — on
  // retombe alors sur `status`, comme avant, jusqu'à la relecture.
  const etatEffectif: NonNullable<AvatarRow['etat']> | null = !avatar ? null
    : avatar.etat ?? (avatar.status === 'failed' ? 'echec' : READY_STATUSES.includes(avatar.status) ? (avatar.validated_at ? 'valide' : 'entraine_non_valide') : 'entrainement');
  const etapeDid: EtapeDid | null = viaDid ? (avatar?.etape_did ?? null) : null;
  const apercuPret = apercu?.statut === 'pret';
  const filEtapes: Etape[] = (() => {
    const E = (source: Etape['etat'], consentement: Etape['etat'], entrainement: Etape['etat'], apercuE: Etape['etat'], validation: Etape['etat']): Etape[] => [
      { cle: 'source', libelle: 'Source', etat: source },
      { cle: 'consentement', libelle: 'Consentement', etat: consentement },
      { cle: 'entrainement', libelle: 'Entraînement', etat: entrainement },
      { cle: 'apercu', libelle: 'Aperçu', etat: apercuE },
      { cle: 'validation', libelle: 'Validation', etat: validation },
    ];
    if (!avatar || !etatEffectif || etatEffectif === 'supprime') return E('active', 'a_venir', 'a_venir', 'a_venir', 'a_venir');
    if (etatEffectif === 'valide') return E('terminee', 'terminee', 'terminee', 'terminee', 'terminee');
    if (etatEffectif === 'entraine_non_valide') {
      if (apercuPret) return E('terminee', 'terminee', 'terminee', 'terminee', 'active');
      return E('terminee', 'terminee', 'terminee', apercu?.statut === 'echec' || apercu?.statut === 'indisponible' ? 'correction' : 'active', 'a_venir');
    }
    if (etapeDid && etapeDid.startsWith('consentement_')) {
      return E('terminee', etapeDid === 'consentement_refuse' ? 'correction' : 'active', 'a_venir', 'a_venir', 'a_venir');
    }
    // Entraînement (HeyGen ou D-ID), ou son échec — ou une source restée sans suite (à renvoyer).
    return E('terminee', 'terminee', etatEffectif === 'entrainement' ? 'active' : 'correction', 'a_venir', 'a_venir');
  })();
  const etapeCourante = filEtapes.find((e) => e.etat === 'active' || e.etat === 'correction')?.cle ?? 'pret';

  /** Le badge de l'en-tête : où l'on en est, en un mot. */
  const statutEntete = !avatar ? undefined
    : etatEffectif === 'valide' ? { libelle: 'Prêt', niveau: 'succes' as const }
      : filEtapes.some((e) => e.etat === 'correction') ? { libelle: 'À corriger', niveau: 'erreur' as const }
        : etapeCourante === 'apercu' || etapeCourante === 'validation' ? { libelle: 'À valider', niveau: 'info' as const }
          : { libelle: 'En préparation', niveau: 'neutre' as const };

  /**
   * La consigne de la page — « quoi faire maintenant » (cahier §3.4). Pendant
   * la phrase / la vidéo de consentement D-ID, c'est le panneau qui porte la
   * sienne (elle a ses gestes) : la page n'en ajoute pas une seconde.
   */
  const consignePage: { titre: string; texte: string } | null = (() => {
    if (!avatar) return kind === 'video'
      ? { titre: 'À partir de quelle vidéo ?', texte: didVideoActif ? 'Au moins 1 minute, en parlant naturellement. MP4 ou MOV, 50 Mo max.' : `En train de parler, 1 à 2 minutes. MP4 ou WebM, ${MAX_VIDEO_MB} Mo max.` }
      : { titre: 'À partir de quelle photo ?', texte: 'Un portrait net, de face, bien éclairé. JPG, PNG ou WebP, 10 Mo max.' };
    if (etatEffectif === 'valide') return { titre: 'Votre avatar est prêt.', texte: viaDid ? 'Utilisez-le dans Créer.' : 'Utilisez-le dans Créer, ou faites-lui dire un texte ici.' };
    if (etatEffectif === 'entraine_non_valide') return apercuPret
      ? { titre: 'Ça vous ressemble ? Validez.', texte: 'Vous pourrez toujours changer de source plus tard.' }
      : { titre: 'Regardez votre avatar avant de le valider.', texte: 'Une courte vidéo réelle, avec votre voix, offerte.' };
    if (etapeDid === 'consentement_a_demander' || etapeDid === 'consentement_reutilisable') {
      return { titre: 'Confirmez votre nom, puis obtenez votre phrase.', texte: "Vous la lirez face caméra : c'est ce qui prouve que l'avatar est le vôtre. Un consentement déjà validé est réutilisé." };
    }
    if (etapeDid && etapeDid.startsWith('consentement_')) return null;
    if (etatEffectif === 'entrainement') return { titre: "Plus rien à faire pour l'instant.", texte: 'Plusieurs minutes. Cette page se met à jour toute seule.' };
    if (etatEffectif === 'source_prete') return { titre: 'Renvoyez votre source.', texte: "L'import n'a pas abouti : changez de source pour réessayer." };
    return { titre: "L'entraînement n'a pas abouti.", texte: 'Changez de source et réessayez avec une autre photo ou vidéo.' };
  })();
  const conseilsSource: string[] = kind === 'photo'
    ? ['portrait net', 'visage de face', 'pas de masque ni lunettes de soleil', 'bonne lumière', 'visage entier, non coupé']
    : didVideoActif ? [] : ['visage de face, bien éclairé, en train de parler', 'arrière-plan calme et peu de mouvement, cadrage stable', "c'est la limite d'envoi : pensez à compresser"];

  /** La notification affichée : celle de la page, sinon l'échec d'entraînement HeyGen (qui a sa sortie). */
  const notificationAffichee: NotificationPage | null = notification ?? (!viaDid && trainingFailed
    ? { niveau: 'erreur', titre: "L'entraînement de votre avatar n'a pas abouti.", detail: "La source n'a pas permis de créer l'avatar. Réessayez avec une autre photo : portrait net, de face, bien éclairé.", motif: avatar?.training_error && !trahitUnFournisseur(avatar.training_error) ? avatar.training_error : null, action: { libelle: 'Changer de source', onClick: changerDeSource } }
    : null);

  /** Le média de la source (privée : `/api/avatar/source`), rendu une seule fois quand l'avatar existe. */
  const mediaSource = avatar?.id ? (avatar.avatar_type === 'video' ? (
    <video
      data-avatar-source-apercu="video"
      src={urlSourceAvatar(avatar)}
      onError={(e) => { e.currentTarget.hidden = true; }}
      onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth > 0 && v.videoHeight > 0) setRatioSourceReel(`${v.videoWidth} / ${v.videoHeight}`); }}
      className="w-full h-full object-contain bg-black"
      muted
      playsInline
      controls
    />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      data-avatar-source-apercu="image"
      src={urlSourceAvatar(avatar)}
      onError={(e) => { e.currentTarget.hidden = true; }}
      onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth > 0 && i.naturalHeight > 0) setRatioSourceReel(`${i.naturalWidth} / ${i.naturalHeight}`); }}
      alt={TITRE_SOURCE_AVATAR}
      className="w-full h-full object-contain"
    />
  )) : null;

  /**
   * LA zone d'aperçu (cahier §2.5) : la source aux étapes 1–3, l'aperçu de
   * validation aux étapes 4–5, l'avatar validé à ✓ — et la vidéo générée
   * (« Votre vidéo ») comme état `pret` de la même zone. Tout vient du serveur.
   */
  const zone: { titre: string; etat: EtatApercu; media: React.ReactNode; ratio: string } = (() => {
    // Le format de la SOURCE quand il est connu (dimensions lues) ; sinon l'hypothèse d'avant.
    const ratioSource = (avatar && ratioSourceReel) || (avatar?.avatar_type === 'video' || (!avatar && kind === 'video') ? '9 / 16' : '1 / 1');
    // Avatar prêt : le lecteur prend le FORMAT CHOISI (9:16 / 16:9 / 1:1), aussitôt le bouton changé.
    const ratioFormat = ratioCadre(ratio);
    if (!avatar) {
      if (!preview) return { titre: 'Aperçu', ratio: ratioSource, media: null, etat: { statut: 'vide', message: `Choisissez ${kind === 'video' ? 'une vidéo' : 'une photo'} : elle s'affichera ici.` } };
      return {
        titre: 'Votre source', ratio: ratioSource,
        etat: { statut: 'pret', legende: file ? `${file.name} — ${Math.round(file.size / 1024 / 1024)} Mo` : undefined },
        media: kind === 'video'
          ? <video src={preview} className="w-full h-full object-contain bg-black" muted playsInline controls />
          /* eslint-disable-next-line @next/next/no-img-element */
          : <img src={preview} alt="Aperçu de votre photo" className="w-full h-full object-contain" />,
      };
    }
    if (etatEffectif === 'valide') {
      // Sous le formulaire de génération, pas de légende visible (la hauteur va au lecteur) :
      // le titre dit ce qu'on voit, la légende reste lue par les lecteurs d'écran.
      if (videoUrl) return { titre: 'Votre vidéo', ratio: ratioFormat, etat: { statut: 'pret' }, media: <><video src={videoUrl} controls playsInline className="w-full h-full object-contain bg-black" /><span className="sr-only">Vidéo prête.</span></> };
      // ⚠️ JAMAIS la source ici : elle n'est pas l'avatar utilisé par Créer et
      // l'Autopilote. On montre un RENDU réel de la version active, ou on dit
      // qu'il n'y en a pas — sans rien inventer, sans appeler de fournisseur.
      if (renduRecent) return { titre: `${TITRE_RENDU_RECENT} · v${renduRecent.version}`, ratio: ratioFormat, etat: { statut: 'pret' }, media: <><video data-avatar-rendu-recent={renduRecent.generationId} src={renduRecent.url} controls playsInline className="w-full h-full object-contain bg-black" /><span className="sr-only">{busy ? 'Votre vidéo est en cours de création.' : `Exemple de résultat — ${libelleAvatarActif(renduRecent.version)}.`}</span></> };
      return { titre: TITRE_RENDU_RECENT, ratio: ratioFormat, media: null, etat: busy ? { statut: 'chargement', message: 'Votre vidéo est en cours de création.' } : { statut: 'vide', message: AUCUN_RENDU_RECENT } };
    }
    if (etatEffectif === 'entraine_non_valide') {
      const relance = { onClick: genererApercu, disabled: apercuEnCours || !apercu, principale: notification?.cle !== 'voix_manquante', attributs: { 'data-avatar-apercu': 'generer' } as const };
      if (!apercu || apercu.statut === 'aucun') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'vide', message: 'Aperçu de validation offert — une courte vidéo réelle de votre avatar, avec votre voix.', action: { libelle: apercuEnCours ? 'Lancement de l’aperçu…' : 'Générer mon aperçu', ...relance } } };
      if (apercu.statut === 'echec') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'erreur', message: "L'aperçu n'a pas pu être généré. Vous pouvez le relancer sans frais.", detail: apercu.erreur ?? undefined, action: { libelle: "Relancer l'aperçu", ...relance } } };
      if (apercu.statut === 'en_cours') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'chargement', message: 'Votre aperçu est en cours de génération…', detail: 'Cela prend généralement 1 à 5 minutes. Cette page se met à jour toute seule.' } };
      // `indisponible` : la génération est terminée mais sa vidéo n'a pas pu être
      // conservée (ré-hébergement échoué). Côté serveur c'est définitif pour cette
      // version : relire ne répare rien, relancer est refusé. La seule sortie réelle
      // est une nouvelle source (nouvelle version → nouvel aperçu, offert).
      if (apercu.statut === 'indisponible') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'erreur', message: "L'aperçu a été généré, mais sa vidéo n'a pas pu être conservée. Il ne peut pas être relancé pour cette version.", detail: 'Importez une nouvelle source : un nouvel aperçu vous sera offert.', action: { libelle: 'Changer de source', onClick: changerDeSource } } };
      // `pret` : d'abord la source et « Voir mon aperçu » ; puis la VRAIE vidéo, et « Valider » seulement après le démarrage réel de la lecture.
      if (!apercuVisible) return { titre: 'Aperçu de validation', ratio: ratioSource, media: mediaSource, etat: { statut: 'pret', legende: 'Votre aperçu est prêt.', actionSuivante: { libelle: 'Voir mon aperçu', onClick: voirApercu, attributs: { 'data-avatar-apercu': 'voir' } } } };
      const ouvert = !!apercuOuvert && apercuOuvert.generationId === apercu.generationId;
      return {
        titre: 'Aperçu de validation', ratio: '9 / 16',
        media: <video data-avatar-apercu="video" src={apercu.url} controls autoPlay playsInline onPlaying={apercuEnLecture} className="w-full h-full object-contain bg-black" />,
        etat: ouvert
          ? { statut: 'pret', legende: 'Ça vous ressemble ?', actionSuivante: { libelle: validationEnCours ? 'Validation en cours…' : 'Valider mon avatar', onClick: validerAvatar, disabled: validationEnCours, attributs: { 'data-avatar-apercu': 'valider' } } }
          : { statut: 'pret', legende: 'Lancez la lecture : le bouton de validation apparaîtra ensuite.' },
      };
    }
    // Étapes 2–3 : la source, telle qu'importée.
    return { titre: 'Votre source', ratio: ratioSource, media: mediaSource, etat: { statut: 'pret', legende: !viaDid && etatEffectif === 'entrainement' ? 'Votre avatar est en cours de préparation.' : 'Votre source.' } };
  })();
  const cleValidation = !avatar ? undefined : etatEffectif === 'valide' ? 'valide' : etatEffectif === 'entraine_non_valide' ? 'a-valider' : !viaDid && etatEffectif === 'entrainement' ? 'entrainement' : undefined;
  const cleApercu = etatEffectif === 'entraine_non_valide' && (apercu?.statut === 'en_cours' || apercu?.statut === 'indisponible') ? (apercu.statut === 'en_cours' ? 'en-cours' : 'indisponible') : undefined;

  /**
   * LE STATUT GLOBAL, en un mot, en tête de la colonne de travail — dérivé
   * des mêmes états serveur que le fil d'étapes, jamais recalculé à part.
   * L'action principale est LE geste qui fait avancer ; ce sont les gestes
   * existants (mêmes fonctions), rendus à l'endroit où l'on cherche quoi faire.
   */
  const statutGlobal: StatutAvatarCle = !avatar || !etatEffectif || etatEffectif === 'supprime' ? 'aucun'
    : etatEffectif === 'valide' ? 'pret'
      : filEtapes.some((e) => e.etat === 'correction') || (!viaDid && trainingFailed) ? 'erreur'
        : etatEffectif === 'entraine_non_valide' ? 'a_valider'
          : etapeCourante === 'consentement' ? 'consentement'
            : 'entrainement';
  /**
   * Pas de second CTA principal ici : la page n'en montre qu'un à la fois
   * (cahier #409), et il vit dans la zone d'aperçu ou l'étape. Le bloc de
   * statut ne porte qu'un lien secondaire vers la suite, quand tout est prêt.
   */
  // Avatar prêt : « Utiliser dans Créer » vit dans la carte « Avatar actif » —
  // un seul lien, pas deux le même écran.
  const lienStatut: LienStatut | null = null;
  const texteStatut: string | undefined = (() => {
    if (statutGlobal === 'aucun') return file ? 'Source choisie : certifiez le consentement, puis créez votre avatar.' : 'Commencez par choisir une photo ou une vidéo.';
    if (statutGlobal === 'consentement') return 'Votre phrase de consentement, lue face caméra, prouve que cet avatar est le vôtre.';
    if (statutGlobal === 'entrainement') return 'Plusieurs minutes. Cette page se met à jour toute seule.';
    if (statutGlobal === 'a_valider') return apercu?.statut === 'en_cours' ? 'Votre aperçu est en cours de génération.' : 'Regardez votre aperçu, puis validez votre avatar.';
    if (statutGlobal === 'pret') return busy ? 'Votre vidéo est en cours de création.' : 'Votre avatar est validé et utilisable dans vos créations.';
    return "Quelque chose n'a pas abouti : changez de source et réessayez.";
  })();

  /**
   * L'aperçu à droite ne doit JAMAIS être coupé : sur grand écran on borne sa
   * LARGEUR à ce que la hauteur d'écran permet, ratio conservé (`aspect-ratio`
   * reste maître, rien n'est rogné). Sur mobile (une colonne) la hauteur
   * n'est pas contrainte.
   */
  // UNE seule règle de cadre pour toutes les pages — `.apercu-cadre` (globals.css,
  // posée par ZoneApercu) et UN seul décalage (`--apercu-offset` sur :root) :
  // la carte d'aperçu a ici le même en-tête que celle de Créer, rien à surcharger.

  /** Les voix clonées du compte, et celle que le jumeau utilisera — lues comme Créer, sans fournisseur. */
  useEffect(() => {
    if (!avatar?.id || etatEffectif !== 'valide' || viaDid) return;
    let vivant = true;
    void (async () => {
      const [etat, liste] = await Promise.all([
        lireEtatJumeau(fetch, avatar.id),
        fetch('/api/voice/clone').then((r) => r.json()).catch(() => null),
      ]);
      if (!vivant) return;
      setEtatJumeau(etat);
      const voix = Array.isArray(liste?.voices) ? (liste.voices as Array<{ accountVoiceId?: unknown; name?: unknown; utilisable?: unknown }>) : [];
      setVoixClonees(voix
        .filter((v) => typeof v.accountVoiceId === 'string' && v.accountVoiceId)
        .map((v) => ({
          id: v.accountVoiceId as string,
          nom: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : 'Ma voix',
          // Ancienne réponse sans le champ : on ne promet rien, le serveur tranchera au clic.
          utilisable: v.utilisable !== false,
        })));
    })();
    return () => { vivant = false; };
  }, [avatar?.id, etatEffectif, viaDid]);

  /** Une voix clonée est sélectionnable si elle est PRÊTE et que le moteur du jumeau tourne (le serveur revérifie au clic). */
  const moteurJumeauOk = etatJumeau?.moteurDisponible === true;
  const voixSelectionnable = (v: { utilisable: boolean }) => v.utilisable && moteurJumeauOk;
  const voixCloneeChoisie = voiceId.startsWith(PREFIXE_VOIX_CLONEE) ? voiceId.slice(PREFIXE_VOIX_CLONEE.length) : null;
  const voixCloneeChoisieIndisponible = !!voixCloneeChoisie
    && !voixClonees.some((v) => v.id === voixCloneeChoisie && voixSelectionnable(v));

  if (loading) {
    return (
      <div data-avatar-chargement role="status" className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" aria-hidden />
        <p className="text-sm text-gray-300">Chargement de votre avatar…</p>
      </div>
    );
  }

  /**
   * LA carte de l'avatar actif, fusionnée dans « Mes avatars » : version,
   * usage, « Utiliser dans Créer », « Changer d'avatar » et la source repliée
   * vivent dans la carte de l'avatar par défaut — une carte au lieu de trois.
   */
  const carteActive = avatar && etatEffectif === 'valide' ? {
    attributs: { 'data-avatar-actif': String(avatar.version ?? '') },
    nom: avatar.name || 'Mon avatar',
    type: (avatar.avatar_type === 'video' ? 'video' : 'photo') as 'photo' | 'video',
    contenu: (
      <div className="space-y-3">
        <div className="text-xs text-gray-300" data-avatar-actif-meta>
          {/* VERSION ≠ QUALITÉ : « v3 » numérote l'avatar ; la qualité se choisit à la génération. */}
          {avatar.version ? `Version v${avatar.version}` : ''} · Prêt · {avatar.avatar_type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}
        </div>
        <p className="text-sm text-gray-300">Cet avatar est celui utilisé dans Créer et Autopilote.</p>
      </div>
    ),
    // Une seule rangée d'actions dans la carte : celles de la page, puis Remplacer / Gérer.
    actions: (
      <>
        <Link href="/dashboard/creer" data-avatar-actif-action="creer" data-avatar-action="utiliser-creer" className="button-ghost gap-1.5 !min-h-[30px] !text-xs">Utiliser dans Créer</Link>
        {/* « Changer d'avatar » = choisir parmi MES avatars (« Remplacer » crée une nouvelle version,
            « Créer un nouvel avatar » une nouvelle identité). */}
        <button type="button" onClick={() => setDemandeChoixAvatar((n) => n + 1)} data-avatar-actif-action="changer" className="button-ghost gap-1.5 !min-h-[30px] !text-xs">
          <RefreshCw className="w-3 h-3" /> Changer d’avatar
        </button>
      </>
    ),
    apres: (
      <>
        {/* La source, à part et repliée : elle a servi à CRÉER l'avatar, elle ne l'est pas. */}
        <details data-avatar-source-section className="rounded-lg border border-gray-800 bg-gray-950/50">
          <summary className="cursor-pointer px-3 py-2 text-xs text-gray-300 hover:text-white">{TITRE_SOURCE_AVATAR}</summary>
          <div className="p-3 space-y-2">
            <p className="text-xs text-gray-300">Cette {avatar.avatar_type === 'video' ? 'vidéo' : 'photo'} a servi à créer votre avatar.</p>
            <div className="w-28 rounded-lg overflow-hidden bg-black" style={{ aspectRatio: avatar.avatar_type === 'video' ? '9 / 16' : '1 / 1' }}>{mediaSource}</div>
          </div>
        </details>
      </>
    ),
  } : undefined;
  return (
    <div data-avatar-page className="max-w-6xl mx-auto px-6 pb-6 pt-6 lg:pt-0 space-y-6">
      {/* Grand écran : pas de marge haute en plus de celle du tableau de bord (la colonne
          d'aperçu collante gagne cette hauteur) ; mobile inchangé. */}
      {/* A. En-tête — pas de lien « Aide » : aucune page d'aide n'existe encore, on n'en promet pas. */}
      <EnteteSection
        titre="Mon avatar"
        sousTitre="Votre double vidéo, à partir d'une photo ou d'une vidéo."
        icone={<UserSquare2 className="w-6 h-6 text-white" />}
        statut={statutEntete}
        data-entete="avatar"
      />

      {/* C. Deux colonnes — la même grille que Créer : l'onglet au centre,
          l'aperçu et la génération à droite, collants sur grand écran. */}
      <DeuxColonnes nom="avatar" attributs={{ 'data-avatar-colonnes': '' }}>
        <ColonneTravail attributs={{ 'data-avatar-colonne': 'etape' }}>
          {/* Les onglets ne pilotent que la colonne centrale : ils vivent en tête de
              celle-ci, et la colonne d'aperçu démarre dès sous l'en-tête de page. */}
          <div className="border-b border-gray-800">
            <Onglets
              label="Sections de Mon avatar"
              actif={onglet}
              onChange={(id) => setOnglet(id === 'voix' ? 'voix' : 'avatar')}
              onglets={[
                { id: 'avatar', label: 'Avatar vidéo', icone: <Clapperboard className="w-4 h-4 mr-1.5" />, panneauId: 'panneau-avatar' },
                { id: 'voix', label: 'Voix & Prononciation', icone: <Mic className="w-4 h-4 mr-1.5" />, panneauId: 'ma-voix' },
              ]}
            />
          </div>

          <div role="tabpanel" id="panneau-avatar" aria-labelledby="onglet-avatar" data-avatar-panneau="avatar" className={onglet === 'avatar' ? 'space-y-6' : 'hidden'}>
          {/* Mes avatars — identités, version utilisée, nouvelle version ; la carte active
              fusionnée. Sans aucun avatar, la carte de création ci-dessous suffit. */}
          {avatar && <MesAvatars key={mesAvatarsCle} onChange={() => { void loadAvatar(false); }} carteActive={carteActive} demandeChoixAvatar={demandeChoixAvatar} />}

          {/* LA carte principale — comme la carte du wizard de Créer : le fil
              d'étapes en tête (une étape franchie ramène à la Source), le statut
              global et LE geste suivant, puis la notification (quand il y en a
              une), la consigne, l'étape courante et ses gestes. */}
          <div data-avatar-carte-principale className="card-base p-6 space-y-5">
          <FilEtapes
            etapes={filEtapes}
            atteignables={avatar && !suppressionEnCours ? ['source'] : []}
            onAller={(cle) => { if (cle === 'source') changerDeSource(); }}
            sansNoms
            className="mb-1"
          />
          <StatutAvatar statut={statutGlobal} texte={texteStatut} lien={lienStatut} />

      {notificationAffichee && (
            <Notification
              niveau={notificationAffichee.niveau}
              titre={notificationAffichee.titre}
              detail={notificationAffichee.detail}
              motif={notificationAffichee.motif ?? null}
              {...(notificationAffichee.actionSecondaire ? { actionSecondaire: notificationAffichee.action } : { actionPrincipale: notificationAffichee.action })}
              onFermer={() => setNotification(null)}
              className={notificationAffichee.niveau === 'erreur' ? '[&_[data-notification-titre]]:font-normal' : undefined}
            >
              {notificationAffichee.niveau === 'succes' && (
                <span data-avatar-notice className="sr-only">{[notificationAffichee.titre, ...(Array.isArray(notificationAffichee.detail) ? notificationAffichee.detail : [notificationAffichee.detail ?? ''])].join(' ').trim()}</span>
              )}
            </Notification>
          )}

          {consignePage && (
            <Consigne
              titre={consignePage.titre}
              texte={consignePage.texte}
              conseils={!avatar && conseilsSource.length > 0 ? conseilsSource : undefined}
              ouvertParDefaut={!avatar}
            >
              {!avatar && kind === 'video' && didVideoActif && (
                <ul data-avatar-did-conseils className="list-disc pl-4 space-y-0.5 text-[12px] text-gray-300 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                  <li><span className="text-gray-100 font-medium">Au moins 1 minute</span> de vidéo.</li>
                  <li>Parlez naturellement, regardez régulièrement la caméra.</li>
                  <li>Lumière stable, visage bien visible.</li>
                  <li>Évitez le montage et les coupures rapides.</li>
                  <li>MP4 ou MOV, <span className="text-gray-100">{MAX_VIDEO_DID_MB} Mo maximum</span>.</li>
                </ul>
              )}
            </Consigne>
          )}

          {/* ÉTAPE 1 — la source (première visite, ou « Changer de source ») */}
          {!avatar && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { id: 'photo' as const, Icon: ImageIcon, title: 'À partir d’une photo', sub: 'Prêt en quelques minutes', soon: false },
                  { id: 'video' as const, Icon: Clapperboard, title: 'À partir d’une vidéo', sub: 'Plus réaliste, entraînement plus long', soon: !(didVideoActif || jumeauVideoActif) },
                ]).map(({ id, Icon, title, sub, soon }) => (
                  <button
                    key={id}
                    onClick={() => !soon && selectKind(id)}
                    disabled={soon}
                    aria-disabled={soon}
                    className={`relative rounded-xl p-4 text-left transition ${
                      soon
                        ? 'bg-gray-900/40 opacity-60 cursor-not-allowed'
                        : kind === id
                          ? 'bg-purple-600/20 ring-1 ring-purple-500/50'
                          : 'bg-gray-900/60 hover:bg-gray-800/70'
                    }`}
                  >
                    {soon && (
                      <span className="absolute top-2 right-2 rounded-full bg-purple-500/20 text-purple-200 text-[10px] font-semibold px-2 py-0.5 ring-1 ring-purple-500/40">
                        Bientôt disponible
                      </span>
                    )}
                    <Icon className={`w-5 h-5 mb-2 ${kind === id && !soon ? 'text-purple-300' : 'text-gray-400'}`} />
                    <div className="text-sm font-medium">{title}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{sub}</div>
                  </button>
                ))}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={
                  kind === 'video'
                    ? (didVideoActif ? 'video/mp4,video/quicktime' : 'video/mp4,video/webm,video/quicktime')
                    : 'image/jpeg,image/png,image/webp'
                }
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-gray-700 hover:border-purple-500 transition p-6 flex flex-col items-center gap-3 text-gray-400 hover:text-white"
              >
                <Upload className="w-8 h-8" />
                <span className="text-sm">
                  {file
                    ? `${file.name} — ${Math.round(file.size / 1024 / 1024)} Mo`
                    : kind === 'video'
                      ? 'Choisir une vidéo'
                      : 'Choisir une photo'}
                </span>
              </button>

              {/* Photo : « Embellir le visage », facultatif — le parcours d'avant reste identique sans lui. */}
              {kind === 'photo' && file && !ameliorerPhoto && (
                <div data-avatar-photo-embellir className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-900/60 p-3 text-sm">
                  <span className="text-gray-300">{photoPreparee ? `Embellissement : ${LIBELLE_EMBELLISSEMENT[photoPreparee.embellissement]} — original conservé.` : 'Embellir le visage (facultatif)'}</span>
                  <button type="button" data-avatar-photo-ameliorer onClick={() => setAmeliorerPhoto(true)} className="button-ghost !min-h-[30px] !text-xs">{photoPreparee ? 'Modifier' : 'Améliorer ma photo'}</button>
                </div>
              )}
              {kind === 'photo' && file && ameliorerPhoto && (
                <PreparationPhoto
                  fichier={file}
                  onAnnuler={() => setAmeliorerPhoto(false)}
                  onPret={(r) => { setPhotoPreparee({ cleOriginal: r.cleOriginal, cleTraitee: r.cleTraitee, embellissement: r.embellissement }); setAmeliorerPhoto(false); }}
                />
              )}

              {/* Consentement — obligatoire, également vérifié côté serveur */}
              <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-gray-900/60 p-4">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 flex-shrink-0 accent-purple-600"
                />
                <span className="text-sm text-gray-300">
                  {kind === 'video' && didVideoActif
                    ? "Je certifie être la personne visible dans la vidéo et j'autorise Studiio et D-ID à l'utiliser pour entraîner un avatar à mon effigie."
                    : kind === 'video'
                      ? "Je certifie être la personne visible dans la vidéo et j'autorise Studiio et ses prestataires techniques à l'utiliser pour entraîner un avatar à mon effigie."
                      : "Je certifie être la personne visible sur l'image et j'autorise Studiio à en créer un avatar animé."}
                </span>
              </label>

              {/* L'envoi vers Studiio, avec les octets RÉELLEMENT transférés. À 100 %,
                  le serveur prend le relais (et, pour la photo, sollicite le fournisseur) :
                  cette barre ne prétend rien de plus. */}
              {envoiSource && (
                <ProgressStatus
                  titre={kind === 'video' ? 'Envoi de votre vidéo' : 'Envoi de votre photo'}
                  statut="en_cours"
                  pourcentage={envoiSource.pourcentage}
                  detail={detailEnvoi(envoiSource)}
                  note={envoiSource.pourcentage >= 100 ? 'Envoi terminé — Studiio enregistre votre fichier.' : null}
                  compact
                />
              )}
              <button
                onClick={handleCreate}
                disabled={!file || !consent || creating}
                className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {kind === 'video' ? 'Envoi de la vidéo…' : 'Envoi de la photo…'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    {kind === 'video' && didVideoActif ? 'Importer ma vidéo' : kind === 'video' ? 'Créer mon avatar vidéo' : 'Créer mon avatar'}
                  </>
                )}
              </button>
            </div>
          )}

          {/* ÉTAPES 2–5 — l'étape courante, avec ses gestes */}
          {avatar && (
            <div className="space-y-5">
              {/* Quand la zone d'aperçu montre autre chose que la source (aperçu de
                  validation, vidéo produite), la source reste visible ici, en petit. */}
              {etatEffectif !== 'valide' && zone.media !== mediaSource && (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-black [&>*]:w-12 [&>*]:h-12 [&>*]:object-cover">{mediaSource}</div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{avatar.name || 'Mon avatar'}</div>
                    <div className="text-xs text-gray-500">{avatar.avatar_type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}</div>
                  </div>
                </div>
              )}
              {!viaDid && jumeauVideoActif && avatar.avatar_type === 'video' && avatar.status !== 'failed' && (
                <ConsentementJumeauAdmin
                  statutInitial={(avatar.provider_group_consent as 'pending' | 'accepted' | 'rejected' | null | undefined) ?? null}
                  onAccepte={() => { void loadAvatar(false); }}
                />
              )}
              {viaDid && avatar.etape_did && avatar.etape_did !== 'valide' && (
                <AvatarVideoDid
                  etape={avatar.etape_did}
                  texteConsentement={avatar.provider_consent_text ?? null}
                  nomConsentement={avatar.consent_name ?? null}
                  nomProfil={nomProfil}
                  expireLe={avatar.consent_expire_le ?? null}
                  erreurEntrainement={avatar.training_error ?? null}
                  onChange={async () => { await loadAvatar(false); }}
                  onChangerSource={changerDeSource}
                />
              )}

              {/* Entraînement : le fournisseur ne rend qu'un statut → barre INDÉTERMINÉE,
                  aucun pourcentage inventé. Le workflow (étapes réellement connues de
                  Studiio) a son propre chiffre, nommé à part. La durée écoulée part de
                  `consent_at` : l'horodatage serveur de l'import, dans la même requête
                  que la sollicitation du fournisseur. */}
              {!viaDid && training && !trainingFailed && (
                <ProgressStatus
                  titre="Entraînement de votre avatar"
                  statut="en_cours"
                  etapes={etapesEntrainementHeygen}
                  detail="Entraînement en cours — progression exacte indisponible."
                  debutLe={avatar.consent_at ?? undefined}
                  description="Cela prend généralement plusieurs minutes."
                />
              )}

              {/* Aperçu affiché, lecture pas encore démarrée : « Valider » n'existe pas encore. */}
              {etatEffectif === 'entraine_non_valide' && apercuPret && apercuVisible && !(apercuOuvert && apercu && 'generationId' in apercu && apercuOuvert.generationId === apercu.generationId) && (
                <div data-avatar-apercu="en-attente-lecture" className="text-xs text-gray-400">
                  Lancez la lecture de votre aperçu : le bouton de validation apparaîtra ensuite.
                </div>
              )}

              {/* La génération de vidéos à la demande reste HeyGen : un avatar vidéo D-ID
                  n'y est pas encore branché — on le dit, on ne l'offre pas. */}
              {viaDid && (
                <div data-avatar-did-generation="indisponible" className="text-xs text-gray-400">
                  La génération de vidéos avec votre avatar vidéo arrive après sa validation. Pour l&apos;instant : aperçu et validation.
                </div>
              )}

              {/* Actions secondaires : en texte, jamais au niveau du CTA. Suppression en deux clics. */}
              <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-white/5">
                {etatEffectif !== 'valide' && !(notificationAffichee?.action?.libelle === 'Changer de source' || (zone.etat.statut === 'erreur' && zone.etat.action?.libelle === 'Changer de source') || (viaDid && avatar.etape_did === 'echec')) && (
                  <button onClick={changerDeSource} className="text-xs text-gray-400 hover:text-white flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" /> Changer de source
                  </button>
                )}
                {suppressionArmee ? (
                  <button
                    data-avatar-supprimer="confirmer"
                    onClick={supprimerAvatar}
                    disabled={suppressionEnCours}
                    className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {suppressionEnCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Confirmer la suppression
                  </button>
                ) : (
                  <button
                    data-avatar-supprimer="armer"
                    onClick={() => setSuppressionArmee(true)}
                    className="text-xs text-gray-400 hover:text-red-300 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer mon avatar
                  </button>
                )}
              </div>
            </div>
          )}

          </div>
          </div>

          {/* ── VOIX & PRONONCIATION ─────────────────────────────────────
              Le clonage vocal est indépendant de l'avatar : il alimente le
              sélecteur de voix de TOUS les montages. `id="ma-voix"` : cible du
              lien « Gérer / cloner ma voix » de Créer > Audio. */}
          <section id="ma-voix" ref={maVoixRef} tabIndex={-1} role="tabpanel" aria-labelledby="onglet-voix" data-avatar-ma-voix className={onglet === 'voix' ? 'outline-none space-y-6' : 'hidden'}>
            <EnteteSection
              titre="Ma voix"
              sousTitre="Votre voix clonée, ses prononciations et son écoute — pour tous vos montages."
              icone={<Mic className="w-6 h-6 text-white" />}
              niveauTitre={2}
              data-entete="ma-voix"
            />
            <div className="card-base space-y-8">
              <VoiceCloneRecorder />
              {/* La voix utilisée, les prononciations, l'aperçu prononcé, l'écoute. */}
              <div className="border-t border-gray-800 pt-6">
                <MaVoixPanel />
              </div>
            </div>
          </section>
        </ColonneTravail>

        {/* Sur mobile (une colonne) l'aperçu suit la carte, puis vient « Ma voix » ;
            sur grand écran il reste à droite, collant, et jamais plus haut que l'écran. */}
        <ColonneApercu attributs={{ 'data-avatar-colonne': 'apercu' }}>
          <div data-avatar-validation={cleValidation}>
            <div data-avatar-apercu={cleApercu} data-avatar-apercu-cadre={zone.ratio}>
              {/* Avec le formulaire de génération sous lui, le cadre (ratio intact, jamais
                  rogné) est borné en LARGEUR selon la hauteur d'écran (voir
                  `lib/ui/lecteur-generation.ts`) : lecteur, texte, voix, format et « Générer
                  la vidéo » tiennent ensemble dès l'ouverture, de 1366×768 à 1440×900.
                  Sans formulaire : règle commune (`.apercu-cadre`). */}
              <ZoneApercu
                titre={zone.titre}
                etat={zone.etat}
                ratio={zone.ratio}
                className={avatar && etatEffectif === 'valide' && !viaDid ? `${CLASSES_LECTEUR_GENERATION[ratio]} lg:!p-3 lg:!space-y-2` : ''}
              >
                {zone.media}
              </ZoneApercu>
            </div>
          </div>

          {/* ✓ Prêt — l'étape suivante : faire parler l'avatar (photo HeyGen seulement). */}
          {avatar && etatEffectif === 'valide' && !viaDid && (
            <div data-avatar-generation className="card-base !p-4 space-y-2.5">
              <div>
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <label className="text-xs font-medium text-gray-100">Ce que dit votre avatar</label>
                  <span className="text-xs text-gray-400">{script.length} / {MAX_SCRIPT_CHARS}</span>
                </div>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value.slice(0, MAX_SCRIPT_CHARS))}
                  rows={2}
                  placeholder="Bonjour, je suis…"
                  className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-studiio-primary focus:ring-1 focus:ring-studiio-primary outline-none px-3 py-2 text-sm text-gray-100 placeholder-gray-500 resize-y"
                />
              </div>

              {/* Voix et Qualité côte à côte, le Format sur une ligne : lecteur, réglages et
                  « Générer la vidéo » tiennent ensemble à l'ouverture, de 1366×768 à 1440×900. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label className="block text-xs font-medium text-gray-100 mb-1">Voix</label>
                  <select
                    data-avatar-voix
                    value={voiceId}
                    onChange={(e) => { setVoiceId(e.target.value); setRefusVoixClonee(null); }}
                    disabled={voices.length === 0 && voixClonees.length === 0}
                    className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-studiio-primary focus:ring-1 focus:ring-studiio-primary outline-none px-2.5 py-2 text-sm text-gray-100 disabled:opacity-50"
                  >
                    {voices.length === 0 && voixClonees.length === 0 && <option value="">Voix indisponibles</option>}
                    {/* MA VOIX en premier — seulement si le compte en a une. Toute voix PRÊTE
                        se choisit ici, pour cette vidéo seulement (la voix enregistrée du
                        compte, celle de Créer et de l'Autopilote, ne change pas). */}
                    {voixClonees.length > 0 && (
                      <optgroup label="Ma voix" data-avatar-voix-groupe="clonees">
                        {voixClonees.map((v) => {
                          const ok = voixSelectionnable(v);
                          return (
                            <option key={v.id} value={`${PREFIXE_VOIX_CLONEE}${v.id}`} disabled={!ok && voiceId !== `${PREFIXE_VOIX_CLONEE}${v.id}`} data-voix-clonee={v.id}>
                              {v.nom} — Voix clonée{ok ? '' : v.utilisable ? ' (moteur indisponible)' : ' (pas prête)'}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                    {voixClonees.length > 0 && voices.length > 0 ? (
                      <optgroup label="Voix disponibles" data-avatar-voix-groupe="disponibles">
                        {voices.map((v) => (
                          <option key={v.voiceId} value={v.voiceId}>
                            {v.name}
                            {v.language ? ` — ${v.language}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ) : voices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.name}
                        {v.language ? ` — ${v.language}` : ''}
                      </option>
                    ))}
                  </select>
                  {voixCloneeChoisie && !voixCloneeChoisieIndisponible && (
                    <span data-voix-clonee-badge className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-studiio-primary/20 text-purple-200 px-2 py-0.5 text-[10px] font-semibold">
                      <Mic className="w-3 h-3" /> Voix clonée
                    </span>
                  )}
                  {voixCloneeChoisieIndisponible && (
                    <p data-voix-clonee-indisponible role="alert" className="mt-1.5 text-xs text-amber-300">
                      {refusVoixClonee || (!moteurJumeauOk && etatJumeau?.messageMoteur) || VOIX_CLONEE_INDISPONIBLE}
                    </p>
                  )}
                </div>
                {/* QUALITÉ DE RENDU — pour cette vidéo, distincte de la VERSION de l'avatar.
                    Un niveau fermé reste visible, grisé, avec SA raison dans son libellé. */}
                {qualites.length > 0 && (
                  <div data-avatar-qualite className="min-w-0">
                    <label htmlFor="avatar-qualite" className="block text-xs font-medium text-gray-100 mb-1">Qualité</label>
                    <select
                      id="avatar-qualite"
                      data-avatar-qualite-choix
                      value={qualite}
                      disabled={busy}
                      onChange={(e) => setQualite(e.target.value as Qualite)}
                      className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-studiio-primary focus:ring-1 focus:ring-studiio-primary outline-none px-2.5 py-2 text-sm text-gray-100 disabled:opacity-50"
                    >
                      {qualites.map((q) => (
                        <option key={q.qualite} value={q.qualite} disabled={!q.ouverte} data-avatar-qualite-option={q.qualite} data-avatar-qualite-ouverte={q.ouverte ? 'oui' : 'non'}>
                          {q.libelle}{q.recommandee ? ' — recommandé' : q.qualite === 'standard' ? ' — économique' : q.qualite === 'premium' ? ' — maximale' : ''}{q.ouverte ? '' : ` (indisponible : ${q.motif ?? 'pas encore ouvert'})`}
                        </option>
                      ))}
                    </select>
                    {viaVoixClonee && <p data-avatar-qualite-voix-clonee className="mt-1 text-[10px] text-gray-400">Avec votre voix clonée, la qualité suit celle de Créer.</p>}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-100 shrink-0 w-14">Format</span>
                <div className="flex gap-1.5 flex-1" role="group" aria-label="Format">
                  {(['9:16', '16:9', '1:1'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRatio(r)}
                      aria-pressed={ratio === r}
                      className={`flex-1 rounded-lg px-2 py-1.5 text-sm transition ${
                        ratio === r
                          ? 'bg-studiio-primary/20 text-purple-200 ring-1 ring-studiio-primary/50'
                          : 'bg-gray-800 text-gray-300 hover:text-white'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div data-avatar-generer className="space-y-3">
              <button
                onClick={handleGenerate}
                disabled={!script.trim() || busy || voixCloneeChoisieIndisponible}
                className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {genStatus === 'pending' ? 'Lancement…' : 'Génération en cours…'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Générer la vidéo ({AVATAR_VIDEO_COST} crédits)
                  </>
                )}
              </button>

              {/* Génération : les étapes RÉELLES du parcours (HeyGen ou jumeau), barre
                  indéterminée — un pourcentage n'apparaît que si l'API en rend un réel.
                  En échec, la progression s'arrête sur l'étape fautive ; en succès, elle le dit. */}
              {genEtape && (busy || genStatus === 'failed' || genStatus === 'completed') && (() => {
                const liste = genEtape.mode === 'heygen' ? ETAPES_GENERATION_HEYGEN : ETAPES_GENERATION_JUMEAU;
                const etapes = genEtape.mode === 'heygen'
                  ? etapesGeneration(ETAPES_GENERATION_HEYGEN, genEtape.phase, genStatus === 'failed')
                  : etapesGeneration(ETAPES_GENERATION_JUMEAU, genEtape.phase, genStatus === 'failed');
                const etapeEchec = liste.find((l) => l.phase === genEtape.phase)?.libelle;
                return (
                  <div data-avatar-generation-progression={genStatus} data-avatar-generation-mode={genEtape.mode} data-avatar-generation-phase={genEtape.phase}>
                    <ProgressStatus
                      titre={genStatus === 'completed' ? 'Votre vidéo est prête' : genStatus === 'failed' ? 'La génération a échoué' : 'Création de votre vidéo'}
                      statut={genStatus === 'completed' ? 'succes' : genStatus === 'failed' ? 'erreur' : 'en_cours'}
                      etapes={etapes}
                      {...(progress !== null && busy ? { pourcentage: progress } : {})}
                      description={busy ? DETAIL_GENERATION[genEtape.phase] : undefined}
                      detail={busy ? (detailStatutFournisseur(statutFournisseur) ?? (progress === null ? 'Progression exacte indisponible.' : undefined)) : undefined}
                      debutLe={busy && genDebut ? genDebut : undefined}
                      echec={genStatus === 'failed' ? { etape: etapeEchec, motif: genEchec ?? 'La génération a échoué.' } : undefined}
                      note={busy ? 'Cela prend généralement quelques minutes. Vous pouvez recharger la page : le suivi reprendra.' : null}
                      compact={!busy && genStatus === 'completed'}
                    />
                  </div>
                );
              })()}
              </div>
              {videoUrl && (
                <a
                  href={videoUrl}
                  download
                  className="inline-flex items-center gap-2 text-sm text-purple-300 hover:text-purple-200"
                >
                  <Download className="w-4 h-4" /> Télécharger la vidéo
                </a>
              )}
            </div>
          )}
        </ColonneApercu>
      </DeuxColonnes>

    </div>
  );
}

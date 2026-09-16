'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import VoiceCloneRecorder from '@/components/voice/VoiceCloneRecorder';
import MaVoixPanel from '@/components/voice/MaVoixPanel';
import AvatarVideoDid, { type EtapeDid } from '@/components/avatar/AvatarVideoDid';
import { Notification, ProgressStatus, EnteteSection, FilEtapes, Consigne, ZoneApercu, type EtapeProgression, type Etape, type EtatApercu, type NiveauNotification } from '@/components/ux';
import { envoyerFormulaire, detailEnvoi, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';

const AVATAR_VIDEO_COST = 40;
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

export default function AvatarPage() {
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  /** « À partir d'une vidéo » n'est ouvert que si le serveur le dit (drapeau + clé D-ID). */
  const [didVideoActif, setDidVideoActif] = useState(false);
  /** Le nom du profil (rendu par le serveur) ne sert qu'à PRÉ-REMPLIR le nom de consentement D-ID : la personne le corrige. */
  const [nomProfil, setNomProfil] = useState<string | null>(null);

  // Création
  const [kind, setKind] = useState<AvatarKind>('photo');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [creating, setCreating] = useState(false);

  // Génération
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [ratio, setRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [genStatus, setGenStatus] = useState<GenStatus>('idle');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  /**
   * L'aperçu RÉEL du clone (une vraie génération HeyGen sur le texte fixe de
   * Studiio) et la preuve de son ouverture. `jeton` n'existe qu'après
   * « Voir mon avatar » ; c'est lui, et lui seul, qui ouvre « Valider ».
   */
  type Apercu = { statut: 'aucun' } | { statut: 'en_cours'; generationId: string } | { statut: 'echec'; generationId: string; erreur: string | null } | { statut: 'indisponible'; generationId: string } | { statut: 'pret'; generationId: string; url: string };
  const [apercu, setApercu] = useState<Apercu | null>(null);
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
  const maVoixRef = useRef<HTMLDivElement | null>(null);

  /**
   * LA notification de la page (cahier UX, §2.3) : une seule à la fois, la
   * plus récente remplace. Les anciens `error` / `notice` / « voix manquante »
   * passent tous par ce slot ; `setError(null)` n'efface qu'une erreur.
   */
  type NotificationPage = { niveau: NiveauNotification; titre: string; detail?: string | string[]; motif?: string | null; action?: { libelle: string; onClick: () => void } };
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
    niveau: 'avertissement',
    titre: "Votre voix personnelle est nécessaire pour l'aperçu.",
    detail: "L'aperçu fait parler votre avatar avec votre voix. Ajoutez ou choisissez-la dans « Ma voix ».",
    action: { libelle: 'Configurer ma voix', onClick: () => { maVoixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); maVoixRef.current?.focus(); } },
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
        ? " Votre clone n'est pas supprimé automatiquement chez notre fournisseur."
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
      setNotification({ niveau: 'succes', titre: 'Avatar validé.', detail: 'Il est prêt pour vos vidéos.', action: { libelle: 'Créer une vidéo', onClick: () => window.location.assign('/dashboard/creer') } });
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
    setNomProfil(typeof json.data.nomProfil === 'string' ? json.data.nomProfil : null);
    if (json.data.avatar?.etat === 'entraine_non_valide') void loadApercu();
    else setApercu(null);
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
      fd.append('file', file);
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
      setAvatar(json.data.avatar);
      setNotice(
        kind === 'video' && didVideoActif
          ? 'Vidéo importée. Prochaine étape : votre phrase de consentement.'
          : kind === 'video'
            ? "Vidéo importée. L'entraînement de votre avatar prend plusieurs minutes — la page se met à jour toute seule."
            : "Photo importée. Votre avatar est en préparation — vous pouvez déjà écrire votre texte.",
      );
      setFile(null);
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

      if (status === 'completed' && url) {
        setProgress(null);
        if (apercuGenerationRef.current === generationId) {
          // C'était l'aperçu : il vit dans son bloc, pas dans « votre vidéo ».
          apercuGenerationRef.current = null;
          setGenStatus('idle');
          const suivant = await loadApercu();
          if (suivant?.statut === 'pret') {
            setNotification({
              niveau: 'succes',
              titre: 'Votre aperçu est prêt.',
              detail: 'Regardez-le jusqu’au bout : le bouton « Valider mon avatar » apparaît dès que la lecture démarre.',
              action: { libelle: 'Voir mon aperçu', onClick: () => { setApercuVisible(true); } },
            });
          }
          return;
        }
        setVideoUrl(url);
        setGenStatus('completed');
        return;
      }
      if (status === 'failed') {
        setGenStatus('failed');
        setError(errMsg || 'La génération a échoué.');
        if (apercuGenerationRef.current === generationId) { apercuGenerationRef.current = null; await loadApercu(); }
        return;
      }
      // Pourcentage RÉEL s'il existe un jour côté API — le seul qu'on affiche.
      if (typeof realProgress === 'number' && Number.isFinite(realProgress)) {
        setProgress(Math.min(99, Math.max(0, realProgress)));
      }
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
    setGenStatus('pending');

    try {
      const res = await fetch('/api/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarId: avatar.id,
          script: script.trim(),
          voiceId: voiceId || undefined,
          aspectRatio: ratio,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setGenStatus('failed');
        setError(
          json.refunded
            ? `${json.error} Vos crédits ont été remboursés.`
            : json.error || 'La génération a échoué.',
        );
        return;
      }
      setGenStatus('processing');
      poll(json.data.generationId);
    } catch {
      setGenStatus('failed');
      setError('Connexion impossible. Réessayez.');
    }
  };

  const busy = genStatus === 'pending' || genStatus === 'processing';

  /** « Changer de source » : le geste existant (retour à l'import), aussi offert par les notifications. */
  const changerDeSource = () => {
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
      return E('terminee', 'terminee', 'terminee', apercu?.statut === 'echec' ? 'correction' : 'active', 'a_venir');
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
    ? { niveau: 'erreur', titre: "L'entraînement de votre avatar n'a pas abouti.", detail: "La source n'a pas permis de créer l'avatar. Réessayez avec une autre photo : portrait net, de face, bien éclairé.", motif: avatar?.training_error ?? null, action: { libelle: 'Changer de source', onClick: changerDeSource } }
    : null);

  /** Le média de la source (privée : `/api/avatar/source`), rendu une seule fois quand l'avatar existe. */
  const mediaSource = avatar?.id ? (avatar.avatar_type === 'video' ? (
    <video
      data-avatar-source-apercu="video"
      src={urlSourceAvatar(avatar)}
      onError={(e) => { e.currentTarget.hidden = true; }}
      className="w-full max-h-[420px] object-contain bg-black"
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
      alt="Votre avatar"
      className="w-full max-h-[420px] object-contain"
    />
  )) : null;

  /**
   * LA zone d'aperçu (cahier §2.5) : la source aux étapes 1–3, l'aperçu de
   * validation aux étapes 4–5, l'avatar validé à ✓ — et la vidéo générée
   * (« Votre vidéo ») comme état `pret` de la même zone. Tout vient du serveur.
   */
  const zone: { titre: string; etat: EtatApercu; media: React.ReactNode; ratio: string } = (() => {
    const ratioSource = avatar?.avatar_type === 'video' || (!avatar && kind === 'video') ? '9 / 16' : '1 / 1';
    if (!avatar) {
      if (!preview) return { titre: 'Aperçu', ratio: ratioSource, media: null, etat: { statut: 'vide', message: `Choisissez ${kind === 'video' ? 'une vidéo' : 'une photo'} : elle s'affichera ici.` } };
      return {
        titre: 'Votre source', ratio: ratioSource,
        etat: { statut: 'pret', legende: file ? `${file.name} — ${Math.round(file.size / 1024 / 1024)} Mo` : undefined },
        media: kind === 'video'
          ? <video src={preview} className="w-full max-h-[420px] bg-black" muted playsInline controls />
          /* eslint-disable-next-line @next/next/no-img-element */
          : <img src={preview} alt="Aperçu de votre photo" className="w-full max-h-[420px] object-contain" />,
      };
    }
    if (etatEffectif === 'valide') {
      if (videoUrl) return { titre: 'Votre vidéo', ratio: '9 / 16', etat: { statut: 'pret', legende: 'Vidéo prête.' }, media: <video src={videoUrl} controls playsInline className="w-full bg-black" style={{ maxHeight: '70vh' }} /> };
      return { titre: 'Votre avatar', ratio: ratioSource, etat: { statut: 'pret', legende: busy ? 'Avatar validé — votre vidéo est en cours de création.' : 'Avatar validé.' }, media: mediaSource };
    }
    if (etatEffectif === 'entraine_non_valide') {
      const relance = { onClick: genererApercu, disabled: apercuEnCours || !apercu, attributs: { 'data-avatar-apercu': 'generer' } as const };
      if (!apercu || apercu.statut === 'aucun') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'vide', message: 'Aperçu de validation offert — une courte vidéo réelle de votre avatar, avec votre voix.', action: { libelle: 'Générer mon aperçu', ...relance } } };
      if (apercu.statut === 'echec') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'erreur', message: "L'aperçu n'a pas pu être généré. Vous pouvez le relancer sans frais.", detail: apercu.erreur ?? undefined, action: { libelle: "Relancer l'aperçu", ...relance } } };
      if (apercu.statut === 'en_cours') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'chargement', message: 'Votre aperçu est en cours de génération…', detail: 'Cela prend généralement 1 à 5 minutes. Cette page se met à jour toute seule.' } };
      if (apercu.statut === 'indisponible') return { titre: 'Aperçu de validation', ratio: '9 / 16', media: null, etat: { statut: 'vide', message: "L'aperçu réel de votre avatar n'est pas encore disponible." } };
      // `pret` : d'abord la source et « Voir mon aperçu » ; puis la VRAIE vidéo, et « Valider » seulement après le démarrage réel de la lecture.
      if (!apercuVisible) return { titre: 'Aperçu de validation', ratio: ratioSource, media: mediaSource, etat: { statut: 'pret', legende: 'Votre aperçu est prêt.', actionSuivante: { libelle: 'Voir mon aperçu', onClick: voirApercu, attributs: { 'data-avatar-apercu': 'voir' } } } };
      const ouvert = !!apercuOuvert && apercuOuvert.generationId === apercu.generationId;
      return {
        titre: 'Aperçu de validation', ratio: '9 / 16',
        media: <video data-avatar-apercu="video" src={apercu.url} controls autoPlay playsInline onPlaying={apercuEnLecture} className="w-full bg-black" style={{ maxHeight: '70vh' }} />,
        etat: ouvert
          ? { statut: 'pret', legende: 'Ça vous ressemble ?', actionSuivante: { libelle: 'Valider mon avatar', onClick: validerAvatar, disabled: validationEnCours, attributs: { 'data-avatar-apercu': 'valider' } } }
          : { statut: 'pret', legende: 'Lancez la lecture : le bouton de validation apparaîtra ensuite.' },
      };
    }
    // Étapes 2–3 : la source, telle qu'importée.
    return { titre: 'Votre source', ratio: ratioSource, media: mediaSource, etat: { statut: 'pret', legende: !viaDid && etatEffectif === 'entrainement' ? 'Votre avatar est en cours de préparation.' : 'Votre source.' } };
  })();
  const cleValidation = !avatar ? undefined : etatEffectif === 'valide' ? 'valide' : etatEffectif === 'entraine_non_valide' ? 'a-valider' : !viaDid && etatEffectif === 'entrainement' ? 'entrainement' : undefined;
  const cleApercu = etatEffectif === 'entraine_non_valide' && (apercu?.statut === 'en_cours' || apercu?.statut === 'indisponible') ? (apercu.statut === 'en_cours' ? 'en-cours' : 'indisponible') : undefined;

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* A. En-tête — pas de lien « Aide » : aucune page d'aide n'existe encore, on n'en promet pas. */}
      <EnteteSection
        titre="Mon avatar"
        sousTitre="Votre double vidéo, à partir d'une photo ou d'une vidéo."
        icone={<UserSquare2 className="w-6 h-6 text-white" />}
        statut={statutEntete}
        data-entete="avatar"
      />

      {/* B. LA notification (une seule ; la plus récente remplace) */}
      {notificationAffichee && (
        <Notification
          niveau={notificationAffichee.niveau}
          titre={notificationAffichee.titre}
          detail={notificationAffichee.detail}
          motif={notificationAffichee.motif ?? null}
          actionPrincipale={notificationAffichee.action}
          onFermer={() => setNotification(null)}
          className={notificationAffichee.niveau === 'erreur' ? '[&_[data-notification-titre]]:font-normal' : undefined}
        >
          {notificationAffichee.niveau === 'succes' && (
            <span data-avatar-notice className="sr-only">{[notificationAffichee.titre, ...(Array.isArray(notificationAffichee.detail) ? notificationAffichee.detail : [notificationAffichee.detail ?? ''])].join(' ').trim()}</span>
          )}
        </Notification>
      )}

      {/* C. Le fil d'étapes (le pipeline interne D-ID a disparu à son profit) */}
      <FilEtapes etapes={filEtapes} />

      {/* D. Deux colonnes : l'étape à gauche, l'aperçu à droite */}
      <div data-avatar-colonnes className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        <div data-avatar-colonne="etape" className="lg:col-span-3 space-y-4">
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
            <div className="card-base p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { id: 'photo' as const, Icon: ImageIcon, title: 'À partir d’une photo', sub: 'Prêt en quelques minutes', soon: false },
                  { id: 'video' as const, Icon: Clapperboard, title: 'À partir d’une vidéo', sub: 'Plus réaliste, entraînement plus long', soon: !didVideoActif },
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
                      ? "Je certifie être la personne visible dans la vidéo et j'autorise Studiio et HeyGen à l'utiliser pour entraîner un avatar à mon effigie."
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
            <div className="card-base p-6 space-y-5">
              {/* Quand la zone d'aperçu montre autre chose que la source (aperçu de
                  validation, vidéo produite), la source reste visible ici, en petit. */}
              {zone.media !== mediaSource && (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-black [&>*]:w-12 [&>*]:h-12 [&>*]:object-cover">{mediaSource}</div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{avatar.name || 'Mon avatar'}</div>
                    <div className="text-xs text-gray-500">{avatar.avatar_type === 'video' ? 'Avatar vidéo' : 'Avatar photo'}</div>
                  </div>
                </div>
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
                {!(notificationAffichee?.action?.libelle === 'Changer de source') && (
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

        <div data-avatar-colonne="apercu" className="lg:col-span-2 lg:sticky lg:top-20 space-y-4">
          <div data-avatar-validation={cleValidation}>
            <div data-avatar-apercu={cleApercu}>
              <ZoneApercu titre={zone.titre} etat={zone.etat} ratio={zone.ratio}>{zone.media}</ZoneApercu>
            </div>
          </div>

          {/* ✓ Prêt — l'étape suivante : faire parler l'avatar (photo HeyGen seulement). */}
          {avatar && etatEffectif === 'valide' && !viaDid && (
            <div className="card-base p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Ce que dit votre avatar</label>
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value.slice(0, MAX_SCRIPT_CHARS))}
                  rows={5}
                  placeholder="Bonjour, je suis…"
                  className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-3 text-sm resize-y"
                />
                <div className="mt-1 text-right text-xs text-gray-500">
                  {script.length} / {MAX_SCRIPT_CHARS}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Voix</label>
                  <select
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    disabled={voices.length === 0}
                    className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm disabled:opacity-50"
                  >
                    {voices.length === 0 && <option value="">Voix indisponibles</option>}
                    {voices.map((v) => (
                      <option key={v.voiceId} value={v.voiceId}>
                        {v.name}
                        {v.language ? ` — ${v.language}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Format</label>
                  <div className="flex gap-2">
                    {(['9:16', '16:9', '1:1'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setRatio(r)}
                        className={`flex-1 rounded-xl px-3 py-2.5 text-sm transition ${
                          ratio === r
                            ? 'bg-purple-600/30 text-purple-200 ring-1 ring-purple-500/50'
                            : 'bg-gray-900 text-gray-400 hover:text-white'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={!script.trim() || busy}
                className="w-full button-primary disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {genStatus === 'pending' ? 'Lancement…' : 'Génération en cours…'}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Générer ({AVATAR_VIDEO_COST} crédits)
                  </>
                )}
              </button>

              {/* Génération à la demande : le fournisseur ne rend qu'un statut → barre
                  indéterminée ; un pourcentage n'apparaît que si l'API en rend un réel. */}
              {busy && (
                <ProgressStatus
                  titre="Création de votre vidéo"
                  statut="en_cours"
                  {...(progress !== null ? { pourcentage: progress } : {})}
                  detail={progress === null ? 'Génération en cours — progression exacte indisponible.' : undefined}
                  description="Cela prend généralement 1 à 5 minutes. Vous pouvez laisser cette page ouverte."
                />
              )}
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
        </div>
      </div>

      {/* ── MA VOIX ──────────────────────────────────────────────────
          Le clonage vocal est independant de l'avatar : il alimente le
          selecteur de voix de TOUS les montages, pas seulement cette page.
          Il est donc affiche des la premiere visite, avant meme qu'un avatar
          existe. */}
      <VoiceCloneRecorder />
      {/* Ma voix & prononciations — la voix utilisée, les prononciations,
          l'aperçu affiché/prononcé, l'écoute réelle ou son indisponibilité. */}
      <div ref={maVoixRef} tabIndex={-1} data-avatar-ma-voix className="outline-none">
        <MaVoixPanel />
      </div>
    </div>
  );
}

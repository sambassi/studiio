'use client';

/**
 * STUDIIO CINEMA IA — le parcours, en une page.
 *
 * L'ordre des sections EST le parcours annonce : histoire, casting, scenario,
 * association, plans et dialogues, aperçu, export. Rien n'est calcule ici :
 * le scenario, les durees, la chronologie et le devis viennent tous de
 * `/api/cinema/*`, donc des memes fonctions que le MP4. Une page qui
 * recalculerait sa propre chronologie finirait par montrer autre chose que ce
 * que le fichier contient — c'est l'ecart aperçu / rendu que ce module evite
 * par construction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Clapperboard, Users, Wand2, Link2, Play, Pause, Download,
  Info, Loader2, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle,
  ImageIcon, Film, Volume2, VolumeX, Sparkles, X, Check, Circle,
  ChevronUp, Maximize2, Minimize2, Eye, Shield, Pencil, SlidersHorizontal, Mic, MicOff, ImagePlus, Upload,
} from 'lucide-react';
import { useTarifs, libellePrix, libelleCredits } from '@/lib/tarifs/client';
import { ratioCadre } from '@/lib/ui/lecteur-generation';
import QuotaCinema from '@/components/cinema/QuotaCinema';
import { SelecteurStyleFilm, ExceptionStyleScene, SelecteurCamera, ResumeStyle, PlanAregenerer } from '@/components/cinema/DirectionCinema';
import { cameraEffective } from '@/lib/cinema/direction/camera';
import { plansARegenerer } from '@/lib/cinema/direction/signature';
import type { IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';
import ModelesFilm, { type ModeleFilm } from '@/components/cinema/ModelesFilm';
import AideRedaction from '@/components/cinema/AideRedaction';
import ApercuExemple, { FenetreExemple, type Exemple } from '@/components/cinema/ApercuExemple';
import WizardCinema, { TitreEtape, type EtapeWizard } from '@/components/cinema/WizardCinema';
import { auditFidelite, diagnosticAudio, ecartsBloquants, ecartsScene, phrasesDeLaScene, resumeFidelite, type EcartFidelite } from '@/lib/cinema/fidelite';
import ChoixMouvements from '@/components/cinema/ChoixMouvements';
import ApercuScene, { provenanceMedia, urlMediaPlan } from '@/components/cinema/ApercuScene';
import PortraitPersonnage, { aUnePhoto } from '@/components/cinema/PortraitPersonnage';
import ModeAudioCartes, { LIBELLES_MODE, type ModeAudio } from '@/components/cinema/ModeAudio';
import { VOIX_FILM, voixDistincte } from '@/lib/cinema/personnages';
import DialogueGenerationIA, { type DonneesDialogue, type Verification } from '@/components/cinema/DialogueGenerationIA';
import { styleCinema as styleDe } from '@/lib/cinema/direction/styles';
import { MediaDuPlan, EmplacementVide, Storyboard, appliquerDemo, bilanMedias } from '@/components/cinema/ApercuStoryboard';
import { useTranslations } from '@/i18n/client';

interface SegmentApi {
  sceneId: string; sceneIndex: number; planId: string; cadre: string;
  titreScene: string; lieu: string; intention: string; texte: string;
  locuteur: string | null; apparence: string | null;
  debutS: number; finS: number; dureeS: number;
  media: MediaApi | null; cadrage: { echelle: number; rogneX: number; rogneY: number; memeRapport: boolean } | null;
  voixUrl: string | null; couleurs: [string, string];
  /** Mode demonstration : le media affiche est un clip d'exemple, pas celui du film. */
  demo?: boolean;
}
interface MediaApi { fournisseurGeneration?: string; url: string; genre: 'image' | 'video'; largeur: number; hauteur: number; dureeS: number | null; octets: number; origine: string; sonActif?: boolean; direction?: string }
interface MontageApi { filmId: string; titre: string; format: string; largeur: number; hauteur: number; fps: number; segments: SegmentApi[]; dureeS: number }
interface PlanApi { id: string; cadre: string; description: string; personnages: string[]; dialogue: { personnageId: string | null; texte: string; genre?: string } | null; dureeS: number; media: MediaApi | null; camera?: IdCameraCinema }
interface SceneApi { id: string; index: number; titre: string; lieu: string; intention: string; personnages: string[]; plans: PlanApi[]; etat: string; coutUsd: number; styleCinema?: IdStyleCinema }
interface PersonnageApi { id: string; nom: string; role: string; voix: string; references: Array<{ id: string; version: number; description: string; urlImage?: string | null }>; referenceActiveId: string | null }
interface GenerationApi {
  id: string; planId: string; operation: 'image' | 'video'; mode: 'reelle' | 'simulee';
  statut: 'en_cours' | 'reussie' | 'echouee' | 'interrompue'; creeLe: string; majLe: string;
  erreur?: string | null; creditsPris?: number; creditsRembourses?: boolean;
}
interface FilmApi { modeAudio?: ModeAudio; narration?: boolean; id: string; titre: string; histoire?: string; format: string; qualite: string; personnages: PersonnageApi[]; scenes: SceneApi[]; generations?: GenerationApi[]; styleCinema?: IdStyleCinema; directionActive?: boolean; ecartsAcceptes?: string[] }
/** La generation active du film (une seule a la fois, decide par le serveur). */
const generationActiveDe = (f: FilmApi | null) => f?.generations?.find((g) => g.statut === 'en_cours') ?? null;
/** La derniere generation d'un plan, quelle qu'en soit l'issue. */
const derniereGenerationDuPlan = (f: FilmApi | null, planId: string) =>
  [...(f?.generations ?? [])].reverse().find((g) => g.planId === planId) ?? null;
/** Les medias sont stockes en chemin relatif : meme regle de normalisation partout (voir `Apercu`). */
type StatutTravailApi = 'en_attente' | 'en_cours' | 'termine' | 'echec' | 'annule';
interface TravailApi {
  id: string; filmId: string; statut: StatutTravailApi; erreur: string | null; reference: string | null; annulationDemandee: boolean;
  progression: { etape: string; scenes: Record<string, 'a_faire' | 'en_cours' | 'faite' | 'reutilisee' | 'echec'>; pourcent: number; message: string | null };
  resultat: { aMp4: boolean; scenesRendues: string[]; scenesReutilisees: string[]; avertissements: string[]; dureeS: number | null; octets: number | null; largeur: number | null; hauteur: number | null; codecVideo: string | null; codecAudio: string | null; coutUsd: number } | null;
}
const ACTIF = (t: TravailApi | null) => !!t && (t.statut === 'en_attente' || t.statut === 'en_cours');
interface DevisApi { totalUsd: number | null; secondesAProduire: number; fournisseur: { libelle: string } | null; lignes: Array<{ sceneId: string; titre: string; secondes: number; usd: number | null; motif: string }> }

const TITRE_EXEMPLE = 'Avant le jour';
const HISTOIRE_EXEMPLE = "Nina entre dans la salle avant le lever du jour. Le tatami est encore froid et personne ne parle. Marco la regarde sans bouger. Nina sait que le combat a deja commence. Marco avance et le silence se brise. Nina tient bon jusqu au dernier instant. Le jour se leve sur la salle vide.";


/** Detail replie derriere une icone — l'UI reste epuree, l'information reste accessible. */
function Detail({ texte }: { texte: string }) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const [ouvert, setOuvert] = useState(false);
  return (
    <span className="inline-flex items-center align-middle">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-label={tUi('afficher_le_detail')}
        className="ml-2 text-slate-500 hover:text-violet-300 transition-colors"
      >
        <Info className="w-4 h-4" />
      </button>
      {ouvert && (
        <span className="ml-2 text-xs text-slate-400 max-w-md">{texte}</span>
      )}
    </span>
  );
}

/** Le bouton-icone commun de l'editeur de scene : petit, carre, toujours nomme (infobulle + libelle accessible). */
const BOUTON_ICONE = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:border-violet-500/60 hover:text-violet-200 disabled:opacity-40';

export default function CinemaPage() {
  const tUi = useTranslations('ui.appDashboardCinema');
  const [titre, setTitre] = useState(TITRE_EXEMPLE);
  const [histoire, setHistoire] = useState(HISTOIRE_EXEMPLE);
  const [format, setFormat] = useState<'16:9' | '9:16'>('16:9');
  const [qualite, setQualite] = useState('standard');
  /** Style choisi AVANT la creation du film ; une fois le film charge, c'est le sien qui fait foi. */
  /**
   * L'apercu principal montre UN EXEMPLE (style ou mouvement) a la place du film. Un simple
   * affichage : le scenario, les reglages et le montage ne bougent pas, et « Revenir a mon
   * film » remet l'apercu du projet. `null` = l'apercu du film de l'utilisateur.
   */
  const [exemple, setExemple] = useState<Exemple | null>(null);
  const [exempleAgrandi, setExempleAgrandi] = useState(false);
  const [styleAvantFilm, setStyleAvantFilm] = useState<IdStyleCinema | null>(null);
  const [nbScenes, setNbScenes] = useState(4);
  const [casting, setCasting] = useState<Array<{ nom: string; role: string; description: string; urlImage: string; voix?: string }>>([
    { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge', urlImage: '' },
    { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire', urlImage: '' },
  ]);
  /**
   * COMMENT LE FILM EST RACONTE (nouveaux films). `choixModeAudio` = ce que l'utilisateur a cliqué ;
   * sans clic, le mode est PROPOSE d'apres le texte (des guillemets -> les personnages parlent ; sinon
   * une voix raconte) et dit « propose d'apres ton texte ». Un film charge garde SON mode — ou n'en a
   * pas (film d'avant) et garde alors son ancien comportement audio.
   */
  const [choixModeAudio, setChoixModeAudio] = useState<ModeAudio | null>(null);

  /**
   * LES CHAMPS SONT-ILS ENCORE CEUX DE L'EXEMPLE D'ORIGINE ?
   *
   * Tant qu'ils le sont (ou qu'ils sont vides), appliquer un modele n'ecrase rien et se
   * fait d'un seul clic. Des que quelque chose a ete ecrit — ou qu'un film est charge —
   * le modele demande une confirmation en ligne (voir `ModelesFilm`). Une saisie de
   * l'utilisateur ne doit jamais disparaitre sur un clic de curiosite.
   */
  const [film, setFilm] = useState<FilmApi | null>(null);
  const [montage, setMontage] = useState<MontageApi | null>(null);
  const [devis, setDevis] = useState<DevisApi | null>(null);
  const [aProduire, setAProduire] = useState<string[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [travail, setTravail] = useState<TravailApi | null>(null);
  const [mesFilms, setMesFilms] = useState<Array<{ id: string; titre: string; majLe: string }>>([]);
  /** Suppression en deux gestes : l'icone arme, la coche confirme. */
  const [suppressionArmee, setSuppressionArmee] = useState(false);
  /**
   * Etat des panneaux 1/2/3/4 remonte ici : le rail d'etapes doit pouvoir en OUVRIR un
   * (et REFERMER les autres) depuis l'exterieur sans perdre la saisie en cours —
   * c'est un simple affichage, aucune donnee de formulaire ne vit dans cet etat.
   * Un clic DIRECT sur l'en-tete d'un panneau (via `basculer` dans `CollapsiblePanel`)
   * reste independant de cette exclusivite : il ne touche qu'a sa propre cle.
   */
  /**
   * Panneaux ouverts par etape du rail (les autres se referment) : « une seule
   * configuration principale a la fois ». Le panneau 3 (« Composer le scenario »)
   * n'a pas d'etape dediee dans le rail a 5 entrees — c'est l'action-pont entre
   * Histoire et Personnages (il faut l'un ou l'autre avant de composer), donc il
   * reste visible pendant ces deux etapes et se referme des que des scenes existent.
   */
  /**
   * Les champs portent-ils une saisie a proteger ? Non si ce sont encore ceux de
   * l'exemple d'origine, ou s'ils sont vides. Oui des qu'un film est charge : appliquer
   * un modele divergerait alors du film affiche, et cela se confirme.
   */
  const aDesSaisies = !!film
    || !((titre === TITRE_EXEMPLE && histoire === HISTOIRE_EXEMPLE) || (!titre.trim() && !histoire.trim()));

  /**
   * APPLIQUER UN MODELE REMPLIT DES CHAMPS, ET S'ARRETE LA.
   *
   * Aucun appel, aucun credit, aucune composition de scenario : l'utilisateur garde la
   * main et lance lui-meme « Composer le scenario » quand il le decide. Le film deja
   * charge, lui, n'est pas touche — c'est le formulaire qui change, pas le film.
   */
  const appliquerModele = (m: ModeleFilm) => {
    setTitre(m.valeurs.titre);
    setHistoire(m.valeurs.histoire);
    setFormat(m.valeurs.format);
    setQualite(m.valeurs.qualite);
    setNbScenes(m.valeurs.nbScenes);
    setCasting(m.valeurs.casting.map((c) => ({ ...c })));
    // Un exemple peut proposer un style (ex. science-fiction) : un simple choix d'ecran, rien n'est genere.
    if (m.valeurs.styleCinema) setStyleAvantFilm(m.valeurs.styleCinema);
  };

  /** Repartir d'une page blanche : les champs se vident, rien d'autre ne bouge. */
  const partirDeZero = () => {
    setTitre('');
    setHistoire('');
    setCasting([{ nom: '', role: '', description: '', urlImage: '' }]);
  };

  const appliquer = useCallback((data: any) => {
    if (data?.film) setFilm(data.film);
    if (data?.montage) setMontage(data.montage);
    if (data?.devis) setDevis(data.devis);
    if (Array.isArray(data?.scenesAProduire)) setAProduire(data.scenesAProduire);
    // Une reponse de generation ne porte que le SUIVI : on le pose sur le film affiche.
    if (!data?.film && Array.isArray(data?.generations)) {
      setFilm((f) => (f ? { ...f, generations: data.generations } : f));
    }
  }, []);

  /**
   * ⚠️ DELAI DUR, OBLIGATOIRE. Sans lui, une reponse serveur qui ne vient jamais (par
   * exemple la voix off qui attend un service TTS injoignable) laissait `enCours` arme
   * pour toujours : TOUS les boutons de l'ecran restaient desactives sans aucun message,
   * et rien ne pouvait debloquer la page sinon la recharger. Le `finally` existant ne
   * protegeait de rien, puisqu'il ne s'execute qu'apres que la promesse se resout.
   */
  const DELAI_APPEL_MS = 20_000;

  const appel = useCallback(async (url: string, options: RequestInit, libelle: string, delaiMs: number = DELAI_APPEL_MS) => {
    setEnCours(libelle);
    setErreur(null);
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), delaiMs);
    try {
      const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options, signal: ctrl.signal });
      const data = await r.json();
      if (!r.ok || data?.ok === false) {
        // Un media manquant est nomme plan par plan : c'est la seule
        // information qui permet de le corriger.
        const details = Array.isArray(data?.manquants)
          ? ` — ${data.manquants.map((m: { planId: string; url: string }) => `${m.planId} : ${m.url}`).join(' / ')}`
          : '';
        // Dire la verite sur l'argent, quand le serveur l'a dite : un refus qui a quand
        // meme pris des credits ne doit jamais ressembler a un refus gratuit.
        const argent = typeof data?.creditsPris === 'number'
          ? ` — ${data.creditsPris} credit(s) pris, ${data.creditsRembourses ? 'rembourses' : 'NON rembourses : verifiez le solde'}`
          : '';
        throw new Error(`${data?.erreur ?? `echec (${r.status})`}${details}${argent}`);
      }
      appliquer(data);
      return data;
    } catch (e) {
      const delaiDepasse = e instanceof Error && e.name === 'AbortError';
      setErreur(delaiDepasse
        ? `le serveur ne repond pas (delai de ${Math.round(delaiMs / 1000)} s depasse) — reessayez`
        : (e instanceof Error ? e.message : 'echec'));
      return null;
    } finally {
      clearTimeout(minuteur);
      setEnCours(null);
      // Le solde affiche dans la barre laterale ne se rafraichit jamais tout seul : une
      // generation reelle peut avoir pris, puis rendu, des credits sans que rien ne le
      // signale avant un rechargement complet de la page.
      if (libelle.startsWith('generation:')) {
        try { window.dispatchEvent(new Event('studiio:credits-changed')); } catch { /* confort, jamais bloquant */ }
      }
    }
  }, [appliquer]);

  /** Le style montre a l'ecran : celui du film ouvert, sinon celui choisi avant sa creation. */
  const styleAffiche: IdStyleCinema | null = film ? (film.styleCinema ?? null) : styleAvantFilm;
  // Le mode propose d'apres le texte : des guillemets -> « les personnages parlent » ; sinon « une voix raconte ».
  const modeAuto: ModeAudio = /[«"\u201C][^»"\u201D]{2,}[»"\u201D]/.test(histoire) ? 'personnages' : 'narrateur';
  /** Le mode AFFICHE : celui du film charge (ou aucun : film d'avant), sinon le choix / la proposition. */
  const modeAudioAffiche: ModeAudio | null = film ? (film.modeAudio ?? null) : (choixModeAudio ?? modeAuto);
  const choisirModeAudio = (m: ModeAudio) => {
    // Sur un film existant, c'est un reglage enregistre (l'histoire et le casting ne bougent pas).
    if (film) void enregistrer({ modeAudio: m }); else setChoixModeAudio(m);
  };
  /** Plans dont le media genere ne suit plus le style/la camera actuels (le media est conserve). */
  const aRegenerer = new Set(film ? plansARegenerer(film as never).map((x) => x.planId) : []);
  const choisirStyleFilm = (id: IdStyleCinema | null) => {
    if (!film) { setStyleAvantFilm(id); return; }
    void enregistrer({ style: id });
  };

  const composer = async () => {
    const data = await appel('/api/cinema/films', {
      method: 'POST',
      body: JSON.stringify({ titre, histoire, format, qualite, nbScenes, personnages: casting.map((c, i) => ({ ...c, voix: c.voix ?? voixDistincte(i) })), styleCinema: styleAffiche, modeAudio: modeAudioAffiche }),
    }, 'scenario');
    if (data) { setTravail(null); chargerListe(); }
  };

  const enregistrer = (corps: any) => film && appel(`/api/cinema/films/${film.id}`, { method: 'PATCH', body: JSON.stringify(corps) }, 'enregistrement');

  /**
   * Importe le media d'un plan. Le fichier part en OCTETS : aucune URL n'est
   * declaree, c'est le serveur qui ecrit et MESURE le fichier.
   */
  const importerMedia = async (planId: string, fichier: File) => {
    if (!film) return;
    setEnCours(`media:${planId}`);
    setErreur(null);
    try {
      const formulaire = new FormData();
      formulaire.append('planId', planId);
      formulaire.append('fichier', fichier);
      const r = await fetch(`/api/cinema/films/${film.id}/medias`, { method: 'POST', body: formulaire });
      const data = await r.json();
      if (!r.ok || data?.ok === false) throw new Error(data?.erreur ?? `echec (${r.status})`);
      appliquer(data);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'echec de l import');
    } finally {
      setEnCours(null);
    }
  };

  /** Importe la photo de reference d'un personnage (octets, mesures par le serveur). Gratuit : aucune IA. */
  const importerReference = async (personnageId: string, fichier: File) => {
    if (!film) return;
    setEnCours(`reference:${personnageId}`);
    setErreur(null);
    try {
      const formulaire = new FormData();
      formulaire.append('personnageId', personnageId);
      formulaire.append('fichier', fichier);
      const r = await fetch(`/api/cinema/films/${film.id}/references`, { method: 'POST', body: formulaire });
      const data = await r.json();
      if (!r.ok || data?.ok === false) throw new Error(data?.erreur ?? `echec (${r.status})`);
      appliquer(data);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'echec de l import de la photo');
    } finally {
      setEnCours(null);
    }
  };

  /** Le prix affiché AVANT de dépenser — le serveur seul décide du prix réellement débité. */
  const tarifs = useTarifs();

  /**
   * Genere le media d'un plan par IA (lot 3+4). En mode REEL, la generation
   * depense de vrais credits Studiio (`generation/credits.ts`) : l'ecran
   * demande une confirmation explicite, avec le cout affiche en credits,
   * avant de lancer quoi que ce soit. En mode SIMULE (local, deterministe,
   * gratuit) aucune confirmation n'est necessaire — rien n'est debite.
   *
   * ⚠️ CET ECRAN NE DECIDE DE RIEN : le serveur refuse tout fournisseur
   * eteint, tout depassement de plafond ET tout solde insuffisant AVANT
   * d'appeler qui que ce soit (`generation/atelier.ts`, `generation/credits.ts`).
   * La confirmation ici est une politesse envers l'utilisateur, pas une
   * frontiere de securite.
   */
  /**
   * Confirmation d'une generation PAYANTE, dans la page (deux gestes, comme la
   * suppression d'un film). Plus de `window.confirm` : une boite de dialogue native
   * BLOQUE tout le fil de la page tant qu'elle est ouverte — rendu, minuteurs et
   * sondages compris — et figeait l'ecran pour tout outil qui le pilote.
   */
  const [confirmation, setConfirmation] = useState<{ planId: string; operation: 'image' | 'video' } | null>(null);

  /**
   * LANCE une generation. Le serveur repond en quelques millisecondes (202) avec
   * l'identifiant de la generation : le fournisseur, lui, travaille en arriere-plan,
   * et l'ecran suit son etat REEL en relisant le film (voir le sondage plus bas).
   * Un second clic, un second onglet ou un rechargement retrouvent la MEME generation :
   * le serveur n'en accepte qu'une a la fois par film, et ne debite qu'une fois.
   */
  const lancerGenerationIa = async (planId: string, operation: 'image' | 'video'): Promise<boolean> => {
    if (!film) return false;
    setEnCours(`generation:${planId}:${operation}`);
    setErreur(null);
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), DELAI_APPEL_MS);
    try {
      const r = await fetch(`/api/cinema/films/${film.id}/generation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Aucun `fournisseurId` : c'est le SERVEUR qui choisit.
        body: JSON.stringify({ planId, operation }),
        signal: ctrl.signal,
      });
      const data = await r.json().catch(() => null);
      if (Array.isArray(data?.generations)) appliquer({ generations: data.generations });
      else if (data?.enCours && data?.generation) {
        // Deja en cours : on l'affiche comme telle, rien n'a ete relance ni debite.
        setFilm((f) => (f ? { ...f, generations: [...(f.generations ?? []).filter((g) => g.id !== data.generation.id), data.generation] } : f));
      }
      if (!r.ok && !data?.enCours) throw new Error(data?.erreur ?? `echec (${r.status})`);
      return true;
    } catch (e) {
      // Un delai ici ne veut PAS dire que rien n'est parti : le sondage dira l'etat reel.
      setErreur(e instanceof Error && e.name === 'AbortError'
        ? 'le serveur tarde a repondre — l’etat de la generation va s’afficher, ne relancez pas'
        : (e instanceof Error ? e.message : 'echec'));
      if (film) rafraichirFilmRef.current?.(film.id);
      return false;
    } finally {
      clearTimeout(minuteur);
      setEnCours(null);
    }
  };

  /**
   * « Preparer l'image avec l'IA » / l'etoile d'un visuel : ouvre TOUJOURS la fenetre de preparation
   * (verifications, cout, confirmation). Rien n'est lance ici ; la fenetre dit aussi POURQUOI elle
   * bloque, quand elle bloque — un bouton ne reste jamais sans reaction.
   */
  const genererMedia = (planId: string, operation: 'image' | 'video') => {
    if (!film) return;
    setErreur(null);
    setConfirmation({ planId, operation });
  };
  const confirmerDialogueIA = async () => {
    if (!confirmation) return;
    const ok = await lancerGenerationIa(confirmation.planId, confirmation.operation);
    if (ok) setConfirmation(null);
  };

  /**
   * Prepare les VOIX sans rendre la video : l'apercu a besoin du son, pas de
   * Chromium. Sans cette etape, l'apercu serait muet jusqu'a l'export.
   */
  // La synthese de toutes les repliques peut prendre bien plus de 20 s.
  const preparerVoix = () => film && appel(`/api/cinema/films/${film.id}/produire`, {
    method: 'POST',
    body: JSON.stringify({ rendre: false }),
  }, 'voix', 180_000);

  /** Les films du compte : ils survivent a un redemarrage du serveur. */
  /** Generation « IA » proposee par le serveur ? Faux par defaut (voir `garde.ts`). */
  const [generationIa, setGenerationIa] = useState(false);
  /** `simulee` ou `reelle` — le libelle du bouton ne doit jamais mentir sur ce qui se passe. */
  const [generationMode, setGenerationMode] = useState<'simulee' | 'reelle' | null>(null);

  const chargerListe = useCallback(async () => {
    try {
      const r = await fetch('/api/cinema/films');
      const data = await r.json();
      if (data?.ok) {
        setMesFilms(data.films);
        // C'est le SERVEUR qui dit si la generation est disponible. Par defaut elle ne
        // l'est pas : le seul fournisseur ecrit dessine des images avec ffmpeg, il ne
        // genere pas par IA. On ne propose donc pas un bouton qui promettrait cela.
        setGenerationIa(data.generationIa === true);
        setGenerationMode(data.generationMode === 'reelle' || data.generationMode === 'simulee' ? data.generationMode : null);
      }
    } catch { /* la liste est un confort : son absence ne bloque rien */ }
  }, []);
  useEffect(() => { chargerListe(); }, [chargerListe]);

  /** Relit le film (scenes scellees, a reproduire) apres un travail. */
  const rafraichirFilm = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/cinema/films/${id}`);
      const data = await r.json();
      if (data?.ok) appliquer(data);
    } catch { /* le prochain geste relira */ }
  }, [appliquer]);

  const rafraichirFilmRef = useRef<((id: string) => void) | null>(null);
  rafraichirFilmRef.current = rafraichirFilm;

  // SUIVI d'une generation IA : tant qu'une generation du film est EN COURS (d'apres le
  // serveur), on relit le film. Ce sondage repart tout seul apres un rechargement, puisque
  // l'etat vit sur le film. Il s'espace en cas d'erreur, et previent la barre laterale a
  // la fin (des credits ont pu etre pris, puis rendus).
  const filmIdGeneration = film?.id ?? null;
  const idGenerationActive = generationActiveDe(film)?.id ?? null;
  useEffect(() => {
    if (!filmIdGeneration || !idGenerationActive) return;
    let arrete = false;
    let delai = 2500;
    let minuteur: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/cinema/films/${filmIdGeneration}`);
        const data = await r.json();
        if (arrete) return;
        if (data?.ok) {
          appliquer(data);
          delai = 2500;
          if (!generationActiveDe(data.film)) {
            try { window.dispatchEvent(new Event('studiio:credits-changed')); } catch { /* confort */ }
            return;
          }
        } else {
          delai = Math.min(delai * 2, 15_000);
        }
      } catch {
        delai = Math.min(delai * 2, 15_000);
      }
      if (!arrete) minuteur = setTimeout(tick, delai);
    };
    minuteur = setTimeout(tick, 1500);
    return () => { arrete = true; clearTimeout(minuteur); };
  }, [filmIdGeneration, idGenerationActive, appliquer]);

  /** Rouvre un film enregistre — et retrouve sa derniere production, active ou finie. */
  const ouvrirFilm = async (id: string) => {
    if (!id) return;
    setEnCours('ouverture');
    setErreur(null);
    try {
      const r = await fetch(`/api/cinema/films/${id}`);
      const data = await r.json();
      if (!r.ok || data?.ok === false) throw new Error(data?.erreur ?? `echec (${r.status})`);
      appliquer(data);
      setTitre(data.film.titre);
      if (typeof data.film.histoire === 'string') setHistoire(data.film.histoire);
      setFormat(data.film.format === '9:16' ? '9:16' : '16:9');
      setQualite(data.film.qualite);
      setCasting(data.film.personnages.map((p: PersonnageApi) => ({
        nom: p.nom, role: p.role, voix: p.voix,
        description: p.references.find((x) => x.id === p.referenceActiveId)?.description ?? p.references.at(-1)?.description ?? '',
        urlImage: '',
      })));
      const t = await fetch(`/api/cinema/films/${id}/travaux`).then((x) => x.json()).catch(() => null);
      setTravail(t?.ok ? t.travail : null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'ouverture impossible');
    } finally {
      setEnCours(null);
    }
  };

  /** Supprime le film ouvert ET ses fichiers prives (scenes, medias, voix, MP4). */
  const supprimerFilmOuvert = async () => {
    if (!film) return;
    setEnCours('suppression');
    setErreur(null);
    try {
      const r = await fetch(`/api/cinema/films/${film.id}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.ok === false) throw new Error(data?.erreur ?? `suppression impossible (${r.status})`);
      setFilm(null); setMontage(null); setDevis(null); setAProduire([]); setTravail(null);
      await chargerListe();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'suppression impossible');
    } finally {
      setSuppressionArmee(false);
      setEnCours(null);
    }
  };

  /**
   * Lance la production EN ARRIERE-PLAN : la requete rend un identifiant en
   * quelques millisecondes, la page ne bloque pas et peut etre fermee. Un
   * second clic RETROUVE le travail en cours au lieu d'en lancer un autre.
   */
  const produire = async (scenes?: string[]) => {
    if (!film) return;
    setEnCours('lancement');
    setErreur(null);
    try {
      const r = await fetch(`/api/cinema/films/${film.id}/produire`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rendre: true, scenes }),
      });
      const data = await r.json();
      if (!r.ok || data?.ok === false) throw new Error(data?.erreur ?? `echec (${r.status})`);
      if (data.devis) setDevis(data.devis);
      setTravail(data.travail);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'lancement impossible');
    } finally {
      setEnCours(null);
    }
  };

  const arreterProduction = async () => {
    if (!film || !travail) return;
    try {
      const r = await fetch(`/api/cinema/films/${film.id}/travaux/${travail.id}/annuler`, { method: 'POST' });
      const data = await r.json();
      if (data?.ok) setTravail(data.travail);
    } catch { /* le prochain sondage dira l'etat reel */ }
  };

  // Sondage de l'etat REEL du travail (jamais une animation). Il s'espace en
  // cas d'erreur reseau et s'arrete a la fin ; la fin relit le film.
  const filmId = film?.id ?? null;
  const travailId = travail?.id ?? null;
  const actif = ACTIF(travail);
  useEffect(() => {
    if (!filmId || !travailId || !actif) return;
    let arrete = false;
    let delai = 1500;
    let minuteur: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await fetch(`/api/cinema/films/${filmId}/travaux/${travailId}`);
        const data = await r.json();
        if (arrete) return;
        if (data?.ok) {
          setTravail(data.travail);
          delai = 1500;
          if (!ACTIF(data.travail)) { rafraichirFilm(filmId); return; }
        } else if (r.status === 404) {
          return;
        } else {
          // Reponse recue mais pas exploitable (ex. erreur serveur inattendue) : le
          // sondage ne doit ni s'arreter en silence, ni continuer au rythme rapide
          // indefiniment sans jamais le dire — meme traitement que l'echec reseau.
          delai = Math.min(delai * 2, 10_000);
        }
      } catch {
        delai = Math.min(delai * 2, 10_000);
      }
      if (!arrete) minuteur = setTimeout(tick, delai);
    };
    minuteur = setTimeout(tick, 600);
    return () => { arrete = true; clearTimeout(minuteur); };
  }, [filmId, travailId, actif, rafraichirFilm]);

  /**
   * L'ETAPE AFFICHEE. Une seule a la fois (maquette validee) : la page ne defile plus sur
   * cinq formulaires empiles. Rien n'est perdu en naviguant — l'etat vit ici, pas dans le DOM.
   */
  const [etape, setEtape] = useState(0);
  /**
   * LA SCENE SELECTIONNEE : elle pilote l'apercu unique a droite ET les outils a gauche. Une seule
   * a la fois ; `null` = la premiere. Selectionner ne lance AUCUN appel : c'est un simple affichage.
   */
  const [sceneSelId, setSceneSelId] = useState<string | null>(null);
  /** Les outils de la scene selectionnee sont deplies a la demande (clic sur la scene ou le crayon). */
  const [outilsOuverts, setOutilsOuverts] = useState(false);
  /** Le plan affiche, PAR scene : changer de scene ne modifie jamais le plan courant d'une autre. */
  const [planParScene, setPlanParScene] = useState<Record<string, number>>({});
  const [mediaAgrandi, setMediaAgrandi] = useState(false);
  const [retraitEnAttente, setRetraitEnAttente] = useState<string | null>(null);

  /** Ce que le film a VRAIMENT garde de votre histoire (module pur, aucune ecriture). */
  const fidelite = useMemo(() => (film ? auditFidelite(film as never) : null), [film]);
  // Les ecarts critiques ni corriges ni acceptes : ils bloquent toute generation payante.
  const bloquants = useMemo(() => (film && fidelite ? ecartsBloquants(film as never, fidelite) : []), [film, fidelite]);
  const acceptes = useMemo(() => new Set(film?.ecartsAcceptes ?? []), [film]);
  const sceneSel = film ? (film.scenes.find((x) => x.id === sceneSelId) ?? film.scenes[0] ?? null) : null;
  const selectionnerScene = (id: string, ouvrir: boolean) => {
    setSceneSelId(id); setOutilsOuverts(ouvrir); setMediaAgrandi(false); setRetraitEnAttente(null);
    // Un exemple (style, mouvement) laisse la place au media de la scene choisie.
    setExemple(null); setExempleAgrandi(false);
  };

  /**
   * LA METHODE choisie a l'etape Scenes : creer avec l'IA, ou utiliser ses propres medias. Un simple
   * choix d'affichage (rien n'est lance, rien n'est facture) ; il se souvient par film. Un film qui a
   * deja des medias retrouve sa methode (importes -> « mes medias », generes -> « IA »).
   */
  const [methode, setMethode] = useState<'ia' | 'import' | null>(null);
  const filmIdMethode = film?.id ?? null;
  useEffect(() => {
    if (!film) { setMethode(null); return; }
    let m: 'ia' | 'import' | null = null;
    try {
      const v = window.localStorage.getItem(`studiio.cinema.methode.${film.id}`);
      if (v === 'ia' || v === 'import') m = v;
    } catch { /* stockage indisponible : on retombe sur le choix explicite */ }
    if (!m) {
      const medias = film.scenes.flatMap((sc) => sc.plans).map((pl) => pl.media).filter((x): x is MediaApi => !!x);
      m = medias.some((x) => x.origine === 'genere') ? 'ia' : medias.length > 0 ? 'import' : null;
    }
    setMethode(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmIdMethode]);
  /** Les visuels (un par plan) qui n'ont pas encore d'image ou de video. */
  const visuelsAPreparer = film ? film.scenes.reduce((n, sc) => n + sc.plans.filter((pl) => !pl.media).length, 0) : 0;
  const scenesSansVisuel = film ? film.scenes.filter((sc) => sc.plans.some((pl) => !pl.media)).length : 0;
  const choisirMethode = (m: 'ia' | 'import' | null) => {
    setMethode(m);
    try {
      if (film) { if (m) window.localStorage.setItem(`studiio.cinema.methode.${film.id}`, m); else window.localStorage.removeItem(`studiio.cinema.methode.${film.id}`); }
    } catch { /* sans consequence */ }
  };
  /** Ouvre le premier visuel qui manque : une selection, jamais une generation. */
  const allerAuPremierVisuel = () => {
    if (!film) return;
    for (const sc of film.scenes) {
      const k = sc.plans.findIndex((pl) => !pl.media);
      if (k >= 0) { selectionnerScene(sc.id, true); setPlanParScene((m) => ({ ...m, [sc.id]: k })); return; }
    }
  };
  const accepterEcart = (cle: string) => film && enregistrer({ accepter: [...new Set([...(film.ecartsAcceptes ?? []), cle])] });
  const retirerAcceptation = (cle: string) => film && enregistrer({ accepter: (film.ecartsAcceptes ?? []).filter((k: string) => k !== cle) });
  /**
   * UN POINT A VERIFIER, en trois temps : ce qui se passe, pourquoi (le constat), ce qu'on peut faire.
   * On n'accepte jamais « en aveugle » : le bouton dit ce qui arrivera (`consequence`), et le chemin
   * normal reste de corriger SON histoire. Un point sans gravite (plan d'ensemble, narration) n'a
   * aucune action : il informe seulement.
   */
  /** « Qui dit cette replique ? » : un clic pour CHOISIR (jamais d'attribution au hasard). */
  const choixLocuteur = (planId: string) => film && (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label={tUi('qui_dit_cette_replique')} data-choix-locuteur>
      <span className="text-slate-300">{tUi('qui_dit_cette_replique')}</span>
      {film.personnages.map((pp) => (
        <button key={pp.id} type="button" onClick={() => enregistrer({ plans: [{ id: planId, locuteur: pp.id }] })}
          aria-label={tUi('nom_dit_cette_replique', { nom: pp.nom })}
          className="rounded-full border border-violet-500/50 px-2.5 py-0.5 text-violet-100 hover:bg-violet-500/10">
          {pp.nom}
        </button>
      ))}
    </span>
  );
  const carteEcart = (e: EcartFidelite) => (
    <li key={e.cle} className={`space-y-1 text-[11px] leading-snug ${e.critique ? 'text-amber-200/90' : 'text-slate-400'}`} data-ecart={e.genre}>
      <div className="flex items-start gap-1.5">
        {e.critique ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1">{e.detail}</span>
      </div>
      {e.critique && e.conseil && <p className="pl-[18px] text-slate-300">{tUi('pour_le_regler_conseil', { conseil: e.conseil })}</p>}
      {e.genre === 'locuteur_devine' && e.planId && (
        <div className="flex flex-wrap items-center gap-2 pl-[18px]">
          {choixLocuteur(e.planId)}
          <button type="button" onClick={() => setEtape(0)} className="rounded-lg border border-slate-600 px-2 py-1 text-slate-200 hover:border-violet-500/60">{tUi('modifier_mon_histoire')}</button>
        </div>
      )}
      {e.critique && e.genre !== 'locuteur_devine' && (acceptes.has(e.cle) ? (
        <p className="flex flex-wrap items-center gap-2 pl-[18px] text-emerald-300">
          <Check className="h-3 w-3" aria-hidden="true" /> {tUi('accepte_tel_quel')} {e.consequence}
          <button type="button" onClick={() => retirerAcceptation(e.cle)} aria-label="Retirer l’acceptation" className="underline">{tUi('annuler')}</button>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pl-[18px]">
          <button type="button" onClick={() => setEtape(0)} className="rounded-lg border border-slate-600 px-2 py-1 text-slate-200 hover:border-violet-500/60">
            {tUi('modifier_mon_histoire')}
          </button>
          <button type="button" onClick={() => accepterEcart(e.cle)} aria-label={`Accepter cet ecart : ${e.consequence ?? ''}`}
            title={e.consequence} className="rounded-lg border border-amber-500/40 px-2 py-1 text-amber-200 hover:bg-amber-500/10">
            Accepter ainsi
          </button>
          {e.consequence && <span className="text-slate-500">→ {e.consequence}</span>}
        </div>
      ))}
    </li>
  );
  const mediasGeneres = film ? film.scenes.flatMap((s) => s.plans).filter((p) => p.media).length : 0;

  const etapesWizard: EtapeWizard[] = [
    { titre: 'Histoire', icone: Clapperboard, accessible: true },
    { titre: 'Personnages', icone: Users, accessible: true },
    { titre: 'Scenes', icone: Link2, accessible: !!film, empeche: 'Scenes — composez d’abord le scenario' },
    { titre: 'Apercu', icone: Eye, accessible: !!film, empeche: 'Apercu — composez d’abord le scenario' },
    { titre: 'Export', icone: Download, accessible: !!film, empeche: 'Export — composez d’abord le scenario' },
  ];

  const allerAEtape = (i: number) => {
    if (i < 0 || i >= etapesWizard.length || !etapesWizard[i].accessible) return;
    setEtape(i);
  };

  /**
   * L'action primaire du pied de page — une seule par etape. A l'etape Personnages, elle
   * COMPOSE le scenario : c'est un acte explicite, jamais un effet de bord de la navigation.
   */
  const actionEtape = etape === 4 ? null : etape === 1 && !film
    ? { libelle: enCours === 'scenario' ? 'Composition…' : 'Composer le scenario', onClick: () => { void composer().then(() => setEtape(2)); }, desactive: enCours !== null, titre: 'Decouper votre histoire en scenes et en plans' }
    : { libelle: 'Continuer', onClick: () => allerAEtape(etape + 1), desactive: !etapesWizard[Math.min(etape + 1, 4)].accessible };

  const enteteWizard = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <Clapperboard className="h-5 w-5 shrink-0 text-violet-400" aria-hidden="true" />
        <h1 className="truncate text-base font-bold text-slate-50">Cinema IA</h1>
        <span className="rounded-full border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-300">prototype</span>
        <Detail texte="Le decoupage est local et deterministe : une phrase de votre histoire = un plan. Aucune IA generative n'est appelee pour composer le scenario, et votre texte d'origine est conserve tel quel." />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {mesFilms.length > 0 && (
          <label className="mt-4 inline-flex items-center gap-2 text-xs text-slate-400">
            {tUi('reprendre_un_film')}
            <select
              value={film?.id ?? ''}
              onChange={(e) => ouvrirFilm(e.target.value)}
              disabled={enCours !== null}
              className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-slate-200"
            >
              <option value="">—</option>
              {mesFilms.map((f) => <option key={f.id} value={f.id}>{f.titre || f.id}</option>)}
            </select>
            {film && mesFilms.some((f) => f.id === film.id) && (suppressionArmee ? (
              <span className="inline-flex items-center gap-1 text-rose-300" role="group" aria-label={tUi('confirmer_la_suppression_du_film')}>
                {tUi('supprimer_le_film_et_ses_fichiers')}
                <button type="button" onClick={supprimerFilmOuvert} disabled={enCours !== null} aria-label={tUi('confirmer_la_suppression_du_film')} className="p-1 rounded hover:bg-rose-500/20 disabled:opacity-50"><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setSuppressionArmee(false)} aria-label={tUi('annuler_la_suppression')} className="p-1 rounded hover:bg-slate-700"><X className="w-4 h-4" /></button>
              </span>
            ) : (
              <button type="button" onClick={() => setSuppressionArmee(true)} disabled={enCours !== null} aria-label={tUi('supprimer_ce_film')} title={tUi('supprimer_ce_film')} className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
            ))}
          </label>
        )}
        <QuotaCinema
          filmId={film?.id ?? null}
          version={(film?.generations ?? []).map((g) => `${g.id}:${g.statut}`).join('|')}
        />
      </div>
    </div>
  );

  /** Les donnees de la fenetre de preparation : tout ce qui a ete verifie, et le cout. */
  const donneesDialogueIA: DonneesDialogue | null = (() => {
    if (!confirmation || !film) return null;
    const scene = film.scenes.find((sc) => sc.plans.some((pl) => pl.id === confirmation.planId));
    const plan = scene?.plans.find((pl) => pl.id === confirmation.planId);
    if (!scene || !plan) return null;
    const video = confirmation.operation === 'video';
    const cle = video ? 'ai.image_to_video' : 'ai.generate_background';
    const reelle = generationMode === 'reelle';
    const fermerEtAller = (etapeCible: number) => () => { setConfirmation(null); setEtape(etapeCible); };
    const v: Verification[] = [];
    // Le moteur
    if (!generationIa) v.push({ etat: 'bloque', texte: 'La génération IA est indisponible pour le moment. Tu peux ajouter ton propre média à la place.' });
    else if (reelle) v.push({ etat: 'ok', texte: 'Le moteur de génération est disponible.' });
    else v.push({ etat: 'info', texte: 'Mode démonstration : ce visuel de test est gratuit (un aplat de couleur), ce n’est pas une vraie image.' });
    // Une seule creation a la fois par film
    if (generationActiveDe(film)) v.push({ etat: 'bloque', texte: 'Une création est déjà en cours pour ce film. Attends qu’elle se termine, puis recommence.' });
    if (video && plan.media?.genre !== 'image') v.push({ etat: 'bloque', texte: 'Pour animer ce visuel, il faut d’abord une image.' });
    // Le style
    const style = film.styleCinema ? styleDe(film.styleCinema)?.libelle : null;
    v.push(style
      ? { etat: 'ok', texte: `Style du film : ${style}.` }
      : { etat: 'info', texte: 'Aucun style imposé : l’image suivra ta description.', action: { libelle: 'Choisir un style', surClic: fermerEtAller(0) } });
    // Les personnages et leurs photos de reference
    const presents = film.personnages.filter((pp) => plan.personnages.includes(pp.id));
    if (presents.length === 0) v.push({ etat: 'info', texte: 'Aucun personnage dans ce visuel.' });
    else {
      const sansPhoto = presents.filter((pp) => !aUnePhoto(pp));
      v.push(sansPhoto.length === 0
        ? { etat: 'ok', texte: `Personnages : ${presents.map((pp) => pp.nom).join(', ')} (photos de référence utilisées).` }
        : { etat: 'info', texte: `Personnages : ${presents.map((pp) => pp.nom).join(', ')}. Sans photo de référence : ${sansPhoto.map((pp) => pp.nom).join(', ')} (décrits seulement par leur texte).` });
    }
    // Les points a verifier dans l'histoire
    const nb = bloquants.length;
    if (nb === 0) v.push({ etat: 'ok', texte: 'Aucun point critique à vérifier dans ton histoire.' });
    else if (reelle) {
      v.push({ etat: 'bloque', texte: `${nb === 1 ? 'Un point' : `${nb} points`} de ton histoire ${nb === 1 ? 'doit' : 'doivent'} être vérifié${nb > 1 ? 's' : ''} avant la génération.`, action: { libelle: 'Voir les points', surClic: fermerEtAller(3) } });
    } else {
      v.push({ etat: 'info', texte: `${nb === 1 ? 'Un point' : `${nb} points`} à vérifier dans ton histoire : ${nb === 1 ? 'il bloquerait' : 'ils bloqueraient'} une création payante, pas cette démonstration.`, action: { libelle: 'Voir les points', surClic: fermerEtAller(3) } });
    }
    const prix = tarifs.prix[cle];
    return {
      titre: video ? 'Animer ce visuel en vidéo' : 'Préparer l’image avec l’IA',
      cible: `Scène ${scene.index + 1} · ${scene.titre} — visuel ${scene.plans.indexOf(plan) + 1}`,
      description: plan.dialogue?.texte ?? plan.description,
      verifications: v,
      cout: reelle
        ? `Coût estimé : ${libellePrix(tarifs, cle)}. Rien n’est débité avant ton accord, et le serveur applique tes plafonds.`
        : 'Coût : 0 crédit (démonstration gratuite).',
      payant: reelle,
      libelleConfirmer: reelle ? `Confirmer et créer · ${libelleCredits(prix)}` : 'Créer le visuel de démonstration',
    };
  })();

  return (
    <div className="text-slate-100">
      {erreur && (
        <div className="mb-3 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200" role="alert">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      <WizardCinema
        etapes={etapesWizard}
        active={etape}
        surAller={allerAEtape}
        chargement={enCours !== null}
        actionPrincipale={actionEtape}
        indice={etape === 2 && film && methode
          ? (bloquants.length > 0
            ? `${bloquants.length} point${bloquants.length > 1 ? 's' : ''} à vérifier dans ton histoire`
            : visuelsAPreparer > 0 ? `${visuelsAPreparer} visuel${visuelsAPreparer > 1 ? 's' : ''} à préparer · tu peux continuer` : null)
          : null}
        entete={enteteWizard}
        apercu={(
          <div className="space-y-3">
        <div id="cinema-apercu" className="scroll-mt-4">
          {/* UN SEUL apercu : un exemple, ou le film de l'utilisateur — jamais les deux. */}
          {exemple ? (
            <ApercuExemple
              exemple={exemple} format={format}
              surRevenir={() => { setExemple(null); setExempleAgrandi(false); }}
              surAgrandir={() => setExempleAgrandi(true)}
            />
          ) : film && sceneSel && etape < 3 ? (
            // UN SEUL apercu a l'etape Scenes (et avant) : le media de la scene selectionnee.
            <ApercuScene
              filmId={film.id}
              scene={sceneSel as never}
              planIndex={planParScene[sceneSel.id] ?? 0}
              surPlan={(k) => setPlanParScene((m) => ({ ...m, [sceneSel.id]: k }))}
              agrandi={mediaAgrandi}
              surAgrandir={() => setMediaAgrandi(true)} surReduire={() => setMediaAgrandi(false)}
              actionVide={(() => {
                const pl = sceneSel.plans[Math.min(planParScene[sceneSel.id] ?? 0, Math.max(0, sceneSel.plans.length - 1))];
                if (!pl) return null;
                if (methode === 'import') {
                  return (
                    <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-violet-500/60 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/10" data-action-vide="import">
                      {enCours === `media:${pl.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
                      {tUi('ajouter_une_image_ou_une_video')}
                      <input type="file" accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.m4v" className="sr-only"
                        aria-label={tUi('ajouter_une_image_ou_une_video_a_cette')}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) importerMedia(pl.id, f); e.target.value = ''; }} />
                    </label>
                  );
                }
                if (methode === 'ia') {
                  return generationIa ? (
                    <button type="button" onClick={() => genererMedia(pl.id, 'image')} data-action-vide="ia"
                      className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/60 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/10">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {tUi('preparer_l_image_avec_l_ia')}
                    </button>
                  ) : <p className="text-[11px] text-slate-500">{tUi('la_creation_d_images_par_ia_n_est_pas')}</p>;
                }
                return <p className="text-[11px] text-slate-500" data-action-vide="choisir">{tUi('choisis_d_abord_comment_creer_tes_imag')}</p>;
              })()}
            />
          ) : montage ? (
            <Apercu montage={montage} surPreparerVoix={preparerVoix} voixEnCours={enCours === 'voix'} />
          ) : (
            <ApercuVide format={format} />
          )}
          {/* Les quatre mouvements : ils alimentent le MEME apercu, sous lui. */}
          <ChoixMouvements
            actif={exemple?.type === 'mouvement' ? exemple.id : null}
            surChoisir={(id) => { setExemple({ type: 'mouvement', id }); setExempleAgrandi(false); }}
          />
          {exemple && exempleAgrandi && (
            <FenetreExemple exemple={exemple} surFermer={() => setExempleAgrandi(false)} />
          )}
        </div>
          </div>
        )}
      >
        {etape === 0 && (
          <div>
            <TitreEtape numero={1} total={5} icone={Clapperboard} titre="Racontez votre idee."
              phrase="Un court resume suffit. Studiio vous guidera ensuite pour les personnages et les scenes, sans changer votre histoire." />
            <ModelesFilm
              aDesSaisies={aDesSaisies}
              surAppliquer={appliquerModele}
              surPartirDeZero={partirDeZero}
            />
            <input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder={tUi('titre_du_film')}
              className="w-full mb-3 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            />
            <div className="relative">
              <textarea
                value={histoire}
                onChange={(e) => setHistoire(e.target.value)}
                rows={5}
                placeholder={tUi('une_phrase_par_plan_pour_une_replique')}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 py-2 pl-3 pr-11 text-sm leading-relaxed"
              />
              {/* Aide a la redaction : mise en forme locale + redaction assistee par le
                  moteur de texte PARTAGE de Studiio (aucun credit debite). */}
              <AideRedaction
                contexte={{ titre, styleCinema: styleAffiche, nbScenes, format, casting }}
                histoire={histoire}
                surChanger={setHistoire}
                personnages={casting.map((c) => c.nom).filter(Boolean)}
              />
            </div>
            <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
              {tUi('une_phrase_un_plan')}
              <Detail texte="Une phrase entre guillemets devient une replique dite par le personnage nomme dans la phrase ; sans guillemets, c'est le narrateur. Decrire la lumiere et le lieu dans la phrase ameliore l'image du plan : c'est ce texte qui sert de description visuelle." />
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">Format
                <select value={format} onChange={(e) => setFormat(e.target.value as '16:9' | '9:16')} className="rounded bg-slate-950 border border-slate-700 px-2 py-1">
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                </select>
              </label>
              <label className="flex items-center gap-2">Qualite
                <select value={qualite} onChange={(e) => setQualite(e.target.value)} className="rounded bg-slate-950 border border-slate-700 px-2 py-1">
                  <option value="brouillon">brouillon</option>
                  <option value="standard">standard</option>
                  <option value="cinema">cinema</option>
                </select>
                <Detail texte="La qualite choisit la resolution et le fournisseur visuel. Seul le fournisseur local (gratuit) est actif aujourd'hui : les trois qualites rendent donc le meme type d'image." />
              </label>
              <label className="flex items-center gap-2">Scenes
                <input type="number" min={3} max={5} value={nbScenes} onChange={(e) => setNbScenes(Number(e.target.value))} className="w-16 rounded bg-slate-950 border border-slate-700 px-2 py-1" />
              </label>
            </div>
            <SelecteurStyleFilm
              valeur={styleAffiche}
              surChoisir={choisirStyleFilm}
              surMontrerExemple={(id) => { setExemple({ type: 'style', id }); setExempleAgrandi(false); }}
              exempleVu={exemple?.type === 'style' ? exemple.id : null}
            />
            <ModeAudioCartes
              valeur={modeAudioAffiche}
              surChoisir={choisirModeAudio}
              historique={!!film && !film.modeAudio}
              deduit={!film && choixModeAudio === null}
            />
          </div>
        )}

        {etape === 1 && (
          <div>
            <TitreEtape numero={2} total={5} icone={Users} titre="Qui joue dans votre film ?"
              phrase="Gardez les memes personnages d’une scene a l’autre. Un personnage absent de cette liste n’apparaitra dans aucun plan." />
            <div className="space-y-3">
              {casting.map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input value={p.nom} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, nom: e.target.value } : c))} placeholder="Nom" className="min-w-0 rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
                  <input value={p.role} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, role: e.target.value } : c))} placeholder="Role" className="min-w-0 rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
                  <input value={p.description} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, description: e.target.value } : c))} placeholder="Apparence (reference)" className="col-span-2 rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
                  {modeAudioAffiche === 'personnages' && (
                    <label className="col-span-2 flex flex-wrap items-center gap-2 text-xs text-slate-400" data-voix-personnage>
                      <Mic className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden="true" />
                      <span>{tUi('voix_de')} {p.nom || tUi('ce_personnage')}</span>
                      <select
                        value={p.voix ?? voixDistincte(i)}
                        aria-label={`Voix de ${p.nom || `personnage ${i + 1}`}`}
                        onChange={(e) => {
                          const voix = e.target.value;
                          setCasting(casting.map((c, k) => k === i ? { ...c, voix } : c));
                          // Un film existant : la voix est enregistree (la meme dans toutes ses scenes).
                          const pf = film?.personnages[i];
                          if (film && pf) void enregistrer({ voix: [{ personnageId: pf.id, voix }] });
                        }}
                        className="min-w-0 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-slate-200"
                      >
                        {VOIX_FILM.map((v) => <option key={v.id} value={v.id}>{v.libelle}</option>)}
                      </select>
                      {casting.some((c, k) => k !== i && (c.voix ?? voixDistincte(k)) === (p.voix ?? voixDistincte(i)) && c.nom && p.nom) && (
                        <span className="text-amber-300" data-voix-partagee>{tUi('meme_voix_qu_un_autre_personnage_chois')}</span>
                      )}
                    </label>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setCasting([...casting, { nom: '', role: '', description: '', urlImage: '' }])} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
                <Plus className="w-4 h-4" /> {tUi('ajouter_un_personnage')}
              </button>
              {casting.length > 1 && (
                <button onClick={() => setCasting(casting.slice(0, -1))} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-red-500/50">
                  <Trash2 className="w-4 h-4" /> {tUi('retirer_le_dernier')}
                </button>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="text-xs text-slate-400">
                {tUi('le_decoupage_est_local_et_deterministe')}
                {film && montage && ` Scenario actuel : ${film.scenes.length} scenes, ${montage.segments.length} plans, ${montage.dureeS.toFixed(1)} s.`}
              </p>
              {film && (
                <button
                  onClick={() => { void composer(); }}
                  disabled={enCours !== null}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-violet-500/50 disabled:opacity-50"
                >
                  {enCours === 'scenario' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  {tUi('recomposer_le_scenario_depuis_mon_text')}
                </button>
              )}
            </div>
          </div>
        )}

        {etape === 2 && (
          <div>
            <TitreEtape numero={3} total={5} icone={Link2} titre="Donnons vie à ton histoire"
              phrase="Tes scènes sont préparées. Choisis comment créer les images de ton film." />
            {film ? (
              <>
                {!methode ? (
                  /* LE CHOIX : deux cartes, rien d'autre. Cliquer ne lance AUCUNE generation et ne coute rien. */
                  <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={tUi('comment_creer_les_images_de_ton_film')} data-choix-methode>
                    <button
                      type="button"
                      onClick={() => { choisirMethode('ia'); }}
                      disabled={!generationIa}
                      aria-disabled={!generationIa}
                      title={generationIa ? tUi('studiio_cree_les_images_un_visuel_a_la') : tUi('la_creation_d_images_par_ia_n_est_pas_2')}
                      className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-left transition-colors hover:border-violet-500/60 disabled:cursor-not-allowed disabled:opacity-50"
                      data-methode="ia"
                    >
                      <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300"><Sparkles className="h-5 w-5" aria-hidden="true" /></span>
                      <span className="block text-sm font-semibold text-slate-50">{tUi('creer_les_images_avec_l_ia')}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                        {!generationIa
                          ? tUi('pas_disponible_pour_le_moment')
                          : generationMode === 'simulee'
                            ? tUi('mode_demonstration_gratuit_des_visuels')
                            : tUi('studiio_prepare_les_images_de_ton_film')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => { choisirMethode('import'); }}
                      title={tUi('tu_ajoutes_tes_propres_images_ou_video')}
                      className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-left transition-colors hover:border-violet-500/60"
                      data-methode="import"
                    >
                      <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300"><Upload className="h-5 w-5" aria-hidden="true" /></span>
                      <span className="block text-sm font-semibold text-slate-50">{tUi('utiliser_mes_images_ou_videos')}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-slate-400">{tUi('tu_ajoutes_tes_propres_medias_une_scen')}</span>
                    </button>
                  </div>
                ) : (
                  /* LA METHODE CHOISIE : un panneau court, puis les scenes au second niveau. */
                  <section className="mb-3 space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3" data-methode-active={methode}>
                    <div className="flex items-center gap-2">
                      {methode === 'ia' ? <Sparkles className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" /> : <Upload className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />}
                      <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-100">{methode === 'ia' ? tUi('creer_les_images_avec_l_ia') : tUi('utiliser_mes_images_ou_videos')}</h3>
                      <button type="button" onClick={() => choisirMethode(null)} className="shrink-0 text-xs text-slate-400 underline hover:text-slate-200">{tUi('changer_de_methode')}</button>
                    </div>
                    <p className="text-xs text-slate-300" data-visuels>
                      {visuelsAPreparer > 0
                        ? `${visuelsAPreparer} visuel${visuelsAPreparer > 1 ? 's' : ''} à préparer dans ${scenesSansVisuel} scène${scenesSansVisuel > 1 ? 's' : ''}.`
                        : tUi('tous_les_visuels_de_ton_film_sont_pret')}
                    </p>
                    {methode === 'ia' ? (
                      <>
                        <p className="text-xs leading-relaxed text-slate-400" data-cout-previsionnel>
                          {generationMode === 'simulee'
                            ? tUi('demonstration_gratuite_aucun_credit_n')
                            : visuelsAPreparer > 0
                              ? `Coût prévisionnel : ${libelleCredits(visuelsAPreparer * tarifs.prix['ai.generate_background'])} pour ${visuelsAPreparer} image${visuelsAPreparer > 1 ? 's' : ''} (${libellePrix(tarifs, 'ai.generate_background')} chacune). Rien n’est débité tant que tu n’as pas confirmé chaque image.`
                              : tUi('rien_a_creer_tous_les_visuels_existent')}
                        </p>
                        <p className="text-xs leading-relaxed text-slate-400">
                          {tUi('studiio_cree_un_visuel_a_la_fois_chois')}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs leading-relaxed text-slate-400">{tUi('choisis_une_scene_puis_ajoute_ton_imag')}</p>
                    )}
                    {bloquants.length > 0 && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-amber-200" data-points-a-verifier>
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {bloquants.length} point{bloquants.length > 1 ? 's' : ''} {tUi('a_verifier_dans_ton_histoire')}
                        {methode === 'ia' && generationMode === 'reelle' ? ' avant de créer des images payantes' : ''}.
                        <button type="button" onClick={() => allerAEtape(3)} className="underline">{tUi('voir_les_points')}</button>
                      </p>
                    )}
                    {aProduire.length > 0 && (
                      <p className="flex items-start gap-2 text-xs text-slate-300" data-a-mettre-a-jour>
                        <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                        <span>{aProduire.length === 1 ? tUi('une_scene_doit_etre_mise_a_jour') : tUi('length_scenes_doivent_etre_mises_a_jou', { length: aProduire.length })} {tUi('son_contenu_a_change_depuis_la_dernier')}</span>
                      </p>
                    )}
                    {visuelsAPreparer > 0 && (
                      <button type="button" onClick={allerAuPremierVisuel} className="rounded-lg border border-violet-500/50 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/10">
                        {methode === 'ia' ? tUi('commencer_par_le_premier_visuel') : tUi('ajouter_au_premier_visuel_manquant')}
                      </button>
                    )}
                  </section>
                )}
                {methode && (
                  <div className="mb-3">
                    <ResumeStyle
                      styleFilm={film.styleCinema ?? null}
                      exceptions={film.scenes.filter((x) => x.styleCinema && x.styleCinema !== film.styleCinema).length}
                    />
                  </div>
                )}
                {methode && (
              <div className="space-y-1.5" data-storyboard="scenes">
                {film.scenes.map((scene) => {
                  const selectionnee = sceneSel?.id === scene.id;
                  const ouverte = selectionnee && outilsOuverts;
                  const ecarts = ecartsScene(film as never, scene as never);
                  const planVignette = scene.plans.find((pl) => pl.media) ?? null;
                  const aPreparer = scene.plans.filter((pl) => !pl.media).length;
                  const aRefaire = aProduire.includes(scene.id);
                  const pointsCritiques = ecarts.filter((e) => e.critique && !acceptes.has(e.cle)).length;
                  const indexPlan = Math.min(planParScene[scene.id] ?? 0, Math.max(0, scene.plans.length - 1));
                  const plan = scene.plans[indexPlan];
                  return (
                  <div key={scene.id} id={`scene-cinema-${scene.id}`} data-selectionnee={selectionnee ? 'oui' : 'non'}
                    className={`scroll-mt-4 rounded-lg border p-2 ${selectionnee ? 'border-violet-500/70 bg-violet-500/5 ring-1 ring-violet-500/30' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'}`}>
                    {/* La liste compacte : miniature (VRAI media, sinon emplacement neutre), numero, titre court, statut. */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => selectionnerScene(scene.id, true)}
                        aria-label={`Selectionner la scene ${scene.index + 1} : ${scene.titre}`}
                        aria-current={selectionnee ? 'true' : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span className="relative block shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-900" style={{ width: 64, height: 40 }} data-vignette={planVignette?.media ? 'media' : 'vide'}>
                          {planVignette?.media?.genre === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={urlMediaPlan(film.id, planVignette.id)} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
                          ) : planVignette?.media ? (
                            <video src={`${urlMediaPlan(film.id, planVignette.id)}#t=0.1`} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-slate-600"><ImageIcon className="h-4 w-4" aria-hidden="true" /></span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-100" title={scene.titre}>
                            <span className="tabular-nums text-violet-300">{String(scene.index + 1).padStart(2, '0')}</span> · {scene.titre}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400" data-statut-scene>
                            {scene.etat === 'validee' ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                              : aRefaire ? <RefreshCw className="h-3 w-3 shrink-0 text-amber-300" aria-hidden="true" />
                              : aPreparer === 0 ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400/70" aria-hidden="true" />
                              : <Circle className="h-3 w-3 shrink-0 text-slate-600" aria-hidden="true" />}
                            <span>{aPreparer === 0 ? tUi('visuels_prets') : `${aPreparer} visuel${aPreparer > 1 ? 's' : ''} à préparer`}</span>
                            {aRefaire && (
                              <span className="text-amber-300" title={tUi('tu_as_change_le_contenu_de_cette_scene')}>{tUi('a_mettre_a_jour')}</span>
                            )}
                            {pointsCritiques > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-amber-300" title={tUi('points_a_verifier_dans_ton_histoire_po')}>
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />{pointsCritiques} point{pointsCritiques > 1 ? 's' : ''} {tUi('a_verifier')}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => (selectionnee ? setOutilsOuverts(!outilsOuverts) : selectionnerScene(scene.id, true))}
                        aria-expanded={ouverte}
                        aria-controls={`outils-${scene.id}`}
                        aria-label={ouverte ? `Fermer les outils de la scene ${scene.index + 1}` : `Ouvrir les outils de la scene ${scene.index + 1}`}
                        title={ouverte ? tUi('fermer_les_outils') : tUi('modifier_cette_scene')}
                        className={`${BOUTON_ICONE} ${ouverte ? 'border-violet-500/60 text-violet-200' : ''}`}
                      >
                        {ouverte ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <Pencil className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>

                    {/* Les outils n'existent QUE pour la scene selectionnee, et seulement pour son plan courant. */}
                    {ouverte && plan && (
                    <div id={`outils-${scene.id}`} className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{scene.lieu}</span>
                        <button
                          type="button"
                          onClick={() => enregistrer({ scenes: [{ id: scene.id, etat: scene.etat === 'validee' ? 'brouillon' : 'validee' }] })}
                          aria-label={scene.etat === 'validee' ? tUi('repasser_la_scene_en_brouillon') : tUi('valider_la_scene')}
                          aria-pressed={scene.etat === 'validee'}
                          title={scene.etat === 'validee' ? 'Repasser en brouillon' : tUi('valider_la_scene')}
                          className={BOUTON_ICONE}
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => produire([scene.id])}
                          disabled={enCours !== null || ACTIF(travail)}
                          aria-label={tUi('regenerer_cette_scene')}
                          title={tUi('regenerer_cette_scene')}
                          className={BOUTON_ICONE}
                        >
                          <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      {/* Ce que VOTRE texte dit de cette scene : le lien verifiable avec l'original. */}
                      <ol className="space-y-1">
                        {phrasesDeLaScene(film as never, scene as never).map((ph, k) => (
                          <li key={k} className="flex gap-2 text-[11px] leading-snug text-slate-400">
                            <span className="shrink-0 text-slate-600">{k + 1}.</span><span className="min-w-0">{ph}</span>
                          </li>
                        ))}
                      </ol>
                      {ecarts.length > 0 && (
                        <ul className="space-y-2" data-ecarts-scene>
                          {ecarts.map((e) => carteEcart(e))}
                        </ul>
                      )}

                      {/* LE PLAN COURANT : un seul editeur, jamais un formulaire par plan. */}
                      <div className="space-y-2.5 rounded-lg border border-slate-800/80 bg-slate-900/40 p-2.5" data-plan-editeur={plan.id}>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          {scene.plans.length > 1 && (
                            <span className="inline-flex items-center gap-1" role="group" aria-label={tUi('choisir_le_plan')}>
                              {scene.plans.map((pl, k) => (
                                <button key={pl.id} type="button" onClick={() => setPlanParScene((m) => ({ ...m, [scene.id]: k }))}
                                  aria-pressed={k === indexPlan} aria-label={`Modifier le plan ${k + 1}`} title={`Visuel ${k + 1}`}
                                  className={`h-6 min-w-6 rounded border px-1 text-[11px] tabular-nums ${k === indexPlan ? 'border-violet-400 bg-violet-500/20 text-violet-100' : 'border-slate-700 text-slate-400 hover:border-violet-500/50'}`}>
                                  {k + 1}
                                </button>
                              ))}
                            </span>
                          )}
                          {plan.dialogue && (
                            <span className="inline-flex min-w-0 max-w-full items-center rounded-full border border-pink-500/30 px-2 py-0.5 text-[11px] text-pink-300"
                              title={plan.dialogue.personnageId ? undefined : tUi('phrase_de_recit_lue_en_narration_attri')}>
                              <span className="truncate">{film.personnages.find((pp) => pp.id === plan.dialogue?.personnageId)?.nom ?? 'Narration'}</span>
                            </span>
                          )}
                        </div>

                        <input
                          key={plan.id}
                          defaultValue={plan.dialogue?.texte ?? plan.description}
                          onBlur={(e) => {
                            const texte = e.target.value;
                            if (texte !== (plan.dialogue?.texte ?? plan.description)) enregistrer({ plans: [{ id: plan.id, texte }] });
                          }}
                          aria-label={`Description du plan ${indexPlan + 1}`}
                          className="w-full min-w-0 rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <SelecteurCamera
                            valeur={plan.camera ?? 'auto'}
                            ancien={film.directionActive !== true}
                            automatique={cameraEffective({ ...plan, camera: undefined, cadre: plan.cadre as never }, scene as never).effective}
                            surChoisir={(id) => {
                              enregistrer({ plans: [{ id: plan.id, camera: id }] });
                              // L'apercu unique montre tout de suite le plan filme du mouvement, ou dit « Exemple indisponible » (aucun appel IA).
                              if (id !== 'auto') { setExemple({ type: 'mouvement', id }); setExempleAgrandi(false); }
                            }}
                          />
                          {plan.media && aRegenerer.has(plan.id) && <PlanAregenerer genre={plan.media.genre} />}
                        </div>

                        {/* Les actions : de petites icones, toutes nommees (infobulle + libelle accessible). */}
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tUi('media_du_plan')}>
                          <label title={plan.media ? tUi('remplacer_le_media_de_ce_plan') : tUi('importer_une_image_ou_une_video')} className={`${BOUTON_ICONE} cursor-pointer ${methode === 'import' && !plan.media ? 'border-violet-400 text-violet-200' : ''}`}>
                            {enCours === `media:${plan.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.m4v"
                              className="sr-only"
                              aria-label={plan.media ? tUi('remplacer_le_media_de_ce_plan') : tUi('importer_une_image_ou_une_video')}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) importerMedia(plan.id, f); e.target.value = ''; }}
                            />
                          </label>
                          {generationIa && methode === 'ia' && !plan.media && (
                            <button
                              type="button" onClick={() => genererMedia(plan.id, 'image')}
                              disabled={enCours !== null || !!generationActiveDe(film)}
                              data-cinema-generation="image"
                              aria-label={generationMode === 'simulee' ? 'Generer l’image (IA, simule)' : 'Generer l’image (IA)'}
                              title={generationMode === 'simulee' ? 'Generer l’image (simulation locale gratuite)' : tUi('generer_l_image_par_ia')}
                              className={`${BOUTON_ICONE} ${generationMode === 'reelle' ? 'w-auto gap-1 px-2' : ''}`}
                            >
                              {enCours === `generation:${plan.id}:image` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                              {generationMode === 'reelle' && <span className="text-[11px] text-violet-300/90">{libellePrix(tarifs, 'ai.generate_background')}</span>}
                            </button>
                          )}
                          {generationIa && methode === 'ia' && plan.media?.genre === 'image' && (
                            <button
                              type="button" onClick={() => genererMedia(plan.id, 'video')}
                              disabled={enCours !== null || !!generationActiveDe(film)}
                              data-cinema-generation="video"
                              aria-label={generationMode === 'simulee' ? 'Animer en video (IA, simule)' : 'Animer en video (IA)'}
                              title={generationMode === 'simulee' ? 'Animer en video (simulation locale gratuite)' : tUi('animer_cette_image_en_video_par_ia')}
                              className={`${BOUTON_ICONE} ${generationMode === 'reelle' ? 'w-auto gap-1 px-2' : ''}`}
                            >
                              {enCours === `generation:${plan.id}:video` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Clapperboard className="h-4 w-4" aria-hidden="true" />}
                              {generationMode === 'reelle' && <span className="text-[11px] text-violet-300/90">{libellePrix(tarifs, 'ai.image_to_video')}</span>}
                            </button>
                          )}
                          {plan.media && (retraitEnAttente === plan.id ? (
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-200" role="group" aria-label={tUi('confirmer_le_retrait_du_media')}>
                              {tUi('retirer_ce_media')}
                              <button type="button" onClick={() => { setRetraitEnAttente(null); enregistrer({ plans: [{ id: plan.id, media: null }] }); }} aria-label={tUi('confirmer_le_retrait')} className="underline">Oui</button>
                              <button type="button" onClick={() => setRetraitEnAttente(null)} aria-label={tUi('annuler_le_retrait')} className="underline">Non</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setRetraitEnAttente(plan.id)} aria-label={tUi('retirer_le_media_de_ce_plan')} title={tUi('retirer_le_media_de_ce_plan_le_fichier')} className={BOUTON_ICONE}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ))}
                          <span className="min-w-0 truncate text-[11px] text-slate-500" data-provenance-plan>
                            {provenanceMedia(plan.media as never).libelle}
                          </span>
                        </div>

                        <SuiviGenerationPlan
                          generation={derniereGenerationDuPlan(film, plan.id)}
                          confirmation={null}
                          prix=""
                          surConfirmer={() => {}}
                          surAnnuler={() => {}}
                        />

                        {/* Les personnages DE CE PLAN : leurs portraits (vraie photo de reference, sinon icone neutre). */}
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tUi('personnages_de_ce_plan')}>
                          {film.personnages.map((pp) => {
                            const present = plan.personnages.includes(pp.id);
                            return (
                              <PortraitPersonnage key={pp.id} filmId={film.id} personnage={pp} selectionne={present} taille={34}
                                surClic={() => enregistrer({ plans: [{ id: plan.id, personnages: present ? plan.personnages.filter((x) => x !== pp.id) : [...plan.personnages, pp.id] }] })} />
                            );
                          })}
                          <span className="min-w-0 truncate text-[11px] text-slate-500">
                            {film.personnages.filter((pp) => plan.personnages.includes(pp.id)).map((pp) => pp.nom).join(', ') || tUi('aucun_personnage')}
                          </span>
                        </div>
                      </div>

                      {/* Reglages secondaires : un seul panneau, replie. */}
                      <details className="rounded-lg border border-slate-800/80 px-3 py-2" data-avance="scene">
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-slate-400 hover:text-slate-200">
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" /> Options avancees
                          {scene.styleCinema && scene.styleCinema !== film.styleCinema && <span className="text-violet-300">{tUi('style_different_du_film')}</span>}
                        </summary>
                        <div className="mt-3 space-y-3 text-xs text-slate-400">
                          <p data-info-technique>
                            {tUi('image')} {indexPlan + 1} sur {scene.plans.length} · cadre {plan.cadre} {tUi('duree')} {plan.dureeS.toFixed(1)} s
                            {plan.media && ` · ${plan.media.largeur}x${plan.media.hauteur}`}
                            {plan.media?.dureeS != null && ` · ${plan.media.dureeS.toFixed(1)} s`}
                            {plan.media && ` · ${(plan.media.octets / 1_000_000).toFixed(1)} Mo`}
                          </p>
                          {plan.media?.genre === 'video' && (
                            <button type="button" onClick={() => enregistrer({ plans: [{ id: plan.id, sonMedia: !plan.media?.sonActif }] })}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1 hover:border-violet-500/50">
                              {plan.media.sonActif ? <Volume2 className="h-3.5 w-3.5" aria-hidden="true" /> : <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />}
                              {plan.media.sonActif ? tUi('son_du_rush_garde') : tUi('son_du_rush_coupe')}
                            </button>
                          )}
                          <div>
                            <p className="mb-1 text-slate-500">{tUi('personnages_de_la_scene')}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {film.personnages.map((pp) => {
                                const present = scene.personnages.includes(pp.id);
                                return (
                                  <button key={pp.id} type="button"
                                    onClick={() => enregistrer({ scenes: [{ id: scene.id, personnages: present ? scene.personnages.filter((x) => x !== pp.id) : [...scene.personnages, pp.id] }] })}
                                    aria-pressed={present}
                                    className={`rounded-full border px-2.5 py-0.5 ${present ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400'}`}>
                                    {pp.nom}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-slate-500">Photos de reference</p>
                            <ul className="space-y-1.5">
                              {film.personnages.map((pp) => (
                                <li key={pp.id} className="flex items-center gap-2">
                                  <PortraitPersonnage filmId={film.id} personnage={pp} selectionne taille={28} />
                                  <span className="min-w-0 flex-1 truncate">{pp.nom}{aUnePhoto(pp) ? '' : ' — aucune photo'}</span>
                                  <label title={aUnePhoto(pp) ? tUi('remplacer_la_photo_de_nom', { nom: pp.nom }) : tUi('ajouter_une_photo_de_reference_pour_no', { nom: pp.nom })} className={`${BOUTON_ICONE} cursor-pointer`}>
                                    {enCours === `reference:${pp.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                                    <input type="file" accept=".jpg,.jpeg,.png,.webp" className="sr-only"
                                      aria-label={aUnePhoto(pp) ? tUi('remplacer_la_photo_de_nom', { nom: pp.nom }) : tUi('ajouter_une_photo_de_reference_pour_no', { nom: pp.nom })}
                                      onChange={(e) => { const f = e.target.files?.[0]; if (f) importerReference(pp.id, f); e.target.value = ''; }} />
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <ExceptionStyleScene
                            key={`${scene.id}:${scene.styleCinema ?? ''}`}
                            valeur={scene.styleCinema ?? null}
                            styleFilm={film.styleCinema ?? null}
                            surValider={(id) => enregistrer({ scenes: [{ id: scene.id, style: id }] })}
                          />
                        </div>
                      </details>
                    </div>
                    )}
                  </div>
                  );
                })}
              </div>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                {tUi('composez_d_abord_le_scenario_a_l_etape')}
              </p>
            )}
          </div>
        )}

        {etape === 3 && (
          <div>
            <TitreEtape numero={4} total={5} icone={Eye} titre="Verifiez avant de generer."
              phrase="Un seul apercu, et ce qu’il contient vraiment. Rien n’est facture tant que vous n’avez pas lance une generation." />
            {film && fidelite ? (
              <>
                <div className="space-y-1.5">
                  <p className="flex items-center gap-2 text-sm text-slate-200">
                    {fidelite.fidele
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                      : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />}
                    {resumeFidelite(fidelite)}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    Personnages : {film.personnages.map((p) => p.nom).join(' · ') || 'aucun'}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                    {film.scenes.length} scenes, {montage ? `${montage.segments.length} plans, ${montage.dureeS.toFixed(1)} s` : 'montage a composer'}
                  </p>
                  <p className="flex items-center gap-2 text-sm text-slate-300">
                    {mediasGeneres > 0
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                      : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />}
                    {mediasGeneres > 0 ? tUi('mediasgeneres_media_s_sur_vos_plans', { mediasGeneres }) : tUi('aucun_media_genere_pour_ce_film')}
                  </p>
                </div>

                {fidelite.ecarts.length > 0 && (
                  <section className={`mt-4 rounded-lg border p-4 ${bloquants.length > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900/40'}`} data-fidelite="ecarts">
                    <h3 className={`mb-2 flex items-center gap-2 text-sm font-semibold ${bloquants.length > 0 ? 'text-amber-200' : 'text-slate-200'}`}>
                      {bloquants.length > 0 ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />}
                      {bloquants.length > 0
                        ? `${bloquants.length} point${bloquants.length > 1 ? 's' : ''} à vérifier dans ton histoire avant toute génération payante`
                        : `${fidelite.ecarts.length} remarque${fidelite.ecarts.length > 1 ? 's' : ''}, rien ne bloque`}
                    </h3>
<ul className="space-y-2.5" data-ecarts-liste>
                      {fidelite.ecarts.filter((e) => e.critique).map((e) => carteEcart(e))}
                    </ul>
                    {fidelite.ecarts.some((e) => !e.critique) && (
                      <details className="mt-2 text-[11px] text-slate-400" data-fidelite="remarques">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-slate-200">
                          <Info className="h-3 w-3" aria-hidden="true" /> {fidelite.ecarts.filter((e) => !e.critique).length} {tUi('remarque_s_qui_ne_bloquent_rien_plan_d')}
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {fidelite.ecarts.filter((e) => !e.critique).map((e) => (
                            <li key={e.cle} className="leading-snug">{e.detail}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <p className="mt-2 text-[11px] text-slate-400">
                      {tUi('votre_texte_n_est_jamais_modifie_corri')}
                    </p>
                  </section>
                )}

                {(() => {
                  const mode = film.modeAudio ?? null;
                  const problemes = diagnosticAudio(film as never);
                  const plansFilm = film.scenes.flatMap((sc) => sc.plans);
                  return (
                    <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4" data-reglage="mode-audio">
                      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <Mic className="h-4 w-4 text-violet-300" aria-hidden="true" /> {tUi('comment_ton_film_est_raconte')}
                      </h3>
                      <p className="text-xs text-slate-300" data-mode-actuel>
                        {mode
                          ? `${LIBELLES_MODE[mode].titre} — ${LIBELLES_MODE[mode].phrase}`
                          : tUi('ancien_reglage_le_recit_et_les_repliqu')}
                      </p>
                      <div role="radiogroup" aria-label={tUi('changer_le_mode_audio')} className="mt-2 flex flex-wrap gap-2">
                        {(['personnages', 'narrateur'] as const).map((m) => (
                          <button key={m} type="button" role="radio" aria-checked={mode === m}
                            onClick={() => { if (mode !== m) void enregistrer({ modeAudio: m }); }}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs ${mode === m ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500/40'}`}>
                            {LIBELLES_MODE[m].titre}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500">{tUi('changer_de_mode_ne_touche_ni_ton_histo')}</p>
                      {mode === 'personnages' && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-400" data-limite-labiale>
                          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          {tUi('les_personnages_parlent_avec_leur_voix')}
                        </p>
                      )}
                      {problemes.length > 0 && (
                        <ul className="mt-3 space-y-2" data-problemes-audio>
                          {problemes.map((pb) => (
                            <li key={pb.code} className="space-y-1 text-[11px] leading-snug text-amber-200/90" data-probleme-audio={pb.code}>
                              <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {pb.message}</p>
                              <p className="pl-[18px] text-slate-300">{tUi('pour_le_regler_conseil', { conseil: pb.conseil })}</p>
                              {pb.planIds?.map((id) => {
                                const pl = plansFilm.find((x) => x.id === id);
                                return pl ? (
                                  <div key={id} className="flex flex-wrap items-center gap-2 pl-[18px] text-slate-300">
                                    <span className="italic">« {pl.dialogue?.texte} »</span> {choixLocuteur(id)}
                                  </div>
                                ) : null;
                              })}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })()}

                {!film.modeAudio && (() => {
                  const nbRecit = film.scenes.reduce((n, sc) => n + sc.plans.filter((pl) => pl.dialogue?.genre === 'narration').length, 0);
                  const avec = film.narration !== false;
                  return (
                    <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4" data-reglage="narration">
                      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <Mic className="h-4 w-4 text-violet-300" aria-hidden="true" /> Narration
                        <span title={tUi('les_phrases_de_recit_sans_guillemets_s')} className="text-slate-500">
                          <Info className="h-3.5 w-3.5" aria-label={tUi('les_repliques_des_personnages_restent')} />
                        </span>
                      </h3>
                      <div role="group" aria-label={tUi('narration_du_film')} className="flex items-center gap-2">
                        <button type="button" aria-pressed={avec} onClick={() => !avec && enregistrer({ narration: true })}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${avec ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500/40'}`}>
                          <Mic className="h-3.5 w-3.5" aria-hidden="true" /> {tUi('avec_narration')}
                        </button>
                        <button type="button" aria-pressed={!avec} onClick={() => avec && enregistrer({ narration: false })}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${!avec ? 'border-violet-500/70 bg-violet-500/15 text-violet-100' : 'border-slate-700 text-slate-300 hover:border-violet-500/40'}`}>
                          <MicOff className="h-3.5 w-3.5" aria-hidden="true" /> Sans narration
                        </button>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-400">
                        {nbRecit === 0
                          ? tUi('votre_histoire_n_a_aucune_phrase_de_re')
                          : avec
                            ? `${nbRecit} phrase(s) de recit sont lues en narration ; les repliques des personnages sont lues a part.`
                            : `${nbRecit} phrase(s) de recit restent affichees mais ne sont pas lues ; les repliques des personnages restent lues.`}
                      </p>
                    </section>
                  );
                })()}

                <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Shield className="h-4 w-4 text-violet-300" aria-hidden="true" /> Cout annonce avant toute creation
                  </h3>
                  <p className="text-xs text-slate-400">
                    {devis
                      ? (devis.totalUsd === null ? tUi('cout_inconnu_tarif_non_declare_rien_ne')
                        : devis.totalUsd === 0 ? `Gratuit (rendu local) pour ${devis.secondesAProduire.toFixed(1)} s a produire.`
                        : `${devis.totalUsd.toFixed(4)} USD pour ${devis.secondesAProduire.toFixed(1)} s a produire.`)
                      : tUi('le_devis_s_affiche_des_que_le_scenario')}
                  </p>
                </section>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                {tUi('composez_le_scenario_pour_verifier_la')}
              </p>
            )}
          </div>
        )}

        {etape === 4 && (
          <div>
            <TitreEtape numero={5} total={5} icone={Download} titre="Votre film, pret a partager."
              phrase="Le MP4 se telecharge ici, et nulle part ailleurs : les extraits d’exemple ne sont jamais exportes comme votre film." />
            {film ? (
              <section id="cinema-export" className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 scroll-mt-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2"><Download className="w-4 h-4 text-violet-400" /> Export MP4</h2>
                {devis && (
                  <p className="text-sm text-slate-300 mb-3">
                    Devis : {devis.totalUsd === null ? 'cout inconnu (tarif non declare)' : devis.totalUsd === 0 ? 'gratuit (rendu local)' : `${devis.totalUsd.toFixed(4)} USD`} pour {devis.secondesAProduire.toFixed(1)} s a produire.
                    <Detail texte="Le devis est etabli AVANT le rendu. Une scene inchangee n'est pas refaite : son MP4 est repris tel quel et recolle. Le plafond de depense est fixe par le serveur." />
                  </p>
                )}
                <button onClick={() => produire()} disabled={enCours !== null || ACTIF(travail)} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-50">
                  {enCours === 'lancement' || ACTIF(travail) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {ACTIF(travail) ? 'Production en cours' : tUi('exporter_le_film')}
                </button>
                {travail && film && <Production film={film} travail={travail} surArreter={arreterProduction} />}
              </section>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                {tUi('composez_d_abord_le_scenario_l_export')}
              </p>
            )}
          </div>
        )}
      </WizardCinema>
      {donneesDialogueIA && confirmation && (
        <DialogueGenerationIA
          donnees={donneesDialogueIA}
          enCours={enCours === `generation:${confirmation.planId}:${confirmation.operation}`}
          erreur={erreur}
          surConfirmer={confirmerDialogueIA}
          surAnnuler={() => setConfirmation(null)}
        />
      )}
    </div>
  );
}

/**
 * PRODUCTION — l'etat REEL d'un travail en arriere-plan.
 *
 * Tout ici vient de la ligne du travail (pourcentage, scenes, message) ; rien
 * n'est anime pour faire patienter. L'erreur et sa reference restent
 * visibles : on ne masque jamais un echec pour epurer. Arreter est une
 * action secondaire : une icone, avec son libelle accessible.
 */
const ETAPES_LIBELLE: Record<string, string> = {
  preparation: 'Preparation', voix: 'Voix des repliques', rendu: 'Rendu des scenes', assemblage: 'Assemblage', termine: 'Termine',
};

function Production({ film, travail, surArreter }: { film: FilmApi; travail: TravailApi; surArreter: () => void }) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const actif = ACTIF(travail);
  const pct = Math.max(0, Math.min(100, travail.progression.pourcent));
  const urlMp4 = `/api/cinema/films/${film.id}/travaux/${travail.id}/export`;
  const r = travail.resultat;

  return (
    <div className="mt-5" data-testid="production">
      {actif && (
        <div>
          <div className="flex items-center gap-3 text-sm text-slate-300">
            <span>{travail.progression.message ?? ETAPES_LIBELLE[travail.progression.etape] ?? travail.progression.etape}</span>
            <span className="tabular-nums text-slate-400">{pct} %</span>
            <button
              type="button"
              onClick={surArreter}
              disabled={travail.annulationDemandee}
              aria-label={tUi('arreter_la_production')}
              title={travail.annulationDemandee ? 'Arret demande' : tUi('arreter_la_production')}
              className="ml-auto rounded p-1.5 text-slate-500 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            role="progressbar" aria-label={tUi('progression_de_la_production')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
          >
            <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label={tUi('etat_des_scenes')}>
            {film.scenes.map((sc) => {
              const etat = travail.progression.scenes[sc.id] ?? 'a_faire';
              const fait = etat === 'faite' || etat === 'reutilisee';
              return (
                <li
                  key={sc.id}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${fait ? 'border-emerald-500/40 text-emerald-200' : etat === 'en_cours' ? 'border-violet-500/50 text-violet-200' : 'border-slate-700 text-slate-500'}`}
                >
                  {fait ? <Check className="w-3 h-3" /> : etat === 'en_cours' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3" />}
                  <span>Scene {sc.index + 1}</span>
                  <span className="sr-only">{etat === 'reutilisee' ? tUi('reprise_du_stockage') : etat === 'faite' ? 'rendue' : etat === 'en_cours' ? 'en cours' : 'en attente'}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            {tUi('la_production_continue_sur_le_serveur')}
            <Detail texte="Les scenes terminees sont conservees. Si le serveur redemarre, la production reprend la ou elle s'est arretee, sans refaire les scenes deja rendues." />
          </p>
        </div>
      )}

      {travail.statut === 'echec' && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            {travail.erreur ?? tUi('la_production_a_echoue')}
            <Detail texte="Les scenes deja rendues sont conservees : relancer l'export ne refait que ce qui manque." />
          </span>
        </div>
      )}

      {travail.statut === 'annule' && (
        <p className="text-sm text-amber-300">
          {tUi('production_arretee_les_scenes_deja_ren')}
        </p>
      )}

      {travail.statut === 'termine' && r && (
        <div>
          <p className="text-sm text-slate-300">
            {r.dureeS?.toFixed(1)} s · {r.largeur}x{r.hauteur} · {r.codecVideo}/{r.codecAudio ?? 'sans audio'} · {((r.octets ?? 0) / 1_000_000).toFixed(2)} Mo
            <Detail texte={`${r.scenesRendues.length} scene(s) rendue(s), ${r.scenesReutilisees.length} reprise(s) du stockage. Cout : ${r.coutUsd === 0 ? 'gratuit (rendu local)' : `${r.coutUsd.toFixed(4)} USD`}.`} />
          </p>
          {r.aMp4 && (
            <>
              <video src={urlMp4} controls className="mt-3 w-full rounded-lg border border-slate-800" style={{ maxHeight: 480 }} />
              <a href={urlMp4} download={`${film.titre || film.id}.mp4`} className="mt-3 inline-flex items-center gap-2 text-sm text-violet-300 hover:text-violet-200">
                <Download className="w-4 h-4" /> {tUi('telecharger_le_mp4')}
              </a>
            </>
          )}
          {r.avertissements.length > 0 && (
            <ul className="mt-3 text-xs text-amber-300 space-y-1">
              {r.avertissements.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * SUIVI D'UNE GENERATION IA, plan par plan — l'etat vient du SERVEUR (le film).
 * « En cours » et « echouee » ne se confondent jamais, et l'argent est dit tel quel.
 */
function SuiviGenerationPlan({ generation, confirmation, prix, surConfirmer, surAnnuler }: {
  generation: GenerationApi | null;
  confirmation: 'image' | 'video' | null;
  prix: string;
  surConfirmer: () => void;
  surAnnuler: () => void;
}) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const enCours = generation?.statut === 'en_cours';
  // Un compteur d'une seconde, et SEULEMENT pendant une generation en cours.
  useEffect(() => {
    if (!enCours) return;
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enCours]);

  if (confirmation) {
    return (
      <span className="inline-flex items-center gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-100" role="group" aria-label={tUi('confirmer_la_generation_payante')}>
        {confirmation === 'video' ? tUi('animer_ce_plan_en_video') : tUi('generer_cette_image')} · {prix}
        <button type="button" onClick={surConfirmer} data-cinema-confirmer className="inline-flex items-center gap-1 rounded bg-amber-500/80 px-2 py-0.5 text-slate-950 font-semibold hover:bg-amber-400">
          <Check className="w-3 h-3" /> Confirmer
        </button>
        <button type="button" onClick={surAnnuler} aria-label={tUi('annuler')} className="p-0.5 rounded hover:bg-slate-700"><X className="w-3 h-3" /></button>
      </span>
    );
  }
  if (!generation) return null;
  const operation = generation.operation === 'video' ? 'video' : 'image';
  if (enCours) {
    const ecoule = Math.max(0, Math.round((maintenant - Date.parse(generation.creeLe)) / 1000));
    return (
      <span className="inline-flex items-center gap-1 rounded border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-violet-200" data-cinema-generation-statut="en_cours">
        <Loader2 className="w-3 h-3 animate-spin" /> Generation {operation} en cours · {ecoule} s
        {operation === 'video' && <span className="text-violet-300/70">{tUi('1_a_plusieurs_minutes_vous_pouvez_quit')}</span>}
      </span>
    );
  }
  if (generation.statut === 'echouee' || generation.statut === 'interrompue') {
    const argent = (generation.creditsPris ?? 0) > 0
      ? ` — ${generation.creditsPris} credit(s) ${generation.creditsRembourses ? 'rembourses' : generation.creditsRembourses === false ? 'NON rembourses : verifiez le solde' : 'en cours de remboursement'}`
      : '';
    return (
      <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200" data-cinema-generation-statut={generation.statut}>
        <AlertTriangle className="w-3 h-3" />
        {generation.statut === 'interrompue' ? 'Generation interrompue' : 'Generation echouee'} ({operation}) : {generation.erreur ?? 'raison inconnue'}{argent}
      </span>
    );
  }
  return null;
}

/**
 * APERÇU — la MEME chronologie que le MP4, jouee dans le navigateur.
 *
 * Le temps avance par `requestAnimationFrame` et non par un `setInterval` :
 * un intervalle derive et l'aperçu finirait decale de la bande son. Les voix
 * deja synthetisees sont jouees a leur segment, chacune depuis son debut.
 */
/**
 * APERCU VIDE — avant que le scenario soit compose.
 *
 * ⚠️ LE BOUTON D'AGRANDISSEMENT RESTE VISIBLE, desactive. L'ancien repli n'etait qu'un
 * texte : le bouton n'existait que dans `Apercu`, donc rien n'indiquait qu'un aperçu
 * agrandi existe. Il est ici au MEME endroit (haut droit) et au MEME gabarit qu'une fois
 * le montage pret — le cadre ne « saute » pas quand le scenario arrive. Le cadre suit le
 * format choisi (`ratioCadre`, style en ligne : les classes arbitraires sont purgees en
 * production).
 */
function ApercuVide({ format }: { format: string }) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const infobulle = 'L’apercu agrandi sera disponible une fois le scenario compose';
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Play className="w-4 h-4 text-violet-400" /> Apercu permanent
      </h2>
      {/* La hauteur suit le CONTENU : un cadre vide n'a pas a occuper un ecran de film. */}
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border border-dashed border-slate-700 px-6 py-8"
        style={{
          maxWidth: 640,
          background: 'radial-gradient(120% 100% at 25% 15%, rgba(124,58,237,0.18) 0%, rgba(15,23,42,0.6) 55%, #0A0A0F 100%)',
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10">
            <Film className="w-5 h-5 text-violet-300" />
          </span>
          <p className="text-sm font-medium text-slate-200">{tUi('votre_film_apparaitra_ici')}</p>
          <p className="text-xs text-slate-400">{tUi('ecrivez_l_histoire_puis_composez_le_sc')}</p>
          <p className="text-[11px] text-slate-500">{tUi('format_en_attendant_choisissez_un_styl', { format })}</p>
        </div>
        {/* Meme position, meme taille que le bouton actif de `Apercu` ; `aria-disabled` +
            infobulle plutot que `disabled` seul : il reste focusable et s'explique. */}
        <button
          type="button"
          aria-disabled="true"
          aria-label={infobulle}
          title={infobulle}
          onClick={(e) => e.preventDefault()}
          className="absolute top-3 right-3 inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-lg border border-slate-700/70 bg-slate-950/70 text-slate-400"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}

/**
 * LE CADRE DE L'APERCU — UN SEUL rendu, utilise tel quel en ligne et en plein ecran.
 *
 * ⚠️ IL N'Y A PAS DE SECOND MOTEUR D'APERCU. La chronologie (`tempsS`), la lecture, la
 * voix et le segment courant vivent UNIQUEMENT dans `Apercu` : ce composant ne fait que
 * DESSINER l'etat qu'on lui donne. Agrandir ne demarre donc rien, ne recalcule rien et ne
 * remet rien a zero — c'est le meme aperçu, plus grand.
 *
 * Le format est tenu par `aspectRatio` (helper canonique `ratioCadre`, comme « Mon
 * avatar ») dans les deux tailles : un 9:16 reste un 9:16 agrandi, jamais etire.
 */
function CadreMontage({ montage, segment, tempsS, taille, joue, son, children }: {
  montage: MontageApi; segment: SegmentApi; tempsS: number;
  taille: 'ligne' | 'immersif'; joue: boolean; son: boolean; children?: React.ReactNode;
}) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const portrait = montage.hauteur > montage.largeur;
  const immersif = taille === 'immersif';
  // Fond SOMBRE et neutre : le degrade violet de la « carte de plan » imitait une video. Le
  // contenu vient du media reel ; sans media, c'est un emplacement de storyboard vide.
  const fond = '#05060a';
  const ratio = ratioCadre(portrait ? '9:16' : '16:9');

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-800 ${immersif ? 'mx-auto' : 'mx-auto w-full'}`}
      style={immersif
        // Les deux bornes (`maxWidth`/`maxHeight`) plus le ratio suffisent a tenir dans
        // n'importe quel ecran, telephone compris, sans jamais deformer l'image : c'est la
        // dimension la plus contraignante qui gagne.
        ? {
          aspectRatio: ratio,
          width: portrait ? 'auto' : 'min(96vw, 1400px)',
          height: portrait ? 'min(80vh, 1100px)' : 'auto',
          maxWidth: '96vw',
          maxHeight: '80vh',
          background: fond,
        }
        // Largeur responsive : une largeur fixe en pixels debordait sur tout viewport plus
        // etroit que 640px (mobile, colonne de droite en 380px) — `max-width` +
        // `aspect-ratio` gardent les memes proportions tout en retrecissant avec le
        // conteneur. `minHeight` : le texte superpose (titre scene + dialogue centre) est
        // en taille FIXE, pas proportionnelle a la largeur — en dessous de cette hauteur
        // les deux blocs se chevauchent.
        : {
          maxWidth: portrait ? 270 : 640,
          aspectRatio: ratio,
          minHeight: portrait ? 320 : 200,
          background: fond,
        }}
    >
      {/* Le media REEL du plan, cadre comme au rendu (cover, sans etirement), cale sur la
          chronologie. Sans media : un emplacement de storyboard, jamais une fausse video. */}
      {segment.media
        ? <MediaDuPlan segment={segment} tempsS={tempsS} joue={joue} son={son} />
        : <EmplacementVide segment={segment} grand={immersif} />}
      {/* Degrade bas seulement, pour la lisibilite de la legende. */}
      <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: 'linear-gradient(180deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.78) 100%)' }} />
      <div className="absolute top-3 left-3 right-14 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded bg-slate-950/70 px-1.5 py-0.5 font-semibold tracking-wider text-slate-200">SCENE {segment.sceneIndex + 1}</span>
        {segment.demo && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">{tUi('demonstration_clip_d_exemple')}</span>}
        {!segment.media && <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-300">{tUi('previsualisation')}</span>}
      </div>
      {/* Legende du plan (ce qui est dit ou montre) : une ligne discrete, pas un bloc central. */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-center">
        {segment.locuteur && (
          <span className="mr-2 inline-block rounded-full bg-pink-500 px-2 py-0.5 text-[10px] font-bold tracking-widest text-slate-950 align-middle">{segment.locuteur.toUpperCase()}</span>
        )}
        <span className={`${immersif ? 'text-lg' : 'text-xs'} font-semibold leading-snug align-middle`} style={{ textShadow: '0 2px 12px rgba(0,0,0,0.85)' }}>{segment.texte}</span>
      </div>
      {/* Le bouton d'agrandissement (ou de retour) est pose PAR L'APPELANT, dans le coin
          haut droit : c'est la seule difference d'habillage entre les deux tailles. */}
      {children}
    </div>
  );
}

/** Les MEMES commandes de lecture dans les deux tailles — jamais un second jeu de boutons. */
function CommandesMontage({ montage, joue, tempsS, surBasculerLecture, surDeplacer, surPreparerVoix, voixEnCours, aDuSon, son, surBasculerSon }: {
  montage: MontageApi; joue: boolean; tempsS: number;
  surBasculerLecture: () => void; surDeplacer: (t: number) => void;
  surPreparerVoix?: () => void; voixEnCours?: boolean;
  /** Au moins un plan garde le son de son media : on propose de le couper. */
  aDuSon?: boolean; son?: boolean; surBasculerSon?: () => void;
}) {
  const tUi = useTranslations('ui.appDashboardCinema');
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button onClick={surBasculerLecture} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
        {joue ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {joue ? 'Pause' : tUi('lire_le_montage')}
      </button>
      <input
        type="range" min={0} max={montage.dureeS} step={0.1} value={tempsS}
        onChange={(e) => surDeplacer(Number(e.target.value))}
        aria-label={tUi('position_dans_le_montage')}
        className="flex-1 min-w-[120px] accent-violet-500"
      />
      <span className="text-[11px] tabular-nums text-slate-400">{tempsS.toFixed(1)} / {montage.dureeS.toFixed(1)} s</span>
      {aDuSon && surBasculerSon && (
        <button
          type="button" onClick={surBasculerSon} aria-pressed={!son}
          aria-label={son ? tUi('couper_le_son') : tUi('activer_le_son')} title={son ? tUi('couper_le_son') : tUi('activer_le_son')}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:border-violet-500/50"
        >
          {son ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      )}
      {surPreparerVoix && !montage.segments.some((s) => s.voixUrl) && (
        <button onClick={surPreparerVoix} disabled={voixEnCours} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50 disabled:opacity-50">
          {voixEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {tUi('preparer_les_voix')}
        </button>
      )}
    </div>
  );
}

function Apercu({ montage, surPreparerVoix, voixEnCours }: { montage: MontageApi; surPreparerVoix: () => void; voixEnCours: boolean }) {
  const tUi = useTranslations('ui.appDashboardCinema');
  const [tempsS, setTempsS] = useState(0);
  const [joue, setJoue] = useState(false);
  /** Aperçu agrandi. Un simple affichage : la lecture et le temps ne bougent pas. */
  const [plein, setPlein] = useState(false);
  const debutRef = useRef<number>(0);
  const trameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const agrandirRef = useRef<HTMLButtonElement | null>(null);
  const reduireRef = useRef<HTMLButtonElement | null>(null);

  /** Mode demonstration (gratuit) : des clips d'exemple a la place des medias MANQUANTS, a l'ecran seulement. */
  const [demo, setDemo] = useState(false);
  const [son, setSon] = useState(true);
  /** Le bilan se fait sur les medias REELS du film, jamais sur ceux de la demonstration. */
  const bilan = useMemo(() => bilanMedias(montage.segments), [montage.segments]);
  const segments = useMemo(() => appliquerDemo(montage.segments, demo), [montage.segments, demo]);
  const aDuSon = segments.some((s) => s.media?.genre === 'video' && s.media.sonActif);
  const segment = useMemo(
    () => segments.find((s) => tempsS >= s.debutS && tempsS < s.finS) ?? segments[0],
    [segments, tempsS],
  );

  useEffect(() => {
    if (!joue) {
      if (trameRef.current) cancelAnimationFrame(trameRef.current);
      return;
    }
    debutRef.current = performance.now() - tempsS * 1000;
    const avancer = () => {
      const t = (performance.now() - debutRef.current) / 1000;
      if (t >= montage.dureeS) { setTempsS(0); setJoue(false); return; }
      setTempsS(t);
      trameRef.current = requestAnimationFrame(avancer);
    };
    trameRef.current = requestAnimationFrame(avancer);
    return () => { if (trameRef.current) cancelAnimationFrame(trameRef.current); };
    // `tempsS` volontairement absent : il est relu au demarrage, pas a chaque trame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joue, montage.dureeS]);

  // La voix du segment courant, relancee a chaque changement de plan.
  useEffect(() => {
    if (!joue || !segment?.voixUrl) return;
    const audio = new Audio(segment.voixUrl.startsWith('/') ? segment.voixUrl : `/${segment.voixUrl}`);
    audioRef.current?.pause();
    audioRef.current = audio;
    audio.play().catch(() => { /* un navigateur peut refuser la lecture : l'image continue */ });
    return () => { audio.pause(); };
  }, [joue, segment?.planId, segment?.voixUrl]);

  /**
   * ⚠️ FERMETURE PAR ECHAP, ET LE FOCUS QUI REVIENT D'OU IL VIENT.
   *
   * Le defilement de la page est bloque pendant l'agrandissement (sinon la page continue
   * de defiler derriere l'aperçu), et la valeur PRECEDENTE est restituee a la fermeture —
   * jamais remise a une valeur devinee. Le focus part sur le bouton de retour a
   * l'ouverture, et revient sur le bouton d'agrandissement a la fermeture : au clavier,
   * on ne se retrouve jamais perdu en haut du document.
   */
  const fermerPlein = useCallback(() => {
    setPlein(false);
    agrandirRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!plein) return;
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') fermerPlein(); };
    document.addEventListener('keydown', surTouche);
    const defilementPrecedent = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    reduireRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', surTouche);
      document.body.style.overflow = defilementPrecedent;
    };
  }, [plein, fermerPlein]);

  if (!segment) return null;
  /** Meme lecture que dans le cadre : le format vient du montage, jamais d'un reglage d'ecran. */
  const portrait = montage.hauteur > montage.largeur;

  return (
    <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="font-semibold mb-1 flex items-center gap-2">
        <Play className="w-4 h-4 text-violet-400" /> {bilan.aucun && !demo ? tUi('previsualisation_du_scenario') : 'Apercu permanent'}
        <Detail texte="Meme chronologie que le MP4 : les debuts et durees viennent du montage renvoye par l'API. Un plan sans media est un emplacement de storyboard, pas une video." />
      </h2>
      <p className="mb-3 text-xs text-slate-400" data-apercu="bilan">
        {bilan.aucun
          ? tUi('aucune_image_ni_video_pour_l_instant_c')
          : bilan.manquants > 0
            ? `${bilan.avecMedia} plan${bilan.avecMedia > 1 ? 's' : ''} sur ${bilan.total} avec média · ${bilan.manquants} manquant${bilan.manquants > 1 ? 's' : ''}.`
            : tUi('total_plans_avec_media_vous_voyez_les', { total: bilan.total })}
      </p>

      <CadreMontage montage={montage} segment={segment} tempsS={tempsS} taille="ligne" joue={joue} son={son}>
        <button
          ref={agrandirRef}
          type="button"
          onClick={() => setPlein(true)}
          aria-label="Agrandir l’apercu"
          title="Agrandir l’apercu"
          className="absolute top-3 right-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-600/80 bg-slate-950/75 text-white shadow-lg backdrop-blur-sm transition-colors hover:border-violet-500/60 hover:text-violet-200"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </CadreMontage>

      <CommandesMontage
        montage={montage} joue={joue} tempsS={tempsS}
        surBasculerLecture={() => setJoue((v) => !v)}
        surDeplacer={setTempsS}
        surPreparerVoix={surPreparerVoix}
        voixEnCours={voixEnCours}
        aDuSon={aDuSon} son={son} surBasculerSon={() => setSon((v) => !v)}
      />

      <Storyboard
        segments={segments} courantId={segment.planId} portrait={portrait}
        surChoisir={(s) => { setTempsS(s.debutS); }}
      />

      {bilan.manquants > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button" onClick={() => setDemo((v) => !v)} aria-pressed={demo}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${demo ? 'border-amber-500/50 bg-amber-500/10 text-amber-200' : 'border-slate-700 text-slate-300 hover:border-violet-500/50'}`}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            {demo ? tUi('quitter_la_demonstration') : tUi('mode_demonstration_gratuit')}
          </button>
          <Detail texte="Remplace, a l'ecran seulement, les medias manquants par des clips d'exemple locaux pour montrer le rendu d'un vrai montage. Rien n'est enregistre, rien n'est genere, aucun cout : ce ne sont pas des videos de votre film." />
        </div>
      )}

      {/* APERÇU AGRANDI — le meme cadre, les memes commandes, le meme etat de lecture.
          Il reste dans CET arbre React (donc aucune donnee saisie ailleurs n'est remontee
          ni remise a zero), mais il est rendu dans `document.body` par un PORTAIL.
          ⚠️ POURQUOI UN PORTAIL, ET PAS SEULEMENT UN `z-index` PLUS GRAND (mesure le
          2026-10-28, Playwright) : la colonne de droite est `lg:sticky`, et un element
          `position: sticky` cree TOUJOURS un contexte d'empilement. Tout ce qu'il
          contient est donc plafonne a l'interieur, et la barre laterale (`z-50`,
          `components/layout/Sidebar.tsx`) passait PAR-DESSUS la fenetre : l'aperçu
          « immersif » s'arretait au bord du contenu. Monter le `z-index` a l'interieur ne
          pouvait rien y changer ; sortir du contexte, si.
          `zIndex` en style en ligne et non en classe Tailwind arbitraire : les classes
          arbitraires sont purgees en production (piege connu, CLAUDE.md). */}
      {plein && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tUi('apercu_agrandi_du_montage')}
          className="fixed inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/95 p-3 sm:p-6"
          style={{ zIndex: 60 }}
          onClick={(e) => { if (e.target === e.currentTarget) fermerPlein(); }}
        >
          <CadreMontage montage={montage} segment={segment} tempsS={tempsS} taille="immersif" joue={joue} son={son}>
            <button
              ref={reduireRef}
              type="button"
              onClick={fermerPlein}
              aria-label="Reduire l’apercu (Echap)"
              title="Reduire l’apercu (Echap)"
              className="absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-950/60 text-slate-200 backdrop-blur-sm transition-colors hover:border-violet-500/60 hover:text-violet-200"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          </CadreMontage>

          {/* Les commandes s'alignent sur la LARGEUR DU CADRE, pas sur l'ecran : en 9:16,
              une barre de 1400px sous une image de 450px donnait deux objets sans rapport.
              Style en ligne et non classe Tailwind arbitraire (`max-w-[...]`) : les classes
              arbitraires sont purgees en production (piege connu, CLAUDE.md). */}
          <div className="w-full" style={{ maxWidth: portrait ? 'min(45vh, 96vw)' : 'min(96vw, 1400px)' }}>
            <CommandesMontage
              montage={montage} joue={joue} tempsS={tempsS}
              surBasculerLecture={() => setJoue((v) => !v)}
              surDeplacer={setTempsS}
              aDuSon={aDuSon} son={son} surBasculerSon={() => setSon((v) => !v)}
            />
            <p className="mt-2 text-center text-[11px] text-slate-500">{tUi('echap_pour_revenir')}</p>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

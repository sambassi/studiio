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
  ImageIcon, Film, Volume2, VolumeX, Upload, Sparkles, X, Check, Circle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Maximize2, Minimize2, Eye, Shield,
} from 'lucide-react';
import { useTarifs, libellePrix, type TarifsEcran } from '@/lib/tarifs/client';
import { ratioCadre } from '@/lib/ui/lecteur-generation';
import QuotaCinema from '@/components/cinema/QuotaCinema';
import { SelecteurStyleFilm, SelecteurStyleScene, SelecteurCamera, ResumeStyle, PlanAregenerer } from '@/components/cinema/DirectionCinema';
import { cameraEffective } from '@/lib/cinema/direction/camera';
import { plansARegenerer } from '@/lib/cinema/direction/signature';
import type { IdCameraCinema, IdStyleCinema } from '@/lib/cinema/types';
import ModelesFilm, { type ModeleFilm } from '@/components/cinema/ModelesFilm';
import AideRedaction from '@/components/cinema/AideRedaction';
import ApercuExemple, { FenetreExemple, type Exemple } from '@/components/cinema/ApercuExemple';
import WizardCinema, { TitreEtape, type EtapeWizard } from '@/components/cinema/WizardCinema';
import { auditFidelite, ecartsScene, phrasesDeLaScene, resumeFidelite } from '@/lib/cinema/fidelite';
import ChoixMouvements from '@/components/cinema/ChoixMouvements';
import { MediaDuPlan, EmplacementVide, Storyboard, appliquerDemo, bilanMedias } from '@/components/cinema/ApercuStoryboard';

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
interface MediaApi { url: string; genre: 'image' | 'video'; largeur: number; hauteur: number; dureeS: number | null; octets: number; origine: string; sonActif?: boolean; direction?: string }
interface MontageApi { filmId: string; titre: string; format: string; largeur: number; hauteur: number; fps: number; segments: SegmentApi[]; dureeS: number }
interface PlanApi { id: string; cadre: string; description: string; personnages: string[]; dialogue: { personnageId: string | null; texte: string } | null; dureeS: number; media: MediaApi | null; camera?: IdCameraCinema }
interface SceneApi { id: string; index: number; titre: string; lieu: string; intention: string; personnages: string[]; plans: PlanApi[]; etat: string; coutUsd: number; styleCinema?: IdStyleCinema }
interface PersonnageApi { id: string; nom: string; role: string; voix: string; references: Array<{ id: string; version: number; description: string }>; referenceActiveId: string | null }
interface GenerationApi {
  id: string; planId: string; operation: 'image' | 'video'; mode: 'reelle' | 'simulee';
  statut: 'en_cours' | 'reussie' | 'echouee' | 'interrompue'; creeLe: string; majLe: string;
  erreur?: string | null; creditsPris?: number; creditsRembourses?: boolean;
}
interface FilmApi { id: string; titre: string; histoire?: string; format: string; qualite: string; personnages: PersonnageApi[]; scenes: SceneApi[]; generations?: GenerationApi[]; styleCinema?: IdStyleCinema; directionActive?: boolean }
/** La generation active du film (une seule a la fois, decide par le serveur). */
const generationActiveDe = (f: FilmApi | null) => f?.generations?.find((g) => g.statut === 'en_cours') ?? null;
/** La derniere generation d'un plan, quelle qu'en soit l'issue. */
const derniereGenerationDuPlan = (f: FilmApi | null, planId: string) =>
  [...(f?.generations ?? [])].reverse().find((g) => g.planId === planId) ?? null;
/** Les medias sont stockes en chemin relatif : meme regle de normalisation partout (voir `Apercu`). */
/** Le plan « representatif » d'une scene pour la vignette et le panneau de droite : celui qui a deja un media, sinon le premier. Une scene a plusieurs plans ; l'ecran n'en resume qu'un seul media, comme la maquette. */
const planRepresentatifDeScene = (scene: SceneApi) => scene.plans.find((p) => p.media) ?? scene.plans[0] ?? null;
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
  const [ouvert, setOuvert] = useState(false);
  return (
    <span className="inline-flex items-center align-middle">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-label="Afficher le detail"
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

/**
 * PANNEAU REPLIABLE — numerote, colonne de gauche. Ouvert par defaut (rien de
 * nouveau n'est cache au chargement), repliable au clic pour l'ecran epure.
 */
function VignetteMedia({ media, filmId, planId, taille }: { media: MediaApi | null; filmId: string; planId: string; taille: 'petite' | 'grande' }) {
  const classe = taille === 'petite' ? 'w-16 h-16' : 'w-full h-40';
  if (!media) {
    return (
      <span className={`${classe} flex shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-600`}>
        <ImageIcon className="w-5 h-5" />
      </span>
    );
  }
  const url = `/api/cinema/films/${filmId}/medias/${planId}`;
  return media.genre === 'image' ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className={`${classe} shrink-0 rounded-lg object-cover`} />
  ) : (
    <video src={url} className={`${classe} shrink-0 rounded-lg object-cover`} muted playsInline preload="metadata" />
  );
}

/**
 * CARROUSEL DE SCENES — colonne de droite. Navigation de confort (scroll vers
 * la scene dans la liste de gauche) : aucune donnee n'est dupliquee ni
 * mutee ici, la liste de gauche reste la seule source d'edition.
 *
 * Le bloc « details de la scene » (media, etat de generation, actions) agit sur le
 * plan REPRESENTATIF de la scene (`planRepresentatifDeScene`) : une scene a plusieurs
 * plans dans le modele actuel, cet ecran compact n'en resume qu'un seul, comme la
 * maquette. L'edition complete, plan par plan, reste dans le panneau 4 a gauche.
 */
function SceneCarousel({
  film, surRelancer, enCours, travailActif,
  generationIa, generationMode, tarifs, enCoursTexte,
  confirmation, surGenererMedia, surImporterMedia,
}: {
  film: FilmApi; surRelancer: (sceneId: string) => void; enCours: boolean; travailActif: boolean;
  generationIa: boolean; generationMode: 'simulee' | 'reelle' | null; tarifs: TarifsEcran; enCoursTexte: string | null;
  confirmation: { planId: string; operation: 'image' | 'video' } | null;
  surGenererMedia: (planId: string, operation: 'image' | 'video') => void;
  surImporterMedia: (planId: string, fichier: File) => void;
}) {
  const [index, setIndex] = useState(0);
  const scenes = film.scenes;
  const i = Math.min(index, Math.max(0, scenes.length - 1));
  const scene = scenes[i];
  if (!scene) return null;
  const plan = planRepresentatifDeScene(scene);

  const allerA = (k: number) => {
    const cible = scenes[k];
    if (!cible) return;
    setIndex(k);
    document.getElementById(`scene-cinema-${cible.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Scenes ({scenes.length})</h3>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Choisir une scene">
        {scenes.map((s, k) => {
          const planVignette = planRepresentatifDeScene(s);
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={k === i}
              onClick={() => allerA(k)}
              title={s.titre}
              className={`relative shrink-0 overflow-hidden rounded-lg border ${k === i ? 'border-violet-500/70 ring-2 ring-violet-500/40' : 'border-slate-700 hover:border-slate-600'}`}
            >
              <VignetteMedia media={planVignette?.media ?? null} filmId={film.id} planId={planVignette?.id ?? ''} taille="petite" />
              <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-center text-[10px] leading-4 text-slate-200">{k + 1}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => allerA(i - 1)}
            disabled={i === 0}
            aria-label="Scene precedente"
            title="Scene precedente"
            className="rounded p-1 text-slate-500 hover:text-violet-300 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="flex-1 text-sm font-semibold truncate">{i + 1}/{scenes.length} · {scene.titre}</span>
          <button
            type="button"
            onClick={() => allerA(i + 1)}
            disabled={i === scenes.length - 1}
            aria-label="Scene suivante"
            title="Scene suivante"
            className="rounded p-1 text-slate-500 hover:text-violet-300 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">{scene.lieu} · {scene.intention}</p>
        {scene.plans[0] && (
          <p className="mt-2 text-xs text-slate-300 line-clamp-2">{scene.plans[0].dialogue?.texte ?? scene.plans[0].description}</p>
        )}

        {/* Details de la scene : le media REEL du plan representatif, son etat de generation reel, et les deux actions distinctes.
            ⚠️ Le suivi INTERACTIF (confirmation payante, « en cours ») reste UNIQUEMENT dans le panneau 4 a
            gauche (`SuiviGenerationPlan`) : deux confirmations actives pour le MEME plan violeraient la regle
            « une seule action principale » et rendaient `findByRole('group', ...)`/`findByText` ambigus (tests
            cinema-page.test.tsx). Ici, uniquement un reflet non-interactif, en texte distinct. */}
        {plan && (
          <div className="mt-3 space-y-2">
            <VignetteMedia media={plan.media} filmId={film.id} planId={plan.id} taille="grande" />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {(() => {
                  const generation = derniereGenerationDuPlan(film, plan.id);
                  const enAttenteConfirmation = confirmation?.planId === plan.id;
                  if (enAttenteConfirmation) return <span className="text-amber-300">confirmation en attente dans le panneau Scenes (a gauche)</span>;
                  if (generation?.statut === 'en_cours') return <span className="inline-flex items-center gap-1 text-violet-300"><Loader2 className="w-3 h-3 animate-spin" /> generation en cours…</span>;
                  if (generation?.statut === 'echouee' || generation?.statut === 'interrompue') return <span className="inline-flex items-center gap-1 text-rose-300"><AlertTriangle className="w-3 h-3" /> derniere generation en echec</span>;
                  return <span>{plan.media ? 'media importe' : 'aucun media pour ce plan'}</span>;
                })()}
              </div>
              <div className="flex flex-wrap gap-2">
                <label
                  title={plan.media ? 'Remplacer le media de ce plan' : 'Importer un media pour ce plan'}
                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs cursor-pointer hover:border-violet-500/50"
                >
                  {enCoursTexte === `media:${plan.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {plan.media ? 'Remplacer' : 'Importer'}
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.m4v"
                    className="hidden"
                    aria-label={plan.media ? 'Remplacer le media de ce plan' : 'Importer un media pour ce plan'}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) surImporterMedia(plan.id, f); e.target.value = ''; }}
                  />
                </label>
                {generationIa && !plan.media && (
                  <button
                    type="button"
                    onClick={() => surGenererMedia(plan.id, 'image')}
                    disabled={enCours || !!generationActiveDe(film)}
                    aria-label="Regenerer l’image de ce plan par IA"
                    title="Regenerer l’image de ce plan par IA"
                    className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 text-xs hover:border-violet-400 disabled:opacity-50"
                  >
                    {enCoursTexte === `generation:${plan.id}:image` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Regenerer (IA)
                    {generationMode === 'reelle' && <span className="text-violet-300/80">· {libellePrix(tarifs, 'ai.generate_background')}</span>}
                  </button>
                )}
                {generationIa && plan.media?.genre === 'image' && (
                  <button
                    type="button"
                    onClick={() => surGenererMedia(plan.id, 'video')}
                    disabled={enCours || !!generationActiveDe(film)}
                    aria-label="Animer ce plan en video par IA"
                    title="Animer ce plan en video par IA"
                    className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 text-xs hover:border-violet-400 disabled:opacity-50"
                  >
                    {enCoursTexte === `generation:${plan.id}:video` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Regenerer en video (IA)
                    {generationMode === 'reelle' && <span className="text-violet-300/80">· {libellePrix(tarifs, 'ai.image_to_video')}</span>}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => surRelancer(scene.id)}
          disabled={enCours || travailActif}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:border-violet-500/50 disabled:opacity-50"
        >
          <RefreshCw className="w-3 h-3" /> Relancer le rendu de la scene affichee
        </button>
      </div>
    </section>
  );
}

export default function CinemaPage() {
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
  const [casting, setCasting] = useState([
    { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge', urlImage: '' },
    { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire', urlImage: '' },
  ]);

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
  /** Plans dont le media genere ne suit plus le style/la camera actuels (le media est conserve). */
  const aRegenerer = new Set(film ? plansARegenerer(film as never).map((x) => x.planId) : []);
  const choisirStyleFilm = (id: IdStyleCinema | null) => {
    if (!film) { setStyleAvantFilm(id); return; }
    void enregistrer({ style: id });
  };

  const composer = async () => {
    const data = await appel('/api/cinema/films', {
      method: 'POST',
      body: JSON.stringify({ titre, histoire, format, qualite, nbScenes, personnages: casting, styleCinema: styleAffiche }),
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
  const lancerGenerationIa = async (planId: string, operation: 'image' | 'video') => {
    if (!film) return;
    setConfirmation(null);
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
    } catch (e) {
      // Un delai ici ne veut PAS dire que rien n'est parti : le sondage dira l'etat reel.
      setErreur(e instanceof Error && e.name === 'AbortError'
        ? 'le serveur tarde a repondre — l’etat de la generation va s’afficher, ne relancez pas'
        : (e instanceof Error ? e.message : 'echec'));
      if (film) rafraichirFilmRef.current?.(film.id);
    } finally {
      clearTimeout(minuteur);
      setEnCours(null);
    }
  };

  const genererMedia = (planId: string, operation: 'image' | 'video') => {
    if (!film || generationActiveDe(film)) return;
    // Une generation REELLE depense : deux gestes. La SIMULEE est gratuite : un seul.
    if (generationMode === 'reelle') { setConfirmation({ planId, operation }); return; }
    lancerGenerationIa(planId, operation);
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
        nom: p.nom, role: p.role,
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
  /** La scene dont les outils sont ouverts : une seule, et seulement a la demande. */
  const [sceneOuverte, setSceneOuverte] = useState<string | null>(null);

  /** Ce que le film a VRAIMENT garde de votre histoire (module pur, aucune ecriture). */
  const fidelite = useMemo(() => (film ? auditFidelite(film as never) : null), [film]);
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
            Reprendre un film
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
              <span className="inline-flex items-center gap-1 text-rose-300" role="group" aria-label="Confirmer la suppression du film">
                Supprimer le film et ses fichiers ?
                <button type="button" onClick={supprimerFilmOuvert} disabled={enCours !== null} aria-label="Confirmer la suppression du film" className="p-1 rounded hover:bg-rose-500/20 disabled:opacity-50"><Check className="w-4 h-4" /></button>
                <button type="button" onClick={() => setSuppressionArmee(false)} aria-label="Annuler la suppression" className="p-1 rounded hover:bg-slate-700"><X className="w-4 h-4" /></button>
              </span>
            ) : (
              <button type="button" onClick={() => setSuppressionArmee(true)} disabled={enCours !== null} aria-label="Supprimer ce film" title="Supprimer ce film" className="p-1 rounded text-slate-500 hover:text-rose-300 hover:bg-slate-800 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
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
        {film && film.scenes.length > 0 && (
          <SceneCarousel
            film={film}
            surRelancer={(sceneId) => produire([sceneId])}
            enCours={enCours !== null}
            travailActif={ACTIF(travail)}
            generationIa={generationIa}
            generationMode={generationMode}
            tarifs={tarifs}
            enCoursTexte={enCours}
            confirmation={confirmation}
            surGenererMedia={genererMedia}
            surImporterMedia={importerMedia}
          />
        )}
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
              placeholder="Titre du film"
              className="w-full mb-3 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            />
            <div className="relative">
              <textarea
                value={histoire}
                onChange={(e) => setHistoire(e.target.value)}
                rows={5}
                placeholder="Une phrase par plan. Pour une replique, mettez-la entre guillemets apres le nom du personnage."
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
              Une phrase = un plan.
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
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => setCasting([...casting, { nom: '', role: '', description: '', urlImage: '' }])} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
                <Plus className="w-4 h-4" /> Ajouter un personnage
              </button>
              {casting.length > 1 && (
                <button onClick={() => setCasting(casting.slice(0, -1))} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-red-500/50">
                  <Trash2 className="w-4 h-4" /> Retirer le dernier
                </button>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="text-xs text-slate-400">
                Le decoupage est local et deterministe : une phrase = un plan, et votre texte reste la source de verite.
                {film && montage && ` Scenario actuel : ${film.scenes.length} scenes, ${montage.segments.length} plans, ${montage.dureeS.toFixed(1)} s.`}
              </p>
              {film && (
                <button
                  onClick={() => { void composer(); }}
                  disabled={enCours !== null}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-violet-500/50 disabled:opacity-50"
                >
                  {enCours === 'scenario' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Recomposer le scenario depuis mon texte
                </button>
              )}
            </div>
          </div>
        )}

        {etape === 2 && (
          <div>
            <TitreEtape numero={3} total={5} icone={Link2} titre="Une histoire, scene apres scene."
              phrase="Chaque scene renvoie aux phrases de votre texte. Les outils d’une scene s’ouvrent au clic, jamais tous a la fois." />
            {film ? (
              <>
                {aProduire.length > 0 && (
                  <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-xs text-amber-300">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {aProduire.length} scene(s) a reproduire
                  </p>
                )}
              <div className="mb-4">
                <ResumeStyle
                  styleFilm={film.styleCinema ?? null}
                  exceptions={film.scenes.filter((x) => x.styleCinema && x.styleCinema !== film.styleCinema).length}
                />
              </div>
              <div className="space-y-5">
                {film.scenes.map((scene) => (
                  <div key={scene.id} id={`scene-cinema-${scene.id}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 scroll-mt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-pink-400 font-semibold tracking-widest">SCENE {scene.index + 1} · {scene.intention.toUpperCase()}</span>
                      <span className="font-semibold">{scene.titre}</span>
                      <span className="text-xs text-slate-400">{scene.lieu}</span>
                      {scene.etat === 'validee' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      <SelecteurStyleScene
                        valeur={scene.styleCinema ?? null}
                        styleFilm={film.styleCinema ?? null}
                        surChoisir={(id) => enregistrer({ scenes: [{ id: scene.id, style: id }] })}
                      />
                      {/* Actions secondaires : icones, libelle accessible (UX-PREMIUM.md). */}
                      <button
                        type="button"
                        onClick={() => enregistrer({ scenes: [{ id: scene.id, etat: scene.etat === 'validee' ? 'brouillon' : 'validee' }] })}
                        aria-label={scene.etat === 'validee' ? 'Repasser la scene en brouillon' : 'Valider la scene'}
                        aria-pressed={scene.etat === 'validee'}
                        title={scene.etat === 'validee' ? 'Repasser en brouillon' : 'Valider la scene'}
                        className="ml-auto rounded p-1.5 text-slate-500 hover:text-emerald-300 transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => produire([scene.id])}
                        disabled={enCours !== null || ACTIF(travail)}
                        aria-label="Regenerer cette scene"
                        title="Regenerer cette scene"
                        className="rounded p-1.5 text-slate-500 hover:text-violet-300 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSceneOuverte(sceneOuverte === scene.id ? null : scene.id)}
                        aria-expanded={sceneOuverte === scene.id}
                        aria-controls={`outils-${scene.id}`}
                        aria-label={sceneOuverte === scene.id ? `Fermer les outils de la scene ${scene.index + 1}` : `Ouvrir les outils de la scene ${scene.index + 1}`}
                        title={sceneOuverte === scene.id ? 'Fermer les outils' : 'Modifier cette scene'}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:text-violet-300"
                      >
                        {sceneOuverte === scene.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Ce que VOTRE texte dit de cette scene : le lien verifiable avec l'original. */}
                    <ol className="mt-2 space-y-1">
                      {phrasesDeLaScene(film as never, scene as never).map((ph, k) => (
                        <li key={k} className="flex gap-2 text-[11px] leading-snug text-slate-400">
                          <span className="shrink-0 text-slate-600">{k + 1}.</span><span>{ph}</span>
                        </li>
                      ))}
                    </ol>
                    {ecartsScene(film as never, scene as never).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {ecartsScene(film as never, scene as never).map((e, k) => (
                          <li key={k} className="flex items-start gap-1.5 text-[11px] text-amber-300/90">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{e.detail}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Outils de la scene : duree, camera, image, voix — uniquement a la demande. */}
                    {sceneOuverte === scene.id && (
                    <div id={`outils-${scene.id}`}>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {film.personnages.map((p) => {
                        const present = scene.personnages.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => enregistrer({ scenes: [{ id: scene.id, personnages: present ? scene.personnages.filter((x) => x !== p.id) : [...scene.personnages, p.id] }] })}
                            className={`text-xs rounded-full px-3 py-1 border ${present ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-slate-700 text-slate-400'}`}
                          >
                            {p.nom}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 space-y-2">
                      {scene.plans.map((plan) => (
                        <div key={plan.id} className="rounded border border-slate-800/80 bg-slate-900/40 p-2">
                          <div className="flex flex-col md:flex-row md:items-center gap-2">
                            <span className="text-xs text-slate-500 w-32 shrink-0">{plan.cadre} · {plan.dureeS.toFixed(1)} s</span>
                            <input
                              defaultValue={plan.dialogue?.texte ?? plan.description}
                              onBlur={(e) => {
                                const texte = e.target.value;
                                if (texte !== (plan.dialogue?.texte ?? plan.description)) enregistrer({ plans: [{ id: plan.id, texte }] });
                              }}
                              className="flex-1 rounded bg-slate-950 border border-slate-800 px-3 py-2 text-sm"
                            />
                            {plan.dialogue && (
                              <span className="text-xs text-pink-300 w-24 shrink-0">
                                {film.personnages.find((p) => p.id === plan.dialogue?.personnageId)?.nom ?? 'narrateur'}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <SelecteurCamera
                              valeur={plan.camera ?? 'auto'}
                              ancien={film.directionActive !== true}
                              automatique={cameraEffective({ ...plan, camera: undefined, cadre: plan.cadre as never }, scene as never).effective}
                              surChoisir={(id) => enregistrer({ plans: [{ id: plan.id, camera: id }] })}
                            />
                            {plan.media && aRegenerer.has(plan.id) && <PlanAregenerer genre={plan.media.genre} />}
                            {/* Media du plan : importe en octets, mesure par le serveur. */}
                            {plan.media ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                                  {plan.media.genre === 'image' ? <ImageIcon className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                                  {plan.media.largeur}x{plan.media.hauteur}
                                  {plan.media.dureeS !== null && ` · ${plan.media.dureeS.toFixed(1)} s`}
                                  {` · ${(plan.media.octets / 1_000_000).toFixed(1)} Mo`}
                                </span>
                                {plan.media.genre === 'video' && (
                                  <button
                                    onClick={() => enregistrer({ plans: [{ id: plan.id, sonMedia: !plan.media?.sonActif }] })}
                                    className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 hover:border-violet-500/50"
                                  >
                                    {plan.media.sonActif ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                                    {plan.media.sonActif ? 'son du rush garde' : 'son du rush coupe'}
                                  </button>
                                )}
                                <button
                                  onClick={() => enregistrer({ plans: [{ id: plan.id, media: null }] })}
                                  className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 hover:border-red-500/50"
                                >
                                  <Trash2 className="w-3 h-3" /> retirer
                                </button>
                              </>
                            ) : (
                              <>
                                <label className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 cursor-pointer hover:border-violet-500/50">
                                  {enCours === `media:${plan.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                  Importer une image ou une video
                                  <input
                                    type="file"
                                    accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,.m4v"
                                    className="hidden"
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importerMedia(plan.id, f); e.target.value = ''; }}
                                  />
                                </label>
                                {generationIa && (
                                  <button
                                    onClick={() => genererMedia(plan.id, 'image')}
                                    disabled={enCours !== null || !!generationActiveDe(film)}
                                    data-cinema-generation="image"
                                    className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 hover:border-violet-400 disabled:opacity-50"
                                  >
                                    {enCours === `generation:${plan.id}:image` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                    {generationMode === 'simulee' ? 'Generer (IA, simule)' : 'Generer l’image (IA)'}
                                    {generationMode === 'reelle' && (
                                      <span className="text-violet-300/80">· {libellePrix(tarifs, 'ai.generate_background')}</span>
                                    )}
                                  </button>
                                )}
                              </>
                            )}
                            {generationIa && plan.media?.genre === 'image' && (
                              <button
                                onClick={() => genererMedia(plan.id, 'video')}
                                disabled={enCours !== null || !!generationActiveDe(film)}
                                data-cinema-generation="video"
                                className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 hover:border-violet-400 disabled:opacity-50"
                              >
                                {enCours === `generation:${plan.id}:video` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                {generationMode === 'simulee' ? 'Animer en video (IA, simule)' : 'Animer en video (IA)'}
                                {generationMode === 'reelle' && (
                                  <span className="text-violet-300/80">· {libellePrix(tarifs, 'ai.image_to_video')}</span>
                                )}
                              </button>
                            )}

                            <SuiviGenerationPlan
                              generation={derniereGenerationDuPlan(film, plan.id)}
                              confirmation={confirmation?.planId === plan.id ? confirmation.operation : null}
                              prix={confirmation?.planId === plan.id
                                ? libellePrix(tarifs, confirmation.operation === 'video' ? 'ai.image_to_video' : 'ai.generate_background')
                                : ''}
                              surConfirmer={() => confirmation && lancerGenerationIa(confirmation.planId, confirmation.operation)}
                              surAnnuler={() => setConfirmation(null)}
                            />

                            {/* Personnages presents DANS CE PLAN. */}
                            <span className="text-slate-600">|</span>
                            {film.personnages.map((p) => {
                              const present = plan.personnages.includes(p.id);
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => enregistrer({ plans: [{ id: plan.id, personnages: present ? plan.personnages.filter((x) => x !== p.id) : [...plan.personnages, p.id] }] })}
                                  className={`rounded-full px-2 py-1 border ${present ? 'border-violet-500/50 bg-violet-500/15 text-violet-200' : 'border-slate-800 text-slate-500'}`}
                                >
                                  {p.nom}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    </div>
                    )}
                  </div>
                ))}
              </div>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                Composez d’abord le scenario a l’etape Personnages : les scenes en decouleront, phrase par phrase.
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
                    {mediasGeneres > 0 ? `${mediasGeneres} media(s) sur vos plans` : 'Aucun media genere pour ce film'}
                  </p>
                </div>

                {fidelite.ecarts.length > 0 && (
                  <section className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-200">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" /> A valider : {fidelite.ecarts.length} ecart(s) avec votre texte
                    </h3>
                    <ul className="space-y-1.5">
                      {fidelite.ecarts.map((e, k) => (
                        <li key={k} className="text-[11px] leading-snug text-amber-100/80">{e.detail}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Studiio ne corrige rien tout seul : modifiez votre histoire ou vos personnages, puis recomposez le scenario.
                    </p>
                  </section>
                )}

                <section className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                  <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Shield className="h-4 w-4 text-violet-300" aria-hidden="true" /> Cout annonce avant toute creation
                  </h3>
                  <p className="text-xs text-slate-400">
                    {devis
                      ? (devis.totalUsd === null ? 'Cout inconnu (tarif non declare) : rien ne sera lance sans prix.'
                        : devis.totalUsd === 0 ? `Gratuit (rendu local) pour ${devis.secondesAProduire.toFixed(1)} s a produire.`
                        : `${devis.totalUsd.toFixed(4)} USD pour ${devis.secondesAProduire.toFixed(1)} s a produire.`)
                      : 'Le devis s’affiche des que le scenario est compose.'}
                  </p>
                </section>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                Composez le scenario pour verifier la fidelite a votre histoire.
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
                  {ACTIF(travail) ? 'Production en cours' : 'Exporter le film'}
                </button>
                {travail && film && <Production film={film} travail={travail} surArreter={arreterProduction} />}
              </section>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                Composez d’abord le scenario : l’export viendra de votre film, pas d’un exemple.
              </p>
            )}
          </div>
        )}
      </WizardCinema>
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
              aria-label="Arreter la production"
              title={travail.annulationDemandee ? 'Arret demande' : 'Arreter la production'}
              className="ml-auto rounded p-1.5 text-slate-500 hover:text-red-300 transition-colors disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div
            role="progressbar" aria-label="Progression de la production" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800"
          >
            <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Etat des scenes">
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
                  <span className="sr-only">{etat === 'reutilisee' ? 'reprise du stockage' : etat === 'faite' ? 'rendue' : etat === 'en_cours' ? 'en cours' : 'en attente'}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            La production continue sur le serveur : vous pouvez fermer cette page et revenir.
            <Detail texte="Les scenes terminees sont conservees. Si le serveur redemarre, la production reprend la ou elle s'est arretee, sans refaire les scenes deja rendues." />
          </p>
        </div>
      )}

      {travail.statut === 'echec' && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            {travail.erreur ?? 'La production a echoue.'}
            <Detail texte="Les scenes deja rendues sont conservees : relancer l'export ne refait que ce qui manque." />
          </span>
        </div>
      )}

      {travail.statut === 'annule' && (
        <p className="text-sm text-amber-300">
          Production arretee. Les scenes deja rendues sont conservees.
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
                <Download className="w-4 h-4" /> Telecharger le MP4
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
      <span className="inline-flex items-center gap-2 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-100" role="group" aria-label="Confirmer la generation payante">
        {confirmation === 'video' ? 'Animer ce plan en video' : 'Generer cette image'} · {prix}
        <button type="button" onClick={surConfirmer} data-cinema-confirmer className="inline-flex items-center gap-1 rounded bg-amber-500/80 px-2 py-0.5 text-slate-950 font-semibold hover:bg-amber-400">
          <Check className="w-3 h-3" /> Confirmer
        </button>
        <button type="button" onClick={surAnnuler} aria-label="Annuler" className="p-0.5 rounded hover:bg-slate-700"><X className="w-3 h-3" /></button>
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
        {operation === 'video' && <span className="text-violet-300/70">(1 a plusieurs minutes — vous pouvez quitter la page)</span>}
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
          <p className="text-sm font-medium text-slate-200">Votre film apparaitra ici</p>
          <p className="text-xs text-slate-400">Ecrivez l’histoire, puis composez le scenario.</p>
          <p className="text-[11px] text-slate-500">{format} · en attendant, choisissez un style ou un mouvement pour voir un exemple.</p>
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
        {segment.demo && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">Démonstration · clip d’exemple</span>}
        {!segment.media && <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-300">Prévisualisation</span>}
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
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button onClick={surBasculerLecture} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
        {joue ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {joue ? 'Pause' : 'Lire le montage'}
      </button>
      <input
        type="range" min={0} max={montage.dureeS} step={0.1} value={tempsS}
        onChange={(e) => surDeplacer(Number(e.target.value))}
        aria-label="Position dans le montage"
        className="flex-1 min-w-[120px] accent-violet-500"
      />
      <span className="text-[11px] tabular-nums text-slate-400">{tempsS.toFixed(1)} / {montage.dureeS.toFixed(1)} s</span>
      {aDuSon && surBasculerSon && (
        <button
          type="button" onClick={surBasculerSon} aria-pressed={!son}
          aria-label={son ? 'Couper le son' : 'Activer le son'} title={son ? 'Couper le son' : 'Activer le son'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:border-violet-500/50"
        >
          {son ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      )}
      {surPreparerVoix && !montage.segments.some((s) => s.voixUrl) && (
        <button onClick={surPreparerVoix} disabled={voixEnCours} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50 disabled:opacity-50">
          {voixEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Preparer les voix
        </button>
      )}
    </div>
  );
}

function Apercu({ montage, surPreparerVoix, voixEnCours }: { montage: MontageApi; surPreparerVoix: () => void; voixEnCours: boolean }) {
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
        <Play className="w-4 h-4 text-violet-400" /> {bilan.aucun && !demo ? 'Prévisualisation du scénario' : 'Apercu permanent'}
        <Detail texte="Meme chronologie que le MP4 : les debuts et durees viennent du montage renvoye par l'API. Un plan sans media est un emplacement de storyboard, pas une video." />
      </h2>
      <p className="mb-3 text-xs text-slate-400" data-apercu="bilan">
        {bilan.aucun
          ? 'Aucune image ni vidéo pour l’instant : c’est le scénario en storyboard, pas un film.'
          : bilan.manquants > 0
            ? `${bilan.avecMedia} plan${bilan.avecMedia > 1 ? 's' : ''} sur ${bilan.total} avec média · ${bilan.manquants} manquant${bilan.manquants > 1 ? 's' : ''}.`
            : `${bilan.total} plans avec média : vous voyez les vrais fichiers.`}
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
            {demo ? 'Quitter la démonstration' : 'Mode démonstration (gratuit)'}
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
          aria-label="Apercu agrandi du montage"
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
            <p className="mt-2 text-center text-[11px] text-slate-500">Echap pour revenir</p>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}

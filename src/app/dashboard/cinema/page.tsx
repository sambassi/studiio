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
import {
  Clapperboard, Users, Wand2, Link2, Play, Pause, Download,
  Info, Loader2, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle,
  ImageIcon, Film, Volume2, VolumeX, Upload, Sparkles, X, Check, Circle,
  ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useTarifs, libellePrix, type TarifsEcran } from '@/lib/tarifs/client';

interface SegmentApi {
  sceneId: string; sceneIndex: number; planId: string; cadre: string;
  titreScene: string; lieu: string; intention: string; texte: string;
  locuteur: string | null; apparence: string | null;
  debutS: number; finS: number; dureeS: number;
  media: MediaApi | null; cadrage: { echelle: number; rogneX: number; rogneY: number; memeRapport: boolean } | null;
  voixUrl: string | null; couleurs: [string, string];
}
interface MediaApi { url: string; genre: 'image' | 'video'; largeur: number; hauteur: number; dureeS: number | null; octets: number; origine: string; sonActif?: boolean }
interface MontageApi { filmId: string; titre: string; format: string; largeur: number; hauteur: number; fps: number; segments: SegmentApi[]; dureeS: number }
interface PlanApi { id: string; cadre: string; description: string; personnages: string[]; dialogue: { personnageId: string | null; texte: string } | null; dureeS: number; media: MediaApi | null }
interface SceneApi { id: string; index: number; titre: string; lieu: string; intention: string; personnages: string[]; plans: PlanApi[]; etat: string; coutUsd: number }
interface PersonnageApi { id: string; nom: string; role: string; voix: string; references: Array<{ id: string; version: number; description: string }>; referenceActiveId: string | null }
interface GenerationApi {
  id: string; planId: string; operation: 'image' | 'video'; mode: 'reelle' | 'simulee';
  statut: 'en_cours' | 'reussie' | 'echouee' | 'interrompue'; creeLe: string; majLe: string;
  erreur?: string | null; creditsPris?: number; creditsRembourses?: boolean;
}
interface FilmApi { id: string; titre: string; histoire?: string; format: string; qualite: string; personnages: PersonnageApi[]; scenes: SceneApi[]; generations?: GenerationApi[] }
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

const HISTOIRE_EXEMPLE = "Nina entre dans la salle avant le lever du jour. Le tatami est encore froid et personne ne parle. Marco la regarde sans bouger. Nina sait que le combat a deja commence. Marco avance et le silence se brise. Nina tient bon jusqu au dernier instant. Le jour se leve sur la salle vide.";

/** Rail visuel condense : les 7 sections reelles (voir panneaux) se regroupent en 5 etapes a l'ecran. */
const ETAPES = [
  { icone: Clapperboard, titre: 'Histoire' },
  { icone: Users, titre: 'Personnages' },
  { icone: Wand2, titre: 'Scenes' },
  { icone: Play, titre: 'Apercu' },
  { icone: Download, titre: 'Export' },
];

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
/**
 * `ouvertControle`/`onChangerOuvert` sont optionnels : sans eux, le panneau gere son
 * propre etat (comportement d'origine). Le rail d'etapes a besoin d'OUVRIR un panneau
 * precis depuis l'exterieur (ex. cliquer « Personnages ») — d'ou ce controle optionnel,
 * plutot que de dupliquer tout le composant.
 */
function CollapsiblePanel({ numero, titre, icone: Icone, badge, children, ouvertControle, onChangerOuvert }: {
  numero: number; titre: string; icone: typeof Clapperboard; badge?: React.ReactNode; children: React.ReactNode;
  ouvertControle?: boolean; onChangerOuvert?: (v: boolean) => void;
}) {
  const [ouvertInterne, setOuvertInterne] = useState(true);
  const ouvert = ouvertControle ?? ouvertInterne;
  const basculer = () => (onChangerOuvert ? onChangerOuvert(!ouvert) : setOuvertInterne((v) => !v));
  const id = `panneau-cinema-${numero}`;
  return (
    // L'id est sur la SECTION (toujours montee), pas sur le contenu replie : le rail
    // d'etapes doit pouvoir defiler vers un panneau meme ferme.
    <section id={id} className="rounded-xl border border-slate-800 bg-slate-900/40 scroll-mt-4">
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouvert}
        aria-controls={`${id}-contenu`}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-300">{numero}</span>
        <Icone className="w-4 h-4 text-violet-400 shrink-0" />
        <span className="font-semibold flex-1">{titre}</span>
        {badge}
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform shrink-0 ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && <div id={`${id}-contenu`} className="px-5 pb-5">{children}</div>}
    </section>
  );
}

/**
 * Vignette : le media REEL du plan, ou un repli sobre — jamais un media invente.
 *
 * ⚠️ `media.url` est la cle de STOCKAGE (prive), pas une URL navigable — c'est pour ca
 * que `Apercu` (plus haut dans l'arbre) ne l'affiche jamais directement non plus : il
 * recoit `segment.media.url` deja resolu par l'API montage. Ici, le media vient du FILM
 * (`plan.media`), jamais resolu : on passe par la MEME route authentifiee que le reste
 * de l'app (`/api/cinema/films/{filmId}/medias/{planId}`), proprietaire seulement.
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
  const [titre, setTitre] = useState('Avant le jour');
  const [histoire, setHistoire] = useState(HISTOIRE_EXEMPLE);
  const [format, setFormat] = useState<'16:9' | '9:16'>('16:9');
  const [qualite, setQualite] = useState('standard');
  const [nbScenes, setNbScenes] = useState(4);
  const [casting, setCasting] = useState([
    { nom: 'Nina', role: 'protagoniste', description: 'cheveux courts, veste rouge', urlImage: '' },
    { nom: 'Marco', role: 'antagoniste', description: 'grand, barbe, ceinture noire', urlImage: '' },
  ]);

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
  const [panneauxOuverts, setPanneauxOuverts] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true });
  /**
   * Panneaux ouverts par etape du rail (les autres se referment) : « une seule
   * configuration principale a la fois ». Le panneau 3 (« Composer le scenario »)
   * n'a pas d'etape dediee dans le rail a 5 entrees — c'est l'action-pont entre
   * Histoire et Personnages (il faut l'un ou l'autre avant de composer), donc il
   * reste visible pendant ces deux etapes et se referme des que des scenes existent.
   */
  const PANNEAUX_PAR_ETAPE: number[][] = [[1, 3], [2, 3], [4], [], []];
  /** Cible DOM de chaque etape du rail, dans l'ordre Histoire/Personnages/Scenes/Apercu/Export. */
  const allerAEtape = (index: number) => {
    const ouverts = new Set(PANNEAUX_PAR_ETAPE[index] ?? []);
    setPanneauxOuverts({ 1: ouverts.has(1), 2: ouverts.has(2), 3: ouverts.has(3), 4: ouverts.has(4) });
    const idCible = ['panneau-cinema-1', 'panneau-cinema-2', 'panneau-cinema-4', 'cinema-apercu', 'cinema-export'][index];
    // Le panneau peut venir de s'ouvrir dans ce meme rendu : laisser le DOM se poser avant de defiler.
    requestAnimationFrame(() => document.getElementById(idCible)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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

  const composer = async () => {
    const data = await appel('/api/cinema/films', {
      method: 'POST',
      body: JSON.stringify({ titre, histoire, format, qualite, nbScenes, personnages: casting }),
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 text-slate-100">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Clapperboard className="w-7 h-7 text-violet-400" />
          <h1 className="text-2xl font-bold">Cinema IA</h1>
          <span className="text-xs px-2 py-1 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">prototype</span>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Une histoire devient un film : scenes, personnages, plans, voix, puis un MP4.
          <Detail texte="Le decoupage est local et deterministe : aucune IA generative n'est appelee, aucun fournisseur payant n'est actif. Les visuels sont des cartes de plan rendues par Remotion." />
        </p>
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
      </header>

      {/* Rail des etapes — raccourci de navigation ; les panneaux ci-dessous restent TOUS accessibles, rien n'est cache. */}
      <ol className="flex flex-wrap gap-2 mb-8">
        {ETAPES.map((e, i) => {
          const Icone = e.icone;
          const atteintes = [true, true, !!film, !!montage, !!film];
          const atteinte = atteintes[i];
          return (
            <li key={e.titre}>
              <button
                type="button"
                onClick={() => allerAEtape(i)}
                aria-label={`Aller a l’etape ${e.titre}`}
                title={e.titre}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${atteinte ? 'border-violet-500/40 bg-violet-500/10 text-violet-200 hover:border-violet-400/60' : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-600'}`}
              >
                <Icone className="w-4 h-4" />
                <span>{i + 1}. {e.titre}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {erreur && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200" role="alert">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{erreur}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        {/* Colonne de gauche — panneaux numerotes, repliables, defilement independant. */}
        <div className="space-y-4 min-w-0 lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto lg:pr-1 order-2 lg:order-1">
          <CollapsiblePanel
            numero={1} titre="Histoire" icone={Clapperboard}
            ouvertControle={panneauxOuverts[1]} onChangerOuvert={(v) => setPanneauxOuverts((p) => ({ ...p, 1: v }))}
          >
            <input
              value={titre}
              onChange={(e) => setTitre(e.target.value)}
              placeholder="Titre du film"
              className="w-full mb-3 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm"
            />
            <textarea
              value={histoire}
              onChange={(e) => setHistoire(e.target.value)}
              rows={5}
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm leading-relaxed"
            />
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
          </CollapsiblePanel>

          <CollapsiblePanel numero={2} titre="Personnages et references" icone={Users}
            ouvertControle={panneauxOuverts[2]} onChangerOuvert={(v) => setPanneauxOuverts((p) => ({ ...p, 2: v }))}
            badge={<Detail texte="Une apparence changee cree une VERSION de reference : les anciennes restent lisibles, et les scenes concernees sont marquees a reproduire. Aucune coherence visuelle en generation IA n'est promise : rien n'a encore ete teste avec un fournisseur." />}
          >
            <div className="space-y-3">
              {casting.map((p, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input value={p.nom} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, nom: e.target.value } : c))} placeholder="Nom" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
                  <input value={p.role} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, role: e.target.value } : c))} placeholder="Role" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
                  <input value={p.description} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, description: e.target.value } : c))} placeholder="Apparence (reference)" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm md:col-span-2" />
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
          </CollapsiblePanel>

          <CollapsiblePanel
            numero={3} titre="Scenario" icone={Wand2}
            ouvertControle={panneauxOuverts[3]} onChangerOuvert={(v) => setPanneauxOuverts((p) => ({ ...p, 3: v }))}
          >
            <button onClick={composer} disabled={enCours !== null} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-50">
              {enCours === 'scenario' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Composer le scenario
            </button>
            {film && montage && (
              <p className="mt-4 text-sm text-slate-300">
                {film.scenes.length} scenes, {montage.segments.length} plans, {montage.dureeS.toFixed(1)} s, {montage.largeur}x{montage.hauteur}.
              </p>
            )}
          </CollapsiblePanel>

          {film && (
            <CollapsiblePanel numero={4} titre="Scenes, personnages, repliques" icone={Link2}
              ouvertControle={panneauxOuverts[4]} onChangerOuvert={(v) => setPanneauxOuverts((p) => ({ ...p, 4: v }))}
              badge={aProduire.length > 0 ? (
                <span className="text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {aProduire.length} scene(s) a reproduire
                </span>
              ) : undefined}
            >
              <div className="space-y-5">
                {film.scenes.map((scene) => (
                  <div key={scene.id} id={`scene-cinema-${scene.id}`} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 scroll-mt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-pink-400 font-semibold tracking-widest">SCENE {scene.index + 1} · {scene.intention.toUpperCase()}</span>
                      <span className="font-semibold">{scene.titre}</span>
                      <span className="text-xs text-slate-400">{scene.lieu}</span>
                      {scene.etat === 'validee' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
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
                    </div>

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
                ))}
              </div>
            </CollapsiblePanel>
          )}
        </div>

        {/* Colonne de droite — apercu video, scenes, export : visibles sans defiler. UNE SEULE instance d'Apercu. */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start order-1 lg:order-2">
          <div id="cinema-apercu" className="scroll-mt-4">
            {montage ? (
              <Apercu montage={montage} surPreparerVoix={preparerVoix} voixEnCours={enCours === 'voix'} />
            ) : (
              <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-center">
                <Play className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-400">L’apercu apparaitra ici une fois le scenario compose.</p>
              </section>
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

          {film && (
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
          )}
        </div>
      </div>
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
function Apercu({ montage, surPreparerVoix, voixEnCours }: { montage: MontageApi; surPreparerVoix: () => void; voixEnCours: boolean }) {
  const [tempsS, setTempsS] = useState(0);
  const [joue, setJoue] = useState(false);
  const debutRef = useRef<number>(0);
  const trameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const segment = useMemo(
    () => montage.segments.find((s) => tempsS >= s.debutS && tempsS < s.finS) ?? montage.segments[0],
    [montage.segments, tempsS],
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

  if (!segment) return null;
  const portrait = montage.hauteur > montage.largeur;

  return (
    <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Play className="w-4 h-4 text-violet-400" /> 6. Apercu
        <Detail texte="Meme chronologie que le MP4 : les debuts, durees et couleurs viennent du montage renvoye par l'API, pas d'un calcul propre a la page." />
      </h2>

      {/* Largeur responsive : une largeur fixe en pixels debordait sur tout viewport plus
          etroit que 640px (mobile, colonne de droite en 380px) — `max-width` + `aspect-ratio`
          gardent les memes proportions 16:9/9:16 tout en retrecissant avec le conteneur.
          `minHeight` : le texte superpose (titre scene + dialogue centre) est en taille FIXE,
          pas proportionnelle a la largeur — en dessous de cette hauteur les deux blocs se
          chevauchent. Une boite plus "carree" qu'un 16:9 strict sur les tres petits ecrans
          reste lisible ; un chevauchement de texte ne l'est pas. */}
      <div
        className="relative mx-auto w-full overflow-hidden rounded-xl border border-slate-800"
        style={{
          maxWidth: portrait ? 270 : 640,
          aspectRatio: portrait ? '9 / 16' : '16 / 9',
          minHeight: portrait ? 320 : 200,
          background: `radial-gradient(130% 110% at 25% 15%, ${segment.couleurs[0]} 0%, ${segment.couleurs[1]} 55%, #0A0A0F 100%)`,
        }}
      >
        {/* Le media reel du plan, cadre comme au rendu (cover, sans etirement). */}
        {segment.media && (
          segment.media.genre === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={segment.media.url.startsWith('/') ? segment.media.url : `/${segment.media.url}`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: 'cover' }} />
          ) : (
            <video
              src={segment.media.url.startsWith('/') ? segment.media.url : `/${segment.media.url}`}
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'cover' }}
              muted autoPlay loop playsInline
            />
          )
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.15) 45%, rgba(10,10,15,0.85) 100%)' }} />
        <div className="absolute top-4 left-4 right-4">
          <div className="text-[10px] tracking-[0.2em] text-pink-400 font-bold">SCENE {segment.sceneIndex + 1} · {segment.intention.toUpperCase()}</div>
          <div className="text-lg font-extrabold">{segment.titreScene}</div>
          <div className="text-[11px] text-slate-300">{segment.lieu} — {segment.cadre}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
          <div>
            {segment.locuteur && (
              <div className="inline-block mb-2 rounded-full bg-pink-500 px-2 py-0.5 text-[10px] font-bold tracking-widest text-slate-950">
                {segment.locuteur.toUpperCase()}
              </div>
            )}
            <div className="text-base font-bold leading-snug" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.65)' }}>{segment.texte}</div>
          </div>
        </div>
        <div className="absolute bottom-3 left-4 right-4 flex justify-between text-[10px] text-slate-300">
          <span>{tempsS.toFixed(1)} s / {montage.dureeS.toFixed(1)} s</span>
          <span>STUDIIO CINEMA IA</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setJoue((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
          {joue ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {joue ? 'Pause' : 'Lire le montage'}
        </button>
        <input
          type="range" min={0} max={montage.dureeS} step={0.1} value={tempsS}
          onChange={(e) => setTempsS(Number(e.target.value))}
          className="flex-1 min-w-[120px] accent-violet-500"
        />
        {!montage.segments.some((s) => s.voixUrl) && (
          <button onClick={surPreparerVoix} disabled={voixEnCours} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50 disabled:opacity-50">
            {voixEnCours ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Preparer les voix
          </button>
        )}
      </div>
    </section>
  );
}

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
  Clapperboard, Users, Wand2, Link2, MessageSquare, Play, Pause, Download,
  Info, Loader2, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle,
  ImageIcon, Film, Volume2, VolumeX, Upload, Sparkles, X, Check, Circle,
} from 'lucide-react';

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
interface FilmApi { id: string; titre: string; histoire?: string; format: string; qualite: string; personnages: PersonnageApi[]; scenes: SceneApi[] }
type StatutTravailApi = 'en_attente' | 'en_cours' | 'termine' | 'echec' | 'annule';
interface TravailApi {
  id: string; filmId: string; statut: StatutTravailApi; erreur: string | null; reference: string | null; annulationDemandee: boolean;
  progression: { etape: string; scenes: Record<string, 'a_faire' | 'en_cours' | 'faite' | 'reutilisee' | 'echec'>; pourcent: number; message: string | null };
  resultat: { aMp4: boolean; scenesRendues: string[]; scenesReutilisees: string[]; avertissements: string[]; dureeS: number | null; octets: number | null; largeur: number | null; hauteur: number | null; codecVideo: string | null; codecAudio: string | null; coutUsd: number } | null;
}
const ACTIF = (t: TravailApi | null) => !!t && (t.statut === 'en_attente' || t.statut === 'en_cours');
interface DevisApi { totalUsd: number | null; secondesAProduire: number; fournisseur: { libelle: string } | null; lignes: Array<{ sceneId: string; titre: string; secondes: number; usd: number | null; motif: string }> }

const HISTOIRE_EXEMPLE = "Nina entre dans la salle avant le lever du jour. Le tatami est encore froid et personne ne parle. Marco la regarde sans bouger. Nina sait que le combat a deja commence. Marco avance et le silence se brise. Nina tient bon jusqu au dernier instant. Le jour se leve sur la salle vide.";

const ETAPES = [
  { icone: Clapperboard, titre: 'Histoire' },
  { icone: Users, titre: 'Personnages' },
  { icone: Wand2, titre: 'Scenario' },
  { icone: Link2, titre: 'Association' },
  { icone: MessageSquare, titre: 'Plans et dialogues' },
  { icone: Play, titre: 'Apercu' },
  { icone: Download, titre: 'Export MP4' },
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

  const appliquer = useCallback((data: any) => {
    if (data?.film) setFilm(data.film);
    if (data?.montage) setMontage(data.montage);
    if (data?.devis) setDevis(data.devis);
    if (Array.isArray(data?.scenesAProduire)) setAProduire(data.scenesAProduire);
  }, []);

  const appel = useCallback(async (url: string, options: RequestInit, libelle: string) => {
    setEnCours(libelle);
    setErreur(null);
    try {
      const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
      const data = await r.json();
      if (!r.ok || data?.ok === false) {
        // Un media manquant est nomme plan par plan : c'est la seule
        // information qui permet de le corriger.
        const details = Array.isArray(data?.manquants)
          ? ` — ${data.manquants.map((m: { planId: string; url: string }) => `${m.planId} : ${m.url}`).join(' / ')}`
          : '';
        throw new Error(`${data?.erreur ?? `echec (${r.status})`}${details}`);
      }
      appliquer(data);
      return data;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'echec');
      return null;
    } finally {
      setEnCours(null);
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

  /**
   * Genere le media d'un plan par IA (lot 3). Le SEUL fournisseur branche
   * est `simule` (local, gratuit, deterministe) : aucune generation
   * payante ne part d'ici. Le serveur refuse tout fournisseur eteint et
   * tout depassement du plafond de depense AVANT d'appeler quoi que ce
   * soit — voir `generation/atelier.ts`.
   */
  const genererMedia = (planId: string, operation: 'image' | 'video') => film && appel(
    `/api/cinema/films/${film.id}/generation`,
    { method: 'POST', body: JSON.stringify({ planId, operation, fournisseurId: 'simule' }) },
    `generation:${planId}:${operation}`,
  );

  /**
   * Prepare les VOIX sans rendre la video : l'apercu a besoin du son, pas de
   * Chromium. Sans cette etape, l'apercu serait muet jusqu'a l'export.
   */
  const preparerVoix = () => film && appel(`/api/cinema/films/${film.id}/produire`, {
    method: 'POST',
    body: JSON.stringify({ rendre: false }),
  }, 'voix');

  /** Les films du compte : ils survivent a un redemarrage du serveur. */
  /** Generation « IA » proposee par le serveur ? Faux par defaut (voir `CINEMA_GENERATION_SIMULEE`). */
  const [generationIa, setGenerationIa] = useState(false);

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
        } else if (r.status === 404) { return; }
      } catch {
        delai = Math.min(delai * 2, 10_000);
      }
      if (!arrete) minuteur = setTimeout(tick, delai);
    };
    minuteur = setTimeout(tick, 600);
    return () => { arrete = true; clearTimeout(minuteur); };
  }, [filmId, travailId, actif, rafraichirFilm]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-slate-100">
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

      {/* Rail des etapes */}
      <ol className="flex flex-wrap gap-2 mb-8">
        {ETAPES.map((e, i) => {
          const Icone = e.icone;
          const atteinte = i < 2 || !!film;
          return (
            <li key={e.titre} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${atteinte ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-slate-700 bg-slate-900/50 text-slate-500'}`}>
              <Icone className="w-4 h-4" />
              <span>{i + 1}. {e.titre}</span>
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

      {/* 1 — Histoire */}
      <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><Clapperboard className="w-4 h-4 text-violet-400" /> 1. Histoire</h2>
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
      </section>

      {/* 2 — Personnages */}
      <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-400" /> 2. Personnages et references
          <Detail texte="Une apparence changee cree une VERSION de reference : les anciennes restent lisibles, et les scenes concernees sont marquees a reproduire. Aucune coherence visuelle en generation IA n'est promise : rien n'a encore ete teste avec un fournisseur." />
        </h2>
        <div className="space-y-3">
          {casting.map((p, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={p.nom} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, nom: e.target.value } : c))} placeholder="Nom" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
              <input value={p.role} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, role: e.target.value } : c))} placeholder="Role" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm" />
              <input value={p.description} onChange={(e) => setCasting(casting.map((c, k) => k === i ? { ...c, description: e.target.value } : c))} placeholder="Apparence (reference)" className="rounded bg-slate-950 border border-slate-700 px-3 py-2 text-sm md:col-span-2" />
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setCasting([...casting, { nom: '', role: '', description: '', urlImage: '' }])} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
            <Plus className="w-4 h-4" /> Ajouter un personnage
          </button>
          {casting.length > 1 && (
            <button onClick={() => setCasting(casting.slice(0, -1))} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-red-500/50">
              <Trash2 className="w-4 h-4" /> Retirer le dernier
            </button>
          )}
        </div>
      </section>

      {/* 3 — Scenario */}
      <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><Wand2 className="w-4 h-4 text-violet-400" /> 3. Scenario</h2>
        <button onClick={composer} disabled={enCours !== null} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium hover:bg-violet-500 disabled:opacity-50">
          {enCours === 'scenario' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Composer le scenario
        </button>
        {film && montage && (
          <p className="mt-4 text-sm text-slate-300">
            {film.scenes.length} scenes, {montage.segments.length} plans, {montage.dureeS.toFixed(1)} s, {montage.largeur}x{montage.hauteur}.
          </p>
        )}
      </section>

      {film && (
        <>
          {/* 4 et 5 — Association, plans et dialogues */}
          <section className="mb-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-violet-400" /> 4 et 5. Scenes, personnages, repliques
              {aProduire.length > 0 && (
                <span className="ml-2 text-xs px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {aProduire.length} scene(s) a reproduire
                </span>
              )}
            </h2>
            <div className="space-y-5">
              {film.scenes.map((scene) => (
                <div key={scene.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
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
                                  disabled={enCours !== null}
                                  data-cinema-generation="image"
                                  className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 hover:border-violet-400 disabled:opacity-50"
                                >
                                  {enCours === `generation:${plan.id}:image` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                  Generer (IA, simule)
                                </button>
                              )}
                            </>
                          )}
                          {generationIa && plan.media?.genre === 'image' && (
                            <button
                              onClick={() => genererMedia(plan.id, 'video')}
                              disabled={enCours !== null}
                              data-cinema-generation="video"
                              className="inline-flex items-center gap-1 rounded border border-violet-700/60 px-2 py-1 hover:border-violet-400 disabled:opacity-50"
                            >
                              {enCours === `generation:${plan.id}:video` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                              Animer en video (IA, simule)
                            </button>
                          )}

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
          </section>

          {/* 6 — Apercu */}
          {montage && <Apercu montage={montage} surPreparerVoix={preparerVoix} voixEnCours={enCours === 'voix'} />}

          {/* 7 — Export */}
          <section className="mb-12 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2"><Download className="w-4 h-4 text-violet-400" /> 7. Export MP4</h2>
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
        </>
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

      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-slate-800"
        style={{
          width: portrait ? 270 : 640,
          height: portrait ? 480 : 360,
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

      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => setJoue((v) => !v)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-violet-500/50">
          {joue ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {joue ? 'Pause' : 'Lire le montage'}
        </button>
        <input
          type="range" min={0} max={montage.dureeS} step={0.1} value={tempsS}
          onChange={(e) => setTempsS(Number(e.target.value))}
          className="flex-1 accent-violet-500"
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

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as KeyboardEventReact, type PointerEvent as PointerEventReact } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Columns2, Crop, Crosshair, Loader2, Pause, Play, RotateCcw, RotateCw, Scissors, Sparkles, X,
} from 'lucide-react';
import OvaleVisage from '@/components/avatar/studio/OvaleVisage';
import { detailEnvoi, envoyerFormulaire, type ProgressionEnvoi } from '@/lib/http/envoiAvecProgression';
import { EXIGENCES_SOURCE_VIDEO, formaterDuree } from '@/lib/avatar/studio';
import {
  AMELIORATION_NEUTRE, RATIOS_CADRE, ameliorationAutomatique, dimensionsApresRotation, filtreCssApercu, libelleCadrage,
  niveauQualite, recadrageDepuisReglages, statistiquesImage, zoomMinimal,
  type InfosVideo, type ParametresAmelioration, type ParametresTraitement, type RatioCadre, type ResultatPreflight, type Rotation,
} from '@/lib/avatar/preparation-source-regles';

/**
 * PRÉPARER MA VIDÉO SOURCE — avant tout fournisseur.
 *
 * 1. L'ORIGINAL est déposé tel quel (`POST /api/avatar/sources`), avec la
 *    progression RÉELLE de l'envoi ; un refus bloquant (pas de son, trop
 *    courte, trop petite) s'affiche aussitôt.
 * 2. Un éditeur court — Recadrer, Couper, Améliorer — travaille sur l'aperçu
 *    LOCAL ; rien n'est retouché dans le navigateur.
 * 3. « Prévisualiser » fait produire la version PRÉPARÉE par le serveur
 *    (`POST /api/avatar/sources/traiter`), relue par
 *    `/api/avatar/sources/apercu` : ce qui s'affiche est le fichier qui
 *    partira, pas une imitation.
 *
 * L'original n'est jamais modifié. Aucun fournisseur n'est appelé ici :
 * « Utiliser cette vidéo » rend les deux clés à la page (`onPret`).
 */

type Etape = 'envoi' | 'refus' | 'edition' | 'traitement' | 'resultat' | 'erreur';
type Section = 'recadrer' | 'couper' | 'ameliorer';

interface ReponseApi<T> { success?: boolean; error?: string; data?: T }
interface DonneesOriginal { cleOriginal: string; infos: InfosVideo; preflight: ResultatPreflight }
interface DonneesTraitee { cleOriginal: string; cleTraitee: string; infos: InfosVideo; preflight: ResultatPreflight; motifs?: string[] }

const LIBELLES_RATIO: Record<RatioCadre, string> = { original: 'Original', '9:16': '9:16', '1:1': '1:1', '16:9': '16:9' };
const LIBELLES_QUALITE = {
  bon: { texte: 'Bon', classe: 'bg-emerald-500/15 text-emerald-300' },
  acceptable: { texte: 'Acceptable', classe: 'bg-amber-500/15 text-amber-200' },
  insuffisant: { texte: 'Insuffisant', classe: 'bg-red-500/15 text-red-200' },
} as const;

const borne = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const pourcent = (n: number) => `${(n * 100).toFixed(3)}%`;

export default function PreparationSource(props: {
  fichier: File;
  onAnnuler: () => void;
  onPret: (r: { cleOriginal: string; cleTraitee: string; infos: InfosVideo }) => void;
}) {
  const { fichier } = props;
  const [etape, setEtape] = useState<Etape>('envoi');
  const [progression, setProgression] = useState<ProgressionEnvoi | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [motifs, setMotifs] = useState<string[]>([]);
  const [original, setOriginal] = useState<DonneesOriginal | null>(null);
  const [resultat, setResultat] = useState<DonneesTraitee | null>(null);
  const [essai, setEssai] = useState(0);
  const [urlLocale, setUrlLocale] = useState<string | null>(null);

  const [section, setSection] = useState<Section>('recadrer');
  const [rotation, setRotation] = useState<Rotation>(0);
  const [ratio, setRatio] = useState<RatioCadre>('original');
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 });
  const [debutS, setDebutS] = useState(0);
  const [finS, setFinS] = useState(0);
  const [temps, setTemps] = useState(0);
  const [lecture, setLecture] = useState(false);
  const [amelioration, setAmelioration] = useState<ParametresAmelioration>({ ...AMELIORATION_NEUTRE });
  const [comparer, setComparer] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const scene = useRef<HTMLDivElement | null>(null);
  const piste = useRef<HTMLDivElement | null>(null);
  const glisse = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const finLecture = useRef<number | null>(null);

  // L'aperçu LOCAL : le fichier lui-même, jamais renvoyé par le serveur.
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(fichier);
    setUrlLocale(url);
    return () => { URL.revokeObjectURL?.(url); };
  }, [fichier]);

  // 1. L'envoi de l'original.
  useEffect(() => {
    const abandon = new AbortController();
    setEtape('envoi');
    setProgression(null);
    setErreur(null);
    const corps = new FormData();
    corps.append('file', fichier);
    envoyerFormulaire<ReponseApi<DonneesOriginal>>('/api/avatar/sources', corps, { onProgression: setProgression, signal: abandon.signal })
      .then((r) => {
        if (abandon.signal.aborted) return;
        const d = r.json?.data;
        if (r.ok && r.json?.success && d?.cleOriginal) {
          setOriginal(d);
          setDebutS(0);
          setFinS(Math.min(d.infos.dureeS, EXIGENCES_SOURCE_VIDEO.dureeMaxS));
          setEtape('edition');
          return;
        }
        if (d?.preflight && !d.preflight.ok) {
          setMotifs(d.preflight.motifs);
          setEtape('refus');
          return;
        }
        setErreur(r.json?.error ?? 'L’envoi a échoué. Réessayez.');
        setEtape('erreur');
      })
      .catch((e: unknown) => {
        if (abandon.signal.aborted) return;
        setErreur(e instanceof Error ? e.message : 'L’envoi a échoué. Réessayez.');
        setEtape('erreur');
      });
    return () => abandon.abort();
  }, [fichier, essai]);

  const infos = original?.infos ?? null;
  const dims = useMemo(() => ({ largeur: infos?.largeurEffective ?? 0, hauteur: infos?.hauteurEffective ?? 0 }), [infos]);
  const tournees = dimensionsApresRotation(dims.largeur || 16, dims.hauteur || 9, rotation);
  const dureeTotale = infos?.dureeS ?? 0;
  const recadrage = useMemo(
    () => recadrageDepuisReglages(dims, { rotation, ratio, zoom, centre }),
    [dims, rotation, ratio, zoom, centre],
  );
  const cadre = recadrage ?? { x: 0, y: 0, largeur: 1, hauteur: 1 };
  const zoomMin = dims.largeur > 0 ? zoomMinimal(dims, rotation, ratio) : 1;
  const dureeRetenue = Math.max(0, finS - debutS);
  const coupeInvalide = dureeRetenue < EXIGENCES_SOURCE_VIDEO.dureeMinS || dureeRetenue > EXIGENCES_SOURCE_VIDEO.dureeMaxS + 0.5;

  // ── Recadrer ──────────────────────────────────────────────────────────
  const pivoter = (sens: 1 | -1) => setRotation((r) => (((r + sens * 90) % 360 + 360) % 360) as Rotation);
  const centrer = () => setCentre({ x: 0.5, y: 0.5 });

  const debutGlisse = (e: PointerEventReact<HTMLDivElement>) => {
    if (section !== 'recadrer') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    glisse.current = { x: e.clientX, y: e.clientY, cx: cadre.x + cadre.largeur / 2, cy: cadre.y + cadre.hauteur / 2 };
  };
  const pendantGlisse = (e: PointerEventReact<HTMLDivElement>) => {
    const g = glisse.current;
    const boite = scene.current?.getBoundingClientRect();
    if (!g || !boite || boite.width === 0 || boite.height === 0) return;
    setCentre({ x: borne(g.cx + (e.clientX - g.x) / boite.width, 0, 1), y: borne(g.cy + (e.clientY - g.y) / boite.height, 0, 1) });
  };
  const finGlisse = () => { glisse.current = null; };
  const clavierCadre = (e: KeyboardEventReact<HTMLDivElement>) => {
    const pas = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
    if (!d) return;
    e.preventDefault();
    setCentre({ x: borne(cadre.x + cadre.largeur / 2 + d[0], 0, 1), y: borne(cadre.y + cadre.hauteur / 2 + d[1], 0, 1) });
  };

  // ── Couper ────────────────────────────────────────────────────────────
  const fixerDebut = (t: number) => setDebutS(borne(Math.round(t * 10) / 10, 0, Math.max(0, finS - 1)));
  const fixerFin = (t: number) => setFinS(borne(Math.round(t * 10) / 10, Math.min(dureeTotale, debutS + 1), dureeTotale));
  const tempsDepuisPointeur = (clientX: number) => {
    const boite = piste.current?.getBoundingClientRect();
    if (!boite || boite.width === 0) return null;
    return borne((clientX - boite.left) / boite.width, 0, 1) * dureeTotale;
  };
  const poignee = (quelle: 'debut' | 'fin') => ({
    onPointerDown: (e: PointerEventReact<HTMLDivElement>) => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); },
    onPointerMove: (e: PointerEventReact<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
      const t = tempsDepuisPointeur(e.clientX);
      if (t !== null) (quelle === 'debut' ? fixerDebut : fixerFin)(t);
    },
    onKeyDown: (e: KeyboardEventReact<HTMLDivElement>) => {
      const pas = e.shiftKey ? 10 : 1;
      const delta = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -pas : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? pas : 0;
      if (!delta) return;
      e.preventDefault();
      if (quelle === 'debut') fixerDebut(debutS + delta); else fixerFin(finS + delta);
    },
  });
  const allerA = (t: number) => { if (video.current) video.current.currentTime = t; setTemps(t); };
  const lireSelection = () => {
    const v = video.current;
    if (!v) return;
    if (lecture) { v.pause(); setLecture(false); finLecture.current = null; return; }
    v.currentTime = debutS;
    finLecture.current = finS;
    setLecture(true);
    void v.play()?.catch?.(() => setLecture(false));
  };
  const surTemps = () => {
    const v = video.current;
    if (!v) return;
    setTemps(v.currentTime);
    if (finLecture.current !== null && v.currentTime >= finLecture.current) {
      v.pause();
      finLecture.current = null;
      setLecture(false);
    }
  };

  // ── Améliorer ─────────────────────────────────────────────────────────
  const basculerAuto = (active: boolean) => {
    if (!active) { setAmelioration({ ...AMELIORATION_NEUTRE }); return; }
    // Une image de la vidéo, réduite, lue par un canvas : la mesure reste locale.
    let stats = { luminanceMoyenne: 128, ecartType: 50 };
    try {
      const v = video.current;
      const toile = document.createElement('canvas');
      toile.width = 64; toile.height = 64;
      const ctx = toile.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (v && ctx) {
        ctx.drawImage(v, 0, 0, 64, 64);
        stats = statistiquesImage(ctx.getImageData(0, 0, 64, 64).data);
      }
    } catch { /* image illisible (pas encore chargée) : correction neutre */ }
    setAmelioration(ameliorationAutomatique(stats));
  };

  // ── Prévisualiser ─────────────────────────────────────────────────────
  const parametres = (): ParametresTraitement => ({ debutS, finS, rotation, recadrage, amelioration });
  const preparer = async () => {
    if (!original || coupeInvalide) return;
    video.current?.pause();
    setLecture(false);
    setEtape('traitement');
    setErreur(null);
    setMotifs([]);
    try {
      const r = await fetch('/api/avatar/sources/traiter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleOriginal: original.cleOriginal, parametres: parametres() }),
      });
      const j = (await r.json().catch(() => null)) as ReponseApi<DonneesTraitee> | null;
      if (r.ok && j?.success && j.data?.cleTraitee) {
        setResultat(j.data);
        setEtape('resultat');
        return;
      }
      setMotifs(j?.data?.motifs ?? j?.data?.preflight?.motifs ?? []);
      setErreur(j?.error ?? 'La préparation a échoué. Réessayez.');
      setEtape('edition');
    } catch {
      setErreur('Connexion impossible. Réessayez.');
      setEtape('edition');
    }
  };

  const utiliser = () => {
    if (!resultat || !resultat.preflight.ok) return;
    props.onPret({ cleOriginal: resultat.cleOriginal, cleTraitee: resultat.cleTraitee, infos: resultat.infos });
  };

  // ── La scène : la vidéo locale, tournée, avec le cadre ────────────────
  const permute = rotation === 90 || rotation === 270;
  const styleVideo = useCallback((filtre: string): CSSProperties => ({
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: permute ? `${(tournees.hauteur / tournees.largeur) * 100}%` : '100%',
    height: permute ? `${(tournees.largeur / tournees.hauteur) * 100}%` : '100%',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    objectFit: 'fill',
    filter: filtre,
  }), [permute, rotation, tournees.hauteur, tournees.largeur]);

  const filtreApres = filtreCssApercu(amelioration);

  return (
    <div data-preparation-source={etape} className="card-base space-y-4 p-4 sm:p-5 max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">Préparer ma vidéo</h3>
        <button type="button" data-preparation-annuler onClick={props.onAnnuler} aria-label="Annuler la préparation" className="rounded-full p-1.5 text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {etape === 'envoi' && (
        <div data-preparation-envoi className="space-y-2" role="status" aria-live="polite">
          <p className="text-sm text-gray-300 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Envoi de la vidéo d’origine…</p>
          <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-purple-500 transition-[width]" style={{ width: `${progression?.pourcentage ?? 0}%` }} />
          </div>
          <p data-preparation-progression className="text-xs text-gray-500">
            {progression ? `${progression.pourcentage} % — ${detailEnvoi(progression)}` : 'Démarrage…'}
          </p>
        </div>
      )}

      {etape === 'refus' && (
        <div data-preparation-refus className="space-y-3">
          <div className="rounded-xl bg-red-500/10 p-3 space-y-1.5">
            <p className="text-sm font-medium text-red-200 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Cette vidéo ne peut pas servir de source</p>
            <ul className="text-xs text-red-200/90 space-y-1 list-disc pl-5">{motifs.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
          <button type="button" onClick={props.onAnnuler} className="button-primary w-full py-2.5 text-sm">Choisir une autre vidéo</button>
        </div>
      )}

      {etape === 'erreur' && (
        <div data-preparation-erreur className="space-y-3">
          <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{erreur}</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={props.onAnnuler} className="rounded-xl bg-gray-800 py-2.5 text-sm">Annuler</button>
            <button type="button" onClick={() => setEssai((n) => n + 1)} className="button-primary py-2.5 text-sm">Réessayer</button>
          </div>
        </div>
      )}

      {(etape === 'edition' || etape === 'traitement') && original && (
        <div data-preparation-editeur className="space-y-4">
          {original.preflight.avertissements.length > 0 && (
            <ul className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
              {original.preflight.avertissements.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}

          {/* La scène */}
          <div
            ref={scene}
            data-preparation-scene
            className="relative mx-auto overflow-hidden rounded-2xl bg-black select-none"
            style={{ aspectRatio: `${tournees.largeur} / ${tournees.hauteur}`, width: `min(100%, calc(58vh * ${tournees.largeur} / ${tournees.hauteur}))` }}
          >
            {urlLocale && (
              <video
                ref={video}
                data-preparation-video="locale"
                src={urlLocale}
                muted={false}
                playsInline
                preload="auto"
                onTimeUpdate={surTemps}
                onPause={() => setLecture(false)}
                style={styleVideo(comparer ? 'none' : filtreApres)}
              />
            )}
            {comparer && (
              <>
                <div
                  data-preparation-comparaison
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 border-l-2 border-white/80"
                  style={{ left: '50%', backdropFilter: filtreApres, WebkitBackdropFilter: filtreApres }}
                />
                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">Avant</span>
                <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-purple-600/80 px-2 py-0.5 text-xs text-white">Après</span>
              </>
            )}
            {/* Le cadre : tout ce qui est hors du cadre est assombri. */}
            <div
              data-preparation-cadre
              role={section === 'recadrer' ? 'group' : undefined}
              aria-label={section === 'recadrer' ? 'Cadre — faites-le glisser, ou utilisez les flèches du clavier' : undefined}
              tabIndex={section === 'recadrer' ? 0 : -1}
              onPointerDown={debutGlisse}
              onPointerMove={pendantGlisse}
              onPointerUp={finGlisse}
              onPointerCancel={finGlisse}
              onKeyDown={section === 'recadrer' ? clavierCadre : undefined}
              className={`absolute border-2 ${section === 'recadrer' ? 'border-white cursor-move' : 'border-white/40 pointer-events-none'}`}
              style={{
                left: pourcent(cadre.x), top: pourcent(cadre.y), width: pourcent(cadre.largeur), height: pourcent(cadre.hauteur),
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', touchAction: 'none',
              }}
            >
              {section === 'recadrer' && <OvaleVisage attribut="data-preparation-ovale" voile={false} legende="Visage dans l’ovale" />}
            </div>
          </div>

          {/* Les trois sections */}
          <div role="tablist" aria-label="Réglages" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-900/70 p-1">
            {([['recadrer', 'Recadrer', Crop], ['couper', 'Couper', Scissors], ['ameliorer', 'Améliorer', Sparkles]] as const).map(([cle, libelle, Icone]) => (
              <button
                key={cle}
                type="button"
                role="tab"
                aria-selected={section === cle}
                data-preparation-section={cle}
                onClick={() => setSection(cle)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs sm:text-sm ${section === cle ? 'bg-purple-600 text-white' : 'text-gray-300 hover:text-white'}`}
              >
                <Icone className="w-4 h-4" /> {libelle}
              </button>
            ))}
          </div>

          {section === 'recadrer' && (
            <div role="tabpanel" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {RATIOS_CADRE.map((r) => (
                  <button key={r} type="button" data-preparation-ratio={r} aria-pressed={ratio === r} onClick={() => { setRatio(r); setZoom(1); }}
                    className={`rounded-lg px-3 py-1.5 text-xs ${ratio === r ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                    {LIBELLES_RATIO[r]}
                  </button>
                ))}
              </div>
              <label className="block space-y-1 text-xs text-gray-400">
                <span>Zoom</span>
                <input
                  data-preparation-zoom
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(((1 - Math.max(zoom, zoomMin)) / Math.max(0.0001, 1 - zoomMin)) * 100) || 0}
                  disabled={zoomMin >= 1}
                  onChange={(e) => setZoom(1 - (Number(e.target.value) / 100) * (1 - zoomMin))}
                  className="w-full accent-purple-500"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" data-preparation-pivoter="gauche" onClick={() => pivoter(-1)} aria-label="Pivoter de 90° vers la gauche" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-2 text-xs"><RotateCcw className="w-4 h-4" /> 90°</button>
                <button type="button" data-preparation-pivoter="droite" onClick={() => pivoter(1)} aria-label="Pivoter de 90° vers la droite" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-2 text-xs"><RotateCw className="w-4 h-4" /> 90°</button>
                <button type="button" data-preparation-centrer onClick={centrer} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-2 text-xs"><Crosshair className="w-4 h-4" /> Centrer</button>
              </div>
              <p className="text-xs text-gray-500">Gardez tout le visage dans l’ovale, épaules comprises. Le cadre ne descend jamais sous 640 px.</p>
            </div>
          )}

          {section === 'couper' && (
            <div role="tabpanel" className="space-y-3">
              <div
                ref={piste}
                data-preparation-piste
                onPointerDown={(e) => { const t = tempsDepuisPointeur(e.clientX); if (t !== null) allerA(t); }}
                className="relative h-10 rounded-lg bg-gray-800"
                style={{ touchAction: 'none' }}
              >
                <div className="absolute inset-y-0 rounded-lg bg-purple-500/30 border-y-2 border-purple-400" style={{ left: pourcent(dureeTotale ? debutS / dureeTotale : 0), width: pourcent(dureeTotale ? dureeRetenue / dureeTotale : 0) }} />
                <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pourcent(dureeTotale ? borne(temps / dureeTotale, 0, 1) : 0) }} />
                {(['debut', 'fin'] as const).map((q) => {
                  const valeur = q === 'debut' ? debutS : finS;
                  return (
                    <div
                      key={q}
                      role="slider"
                      tabIndex={0}
                      data-preparation-poignee={q}
                      aria-label={q === 'debut' ? 'Début de la coupe' : 'Fin de la coupe'}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(dureeTotale)}
                      aria-valuenow={Math.round(valeur * 10) / 10}
                      aria-valuetext={formaterDuree(valeur)}
                      {...poignee(q)}
                      className="absolute top-0 h-full w-4 -ml-2 cursor-ew-resize rounded-md bg-white shadow focus:outline-none focus:ring-2 focus:ring-purple-400"
                      style={{ left: pourcent(dureeTotale ? valeur / dureeTotale : 0), touchAction: 'none' }}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-300">
                <span data-preparation-coupe>Début {formaterDuree(debutS)} · Fin {formaterDuree(finS)} · <strong className="text-white">{formaterDuree(dureeRetenue)}</strong> retenues</span>
                <span className="text-gray-500">Position {formaterDuree(temps)}</span>
              </div>
              {coupeInvalide && (
                <p data-preparation-coupe-invalide className="text-xs text-amber-200">
                  {dureeRetenue < EXIGENCES_SOURCE_VIDEO.dureeMinS
                    ? `Gardez au moins ${EXIGENCES_SOURCE_VIDEO.dureeMinS} secondes (idéalement 2 minutes).`
                    : `${EXIGENCES_SOURCE_VIDEO.dureeMaxS / 60} minutes maximum.`}
                </p>
              )}
              <button type="button" data-preparation-lire onClick={lireSelection} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-800 px-4 py-2 text-sm">
                {lecture ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Lire la sélection</>}
              </button>
            </div>
          )}

          {section === 'ameliorer' && (
            <div role="tabpanel" className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-xl bg-gray-900/60 px-4 py-3 text-sm cursor-pointer">
                <span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-300" /> Amélioration automatique</span>
                <input data-preparation-auto type="checkbox" role="switch" checked={amelioration.active} onChange={(e) => basculerAuto(e.target.checked)} className="accent-purple-500 w-4 h-4" />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-gray-900/60 px-4 py-3 text-sm cursor-pointer">
                <span className="flex items-center gap-2"><Columns2 className="w-4 h-4 text-purple-300" /> Comparer avec l’original</span>
                <input data-preparation-comparer type="checkbox" role="switch" checked={comparer} onChange={(e) => setComparer(e.target.checked)} className="accent-purple-500 w-4 h-4" />
              </label>
              {amelioration.active && (
                <p data-preparation-reglages-auto className="text-xs text-gray-400">
                  Lumière {amelioration.luminosite >= 0 ? '+' : ''}{Math.round(amelioration.luminosite * 100)} · Contraste {Math.round((amelioration.contraste - 1) * 100)} % · Netteté {amelioration.nettete > 0 ? 'légère' : 'inchangée'}{amelioration.debruitage ? ' · Grain réduit' : ''}
                </p>
              )}
              <p className="text-xs text-gray-500">Corrections naturelles uniquement : lumière, contraste, netteté. Aucun filtre beauté, aucune retouche du visage.</p>
            </div>
          )}

          {(erreur || motifs.length > 0) && etape === 'edition' && (
            <div data-preparation-echec className="rounded-xl bg-red-500/10 p-3 text-xs text-red-200 space-y-1">
              {erreur && <p className="font-medium">{erreur}</p>}
              {motifs.length > 0 && <ul className="list-disc pl-5 space-y-0.5">{motifs.map((m) => <li key={m}>{m}</li>)}</ul>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={props.onAnnuler} className="rounded-xl bg-gray-800 py-3 text-sm">Annuler</button>
            <button
              type="button"
              data-preparation-previsualiser
              onClick={() => void preparer()}
              disabled={etape === 'traitement' || coupeInvalide}
              className="button-primary inline-flex items-center justify-center gap-1.5 py-3 text-sm disabled:opacity-40"
            >
              {etape === 'traitement' ? <><Loader2 className="w-4 h-4 animate-spin" /> Préparation…</> : 'Prévisualiser'}
            </button>
          </div>
          {etape === 'traitement' && (
            <p role="status" aria-live="polite" className="text-xs text-center text-gray-400">Le serveur prépare votre vidéo. Cela peut prendre une minute.</p>
          )}
        </div>
      )}

      {etape === 'resultat' && resultat && (() => {
        const qualite = LIBELLES_QUALITE[niveauQualite(resultat.preflight)];
        const { largeurEffective: l, hauteurEffective: h } = resultat.infos;
        return (
          <div data-preparation-resultat className="space-y-4">
            <div className="relative mx-auto overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: `${l || 9} / ${h || 16}`, width: `min(100%, calc(58vh * ${l || 9} / ${h || 16}))` }}>
              <video
                data-preparation-video="preparee"
                src={`/api/avatar/sources/apercu?cle=${encodeURIComponent(resultat.cleTraitee)}`}
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 w-full h-full object-contain"
              />
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-xl bg-gray-900/60 p-2.5"><dt className="text-gray-500">Durée</dt><dd data-preparation-duree className="text-white">{formaterDuree(resultat.infos.dureeS)}</dd></div>
              <div className="rounded-xl bg-gray-900/60 p-2.5"><dt className="text-gray-500">Résolution</dt><dd data-preparation-resolution className="text-white">{l} × {h}</dd></div>
              <div className="rounded-xl bg-gray-900/60 p-2.5"><dt className="text-gray-500">Cadrage</dt><dd className="text-white">{libelleCadrage(l, h)}</dd></div>
              <div className="rounded-xl bg-gray-900/60 p-2.5"><dt className="text-gray-500">Qualité</dt><dd><span data-preparation-qualite={niveauQualite(resultat.preflight)} className={`inline-block rounded-full px-2 py-0.5 ${qualite.classe}`}>{qualite.texte}</span></dd></div>
            </dl>
            {resultat.preflight.avertissements.length > 0 && (
              <ul className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                {resultat.preflight.avertissements.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}
            <p className="text-xs text-gray-500">Votre vidéo d’origine est conservée telle quelle.</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" data-preparation-modifier onClick={() => setEtape('edition')} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-3 text-sm"><ArrowLeft className="w-4 h-4" /> Modifier</button>
              <button type="button" data-preparation-utiliser onClick={utiliser} disabled={!resultat.preflight.ok} className="button-primary inline-flex items-center justify-center gap-1.5 py-3 text-sm disabled:opacity-40"><Check className="w-4 h-4" /> Utiliser cette vidéo</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

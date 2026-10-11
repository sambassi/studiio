'use client';

/**
 * APERÇU DU MONTAGE — la séquence « Vidéo » d'une liste multi-sources, jouée
 * dans l'ordre de la liste, puis la carte CTA.
 *
 * Lecteur LOCAL et léger : aucun rendu serveur, aucun appel à un fournisseur,
 * aucune génération. Les étapes sont les items de `planDetaille` — le MÊME
 * plan que celui passé à `composeVideo` à l'envoi (`planDepuisListe`) : ce qui
 * s'affiche, ce qui se regarde et ce qui se rend durent pareil.
 *
 *  - vidéo : muette, depuis son point d'entrée, coupée à sa durée ;
 *  - photo : en « cover », avec le Ken Burns du rendu ;
 *  - avatar produit : sa vidéo ; pas encore produit : sa vignette et le badge
 *    « Votre avatar parlera ici » (aucune parole simulée) ;
 *  - puis la carte CTA.
 *
 * Sous le lecteur, la chronologie (« Rush personnel 0–4 s · Photo suggérée
 * 4–9 s · CTA 9–13 s ») : l'étape en cours est surlignée, un clic y saute.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Pause, Play, RotateCcw, UserRound } from 'lucide-react';
import { formatSecondes, type EtapeApercu, type LigneChronologie } from '@/lib/creer/medias-video';
import { transformeKenBurns } from '@/lib/creer/ken-burns';

export type FormatApercuMontage = '9:16' | '16:9' | '1:1';
const RATIO: Record<FormatApercuMontage, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };

export interface ApercuMontageListeProps {
  etapes: ReadonlyArray<EtapeApercu>;
  /** Chronologie (même plan) : séquence Vidéo puis CTA. */
  lignes: ReadonlyArray<LigneChronologie>;
  format: FormatApercuMontage;
  accent: string;
  /** Texte du CTA (carte finale). */
  ctaTexte?: string | null;
  ctaSousTexte?: string | null;
  /** Vignette de l'avatar (source de sa version active), déjà lue — jamais demandée ici. */
  vignetteAvatar?: { url: string; type: 'photo' | 'video' } | null;
  /** Avec avatar : la narration (durée, « estimée » ou « réelle ») qui fixe la séquence. */
  narration?: { duree: number; source: 'estimee' | 'reelle' } | null;
  /** Avec avatar : de combien les médias dépassent la narration (s) — 0 : ils tiennent. */
  depassement?: number;
}

const mmss = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function ApercuMontageListe(p: ApercuMontageListeProps) {
  // Le calendrier joué : les étapes de la séquence Vidéo, puis le CTA.
  const calendrier = p.lignes;
  const total = calendrier.length ? calendrier[calendrier.length - 1].fin : 0;
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  tRef.current = t;
  const [lecture, setLecture] = useState(false);
  /** Incrémenté à chaque saut (clic sur la chronologie, « Revoir ») : la lecture repart de `t`. */
  const [saut, setSaut] = useState(0);

  // Une durée réduite pendant la pause : on reste dans la nouvelle chronologie.
  useEffect(() => { if (tRef.current > total) setT(total); }, [total]);

  useEffect(() => {
    if (!lecture) return;
    const depart = Date.now();
    const t0 = tRef.current;
    const id = setInterval(() => {
      const nt = t0 + (Date.now() - depart) / 1000;
      if (nt >= total) { setT(total); setLecture(false); return; }
      setT(nt);
    }, 50);
    return () => clearInterval(id);
  }, [lecture, total, saut]);

  const indexCourant = useMemo(() => {
    if (!calendrier.length) return -1;
    const i = calendrier.findIndex((l) => t < l.fin);
    return i < 0 ? calendrier.length - 1 : i;
  }, [calendrier, t]);
  const ligne = indexCourant >= 0 ? calendrier[indexCourant] : null;
  const etape = ligne && !ligne.cta ? p.etapes.find((e) => e.id === ligne.id) ?? null : null;

  const sauterA = (x: number) => { setT(Math.max(0, Math.min(total, x))); tRef.current = x; setSaut((n) => n + 1); };
  const basculer = () => {
    if (lecture) { setLecture(false); return; }
    if (tRef.current >= total - 0.01) sauterA(0);
    setLecture(true);
  };

  // La vidéo de l'étape suit la lecture (muette, depuis son point d'entrée).
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const positionner = (el: HTMLVideoElement | null) => {
    if (!el || !etape) return;
    try { el.currentTime = Math.max(0, etape.depuis + (tRef.current - etape.debut)); } catch { /* métadonnées absentes */ }
  };
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (lecture) { positionner(el); el.play?.()?.catch?.(() => {}); } else el.pause?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture, etape?.id, saut]);

  const progresEtape = etape ? Math.min(1, Math.max(0, (t - etape.debut) / Math.max(0.001, etape.fin - etape.debut))) : 0;

  let cadre: JSX.Element;
  if (!ligne) {
    cadre = <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500">Aucun média</div>;
  } else if (ligne.cta) {
    cadre = (
      <div data-apercu-montage-cta className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-gray-950">
        <span className="rounded-full px-4 py-2 text-sm font-bold text-white break-words max-w-full" style={{ backgroundColor: p.accent }}>
          {p.ctaTexte || 'CTA'}
        </span>
        {p.ctaSousTexte ? <span className="text-[11px] text-gray-300 break-words max-w-full">{p.ctaSousTexte}</span> : null}
      </div>
    );
  } else if (etape && etape.source === 'avatar' && !etape.url) {
    cadre = (
      <div data-apercu-montage-avatar="a-produire" className="absolute inset-0">
        {p.vignetteAvatar?.type === 'photo' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.vignetteAvatar.url} alt="" className="w-full h-full object-cover" />
        ) : p.vignetteAvatar?.type === 'video' ? (
          <video src={`${p.vignetteAvatar.url}#t=0.1`} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-500"><UserRound className="w-8 h-8" /></div>
        )}
        <span className="absolute left-1/2 bottom-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white ring-1 ring-white/15">
          Votre avatar parlera ici
        </span>
      </div>
    );
  } else if (etape && etape.type === 'image' && etape.url) {
    const kb = transformeKenBurns(etape.mouvement, progresEtape);
    cadre = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={etape.id} src={etape.url} alt="" data-apercu-montage-photo
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: kb.css, transformOrigin: 'center' }}
      />
    );
  } else if (etape && etape.url) {
    cadre = (
      <video
        key={`${etape.id}-${saut}`} ref={videoRef} src={etape.url} data-apercu-montage-video
        muted playsInline preload="auto"
        onLoadedMetadata={(e) => { positionner(e.currentTarget); if (lecture) e.currentTarget.play?.()?.catch?.(() => {}); }}
        className="absolute inset-0 w-full h-full object-cover"
      />
    );
  } else {
    cadre = <div className="absolute inset-0 bg-gray-900" />;
  }

  return (
    <section
      data-apercu-montage
      data-lecture={lecture ? 'oui' : 'non'}
      data-etape-courante={ligne?.id ?? ''}
      className="mt-3 rounded-xl bg-gray-900/50 ring-1 ring-white/10 p-3 space-y-2 min-w-0"
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-100">Aperçu du montage</h3>
          <p className="text-[11px] text-gray-500">Séquence Vidéo dans l&apos;ordre de la liste, puis le CTA.</p>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums flex-shrink-0" data-apercu-montage-temps>{mmss(t)} / {mmss(total)}</span>
      </div>
      <div
        className="relative mx-auto overflow-hidden rounded-lg bg-black ring-1 ring-white/10"
        style={{ aspectRatio: RATIO[p.format], width: '100%', maxWidth: p.format === '16:9' ? 420 : p.format === '1:1' ? 300 : 220 }}
      >
        {cadre}
        <div className="absolute left-0 right-0 bottom-0 h-1 bg-white/10">
          <div className="h-full" style={{ width: `${total > 0 ? (t / total) * 100 : 0}%`, backgroundColor: p.accent }} />
        </div>
      </div>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button" onClick={basculer} data-apercu-montage-lecture
          aria-label={lecture ? 'Mettre en pause' : 'Lire le montage'}
          title={lecture ? 'Pause' : 'Lire'}
          className="flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-[11px] font-medium text-gray-100 transition"
        >
          {lecture ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {lecture ? 'Pause' : 'Lire'}
        </button>
        <button
          type="button" onClick={() => { sauterA(0); }} data-apercu-montage-revoir
          aria-label="Revoir depuis le début" title="Revoir depuis le début"
          className="flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-3 py-1.5 text-[11px] font-medium text-gray-100 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Revoir
        </button>
      </div>
      <ol data-chronologie className="flex flex-wrap gap-1 min-w-0" aria-label="Chronologie du montage">
        {calendrier.map((l, k) => {
          const courant = k === indexCourant;
          return (
            <li key={l.id} className="min-w-0 max-w-full">
              <button
                type="button"
                data-ligne={l.id}
                data-debut={l.debut}
                data-fin={l.fin}
                data-hors-narration={l.horsNarration ? 'oui' : undefined}
                aria-current={courant ? 'step' : undefined}
                onClick={() => sauterA(l.debut)}
                className={`max-w-full truncate rounded-md px-2 py-1 text-[10px] tabular-nums transition ${courant ? 'bg-studiio-primary/25 text-white ring-1 ring-studiio-primary/60' : 'bg-gray-800/70 text-gray-300 hover:bg-gray-800'} ${l.horsNarration ? 'ring-1 ring-amber-400/70' : ''}`}
              >
                {l.libelle} {formatSecondes(l.debut)}–{formatSecondes(l.fin)} s
              </button>
            </li>
          );
        })}
      </ol>
      {p.narration && (
        <p
          data-chronologie-narration={p.narration.source}
          data-narration-duree={p.narration.duree}
          className={`text-[10px] ${p.depassement && p.depassement > 0 ? 'text-amber-300' : 'text-gray-500'}`}
        >
          {p.depassement && p.depassement > 0 ? <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" /> : null}
          Narration {p.narration.source === 'reelle' ? 'réelle' : 'estimée'} de votre avatar : {formatSecondes(p.narration.duree)} s
          {p.depassement && p.depassement > 0
            ? ` — vos médias la dépassent de ${formatSecondes(Math.ceil(p.depassement * 10 - 1e-6) / 10)} s : raccourcissez-les avant d’envoyer.`
            : '. Vos médias gardent leur durée ; votre avatar occupe le reste.'}
        </p>
      )}
    </section>
  );
}

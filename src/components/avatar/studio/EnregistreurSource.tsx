'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Circle, Maximize2, Mic, Pause, Play, RotateCcw, Square, Check, ChevronDown } from 'lucide-react';
import Prompteur, { REGLAGES_PROMPTEUR_DEFAUT, type ReglagesPrompteur } from '@/components/avatar/studio/Prompteur';
import TexteAvecPrononciations from '@/components/avatar/studio/TexteAvecPrononciations';
import { choisirFormatEnregistrement, formaterDuree, messageErreurCamera, typeEtExtension } from '@/lib/avatar/studio';

/**
 * ENREGISTRER MA SOURCE — caméra + micro du navigateur (getUserMedia +
 * MediaRecorder), avec prompteur.
 *
 * Ce composant ne PRODUIT qu'un fichier. « Utiliser cette vidéo » le rend à
 * la page, qui le passe au parcours d'import EXISTANT (consentement, puis
 * `POST /api/avatar/create`). Rien n'est envoyé, rien n'est écrit en base
 * ici — l'avatar actif ne change qu'après entraînement et validation.
 */
type Phase = 'inactif' | 'demande' | 'pret' | 'decompte' | 'enregistrement' | 'apercu' | 'erreur';
const DUREE_MAX_S = 180;

export default function EnregistreurSource(props: {
  /** Le fournisseur de l'avatar vidéo n'accepte que le MP4. */
  mp4Requis: boolean;
  onUtiliser: (fichier: File) => void;
  onImporterAlaPlace: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('inactif');
  const [erreur, setErreur] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [micros, setMicros] = useState<MediaDeviceInfo[]>([]);
  const [camera, setCamera] = useState<string>('');
  const [micro, setMicro] = useState<string>('');
  const [niveauMicro, setNiveauMicro] = useState(0);
  const [decompte, setDecompte] = useState(3);
  const [duree, setDuree] = useState(0);
  const [prise, setPrise] = useState<{ url: string; fichier: File } | null>(null);
  const [texte, setTexte] = useState('');
  const [prompteurOuvert, setPrompteurOuvert] = useState(false);
  const [defilement, setDefilement] = useState(false);
  const [reglages, setReglages] = useState<ReglagesPrompteur>(REGLAGES_PROMPTEUR_DEFAUT);
  const [cleRemise, setCleRemise] = useState(0);

  const flux = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const cadre = useRef<HTMLDivElement | null>(null);
  const enregistreur = useRef<MediaRecorder | null>(null);
  const morceaux = useRef<Blob[]>([]);
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  const couper = useCallback(() => {
    flux.current?.getTracks().forEach((t) => t.stop());
    flux.current = null;
    if (minuteur.current) clearInterval(minuteur.current);
    minuteur.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }, []);
  useEffect(() => () => { couper(); }, [couper]);
  useEffect(() => () => { if (prise) URL.revokeObjectURL(prise.url); }, [prise]);

  const format = typeof MediaRecorder !== 'undefined'
    ? choisirFormatEnregistrement((m) => MediaRecorder.isTypeSupported(m), props.mp4Requis)
    : null;

  const ouvrir = useCallback(async (ids?: { camera?: string; micro?: string }) => {
    setErreur(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErreur('Votre navigateur ne permet pas d’enregistrer depuis la caméra. Importez une vidéo à la place.');
      setPhase('erreur');
      return;
    }
    if (!format) {
      setErreur(props.mp4Requis
        ? 'Ce navigateur n’enregistre pas en MP4, le format exigé pour l’avatar vidéo. Utilisez Safari, ou importez une vidéo MP4.'
        : 'Ce navigateur ne sait pas enregistrer de vidéo. Importez une vidéo à la place.');
      setPhase('erreur');
      return;
    }
    setPhase('demande');
    couper();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: ids?.camera ? { deviceId: { exact: ids.camera } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: ids?.micro ? { deviceId: { exact: ids.micro } } : true,
      });
      flux.current = s;
      if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      const appareils = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      setCameras(appareils.filter((d) => d.kind === 'videoinput'));
      setMicros(appareils.filter((d) => d.kind === 'audioinput'));
      setCamera(s.getVideoTracks()[0]?.getSettings().deviceId ?? '');
      setMicro(s.getAudioTracks()[0]?.getSettings().deviceId ?? '');
      // Indicateur micro : le niveau RÉEL du flux.
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx && s.getAudioTracks().length > 0) {
          const ctx = new Ctx();
          const analyse = ctx.createAnalyser();
          analyse.fftSize = 256;
          ctx.createMediaStreamSource(s).connect(analyse);
          audioCtx.current = ctx;
          const buf = new Uint8Array(analyse.frequencyBinCount);
          const lire = () => {
            if (audioCtx.current !== ctx) return;
            analyse.getByteTimeDomainData(buf);
            let max = 0;
            for (const v of buf) max = Math.max(max, Math.abs(v - 128));
            setNiveauMicro(Math.min(1, max / 64));
            requestAnimationFrame(lire);
          };
          requestAnimationFrame(lire);
        }
      } catch { /* l'indicateur est un confort */ }
      setPhase('pret');
    } catch (e) {
      couper();
      setErreur(messageErreurCamera((e as { name?: string } | null)?.name));
      setPhase('erreur');
    }
  }, [couper, format, props.mp4Requis]);

  const demarrer = () => {
    if (!flux.current || !format) return;
    setPhase('decompte');
    setDecompte(3);
    let n = 3;
    const t = setInterval(() => {
      n -= 1;
      if (n > 0) { setDecompte(n); return; }
      clearInterval(t);
      lancerEnregistrement();
    }, 1000);
  };

  const lancerEnregistrement = () => {
    if (!flux.current || !format) return;
    morceaux.current = [];
    const r = new MediaRecorder(flux.current, { mimeType: format });
    r.ondataavailable = (e) => { if (e.data && e.data.size > 0) morceaux.current.push(e.data); };
    r.onstop = () => {
      const { type, extension } = typeEtExtension(format);
      const blob = new Blob(morceaux.current, { type });
      const fichier = new File([blob], `ma-source-avatar.${extension}`, { type });
      setPrise({ url: URL.createObjectURL(blob), fichier });
      setDefilement(false);
      setPhase('apercu');
    };
    enregistreur.current = r;
    r.start(1000);
    setDuree(0);
    setCleRemise((k) => k + 1);
    if (texte.trim()) setDefilement(true);
    setPhase('enregistrement');
    const debut = Date.now();
    minuteur.current = setInterval(() => {
      const s = (Date.now() - debut) / 1000;
      setDuree(s);
      if (s >= DUREE_MAX_S) arreter();
    }, 250);
  };

  const arreter = () => {
    if (minuteur.current) clearInterval(minuteur.current);
    minuteur.current = null;
    if (enregistreur.current?.state === 'recording') enregistreur.current.stop();
  };

  const recommencer = () => {
    if (prise) URL.revokeObjectURL(prise.url);
    setPrise(null);
    setDuree(0);
    setCleRemise((k) => k + 1);
    setPhase('pret');
    if (video.current && flux.current) { video.current.srcObject = flux.current; void video.current.play().catch(() => {}); }
  };

  const utiliser = () => {
    if (!prise) return;
    const fichier = prise.fichier;
    couper();
    props.onUtiliser(fichier);
  };

  const pleinEcran = () => { void cadre.current?.requestFullscreen?.().catch(() => {}); };

  const enDirect = phase === 'pret' || phase === 'decompte' || phase === 'enregistrement' || phase === 'demande';

  return (
    <div data-enregistreur-source={phase} className="space-y-4">
      {phase === 'inactif' && (
        <div className="rounded-2xl bg-gray-900/60 p-5 space-y-3 text-center">
          <Camera className="w-8 h-8 mx-auto text-purple-300" />
          <p className="text-sm text-gray-300">Filmez-vous face caméra, dans un endroit calme et bien éclairé. Un prompteur peut vous aider à lire votre texte.</p>
          <button type="button" data-enregistreur-activer onClick={() => void ouvrir()} className="button-primary px-5 py-2.5 text-sm">Activer la caméra</button>
        </div>
      )}

      {phase === 'erreur' && (
        <div data-enregistreur-erreur className="rounded-2xl bg-red-500/10 p-4 space-y-3">
          <p className="text-sm text-red-200">{erreur}</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <button type="button" onClick={() => void ouvrir()} className="text-gray-300 hover:text-white">Réessayer</button>
            <button type="button" onClick={props.onImporterAlaPlace} className="text-purple-300 hover:text-purple-200">Importer une vidéo à la place</button>
          </div>
        </div>
      )}

      {/* Le cadre : aperçu caméra (en direct) ou la prise (aperçu). */}
      <div
        ref={cadre}
        className={`relative mx-auto overflow-hidden rounded-2xl bg-black ${enDirect || phase === 'apercu' ? '' : 'hidden'}`}
        // Toujours entier à l'écran : « Arrêter » reste visible sans défiler.
        style={{ aspectRatio: '9 / 16', width: 'min(100%, 420px, calc(70vh * 9 / 16))' }}
      >
        <video
          ref={video}
          data-enregistreur-video="direct"
          muted
          playsInline
          className={`absolute inset-0 w-full h-full object-cover ${phase === 'apercu' ? 'hidden' : ''}`}
          style={{ transform: 'scaleX(-1)' }}
        />
        {phase === 'apercu' && prise && (
          <video data-enregistreur-video="prise" src={prise.url} controls playsInline className="absolute inset-0 w-full h-full object-contain bg-black" />
        )}
        {(phase === 'pret' || phase === 'decompte' || phase === 'enregistrement') && (
          <Prompteur texte={texte} defilement={defilement} reglages={reglages} cleRemiseAZero={cleRemise} />
        )}
        {phase === 'decompte' && (
          <div data-enregistreur-decompte={decompte} className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="text-7xl font-bold text-white">{decompte}</span>
          </div>
        )}
        {phase === 'enregistrement' && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm text-white">
            <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
            <span data-enregistreur-duree>{formaterDuree(duree)}</span>
          </div>
        )}
        {enDirect && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1" title="Micro actif">
            <Mic className="w-3.5 h-3.5 text-white" />
            <span className="block h-1.5 w-12 rounded-full bg-white/20 overflow-hidden">
              <span data-enregistreur-micro className="block h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(niveauMicro * 100)}%` }} />
            </span>
          </div>
        )}
        {enDirect && (
          <button type="button" aria-label="Plein écran" onClick={pleinEcran} className="absolute top-3 right-3 rounded-full bg-black/50 p-1.5 text-white/80 hover:text-white">
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {phase === 'pret' && (
        <div className="space-y-4">
          {(cameras.length > 1 || micros.length > 1) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cameras.length > 1 && (
                <label className="text-xs text-gray-400 space-y-1 block">
                  <span>Caméra</span>
                  <select data-enregistreur-camera value={camera} onChange={(e) => { setCamera(e.target.value); void ouvrir({ camera: e.target.value, micro }); }} className="input-base w-full">
                    {cameras.map((c, i) => <option key={c.deviceId || i} value={c.deviceId}>{c.label || `Caméra ${i + 1}`}</option>)}
                  </select>
                </label>
              )}
              {micros.length > 1 && (
                <label className="text-xs text-gray-400 space-y-1 block">
                  <span>Micro</span>
                  <select data-enregistreur-micro-choix value={micro} onChange={(e) => { setMicro(e.target.value); void ouvrir({ camera, micro: e.target.value }); }} className="input-base w-full">
                    {micros.map((m, i) => <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Micro ${i + 1}`}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="rounded-2xl bg-gray-900/60">
            <button type="button" data-prompteur-ouvrir onClick={() => setPrompteurOuvert((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">Prompteur{texte.trim() ? ' — prêt' : ''}</span>
              <ChevronDown className={`w-4 h-4 transition ${prompteurOuvert ? 'rotate-180' : ''}`} />
            </button>
            {prompteurOuvert && (
              <div className="px-4 pb-4 space-y-3">
                <TexteAvecPrononciations valeur={texte} onChange={setTexte} rows={4} placeholder="Collez le texte à lire pendant l’enregistrement…" attributs={{ 'data-prompteur-texte': '' }} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-gray-400">
                  <label className="space-y-1 block"><span>Vitesse</span>
                    <input data-prompteur-vitesse type="range" min={1} max={10} value={reglages.vitesse} onChange={(e) => setReglages({ ...reglages, vitesse: Number(e.target.value) })} className="w-full accent-purple-500" />
                  </label>
                  <label className="space-y-1 block"><span>Taille du texte</span>
                    <input data-prompteur-taille type="range" min={18} max={48} value={reglages.taille} onChange={(e) => setReglages({ ...reglages, taille: Number(e.target.value) })} className="w-full accent-purple-500" />
                  </label>
                  <label className="flex items-center gap-2 pt-4 cursor-pointer">
                    <input data-prompteur-miroir type="checkbox" checked={reglages.miroir} onChange={(e) => setReglages({ ...reglages, miroir: e.target.checked })} className="accent-purple-500" />
                    <span>Texte en miroir</span>
                  </label>
                </div>
                <p className="text-xs text-gray-500">Le texte défile en haut de l’image, près de l’objectif. Il n’apparaît pas dans la vidéo enregistrée.</p>
              </div>
            )}
          </div>

          <button type="button" data-enregistreur-demarrer onClick={demarrer} className="button-primary w-full py-3 flex items-center justify-center gap-2">
            <Circle className="w-4 h-4 fill-current" /> Commencer l’enregistrement
          </button>
        </div>
      )}

      {phase === 'enregistrement' && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {texte.trim() && (
            <button type="button" data-prompteur-lecture onClick={() => setDefilement((d) => !d)} className="inline-flex items-center gap-1.5 rounded-xl bg-gray-800 px-4 py-2.5 text-sm">
              {defilement ? <><Pause className="w-4 h-4" /> Pause du texte</> : <><Play className="w-4 h-4" /> Reprendre le texte</>}
            </button>
          )}
          <button type="button" data-enregistreur-arreter onClick={arreter} className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white">
            <Square className="w-4 h-4 fill-current" /> Arrêter
          </button>
        </div>
      )}

      {phase === 'apercu' && prise && (
        <div className="space-y-3">
          <p className="text-xs text-center text-gray-400">{formaterDuree(duree)} — {Math.max(1, Math.round(prise.fichier.size / 1024 / 1024))} Mo. Rien n’est envoyé tant que vous ne l’avez pas choisie.</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" data-enregistreur-recommencer onClick={recommencer} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gray-800 py-3 text-sm">
              <RotateCcw className="w-4 h-4" /> Recommencer
            </button>
            <button type="button" data-enregistreur-utiliser onClick={utiliser} className="button-primary inline-flex items-center justify-center gap-1.5 py-3 text-sm">
              <Check className="w-4 h-4" /> Utiliser cette vidéo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

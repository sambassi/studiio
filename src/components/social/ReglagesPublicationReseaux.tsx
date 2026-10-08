'use client';

import { useEffect, useRef, useState } from 'react';
import { ImageIcon, Film, Sparkles, Trash2, Loader2, Info } from 'lucide-react';
import { uploadPosterFile } from '@/lib/creer/posterUpload';
import {
  CONFIDENTIALITE_SECURITE, LIBELLES_CONFIDENTIALITE, resumeCouverture,
  type ConfidentialiteTiktok, type Couverture, type ModeCouverture, type ReglagesTiktok, type ReseauCouverture,
} from '@/lib/social/couverture';

/**
 * « Miniature / couverture » + réglages TikTok — UNE zone, partagée par le
 * Calendrier (montage existant : choix d'un moment dans la vidéo) et l'étape
 * Envoi de Créer (montage pas encore rendu : image ou automatique).
 *
 * Aucune logique d'API ici : la traduction par réseau vit dans
 * `lib/social/couverture.ts`, l'écran n'en montre que le résumé.
 */

export interface ValeurReglagesPublication {
  cover: Couverture | null;
  tiktok: ReglagesTiktok | null;
}

interface InfoTiktok {
  fiable: boolean;
  nickname: string | null;
  confidentialites: ConfidentialiteTiktok[];
  interactions: null | Record<'allow_comment' | 'allow_duet' | 'allow_stitch', { enabled: boolean; default: boolean | null }>;
}

/** Formats et poids acceptés pour une image de couverture (le plus strict des réseaux visés reste 10 Mo, YouTube 2 Mo). */
export const TYPES_IMAGE_COUVERTURE = ['image/jpeg', 'image/png', 'image/webp'];
export const POIDS_MAX_COUVERTURE = 10 * 1024 * 1024;

/** Contrôle d'une image choisie — pur, testé. */
export function verifierImageCouverture(f: { type: string; size: number }): string | null {
  if (!TYPES_IMAGE_COUVERTURE.includes(f.type)) return 'Format non accepté : JPEG, PNG ou WebP.';
  if (f.size > POIDS_MAX_COUVERTURE) return 'Image trop lourde : 10 Mo maximum.';
  return null;
}

const formatMs = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

export default function ReglagesPublicationReseaux({
  reseaux, format, videoUrl, value, onChange,
}: {
  reseaux: ReseauCouverture[];
  format: string | null | undefined;
  /** Montage déjà rendu : permet de choisir un moment. Absent (Créer) : choix d'un moment désactivé. */
  videoUrl?: string | null;
  value: ValeurReglagesPublication;
  /**
   * ⚠️ REÇOIT LA SEULE PARTIE MODIFIÉE (`{ cover }` ou `{ tiktok }`), que le
   * parent fusionne. Renvoyer la valeur entière, calculée sur un `value`
   * périmé, écrasait l'autre moitié : la lecture asynchrone des réglages
   * TikTok effaçait une couverture choisie entre-temps.
   */
  onChange: (modif: Partial<ValeurReglagesPublication>) => void;
}) {
  const cover = value.cover;
  const mode: ModeCouverture = cover?.mode ?? 'auto';
  const [erreurImage, setErreurImage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [dureeMs, setDureeMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avecTiktok = reseaux.includes('tiktok');
  const [infoTt, setInfoTt] = useState<InfoTiktok | null>(null);

  // Libellés du sélecteur calés sur la largeur RÉELLE de la zone (une fenêtre
  // « Modifier le Post » est étroite même sur grand écran) : jamais tronqués.
  const selecteurRef = useRef<HTMLDivElement | null>(null);
  const [largeurSelecteur, setLargeurSelecteur] = useState(0);
  useEffect(() => {
    const el = selecteurRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setLargeurSelecteur(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [reseaux.length]);
  const tailleLibelle: 'long' | 'moyen' | 'court' =
    largeurSelecteur === 0 || largeurSelecteur >= 470 ? 'long' : largeurSelecteur >= 300 ? 'moyen' : 'court';

  // Réglages autorisés du compte TikTok — lus une fois, seulement si TikTok est visé.
  useEffect(() => {
    if (!avecTiktok || infoTt) return;
    let annule = false;
    fetch('/api/social/zernio/tiktok')
      .then((r) => r.json())
      .then((j) => {
        if (annule) return;
        const info: InfoTiktok = {
          fiable: !!j?.fiable,
          nickname: j?.nickname ?? null,
          confidentialites: Array.isArray(j?.confidentialites) && j.confidentialites.length ? j.confidentialites : [CONFIDENTIALITE_SECURITE],
          interactions: j?.interactions ?? null,
        };
        setInfoTt(info);
        // Première ouverture : des valeurs EXPLICITES, visibles ci-dessous —
        // « Moi uniquement » si proposé, interactions selon le compte, sinon
        // désactivées. Le consentement, lui, reste NON coché.
        if (!value.tiktok) {
          const d = (k: 'allow_comment' | 'allow_duet' | 'allow_stitch') => {
            const i = info.interactions?.[k];
            return !!i && i.enabled && i.default === true;
          };
          onChange({
            tiktok: {
              privacy_level: info.confidentialites.includes(CONFIDENTIALITE_SECURITE) ? CONFIDENTIALITE_SECURITE : info.confidentialites[0],
              allow_comment: d('allow_comment'), allow_duet: d('allow_duet'), allow_stitch: d('allow_stitch'),
              consentement: false,
            },
          });
        }
      })
      .catch(() => { if (!annule) setInfoTt({ fiable: false, nickname: null, confidentialites: [CONFIDENTIALITE_SECURITE], interactions: null }); });
    return () => { annule = true; };
    // `value`/`onChange` : lus au moment de la réponse, pas des déclencheurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avecTiktok, infoTt]);

  const choisirMode = (m: ModeCouverture) => {
    setErreurImage(null);
    if (m === 'auto') onChange({ cover: { mode: 'auto' } });
    else if (m === 'frame') onChange({ cover: { mode: 'frame', frameMs: cover?.mode === 'frame' ? cover.frameMs : 1000 } });
    else onChange({ cover: cover?.mode === 'upload' ? cover : { mode: 'upload' } });
  };

  const envoyerImage = async (f: File) => {
    const refus = verifierImageCouverture(f);
    if (refus) { setErreurImage(refus); return; }
    setEnvoi(true);
    setErreurImage(null);
    try {
      const r = await uploadPosterFile(f);
      // Un repli `data:` n'est PAS une adresse publique : les réseaux ne
      // pourraient pas aller chercher l'image.
      if (r.dataUrl) { setErreurImage('Envoi de l’image impossible. Réessayez.'); return; }
      onChange({ cover: { mode: 'upload', imageUrl: r.url } });
    } finally {
      setEnvoi(false);
    }
  };

  const tt = value.tiktok;
  const majTt = (patch: Partial<ReglagesTiktok>) => tt && onChange({ tiktok: { ...tt, ...patch } });

  if (reseaux.length === 0) return null;

  // ── Styles partagés (une seule source, pour une zone sobre et cohérente) ──
  const carte = 'rounded-2xl bg-white/[0.025] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]';
  const titre = 'text-[11px] font-medium uppercase tracking-[0.08em] text-gray-400';
  const sousTitre = 'text-[11px] font-medium text-gray-500';
  const lienDiscret = 'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-white/5 hover:text-white';

  return (
    <div className="space-y-3" data-reglages-publication>
      {/* ── Miniature / couverture ─────────────────────────────────────── */}
      <section className={carte} data-couverture>
        <p className={titre}>Miniature / couverture</p>

        {/* Segmented control : un seul fond, l'option active s'en détache. */}
        <div
          ref={selecteurRef}
          className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-black/25 p-1"
          role="radiogroup"
          aria-label="Miniature / couverture"
        >
          {([
            ['auto', 'Automatique', 'Automatique', 'Auto', Sparkles],
            ['upload', 'Choisir une image', 'Image', 'Image', ImageIcon],
            ['frame', 'Image dans la vidéo', 'Dans la vidéo', 'Vidéo', Film],
          ] as const).map(([m, libelle, moyen, court, Icone]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-label={libelle}
              data-couverture-mode={m}
              onClick={() => choisirMode(m)}
              className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-all ${
                mode === m
                  ? 'bg-white/[0.08] text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {/* Très étroit : le libellé seul, l'icône céderait la place. */}
              {tailleLibelle !== 'court' && <Icone size={13} className="shrink-0" />}
              <span className="truncate">{{ long: libelle, moyen, court }[tailleLibelle]}</span>
            </button>
          ))}
        </div>

        {mode === 'upload' && (
          <div className="mt-4" data-couverture-upload>
            {cover?.imageUrl ? (
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.imageUrl} alt="Couverture choisie" className="h-20 w-auto max-w-[45%] rounded-lg object-cover ring-1 ring-white/10" />
                <div className="flex flex-col items-start gap-0.5">
                  <label className={`${lienDiscret} cursor-pointer`}>
                    <ImageIcon size={12} /> Remplacer
                    <input type="file" accept={TYPES_IMAGE_COUVERTURE.join(',')} className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void envoyerImage(f); e.target.value = ''; }} />
                  </label>
                  <button type="button" className={`${lienDiscret} hover:text-red-300`}
                    onClick={() => onChange({ cover: { mode: 'auto' } })} data-couverture-supprimer>
                    <Trash2 size={12} /> Supprimer
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-5 text-xs text-gray-400 transition-colors hover:border-purple-400/40 hover:text-gray-200">
                {envoi ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                <span>
                  {envoi ? 'Envoi…' : 'Importer une image'}
                  {!envoi && <span className="block text-[10px] text-gray-500">JPEG, PNG ou WebP · 10 Mo max.</span>}
                </span>
                <input type="file" accept={TYPES_IMAGE_COUVERTURE.join(',')} className="hidden" disabled={envoi}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void envoyerImage(f); e.target.value = ''; }} />
              </label>
            )}
            {erreurImage && <p className="mt-2 text-[11px] text-red-400" data-couverture-erreur>{erreurImage}</p>}
          </div>
        )}

        {mode === 'frame' && (
          <div className="mt-4" data-couverture-frame>
            {videoUrl ? (
              <div className="flex items-center gap-5">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="max-h-36 w-auto max-w-[40%] shrink-0 rounded-lg bg-black ring-1 ring-white/10"
                  onLoadedMetadata={(e) => {
                    const d = Math.round(e.currentTarget.duration * 1000);
                    if (Number.isFinite(d)) setDureeMs(d);
                    e.currentTarget.currentTime = (cover?.frameMs ?? 1000) / 1000;
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className={sousTitre}>{dureeMs <= 0 ? 'Chargement de la vidéo…' : 'Moment choisi'}</span>
                    <span className="font-mono text-[11px] tabular-nums text-gray-300" data-couverture-temps>{formatMs(cover?.frameMs ?? 1000)}</span>
                  </div>
                  {/* Désactivé tant que la durée est inconnue : borné à 1 ms, le
                      curseur enregistrerait un moment faux au premier geste. */}
                  <input
                    type="range"
                    min={0}
                    max={Math.max(dureeMs, 1)}
                    step={50}
                    disabled={dureeMs <= 0}
                    value={cover?.frameMs ?? 1000}
                    aria-label="Moment de la couverture"
                    data-couverture-curseur
                    className="h-1 w-full cursor-pointer appearance-auto accent-purple-400 disabled:cursor-wait disabled:opacity-40"
                    onChange={(e) => {
                      const ms = Number(e.target.value);
                      if (videoRef.current) videoRef.current.currentTime = ms / 1000;
                      onChange({ cover: { mode: 'frame', frameMs: ms } });
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-gray-400" data-couverture-frame-indisponible>
                <Info size={13} className="mt-px shrink-0 text-gray-500" />
                <span>Disponible une fois le montage prêt : choisissez le moment depuis le Calendrier. En attendant, le moment par défaut ({formatMs(cover?.frameMs ?? 1000)}) sera utilisé.</span>
              </p>
            )}
          </div>
        )}

        {/* Résumé par réseau : léger, une ligne par réseau, sans cadre. */}
        <ul className="mt-4 space-y-1 border-t border-white/[0.05] pt-3 text-[11px] text-gray-500" data-couverture-resume>
          {reseaux.map((r) => (
            <li key={r} className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-gray-600" aria-hidden />
              {resumeCouverture(r, cover, format)}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Réglages TikTok : visibilité + interactions côte à côte, consentement en pied ── */}
      {avecTiktok && (
        <section className={carte} data-reglages-tiktok>
          <div className="flex items-baseline justify-between gap-3">
            <p className={titre}>Réglages TikTok</p>
            {infoTt?.nickname && <span className="truncate text-[11px] text-gray-500">@{infoTt.nickname}</span>}
          </div>
          {!infoTt || !tt ? (
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> Lecture des réglages du compte…</p>
          ) : (
            <>
              <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,10rem)_1fr]">
                {/* Visibilité */}
                <div className="min-w-0">
                  <p className={`${sousTitre} mb-2`}>Visibilité</p>
                  {infoTt.fiable ? (
                    <select
                      data-tiktok-confidentialite
                      aria-label="Visibilité TikTok"
                      value={tt.privacy_level}
                      onChange={(e) => majTt({ privacy_level: e.target.value as ConfidentialiteTiktok })}
                      className="w-full rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/[0.08] focus:outline-none focus:ring-1 focus:ring-purple-400/50"
                    >
                      {infoTt.confidentialites.map((c) => <option key={c} value={c}>{LIBELLES_CONFIDENTIALITE[c]}</option>)}
                    </select>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-amber-300/90" data-tiktok-moi-uniquement>
                      TikTok sera publié en « Moi uniquement » (réglages du compte indisponibles).
                    </p>
                  )}
                </div>

                {/* Interactions : des pastilles à bascule, compactes. La case
                    native reste en place (accessibilité, clavier, état). */}
                <div className="min-w-0">
                  <p className={`${sousTitre} mb-2`}>Interactions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['allow_comment', 'allow_duet', 'allow_stitch'] as const).map((k) => {
                      const autorise = infoTt.interactions ? infoTt.interactions[k]?.enabled !== false : true;
                      const actif = autorise && tt[k];
                      return (
                        <label
                          key={k}
                          title={autorise ? undefined : 'Désactivé par le compte TikTok'}
                          className={`inline-flex select-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors focus-within:ring-1 focus-within:ring-purple-400/50 ${
                            !autorise
                              ? 'cursor-not-allowed bg-white/[0.02] text-gray-600 line-through decoration-gray-700'
                              : actif
                                ? 'cursor-pointer bg-purple-500/15 text-purple-100'
                                : 'cursor-pointer bg-white/[0.05] text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <input
                            type="checkbox"
                            data-tiktok-interaction={k}
                            checked={actif}
                            disabled={!autorise}
                            onChange={(e) => majTt({ [k]: e.target.checked } as Partial<ReglagesTiktok>)}
                            className="sr-only"
                          />
                          <span className={`h-1.5 w-1.5 rounded-full ${actif ? 'bg-purple-300' : 'bg-gray-600'}`} aria-hidden />
                          {{ allow_comment: 'Commentaires', allow_duet: 'Duos', allow_stitch: 'Collages' }[k]}
                        </label>
                      );
                    })}
                  </div>
                  {infoTt.interactions && (['allow_comment', 'allow_duet', 'allow_stitch'] as const).some((k) => infoTt.interactions?.[k]?.enabled === false) && (
                    <p className="mt-1.5 text-[10px] text-gray-600">Barré : désactivé par le compte</p>
                  )}
                </div>
              </div>

              {/* Consentement : en pied, séparé d'un simple filet — mis en avant sans cadre lourd. */}
              <div className="mt-5 border-t border-white/[0.05] pt-4">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    data-tiktok-consentement
                    checked={tt.consentement}
                    onChange={(e) => majTt({ consentement: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-purple-400"
                  />
                  <span className={`text-xs leading-relaxed ${tt.consentement ? 'text-white' : 'text-gray-300'}`}>
                    Je confirme avoir vérifié ce contenu et j’accepte sa publication sur TikTok
                  </span>
                </label>
                {!tt.consentement && (
                  <p className="mt-1 pl-[26px] text-[11px] text-gray-500" data-tiktok-consentement-requis>
                    Requis pour TikTok — les autres réseaux partent quand même.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

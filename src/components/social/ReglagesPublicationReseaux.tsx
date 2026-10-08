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
  onChange: (v: ValeurReglagesPublication) => void;
}) {
  const cover = value.cover;
  const mode: ModeCouverture = cover?.mode ?? 'auto';
  const [erreurImage, setErreurImage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [dureeMs, setDureeMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const avecTiktok = reseaux.includes('tiktok');
  const [infoTt, setInfoTt] = useState<InfoTiktok | null>(null);

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
            ...value,
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
    if (m === 'auto') onChange({ ...value, cover: { mode: 'auto' } });
    else if (m === 'frame') onChange({ ...value, cover: { mode: 'frame', frameMs: cover?.mode === 'frame' ? cover.frameMs : 1000 } });
    else onChange({ ...value, cover: cover?.mode === 'upload' ? cover : { mode: 'upload' } });
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
      onChange({ ...value, cover: { mode: 'upload', imageUrl: r.url } });
    } finally {
      setEnvoi(false);
    }
  };

  const tt = value.tiktok;
  const majTt = (patch: Partial<ReglagesTiktok>) => tt && onChange({ ...value, tiktok: { ...tt, ...patch } });

  if (reseaux.length === 0) return null;

  return (
    <div className="space-y-3" data-reglages-publication>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3" data-couverture>
        <p className="text-sm font-medium text-white mb-2">Miniature / couverture</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Miniature / couverture">
          {([
            ['auto', 'Automatique', Sparkles],
            ['upload', 'Choisir une image', ImageIcon],
            ['frame', 'Image dans la vidéo', Film],
          ] as const).map(([m, libelle, Icone]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-couverture-mode={m}
              onClick={() => choisirMode(m)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                mode === m ? 'border-purple-500/60 bg-gray-800 text-white' : 'border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              <Icone size={13} /> {libelle}
            </button>
          ))}
        </div>

        {mode === 'upload' && (
          <div className="mt-3" data-couverture-upload>
            {cover?.imageUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.imageUrl} alt="Couverture choisie" className="h-24 w-auto rounded-md border border-gray-700 object-cover" />
                <div className="flex flex-col gap-1.5">
                  <label className="cursor-pointer text-xs text-purple-300 hover:text-white underline">
                    Remplacer
                    <input type="file" accept={TYPES_IMAGE_COUVERTURE.join(',')} className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void envoyerImage(f); e.target.value = ''; }} />
                  </label>
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                    onClick={() => onChange({ ...value, cover: { mode: 'auto' } })} data-couverture-supprimer>
                    <Trash2 size={12} /> Supprimer
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 px-3 py-4 text-xs text-gray-400 hover:border-purple-500">
                {envoi ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                {envoi ? 'Envoi…' : 'Importer une image (JPEG, PNG ou WebP, 10 Mo max.)'}
                <input type="file" accept={TYPES_IMAGE_COUVERTURE.join(',')} className="hidden" disabled={envoi}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void envoyerImage(f); e.target.value = ''; }} />
              </label>
            )}
            {erreurImage && <p className="mt-1.5 text-xs text-red-400" data-couverture-erreur>{erreurImage}</p>}
          </div>
        )}

        {mode === 'frame' && (
          <div className="mt-3" data-couverture-frame>
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="max-h-56 w-auto rounded-md border border-gray-700 bg-black"
                  onLoadedMetadata={(e) => {
                    const d = Math.round(e.currentTarget.duration * 1000);
                    if (Number.isFinite(d)) setDureeMs(d);
                    e.currentTarget.currentTime = (cover?.frameMs ?? 1000) / 1000;
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={Math.max(dureeMs, 1)}
                  step={50}
                  value={cover?.frameMs ?? 1000}
                  aria-label="Moment de la couverture"
                  data-couverture-curseur
                  className="mt-2 w-full accent-purple-500"
                  onChange={(e) => {
                    const ms = Number(e.target.value);
                    if (videoRef.current) videoRef.current.currentTime = ms / 1000;
                    onChange({ ...value, cover: { mode: 'frame', frameMs: ms } });
                  }}
                />
                <p className="text-xs text-gray-400">Moment choisi : <span className="text-white" data-couverture-temps>{formatMs(cover?.frameMs ?? 1000)}</span></p>
              </>
            ) : (
              <p className="text-xs text-gray-400" data-couverture-frame-indisponible>
                Disponible une fois le montage prêt : choisissez le moment depuis le Calendrier. En attendant, le moment par défaut ({formatMs(cover?.frameMs ?? 1000)}) sera utilisé.
              </p>
            )}
          </div>
        )}

        <ul className="mt-3 space-y-0.5 text-[11px] text-gray-400" data-couverture-resume>
          {reseaux.map((r) => <li key={r}>{resumeCouverture(r, cover, format)}</li>)}
        </ul>
      </div>

      {avecTiktok && (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3" data-reglages-tiktok>
          <p className="text-sm font-medium text-white mb-2">
            Réglages TikTok{infoTt?.nickname ? <span className="text-gray-400 font-normal"> — @{infoTt.nickname}</span> : null}
          </p>
          {!infoTt || !tt ? (
            <p className="text-xs text-gray-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Lecture des réglages du compte…</p>
          ) : (
            <div className="space-y-2 text-xs">
              {infoTt.fiable ? (
                <label className="flex items-center gap-2 text-gray-300">
                  Visibilité
                  <select
                    data-tiktok-confidentialite
                    value={tt.privacy_level}
                    onChange={(e) => majTt({ privacy_level: e.target.value as ConfidentialiteTiktok })}
                    className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-white"
                  >
                    {infoTt.confidentialites.map((c) => <option key={c} value={c}>{LIBELLES_CONFIDENTIALITE[c]}</option>)}
                  </select>
                </label>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-amber-300" data-tiktok-moi-uniquement>
                  <Info size={12} /> TikTok sera publié en « Moi uniquement » (réglages du compte indisponibles).
                </p>
              )}
              {(['allow_comment', 'allow_duet', 'allow_stitch'] as const).map((k) => {
                const autorise = infoTt.interactions ? infoTt.interactions[k]?.enabled !== false : true;
                return (
                  <label key={k} className={`flex items-center gap-2 ${autorise ? 'text-gray-300' : 'text-gray-500'}`}>
                    <input
                      type="checkbox"
                      data-tiktok-interaction={k}
                      checked={autorise && tt[k]}
                      disabled={!autorise}
                      onChange={(e) => majTt({ [k]: e.target.checked } as Partial<ReglagesTiktok>)}
                    />
                    {{ allow_comment: 'Autoriser les commentaires', allow_duet: 'Autoriser les duos', allow_stitch: 'Autoriser les collages (stitch)' }[k]}
                    {!autorise && ' — désactivé par le compte'}
                  </label>
                );
              })}
              <label className="flex items-start gap-2 pt-1 text-white">
                <input type="checkbox" data-tiktok-consentement checked={tt.consentement} onChange={(e) => majTt({ consentement: e.target.checked })} className="mt-0.5" />
                Je confirme avoir vérifié ce contenu et j’accepte sa publication sur TikTok
              </label>
              {!tt.consentement && (
                <p className="text-amber-400" data-tiktok-consentement-requis>Sans cette confirmation, la vidéo ne partira pas sur TikTok (les autres réseaux, si.)</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

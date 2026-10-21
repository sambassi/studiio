'use client';

/**
 * CHRONOLOGIE VISUELLE DU MONTAGE — une bande horizontale, dans l'ordre.
 *
 * ⚠️ ELLE REMPLACE DES PASTILLES DE TEXTE (« Vidéo suggérée 0–4 s · Mon avatar
 * 4–7 s… ») que personne ne reliait à une image. Chaque segment montre
 * désormais SA miniature réelle (vignette de la vidéo, photo, avatar), l'icône
 * de son type et sa durée, avec une largeur proportionnelle à la durée (et un
 * minimum lisible). Un clic saute à ce moment de l'aperçu.
 *
 * ⚠️ AUCUN SECOND PLAN. Les segments sont les `lignes` / `etapes` déjà
 * calculées par l'appelant (`chronologieListe`, `etapesMontageApercuAutopilote`
 * → `planCompletAutopilote`) : même ordre, mêmes médias, mêmes horaires.
 *
 * Mobile : défilement horizontal (`overflow-x: auto`, accroche par segment) —
 * jamais une page qui s'allonge.
 */
import { Clapperboard, Film, Image as ImageIcon, Megaphone, RefreshCw, UserRound } from 'lucide-react';
import type { CSSProperties } from 'react';
import MiniatureVideo from '@/components/medias/MiniatureVideo';
import { MiniatureAvatar, type VignetteAvatar } from '@/components/creer/AvatarPrincipalAutopilote';
import { formatSecondes, type EtapeApercu, type LigneChronologie } from '@/lib/creer/medias-video';

export type GenreSegmentChronologie = 'avatar' | 'rush' | 'video' | 'photo' | 'cta';

export interface SegmentChronologie {
  id: string;
  genre: GenreSegmentChronologie;
  libelle: string;
  debut: number;
  fin: number;
  duree: number;
  /** Part de la durée totale (0..1) — la largeur relative du segment. */
  part: number;
  /** Média du segment (vidéo, photo, vidéo réelle de l'avatar) ; `null` : avatar à produire, CTA. */
  url: string | null;
  horsNarration: boolean;
  fondu?: number;
}

/** Largeur minimale lisible d'un segment (px) — en dessous, la bande défile. */
export const LARGEUR_MIN_SEGMENT = 60;

/** Les segments de la bande, depuis la chronologie et ses étapes. Pur. */
export function segmentsChronologie(
  lignes: ReadonlyArray<LigneChronologie>,
  etapes: ReadonlyArray<EtapeApercu>,
): SegmentChronologie[] {
  const total = lignes.reduce((t, l) => t + Math.max(0, l.fin - l.debut), 0);
  return lignes.map((l) => {
    const e = l.cta ? null : etapes.find((x) => x.id === l.id) ?? null;
    const genre: GenreSegmentChronologie = l.cta ? 'cta'
      : e?.source === 'avatar' ? 'avatar'
        : e?.type === 'image' ? 'photo'
          : e?.source === 'stock-video' ? 'video'
            : 'rush';
    const duree = Math.max(0, Math.round((l.fin - l.debut) * 1000) / 1000);
    return {
      id: l.id,
      genre,
      libelle: l.libelle,
      debut: l.debut,
      fin: l.fin,
      duree,
      part: total > 0 ? duree / total : 0,
      url: e?.url ?? null,
      horsNarration: !!l.horsNarration,
      ...(l.fondu ? { fondu: l.fondu } : {}),
    };
  });
}

/** Durée lisible d'un segment : « 3 s », « 2,5 s ». */
export function dureeSegment(s: number): string {
  return `${formatSecondes(s)} s`;
}

const ICONES = { avatar: UserRound, rush: Clapperboard, video: Film, photo: ImageIcon, cta: Megaphone } as const;

function Vignette({ s, accent, vignetteAvatar, vignettes }: {
  s: SegmentChronologie;
  accent: string;
  vignetteAvatar?: VignetteAvatar | null;
  vignettes?: Readonly<Record<string, string>>;
}) {
  const boite: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
  if (s.genre === 'cta') {
    return (
      <span style={{ ...boite, backgroundColor: accent, opacity: 0.85 }} className="flex items-center justify-center text-white">
        <Megaphone className="w-4 h-4" />
      </span>
    );
  }
  const connue = s.url ? vignettes?.[s.url] : undefined;
  if (connue) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connue} alt="" style={{ ...boite, objectFit: 'cover' }} data-chronologie-vignette="connue" />;
  }
  if (s.genre === 'photo' && s.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s.url} alt="" style={{ ...boite, objectFit: 'cover' }} data-chronologie-vignette="photo" />;
  }
  if (s.genre === 'avatar' && !s.url) {
    return vignetteAvatar
      ? <MiniatureAvatar vignette={vignetteAvatar} className="absolute inset-0 w-full h-full !rounded-none" />
      : (
        <span style={boite} className="flex items-center justify-center bg-gray-800 text-gray-400" data-chronologie-vignette="avatar-emplacement">
          <UserRound className="w-4 h-4" />
        </span>
      );
  }
  return <MiniatureVideo url={s.url} compact style={boite} attrs={{ 'data-chronologie-vignette': 'video' }} />;
}

export default function ChronologieMontage({
  segments, indexCourant, accent, onSauter, onRemplacer, vignetteAvatar, vignettes,
}: {
  segments: ReadonlyArray<SegmentChronologie>;
  indexCourant: number;
  accent: string;
  onSauter: (debut: number) => void;
  /** « Remplacer » ce média (flux existant de l'appelant) — absent : pas de bouton. */
  onRemplacer?: (s: SegmentChronologie) => void;
  vignetteAvatar?: VignetteAvatar | null;
  /** Vignettes déjà connues (médias suggérés), par URL de média. */
  vignettes?: Readonly<Record<string, string>>;
}) {
  return (
    <ol
      data-chronologie
      aria-label="Chronologie du montage"
      className="flex gap-1 min-w-0 overflow-x-auto pb-1"
      style={{ scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}
    >
      {segments.map((s, k) => {
        const courant = k === indexCourant;
        const Icone = ICONES[s.genre];
        const remplacable = !!onRemplacer && s.genre !== 'cta' && s.genre !== 'avatar';
        return (
          <li
            key={s.id}
            data-segment={s.genre}
            className="relative min-w-0"
            style={{ flexGrow: Math.max(0.001, s.duree), flexShrink: 0, flexBasis: 0, minWidth: LARGEUR_MIN_SEGMENT, scrollSnapAlign: 'start' }}
          >
            <button
              type="button"
              data-ligne={s.id}
              data-debut={s.debut}
              data-fin={s.fin}
              data-genre={s.genre}
              data-part={Math.round(s.part * 1000) / 1000}
              data-hors-narration={s.horsNarration ? 'oui' : undefined}
              data-fondu={s.fondu ? s.fondu : undefined}
              title={s.fondu
                ? `Le CTA apparaît en fondu pendant les ${formatSecondes(s.fondu)} dernières secondes du média précédent, qui joue jusqu’à ${formatSecondes(s.debut)} s.`
                : `${s.libelle} — ${formatSecondes(s.debut)} à ${formatSecondes(s.fin)} s`}
              aria-current={courant ? 'step' : undefined}
              onClick={() => onSauter(s.debut)}
              className={`block w-full overflow-hidden rounded-md text-left transition ${courant ? 'ring-2 ring-studiio-primary' : 'ring-1 ring-white/10 hover:ring-white/30'} ${s.horsNarration ? 'ring-amber-400/70' : ''}`}
            >
              <span className="relative block bg-gray-900" style={{ height: 44 }}>
                <Vignette s={s} accent={accent} vignetteAvatar={vignetteAvatar} vignettes={vignettes} />
              </span>
              <span className={`flex items-center gap-1 px-1 py-0.5 text-[10px] tabular-nums ${courant ? 'bg-studiio-primary/25 text-white' : 'bg-gray-800/80 text-gray-300'}`}>
                <Icone className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span data-segment-duree>{dureeSegment(s.duree)}</span>
              </span>
              {/* Libellé complet pour les lecteurs d'écran (et les tests) : « Mon avatar 4–7 s ». */}
              <span className="sr-only">
                {s.libelle} {formatSecondes(s.debut)}–{formatSecondes(s.fin)} s
                {s.fondu ? ` · fondu ${formatSecondes(s.fondu)} s` : ''}
              </span>
            </button>
            {remplacable && (
              <button
                type="button"
                onClick={() => onRemplacer!(s)}
                data-chronologie-remplacer={s.id}
                aria-label={`Remplacer ce média (${s.libelle})`}
                title="Remplacer ce média"
                className="absolute top-0.5 right-0.5 rounded bg-black/60 p-0.5 text-gray-200 hover:text-white"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

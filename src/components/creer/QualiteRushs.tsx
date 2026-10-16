'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, XCircle } from 'lucide-react';
import type { MediaVideo } from '@/lib/creer/medias-video';
import type { AnalyseRush } from '@/lib/creer/smart-montage';
import { evaluerQualiteRushs, libelleQualite, type QualiteRush } from '@/lib/creer/qualite-rushs';

/**
 * M1 — QUALITÉ DES RUSHES, sous la liste des médias de la séquence Vidéo.
 *
 * RECOMMANDATION, JAMAIS DÉCISION : par défaut rien n'est écarté, le plan et
 * le fichier final restent ceux d'aujourd'hui. Deux gestes explicites :
 *  - « Écarter ce rush » : le même retrait que « Supprimer » sur la carte
 *    (l'appelant le passe au montage comme un retrait manuel) ;
 *  - « Utiliser quand même » : masque l'avertissement, le rush reste.
 *
 * L'analyse est celle de l'export (`analyserRush`, locale, gratuite, aucun
 * fournisseur), lancée une fois par rush et gardée en mémoire de la page.
 */

type Analyseur = (url: string) => Promise<AnalyseRush | null>;

/** Une analyse par URL pour toute la page (la liste se réordonne souvent). */
const memo = new Map<string, Promise<AnalyseRush | null>>();
const MEMO_MAX = 40;
function analyserUneFois(url: string, analyser: Analyseur): Promise<AnalyseRush | null> {
  const hit = memo.get(url);
  if (hit) return hit;
  const p = analyser(url).catch(() => null);
  memo.set(url, p);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  return p;
}

const analyseurParDefaut: Analyseur = async (url) => {
  const { analyserRush } = await import('@/lib/creer/analyse-rush');
  return analyserRush(url);
};

export interface QualiteRushsProps {
  medias: MediaVideo[];
  /** URL que le serveur peut relire (jamais une `blob:`) ; les autres ne sont pas analysées. */
  estDurable: (url: string) => boolean;
  /** « Écarter ce rush » : retrait explicite du montage. */
  onEcarter: (url: string) => void;
  /** Tests : analyse injectée (défaut : analyse locale du navigateur). */
  analyser?: Analyseur;
}

export default function QualiteRushs({ medias, estDurable, onEcarter, analyser = analyseurParDefaut }: QualiteRushsProps) {
  // Rushes vidéo de l'utilisateur ou suggérés — jamais l'avatar, jamais une photo.
  const rushs = useMemo(
    () => medias.filter((m): m is MediaVideo & { url: string } => m.type === 'video' && m.source !== 'avatar' && !!m.url && estDurable(m.url)),
    [medias, estDurable],
  );
  const cles = rushs.map((m) => m.url).join('\n');
  const [analyses, setAnalyses] = useState<Record<string, AnalyseRush | null>>({});
  const [enCours, setEnCours] = useState(false);
  /** « Utiliser quand même » : avertissements masqués, par URL. */
  const [acceptes, setAcceptes] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let vivant = true;
    const urls = cles ? cles.split('\n') : [];
    const manquantes = urls.filter((u) => !(u in analyses));
    if (!manquantes.length) return;
    setEnCours(true);
    void (async () => {
      // Un rush après l'autre : décoder plusieurs vidéos à la fois ralentit la page.
      for (const u of manquantes) {
        const a = await analyserUneFois(u, analyser);
        if (!vivant) return;
        setAnalyses((prev) => ({ ...prev, [u]: a }));
      }
      if (vivant) setEnCours(false);
    })();
    return () => { vivant = false; };
    // `analyses` exclu : seules les URL nouvelles déclenchent une mesure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cles, analyser]);

  const diagnostic = useMemo(() => {
    const mesurees = rushs.map((m) => analyses[m.url]).filter((a): a is AnalyseRush => !!a);
    if (!mesurees.length) return [];
    // Un rush importé ou pris dans la Médiathèque est un CHOIX de l'utilisateur.
    const choisis = rushs.filter((m) => m.source === 'rush' || m.source === 'mediatheque').map((m) => m.url);
    return evaluerQualiteRushs(mesurees, { choisisParUtilisateur: choisis }).rushs;
  }, [rushs, analyses]);

  const position = (url: string) => medias.findIndex((m) => m.url === url) + 1;
  const aSignaler = diagnostic.filter((q) => q.verdict !== 'ok' && !acceptes.has(q.url));

  if (!rushs.length || (!enCours && aSignaler.length === 0)) return null;

  return (
    <div className="mt-2 space-y-1.5" data-qualite-rushs>
      {enCours && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-500" data-qualite-rushs-analyse>
          <Loader2 className="h-3 w-3 animate-spin" />
          Vérification de la qualité de vos rushes…
        </p>
      )}
      {aSignaler.map((q) => (
        <LigneQualite
          key={q.url}
          q={q}
          position={position(q.url)}
          onEcarter={() => onEcarter(q.url)}
          onAccepter={() => setAcceptes((prev) => new Set(prev).add(q.url))}
        />
      ))}
    </div>
  );
}

function LigneQualite({ q, position, onEcarter, onAccepter }: { q: QualiteRush; position: number; onEcarter: () => void; onAccepter: () => void }) {
  const grave = q.verdict === 'inutilisable';
  const Icone = grave ? XCircle : AlertTriangle;
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${grave ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}
      data-qualite-rush={q.cle}
      data-verdict={q.verdict}
    >
      <div className="flex items-center gap-2">
        <Icone className={`h-3.5 w-3.5 flex-shrink-0 ${grave ? 'text-red-400' : 'text-amber-400'}`} />
        <span className="text-[11px] text-gray-400">Média {position > 0 ? position : ''}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${grave ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}
          data-qualite-badge
        >
          {libelleQualite(q)}
        </span>
        {q.choisiParVous && (
          <span className="text-[11px] text-gray-500" data-qualite-choisi>choisi par vous</span>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {q.motifs.map((m) => (
          <li key={m.code} className="text-[11px] text-gray-400" data-qualite-motif={m.code}>{m.texte}</li>
        ))}
        {q.protections.map((p) => (
          <li key={p} className="text-[11px] text-gray-500">{p}</li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-gray-500">
        Recommandation seulement : ce rush reste dans votre montage tant que vous ne l&apos;écartez pas.
      </p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={onEcarter}
          className="rounded-lg border border-gray-700 px-2.5 py-1 text-[11px] text-gray-200 transition hover:border-gray-500 hover:text-white"
          data-qualite-ecarter
        >
          Écarter ce rush
        </button>
        <button
          type="button"
          onClick={onAccepter}
          className="rounded-lg px-2.5 py-1 text-[11px] text-gray-400 transition hover:text-white"
          data-qualite-accepter
        >
          Utiliser quand même
        </button>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, Film, ImageIcon, Megaphone, Plus, RefreshCw, RotateCcw, Search, Trash2, Wand2 } from 'lucide-react';
import { LIBELLES_ORIGINE, dureeLisible, nomTechnique, origineSuggeree } from '@/lib/medias/libelles';
import MiniatureVideo from '@/components/medias/MiniatureVideo';
import { useVignetteVideo } from '@/lib/hooks/useVignetteVideo';
import { MAX_CRENEAUX, type CreneauGabarit, type MediaStockRetenu, type TypeCreneau } from '@/lib/autopilot/sources';
import { MiniatureAvatar, type VignetteAvatar } from '@/components/creer/AvatarPrincipalAutopilote';
import { DUREE_ESTIMEE_SANS_CIBLE, horodatage, minutagePlan, secondesLisibles } from '@/lib/autopilot/duree-cible';
import { RYTHME_LABELS, type RythmeBrief } from '@/lib/creer/brief';
import { planCompletAutopilote, type SegmentPlanComplet } from '@/lib/autopilot/plan-complet';

/**
 * « Plan avant génération » — le GABARIT de la séquence Vidéo, édité avant
 * tout rendu : l'ordre et la nature des plans (avatar, rush personnel,
 * stock, ou laissé à Studiio). Chaque montage remplit ce plan avec ses
 * médias réels ; la séquence CTA reste fixe, à la fin.
 *
 * ⚠️ AUCUN APPEL ICI. Le composant ne fait qu'éditer une liste et la remonter
 * (`onChange`) ; l'enregistrement est celui du panneau (`designStyle.sources
 * .gabarit`). Aucune génération d'avatar, aucun fournisseur appelé.
 *
 * Sans plan enregistré, la SUGGESTION (dérivée des sources actives) est
 * montrée ; le premier geste la fixe.
 *
 * ⚠️ LIBELLÉS PRODUIT : « Mon avatar », « Mes rushes », « Vidéo suggérée »,
 * « Photo suggérée », « Auto » — jamais une plateforme ni un nom de fichier
 * (celui-ci n'apparaît qu'en `title`). Les valeurs enregistrées (`type`,
 * `media`) ne changent pas.
 */

const TYPES: Array<{ v: TypeCreneau; label: string }> = [
  { v: 'auto', label: 'Auto' },
  { v: 'avatar', label: 'Mon avatar' },
  { v: 'rush', label: 'Mes rushes' },
  { v: 'stock', label: 'Média suggéré' },
];

/** « Vidéo suggérée 2 » — numérotée par type, dans l'ordre des médias retenus. */
function nomStock(m: MediaStockRetenu, stock: MediaStockRetenu[]): string {
  const memeType = stock.filter((s) => s.type === m.type);
  return `${LIBELLES_ORIGINE[origineSuggeree(m.type)]} ${memeType.indexOf(m) + 1}`;
}

export function libelleCreneau(c: CreneauGabarit, stock: MediaStockRetenu[], rushesPerso: string[] = []): string {
  if (c.type === 'avatar') return 'Mon avatar';
  if (c.type === 'auto') return 'Auto — Studiio choisit';
  if (c.type === 'rush') {
    const i = c.media ? rushesPerso.indexOf(c.media) : -1;
    return c.media ? `Mes rushes · ${i >= 0 ? `Rush ${i + 1}` : 'rush choisi'}` : 'Mes rushes';
  }
  const m = c.media ? stock.find((s) => s.url === c.media) : undefined;
  if (m) return LIBELLES_ORIGINE[origineSuggeree(m.type)];
  return 'Média suggéré';
}

/**
 * Nom, durée et statut d'un rush choisi — sous la ligne. La durée vient de la
 * MÊME extraction que la miniature (cache partagé) : aucun second chargement.
 */
function InfosRush({ url }: { url: string }) {
  const e = useVignetteVideo(url);
  const nom = nomTechnique(url);
  const duree = e.etat === 'pret' ? dureeLisible(e.vignette.duree) : null;
  return (
    <p className="min-w-0 truncate text-[10px] text-gray-500" data-plan-infos-rush>
      {nom ? <span className="text-gray-400">{nom}</span> : null}
      {duree ? <span data-plan-duree>{nom ? ' · ' : ''}{duree}</span> : null}
      {e.etat === 'echec' ? <span data-plan-statut="indisponible">{nom || duree ? ' · ' : ''}Aperçu indisponible</span> : null}
      {e.etat === 'chargement' ? <span data-plan-statut="chargement">{nom || duree ? ' · ' : ''}Lecture de l’aperçu…</span> : null}
    </p>
  );
}

/** Libellé produit d'un plan du montage prévu — jamais une plateforme. */
export function libelleSegment(s: SegmentPlanComplet): string {
  if (s.genre === 'avatar') return s.role === 'accroche' ? 'Mon avatar — accroche' : s.role === 'cta' ? 'Mon avatar — CTA' : 'Mon avatar';
  if (s.genre === 'rush') return 'Mes rushes';
  return LIBELLES_ORIGINE[origineSuggeree(s.genre === 'video' ? 'video' : 'photo')];
}

/** Lit la durée d'une vidéo (même cache que les miniatures) et la remonte. Ne rend rien. */
function SondeDuree({ url, onDuree }: { url: string; onDuree: (url: string, d: number | null) => void }) {
  const e = useVignetteVideo(url);
  const d = e.etat === 'pret' ? e.vignette.duree : null;
  useEffect(() => { onDuree(url, d); }, [url, d, onDuree]);
  return null;
}

const BOUTON = 'flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white disabled:opacity-30';

function nouvelId(lignes: CreneauGabarit[]): string {
  let n = lignes.length + 1;
  while (lignes.some((l) => l.id === `s${n}`)) n += 1;
  return `s${n}`;
}

export default function PlanAvantGeneration({
  gabarit, suggestion, rushesPerso, stock, vignetteAvatar, avatarDisponible, disabled, onChange, onRechercher, duree,
  secondesAvatar, scriptAvatar, stockPertinent,
}: {
  /**
   * Les médias stock que le MOTEUR piochera (sujet courant, `sourcesPertinentes`),
   * dans son ordre — ceux du plan calculé. Défaut : `stock`. Les listes de choix
   * gardent tous les médias retenus (un choix manuel reste possible).
   */
  stockPertinent?: MediaStockRetenu[];
  /** Parole de l'avatar (s), si connue ; sinon estimée depuis `scriptAvatar`, sinon la durée de référence. */
  secondesAvatar?: number | null;
  /** Script que l'avatar dira (estimation de sa parole). */
  scriptAvatar?: string | null;
  /**
   * Durée cible et rythme du brief. Le minutage affiché est celui du moteur
   * (créneaux égaux) sur la durée cible — sans cible, sur ≈ 30 s. À la
   * production, il est recalé sur la durée RÉELLE de la voix.
   */
  duree?: { cible: number | null; rythme: RythmeBrief | null };
  gabarit: CreneauGabarit[];
  suggestion: CreneauGabarit[];
  rushesPerso: string[];
  stock: MediaStockRetenu[];
  vignetteAvatar: VignetteAvatar | null;
  avatarDisponible: boolean;
  disabled?: boolean;
  onChange: (g: CreneauGabarit[]) => void;
  /** Ouvre la recherche stock pour CETTE ligne (les lignes courantes, suggestion comprise). */
  onRechercher: (id: string, lignes: CreneauGabarit[]) => void;
}) {
  const fixe = gabarit.length > 0;
  const lignes = fixe ? gabarit : suggestion;
  const cible = duree?.cible ?? null;
  const reference = cible ?? DUREE_ESTIMEE_SANS_CIBLE;
  // Durées des vidéos (rushes, vidéos suggérées) : celles que le moteur sondera.
  const [durees, setDurees] = useState<Record<string, number | null>>({});
  const noterDuree = useCallback((url: string, d: number | null) => {
    setDurees((x) => (x[url] === d ? x : { ...x, [url]: d }));
  }, []);
  const stockPlan = stockPertinent ?? stock;
  const videos = [...rushesPerso, ...stockPlan.filter((m) => m.type === 'video').map((m) => m.url)];
  /**
   * LE PLAN MONTRÉ = LE PLAN RENDU : la liste ENTIÈRE des plans (créneaux,
   * alternance avatar ↔ plans de coupe, CTA), par le même orchestrateur que
   * le moteur (`planCompletAutopilote` → `planMultiSources`).
   */
  const complet = lignes.length > 0 ? planCompletAutopilote({
    gabarit: lignes,
    actives: { rushes: true, stock: true, avatar: avatarDisponible },
    rushesPerso, stock: stockPlan,
    avatar: { disponible: avatarDisponible, vignette: null },
  }, { cible: reference, rythme: duree?.rythme ?? null, secondesAvatar, scriptAvatar, durees }) : null;
  const avecAvatar = !!complet?.segments.some((x) => x.genre === 'avatar');
  // Parole de l'avatar non mesurée (aucune génération) : la durée est une ESTIMATION.
  const estimee = avecAvatar && !(typeof secondesAvatar === 'number' && secondesAvatar > 0);
  // Sans avatar, un créneau = un plan : le minutage par créneau reste lisible.
  const minutage = avecAvatar ? [] : minutagePlan(lignes.length, reference);
  const planifiee = complet && complet.duree > 0 ? complet.duree : (minutage.length ? minutage[minutage.length - 1].fin : 0);

  const maj = (f: (l: CreneauGabarit[]) => CreneauGabarit[]) => onChange(f(lignes.map((l) => ({ ...l }))).slice(0, MAX_CRENEAUX));
  const deplacer = (i: number, d: -1 | 1) => maj((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  });

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/30 px-3 py-2 space-y-2 min-w-0" data-autopilot-plan data-plan-fixe={fixe ? 'oui' : 'non'}>
      {videos.map((u) => <SondeDuree key={u} url={u} onDuree={noterDuree} />)}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Plan avant génération</p>
        {fixe ? (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            data-plan-reinitialiser
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3" /> Laisser Studiio décider
          </button>
        ) : lignes.length > 0 ? (
          <span className="flex items-center gap-1 text-[10px] text-gray-500" data-plan-suggere><Wand2 className="w-3 h-3" /> Plan suggéré</span>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-500">
        Chaque montage remplit ce plan avec ses médias réels. La séquence CTA reste toujours à la fin.
      </p>
      {lignes.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg bg-gray-900/60 px-2 py-1.5 text-[11px]" data-plan-duree>
          <dt className="text-gray-500">Durée cible</dt>
          <dd className="text-gray-200" data-plan-duree-cible={cible ?? ''}>{cible ? `${cible} s` : `automatique (≈ ${DUREE_ESTIMEE_SANS_CIBLE} s)`}</dd>
          <dt className="text-gray-500">Durée planifiée</dt>
          <dd className="text-gray-200" data-plan-duree-planifiee={planifiee} data-plan-duree-estimee={estimee ? 'oui' : 'non'}>
            {secondesLisibles(planifiee)}{estimee ? <span className="text-gray-500"> (estimée)</span> : null}
          </dd>
          <dt className="text-gray-500">Nombre de séquences</dt>
          <dd className="text-gray-200" data-plan-nombre={lignes.length}>{lignes.length}</dd>
          <dt className="text-gray-500">Rythme</dt>
          <dd className="text-gray-200" data-plan-rythme={duree?.rythme ?? 'normal'}>{RYTHME_LABELS[duree?.rythme ?? 'normal']}</dd>
          <dd className="col-span-2 text-[10px] text-gray-500 pt-0.5">
            Minutage prévu ; à la production, il est recalé sur la durée réelle de la voix (jamais accélérée).
          </dd>
        </dl>
      )}
      {lignes.length === 0 && (
        <p className="text-[11px] text-gray-400" data-plan-vide>Activez une source pour construire le plan.</p>
      )}
      <ol className="space-y-1.5">
        {lignes.map((c, i) => {
          const n = i + 1;
          const stockMedia = c.type === 'stock' && c.media ? stock.find((s) => s.url === c.media) : undefined;
          // Un rush FORCÉ et toujours utilisable : sa miniature réelle. « Au choix » garde l'icône.
          const rushChoisi = c.type === 'rush' && c.media && rushesPerso.includes(c.media) ? c.media : null;
          const options = c.type === 'rush' ? rushesPerso.map((u, k) => ({ v: u, label: `Rush ${k + 1}` }))
            : c.type === 'stock' ? stock.map((s) => ({ v: s.url, label: nomStock(s, stock) }))
              : [];
          // « Remplacer » : le média suivant de la même source (même geste que la liste).
          const suivant = options.length > 0
            ? options[(options.findIndex((o) => o.v === c.media) + 1) % options.length]
            : null;
          const remplacable = !!suivant && (options.length > 1 || !c.media);
          return (
            <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-2 space-y-1.5 min-w-0" data-plan-ligne={i} data-plan-type={c.type}>
              <div className="flex items-center gap-2 min-w-0">
                {c.type === 'avatar' ? <MiniatureAvatar vignette={vignetteAvatar} className="w-7 h-7" />
                  : rushChoisi ? (
                    <MiniatureVideo url={rushChoisi} compact className="w-7 h-7 rounded-lg shrink-0" attrs={{ 'data-plan-vignette-rush': '' }} />
                  ) : stockMedia?.vignetteUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={stockMedia.vignetteUrl} alt="" className="w-7 h-7 rounded-lg object-cover bg-gray-800 shrink-0" data-plan-vignette />
                  ) : (
                    <span className="w-7 h-7 shrink-0 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400">
                      {c.type === 'stock' ? <ImageIcon className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                    </span>
                  )}
                <p className="min-w-0 flex-1 text-[11px] text-gray-300">
                  <span className="font-medium text-white">Séquence {n}</span>
                  <span className="text-gray-500"> — </span>
                  <span className="break-words" data-plan-libelle title={c.media ? nomTechnique(c.media) : undefined}>{libelleCreneau(c, stock, rushesPerso)}</span>
                </p>
              </div>
              {minutage[i] && (
                <p className="text-[10px] text-gray-400" data-plan-minutage={i}>
                  {horodatage(minutage[i].debut)} → {horodatage(minutage[i].fin)} · Durée : {secondesLisibles(minutage[i].duree)}
                </p>
              )}
              {rushChoisi && <InfosRush url={rushChoisi} />}
              {c.type === 'avatar' && !avatarDisponible && (
                <p className="text-[10px] text-amber-400" data-plan-avatar-inactif>Avatar inactif : Studiio prendra une autre source.</p>
              )}
              <div className="flex flex-wrap items-center gap-1">
                <select
                  value={c.type}
                  disabled={disabled}
                  onChange={(e) => maj((l) => { l[i] = { id: c.id, type: e.target.value as TypeCreneau }; return l; })}
                  aria-label={`Type de la séquence ${n}`}
                  data-plan-forcer={i}
                  className="rounded border border-gray-800 bg-gray-950 px-1 py-0.5 text-[10px] text-gray-200"
                >
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                {options.length > 0 && (
                  <select
                    value={c.media ?? ''}
                    disabled={disabled}
                    onChange={(e) => maj((l) => { l[i] = { id: c.id, type: c.type, ...(e.target.value ? { media: e.target.value } : {}) }; return l; })}
                    aria-label={`Média de la séquence ${n}`}
                    data-plan-media={i}
                    className="min-w-0 max-w-full flex-1 basis-32 rounded border border-gray-800 bg-gray-950 px-1 py-0.5 text-[10px] text-gray-200"
                  >
                    <option value="">Au choix à chaque montage</option>
                    {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                )}
                <span className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onRechercher(c.id, lignes)}
                    disabled={disabled}
                    aria-label={`Rechercher un média pour la séquence ${n}`}
                    title="Rechercher un média pour cette séquence"
                    data-plan-rechercher={i}
                    className={BOUTON}
                  >
                    <Search className="w-3 h-3" /> Rechercher
                  </button>
                  <button
                    type="button"
                    onClick={() => suivant && maj((l) => { l[i] = { id: c.id, type: c.type, media: suivant.v }; return l; })}
                    disabled={disabled || !remplacable}
                    aria-label={`Remplacer le média de la séquence ${n}`}
                    title={remplacable ? 'Passer au média suivant de cette source' : 'Aucun autre média dans cette source'}
                    data-plan-remplacer={i}
                    className={BOUTON}
                  >
                    <RefreshCw className="w-3 h-3" /> Remplacer
                  </button>
                  <span className="flex items-center gap-0.5 rounded border border-gray-800 pl-1.5 text-[10px] text-gray-400" role="group" aria-label={`Déplacer la séquence ${n}`}>
                    Déplacer
                    <button type="button" onClick={() => deplacer(i, -1)} disabled={disabled || i === 0}
                      aria-label={`Déplacer la séquence ${n} vers le haut`} title="Déplacer vers le haut" data-plan-monter={i}
                      className="p-1 text-gray-300 hover:text-white disabled:opacity-30">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={() => deplacer(i, 1)} disabled={disabled || i === lignes.length - 1}
                      aria-label={`Déplacer la séquence ${n} vers le bas`} title="Déplacer vers le bas" data-plan-descendre={i}
                      className="p-1 text-gray-300 hover:text-white disabled:opacity-30">
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </span>
                  <button type="button" onClick={() => maj((l) => l.filter((_, k) => k !== i))} disabled={disabled}
                    aria-label={`Supprimer la séquence ${n}`} title="Supprimer cette séquence" data-plan-supprimer={i}
                    className={`${BOUTON} hover:text-red-400`}>
                    <Trash2 className="w-3 h-3" /> Supprimer
                  </button>
                </span>
              </div>
            </li>
          );
        })}
        <li className="flex items-center gap-2 rounded-lg border border-dashed border-gray-800 px-2 py-1.5 text-[11px] text-gray-400" data-plan-cta>
          <Megaphone className="w-3.5 h-3.5 shrink-0" />
          <span><span className="font-medium text-gray-300">CTA</span> — fixe, toujours en dernier</span>
        </li>
      </ol>
      {complet && complet.segments.length > 0 && (
        <div className="space-y-1 rounded-lg bg-gray-900/60 px-2 py-1.5" data-plan-montage data-plan-montage-nombre={complet.segments.length}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Montage prévu, plan par plan</p>
          <ol className="space-y-0.5">
            {complet.segments.map((x, i) => (
              <li
                key={`${i}-${x.debut}`}
                className="flex items-center justify-between gap-2 text-[10px] text-gray-300 min-w-0"
                data-plan-segment={i}
                data-genre={x.genre}
                data-role={x.role ?? ''}
                data-debut={x.debut}
                data-fin={x.fin}
                data-url={x.url}
              >
                <span className="min-w-0 truncate">{libelleSegment(x)}</span>
                <span className="shrink-0 text-gray-500">{horodatage(x.debut)} → {horodatage(x.fin)} · {secondesLisibles(x.duree)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {lignes.length < MAX_CRENEAUX && (
        <button
          type="button"
          onClick={() => maj((l) => [...l, { id: nouvelId(l), type: 'auto' }])}
          disabled={disabled}
          data-plan-ajouter
          className="flex items-center gap-1 rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Ajouter une séquence
        </button>
      )}
    </section>
  );
}

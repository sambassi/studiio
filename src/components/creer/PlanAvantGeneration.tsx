'use client';

import { ArrowDown, ArrowUp, Film, ImageIcon, Megaphone, Plus, RotateCcw, Search, Trash2, Wand2 } from 'lucide-react';
import { MAX_CRENEAUX, type CreneauGabarit, type MediaStockRetenu, type TypeCreneau } from '@/lib/autopilot/sources';
import { MiniatureAvatar, type VignetteAvatar } from '@/components/creer/AvatarPrincipalAutopilote';

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
 */

const TYPES: Array<{ v: TypeCreneau; label: string }> = [
  { v: 'auto', label: 'Auto' },
  { v: 'avatar', label: 'Avatar' },
  { v: 'rush', label: 'Rush' },
  { v: 'stock', label: 'Stock' },
];

function nomFichier(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || url); } catch { return url.split('/').pop() || url; }
}

const nomFournisseur = (p: string) => (p === 'unsplash' ? 'Unsplash' : 'Pexels');

export function libelleCreneau(c: CreneauGabarit, stock: MediaStockRetenu[]): string {
  if (c.type === 'avatar') return 'Avatar';
  if (c.type === 'auto') return 'Auto — Studiio choisit';
  if (c.type === 'rush') return c.media ? `Rush personnel · ${nomFichier(c.media)}` : 'Rush personnel';
  const m = c.media ? stock.find((s) => s.url === c.media) : undefined;
  if (m) return `${nomFournisseur(m.provider)} · ${m.type === 'video' ? 'vidéo' : 'photo'} de ${m.auteur || 'auteur inconnu'}`;
  const fournisseurs = Array.from(new Set(stock.map((s) => nomFournisseur(s.provider))));
  return fournisseurs.length ? fournisseurs.join(' / ') : 'Pexels / Unsplash';
}

function nouvelId(lignes: CreneauGabarit[]): string {
  let n = lignes.length + 1;
  while (lignes.some((l) => l.id === `s${n}`)) n += 1;
  return `s${n}`;
}

export default function PlanAvantGeneration({
  gabarit, suggestion, rushesPerso, stock, vignetteAvatar, avatarDisponible, disabled, onChange, onRechercher,
}: {
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

  const maj = (f: (l: CreneauGabarit[]) => CreneauGabarit[]) => onChange(f(lignes.map((l) => ({ ...l }))).slice(0, MAX_CRENEAUX));
  const deplacer = (i: number, d: -1 | 1) => maj((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    [l[i], l[j]] = [l[j], l[i]];
    return l;
  });

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/30 px-3 py-2 space-y-2 min-w-0" data-autopilot-plan data-plan-fixe={fixe ? 'oui' : 'non'}>
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
      {lignes.length === 0 && (
        <p className="text-[11px] text-gray-400" data-plan-vide>Activez une source pour construire le plan.</p>
      )}
      <ol className="space-y-1.5">
        {lignes.map((c, i) => {
          const n = i + 1;
          const stockMedia = c.type === 'stock' && c.media ? stock.find((s) => s.url === c.media) : undefined;
          const options = c.type === 'rush' ? rushesPerso.map((u) => ({ v: u, label: `Rush · ${nomFichier(u)}` }))
            : c.type === 'stock' ? stock.map((s) => ({ v: s.url, label: `${nomFournisseur(s.provider)} · ${s.type === 'video' ? 'vidéo' : 'photo'} · ${s.auteur}` }))
              : [];
          return (
            <li key={c.id} className="rounded-lg border border-gray-800 bg-gray-900 p-2 space-y-1.5 min-w-0" data-plan-ligne={i} data-plan-type={c.type}>
              <div className="flex items-center gap-2 min-w-0">
                {c.type === 'avatar' ? <MiniatureAvatar vignette={vignetteAvatar} className="w-7 h-7" />
                  : stockMedia?.vignetteUrl ? (
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
                  <span className="break-words" data-plan-libelle>{libelleCreneau(c, stock)}</span>
                </p>
              </div>
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
                <button
                  type="button"
                  onClick={() => onRechercher(c.id, lignes)}
                  disabled={disabled}
                  aria-label={`Rechercher un autre média pour la séquence ${n}`}
                  title="Rechercher un autre média"
                  data-plan-rechercher={i}
                  className="flex items-center gap-1 rounded border border-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:text-white disabled:opacity-40"
                >
                  <Search className="w-3 h-3" /> Rechercher
                </button>
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" onClick={() => deplacer(i, -1)} disabled={disabled || i === 0} aria-label={`Monter la séquence ${n}`} data-plan-monter={i}
                    className="rounded border border-gray-800 p-1 text-gray-300 hover:text-white disabled:opacity-30">
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => deplacer(i, 1)} disabled={disabled || i === lignes.length - 1} aria-label={`Descendre la séquence ${n}`} data-plan-descendre={i}
                    className="rounded border border-gray-800 p-1 text-gray-300 hover:text-white disabled:opacity-30">
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => maj((l) => l.filter((_, k) => k !== i))} disabled={disabled} aria-label={`Supprimer la séquence ${n}`} data-plan-supprimer={i}
                    className="rounded border border-gray-800 p-1 text-gray-300 hover:text-red-400 disabled:opacity-30">
                    <Trash2 className="w-3 h-3" />
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

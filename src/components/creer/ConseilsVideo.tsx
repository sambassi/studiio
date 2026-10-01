'use client';

/**
 * « Conseils pour améliorer cette vidéo » — affichage du rapport du
 * conseiller (`metadata.conseils`). LECTURE SEULE : rien n'est appliqué.
 * « Ignorer » masque un conseil pour ce post (préférence locale).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, EyeOff, Lightbulb, Info } from 'lucide-react';
import { conseilsDepuisMetadata, ORDRE_SECTIONS } from '@/lib/creer/conseiller';
import type { Conseil, PrioriteConseil } from '@/lib/creer/conseiller/types';

const COULEUR_PRIORITE: Record<PrioriteConseil, { fond: string; texte: string; libelle: string }> = {
  IMPORTANTE: { fond: 'rgba(239,68,68,0.15)', texte: '#FCA5A5', libelle: 'Important' },
  MOYENNE: { fond: 'rgba(245,158,11,0.15)', texte: '#FCD34D', libelle: 'Moyen' },
  FAIBLE: { fond: 'rgba(148,163,184,0.15)', texte: '#CBD5E1', libelle: 'Léger' },
};

const cleStockage = (postId: string) => `studiio:conseils-ignores:${postId}`;

function lireIgnores(postId: string): string[] {
  try { return JSON.parse(localStorage.getItem(cleStockage(postId)) || '[]'); } catch { return []; }
}

export function ConseilsVideo({ postId, metadata }: { postId: string; metadata: unknown }) {
  const rapport = useMemo(() => conseilsDepuisMetadata((metadata as { conseils?: unknown } | null)?.conseils), [metadata]);
  const [ouvert, setOuvert] = useState(false);
  const [ignores, setIgnores] = useState<string[]>([]);
  const [copie, setCopie] = useState<string | null>(null);
  useEffect(() => { setIgnores(lireIgnores(postId)); }, [postId]);

  if (!rapport) return null;
  const visibles = rapport.conseils.filter((c) => !ignores.includes(c.id));
  const importants = visibles.filter((c) => c.priorite === 'IMPORTANTE').length;

  const ignorer = (id: string) => {
    const l = Array.from(new Set([...ignores, id]));
    setIgnores(l);
    try { localStorage.setItem(cleStockage(postId), JSON.stringify(l)); } catch { /* préférence locale seulement */ }
  };
  const copier = (c: Conseil) => {
    if (!c.propositionReecrite) return;
    navigator.clipboard?.writeText(c.propositionReecrite).then(() => {
      setCopie(c.id);
      setTimeout(() => setCopie(null), 1500);
    }).catch(() => {});
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 mb-4">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        aria-expanded={ouvert}
      >
        <Lightbulb className="w-4 h-4 text-amber-300 shrink-0" />
        <span className="text-sm font-medium text-white flex-1">Conseils pour améliorer cette vidéo</span>
        <span className="text-xs text-gray-400">
          {visibles.length === 0 ? 'aucun' : `${visibles.length}${importants ? ` · ${importants} important${importants > 1 ? 's' : ''}` : ''}`}
        </span>
        {ouvert ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {ouvert && (
        <div className="px-3 pb-3 space-y-3 max-h-96 overflow-y-auto">
          {visibles.length === 0 && <p className="text-xs text-gray-400">Rien à signaler sur ce qui a été mesuré.</p>}
          {ORDRE_SECTIONS.map((section) => {
            const liste = visibles.filter((c) => c.section === section);
            if (!liste.length) return null;
            return (
              <div key={section}>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">{section}</p>
                <div className="space-y-2">
                  {liste.map((c) => {
                    const p = COULEUR_PRIORITE[c.priorite];
                    return (
                      <div key={c.id} className="rounded-md bg-gray-800/60 p-2.5">
                        <div className="flex items-start gap-2">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ background: p.fond, color: p.texte }}>{p.libelle}</span>
                          <p className="text-xs text-gray-200 flex-1">{c.probleme}</p>
                        </div>
                        <p className="text-xs text-white mt-1.5">{c.conseil}</p>
                        {c.propositionReecrite && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-xs text-purple-200 bg-purple-500/15 rounded px-2 py-1 flex-1">« {c.propositionReecrite} »</span>
                            <button type="button" onClick={() => copier(c)} className="text-gray-400 hover:text-white" title="Copier la proposition">
                              {copie === c.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        )}
                        {(c.placementRecommande || c.dureeRecommandee) && (
                          <p className="text-[11px] text-gray-400 mt-1.5">
                            {c.placementRecommande && <>Placement : {c.placementRecommande}</>}
                            {c.placementRecommande && c.dureeRecommandee && ' · '}
                            {c.dureeRecommandee && <>Durée : {c.dureeRecommandee}</>}
                          </p>
                        )}
                        <div className="flex justify-end mt-1">
                          <button type="button" onClick={() => ignorer(c.id)} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300">
                            <EyeOff className="w-3 h-3" /> Ignorer
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              Ces conseils ne modifient rien. Ils portent uniquement sur ce que Studiio a mesuré
              {rapport.couverture.lisibilite ? '' : ' (taille et contraste des textes non mesurés pour cette vidéo)'} : il ne reconnaît pas encore les visages ni les types de plans.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

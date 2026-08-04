'use client';

import React, { useCallback, useState } from 'react';
import {
  Eraser, Wand2, Paintbrush, ArrowUpCircle, Video, Image as ImageIcon,
  Layers, Maximize, ScanText, Loader2,
} from 'lucide-react';

/**
 * Outils IA d'image — catalogue PARTAGE et composant autonome.
 *
 * Le catalogue (`AI_TOOLS`) vit ici et nulle part ailleurs : c'est lui qui
 * porte le COUT EN CREDITS de chaque action. Deux copies finiraient par
 * annoncer des tarifs differents selon l'ecran, et l'un des deux mentirait.
 * `ImageEditorPanel` le lit desormais d'ici.
 *
 * Le composant, lui, ne connait qu'une image et un moyen de rendre le
 * resultat : il ne depend d'aucun `SequenceBackgroundConfig`. C'est ce qui le
 * rend utilisable par le Mode simple, dont l'affiche n'a ni filtres ni
 * `objectPosition`.
 */

export type AiAction =
  | 'remove-bg' | 'magic-eraser' | 'magic-edit' | 'upscale'
  | 'image-to-video' | 'generate-bg' | 'magic-layers' | 'style-transfer' | 'ocr';

export interface AiToolDef {
  action: AiAction;
  label: string;
  icon: React.ReactNode;
  /** L'outil a-t-il besoin de l'image courante ? */
  needsImage: boolean;
  /** A-t-il besoin d'une consigne ecrite ? */
  needsPrompt: boolean;
  promptPlaceholder?: string;
  /** A-t-il besoin d'un style ? */
  needsStyle?: boolean;
  /** Cout en credits — la SEULE source, pour tous les ecrans. */
  credits: number;
}

export const AI_TOOLS: AiToolDef[] = [
  { action: 'remove-bg', label: 'Effacer arrière-plan', icon: <Eraser size={11} />, needsImage: true, needsPrompt: false, credits: 2 },
  { action: 'magic-eraser', label: 'Gomme magique', icon: <Wand2 size={11} />, needsImage: true, needsPrompt: true, promptPlaceholder: 'Que voulez-vous effacer ? (ex: la personne, le texte…)', credits: 3 },
  { action: 'magic-edit', label: 'Édition magique', icon: <Paintbrush size={11} />, needsImage: true, needsPrompt: true, promptPlaceholder: 'Décrivez la modification (ex: changer le ciel en coucher de soleil)', credits: 5 },
  { action: 'upscale', label: 'Augmenter résolution', icon: <ArrowUpCircle size={11} />, needsImage: true, needsPrompt: false, credits: 3 },
  { action: 'image-to-video', label: "D'image à vidéo", icon: <Video size={11} />, needsImage: true, needsPrompt: false, credits: 15 },
  { action: 'generate-bg', label: 'Générer arrière-plan', icon: <ImageIcon size={11} />, needsImage: false, needsPrompt: true, promptPlaceholder: 'Décrivez le fond (ex: gym moderne sombre avec néons violets)', credits: 5 },
  { action: 'magic-layers', label: 'Calques magiques', icon: <Layers size={11} />, needsImage: true, needsPrompt: false, credits: 3 },
  { action: 'style-transfer', label: 'Transfert de style', icon: <Maximize size={11} />, needsImage: true, needsPrompt: false, needsStyle: true, credits: 5 },
  // Seul outil dont le resultat est du TEXTE : il ne remplace pas l'image.
  { action: 'ocr', label: 'Capture de texte', icon: <ScanText size={11} />, needsImage: true, needsPrompt: false, credits: 1 },
];

export const STYLE_PRESETS = [
  { value: 'anime', label: 'Anime' },
  { value: 'oil painting', label: 'Peinture' },
  { value: 'watercolor', label: 'Aquarelle' },
  { value: 'neon cyberpunk', label: 'Cyberpunk' },
  { value: 'pencil sketch', label: 'Croquis' },
  { value: 'pop art', label: 'Pop Art' },
  { value: 'vintage retro film', label: 'Vintage' },
  { value: 'minimalist flat design', label: 'Minimaliste' },
];

/**
 * Actions retenues pour une PHOTO D'AFFICHE.
 *
 * `image-to-video` produit une video et `ocr` du texte : ni l'un ni l'autre
 * ne peut devenir un fond, et les proposer ici promettrait un resultat que
 * l'ecran ne saurait pas accueillir.
 */
export const POSTER_ACTIONS: AiAction[] = [
  'generate-bg', 'magic-edit', 'remove-bg', 'magic-eraser', 'upscale',
  'magic-layers', 'style-transfer',
];

export default function AiImageTools({
  imageUrl,
  onImageResult,
  showToast,
  actions = POSTER_ACTIONS,
  disabled = false,
}: {
  /** Image de depart. Absente, seuls les outils qui n'en ont pas besoin sont actifs. */
  imageUrl: string | null;
  /** L'image produite — c'est a l'appelant d'en faire ce qu'il veut. */
  onImageResult: (url: string) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  /** Sous-ensemble d'actions a proposer. */
  actions?: AiAction[];
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState<AiAction | null>(null);
  const [promptFor, setPromptFor] = useState<AiAction | null>(null);
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<string>(STYLE_PRESETS[0].value);

  const outils = AI_TOOLS.filter((t) => actions.includes(t.action));

  const lancer = useCallback(async (tool: AiToolDef, consigne?: string, styleChoisi?: string) => {
    if (tool.needsImage && !imageUrl) {
      showToast('Choisissez d’abord une photo d’affiche.', 'error');
      return;
    }
    // Consigne ou style manquant : on ouvre le champ au lieu de partir — un
    // appel sans consigne consommerait des credits pour rien.
    if (tool.needsPrompt && !consigne?.trim()) {
      setPromptFor(tool.action);
      setPrompt('');
      return;
    }
    if (tool.needsStyle && !styleChoisi) {
      setPromptFor(tool.action);
      return;
    }

    setLoading(tool.action);
    setPromptFor(null);
    try {
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: tool.action,
          imageUrl: imageUrl || undefined,
          prompt: consigne?.trim() || undefined,
          style: styleChoisi || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        // Le message du serveur est relaye tel quel : c'est lui qui dit
        // « REPLICATE_API_TOKEN manquant » ou « crédits insuffisants ».
        throw new Error(data?.error || `Erreur ${res.status}`);
      }
      if (!data.resultUrl) {
        throw new Error('Aucune image renvoyée.');
      }
      onImageResult(data.resultUrl);
      showToast(`${tool.label} terminé (${data.creditsUsed ?? tool.credits} cr.)`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Traitement IA impossible.', 'error');
    } finally {
      setLoading(null);
    }
  }, [imageUrl, onImageResult, showToast]);

  const enCours = loading !== null;

  return (
    <div className="space-y-2" data-ai-tools>
      <div className="grid grid-cols-2 gap-1.5">
        {outils.map((tool) => {
          const inactif = disabled || enCours || (tool.needsImage && !imageUrl);
          return (
            <button
              key={tool.action}
              type="button"
              onClick={() => lancer(tool)}
              disabled={inactif}
              data-ai-action={tool.action}
              title={
                tool.needsImage && !imageUrl
                  ? 'Choisissez d’abord une photo d’affiche'
                  : `${tool.label} — ${tool.credits} crédits`
              }
              className="flex items-center justify-between gap-1 rounded-lg border border-gray-800 px-2 py-1.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {loading === tool.action ? <Loader2 size={11} className="animate-spin" /> : tool.icon}
                <span className="truncate">{tool.label}</span>
              </span>
              {/* Le cout est annonce AVANT le clic — comme dans l'editeur avance. */}
              <span className="text-[10px] text-gray-500 shrink-0">{tool.credits} cr.</span>
            </button>
          );
        })}
      </div>

      {promptFor && (() => {
        const tool = AI_TOOLS.find((t) => t.action === promptFor);
        if (!tool) return null;
        return (
          <div className="rounded-lg border border-purple-500/30 bg-gray-900 p-2 space-y-2">
            <p className="text-[11px] font-medium text-purple-200">{tool.label}</p>
            {tool.needsPrompt && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 400))}
                placeholder={tool.promptPlaceholder}
                rows={2}
                data-ai-prompt
                className="w-full rounded-lg bg-gray-950 border border-gray-800 focus:border-purple-500 outline-none p-2 text-[11px] resize-y"
              />
            )}
            {tool.needsStyle && (
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full rounded-lg bg-gray-950 border border-gray-800 focus:border-purple-500 outline-none p-2 text-[11px]"
              >
                {STYLE_PRESETS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => lancer(tool, prompt, tool.needsStyle ? style : undefined)}
                disabled={tool.needsPrompt && !prompt.trim()}
                data-ai-confirm
                className="flex-1 rounded-lg bg-purple-600/30 text-purple-100 ring-1 ring-purple-500/40 px-2 py-1.5 text-[11px] hover:bg-purple-600/40 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Lancer ({tool.credits} cr.)
              </button>
              <button
                type="button"
                onClick={() => setPromptFor(null)}
                className="rounded-lg border border-gray-800 px-2 py-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

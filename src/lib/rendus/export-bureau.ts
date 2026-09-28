/**
 * Que fait « Exporter » (Bureau) pour CE post ? Décision PURE, testable.
 *
 * Avant : la seule question posée était « `renderedVideoUrl` finit-il par
 * `.mp4` ? ». Elle vise les MP4 produits par le navigateur en mode rapide
 * (MediaRecorder de Chrome), aux métadonnées temporelles cassées : ceux-là ne
 * sont jamais réutilisés, on recompose. Un WebM navigateur, lui, est converti
 * en MP4 côté serveur. Mais un montage Autopilote est un MP4 rendu PAR LE
 * SERVEUR (`autopilote-<job>.mp4`, Remotion), parfaitement lisible : il
 * tombait dans la même case et était recomposé dans le navigateur — et
 * facturé — au lieu d'être téléchargé.
 *
 *  - `bloque`      : montage périmé (`montagePerime`). Même règle que #459 :
 *                    on ne livre pas l'ancien fichier en silence, on dit
 *                    pourquoi (le message nomme l'issue disponible).
 *  - `telecharger` : rendu final serveur, téléchargé tel quel — ni
 *                    recomposition, ni débit.
 *  - `convertir`   : WebM navigateur, converti en MP4 (comportement d'avant).
 *  - `recomposer`  : aucun rendu réutilisable (comportement d'avant).
 */
import { montageEstPerime, montageRenduServeur } from '@/lib/creer/montage-perime';
import { persistableUrl } from '@/lib/creer/draft';

export type ExportBureau = 'bloque' | 'telecharger' | 'convertir' | 'recomposer';

/** Nom de fichier d'un montage rendu par le serveur de l'Autopilote. */
const MP4_AUTOPILOTE = /\/autopilote-[^/?#]+\.mp4(?:[?#]|$)/i;

export function decisionExportBureau(metadata: unknown): ExportBureau {
  if (montageEstPerime(metadata)) return 'bloque';
  const meta = (typeof metadata === 'object' && metadata !== null ? metadata : {}) as Record<string, unknown>;
  const rendu = typeof meta.renderedVideoUrl === 'string' ? meta.renderedVideoUrl : '';
  if (!rendu) return 'recomposer';
  const durable = !!persistableUrl(rendu);
  if (durable && (montageRenduServeur(meta) || MP4_AUTOPILOTE.test(rendu))) return 'telecharger';
  // Règle historique, inchangée : un `.mp4` navigateur n'est jamais réutilisé.
  if (!rendu.endsWith('.mp4')) return 'convertir';
  return 'recomposer';
}

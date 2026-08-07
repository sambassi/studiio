/**
 * Les constantes de marque de l'Autopilote — un module FEUILLE.
 *
 * ⚠️ ELLES VIVAIENT DANS `design.ts`, ET C'ÉTAIT INOFFENSIF TANT QUE SEUL LE
 * SERVEUR LES LISAIT. L'aperçu du wizard en a besoin côté NAVIGATEUR : or
 * importer quoi que ce soit de `design.ts` entraîne toute sa chaîne —
 * `voice` → `storage/upload` → `db/supabase` → `minio` — et le build échoue
 * sur « Can't resolve 'fs/promises' ». Un `import type` n'aurait pas suffi :
 * ce sont des valeurs.
 *
 * Ce fichier n'importe RIEN. C'est sa seule règle, et c'est ce qui le rend
 * lisible des deux côtés. `design.ts` les ré-exporte, si bien qu'aucun
 * appelant existant n'a changé.
 */

/** Filigrane par défaut, comme le Mode simple. */
export const AUTOPILOT_WATERMARK = 'Studiio.pro';

/** Format produit par l'Autopilote : le vertical, celui des réseaux. */
export const AUTOPILOT_FORMAT = '9:16' as const;

/**
 * Opacité du voile de dégradé, dans un montage d'Autopilote.
 *
 * ⚠️ 0,3 ET NON LES 0,5 DE L'ASSISTANT. `buildAutopilotDesign` ne transmet
 * pas `gradientOpacity`, et `CreerSimpleMontage` retombe alors sur `?? 0.3` :
 * c'est donc bien 0,3 que la vidéo produit. Reprendre le
 * `DESIGN.gradientOpacity` de l'assistant aurait donné un aperçu plus voilé
 * que le montage — l'écart exact que cet aperçu existe pour éviter. Un test
 * garde les deux d'accord.
 */
export const AUTOPILOT_GRADIENT_OPACITY = 0.3;

/**
 * LE SCRIPT DU JUMEAU — PUR (aucun réseau, aucune base), importable côté
 * client. Extrait de `jumeau-async.ts` (A5) pour que l'aperçu de l'Autopilote
 * estime la parole de l'avatar avec EXACTEMENT le script que le montage fera
 * dire — une seule source de vérité.
 */
import { scriptPourDuree, secondesReserveesEnveloppeJumeau } from '@/lib/autopilot/duree-cible';
import { avatarAvecAutresSources, type ConfigPourSources } from '@/lib/autopilot/sources';
import type { VideoBrief } from '@/lib/creer/brief';

/** Au-delà, la parole ne tient plus dans un plan d'avatar lisible. */
export const MAX_SCRIPT = 600;

/** Ce que le script lit d'un montage préparé (`PreparedPost` le satisfait). */
export interface PostPourScriptJumeau {
  title: string;
  content: {
    subtitle?: string;
    tagLine?: string;
    cards?: ReadonlyArray<{ title?: string; description?: string; value?: string }>;
  };
  brief?: VideoBrief;
}

/**
 * Le script que le jumeau DIT dans le montage.
 *
 * Concis, et DISTINCT du contenu des cartes : titre (l'accroche), sous-titre,
 * puis la phrase de CTA. Le message du brief récurrent, s'il existe, ouvre —
 * c'est l'identité constante de la chaîne. Le jumeau étant la seule voix du
 * montage, ce script ne se répète nulle part ailleurs.
 */
export function scriptJumeauMontage(post: PostPourScriptJumeau, config?: ConfigPourSources | null): string {
  // Durée cible du brief : le script est COMPOSÉ pour elle — accroche,
  // idées (cartes), appel à l'action — par unités entières, jamais coupé.
  //
  // A4 — AVATAR SEUL (pas d'autres sources) : titre, cartes et CTA sont des
  // séquences plein écran AUTOUR du jumeau ; leur part de la durée cible est
  // réservée (`secondesReserveesEnveloppeJumeau`), sinon la vidéo durait
  // ≈ cible + 14 s. Avec d'autres sources (textes en surimpression sur
  // l'avatar), ou sans config connue : le budget d'avant, toute la cible.
  //
  // A4 v2 — avatar seul : le message doit être COMPLET (accroche + première
  // idée + appel à l'action, en unités entières). Une cible sous 20 s ne
  // l'est pas : elle n'est JAMAIS lancée (`lancerJumeauMontage` refuse,
  // `duree_a_confirmer`) et sa durée n'est jamais changée ici.
  const avatarSeul = !!config && !avatarAvecAutresSources(config);
  const briefScript = post.brief;
  const pourDuree = scriptPourDuree({
    titre: post.title,
    sousTitre: post.content.subtitle,
    cartes: post.content.cards ?? [],
    cta: post.brief?.cta || post.content.tagLine,
    brief: briefScript,
    ...(avatarSeul ? { secondesReservees: secondesReserveesEnveloppeJumeau(briefScript?.duree), ideeObligatoire: true } : null),
  });
  if (pourDuree !== null) return pourDuree.slice(0, MAX_SCRIPT);
  const briefMessage = (post.brief?.message ?? '').trim();
  const parts = [briefMessage, post.title, post.content.subtitle, post.content.tagLine]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  // Dédoublonne (le titre peut déjà être le message du brief), garde l'ordre.
  const vus = new Set<string>();
  const uniques = parts.filter((p) => (vus.has(p) ? false : (vus.add(p), true)));
  return uniques.join('. ').slice(0, MAX_SCRIPT);
}

/**
 * CINEMA IA — EST-CE ENCORE VOTRE HISTOIRE ? (audit, module PUR)
 *
 * Un interrupteur « respecter mon histoire » ne prouve rien. Ce module COMPARE le film au
 * texte d'origine (`film.histoire`, conserve intact) avec la MEME segmentation que le
 * decoupage (`scenario.phrases`), et dit, phrase par phrase, ce qui a ete garde et ce qui a
 * ete ajoute ou devine.
 *
 * Ce que le decoupage fait vraiment (`scenario.decouperHistoire`), et qu'il faut montrer :
 *
 *   - chaque phrase de l'histoire devient la DESCRIPTION d'un plan, dans l'ordre : c'est la
 *     colonne vertebrale de la fidelite, et elle est verifiable mot pour mot ;
 *   - chaque scene recoit EN PLUS un plan d'ensemble fabrique (« Plan d'ensemble sur … ») :
 *     il n'est pas dans votre texte, on le DIT ;
 *   - quand aucun lieu n'est reconnu, le plan d'ensemble parle d'« un decor neutre » : c'est
 *     une substitution, elle est signalee ;
 *   - quand une replique ne nomme pas qui parle, le locuteur est DEVINE par rotation : c'est
 *     l'ecart le plus trompeur, il est signale par plan ;
 *   - un prenom present dans l'histoire mais absent du casting n'apparait dans AUCUN plan.
 *
 * Rien ici ne corrige le film : un audit propose, l'utilisateur decide. Aucun appel, aucun
 * cout. Les ecarts ne sont PAS des erreurs : ce sont des choix a valider.
 */
import { personnagesCites, phrases } from '@/lib/cinema/scenario';
import { diagnostiquerProposition } from '@/lib/cinema/redaction';
import type { Film, PlanCinema, SceneCinema } from '@/lib/cinema/types';

export type GenreEcart =
  | 'phrase_absente'
  | 'ordre_change'
  | 'lieu_substitue'
  | 'locuteur_devine'
  | 'plan_ajoute'
  | 'personnage_hors_casting';

export interface EcartFidelite {
  genre: GenreEcart;
  /** Ce que l'utilisateur doit lire : une phrase, pas un code. */
  detail: string;
  sceneId?: string;
  planId?: string;
}

/** Une phrase de l'histoire et le plan qui la porte — le lien verifiable. */
export interface LienPhrase {
  phrase: string;
  planId: string | null;
  sceneId: string | null;
  /** Rang du plan dans le film : sert a voir si l'ordre a bouge. */
  rang: number | null;
}

export interface RapportFidelite {
  phrases: LienPhrase[];
  /** Phrases de l'histoire retrouvees telles quelles dans un plan. */
  retrouvees: number;
  total: number;
  ordreRespecte: boolean;
  ecarts: EcartFidelite[];
  /** Toutes les phrases presentes, dans l'ordre : le recit n'a pas ete reecrit. */
  fidele: boolean;
}

/** Le plan d'ensemble fabrique par le decoupage, reconnaissable a sa forme. */
const PLAN_AJOUTE = /^Plan d'ensemble sur .+\.$/;
export const DECOR_NEUTRE = 'un decor neutre';

const normaliser = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Les ecarts d'UNE scene — utilise par l'audit complet et par la carte de scene. */
export function ecartsScene(film: Film, scene: SceneCinema): EcartFidelite[] {
  const out: EcartFidelite[] = [];
  if (scene.lieu === DECOR_NEUTRE) {
    out.push({
      genre: 'lieu_substitue', sceneId: scene.id,
      detail: 'Aucun lieu reconnu dans votre texte : le plan d’ensemble parle d’« un decor neutre ». Nommez un lieu pour l’imposer.',
    });
  }
  for (const plan of scene.plans as PlanCinema[]) {
    if (PLAN_AJOUTE.test(plan.description)) {
      out.push({
        genre: 'plan_ajoute', sceneId: scene.id, planId: plan.id,
        detail: `Plan ajoute par Studiio pour ouvrir la scene : « ${plan.description} ». Il ne vient pas de votre texte.`,
      });
      continue;
    }
    const d = plan.dialogue;
    if (d && d.genre === 'replique' && d.personnageId) {
      const nommes = personnagesCites(plan.description, film.personnages);
      if (!nommes.includes(d.personnageId)) {
        const qui = film.personnages.find((p) => p.id === d.personnageId)?.nom ?? 'un personnage';
        out.push({
          genre: 'locuteur_devine', sceneId: scene.id, planId: plan.id,
          detail: `La replique n’indique pas qui parle : Studiio l’a attribuee a ${qui}. Ecrivez le prenom devant la replique pour decider.`,
        });
      }
    }
  }
  return out;
}

/** Le film, relu phrase par phrase contre l'histoire d'origine. */
export function auditFidelite(film: Film): RapportFidelite {
  const origine = phrases(film.histoire);
  const plans: Array<{ plan: PlanCinema; scene: SceneCinema; rang: number }> = [];
  let rang = 0;
  for (const scene of film.scenes) for (const plan of scene.plans) plans.push({ plan, scene, rang: rang++ });

  const pris = new Set<string>();
  const liens: LienPhrase[] = origine.map((p) => {
    const cible = plans.find((x) => !pris.has(x.plan.id) && normaliser(x.plan.description) === normaliser(p));
    if (cible) pris.add(cible.plan.id);
    return { phrase: p, planId: cible?.plan.id ?? null, sceneId: cible?.scene.id ?? null, rang: cible?.rang ?? null };
  });

  const ecarts: EcartFidelite[] = [];
  for (const l of liens) {
    if (l.planId === null) {
      ecarts.push({ genre: 'phrase_absente', detail: `Cette phrase n’apparait dans aucun plan : « ${l.phrase} ».` });
    }
  }

  // L'ordre : les rangs retrouves doivent etre croissants.
  const rangs = liens.map((l) => l.rang).filter((r): r is number => r !== null);
  const ordreRespecte = rangs.every((r, i) => i === 0 || r > rangs[i - 1]);
  if (!ordreRespecte) {
    ecarts.push({ genre: 'ordre_change', detail: 'L’ordre des phrases a change entre votre texte et les plans.' });
  }

  for (const scene of film.scenes) ecarts.push(...ecartsScene(film, scene));

  // Un prenom ecrit dans l'histoire mais absent du casting n'entre dans aucun plan.
  const inconnus = diagnostiquerProposition(film.histoire, { histoire: '', personnages: film.personnages.map((p) => ({ nom: p.nom })) }).inconnus;
  for (const nom of inconnus) {
    ecarts.push({
      genre: 'personnage_hors_casting',
      detail: `« ${nom} » est nomme dans votre histoire mais absent du casting : il n’apparaitra dans aucun plan. Ajoutez-le a l’etape Personnages.`,
    });
  }

  const retrouvees = liens.filter((l) => l.planId !== null).length;
  return { phrases: liens, retrouvees, total: origine.length, ordreRespecte, ecarts, fidele: retrouvees === origine.length && ordreRespecte };
}

/** Les phrases de VOTRE texte portees par une scene — ce qu'une carte de scene affiche. */
export function phrasesDeLaScene(film: Film, scene: SceneCinema): string[] {
  const rapport = auditFidelite(film);
  return rapport.phrases.filter((l) => l.sceneId === scene.id).map((l) => l.phrase);
}

/** Un resume court pour la liste de controle de l'etape Apercu. */
export function resumeFidelite(r: RapportFidelite): string {
  if (r.total === 0) return 'Aucune histoire saisie.';
  if (r.fidele && r.ecarts.length === 0) return `Vos ${r.total} phrases sont conservees, dans l’ordre.`;
  if (r.fidele) return `Vos ${r.total} phrases sont conservees, dans l’ordre · ${r.ecarts.length} point(s) a valider.`;
  return `${r.retrouvees} phrase(s) sur ${r.total} retrouvees — ${r.total - r.retrouvees} manquante(s).`;
}

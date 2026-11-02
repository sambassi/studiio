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
import { locuteurNomme, phrases } from '@/lib/cinema/scenario';
import { diagnostiquerProposition } from '@/lib/cinema/redaction';
import type { Film, PlanCinema, SceneCinema } from '@/lib/cinema/types';

export type GenreEcart =
  | 'phrase_absente'
  | 'ordre_change'
  | 'lieu_substitue'
  | 'locuteur_devine'
  | 'plan_ajoute'
  | 'narration'
  | 'scene_inventee'
  | 'personnage_hors_casting';

/**
 * Ce qui BLOQUE une generation payante tant que l'utilisateur ne l'a pas resolu (en corrigeant
 * son texte) ou accepte explicitement : une information essentielle manque ou a ete devinee.
 * Le plan d'ensemble ajoute et la narration sont montres mais ne bloquent pas : ils ne
 * changent ni ce qui est dit, ni qui le dit, ni ou cela se passe.
 */
const CRITIQUES: ReadonlySet<GenreEcart> = new Set<GenreEcart>([
  'phrase_absente', 'ordre_change', 'lieu_substitue', 'locuteur_devine', 'personnage_hors_casting', 'scene_inventee',
]);

export interface EcartFidelite {
  genre: GenreEcart;
  /** Ce qui se passe, et pourquoi : une phrase, pas un code. */
  detail: string;
  /** Ce que l'utilisateur peut faire pour regler le point a la source (dans son histoire). */
  conseil?: string;
  /** Ce qui arrivera s'il l'accepte tel quel : on n'accepte jamais « en aveugle ». */
  consequence?: string;
  sceneId?: string;
  planId?: string;
  /** Vrai : bloque la generation payante tant que non resolu ni accepte. */
  critique: boolean;
  /** Identifiant stable : c'est ce que l'utilisateur « accepte ». Il change si le constat change. */
  cle: string;
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

/** Construit un ecart avec sa gravite et sa cle : le seul endroit ou ils se decident. */
function ecart(e: { genre: GenreEcart; detail: string; conseil?: string; consequence?: string; sceneId?: string; planId?: string }): EcartFidelite {
  return { ...e, critique: CRITIQUES.has(e.genre), cle: `${e.genre}|${e.sceneId ?? ''}|${e.planId ?? ''}|${e.detail}`.slice(0, 400) };
}

/**
 * Cette replique a-t-elle un locuteur AMBIGU ? Oui quand le texte ne nomme personne HORS de la citation
 * (ou en nomme un autre que celui attribue) et que l'utilisateur n'a pas choisi qui parle. Le moteur
 * lui a donne un locuteur par defaut (rotation) : ce n'est qu'une valeur par defaut, jamais une
 * attribution — elle n'est ni lue, ni presentee comme sure.
 */
export function locuteurAmbigu(film: Film, plan: PlanCinema): boolean {
  const d = plan.dialogue;
  if (!d || d.genre !== 'replique') return false;
  if (d.locuteurConfirme) return false;
  if (!d.personnageId) return true;
  return locuteurNomme(plan.description, film.personnages) !== d.personnageId;
}

/** Les ecarts d'UNE scene — utilise par l'audit complet et par la carte de scene. */
export function ecartsScene(film: Film, scene: SceneCinema): EcartFidelite[] {
  const out: EcartFidelite[] = [];
  // Une scene dont AUCUN plan ne vient du texte (le decoupage garantit un minimum de scenes,
  // meme pour une histoire courte) est une scene INVENTEE : elle n'a rien a raconter.
  const plans = scene.plans as PlanCinema[];
  if (plans.length > 0 && plans.every((p) => PLAN_AJOUTE.test(p.description))) {
    out.push(ecart({
      genre: 'scene_inventee', sceneId: scene.id,
      detail: 'Cette scène ne correspond à aucune phrase de ton texte : Studiio l’a ajoutée pour avoir au moins 3 scènes.',
      conseil: 'Ajoute une ou deux phrases à ton histoire, puis recompose le scénario.',
      consequence: 'Cette scène sera une scène générique, sans rapport avec ton récit.',
    }));
    return out;
  }
  if (scene.lieu === DECOR_NEUTRE) {
    out.push(ecart({
      genre: 'lieu_substitue', sceneId: scene.id,
      detail: 'Ton histoire ne dit pas où se passe cette scène : Studiio utiliserait « un decor neutre ».',
      conseil: 'Cite le lieu dans la phrase (par exemple « dans la salle »), puis recompose le scénario.',
      consequence: 'Les images de cette scène seront créées dans un décor neutre, choisi par Studiio.',
    }));
  }
  for (const plan of scene.plans as PlanCinema[]) {
    if (PLAN_AJOUTE.test(plan.description)) {
      out.push(ecart({
        genre: 'plan_ajoute', sceneId: scene.id, planId: plan.id,
        detail: `Studiio ouvre chaque scène par un plan d’ensemble (« ${plan.description} »). Il ne vient pas de ton texte.`,
      }));
      continue;
    }
    const d = plan.dialogue;
    // Qui parle compte seulement si la replique est LUE avec une voix de personnage (film historique ou
    // mode « les personnages parlent ») ; en mode « une voix raconte », les repliques ne sont pas lues.
    if (d && d.genre === 'replique' && d.personnageId && film.modeAudio !== 'narrateur' && locuteurAmbigu(film, plan)) {
      {
        const qui = film.personnages.find((p) => p.id === d.personnageId)?.nom ?? 'un personnage';
        out.push(ecart({
          genre: 'locuteur_devine', sceneId: scene.id, planId: plan.id,
          detail: `La réplique n’indique pas qui parle : Studiio l’a attribuée à ${qui}.`,
          conseil: 'Écris le prénom devant la réplique pour décider toi-même qui parle.',
          consequence: `${qui} dira cette réplique dans le film.`,
        }));
      }
    }
    // Une phrase SANS guillemets est du recit : elle est lue en narration, jamais mise dans la bouche d'un personnage.
    if (d && d.genre === 'narration') {
      out.push(ecart({
        genre: 'narration', sceneId: scene.id, planId: plan.id,
        detail: film.modeAudio === 'personnages'
          ? 'Cette phrase décrit une action : elle reste muette (aucun narrateur) et n’est attribuée à aucun personnage.'
          : 'Cette phrase décrit une action : elle est lue en narration et n’est attribuée à aucun personnage.',
      }));
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
      ecarts.push(ecart({
        genre: 'phrase_absente',
        detail: `Cette phrase de ton histoire n’apparaît dans aucune scène : « ${l.phrase} ».`,
        conseil: 'Recompose le scénario depuis ton texte pour la retrouver.',
        consequence: 'Cette phrase ne sera pas dans le film.',
      }));
    }
  }

  // L'ordre : les rangs retrouves doivent etre croissants.
  const rangs = liens.map((l) => l.rang).filter((r): r is number => r !== null);
  const ordreRespecte = rangs.every((r, i) => i === 0 || r > rangs[i - 1]);
  if (!ordreRespecte) {
    ecarts.push(ecart({
      genre: 'ordre_change',
      detail: 'L’ordre des phrases n’est plus celui de ton histoire.',
      conseil: 'Recompose le scénario depuis ton texte pour retrouver l’ordre d’origine.',
      consequence: 'Le film racontera les événements dans un autre ordre que ton texte.',
    }));
  }

  for (const scene of film.scenes) ecarts.push(...ecartsScene(film, scene));

  // Un prenom ecrit dans l'histoire mais absent du casting n'entre dans aucun plan.
  const inconnus = diagnostiquerProposition(film.histoire, { histoire: '', personnages: film.personnages.map((p) => ({ nom: p.nom })) }).inconnus;
  for (const nom of inconnus) {
    ecarts.push(ecart({
      genre: 'personnage_hors_casting',
      detail: `« ${nom} » est cité dans ton histoire mais n’est pas dans tes personnages : il n’apparaîtra dans aucune image.`,
      conseil: 'Ajoute-le à l’étape Personnages, puis recompose le scénario.',
      consequence: `${nom} sera absent du film.`,
    }));
  }

  const retrouvees = liens.filter((l) => l.planId !== null).length;
  return { phrases: liens, retrouvees, total: origine.length, ordreRespecte, ecarts, fidele: retrouvees === origine.length && ordreRespecte };
}

/** Les phrases de VOTRE texte portees par une scene — ce qu'une carte de scene affiche. */
export function phrasesDeLaScene(film: Film, scene: SceneCinema): string[] {
  const rapport = auditFidelite(film);
  return rapport.phrases.filter((l) => l.sceneId === scene.id).map((l) => l.phrase);
}

/**
 * Les ecarts qui BLOQUENT une generation payante : critiques, et ni corriges (ils auraient
 * disparu du constat) ni acceptes explicitement par l'utilisateur (`film.ecartsAcceptes`).
 */
export function ecartsBloquants(film: Film, rapport: RapportFidelite = auditFidelite(film)): EcartFidelite[] {
  const acceptes = new Set(film.ecartsAcceptes ?? []);
  return rapport.ecarts.filter((e) => e.critique && !acceptes.has(e.cle));
}

/** Un resume court pour la liste de controle de l'etape Apercu. */
export function resumeFidelite(r: RapportFidelite): string {
  if (r.total === 0) return 'Aucune histoire saisie.';
  if (r.fidele && r.ecarts.length === 0) return `Vos ${r.total} phrases sont conservees, dans l’ordre.`;
  if (r.fidele) return `Vos ${r.total} phrases sont conservees, dans l’ordre · ${r.ecarts.length} point(s) a valider.`;
  return `${r.retrouvees} phrase(s) sur ${r.total} retrouvees — ${r.total - r.retrouvees} manquante(s).`;
}


/** Un probleme de voix, avec son explication et ce que l'utilisateur peut faire. */
export interface ProblemeAudio {
  code: 'aucune_replique' | 'aucun_recit' | 'locuteur_ambigu' | 'voix_partagee';
  /** Ce qui se passe, et pourquoi. */
  message: string;
  /** Ce que l'on peut faire. */
  conseil: string;
  /** Les plans concernes (repliques ambigues). */
  planIds?: string[];
}

/**
 * CE QUE LE MODE CHOISI PEUT LIRE — et ce qui l'en empeche. Pur, sans ecriture. Un film historique
 * (sans `modeAudio`) n'a aucun diagnostic : son comportement audio n'est pas touche.
 */
export function diagnosticAudio(film: Film): ProblemeAudio[] {
  const mode = film.modeAudio;
  if (!mode) return [];
  const plans = film.scenes.flatMap((s) => s.plans as PlanCinema[]);
  const repliques = plans.filter((p) => p.dialogue?.genre === 'replique');
  const recits = plans.filter((p) => p.dialogue?.genre === 'narration');
  const out: ProblemeAudio[] = [];
  if (mode === 'personnages') {
    if (repliques.length === 0) {
      out.push({
        code: 'aucune_replique',
        message: 'Ton histoire n’a aucune réplique entre guillemets : personne ne parlerait dans ce film.',
        conseil: 'Ajoute des répliques entre guillemets (par exemple Maya dit : « Bonjour »), ou choisis « Une voix raconte l’histoire ».',
      });
    }
    const ambigus = repliques.filter((p) => locuteurAmbigu(film, p));
    if (ambigus.length > 0) {
      out.push({
        code: 'locuteur_ambigu',
        message: `${ambigus.length === 1 ? 'Une réplique ne dit' : `${ambigus.length} répliques ne disent`} pas qui parle : ${ambigus.length === 1 ? 'elle ne sera pas lue' : 'elles ne seront pas lues'} tant que tu n’as pas choisi.`,
        conseil: 'Choisis qui dit chaque réplique, ou écris le prénom devant elle dans ton histoire.',
        planIds: ambigus.map((p) => p.id),
      });
    }
    const parlants = new Set(repliques.filter((p) => !locuteurAmbigu(film, p)).map((p) => p.dialogue!.personnageId));
    const voix = new Map<string, string[]>();
    for (const p of film.personnages) if (parlants.has(p.id)) voix.set(p.voix, [...(voix.get(p.voix) ?? []), p.nom]);
    for (const noms of voix.values()) {
      if (noms.length > 1) {
        out.push({
          code: 'voix_partagee',
          message: `${noms.join(' et ')} ont la même voix : on ne les distinguera pas à l’écoute.`,
          conseil: 'Choisis une voix différente pour chacun à l’étape Personnages.',
        });
      }
    }
  } else if (recits.length === 0) {
    out.push({
      code: 'aucun_recit',
      message: 'Ton histoire n’a aucune phrase de récit (sans guillemets) : la voix n’aurait rien à raconter.',
      conseil: 'Ajoute des phrases qui décrivent l’action, ou choisis « Les personnages parlent ». Studiio n’écrit jamais de texte à ta place.',
    });
  }
  return out;
}

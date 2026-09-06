/**
 * L'adaptateur Anthropic de l'étape `signaux` — ÉCRIT, ET ÉTEINT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN TROISIÈME DRAPEAU, ET SURTOUT PAS CELUI DE M3-C
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED` doit valoir exactement `"true"`.
 *
 * Partager le drapeau de M3-C ferait de son activation — déjà décidée
 * ailleurs — l'activation silencieuse d'un SECOND appel payant par analyse.
 * Le dépôt le dit déjà pour M3-B4 et M3-C : deux étapes qui coûtent
 * séparément s'allument séparément. Il y en a trois maintenant.
 *
 * ⚠️ AUCUN MODÈLE PAR DÉFAUT. Le relevé sémantique n'a pas besoin du même
 * modèle que la sélection — il décrit là où l'autre juge. C'est justement
 * l'exploitant qui doit pouvoir le dire, et non ce fichier à sa place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE SORT JAMAIS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun `console`. Pas de clé, pas de base 64, pas d'octet d'image, pas de
 * corps de requête, pas d'URL, pas de clé de stockage.
 */
import { INVITE_SIGNAUX } from './candidat-signaux-invite';
import { SIGNAUX_MAX } from './candidat-signaux-contrat';
// ⚠️ LE MÊME VOCABULAIRE QUE LE VALIDATEUR, JAMAIS UNE COPIE. Un enum recopié
// ici dériverait du contrat sans que rien ne le signale, et le modèle
// répondrait dans un vocabulaire que la lecture transformerait en
// `indetermine` — un signal perdu en silence, sur toute la production.
import {
  PRESENCES_PERSONNES, ECHELLES_PLAN, EXPRESSIONS_VISIBLES, PRESENCES_OBSERVEES,
} from './signaux-contrat';

const POINT_ACCES = 'https://api.anthropic.com/v1/messages';
const VERSION_API = '2023-06-01';

/**
 * Le plafond de jetons de sortie.
 *
 * Six relevés de huit champs, tous choisis dans des listes fermées, aucune
 * phrase : quelques centaines de jetons suffisent au JSON lui-même. C'est
 * une borne DURE sur ce qu'un modèle bavard peut coûter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI CE PLAFOND N'EST PLUS À MILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mille suffisait tant qu'un modèle ne faisait qu'écrire. Sur les modèles
 * récents, le raisonnement est ACTIF PAR DÉFAUT et ses jetons se prennent
 * sur CE MÊME plafond : le modèle pouvait donc épuiser les mille jetons
 * avant d'avoir écrit une accolade. La réponse revenait tronquée,
 * `lireReponseSignaux` la refusait, et l'enrichissement retombait à
 * `signaux: null` — donc `m3g-v2` — SANS QUE RIEN NE LE DISE, en payant
 * chaque appel. Exactement la panne muette que ce dépôt refuse.
 *
 * ⚠️ ET C'EST UN PLAFOND, PAS UNE DÉPENSE. Un modèle qui ne raisonne pas
 * écrit toujours ses quelques centaines de jetons et n'est facturé que sur
 * eux : relever la borne ne coûte rien là où elle ne servait pas. On ne
 * touche donc NI `thinking` NI `output_config.effort`, qui ne sont acceptés
 * que par certains modèles — cet adaptateur doit rester agnostique du
 * modèle que l'exploitant configure.
 */
const JETONS_SORTIE_MAX = 8000;

/** Le délai de l'étape. Un relevé sans rédaction va vite, ou ne vient pas. */
export const TIMEOUT_SIGNAUX_MS = 40_000;

export type MotifConfigurationSignaux = 'cle_absente' | 'modele_absent';

export class ConfigurationSignauxInvalide extends Error {
  readonly motif: MotifConfigurationSignaux;
  constructor(motif: MotifConfigurationSignaux) {
    super(`configuration signaux incomplete: ${motif}`);
    this.name = 'ConfigurationSignauxInvalide';
    this.motif = motif;
  }
}

/** L'interrupteur, et lui seul. Lu à CHAQUE appel, jamais mémoïsé. */
export function signauxAnthropicActif(): boolean {
  return process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_ENABLED === 'true';
}

/** Le transport, injectable — c'est ce qui rend l'adaptateur testable. */
export type TransportSignaux = (
  url: string, init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Une image DÉJÀ retenue, et le numéro que nous lui donnons. */
export interface MomentAEnrichir {
  /** La position dans la liste des candidats figés. NOTRE numéro. */
  indice: number;
  /** L'instant du candidat. Affiché au modèle, jamais accepté en retour. */
  seconde: number;
  mimeType: 'image/jpeg';
  data: Buffer;
}

export interface EntreeSignaux {
  moments: readonly MomentAEnrichir[];
}

export interface SortieFournisseurSignaux {
  reponse: unknown;
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  modele: string;
}

export type FournisseurSignaux =
  (entree: EntreeSignaux) => Promise<SortieFournisseurSignaux>;

/**
 * Le schéma de sortie — le contrat, dit au modèle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'`enum` QUI PORTE TOUTE LA SÉCURITÉ DE CETTE ÉTAPE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `indice` est enfermé dans les numéros que NOUS avons émis. Le décodage
 * contraint empêche donc le modèle de désigner un moment qui n'existe pas —
 * non pas « le lui déconseille », l'en empêche. Et comme un indice n'est pas
 * un instant, il ne peut pas non plus inventer une seconde.
 *
 * ⚠️ AUCUN CHAMP DE SÉLECTION N'EXISTE ICI : ni `secondeReference`, ni
 * `dureeCibleSecondes`, ni `scoreMontage`, ni `raison`. Ce n'est pas un
 * oubli — c'est ce qui rend impossible, structurellement, qu'un
 * enrichissement modifie un candidat.
 *
 * Les bornes chiffrées vivent dans `description` : les sorties structurées
 * excluent `minimum` / `maximum`, et le validateur local les revérifie.
 */
function schemaSignaux(indices: readonly number[]): Record<string, unknown> {
  const categorie = (vocabulaire: readonly string[], description: string) => ({
    type: 'string', enum: [...vocabulaire], description,
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['signaux'],
    properties: {
      signaux: {
        type: 'array',
        // ⚠️ PAS DE `minItems`. Les sorties structurées n'acceptent pas les
        // contraintes de tableau, exactement comme elles refusent `minimum`
        // et `maximum` plus bas. Envoyée telle quelle, la clé risque de faire
        // refuser le schéma entier à la compilation — et l'étape échouerait
        // pour une contrainte que `lireReponseSignaux` revérifie déjà, en
        // exigeant un relevé par image, ni plus ni moins.
        description: `Un relevé par image, exactement. Au plus ${SIGNAUX_MAX}. Aucun numéro en double, aucun numéro omis.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'indice', 'personnes', 'echellePlan', 'expression', 'objetMisEnAvant',
            'mainsEnAction', 'marqueVisible', 'texteALEcran', 'nettete',
          ],
          properties: {
            indice: {
              type: 'number',
              enum: [...indices],
              description: 'Le numéro de l’image relevée. Uniquement l’un de ceux montrés.',
            },
            personnes: categorie(
              PRESENCES_PERSONNES,
              'Combien de personnes sont visibles. Aucune identification.',
            ),
            echellePlan: categorie(ECHELLES_PLAN, 'L’échelle de cadrage de l’image.'),
            expression: categorie(
              EXPRESSIONS_VISIBLES,
              'L’expression lisible sur un visage. « indetermine » sans visage lisible.',
            ),
            objetMisEnAvant: categorie(
              PRESENCES_OBSERVEES, 'Un objet délibérément présenté, tenu ou centré.',
            ),
            mainsEnAction: categorie(
              PRESENCES_OBSERVEES,
              'Des mains en train d’agir sur quelque chose, sur cette image.',
            ),
            marqueVisible: categorie(
              PRESENCES_OBSERVEES, 'Un logo ou un nom de marque lisible dans l’image.',
            ),
            texteALEcran: categorie(
              PRESENCES_OBSERVEES, 'Du texte lisible dans l’image, incrusté ou filmé.',
            ),
            nettete: {
              type: 'number',
              description: 'La netteté de CETTE image. Nombre de 0 à 1 inclus.',
            },
          },
        },
      },
    },
  };
}

/**
 * Construit le fournisseur, ou rend `null` si l'interrupteur est ouvert.
 *
 * ⚠️ L'ORDRE COMPTE : l'interrupteur est lu AVANT la configuration. Un
 * serveur qui n'active pas l'enrichissement ne doit pas échouer parce qu'il
 * n'a pas de clé — il n'en a pas besoin.
 */
export function fournisseurSignauxAnthropic(
  transport?: TransportSignaux,
): FournisseurSignaux | null {
  if (!signauxAnthropicActif()) return null;

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ConfigurationSignauxInvalide('cle_absente');

  const modele = process.env.AUTOPILOT_SIGNAUX_ANTHROPIC_MODEL;
  if (!modele) throw new ConfigurationSignauxInvalide('modele_absent');

  const envoyer: TransportSignaux = transport ?? ((url, init) => fetch(url, init));

  return async (entree) => {
    // Ceinture : la borne est déjà appliquée en amont, mais l'adaptateur ne
    // doit pas dépendre de la prudence de son appelant.
    const moments = entree.moments.slice(0, SIGNAUX_MAX);

    // ⚠️ UN SEUL APPEL POUR TOUS LES MOMENTS. Un appel par candidat
    // multiplierait le coût par six pour la même information, et six
    // réponses indépendantes n'apporteraient aucune garantie de plus —
    // l'appariement est déjà vérifié, indice par indice, à la lecture.
    const contenu: unknown[] = [];
    for (const m of moments) {
      contenu.push({
        type: 'text',
        text: `Image numéro ${m.indice}, à ${m.seconde} secondes :`,
      });
      contenu.push({
        type: 'image',
        source: { type: 'base64', media_type: m.mimeType, data: m.data.toString('base64') },
      });
    }
    contenu.push({
      type: 'text',
      text: 'Réponds uniquement par le JSON conforme au schéma fourni. '
        + 'Un relevé par image, exactement, en reprenant son numéro. '
        + `Les numéros à reprendre sont exactement : ${moments.map((m) => m.indice).join(', ')}.`,
    });

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_SIGNAUX_MS);

    let reponseHttp: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      reponseHttp = await envoyer(POINT_ACCES, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cle,
          'anthropic-version': VERSION_API,
        },
        body: JSON.stringify({
          model: modele,
          max_tokens: JETONS_SORTIE_MAX,
          system: INVITE_SIGNAUX,
          messages: [{ role: 'user', content: contenu }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: schemaSignaux(moments.map((m) => m.indice)),
            },
          },
        }),
        signal: controleur.signal,
      });
    } finally {
      clearTimeout(minuteur);
    }

    if (!reponseHttp.ok) {
      // Le STATUT, et rien d'autre : le corps d'une erreur de fournisseur
      // peut porter un identifiant de requête, une URL, voire une clé.
      throw new Error(`fournisseur_http_${reponseHttp.status}`);
    }

    const corps = await reponseHttp.json() as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };

    const premier = corps.content?.find((b) => b?.type === 'text');
    const brut = typeof premier?.text === 'string' ? premier.text : '';

    return {
      reponse: brut,
      usage: {
        inputTokens: corps.usage?.input_tokens,
        outputTokens: corps.usage?.output_tokens,
      },
      // Le modèle CONFIGURÉ, jamais celui que la réponse prétendrait être.
      modele,
    };
  };
}

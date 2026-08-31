/**
 * L'adaptateur Anthropic de l'étape visuelle — ÉCRIT, ET ÉTEINT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ IL NE S'ACTIVE QUE SUR UNE DEMANDE EXPLICITE, ET RIEN D'AUTRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `AUTOPILOT_VISUEL_ANTHROPIC_ENABLED` doit valoir exactement `"true"`. Pas
 * `"1"`, pas `"oui"`, pas une chaîne non vide : la valeur exacte. Une variable
 * d'environnement qui s'active « à peu près » finit par s'activer par accident
 * — et ici un accident coûte de l'argent à chaque rush analysé.
 *
 * Sans elle, `fournisseurAnthropic()` rend `null` et **aucune ligne de ce
 * fichier ne touche au réseau**. Le comportement est alors exactement celui
 * d'avant M3-B4 : l'analyse se clôt à l'étape `extraction`.
 *
 * ⚠️ AUCUN MODÈLE PAR DÉFAUT. Si l'activation est demandée sans clé ou sans
 * nom de modèle, c'est un ÉCHEC DE CONFIGURATION, pas un repli silencieux. Un
 * repli choisirait à la place de l'exploitant quel modèle il paie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI `fetch` NATIF ET AUCUNE DÉPENDANCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le dépôt appelle déjà Anthropic ainsi dans `api/chat/assistant` et
 * `api/content/ai-generate` : `x-api-key`, `anthropic-version: 2023-06-01`,
 * corps JSON. Un SDK n'apporterait rien qu'une vingtaine de lignes n'apportent,
 * et ajouterait une surface à auditer — c'est le raisonnement qui a déjà fait
 * refuser `ffprobe-static`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE SORT JAMAIS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun `console`. Pas de clé, pas de base64, pas d'octet d'image, pas de
 * corps de requête, pas d'URL. Les erreurs remontent en objets `Error` dont le
 * message est ensuite masqué et tronqué par `analyserVisuelRush`.
 */
import { INVITE_VISUELLE } from './visuel-invite';
import { TIMEOUT_VISUEL_MS, IMAGES_MAX, type FournisseurVisuel } from './visuel';
// ⚠️ LA MÊME SOURCE QUE LE VALIDATEUR, JAMAIS UNE COPIE. Un vocabulaire
// recopié à la main ici divergerait au premier ajout dans `PROBLEMES_VISUELS`,
// et la divergence serait muette : le schéma interdirait une valeur que le
// validateur accepte, ou l'inverse.
import {
  PROBLEMES_VISUELS, PROBLEMES_MAX, RESUME_MAX,
  TEXTES_VISIBLES_MAX, TEXTE_VISIBLE_MAX,
} from './visuel-contrat';

/** Le point d'accès, tel que le reste du dépôt l'écrit déjà. */
const POINT_ACCES = 'https://api.anthropic.com/v1/messages';

/** La version d'API, identique aux deux autres appelants du dépôt. */
const VERSION_API = '2023-06-01';

/**
 * Le plafond de jetons de sortie.
 *
 * Le contrat attend un résumé de quelques phrases, au plus douze textes et
 * sept nombres. Deux mille jetons, c'est quatre fois ce qu'il faut — et une
 * borne dure sur ce qu'un modèle bavard peut coûter en sortie.
 */
const JETONS_SORTIE_MAX = 2000;

/**
 * Le schéma de sortie structurée — le contrat, dit au modèle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LES BORNES SONT DANS `description` ET NON DANS LE SCHÉMA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La documentation Anthropic des sorties structurées énumère ce que le schéma
 * accepte, et elle EXCLUT explicitement `maximum`, `minimum`, `maxLength` et
 * `maxItems` (seul `minItems` à 0 ou 1 passe). Les SDK officiels ne les
 * envoient donc pas : ils retirent la contrainte, l'ajoutent à la description
 * du champ, et la revérifient côté client. Cet adaptateur parle en `fetch`
 * natif, sans SDK — il fait donc à la main ce que le SDK ferait, plutôt que
 * d'envoyer des mots-clés que l'API ne promet pas d'honorer.
 *
 * ⚠️ CE SCHÉMA NE REMPLACE PAS `lireReponseVisuelle`. Il rend la sortie
 * DÉTERMINISTE, il ne la rend pas digne de confiance : les bornes chiffrées ne
 * sont pas contraintes par le décodage, et un fournisseur reste un tiers. Le
 * validateur local demeure la dernière barrière, inchangé.
 *
 * `usage` n'y figure pas, et ne doit jamais y figurer : il vient du transport,
 * jamais de ce que le modèle raconte sur sa propre consommation.
 */
function schemaVisuel(secondes: readonly number[]): Record<string, unknown> {
  const note = (texte: string) => ({ type: 'number', description: texte });

  // `enum` accepte les nombres. Quand on connaît les instants réellement
  // MONTRÉS, les y enfermer supprime la classe d'erreur « instant inventé » à
  // la génération. Sans instants — cas qui n'arrive pas, l'étape s'arrête
  // avant — on retombe sur un nombre libre, que le validateur bornera.
  const seconde = secondes.length > 0
    ? { type: 'number', enum: [...secondes], description: 'L’instant de l’image où le texte est lu.' }
    : note('L’instant de l’image où le texte est lu.');

  const score = (quoi: string) => ({
    type: 'integer',
    description: `${quoi} Entier de 0 à 100 inclus.`,
  });

  return {
    type: 'object',
    additionalProperties: false,
    required: ['resume', 'textesVisibles', 'qualite'],
    properties: {
      resume: {
        type: 'string',
        description: `Résumé visuel du rush, en français. Au plus ${RESUME_MAX} caractères.`,
      },
      textesVisibles: {
        type: 'array',
        description: `Les textes réellement lisibles dans les images, dans l’ordre chronologique. Au plus ${TEXTES_VISIBLES_MAX} entrées. Liste vide si aucun texte n’est lisible.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['texte', 'seconde', 'confiance'],
          properties: {
            texte: {
              type: 'string',
              description: `Le texte lu, tel qu’il apparaît. Au plus ${TEXTE_VISIBLE_MAX} caractères.`,
            },
            seconde,
            confiance: note('Ta confiance de lecture, nombre de 0 à 1 inclus.'),
          },
        },
      },
      qualite: {
        type: 'object',
        additionalProperties: false,
        required: [
          'scoreGlobal', 'nettete', 'lumiere', 'cadrage', 'energie',
          'interetVisuel', 'problemes',
        ],
        properties: {
          scoreGlobal: score('La note d’ensemble.'),
          nettete: score('La netteté.'),
          lumiere: score('La lumière.'),
          cadrage: score('Le cadrage.'),
          energie: score('L’énergie visuelle.'),
          interetVisuel: score('L’intérêt visuel.'),
          problemes: {
            type: 'array',
            description: `Les défauts techniques visibles. Au plus ${PROBLEMES_MAX} éléments, sans répétition.`,
            items: { type: 'string', enum: [...PROBLEMES_VISUELS] },
          },
        },
      },
    },
  };
}

/** Pourquoi la configuration ne permet pas d'activer l'adaptateur. */
export type MotifConfiguration = 'cle_absente' | 'modele_absent';

export class ConfigurationVisuelleInvalide extends Error {
  readonly motif: MotifConfiguration;
  constructor(motif: MotifConfiguration) {
    super(`configuration visuelle incomplete: ${motif}`);
    this.name = 'ConfigurationVisuelleInvalide';
    this.motif = motif;
  }
}

/** L'interrupteur, et lui seul. Lu à CHAQUE appel, jamais mémoïsé. */
export function anthropicActive(): boolean {
  return process.env.AUTOPILOT_VISUEL_ANTHROPIC_ENABLED === 'true';
}

/**
 * Le transport, injectable — c'est ce qui rend l'adaptateur testable sans
 * jamais ouvrir une socket. En production, `fetch` natif.
 */
export type Transport = (
  url: string, init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Construit le fournisseur, ou rend `null` si l'interrupteur est ouvert.
 *
 * ⚠️ L'ORDRE COMPTE : l'interrupteur est lu AVANT la configuration. Un
 * serveur qui n'active pas l'adaptateur ne doit pas échouer parce qu'il n'a
 * pas de clé — il n'en a pas besoin.
 *
 * Lève `ConfigurationVisuelleInvalide` si l'activation est demandée mais que
 * la clé ou le modèle manque. Un `null` silencieux ferait croire que le
 * fournisseur est branché alors qu'il ne l'est pas.
 */
export function fournisseurAnthropic(transport?: Transport): FournisseurVisuel | null {
  if (!anthropicActive()) return null;

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ConfigurationVisuelleInvalide('cle_absente');

  // AUCUN modèle par défaut : choisir à la place de l'exploitant, c'est
  // choisir ce qu'il paie.
  const modele = process.env.AUTOPILOT_VISUEL_ANTHROPIC_MODEL;
  if (!modele) throw new ConfigurationVisuelleInvalide('modele_absent');

  const envoyer: Transport = transport ?? ((url, init) => fetch(url, init));

  return async (entree) => {
    // Ceinture : la borne est déjà appliquée en amont par `lireImagesAnalyse`,
    // mais l'adaptateur ne doit pas dépendre de la prudence de son appelant.
    const images = entree.images.slice(0, IMAGES_MAX);

    // ⚠️ LES IMAGES ET LEURS INSTANTS, DANS DES BLOCS DISTINCTS.
    //
    // L'instant est annoncé en TEXTE, juste avant son image : c'est ce qui
    // permet au modèle de rapporter un instant qu'on lui a montré plutôt que
    // d'en déduire un. Et le prompt système reste à part, jamais concaténé
    // avec quoi que ce soit venant du rush.
    const contenu: unknown[] = [];
    for (const img of images) {
      contenu.push({ type: 'text', text: `Image à ${img.seconde} secondes :` });
      contenu.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.data.toString('base64') },
      });
    }
    // ⚠️ LE VOCABULAIRE EST DIT, PAS SOUS-ENTENDU.
    //
    // L'invite système promet des défauts « choisis UNIQUEMENT dans le
    // vocabulaire fourni » — et jusqu'à M3-B4.2 ce vocabulaire n'était fourni
    // NULLE PART. Le modèle ne lit pas notre TypeScript : il ne pouvait que
    // l'inventer, et le validateur ne pouvait que le refuser. La liste part
    // désormais deux fois, ici en toutes lettres et dans l'`enum` du schéma.
    //
    // La FORME, elle, n'est plus recopiée à la main : elle vit dans le schéma,
    // d'où elle ne peut plus diverger.
    contenu.push({
      type: 'text',
      text: 'Réponds uniquement par le JSON conforme au schéma fourni. '
        + 'Les défauts techniques se choisissent UNIQUEMENT dans ce vocabulaire : '
        + `${PROBLEMES_VISUELS.join(', ')}.`,
    });

    // `AbortController` sur le MÊME délai que l'étape : sans lui, la requête
    // continuerait de courir derrière un appel déjà abandonné.
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_VISUEL_MS);

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
          system: INVITE_VISUELLE,
          messages: [{ role: 'user', content: contenu }],
          // La sortie structurée officielle : `output_config.format`, avec
          // `type: 'json_schema'`. Aucun en-tête bêta n'est requis — la forme
          // `output_format` et l'en-tête `structured-outputs-2025-11-13` sont
          // l'ancienne écriture, encore acceptée mais dépréciée.
          output_config: {
            format: {
              type: 'json_schema',
              schema: schemaVisuel(images.map((i) => i.seconde)),
            },
          },
        }),
        signal: controleur.signal,
      });
    } finally {
      clearTimeout(minuteur);
    }

    if (!reponseHttp.ok) {
      // Le STATUT, et rien d'autre. Le corps d'une erreur de fournisseur peut
      // porter un identifiant de requête, une URL, voire un fragment de clé.
      throw new Error(`fournisseur_http_${reponseHttp.status}`);
    }

    const corps = await reponseHttp.json() as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };

    // On prend le PREMIER bloc de texte, sans fouiller : chercher « le bloc
    // qui ressemble à du JSON » serait la même complaisance que « chercher la
    // première accolade », et le contrat la refuse pour la même raison.
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

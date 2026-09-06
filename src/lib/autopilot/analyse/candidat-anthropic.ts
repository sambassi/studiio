/**
 * L'adaptateur Anthropic de l'étape `candidats` — ÉCRIT, ET ÉTEINT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN DRAPEAU À LUI, ET SURTOUT PAS CELUI DU VISUEL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED` doit valoir exactement `"true"`.
 *
 * Partager `AUTOPILOT_VISUEL_ANTHROPIC_ENABLED` avec M3-B4 ferait de son
 * activation — déjà faite en production, et validée — l'activation
 * silencieuse de M3-C. Chaque analyse de rush se mettrait alors à payer une
 * seconde requête que personne n'a demandée. Deux étapes qui coûtent séparément
 * s'allument séparément.
 *
 * ⚠️ AUCUN MODÈLE PAR DÉFAUT. Si l'activation est demandée sans clé ou sans
 * nom de modèle, c'est un ÉCHEC DE CONFIGURATION, pas un repli silencieux :
 * un repli choisirait à la place de l'exploitant quel modèle il paie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE SORT JAMAIS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun `console`. Pas de clé, pas de base 64, pas d'octet d'image, pas de
 * corps de requête, pas d'URL, pas de clé de stockage. Les erreurs remontent
 * en `Error` dont le message est ensuite masqué et tronqué par
 * `produireCandidats`.
 */
import { INVITE_CANDIDATS } from './candidat-invite';
import { TIMEOUT_CANDIDATS_MS, IMAGES_MAX, type FournisseurCandidats } from './candidat';
// ⚠️ LA MÊME SOURCE QUE LE VALIDATEUR, JAMAIS UNE COPIE.
import {
  DUREES_CANDIDAT_SECONDES, CANDIDATS_MAX, CANDIDATS_MIN, RAISON_MAX,
  SCORE_MIN, SCORE_MAX,
} from './candidat-contrat';

/** Le point d'accès, tel que le reste du dépôt l'écrit déjà. */
const POINT_ACCES = 'https://api.anthropic.com/v1/messages';

/** La version d'API, identique aux autres appelants du dépôt. */
const VERSION_API = '2023-06-01';

/**
 * Le plafond de jetons de sortie.
 *
 * Six candidats de quatre champs courts, dont une phrase de 240 caractères au
 * plus : mille jetons, c'est déjà trois fois ce qu'il faut. Plus bas que les
 * deux mille du visuel, parce que la sortie attendue est plus petite — et
 * c'est une borne dure sur ce qu'un modèle bavard peut coûter.
 */
const JETONS_SORTIE_MAX = 1000;

/** Pourquoi la configuration ne permet pas d'activer l'adaptateur. */
export type MotifConfigurationCandidats = 'cle_absente' | 'modele_absent';

export class ConfigurationCandidatsInvalide extends Error {
  readonly motif: MotifConfigurationCandidats;
  constructor(motif: MotifConfigurationCandidats) {
    super(`configuration candidats incomplete: ${motif}`);
    this.name = 'ConfigurationCandidatsInvalide';
    this.motif = motif;
  }
}

/** L'interrupteur, et lui seul. Lu à CHAQUE appel, jamais mémoïsé. */
export function candidatsAnthropicActif(): boolean {
  return process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_ENABLED === 'true';
}

/** Le transport, injectable — c'est ce qui rend l'adaptateur testable. */
export type TransportCandidats = (
  url: string, init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Le schéma de sortie structurée — le contrat, dit au modèle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES DEUX `enum` QUI PORTENT TOUTE LA SÉCURITÉ DU LOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `secondeReference` est enfermé dans les instants RÉELLEMENT montrés, et
 * `dureeCibleSecondes` dans les quatre longueurs proposées. Le décodage
 * contraint empêche donc le modèle d'écrire un timecode qu'il n'a pas vu —
 * non pas « le lui déconseille », l'en empêche.
 *
 * ⚠️ CELA NE REMPLACE PAS `lireReponseCandidats`. Un `enum` est une promesse
 * du fournisseur ; le validateur local est ce qui la vérifie. Les deux.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LES BORNES CHIFFRÉES SONT DANS `description`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La documentation des sorties structurées exclut `minimum`, `maximum`,
 * `maxLength` et `maxItems` — seul `minItems` à 0 ou 1 passe. Les SDK
 * officiels retirent la contrainte, la reportent dans la description du
 * champ, et la revérifient côté client. Cet adaptateur parle en `fetch`
 * natif : il fait à la main ce que le SDK ferait, plutôt que d'envoyer des
 * mots-clés que l'API ne promet pas d'honorer.
 *
 * `usage` n'y figure pas, et ne doit jamais y figurer : il vient du
 * transport, jamais de ce que le modèle raconte sur sa propre consommation.
 */
function schemaCandidats(secondes: readonly number[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidats'],
    properties: {
      candidats: {
        type: 'array',
        minItems: 1,
        description: `Les moments retenus. Au moins ${CANDIDATS_MIN}, au plus ${CANDIDATS_MAX}. Aucun instant en double.`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['secondeReference', 'dureeCibleSecondes', 'scoreMontage', 'raison'],
          properties: {
            secondeReference: {
              type: 'number',
              enum: [...secondes],
              description: 'L’instant retenu. Uniquement l’un de ceux des images montrées.',
            },
            dureeCibleSecondes: {
              type: 'number',
              enum: [...DUREES_CANDIDAT_SECONDES],
              description: 'La durée souhaitée du passage, en secondes.',
            },
            scoreMontage: {
              type: 'integer',
              description: `L’intérêt VISUEL de ce moment comme matière de montage. Entier de ${SCORE_MIN} à ${SCORE_MAX} inclus. Ne mesure ni le son, ni la parole, ni un potentiel viral.`,
            },
            raison: {
              type: 'string',
              description: `Ce qu’on voit à cet instant, en une phrase courte. Au plus ${RAISON_MAX} caractères. Aucune accroche, aucun slogan, aucune adresse web.`,
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
 * serveur qui n'active pas M3-C ne doit pas échouer parce qu'il n'a pas de
 * clé — il n'en a pas besoin.
 */
export function fournisseurCandidatsAnthropic(
  transport?: TransportCandidats,
): FournisseurCandidats | null {
  if (!candidatsAnthropicActif()) return null;

  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) throw new ConfigurationCandidatsInvalide('cle_absente');

  // AUCUN modèle par défaut : choisir à la place de l'exploitant, c'est
  // choisir ce qu'il paie. Et une variable À LUI : M3-C peut vouloir un
  // modèle moins cher que M3-B4, ou l'inverse.
  const modele = process.env.AUTOPILOT_CANDIDATS_ANTHROPIC_MODEL;
  if (!modele) throw new ConfigurationCandidatsInvalide('modele_absent');

  const envoyer: TransportCandidats = transport ?? ((url, init) => fetch(url, init));

  return async (entree) => {
    // Ceinture : la borne est déjà appliquée en amont par `lireImagesAnalyse`,
    // mais l'adaptateur ne doit pas dépendre de la prudence de son appelant.
    const images = entree.images.slice(0, IMAGES_MAX);

    const contenu: unknown[] = [];

    // ⚠️ LE CONTEXTE D'ABORD, LES IMAGES ENSUITE, ET DANS DES BLOCS DISTINCTS.
    //
    // Le contexte vient de M3-B4 : il a déjà été validé, borné, et son
    // vocabulaire est fermé. Il ne porte ni URL, ni clé de stockage, ni
    // réponse brute — `resume` est du texte, `textesVisibles` des objets à
    // trois champs, `qualite` sept nombres et une liste fermée.
    const textes = entree.contexte.textesVisibles
      .map((t) => `${t.seconde}s : ${t.texte}`)
      .join(' | ');
    contenu.push({
      type: 'text',
      text: `Durée de la vidéo : ${entree.dureeSecondes} secondes.\n`
        + `Description : ${entree.contexte.resume}\n`
        + `Textes lisibles : ${textes || 'aucun'}\n`
        + `Notes de qualité visuelle : ${JSON.stringify(entree.contexte.qualite)}`,
    });

    for (const img of images) {
      contenu.push({ type: 'text', text: `Image à ${img.seconde} secondes :` });
      contenu.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType, data: img.data.toString('base64') },
      });
    }

    contenu.push({
      type: 'text',
      text: 'Réponds uniquement par le JSON conforme au schéma fourni. '
        + 'Les instants proposables sont exactement ceux des images ci-dessus : '
        + `${images.map((i) => i.seconde).join(', ')}. `
        + 'Les durées proposables sont exactement : '
        + `${DUREES_CANDIDAT_SECONDES.join(', ')}.`,
    });

    // `AbortController` sur le MÊME délai que l'étape : sans lui, la requête
    // continuerait de courir derrière un appel déjà abandonné.
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_CANDIDATS_MS);

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
          system: INVITE_CANDIDATS,
          messages: [{ role: 'user', content: contenu }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: schemaCandidats(images.map((i) => i.seconde)),
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

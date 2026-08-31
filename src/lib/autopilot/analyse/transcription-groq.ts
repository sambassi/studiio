/**
 * M3-D2 — L'ADAPTATEUR GROQ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS INTERRUPTEURS, ET AUCUN DÉFAUT CACHÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED === 'true'  — l'interrupteur
 *   AUTOPILOT_TRANSCRIPTION_GROQ_MODEL               — le modèle, obligatoire
 *   GROQ_API_KEY                                     — la clé, obligatoire
 *
 * ⚠️ AUCUN MODÈLE PAR DÉFAUT. Choisir à la place de l'exploitant, c'est
 * choisir ce qu'il paie : `whisper-large-v3` coûte 2,8 fois
 * `whisper-large-v3-turbo`. Un défaut caché ferait payer le triple à qui
 * aurait simplement oublié une variable. Le modèle vient de l'environnement,
 * et de nulle part ailleurs — un test le vérifie sur le source.
 *
 * ⚠️ L'ORDRE COMPTE : l'interrupteur est lu AVANT la configuration. Un
 * serveur qui n'active pas M3-D2 ne doit pas échouer parce qu'il n'a pas de
 * clé — il n'en a pas besoin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE SORT JAMAIS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La clé n'est ni journalisée, ni rendue, ni recopiée dans un message. Le
 * corps d'une erreur de fournisseur non plus : il peut porter un identifiant
 * de requête, une URL, voire un fragment de configuration. Seul le STATUT
 * remonte, dans un littéral à nous.
 */
import { readFile } from 'fs/promises';
import { TIMEOUT_TRANSCRIPTION_MS, type FournisseurTranscription } from './transcription';

/** Le point d'accès, compatible OpenAI — documenté par le fournisseur. */
const POINT_ACCES = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Le format de réponse, et il n'est pas négociable.
 *
 * La documentation le dit : « response_format must be set `verbose_json` to
 * use timestamp granularities ». Sans lui, ni segments ni mots — c'est-à-dire
 * rien de ce que M3-D2 vient chercher.
 */
const FORMAT_REPONSE = 'verbose_json';

/**
 * Zéro, et documenté comme tel : « For translations and transcriptions, we
 * recommend the default value of 0. » Une température plus haute inviterait
 * le modèle à broder là où on lui demande de retranscrire.
 */
const TEMPERATURE = '0';

/** Pourquoi la configuration ne permet pas d'activer l'adaptateur. */
export type MotifConfigurationTranscription = 'cle_absente' | 'modele_absent';

export class ConfigurationTranscriptionInvalide extends Error {
  readonly motif: MotifConfigurationTranscription;
  constructor(motif: MotifConfigurationTranscription) {
    super(`configuration transcription incomplete: ${motif}`);
    this.name = 'ConfigurationTranscriptionInvalide';
    this.motif = motif;
  }
}

/** L'interrupteur, et lui seul. Lu à CHAQUE appel, jamais mémoïsé. */
export function transcriptionGroqActive(): boolean {
  return process.env.AUTOPILOT_TRANSCRIPTION_GROQ_ENABLED === 'true';
}

/** Le transport, injectable — c'est ce qui rend l'adaptateur testable. */
export type TransportTranscription = (
  url: string, init: RequestInit,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Construit le fournisseur, ou rend `null` si l'interrupteur est ouvert.
 *
 * Lève `ConfigurationTranscriptionInvalide` quand le drapeau est posé mais
 * qu'il manque la clé ou le modèle : ce n'est pas « aucun fournisseur », c'est
 * une configuration incomplète, et ça se dit. Retomber en silence sur « pas
 * de transcription » laisserait croire que tout va bien.
 */
export function fournisseurTranscriptionGroq(
  transport?: TransportTranscription,
): FournisseurTranscription | null {
  if (!transcriptionGroqActive()) return null;

  const cle = process.env.GROQ_API_KEY;
  if (!cle) throw new ConfigurationTranscriptionInvalide('cle_absente');

  const modele = process.env.AUTOPILOT_TRANSCRIPTION_GROQ_MODEL;
  if (!modele) throw new ConfigurationTranscriptionInvalide('modele_absent');

  const envoyer: TransportTranscription = transport ?? ((url, init) => fetch(url, init));

  return async (demande) => {
    // ⚠️ LE FICHIER EST LU EN MÉMOIRE, ET C'EST BORNÉ.
    //
    // `FLAC_OCTETS_MAX` (24 Mio) a déjà été vérifié par `avecAudioFlac` AVANT
    // qu'on arrive ici, et `MAX_TRANSCRIPTIONS_SIMULTANEES` vaut 1 : le pic
    // est donc de vingt-quatre mébioctets, une fois, sur un serveur qui en a
    // sept mille. Un envoi en flux éviterait cette copie, au prix d'un
    // multipart écrit à la main ; la copie bornée est le compromis honnête
    // tant que la borne tient.
    const octets = await readFile(demande.chemin);

    const formulaire = new FormData();
    // Le nom de fichier est UN LITTÉRAL À NOUS. Reprendre le chemin
    // temporaire y ferait voyager un nom de répertoire du serveur.
    formulaire.append('file', new Blob([octets], { type: 'audio/flac' }), 'piste.flac');
    formulaire.append('model', modele);
    formulaire.append('response_format', FORMAT_REPONSE);
    formulaire.append('temperature', TEMPERATURE);
    // Les deux granularités, dans deux entrées distinctes : c'est la forme
    // que la documentation décrit pour demander segments ET mots.
    formulaire.append('timestamp_granularities[]', 'segment');
    formulaire.append('timestamp_granularities[]', 'word');

    // `AbortController` sur le MÊME délai que l'étape : sans lui, la requête
    // continuerait de courir derrière un appel déjà abandonné.
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_TRANSCRIPTION_MS);

    let reponseHttp: { ok: boolean; status: number; text: () => Promise<string> };
    try {
      reponseHttp = await envoyer(POINT_ACCES, {
        method: 'POST',
        // ⚠️ AUCUN `content-type` POSÉ À LA MAIN : `FormData` porte sa propre
        // frontière multipart, et l'écrire nous-mêmes la remplacerait par une
        // valeur sans frontière — le serveur refuserait le corps entier.
        headers: { authorization: `Bearer ${cle}` },
        body: formulaire,
        signal: controleur.signal,
      });
    } finally {
      clearTimeout(minuteur);
    }

    if (!reponseHttp.ok) {
      // Le STATUT, et rien d'autre.
      throw new Error(`fournisseur_http_${reponseHttp.status}`);
    }

    return {
      reponse: await reponseHttp.text(),
      // Le modèle CONFIGURÉ, jamais celui que la réponse prétendrait être.
      modele,
    };
  };
}

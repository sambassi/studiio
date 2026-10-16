/**
 * M2-b — CONSENTEMENT à l'analyse IA des rushes personnels. Module PUR.
 *
 * Sans un consentement VALIDE du compte (même version du texte, non révoqué),
 * aucune image ni aucun son d'un rush ne part chez un fournisseur. Le texte
 * dit, dans la langue de l'utilisateur : quels fournisseurs, quelles
 * données, le transfert hors UE possible, la conservation, la révocation.
 *
 * Changer le texte = changer `VERSION_CONSENTEMENT_IA` : un consentement donné
 * sur une version antérieure n'est plus valide, il faut le redemander.
 */

export const VERSION_CONSENTEMENT_IA = 2 as const;
export const FOURNISSEURS_CONSENTEMENT = ['anthropic', 'groq'] as const;

export type LangueConsentement = 'fr' | 'en' | 'de';

export interface TexteConsentement {
  titre: string;
  paragraphes: string[];
  accepter: string;
  revoquer: string;
}

export const TEXTES_CONSENTEMENT_IA: Record<LangueConsentement, TexteConsentement> = {
  fr: {
    titre: 'Analyse IA de vos rushes (optionnelle)',
    paragraphes: [
      'Pour mieux comprendre le contenu de vos vidéos, Studiio peut envoyer quelques images fixes de chaque rush (6 au plus) à Anthropic (modèle Claude) et, s’il y a de la parole, jusqu’à 2 minutes de son à Groq (transcription Whisper).',
      'Données envoyées : des images et le son de VOS vidéos. Elles peuvent montrer des personnes et des lieux. Aucun nom, aucun e-mail, aucun identifiant de compte n’est envoyé, et aucune identification de personne n’est demandée.',
      'Ces fournisseurs sont situés aux États-Unis : un transfert hors de l’Union européenne est possible.',
      'Conservation chez les fournisseurs : Anthropic supprime en général les données reçues sous 30 jours, sauf exceptions qu’il prévoit (respect de sa politique d’usage, obligations légales) ; il ne les utilise pas pour entraîner ses modèles par défaut. Groq ne conserve pas les données par défaut, mais peut garder des journaux jusqu’à 30 jours (fiabilité, abus) ; une zéro conservation peut être activée. Chez Studiio : seule une fiche courte est gardée (sujets, lieu, objets, nombre de personnes, présence et langue de la parole — jamais le texte de ce qui est dit), jusqu’à la suppression de votre compte.',
      'Vous pouvez retirer votre accord à tout moment : plus aucun rush ne sera envoyé à partir de ce moment.',
    ],
    accepter: 'J’accepte l’analyse IA de mes rushes',
    revoquer: 'Retirer mon accord',
  },
  en: {
    titre: 'AI analysis of your footage (optional)',
    paragraphes: [
      'To better understand what your videos show, Studiio can send a few still frames of each clip (at most 6) to Anthropic (Claude model) and, if there is speech, up to 2 minutes of audio to Groq (Whisper transcription).',
      'Data sent: images and sound from YOUR videos. They may show people and places. No name, email or account identifier is sent, and no identification of people is requested.',
      'These providers are based in the United States: a transfer outside the European Union may take place.',
      'Retention at the providers: Anthropic generally deletes the data it receives within 30 days, except in the cases it provides for (enforcement of its usage policy, legal obligations); by default it does not use it to train its models. Groq does not retain data by default, but may keep logs for up to 30 days (reliability, abuse); zero data retention can be enabled. At Studiio: only a short summary is kept (topics, place, objects, number of people, presence and language of speech — never the text of what is said), until your account is deleted.',
      'You can withdraw your consent at any time: no further clip will be sent from that moment on.',
    ],
    accepter: 'I agree to the AI analysis of my footage',
    revoquer: 'Withdraw my consent',
  },
  de: {
    titre: 'KI-Analyse Ihrer Videoaufnahmen (optional)',
    paragraphes: [
      'Um den Inhalt Ihrer Videos besser zu verstehen, kann Studiio einige Standbilder jeder Aufnahme (höchstens 6) an Anthropic (Claude-Modell) senden und, falls gesprochen wird, bis zu 2 Minuten Ton an Groq (Whisper-Transkription).',
      'Gesendete Daten: Bilder und Ton IHRER Videos. Sie können Personen und Orte zeigen. Es werden weder Name, E-Mail noch Kontokennung gesendet, und es wird keine Identifizierung von Personen verlangt.',
      'Diese Anbieter haben ihren Sitz in den USA: Eine Übermittlung außerhalb der Europäischen Union ist möglich.',
      'Speicherdauer bei den Anbietern: Anthropic löscht empfangene Daten in der Regel innerhalb von 30 Tagen, außer in den von ihm vorgesehenen Ausnahmefällen (Durchsetzung seiner Nutzungsrichtlinie, gesetzliche Pflichten); standardmäßig nutzt es sie nicht zum Training seiner Modelle. Groq speichert Daten standardmäßig nicht, kann aber Protokolle bis zu 30 Tage aufbewahren (Zuverlässigkeit, Missbrauch); eine Null-Speicherung kann aktiviert werden. Bei Studiio wird nur eine kurze Übersicht gespeichert (Themen, Ort, Gegenstände, Anzahl der Personen, Vorhandensein und Sprache der Rede — nie der Text des Gesagten), bis zur Löschung Ihres Kontos.',
      'Sie können Ihre Einwilligung jederzeit widerrufen: Ab diesem Moment wird keine Aufnahme mehr gesendet.',
    ],
    accepter: 'Ich stimme der KI-Analyse meiner Aufnahmen zu',
    revoquer: 'Einwilligung widerrufen',
  },
};

export function texteConsentement(langue: unknown): TexteConsentement & { version: number; langue: LangueConsentement } {
  const l: LangueConsentement = langue === 'en' || langue === 'de' ? langue : 'fr';
  return { ...TEXTES_CONSENTEMENT_IA[l], version: VERSION_CONSENTEMENT_IA, langue: l };
}

/** Le registre écrit dans le stockage privé du compte. */
export interface RegistreConsentement {
  version: number;
  fournisseurs: string[];
  langue: LangueConsentement;
  accordeLe: string;
  revoqueLe?: string;
}

export function registreAccorde(langue: LangueConsentement, maintenant = new Date()): RegistreConsentement {
  return { version: VERSION_CONSENTEMENT_IA, fournisseurs: [...FOURNISSEURS_CONSENTEMENT], langue, accordeLe: maintenant.toISOString() };
}

export function registreRevoque(precedent: RegistreConsentement | null, maintenant = new Date()): RegistreConsentement {
  return {
    ...(precedent ?? registreAccorde('fr', maintenant)),
    revoqueLe: maintenant.toISOString(),
  };
}

/**
 * Le consentement relu est-il VALIDE pour envoyer des données ? Version
 * courante, les deux fournisseurs nommés, date d'accord lisible, non révoqué.
 * Tout le reste (absent, illisible, ancien, révoqué) vaut REFUS.
 */
export function consentementValide(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const r = x as RegistreConsentement;
  if (r.version !== VERSION_CONSENTEMENT_IA) return false;
  if (!Array.isArray(r.fournisseurs) || !FOURNISSEURS_CONSENTEMENT.every((f) => r.fournisseurs.includes(f))) return false;
  if (typeof r.accordeLe !== 'string' || Number.isNaN(Date.parse(r.accordeLe))) return false;
  if (r.revoqueLe !== undefined) return false;
  return true;
}

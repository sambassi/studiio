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

export const VERSION_CONSENTEMENT_IA = 1 as const;
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
      'Conservation : chez les fournisseurs, au plus 30 jours d’après leurs politiques publiques (pas d’entraînement de modèles sur ces données par défaut). Chez Studiio : seule une fiche courte (sujets, lieu, objets, nombre de personnes, extrait de parole de 300 caractères au plus) est gardée, jusqu’à la suppression de votre compte.',
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
      'Retention: at the providers, at most 30 days according to their public policies (no model training on this data by default). At Studiio: only a short summary (topics, place, objects, number of people, speech excerpt of at most 300 characters) is kept, until your account is deleted.',
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
      'Speicherdauer: bei den Anbietern laut ihren öffentlichen Richtlinien höchstens 30 Tage (standardmäßig kein Modelltraining mit diesen Daten). Bei Studiio wird nur eine kurze Übersicht (Themen, Ort, Gegenstände, Anzahl der Personen, Sprachauszug von höchstens 300 Zeichen) bis zur Löschung Ihres Kontos gespeichert.',
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

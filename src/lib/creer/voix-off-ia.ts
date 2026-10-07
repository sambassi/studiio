/**
 * Aide IA du texte de voix-off (Créer › Audio › « Synthèse vocale »).
 *
 * Module PUR (ni React, ni réseau) partagé par le panneau audio, qui construit
 * la requête, et par `/api/content/ai-generate` (`fieldType: 'voixOff'`), qui
 * construit la consigne du modèle.
 *
 * Deux modes, choisis d'après le champ :
 *  - champ vide      → « Proposer un texte » : un script écrit à partir du
 *                      contexte déjà connu (sujet, brief, titre, cartes, CTA…) ;
 *  - texte présent   → « Améliorer mon texte » : la même idée, rendue naturelle
 *                      à l'oral, sans perdre ni inventer d'information.
 *
 * Le résultat est TOUJOURS une proposition : l'appelant l'affiche et c'est
 * l'utilisateur qui l'accepte ou la refuse. Rien n'est remplacé d'office.
 */

export type ModeVoixOff = 'proposer' | 'ameliorer';

/** Ce que le wizard sait déjà de la vidéo — tout est facultatif. */
export interface ContexteVoixOff {
  sujet?: string;
  titre?: string;
  sousTitre?: string;
  cartes?: string[];
  cta?: string;
  ton?: string;
  /** Type / format de la vidéo (ex. « Reel vertical 9:16 »). */
  typeVideo?: string;
}

/** Borne d'un texte source envoyé au modèle. */
export const VOIX_OFF_TEXTE_MAX = 1500;
const CHAMP_MAX = 200;
const CARTES_MAX = 6;

export function modeVoixOff(texte: string | null | undefined): ModeVoixOff {
  return typeof texte === 'string' && texte.trim() ? 'ameliorer' : 'proposer';
}

export const LIBELLE_MODE_VOIX_OFF: Record<ModeVoixOff, string> = {
  proposer: 'Proposer un texte',
  ameliorer: 'Améliorer mon texte',
};

const chaine = (v: unknown, max = CHAMP_MAX): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};

/** Contexte relu : chaînes rognées et bornées, clés vides absentes. */
export function sanitizeContexteVoixOff(raw: unknown): ContexteVoixOff {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: ContexteVoixOff = {};
  for (const cle of ['sujet', 'titre', 'sousTitre', 'cta', 'ton', 'typeVideo'] as const) {
    const v = chaine(o[cle]);
    if (v) out[cle] = v;
  }
  if (Array.isArray(o.cartes)) {
    const cartes = o.cartes.map((c) => chaine(c)).filter((c): c is string => !!c).slice(0, CARTES_MAX);
    if (cartes.length) out.cartes = cartes;
  }
  return out;
}

/** Les lignes de contexte, dans l'ordre où le modèle doit les lire. */
function lignesContexte(c: ContexteVoixOff, sujet: string): string[] {
  const l: string[] = [];
  const s = c.sujet || sujet;
  if (s) l.push(`- Sujet / thème : ${s}`);
  if (c.typeVideo) l.push(`- Type de vidéo : ${c.typeVideo}`);
  if (c.ton) l.push(`- Ton souhaité : ${c.ton}`);
  if (c.titre) l.push(`- Titre affiché : ${c.titre}`);
  if (c.sousTitre) l.push(`- Sous-titre : ${c.sousTitre}`);
  if (c.cartes?.length) l.push(`- Points clés des cartes : ${c.cartes.join(' ; ')}`);
  if (c.cta) l.push(`- Appel à l'action : ${c.cta}`);
  return l;
}

/**
 * Consigne envoyée au modèle. `briefContext` est le bloc déjà produit par
 * `briefPourPrompt` (objectif, message, public, CTA) — `''` sans brief.
 */
export function promptVoixOff(input: {
  texte?: unknown;
  contexte?: unknown;
  sujet?: string;
  locale?: string;
  briefContext?: string;
}): string {
  const texte = typeof input.texte === 'string' ? input.texte.trim().slice(0, VOIX_OFF_TEXTE_MAX) : '';
  const mode = modeVoixOff(texte);
  const contexte = sanitizeContexteVoixOff(input.contexte);
  const langue = input.locale === 'en' ? 'anglais' : input.locale === 'de' ? 'allemand' : 'français';
  const lignes = lignesContexte(contexte, (input.sujet ?? '').trim());
  const blocContexte = lignes.length ? `\n\nCONTEXTE DE LA VIDÉO :\n${lignes.join('\n')}` : '';
  const brief = input.briefContext ?? '';

  const regles = `
Règles :
- Texte destiné à être LU À VOIX HAUTE par une voix de synthèse : phrases courtes, rythme naturel, ponctuation qui aide à respirer.
- En ${langue}.
- Aucun emoji, aucun hashtag, aucune didascalie, aucun nom de locuteur, aucun guillemet autour du texte.
- N'invente ni chiffre, ni promesse, ni information absente du contexte.`;

  if (mode === 'ameliorer') {
    return `Tu es scénariste de voix-off pour des vidéos courtes sur les réseaux sociaux.
Améliore le texte de voix-off ci-dessous pour qu'il sonne naturel et fluide à l'oral.

TEXTE DE L'UTILISATEUR :
"""${texte}"""

Contraintes :
- Garde le même sens, les mêmes informations, noms, chiffres et le même appel à l'action.
- Longueur proche de l'original (à ±30 %).
- Corrige les tournures écrites ou lourdes, sans changer le message.${regles}${blocContexte}${brief}

Réponds UNIQUEMENT en JSON: {"text":"..."}`;
  }

  return `Tu es scénariste de voix-off pour des vidéos courtes sur les réseaux sociaux.
Écris le texte de voix-off de cette vidéo (2 à 4 phrases, 35 à 60 mots), qui accroche dès la première phrase et se termine par l'appel à l'action s'il est connu.${regles}${blocContexte}${brief}

Réponds UNIQUEMENT en JSON: {"text":"..."}`;
}

/** Corps de la requête `/api/content/ai-generate` envoyée par le panneau audio. */
export function corpsRequeteVoixOff(input: {
  texte: string;
  contexte?: ContexteVoixOff;
  brief?: unknown;
  locale?: string;
}): Record<string, unknown> {
  const contexte = sanitizeContexteVoixOff(input.contexte);
  return {
    fieldType: 'voixOff',
    topic: contexte.sujet || 'vidéo',
    locale: input.locale ?? 'fr',
    sourceText: input.texte.trim().slice(0, VOIX_OFF_TEXTE_MAX),
    contexte,
    ...(input.brief ? { brief: input.brief } : null),
  };
}

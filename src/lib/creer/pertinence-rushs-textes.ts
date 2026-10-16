/**
 * M2-c — Textes de la PERTINENCE des rushes, en français, anglais et allemand.
 *
 * Module PUR : les raisons sont des CODES (+ identifiants de la taxonomie
 * fermée `CONCEPTS`) rendus ici en phrases courtes. Aucun texte venu d'une
 * fiche, d'un fournisseur ou d'un nom de fichier n'y entre jamais.
 */
import { conceptParId } from '@/lib/stock/requetes';

export type LanguePertinence = 'fr' | 'en' | 'de';

export type SourcePertinence = 'pexels-description' | 'vision' | 'parole' | 'metadonnees' | 'nom-fichier';

export type CodeMotif =
  | 'theme_inconnu'
  | 'non_identifie'
  | 'sans_lien'
  | 'recherche_contredite'
  | 'contradictoire'
  | 'comme_sujet'
  | 'comme_sujet_une_source'
  | 'proche_sujet'
  | 'meme_famille'
  | 'decor'
  | 'divergence'
  | 'hors_sujet';

export interface MotifPertinence {
  code: CodeMotif;
  /** Identifiant `CONCEPTS` de ce que montre le rush. */
  concept?: string;
  /** Identifiant `CONCEPTS` du sujet de la vidéo. */
  theme?: string;
  sources?: SourcePertinence[];
}

/** Noms des concepts utiles à la pertinence (activités, lieux, objets) — le français vient de `CONCEPTS`. */
const NOMS: Record<'en' | 'de', Record<string, string>> = {
  en: {
    cardio: 'Cardio', dance: 'Dance', yoga: 'Yoga', meditation: 'Meditation', running: 'Running', 'strength-training': 'Strength training',
    stretching: 'Stretching', cycling: 'Cycling', swimming: 'Swimming', boxing: 'Boxing', workout: 'Workout', 'healthy-food': 'Healthy eating',
    'rest-recovery': 'Recovery', wellness: 'Wellness', 'personal-finance': 'Finance', skincare: 'Beauty', cooking: 'Cooking', travel: 'Travel',
    productivity: 'Productivity', beach: 'beach', gym: 'gym', studio: 'studio', outdoor: 'outdoors', city: 'city', home: 'home',
    headphones: 'headphones', music: 'music', 'water-bottle': 'water bottle', 'yoga-mat': 'yoga mat',
  },
  de: {
    cardio: 'Cardio', dance: 'Tanz', yoga: 'Yoga', meditation: 'Meditation', running: 'Laufen', 'strength-training': 'Krafttraining',
    stretching: 'Dehnen', cycling: 'Radfahren', swimming: 'Schwimmen', boxing: 'Boxen', workout: 'Training', 'healthy-food': 'Gesunde Ernährung',
    'rest-recovery': 'Erholung', wellness: 'Wohlbefinden', 'personal-finance': 'Finanzen', skincare: 'Beauty', cooking: 'Kochen', travel: 'Reisen',
    productivity: 'Produktivität', beach: 'Strand', gym: 'Fitnessstudio', studio: 'Studio', outdoor: 'draußen', city: 'Stadt', home: 'Zuhause',
    headphones: 'Kopfhörer', music: 'Musik', 'water-bottle': 'Trinkflasche', 'yoga-mat': 'Yogamatte',
  },
};

const SOURCES: Record<LanguePertinence, Record<SourcePertinence, string>> = {
  fr: { 'pexels-description': 'description', vision: 'image', parole: 'parole', metadonnees: 'informations enregistrées', 'nom-fichier': 'nom du fichier' },
  en: { 'pexels-description': 'description', vision: 'image', parole: 'speech', metadonnees: 'saved details', 'nom-fichier': 'file name' },
  de: { 'pexels-description': 'Beschreibung', vision: 'Bild', parole: 'Sprache', metadonnees: 'gespeicherte Angaben', 'nom-fichier': 'Dateiname' },
};

type Gabarit = (c: string, t: string, s: string) => string;
const MOTIFS: Record<LanguePertinence, Record<CodeMotif, Gabarit>> = {
  fr: {
    theme_inconnu: () => 'Sujet non reconnu par Studiio : pertinence non évaluée',
    non_identifie: () => 'Contenu non identifié : analyse de contenu non disponible',
    sans_lien: () => 'Aucun lien établi avec le sujet',
    recherche_contredite: () => 'À vérifier : la description ne correspond pas à la recherche',
    contradictoire: (_c, _t, s) => `À vérifier : indices contradictoires (${s})`,
    comme_sujet: (c, _t, s) => `Montre ${c}, comme le sujet (${s})`,
    comme_sujet_une_source: (c, _t, s) => `Semble montrer ${c}, comme le sujet (une seule source : ${s})`,
    proche_sujet: (c, t) => `Montre ${c}, proche du sujet ${t}`,
    meme_famille: (c, t) => `Montre ${c}, activité voisine du sujet ${t}`,
    decor: (c) => `Décor en lien avec le sujet : ${c}`,
    divergence: (c, t) => `À vérifier : semble montrer ${c}, sujet ${t} (une seule source)`,
    hors_sujet: (c, t, s) => `Hors sujet pour ${t} : montre ${c} (${s})`,
  },
  en: {
    theme_inconnu: () => 'Topic not recognised by Studiio: relevance not assessed',
    non_identifie: () => 'Content not identified: no content analysis available',
    sans_lien: () => 'No established link with the topic',
    recherche_contredite: () => 'To check: the description does not match the search',
    contradictoire: (_c, _t, s) => `To check: conflicting clues (${s})`,
    comme_sujet: (c, _t, s) => `Shows ${c}, like the topic (${s})`,
    comme_sujet_une_source: (c, _t, s) => `Seems to show ${c}, like the topic (single source: ${s})`,
    proche_sujet: (c, t) => `Shows ${c}, close to the topic ${t}`,
    meme_famille: (c, t) => `Shows ${c}, an activity related to the topic ${t}`,
    decor: (c) => `Setting linked to the topic: ${c}`,
    divergence: (c, t) => `To check: seems to show ${c}, topic ${t} (single source)`,
    hors_sujet: (c, t, s) => `Off-topic for ${t}: shows ${c} (${s})`,
  },
  de: {
    theme_inconnu: () => 'Thema von Studiio nicht erkannt: Relevanz nicht bewertet',
    non_identifie: () => 'Inhalt nicht erkannt: keine Inhaltsanalyse verfügbar',
    sans_lien: () => 'Kein Bezug zum Thema festgestellt',
    recherche_contredite: () => 'Zu prüfen: Die Beschreibung passt nicht zur Suche',
    contradictoire: (_c, _t, s) => `Zu prüfen: widersprüchliche Hinweise (${s})`,
    comme_sujet: (c, _t, s) => `Zeigt ${c}, wie das Thema (${s})`,
    comme_sujet_une_source: (c, _t, s) => `Scheint ${c} zu zeigen, wie das Thema (nur eine Quelle: ${s})`,
    proche_sujet: (c, t) => `Zeigt ${c}, nah am Thema ${t}`,
    meme_famille: (c, t) => `Zeigt ${c}, eine verwandte Aktivität zum Thema ${t}`,
    decor: (c) => `Umgebung passend zum Thema: ${c}`,
    divergence: (c, t) => `Zu prüfen: scheint ${c} zu zeigen, Thema ${t} (nur eine Quelle)`,
    hors_sujet: (c, t, s) => `Themenfremd für ${t}: zeigt ${c} (${s})`,
  },
};

/** Textes fixes du panneau Créer. */
export const TEXTES_PANNEAU: Record<LanguePertinence, {
  badgeHorsSujet: (theme: string) => string;
  badgeAVerifier: string;
  media: (n: number) => string;
  coherents: (n: number) => string;
  inconnus: (n: number) => string;
  mention: string;
  ecarter: string;
  accepter: string;
  introuvable: string;
}> = {
  fr: {
    badgeHorsSujet: (t) => `Hors sujet pour ${t}`,
    badgeAVerifier: 'À vérifier',
    media: (n) => `Média ${n > 0 ? n : ''}`.trim(),
    coherents: (n) => (n === 1 ? '1 rush cohérent avec le sujet' : `${n} rushes cohérents avec le sujet`),
    inconnus: (n) => (n === 1 ? 'Contenu non identifié pour 1 rush' : `Contenu non identifié pour ${n} rushes`),
    mention: 'Recommandation seulement : ce rush reste dans votre montage tant que vous ne l’écartez pas.',
    ecarter: 'Écarter ce rush',
    accepter: 'Utiliser quand même',
    introuvable: 'Ce rush n’est plus dans la liste : rien n’a été retiré.',
  },
  en: {
    badgeHorsSujet: (t) => `Off-topic for ${t}`,
    badgeAVerifier: 'To check',
    media: (n) => `Media ${n > 0 ? n : ''}`.trim(),
    coherents: (n) => (n === 1 ? '1 clip consistent with the topic' : `${n} clips consistent with the topic`),
    inconnus: (n) => (n === 1 ? 'Content not identified for 1 clip' : `Content not identified for ${n} clips`),
    mention: 'Recommendation only: this clip stays in your edit unless you remove it.',
    ecarter: 'Remove this clip',
    accepter: 'Use it anyway',
    introuvable: 'This clip is no longer in the list: nothing was removed.',
  },
  de: {
    badgeHorsSujet: (t) => `Themenfremd für ${t}`,
    badgeAVerifier: 'Zu prüfen',
    media: (n) => `Medium ${n > 0 ? n : ''}`.trim(),
    coherents: (n) => (n === 1 ? '1 Clip passt zum Thema' : `${n} Clips passen zum Thema`),
    inconnus: (n) => (n === 1 ? 'Inhalt für 1 Clip nicht erkannt' : `Inhalt für ${n} Clips nicht erkannt`),
    mention: 'Nur eine Empfehlung: Dieser Clip bleibt in Ihrem Schnitt, bis Sie ihn entfernen.',
    ecarter: 'Diesen Clip entfernen',
    accepter: 'Trotzdem verwenden',
    introuvable: 'Dieser Clip ist nicht mehr in der Liste: Es wurde nichts entfernt.',
  },
};

export function langueDe(l: unknown): LanguePertinence {
  return l === 'en' || l === 'de' ? l : 'fr';
}

/** Nom d'un concept dans la langue demandée (français : libellé de `CONCEPTS`). */
export function nomConcept(id: string | undefined, langue: LanguePertinence = 'fr'): string {
  if (!id) return '';
  if (langue !== 'fr' && NOMS[langue][id]) return NOMS[langue][id];
  return conceptParId(id)?.libelle ?? '';
}

/** Une raison en phrase courte. */
export function texteMotif(m: MotifPertinence, langue: LanguePertinence = 'fr'): string {
  const sources = (m.sources ?? []).map((s) => SOURCES[langue][s]).join(' + ');
  return MOTIFS[langue][m.code](nomConcept(m.concept, langue), nomConcept(m.theme, langue), sources);
}

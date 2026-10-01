/**
 * CONSEILLER TEXTE — accroche, cartes, CTA. Module PUR.
 *
 * Mesures : mots, caractères, temps d'affichage, temps de lecture estimé,
 * répétitions (lexicales), présence d'un verbe d'action dans le CTA. Les
 * réécritures sont produites par RÈGLES (aucun fournisseur, aucune IA) :
 * elles reprennent les mots de l'utilisateur ; quand aucune règle ne
 * s'applique, il n'y a pas de proposition plutôt qu'une invention.
 */
import type { Conseil } from '@/lib/creer/conseiller/types';

export interface TextesVideo {
  profil: string;
  theme?: string | null;
  /** Brief / objectif : oriente le CTA proposé. */
  objectif?: string | null;
  titre?: string | null;
  sousTitre?: string | null;
  cartes?: Array<{ titre?: string | null; valeur?: string | null }>;
  cta?: string | null;
  ctaSecondaire?: string | null;
  /** Temps d'affichage réels (s). `null` = inconnu. */
  fenetres?: {
    titre: [number, number] | null;
    cartes: Array<{ index: number; debut: number; fin: number }>;
    cta: [number, number] | null;
  } | null;
}

/** Règles short-form (CARDIO_DANCE / fitness, et par défaut). */
export const REGLES_TEXTE = {
  accrocheMotsMax: 8,
  accrocheMotsMin: 3,
  carteMotsMax: 4,
  carteDureeMin: 1.5,
  carteDureeMax: 3,
  ctaMotsMax: 8,
  ctaDureeMin: 2,
  /** Lecture d'un texte court à l'écran : ≈ 3,3 mots/s + 0,4 s pour le repérer. */
  motsParSeconde: 3.3,
  delaiReperage: 0.4,
} as const;

const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'd', 'l', 'et', 'ou', 'a', 'au', 'aux', 'en', 'que', 'qui',
  'plus', 'moins', 'pour', 'par', 'sur', 'dans', 'avec', 'ton', 'ta', 'tes', 'ce', 'cet', 'cette', 'est', 'sont',
  'son', 'sa', 'ses', 'ne', 'pas', 'tu', 'te', 'toi', 'vous', 'votre', 'nous', 'notre', 'leur', 'leurs', 'il', 'elle',
  'the', 'and', 'of', 'to', 'your', 'you', 'la', 'plupart', 'tout', 'tous', 'toute', 'toutes', 'seulement', 'tres',
]);

/** Verbes d'action d'un CTA (impératif, tutoiement / vouvoiement) et formules consacrées. */
const ACTION_CTA = /\b(rejoins|rejoignez|reserve|reservez|essaie|essaye|essayez|teste|testez|decouvre|decouvrez|inscris|inscrivez|viens|venez|clique|cliquez|abonne|abonnez|commente|commentez|partage|partagez|ecris|ecrivez|contacte|contactez|telecharge|telechargez|achete|achetez|commande|commandez|profite|profitez|demande|demandez|lien en bio|en bio|dm|swipe)\b/;

export function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function motsDe(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(/[\s ]+/).map((w) => w.replace(/^[^\p{L}\p{N}+%-]+|[^\p{L}\p{N}%+]+$/gu, '')).filter(Boolean);
}

/** Racine grossière (comparaison de mots, pas de linguistique) : danse ~ danser. */
export function racine(mot: string): string | null {
  const w = sansAccents(mot.toLowerCase()).replace(/[^a-z]/g, '');
  if (w.length < 4 || MOTS_VIDES.has(w)) return null;
  const s = w.replace(/(es|s|x)$/, '');
  return s.length > 5 ? s.slice(0, 5) : s;
}

export function tempsLecture(nbMots: number): number {
  return Math.round((REGLES_TEXTE.delaiReperage + nbMots / REGLES_TEXTE.motsParSeconde) * 10) / 10;
}

/** Casse de phrase : « LE SPORT » → « Le sport ». */
export function casseDePhrase(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t !== t.toUpperCase()) return t.charAt(0).toUpperCase() + t.slice(1);
  const bas = t.toLowerCase();
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}

const aUneAction = (s: string) => ACTION_CTA.test(sansAccents(s.toLowerCase()));

/** Accroche proposée : une formule COURTE déjà écrite par l'utilisateur, en question. */
export function reecrireAccroche(t: TextesVideo): string | null {
  const candidates = [t.cta, t.titre, t.sousTitre?.split(/[,:;.!?—–]/)[0]]
    .map((x) => (x ?? '').trim())
    .filter((x) => {
      const n = motsDe(x).length;
      return n >= REGLES_TEXTE.accrocheMotsMin && n <= 6 && !aUneAction(x) && /\p{L}/u.test(x);
    });
  const choix = candidates[0];
  if (!choix) return null;
  return `${casseDePhrase(choix).replace(/[\s.!?…]+$/u, '')} ?`;
}

/** CTA proposé : UNE action claire, choisie d'après l'objectif / le thème. */
export function reecrireCta(t: TextesVideo): string {
  const contexte = sansAccents(`${t.objectif ?? ''} ${t.theme ?? ''} ${t.titre ?? ''}`.toLowerCase());
  if (/reserv|essai|gratuit/.test(contexte)) return 'Réserve ton essai';
  if (/boutique|achat|produit|shop|collection|commande/.test(contexte)) return 'Découvre la boutique';
  if (/cours|session|seance|class|danse|cardio|fitness|sport|zumba|entrainement/.test(contexte) || t.profil === 'CARDIO_DANCE' || t.profil === 'EVENT_IMMERSIVE') {
    return 'Rejoins la session';
  }
  return 'Lien en bio';
}

const duree = (f: [number, number] | null | undefined) => (f ? Math.round((f[1] - f[0]) * 100) / 100 : null);

export function conseilsTextes(t: TextesVideo): Conseil[] {
  const out: Conseil[] = [];
  const R = REGLES_TEXTE;

  // ── ACCROCHE (titre + sous-titre affichés ensemble) ──
  const accroche = [t.titre, t.sousTitre].filter((x) => x && x.trim()).join(' — ');
  const motsAccroche = motsDe(t.titre).length + motsDe(t.sousTitre).length;
  const fenetreAccroche = duree(t.fenetres?.titre);
  const lectureAccroche = tempsLecture(motsAccroche);
  const propositionAccroche = motsAccroche > R.accrocheMotsMax ? reecrireAccroche(t) : null;
  if (accroche) {
    const problemes: string[] = [];
    if (motsAccroche > R.accrocheMotsMax) problemes.push(`Ton accroche fait ${motsAccroche} mots : c'est trop long pour les premières secondes d'un Reel (3 à 8 mots).`);
    if (fenetreAccroche !== null && lectureAccroche > fenetreAccroche) problemes.push(`Elle reste ${fenetreAccroche.toFixed(1).replace('.', ',')} s à l'écran, il en faut environ ${lectureAccroche.toFixed(1).replace('.', ',')} pour la lire.`);
    if (t.titre && t.sousTitre && motsDe(t.sousTitre).length > 4) problemes.push('Titre et phrase longue apparaissent en même temps : deux messages à lire d\'un coup.');
    const forte = /\?|\d|\b(tu|ton|ta|tes|toi|vous)\b/i.test(sansAccents(accroche));
    if (!forte && motsAccroche > R.accrocheMotsMax) problemes.push('C\'est une affirmation : une question courte ou un chiffre accroche davantage.');
    if (problemes.length) {
      out.push({
        id: 'texte:accroche',
        section: 'Textes',
        priorite: motsAccroche > R.accrocheMotsMax || (fenetreAccroche !== null && lectureAccroche > fenetreAccroche) ? 'IMPORTANTE' : 'MOYENNE',
        cible: 'accroche',
        texteActuel: accroche,
        probleme: problemes.join(' '),
        conseil: propositionAccroche
          ? `Réduis ton accroche à une question courte : « ${propositionAccroche} ». Garde la phrase longue pour la légende du post.`
          : 'Réduis ton accroche à 3 à 8 mots, une seule idée. Garde la phrase longue pour la légende du post.',
        propositionReecrite: propositionAccroche,
        placementRecommande: null,
        dureeRecommandee: '2 à 3 secondes',
        mesures: { mots: motsAccroche, lectureS: lectureAccroche, affichageS: fenetreAccroche },
      });
    }
  }

  // ── CARTES : une idée, lisible tout de suite, 1,5 à 3 s ──
  (t.cartes ?? []).forEach((c, i) => {
    const texte = [c.titre, c.valeur].filter(Boolean).join(' · ');
    if (!texte) return;
    const nb = motsDe(c.titre).length;
    const f = t.fenetres?.cartes.find((x) => x.index === i);
    const aff = f ? Math.round((f.fin - f.debut) * 100) / 100 : null;
    const lecture = tempsLecture(nb + (c.valeur ? 1 : 0));
    const problemes: string[] = [];
    if (nb > R.carteMotsMax) problemes.push(`Cette carte fait ${nb} mots : au-delà de ${R.carteMotsMax}, elle ne se lit plus d'un coup d'œil.`);
    if (/\bet\b|,|\+ /i.test(c.titre ?? '') && nb > 2) problemes.push('Elle porte deux idées à la fois.');
    if (aff !== null && aff < R.carteDureeMin) problemes.push(`Elle ne reste que ${aff.toFixed(1).replace('.', ',')} s.`);
    if (aff !== null && lecture > aff) problemes.push(`Il faut environ ${lecture.toFixed(1).replace('.', ',')} s pour la lire.`);
    if (!problemes.length) return;
    out.push({
      id: `texte:carte:${i}`,
      section: 'Textes',
      priorite: aff !== null && (aff < R.carteDureeMin || lecture > aff) ? 'IMPORTANTE' : 'MOYENNE',
      cible: `carte:${i}`,
      texteActuel: texte,
      probleme: problemes.join(' '),
      conseil: 'Une seule idée par carte, en 2 à 4 mots, avec le chiffre bien visible.',
      propositionReecrite: null,
      placementRecommande: null,
      dureeRecommandee: '1,5 à 3 secondes',
      mesures: { mots: nb, lectureS: lecture, affichageS: aff },
    });
  });

  // ── CTA : une action claire ──
  if (t.cta && t.cta.trim()) {
    const nb = motsDe(t.cta).length;
    const action = aUneAction(t.cta);
    const aff = duree(t.fenetres?.cta);
    const problemes: string[] = [];
    if (!action) problemes.push('Ton appel à l\'action ne dit pas quoi faire : c\'est un slogan, pas une action.');
    if (nb > R.ctaMotsMax) problemes.push(`Il fait ${nb} mots (8 au maximum).`);
    if (aff !== null && aff < R.ctaDureeMin) problemes.push(`Il ne reste que ${aff.toFixed(1).replace('.', ',')} s.`);
    if (problemes.length) {
      const proposition = action ? null : reecrireCta(t);
      // L'ancien CTA peut devenir la ligne secondaire… sauf s'il sert déjà d'accroche.
      const secondaire = !action && nb <= 6 && !(propositionAccroche && sansAccents(propositionAccroche.toLowerCase()).includes(sansAccents(t.cta.trim().toLowerCase())))
        ? casseDePhrase(t.cta) : null;
      out.push({
        id: 'texte:cta',
        section: 'CTA',
        priorite: !action ? 'IMPORTANTE' : 'MOYENNE',
        cible: 'cta',
        texteActuel: t.cta,
        probleme: problemes.join(' '),
        conseil: proposition
          ? `Remplace-le par une action : « ${proposition} »${secondaire ? `, avec « ${secondaire} » en petit en dessous` : ''}.`
          : 'Raccourcis-le à une seule action de 3 à 8 mots.',
        propositionReecrite: proposition,
        placementRecommande: null,
        dureeRecommandee: '2 à 3 secondes, à la fin',
        mesures: { mots: nb, verbeAction: action, affichageS: aff },
      });
    }
  }

  // ── RÉPÉTITIONS entre les textes (lexicales) ──
  const elements: Array<{ cible: string; texte: string }> = [
    { cible: 'accroche', texte: [t.titre, t.sousTitre].filter(Boolean).join(' ') },
    ...(t.cartes ?? []).map((c, i) => ({ cible: `carte:${i}`, texte: `${c.titre ?? ''}` })),
    { cible: 'cta', texte: t.cta ?? '' },
  ].filter((e) => e.texte.trim());
  const ou = new Map<string, Set<string>>();
  const forme = new Map<string, string>();
  for (const e of elements) {
    for (const m of motsDe(e.texte)) {
      const r = racine(m);
      if (!r) continue;
      if (!forme.has(r)) forme.set(r, m.toLowerCase());
      (ou.get(r) ?? ou.set(r, new Set()).get(r)!).add(e.cible);
    }
  }
  const themeRacines = new Set(motsDe(t.theme).map(racine).filter(Boolean) as string[]);
  const repetes = Array.from(ou.entries()).filter(([r, s]) => s.size >= 2 && !themeRacines.has(r));
  if (repetes.length) {
    const libelle = (c: string) => (c === 'accroche' ? 'l\'accroche' : c === 'cta' ? 'le CTA' : `la carte ${Number(c.split(':')[1]) + 1}`);
    out.push({
      id: 'texte:repetitions',
      section: 'Textes',
      priorite: repetes.some(([, s]) => s.has('accroche') && s.has('cta')) ? 'MOYENNE' : 'FAIBLE',
      cible: 'textes',
      texteActuel: null,
      probleme: repetes.map(([r, s]) => `« ${forme.get(r)} » revient dans ${Array.from(s).map(libelle).join(' et ')}`).join(' ; ') + '.',
      conseil: 'Chaque texte doit apporter une information nouvelle : évite de redire la même idée.',
      propositionReecrite: null,
      placementRecommande: null,
      dureeRecommandee: null,
      mesures: { repetitions: repetes.length },
    });
  }

  // ── COHÉRENCE AVEC LE THÈME (lexicale : le mot du thème est-il dit ?) ──
  if (themeRacines.size && accroche) {
    const dansAccroche = motsDe(accroche).some((m) => { const r = racine(m); return r !== null && themeRacines.has(r); });
    if (!dansAccroche) {
      out.push({
        id: 'texte:theme',
        section: 'Textes',
        priorite: 'MOYENNE',
        cible: 'accroche',
        texteActuel: accroche,
        probleme: `Ton accroche ne mentionne pas le thème (« ${t.theme} »).`,
        conseil: 'Dis tout de suite de quoi parle la vidéo : le mot du thème dans l\'accroche aide à retenir l\'attention.',
        propositionReecrite: null,
        placementRecommande: null,
        dureeRecommandee: null,
      });
    }
  }
  return out;
}

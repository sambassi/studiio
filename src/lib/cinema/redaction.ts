/**
 * CINEMA IA — AIDE A LA REDACTION : ce qu'on DEMANDE au modele, et ce qu'on verifie en retour.
 *
 * Module PUR : aucune requete, aucune cle, aucun credit. Il construit un prompt a partir du
 * contexte du film et relit la proposition. L'appel passe par le moteur de texte PARTAGE de
 * Studiio (`lib/ia/texte.ts`, celui de « Creer ») : aucun nouveau fournisseur.
 *
 * ⚠️ DEUX REGLES QUI DECIDENT SI LE TEXTE EST EXPLOITABLE PAR LE DECOUPAGE EXISTANT :
 *
 *   1. UNE PHRASE = UN PLAN (`scenario.phrases` coupe apres « . », « ! », « ? »). Il en faut
 *      donc au moins autant que de scenes demandees.
 *   2. UNE REPLIQUE S'ECRIT « ... » APRES LE NOM, SANS PONCTUATION FORTE A L'INTERIEUR : un
 *      point dans les guillemets scinde la phrase, et `scenario.citation` ne reconnait plus
 *      la replique (meme piege que les exemples de `ModelesFilm`).
 *
 * Le modele ne doit JAMAIS inventer de personnage : le casting est la source de verite, et
 * un nom absent du casting n'apparaitrait dans aucun plan (`scenario.personnagesCites`).
 */
import { citation, phrases, SCENES_MAX, SCENES_MIN } from '@/lib/cinema/scenario';
import { styleCinema } from '@/lib/cinema/direction/styles';
import type { IdStyleCinema } from '@/lib/cinema/types';

export type IdActionRedaction = 'rediger' | 'ameliorer' | 'developper' | 'dialogues' | 'structurer' | 'raccourcir';

export interface ActionRedaction {
  id: IdActionRedaction;
  libelle: string;
  /** Ce que l'action fait, en une ligne — affiche a cote du choix. */
  resume: string;
  /** Vrai quand l'action a besoin d'un texte deja saisi (sinon elle est proposee grisee). */
  exigeTexte: boolean;
  /** Consigne propre a l'action, ajoutee au contexte commun. */
  consigne: string;
}

export const ACTIONS_REDACTION: readonly ActionRedaction[] = [
  {
    id: 'rediger', libelle: 'Rédiger depuis une idée', resume: 'Une histoire complète à partir de quelques mots.', exigeTexte: false,
    consigne: 'Ecris une histoire COMPLETE a partir de l’idee ci-dessous. Si l’idee est vide, invente une histoire simple qui respecte le genre et les personnages donnes.',
  },
  {
    id: 'ameliorer', libelle: 'Améliorer le texte', resume: 'Même histoire, écriture plus nette et plus visuelle.', exigeTexte: true,
    consigne: 'AMELIORE le texte ci-dessous sans changer l’histoire : memes evenements, memes personnages, meme fin. Rends chaque phrase plus visuelle (lumiere, lieu, matiere, geste).',
  },
  {
    id: 'developper', libelle: 'Développer le scénario', resume: 'Plus de plans, mêmes personnages et même fin.', exigeTexte: true,
    consigne: 'DEVELOPPE le texte ci-dessous : ajoute des plans intermediaires (gestes, regards, details du decor) pour etoffer le recit. Garde le debut et la fin, n’ajoute aucun personnage.',
  },
  {
    id: 'dialogues', libelle: 'Proposer des dialogues', resume: 'Des répliques au format reconnu par le découpage.', exigeTexte: true,
    consigne: 'Ajoute 2 a 4 REPLIQUES au texte ci-dessous, reparties dans le recit, en gardant toutes les phrases existantes. Chaque replique s’ecrit exactement ainsi : Nom dit : « texte de la replique ».',
  },
  {
    id: 'structurer', libelle: 'Structurer en scènes', resume: 'Réorganise le récit pour le nombre de scènes voulu.', exigeTexte: true,
    consigne: 'REORGANISE le texte ci-dessous pour qu’il se decoupe proprement : une progression claire, et assez de phrases pour remplir chaque scene (exposition, incident, confrontation, resolution). Garde les memes evenements et les memes personnages.',
  },
  {
    id: 'raccourcir', libelle: 'Raccourcir', resume: 'Plus court et plus direct, sans perdre l’essentiel.', exigeTexte: true,
    consigne: 'RACCOURCIS le texte ci-dessous d’environ un tiers : garde l’essentiel du recit, les personnages et la fin, supprime les redites.',
  },
];

export const estActionRedaction = (v: unknown): v is IdActionRedaction =>
  typeof v === 'string' && ACTIONS_REDACTION.some((a) => a.id === v);

export const actionRedaction = (id: IdActionRedaction): ActionRedaction =>
  ACTIONS_REDACTION.find((a) => a.id === id)!;

export interface ContexteRedaction {
  /** Le texte deja saisi (peut etre vide pour « Rédiger depuis une idée »). */
  histoire: string;
  /** Le casting tel qu'il est a l'ecran : nom + apparence. Seule source de personnages. */
  personnages: ReadonlyArray<{ nom: string; role?: string; description?: string }>;
  /** Le style choisi, s'il y en a un : il donne le genre et l'ambiance. */
  styleCinema?: IdStyleCinema | null;
  nbScenes?: number;
  format?: string;
  titre?: string;
}

/** Bornes de securite : un prompt ne part jamais avec un roman ni un casting infini. */
export const HISTOIRE_MAX = 4_000;
export const PERSONNAGES_MAX = 8;

export function nettoyerContexte(c: ContexteRedaction): ContexteRedaction {
  const nb = Number(c.nbScenes);
  return {
    histoire: (c.histoire ?? '').slice(0, HISTOIRE_MAX),
    personnages: (c.personnages ?? [])
      .filter((p) => p && typeof p.nom === 'string' && p.nom.trim())
      .slice(0, PERSONNAGES_MAX)
      .map((p) => ({
        nom: p.nom.trim().slice(0, 40),
        role: (p.role ?? '').trim().slice(0, 60),
        description: (p.description ?? '').trim().slice(0, 200),
      })),
    styleCinema: c.styleCinema ?? null,
    nbScenes: Number.isFinite(nb) ? Math.min(SCENES_MAX, Math.max(SCENES_MIN, Math.round(nb))) : SCENES_MIN + 1,
    format: c.format === '9:16' ? '9:16' : '16:9',
    titre: (c.titre ?? '').trim().slice(0, 120),
  };
}

/** Le prompt envoye au moteur partage : contexte du film, regles de forme, puis l'action. */
export function promptRedaction(id: IdActionRedaction, contexte: ContexteRedaction): string {
  const c = nettoyerContexte(contexte);
  const action = actionRedaction(id);
  const style = styleCinema(c.styleCinema ?? null);
  const casting = c.personnages.length
    ? c.personnages.map((p) => `- ${p.nom}${p.role ? ` (${p.role})` : ''}${p.description ? ` : ${p.description}` : ''}`).join('\n')
    : '- aucun personnage defini : n’en nomme aucun, decris les actions sans prenom';

  return [
    'Tu es scenariste pour Studiio Cinema IA. Tu ecris en francais, a la troisieme personne, au present.',
    '',
    'CONTEXTE DU FILM',
    c.titre ? `Titre : ${c.titre}` : null,
    style ? `Genre et ambiance : ${style.libelle} — ${style.resume} (${style.detail.eclairage} ; ${style.detail.ambiance}).` : 'Genre : libre, reste sobre et realiste.',
    `Format : ${c.format}. Nombre de scenes voulu : ${c.nbScenes}.`,
    'Personnages (les SEULS autorises) :',
    casting,
    '',
    'REGLES DE FORME, IMPERATIVES',
    '1. Une phrase = un plan. Ecris des phrases courtes, chacune montrant UNE action visible.',
    `2. Donne au moins ${(c.nbScenes ?? SCENES_MIN) + 3} phrases, pour que les ${c.nbScenes} scenes soient remplies.`,
    '3. N’invente AUCUN personnage : n’utilise que les prenoms de la liste ci-dessus.',
    '4. Nomme la lumiere et le lieu (par exemple « a l’aube, dans la salle vide »).',
    '5. Une replique s’ecrit : Nom dit : « texte de la replique ». JAMAIS de point, de « ! » ou de « ? » a l’interieur des guillemets, et le point final se met APRES le guillemet fermant.',
    '6. Pas de titre de scene, pas de numero, pas de liste a puces, pas d’indication technique de camera : seulement le recit.',
    '',
    `ACTION DEMANDEE : ${action.libelle}`,
    action.consigne,
    '',
    c.histoire.trim() ? `TEXTE ACTUEL :\n${c.histoire.trim()}` : 'TEXTE ACTUEL : (vide)',
    '',
    'Reponds UNIQUEMENT en JSON, sans commentaire : {"text":"l’histoire complete ici"}',
  ].filter((l) => l !== null).join('\n');
}

/**
 * Mots courants qui commencent souvent une phrase : sans eux, « Le jour se leve » ferait
 * passer « Le » pour un personnage. Liste volontairement courte — elle ne sert qu'a eviter
 * les signalements evidents, jamais a decider ce qui entre dans le film.
 */
const MOTS_COURANTS = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'au', 'aux', 'dans', 'sur',
  'sous', 'il', 'elle', 'ils', 'elles', 'je', 'tu', 'on', 'nous', 'vous', 'que', 'qui',
  'pour', 'avec', 'sans', 'plus', 'mais', 'son', 'sa', 'ses', 'leur', 'leurs', 'ce', 'cet',
  'cette', 'ces', 'est', 'puis', 'quand', 'lorsque', 'alors', 'soudain', 'enfin', 'pendant',
  'apres', 'après', 'avant', 'devant', 'derriere', 'derrière', 'entre', 'chaque', 'aucun',
  'aucune', 'personne', 'rien', 'tout', 'toute', 'tous', 'toutes', 'deux', 'trois', 'quatre',
  'cinq', 'plusieurs', 'ici', 'la-bas', 'dehors', 'dedans', 'encore', 'jamais', 'toujours',
  'maintenant', 'ensuite', 'depuis', 'face', 'loin', 'pres', 'près',
]);

export interface DiagnosticProposition {
  plans: number;
  repliques: number;
  /** Prenoms cites qui ne sont PAS au casting : l'ecran le dit avant toute acceptation. */
  inconnus: string[];
  /** Repliques ecrites avec une ponctuation forte DANS les guillemets : elles seraient perdues. */
  repliquesCassees: number;
  /** Assez de phrases pour le nombre de scenes demande. */
  assezDePhrases: boolean;
}

/**
 * Ce que la proposition donnerait REELLEMENT, lu avec le decoupage du serveur.
 * L'ecran l'affiche avant d'appliquer quoi que ce soit : on n'accepte pas a l'aveugle.
 */
export function diagnostiquerProposition(texte: string, contexte: ContexteRedaction): DiagnosticProposition {
  const c = nettoyerContexte(contexte);
  const ps = phrases(texte);
  const connus = new Set(c.personnages.map((p) => p.nom.toLocaleLowerCase('fr')));
  // Un prenom suppose = un mot capitalise qui n'est pas un mot courant. Un nom propre ouvre
  // souvent la phrase (« Marco la regarde »), on ne peut donc pas ignorer le premier mot :
  // c'est la liste de mots courants qui ecarte « Le », « Elle », « Soudain »… Le signalement
  // est une MISE EN GARDE, pas un verdict : un faux positif se lit, il ne casse rien.
  const inconnus = new Set<string>();
  for (const p of ps) {
    const horsCitation = p.replace(/«[^»]*»/g, ' ');
    for (const mot of horsCitation.split(/\s+/).filter(Boolean)) {
      const nu = mot.replace(/[^\p{L}'’-]/gu, '');
      if (nu.length < 3) continue;
      if (!/^\p{Lu}/u.test(nu)) continue;
      const bas = nu.toLocaleLowerCase('fr');
      if (MOTS_COURANTS.has(bas) || connus.has(bas)) continue;
      inconnus.add(nu);
    }
  }
  const repliquesCassees = (texte.match(/«[^»]*[.!?][^»]*»/g) ?? []).length;
  return {
    plans: ps.length,
    repliques: ps.filter((p) => citation(p) !== null).length,
    inconnus: [...inconnus],
    repliquesCassees,
    assezDePhrases: ps.length >= (c.nbScenes ?? SCENES_MIN),
  };
}

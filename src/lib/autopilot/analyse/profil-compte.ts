/**
 * LOT 2B ETAPE 3 — « MON STYLE » : LE PROFIL CREATIF PAR DEFAUT DU COMPTE.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MIGRATION — ET CE N'EST PAS UNE ECONOMIE, C'EST LE PLAN D'ORIGINE
 * ---------------------------------------------------------------------------
 *
 * `autopilot_config.design_style` est un `jsonb` livre le 7 aout, et la
 * migration qui l'a cree dit pourquoi en toutes lettres : « une colonne par
 * propriete aurait impose une migration a chaque ajout — et une migration
 * oubliee se lit en production comme une fonctionnalite qui ne marche pas,
 * pas comme une erreur ».
 *
 * `montage` puis `audio` s'y sont ranges. `profilCreatif` y a sa place depuis
 * le Lot 2B etape 1 (`AutopilotDesignStyle.profilCreatif`), valide par
 * `sanitizeDesignStyle`. Ce module ne fait que lire et ecrire ce champ — il
 * n'invente ni table, ni colonne, ni schema.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE `userId` VIENT DE LA SESSION, JAMAIS DU CORPS
 * ---------------------------------------------------------------------------
 *
 * Les deux fonctions prennent un `userId` et filtrent dessus. Elles sont
 * ecrites pour n'etre appelees qu'avec l'identifiant tire de `auth()` cote
 * serveur : aucune route ne doit lui passer une valeur venue du client. C'est
 * la meme regle que `user_id` dans `CHAMPS_INTERDITS_RENDU`.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ L'ECRITURE EST UNE FUSION, ET ELLE EST ATOMIQUE
 * ---------------------------------------------------------------------------
 *
 * `design_style` porte AUSSI le format de montage, la recette audio, les
 * polices, les icones et le style de cartes. Ecrire `{ profilCreatif }` seul
 * effacerait tout le reste ; le relire puis le reecrire en entier ouvre une
 * fenetre ou l'ecriture d'un voisin se perd.
 *
 * `fusionnerDesignStyle` appelle donc une fonction SQL qui fait
 * `design_style || patch` en UNE instruction. Tant que la migration du
 * 2026-09-06 n'est pas appliquee, elle retombe sur un lire-modifier-ecrire :
 * les cles voisines sont conservees, seule l'atomicite manque — et la
 * fonction est reprise d'elle-meme des qu'elle apparait.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  normaliserProfilCreatif, type ProfilCreatifAutopilote,
} from './profil-creatif';
import {
  sanitizeDesignStyle, type AutopilotDesignStyle,
} from '@/lib/autopilot/textStyle';

/** Le nom de la table, ecrit une fois. */
const TABLE = 'autopilot_config';

/**
 * La colonne `design_style` est-elle la ?
 *
 * ⚠️ MEMOISE, ET RESONDEE SEULEMENT APRES EXPIRATION. Le meme dispositif que
 * `colonneReady` de la route de configuration, pour la meme raison : entre
 * deux deploiements, la colonne peut manquer. Sans cette sonde, la lecture du
 * profil ferait echouer un rendu pour une colonne que l'utilisateur n'a
 * peut-etre jamais touchee. Tant qu'elle manque, « Mon style » n'existe pas —
 * donc les valeurs generiques, donc le rendu historique.
 */
const TTL_SONDE_MS = 60_000;
let sonde: { prete: boolean; a: number } | null = null;

export async function styleDuCompteDisponible(): Promise<boolean> {
  const maintenant = Date.now();
  if (sonde?.prete) return true;
  if (sonde && maintenant - sonde.a < TTL_SONDE_MS) return false;
  let prete = false;
  try {
    const { error } = await supabaseAdmin.from(TABLE).select('design_style').limit(1);
    prete = !error;
    if (error) {
      console.error(
        `[Autopilote] Colonne design_style absente (${error.message}) — « Mon style » `
        + 'INDISPONIBLE. Appliquer migrations/2026-08-07-autopilot-text-style.sql '
        + 'puis `docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Autopilote] Sonde de design_style impossible :', err);
  }
  sonde = { prete, a: maintenant };
  return prete;
}

/** Remet les sondes a zero. Reserve aux tests. */
export function reinitialiserSondeStyle(): void {
  sonde = null;
  fusionAbsente = null;
}

/**
 * Les cles de `design_style` que l'ECRAN DE CONFIGURATION ne possede pas.
 *
 * ⚠️ C'EST LA REGLE QUI EMPECHE LA MISE A JOUR PERDUE. `PUT
 * /api/autopilot/config` envoie le document entier tel que l'ecran le connait
 * — c'est-a-dire tel qu'il etait a son CHARGEMENT. Le laisser ecrire ces deux
 * cles, c'est laisser un ecran perime effacer un style enregistre entre temps,
 * sans erreur ni message.
 *
 * Chaque ecrivain n'ecrit que ses propres cles : c'est ce qui rend deux
 * enregistrements simultanes inoffensifs l'un pour l'autre.
 */
export const CLES_DESIGN_STYLE_HORS_CONFIG = [
  'profilCreatif', 'objectifParDefaut',
] as const;

/**
 * Les cles que l'ecran de configuration POSSEDE, et qu'il est donc seul a
 * ecrire.
 *
 * ⚠️ EXPLICITE, ET SURVEILLEE PAR UN TEST. Une cle ajoutee a
 * `AutopilotDesignStyle` et oubliee ici deviendrait ineditable depuis l'ecran
 * — un reglage qui s'affiche, se modifie, et ne s'enregistre jamais. Le test
 * compare cette liste a ce que `sanitizeDesignStyle` sait reellement produire.
 */
export const CLES_DESIGN_STYLE_CONFIG = [
  'montage', 'audio', 'title', 'subtitle', 'cta', 'cards', 'cardIcons', 'cardStyle',
] as const;

/**
 * Le patch que l'ecran de configuration a le droit d'appliquer.
 *
 * ⚠️ CHAQUE CLE POSSEDEE EST PRESENTE, MEME ABSENTE DU STYLE — a `null`.
 * Une fusion `||` ne retire jamais une cle : sans ce `null` explicite, un
 * reglage EFFACE par l'utilisateur resterait en base et reviendrait au
 * chargement suivant. `null` traverse la fusion, puis `sanitizeDesignStyle` le
 * lit comme une absence a la relecture — c'est ce qui rend l'effacement
 * possible sans reecrire le document entier.
 *
 * Et les cles qui ne lui appartiennent pas — `profilCreatif`,
 * `objectifParDefaut` — n'y figurent tout simplement pas : un ecran perime ne
 * peut donc plus effacer un style enregistre entre temps.
 */
export function patchDesignStyleConfig(
  style: AutopilotDesignStyle | null | undefined,
): Record<string, unknown> {
  const source = (style ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const cle of CLES_DESIGN_STYLE_CONFIG) {
    patch[cle] = source[cle] ?? null;
  }
  return patch;
}

/**
 * La fonction SQL de fusion a-t-elle deja repondu « je n'existe pas » ?
 *
 * ⚠️ PAS DE SONDE PREALABLE, ET C'EST DELIBERE. Une premiere redaction
 * appelait la fonction avec un UUID bidon pour savoir si elle existe. Elle
 * aurait TOUJOURS conclu « indisponible » : `autopilot_config.user_id`
 * reference `users(id)`, donc un UUID qui ne designe aucun compte fait echouer
 * l'insertion — une erreur, mais pas celle qu'on cherchait. La sonde aurait
 * desactive pour de bon une fonction parfaitement deployee.
 *
 * On tente donc la VRAIE ecriture, et on ne retient l'absence que sur le
 * message qui la designe. Rien n'est ecrit pour savoir si on peut ecrire.
 */
let fusionAbsente: { a: number } | null = null;

/** PostgREST quand la fonction n'est pas dans son cache de schema. */
function ressembleAFonctionAbsente(message: string): boolean {
  return /could not find the function|does not exist|PGRST202|schema cache/i.test(message);
}

/**
 * Applique un patch a `design_style`, cle par cle, sans toucher aux voisines.
 *
 * ⚠️ C'EST LE SEUL CHEMIN D'ECRITURE DE CETTE COLONNE. Les deux routes qui
 * l'ecrivent passent par ici : c'est ce qui garantit qu'elles ne peuvent pas
 * diverger sur la facon de fusionner.
 */
export async function fusionnerDesignStyle(
  userId: string, patch: AutopilotDesignStyle,
): Promise<boolean> {
  if (!userId) return false;

  const recemmentAbsente = fusionAbsente !== null
    && Date.now() - fusionAbsente.a < TTL_SONDE_MS;

  if (!recemmentAbsente) {
    try {
      const { error } = await supabaseAdmin.rpc('autopilot_design_style_merge', {
        p_user_id: userId, p_patch: patch,
      });
      if (!error) {
        // La fonction repond : on oublie une eventuelle absence passee.
        fusionAbsente = null;
        return true;
      }
      if (!ressembleAFonctionAbsente(error.message)) {
        // La fonction existe et a REFUSE. Reessayer par un chemin moins sur
        // transformerait un refus en ecriture.
        console.error('[Autopilote] Fusion de design_style :', error.message);
        return false;
      }
      console.error(
        `[Autopilote] Fusion atomique indisponible (${error.message}) — repli sur `
        + 'lire-modifier-ecrire. Appliquer '
        + 'migrations/2026-09-06-autopilot-design-style-merge.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
      fusionAbsente = { a: Date.now() };
    } catch (err) {
      console.error(
        '[Autopilote] Fusion de design_style impossible :',
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  // ── Repli : lire-modifier-ecrire ──────────────────────────────────────
  // Moins sur — une ecriture voisine glissee entre la lecture et l'ecriture
  // se perd — mais il conserve les cles voisines, ce qui est deja l'essentiel.
  const existant = await lireStyleDuCompte(userId);
  const fusionne = sanitizeDesignStyle({ ...existant, ...patch });
  try {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        { user_id: userId, design_style: fusionne, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) {
      console.error('[Autopilote] Ecriture de design_style :', error.message);
      return false;
    }
  } catch (err) {
    console.error(
      '[Autopilote] Ecriture de design_style impossible :',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
  return true;
}

/**
 * Applique un patch a `design_style`, MAIS SEULEMENT DE FACON ATOMIQUE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUN REPLI, ET C'EST TOUT L'INTERET DE CETTE SECONDE PORTE
 * ---------------------------------------------------------------------------
 *
 * `fusionnerDesignStyle` retombe sur un lire-modifier-ecrire quand la
 * fonction SQL manque : les cles voisines survivent, mais une ecriture
 * glissee entre la lecture et l'ecriture se perd. C'etait le bon compromis
 * pour « Mon style », ou l'ecrivain est un humain qui clique.
 *
 * L'objectif, lui, s'ecrit pendant qu'une video se cree : une fusion de
 * profil creatif, une recette audio ou un format de montage peuvent tomber
 * au meme instant. Perdre l'un d'eux pour enregistrer un objectif serait un
 * echange que personne n'a demande — et personne ne le verrait.
 *
 * On prefere donc REFUSER en le disant. La migration
 * `2026-09-06-autopilot-design-style-merge.sql` rend cette porte ouverte ;
 * tant qu'elle n'est pas appliquee, « Mon objectif » repond « pas encore
 * disponible » plutot que d'ecrire a l'aveugle.
 */
export type FusionStricte = 'ok' | 'non_atomique' | 'echec';

export async function fusionnerDesignStyleStrict(
  userId: string, patch: AutopilotDesignStyle,
): Promise<FusionStricte> {
  if (!userId) return 'echec';
  try {
    const { error } = await supabaseAdmin.rpc('autopilot_design_style_merge', {
      p_user_id: userId, p_patch: patch,
    });
    if (!error) return 'ok';
    if (ressembleAFonctionAbsente(error.message)) {
      console.error(
        `[Autopilote] Fusion atomique indisponible (${error.message}) — « Mon objectif » `
        + 'REFUSE d\'ecrire plutot que de risquer une mise a jour perdue. Appliquer '
        + 'migrations/2026-09-06-autopilot-design-style-merge.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
      return 'non_atomique';
    }
    console.error('[Autopilote] Fusion stricte de design_style :', error.message);
    return 'echec';
  } catch (err) {
    console.error(
      '[Autopilote] Fusion stricte impossible :',
      err instanceof Error ? err.message : err,
    );
    return 'echec';
  }
}

/**
 * Le `design_style` complet du compte, deja assaini.
 *
 * Rend `{}` quand la ligne n'existe pas, quand la colonne manque, ou quand la
 * base est injoignable. AUCUNE de ces trois situations n'est une erreur pour
 * l'appelant : elles veulent toutes dire « ce compte n'a pas de style », et la
 * suite est la meme — les valeurs generiques.
 */
export async function lireStyleDuCompte(userId: string): Promise<AutopilotDesignStyle> {
  if (!userId) return {};
  if (!(await styleDuCompteDisponible())) return {};
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('design_style')
      // ⚠️ LE FILTRE EST LA GARDE. `supabaseAdmin` contourne RLS : sans ce
      // `eq`, la requete rendrait la premiere ligne venue, c'est-a-dire le
      // style d'un inconnu.
      .eq('user_id', userId)
      .limit(1);
    if (error) return {};
    const ligne = (data?.[0] as Record<string, unknown> | undefined) ?? undefined;
    return sanitizeDesignStyle(ligne?.design_style);
  } catch (err) {
    console.error(
      '[Autopilote] Lecture du style du compte impossible :',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

/**
 * Le profil creatif par defaut du compte, ou `null`.
 *
 * ⚠️ `null` ET NON `PROFIL_CREATIF_DEFAUT`. La difference porte tout le
 * comportement historique : `methodeRendu(recette, null)` rend la methode
 * d'avant ce lot, donc les rendus deja reussis d'un compte qui n'a jamais
 * configure son style restent servis. Rendre le profil par defaut ici ferait
 * la meme chose PAR HASARD — `estProfilHistorique` est vrai pour lui — mais
 * cesserait de la faire au premier defaut produit qu'on changerait.
 */
export async function lireProfilCreatifUtilisateur(
  userId: string,
): Promise<ProfilCreatifAutopilote | null> {
  const style = await lireStyleDuCompte(userId);
  return style.profilCreatif ?? null;
}

export type EcritureProfil =
  | { ok: true; profil: ProfilCreatifAutopilote }
  | { ok: false; motif: 'store_indisponible' | 'ecriture_impossible' };

/**
 * Enregistre « Mon style ».
 *
 * ⚠️ APPELEE PAR UNE ACTION EXPLICITE, ET PAR ELLE SEULE. Aucun rendu, aucun
 * override de video, aucun passage de l'Autopilote n'appelle cette fonction.
 * Un style essaye sur une seule video ne doit pas redefinir l'identite
 * visuelle du compte a l'insu de son proprietaire — c'est la regle du cahier
 * des charges, et c'est ici qu'elle se tient.
 */
export async function enregistrerProfilCreatifUtilisateur(
  userId: string, profil: unknown,
): Promise<EcritureProfil> {
  if (!userId) return { ok: false, motif: 'ecriture_impossible' };
  if (!(await styleDuCompteDisponible())) return { ok: false, motif: 'store_indisponible' };

  // ⚠️ NORMALISE AVANT D'ECRIRE. La base ne doit jamais porter une valeur que
  // le contrat refuserait a la relecture : `sanitizeDesignStyle` la jetterait
  // en bloc, et l'utilisateur verrait son style disparaitre sans un mot.
  const normalise = normaliserProfilCreatif(profil as never);

  // ⚠️ UNE SEULE CLE DANS LE PATCH. Les freres de `profilCreatif` — montage,
  // audio, polices, icones — ne sont ni relus ni reecrits : ils ne peuvent
  // donc pas etre perdus, meme si quelqu'un les enregistre au meme instant.
  const ok = await fusionnerDesignStyle(userId, { profilCreatif: normalise });
  if (!ok) return { ok: false, motif: 'ecriture_impossible' };
  return { ok: true, profil: normalise };
}

export const MESSAGES_PROFIL_COMPTE: Record<
  'store_indisponible' | 'ecriture_impossible', string
> = {
  store_indisponible:
    'Ton style ne peut pas encore être enregistré : la mise à jour du serveur n’est pas terminée.',
  ecriture_impossible: 'Ton style n’a pas pu être enregistré. Réessaie.',
};

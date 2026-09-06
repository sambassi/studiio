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
 * ⚠️ L'ECRITURE EST UN LIRE-MODIFIER-ECRIRE, ET C'EST OBLIGATOIRE
 * ---------------------------------------------------------------------------
 *
 * `design_style` porte AUSSI le format de montage, la recette audio, les
 * polices, les icones et le style de cartes. Ecrire `{ profilCreatif }` seul
 * effacerait tout le reste — et personne ne s'en apercevrait avant la video
 * suivante. On relit donc la ligne, on remplace le seul champ concerne, et on
 * repasse le tout par `sanitizeDesignStyle`.
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

/** Remet la sonde a zero. Reserve aux tests. */
export function reinitialiserSondeStyle(): void {
  sonde = null;
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

  // Lire-modifier-ecrire : voir l'en-tete. Les freres de `profilCreatif`
  // — montage, audio, polices, icones — doivent survivre a cet appel.
  const existant = await lireStyleDuCompte(userId);
  const fusionne = sanitizeDesignStyle({ ...existant, profilCreatif: normalise });

  try {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          design_style: fusionne,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      console.error('[Autopilote] Ecriture de « Mon style » :', error.message);
      return { ok: false, motif: 'ecriture_impossible' };
    }
  } catch (err) {
    console.error(
      '[Autopilote] Ecriture de « Mon style » impossible :',
      err instanceof Error ? err.message : err,
    );
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, profil: normalise };
}

export const MESSAGES_PROFIL_COMPTE: Record<
  'store_indisponible' | 'ecriture_impossible', string
> = {
  store_indisponible:
    'Ton style ne peut pas encore être enregistré : la mise à jour du serveur n’est pas terminée.',
  ecriture_impossible: 'Ton style n’a pas pu être enregistré. Réessaie.',
};

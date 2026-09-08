/**
 * A_4b — LA MATIÈRE DES SOUS-TITRES : LA PAROLE ET L'ORIGINE DES CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE RETRANSCRIT JAMAIS AU MOMENT DU RENDU
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La transcription existe déjà : M3-D l'a produite avant que les clips ne
 * soient découpés, et c'est elle qui a servi à décider où couper. La rappeler
 * ici coûterait un appel au fournisseur par rendu, pour un texte identique —
 * et rendrait un montage rejoué non déterministe.
 *
 * ⚠️ ET C'EST LA TRANSCRIPTION DU JEU DE CLIPS, pas la dernière en date. Un
 * jeu de clips porte `transcriptionId` : c'est CELLE-LÀ qui a servi à décider
 * des bornes. En prendre une plus récente daterait les mots autrement que les
 * coupes, et les sous-titres dériveraient.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN SEUL PRÉPARATEUR POUR LES DEUX CHEMINS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le montage manuel et l'Autopilote automatique appellent la même fonction.
 * Deux préparations divergeraient : l'une afficherait des sous-titres que
 * l'autre ne montre pas, sur le même profil.
 */
import { lireSetParId } from './clip-service';
import {
  lireTranscriptionParId, lireDerniereTranscriptionReussie,
} from './transcription-service';
import type { MontagePlan } from './montage-contrat';
import type { MotSource, ClipProjection } from './captions-timeline';

export interface MatiereCaptions {
  mots: readonly MotSource[];
  clips: readonly ClipProjection[];
  /**
   * A_7d — LA PAROLE DE CHAQUE SOURCE, indexee par son jeu de clips.
   *
   * ⚠️ ABSENTE POUR UN MONTAGE MONO-RUSH, et c'est ce qui laisse le chemin
   * historique intact : `mots` reste la seule matiere, et le repere de chaque
   * plan se lit sur `clips`, exactement comme avant.
   */
  motsParSource?: ReadonlyMap<string, readonly MotSource[]>;
  /** Les sources dont la transcription n'a pas pu etre resolue. */
  sourcesSansTranscription?: readonly string[];
}

/**
 * La parole du rush et l'origine de chaque clip, ou `null`.
 *
 * `null` n'est PAS une erreur : c'est « ce montage n'a pas de parole
 * exploitable ». Le moteur trace alors `usage.captionsNonRendues` et rend le
 * montage sans sous-titres, plutôt que d'échouer sur une vidéo par ailleurs
 * valide.
 */
export async function preparerCaptions(
  userId: string, plan: MontagePlan,
): Promise<MatiereCaptions | null> {
  try {
    const { set } = await lireSetParId(userId, plan.clipSetId);
    if (!set || set.clips.length === 0) return null;

    /* La transcription DU JEU DE CLIPS d'abord ; la dernière réussie du rush
       seulement si le jeu n'en nomme aucune — un jeu ancien, produit avant que
       le lien ne soit écrit. */
    const parId = set.transcriptionId
      ? (await lireTranscriptionParId(userId, set.transcriptionId)).transcription
      : null;
    const t = parId?.etat === 'reussie'
      ? parId
      : (await lireDerniereTranscriptionReussie(userId, set.rushId)).transcription;

    if (!t || !t.presente) return null;
    const mots = t.mots ?? [];
    // ⚠️ SANS MOTS HORODATÉS, PAS DE SOUS-TITRES. Répartir un segment
    // uniformément donnerait un minutage inventé — et un karaoké qui ment.
    if (mots.length === 0) return null;

    return {
      mots,
      clips: set.clips.map((c) => ({ rang: c.rang, debutSecondes: c.debutSecondes })),
    };
  } catch {
    /* Le socle peut manquer, la ligne peut avoir disparu. Aucun de ces cas
       n'est une raison de perdre un montage : on rend sans sous-titres, et le
       moteur le trace. Le message n'est PAS repris — il porterait un détail
       de base. */
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// A_7d — LA PAROLE D'UN MONTAGE MULTI-RUSH
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resout la transcription D'UN jeu de clips — la sienne, jamais une autre.
 *
 * ⚠️ C'EST LA MEME REGLE QUE `preparerCaptions`, ET ELLE COMPTE DOUBLE ICI.
 * Un jeu de clips porte `transcriptionId` : c'est CELLE-LA qui a servi a
 * decider des bornes. En prendre une plus recente daterait les mots autrement
 * que les coupes.
 *
 * ⚠️ ET LA LIGNEE PASSE PAR LE JEU, PAS PAR LE RUSH. Un rush peut porter
 * plusieurs analyses successives ; le plan, lui, reference un jeu de clips
 * precis, ne dans une analyse precise. Prendre « la derniere transcription du
 * rush » servirait le texte d'une analyse qui n'a jamais decoupe ces clips-la.
 * Le repli sur la derniere reussie n'existe que pour les jeux ANCIENS, ecrits
 * avant que le lien ne soit pose — et il est signale.
 */
async function motsDuJeu(
  userId: string, clipSetId: string,
): Promise<readonly MotSource[] | null> {
  const { set } = await lireSetParId(userId, clipSetId);
  if (!set) return null;

  const parId = set.transcriptionId
    ? (await lireTranscriptionParId(userId, set.transcriptionId)).transcription
    : null;
  const t = parId?.etat === 'reussie'
    ? parId
    : (await lireDerniereTranscriptionReussie(userId, set.rushId)).transcription;

  if (!t || !t.presente) return null;
  const mots = t.mots ?? [];
  // Sans mots horodates, pas de sous-titres : repartir un segment uniformement
  // donnerait un minutage invente, et un karaoke qui ment.
  return mots.length === 0 ? null : mots;
}

/**
 * LA PAROLE D'UN MONTAGE, MONO OU MULTI-RUSH — A_7d.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE PREPARATEUR FERME
 * ═════════════════════════════════════════════════════════════════════════
 *
 * A_7c a appris au projecteur a lire une transcription PAR SOURCE ; personne
 * ne la lui fournissait. Un plan multi-rush n'a pas de `clipSetId` scalaire —
 * A_7M l'a laisse NUL, parce qu'une colonne d'identite ne peut pas parler au
 * nom de plusieurs sources — si bien que `preparerCaptions` rendait `null` et
 * que le montage sortait SANS sous-titres. Le repli etait sur, il etait
 * incomplet.
 *
 * ⚠️ LES SOURCES SONT LUES SUR LES SEGMENTS, PAS SUR LA TABLE. `plan_sources`
 * dit la matiere DECLAREE ; les segments disent ce qui est REELLEMENT montre.
 * Six rushes ont pu etre candidats pour trois retenus — charger les six
 * couterait trois lectures de transcription pour du texte que personne ne
 * verra.
 *
 * ⚠️ UNE SOURCE SANS TRANSCRIPTION N'EMPRUNTE RIEN A SES VOISINES. Elle est
 * simplement absente de la carte, et `projeterMots` n'affiche alors rien pour
 * ses segments. Se rabattre sur les mots d'un autre rush produirait un
 * sous-titre bien cale, parfaitement lisible, disant autre chose que ce qu'on
 * entend — le seul defaut de ce lot qui ne se voie qu'apres publication.
 *
 * ⚠️ MONO-RUSH : LE CHEMIN HISTORIQUE, INTACT. Aucun segment ne portant de
 * provenance, la fonction delegue a `preparerCaptions` sans rien changer.
 */
export async function preparerCaptionsMultiSource(
  userId: string, plan: MontagePlan,
): Promise<MatiereCaptions | null> {
  const utilisees: string[] = [];
  for (const p of plan.plans) {
    const cle = p.source?.clipSetId;
    if (cle && !utilisees.includes(cle)) utilisees.push(cle);
  }

  // Aucun segment ne declare sa provenance : c'est un plan d'avant A_7a.
  if (utilisees.length === 0) return preparerCaptions(userId, plan);

  try {
    const motsParSource = new Map<string, readonly MotSource[]>();
    const manquantes: string[] = [];
    for (const clipSetId of utilisees) {
      const mots = await motsDuJeu(userId, clipSetId);
      if (mots === null) manquantes.push(clipSetId);
      else motsParSource.set(clipSetId, mots);
    }

    // Aucune source ne parle : le montage sort sans sous-titres, comme un
    // montage muet l'a toujours fait.
    if (motsParSource.size === 0) return null;

    return {
      /* ⚠️ `mots` ET `clips` RESTENT VIDES, ET C'EST VOULU. Tous les segments
         portent leur provenance : leur laisser une matiere de repli ouvrirait
         un chemin par lequel un segment pourrait, un jour, lire les mots d'un
         autre rush. */
      mots: [],
      clips: [],
      motsParSource,
      sourcesSansTranscription: manquantes,
    };
  } catch {
    /* Le socle peut manquer, une ligne peut avoir disparu. Aucun de ces cas
       n'est une raison de perdre un montage : on rend sans sous-titres. */
    return null;
  }
}

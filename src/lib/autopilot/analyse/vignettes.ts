/**
 * Les vignettes d'une analyse, rendues AFFICHABLES sans jamais devenir
 * publiques.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME, EN UNE PHRASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'extraction écrit les vignettes dans MinIO et n'en garde que des CLÉS
 * (`contrat.ts` : « une CLÉ d'objet, jamais une URL »). Un écran, lui, a
 * besoin de quelque chose qu'une balise `<img>` sait charger. Il faut donc
 * un chemin d'accès — et c'est là que tout se joue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QU'IL NE FAUT SURTOUT PAS FAIRE : `/storage/v1/object/public/…`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cette route existe, elle sert déjà des médias, et elle serait la solution
 * la plus courte. Elle n'a AUCUNE authentification et AUCUNE liste blanche
 * de compartiment ; la clé d'une vignette est de surcroît DÉTERMINISTE —
 * `<userId>/analyse/<analysisId>/vignette-NN.jpg`, deux identifiants que le
 * navigateur possède déjà. Quiconque les a lit les vignettes de leur
 * propriétaire. C'est un risque PRÉEXISTANT, hors du périmètre de ce lot :
 * on ne le corrige pas ici — mais on ne s'en sert pas, et surtout on ne lui
 * envoie pas un nouveau flux de contenus privés. C'est aussi la raison pour
 * laquelle rien de ce module ne rend jamais ni clé, ni compartiment : ne pas
 * aggraver ce qui est déjà ouvert.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN FLUX APPLICATIF, ET NON UNE URL PRÉ-SIGNÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La première rédaction de ce lot signait une URL de cinq minutes. Trois
 * faits, qui s'additionnent, l'ont fait abandonner :
 *
 * 1. IL N'EXISTE AUCUN SIGNEUR DE LECTURE UTILISABLE PAR UN NAVIGATEUR.
 *    `signeurInterne()` signe sur `MINIO_ENDPOINT` — `studiio-minio:9000` —
 *    injouable dehors, et dont la seule restitution divulguerait la
 *    topologie interne. `signeurPublic()` n'expose que `presignedPutObject`,
 *    et rend `null` tant que `MINIO_PUBLIC_ENDPOINT` n'est pas configuré :
 *    personne n'a pu vérifier qu'il l'est en production. Livrer un écran qui
 *    dépend de cette variable, c'est livrer un écran peut-être vide.
 * 2. UNE URL SIGNÉE FUIT PAR TROIS CHEMINS QU'ON NE CONTRÔLE PAS : la
 *    signature vit dans la chaîne de requête, donc dans les journaux du
 *    reverse-proxy ; un `<img src>` vers une autre origine émet un
 *    `Referer` ; et le chemin `/storage` pose `Cache-Control: public`.
 * 3. UNE URL SIGNÉE PORTE SA PROPRE AUTORISATION. Recopiée, elle vaut accès
 *    pour toute sa durée de vie, sans session et sans traçabilité.
 *
 * Le flux applicatif n'a aucun de ces défauts : l'autorisation est la
 * session, elle est revérifiée à chaque octet servi, et rien ne subsiste
 * après la réponse. Il coûte une traversée du processus Node par vignette —
 * quelques dizaines de kilo-octets, une poignée de fois par analyse. C'est le
 * bon prix.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'INVARIANT : IL N'EXISTE AUCUNE PORTE PAR OÙ UNE CLÉ POURRAIT ENTRER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `resoudreVignette` ne prend PAS de clé. Elle prend un identifiant
 * d'analyse et un ENTIER. La clé est LUE dans la ligne `rush_analyses`
 * relue sous `.eq('user_id', …)`, à la position demandée. Il n'y a donc rien
 * à valider contre une clé arbitraire : elle n'existe pas. Ce n'est pas une
 * vérification qu'on pourrait oublier, c'est une absence de porte.
 *
 * Les quatre gardes de `vignetteLisible` sont la DEUXIÈME ligne, celle qui
 * tient si la ligne en base est corrompue ou si une migration future y écrit
 * autre chose : compartiment dans la liste blanche, préfixe du propriétaire,
 * pas de `..`, pas de `://`.
 *
 * ⚠️ Le préfixe utilisateur n'est vérifié NULLE PART ailleurs pour les
 * vignettes : `vignettesValides` (contrat) n'a pas accès à `userId`, et une
 * clé `B/analyse/…` la traverse intacte. C'est la garde propre à ce lot.
 *
 * ⚠️ `verifierObjet` n'est PAS réutilisable ici, malgré l'apparence : son
 * `TYPES_AUTORISES` est vidéo seulement et son plancher est à 8 Ko. Une
 * vignette JPEG de 30 Ko serait refusée par les deux. Seule sa RÈGLE de
 * préfixe est reprise — c'est elle qui vaut, pas son implémentation.
 */
import { bucketAutorise } from '@/lib/storage/buckets';
import { lecteurMinio, type BorneReseau } from '@/lib/storage/minio-client';
import { lireAnalyse } from './service';
import type { VignetteAnalyse } from './contrat';

/**
 * Délai maximal d'une lecture de vignette.
 *
 * Une vignette pèse quelques dizaines de kilo-octets : quinze secondes sont
 * déjà très larges. La borne existe pour la même raison qu'ailleurs — un
 * MinIO qui accepte la connexion puis ne répond jamais ferait pendre la
 * requête, et huit vignettes pendues immobilisent un onglet.
 */
export const BORNE_LECTURE_VIGNETTE: BorneReseau = { timeoutMs: 15_000 };

/**
 * Le type servi, DÉCIDÉ ICI et non lu sur l'objet.
 *
 * L'extraction écrit du `image/jpeg` et rien d'autre. Faire confiance aux
 * métadonnées de l'objet permettrait à un fichier déposé par un autre chemin
 * d'être servi depuis NOTRE origine avec le type qu'il aurait choisi — du
 * HTML, par exemple. La route ajoute `nosniff` pour la même raison.
 */
export const TYPE_VIGNETTE = 'image/jpeg';

export type MotifVignette =
  /** L'analyse n'existe pas, ou n'appartient pas à l'appelant. */
  | 'analyse_introuvable'
  /** L'index demandé n'est pas un entier, ou tombe hors de la liste. */
  | 'vignette_introuvable'
  /** La clé stockée ne passe pas les gardes. Anomalie de données. */
  | 'vignette_hors_perimetre'
  /** Le socle n'est pas là. */
  | 'socle_absent';

export interface ResolutionVignette {
  vignette: VignetteAnalyse | null;
  analyseId: string | null;
  motif: MotifVignette | null;
}

/**
 * Une clé stockée mérite-t-elle qu'on aille lire l'objet ?
 *
 * Trois de ces quatre gardes sont déjà tenues par `vignettesValides`, qui
 * filtre à l'écriture ET à la lecture. Les répéter n'est pas de la
 * superstition : ce module ouvre un objet du stockage, et il ne doit pas
 * dépendre du fait qu'un autre fichier ait bien fait son travail.
 */
export function vignetteLisible(userId: string, v: VignetteAnalyse): boolean {
  // Le compartiment passe par la MÊME liste blanche que les deux chemins
  // d'envoi, la route d'indexation et le contrat d'analyse. Un nom vide, un
  // nom inconnu et `..` sont écartés du même coup : aucun n'est dans la liste.
  if (!bucketAutorise(v.bucket)) return false;
  if (typeof v.cle !== 'string' || !v.cle.trim()) return false;
  // Une URL n'est pas une clé.
  if (v.cle.includes('://')) return false;
  // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
  if (v.cle.includes('..')) return false;
  // Le préfixe EST la preuve de propriété. Même règle que `verifier-objet.ts`.
  if (!v.cle.startsWith(`${userId}/`)) return false;
  return true;
}

/** Un index acceptable : un entier, écrit en base dix, et rien d'autre. */
export function indexVignetteValide(brut: string): number | null {
  if (!/^\d{1,4}$/.test(brut)) return null;
  const n = Number(brut);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * De `(userId, analyseId, index)` à la clé — et jamais dans l'autre sens.
 *
 * `userId` vient de `auth()`. `analyseId` et `index` viennent du chemin, et
 * ce sont les SEULES choses que le navigateur fournit : ni compartiment, ni
 * clé, ni chemin. `lireAnalyse` filtre déjà sur `user_id` — une analyse
 * d'autrui est INTROUVABLE, jamais « interdite », parce qu'un 403
 * confirmerait son existence.
 */
export async function resoudreVignette(
  userId: string, analyseId: string, index: number,
): Promise<ResolutionVignette> {
  const vide: ResolutionVignette = { vignette: null, analyseId: null, motif: null };

  const { analyse, motif } = await lireAnalyse(userId, analyseId);
  if (motif === 'socle_absent') return { ...vide, motif: 'socle_absent' };
  if (!analyse) return { ...vide, motif: 'analyse_introuvable' };

  // Garde redondante avec le `.eq('user_id', …)` de `lireAnalyse`, et c'est
  // voulu : c'est le dernier point avant l'ouverture d'un objet du stockage.
  if (analyse.userId !== userId) return { ...vide, motif: 'analyse_introuvable' };

  const vignette = analyse.vignettes[index];
  if (!vignette) return { ...vide, analyseId: analyse.id, motif: 'vignette_introuvable' };

  if (!vignetteLisible(userId, vignette)) {
    return { ...vide, analyseId: analyse.id, motif: 'vignette_hors_perimetre' };
  }

  return { vignette, analyseId: analyse.id, motif: null };
}

/**
 * Ouvre l'objet et rend son flux. Rien n'est mis en mémoire.
 *
 * Ni `arrayBuffer()`, ni `Buffer.concat`, ni fichier temporaire : le flux va
 * de MinIO à la réponse. Une vignette est petite, mais la règle du projet ne
 * fait pas d'exception pour ce qui est petit aujourd'hui.
 */
export async function ouvrirVignette(
  vignette: VignetteAnalyse,
): Promise<NodeJS.ReadableStream> {
  return lecteurMinio(BORNE_LECTURE_VIGNETTE).getObject(vignette.bucket, vignette.cle);
}

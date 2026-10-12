/**
 * ─────────────────────────────────────────────────────────────────────────
 * QUI PEUT LIRE QUOI SUR LE RELAIS `/storage/v1/object/public/…` (#547)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le relais servait sans session tout objet de la liste blanche : le rush,
 * la bibliothèque, les rendus et l'audio d'un compte étaient lisibles par
 * quiconque connaissait l'URL (clé = identifiant de compte + horodatage ou
 * uuid, qui fuient dans les journaux, les en-têtes Referer, les URL
 * partagées, les métadonnées de posts publiés).
 *
 * La politique, dans cet ordre, APRÈS `cibleRecevable` (liste blanche,
 * chemin sain, namespaces privés fermés à tous — inchangé) :
 *
 *   1. PUBLIC sans condition — `media/externes/…` : copies partagées de
 *      médias DÉJÀ publics (clé = sha1 de l'URL d'origine,
 *      `medias-externes.ts`). Rien d'autre : la vidéo de démo de l'accueil
 *      (dossier de l'administrateur) sort par un jeton remis par
 *      `GET /api/admin/landing`, pas par une exception de namespace.
 *   2. JETON signé valide pour CETTE cible (`jeton-relais.ts`) — les
 *      lecteurs sans cookie qui ont le droit de lire : réseaux sociaux,
 *      Zernio, Chromium de Remotion, fetch serveur vers sa propre origine.
 *   3. SESSION :
 *        - le propriétaire (`cibleLisibleParCompte` : `<userId>/…`,
 *          `audio-complet/<userId>/…`, `stock-attributions/<userId>/…`) ;
 *        - les préfixes partagés historiques (`converted/…`) : tout compte
 *          CONNECTÉ, comme le documente `PREFIXES_PARTAGES` — plus jamais
 *          l'anonyme ;
 *        - un administrateur (back-office vidéos / utilisateurs).
 *   4. Sinon : refus, rendu par le relais EXACTEMENT comme un objet absent
 *      (404, même corps), sans aucun appel au stockage.
 *
 * Pure : la session et le jeton sont fournis par l'appelant.
 */
import {
  BUCKET_COPIES_EXTERNES,
  PREFIXES_PARTAGES,
  cibleLisibleParCompte,
  cibleRecevable,
} from '@/lib/storage/acces-objet';
import { jetonRelaisValide } from '@/lib/storage/jeton-relais';
import { isAdmin } from '@/lib/admin';

const COPIE_EXTERNE = /^externes\/(?:proxies\/)?[^/]+$/;

/** La cible est-elle lisible par un visiteur ANONYME, sans jeton ? Pure. */
export function lectureAnonymeRelais(bucket: string, cle: string): boolean {
  if (!cibleRecevable(bucket, cle)) return false;
  return bucket === BUCKET_COPIES_EXTERNES && COPIE_EXTERNE.test(cle);
}

export interface DemandeRelais {
  bucket: string;
  cle: string;
  /** Valeur brute du paramètre `sr`, s'il y en a un. */
  jeton?: string | null;
  /** Session NextAuth, ou `null`. Résolue PARESSEUSEMENT : seulement si nécessaire. */
  session?: () => Promise<{ userId: string | null; email: string | null } | null>;
  maintenant?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Le relais doit-il servir cette cible à ce demandeur ? Ne lit jamais le
 * stockage ; ne lit la session que si ni le public ni le jeton ne suffisent.
 */
export async function lectureRelaisAutorisee(d: DemandeRelais): Promise<boolean> {
  if (!cibleRecevable(d.bucket, d.cle)) return false;
  if (lectureAnonymeRelais(d.bucket, d.cle)) return true;
  if (d.jeton && jetonRelaisValide(d.bucket, d.cle, d.jeton, d.maintenant ?? Date.now(), d.env ?? process.env)) {
    return true;
  }
  if (!d.session) return false;
  let s: Awaited<ReturnType<NonNullable<DemandeRelais['session']>>> = null;
  try { s = await d.session(); } catch { s = null; }
  const userId = s?.userId;
  if (typeof userId !== 'string' || userId.length === 0) return false;
  if (cibleLisibleParCompte(d.bucket, d.cle, userId)) return true;
  if ((PREFIXES_PARTAGES as readonly string[]).some((p) => d.cle.startsWith(p) && d.cle.length > p.length)) return true;
  if (isAdmin(s?.email)) return true;
  return false;
}

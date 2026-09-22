/**
 * Côté navigateur : l'intention « utiliser mon jumeau », et le garde avant
 * tout rendu. Le navigateur ne décide rien : il DEMANDE au serveur.
 *
 * DEUX intentions distinctes, jamais confondues (`JumeauMode`) :
 *   'voix'   — narration seulement : la voix clonée du jumeau devient la voix
 *              TTS des séquences (Titre, Cartes, CTA). Aucune vidéo d'avatar,
 *              aucun coût avatar. Ne dépend pas du fournisseur de l'avatar.
 *   'avatar' — présence vidéo réelle : la vidéo du jumeau (avatar animé sur
 *              ma voix, produite par le serveur) devient la séquence « Vidéo »
 *              à l'envoi. Exige le moteur vidéo disponible POUR cet avatar
 *              et coûte AVATAR_VIDEO_COST en plus du rendu.
 *   'aucun'  — le parcours normal, celui de tous les brouillons antérieurs.
 */

export type JumeauMode = 'aucun' | 'voix' | 'avatar';
export const JUMEAU_MODES: readonly JumeauMode[] = ['aucun', 'voix', 'avatar'];
export const estJumeauMode = (v: unknown): v is JumeauMode => v === 'aucun' || v === 'voix' || v === 'avatar';

/** Le fournisseur de l'avatar, en clair pour l'écran. */
export type FournisseurAvatarPublic = 'heygen' | 'did' | 'inconnu';
export function libelleFournisseurAvatar(f: FournisseurAvatarPublic | undefined): string {
  if (f === 'did') return 'créé à partir d’une vidéo (D-ID)';
  if (f === 'heygen') return 'créé à partir d’une photo (HeyGen)';
  return 'fournisseur inconnu';
}

export interface EtatJumeau {
  pret: boolean;
  motif: string | null;
  message: string | null;
  jumeau: { avatar: { id: string; version: number; nom: string | null; valideLe: string; fournisseur?: FournisseurAvatarPublic }; voix: { id: string; nom: string }; prononciations: number } | null;
  moteurDisponible: boolean;
  messageMoteur: string | null;
  scripts?: Array<{ display: string; spoken: string }>;
}

export const JUMEAU_API = '/api/creer/jumeau';
export const JUMEAU_INDISPONIBLE = 'Votre jumeau n’est plus disponible. Vérifiez votre avatar et votre voix.';

/** L'état du jumeau, tel que le serveur le voit maintenant. `null` si l'appel échoue. */
export async function lireEtatJumeau(fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API);
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/** La vérification COMPLÈTE avant génération, avec les textes de la vidéo. */
export async function verifierJumeauAvantRendu(textes: string[], fetchImpl: typeof fetch = fetch): Promise<EtatJumeau | null> {
  try {
    const res = await fetchImpl(JUMEAU_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ textes }) });
    const json = await res.json();
    return json?.success ? (json.data as EtatJumeau) : null;
  } catch {
    return null;
  }
}

/**
 * LE GARDE. Rend `null` si le rendu peut continuer, sinon le message qui
 * l'arrête. Mode 'aucun' : rien ne change au parcours normal, aucun appel.
 *   'avatar' — le serveur DOIT confirmer que le jumeau est prêt
 *              (revérification complète), PUIS que le moteur vidéo existe
 *              pour cet avatar — sinon on s'arrête, sans jamais produire une
 *              vidéo ordinaire sous ce nom.
 *   'voix'   — seulement la voix résolue : le serveur confirme que le jumeau
 *              (donc sa voix) est prêt ; le moteur vidéo n'entre pas en jeu,
 *              aucune vidéo d'avatar n'est demandée.
 */
export async function gardeJumeauAvantRendu(args: {
  mode: JumeauMode;
  textes: string[];
  verifier?: (textes: string[]) => Promise<EtatJumeau | null>;
}): Promise<string | null> {
  if (args.mode !== 'avatar' && args.mode !== 'voix') return null;
  const etat = await (args.verifier ?? verifierJumeauAvantRendu)(args.textes);
  if (!etat) return JUMEAU_INDISPONIBLE;
  if (!etat.pret) return etat.message || JUMEAU_INDISPONIBLE;
  if (args.mode === 'voix') return null;
  if (!etat.moteurDisponible) return etat.messageMoteur || 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.';
  return null;
}

/**
 * ATTEND une génération DÉJÀ lancée — le cœur de polling, partagé par le
 * lancement en un clic et la REPRISE au montage : GET /api/avatar/status?
 * generationId= jusqu'à `completed` (URL re-hébergée) ou `failed`. Rend l'URL
 * de la vidéo, ou lève avec le message à afficher. Aucune vidéo de repli.
 *
 * Cette fonction ne lance RIEN : elle sonde un identifiant existant. Elle est
 * donc sûre à rappeler pour une génération orpheline (l'onglet a été fermé
 * pendant les 5-20 min de rendu) — le serveur, lui, finalise la scène `done`
 * quel que soit son âge (voir `avatar/status/route.ts`).
 */
export async function attendreStatutJumeau(args: {
  generationId: string;
  onEtape?: (message: string) => void;
  fetchImpl?: typeof fetch;
  attendreMs?: (ms: number) => Promise<void>;
  maxAttenteMs?: number;
}): Promise<{ url: string }> {
  const f = args.fetchImpl ?? fetch;
  const dormir = args.attendreMs ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const debut = Date.now();
  const limite = args.maxAttenteMs ?? 20 * 60 * 1000;
  while (Date.now() - debut < limite) {
    const res = await f(`/api/avatar/status?generationId=${encodeURIComponent(args.generationId)}`);
    const json = await res.json().catch(() => ({}));
    if (json?.success) {
      const d = json.data as { status: string; videoUrl?: string | null; error?: string | null };
      if (d.status === 'completed' && d.videoUrl) return { url: d.videoUrl };
      if (d.status === 'failed') throw new Error(d.error || 'La génération de votre jumeau a échoué.');
    }
    args.onEtape?.('Votre jumeau est en cours de préparation…');
    await dormir(5000);
  }
  throw new Error('La génération de votre jumeau prend trop de temps. Réessayez plus tard.');
}

/**
 * Lance la vidéo du jumeau et l'attend — par les routes existantes :
 * POST /api/creer/jumeau/generer, puis `attendreStatutJumeau`. Rend l'URL de
 * la vidéo, ou lève avec le message à afficher. Aucune vidéo de repli.
 *
 * `onLancee` est appelé DÈS que le serveur a accepté la génération (avant tout
 * polling) : c'est le point où l'appelant persiste `generationId`, pour qu'une
 * page fermée pendant le rendu puisse REPRENDRE la même génération au retour
 * plutôt que d'en payer une seconde.
 */
export async function genererEtAttendreVideoJumeau(args: {
  textes: string[];
  aspectRatio: string;
  onLancee?: (generationId: string, avatarVersion: number) => void;
  onEtape?: (message: string) => void;
  fetchImpl?: typeof fetch;
  attendreMs?: (ms: number) => Promise<void>;
  maxAttenteMs?: number;
}): Promise<{ url: string; generationId: string; avatarVersion: number }> {
  const f = args.fetchImpl ?? fetch;
  args.onEtape?.('Génération de votre jumeau…');
  const lancement = await f(`${JUMEAU_API}/generer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ textes: args.textes, aspectRatio: args.aspectRatio }),
  });
  const lance = await lancement.json().catch(() => ({}));
  if (!lancement.ok || !lance?.success) throw new Error(lance?.error || JUMEAU_INDISPONIBLE);
  const generationId: string = lance.data.generationId;
  const avatarVersion: number = lance.data.avatarVersion;
  // Persister l'identifiant AVANT d'attendre : si l'onglet se ferme pendant le
  // rendu, la reprise au montage le retrouvera. Après ce point, `généré` et
  // `abandonné` ne se distinguent que par cet identifiant.
  args.onLancee?.(generationId, avatarVersion);
  const { url } = await attendreStatutJumeau({
    generationId,
    onEtape: args.onEtape,
    fetchImpl: args.fetchImpl,
    attendreMs: args.attendreMs,
    maxAttenteMs: args.maxAttenteMs,
  });
  return { url, generationId, avatarVersion };
}

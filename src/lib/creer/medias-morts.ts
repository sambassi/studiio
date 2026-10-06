/**
 * Médias d'un brouillon devenus introuvables (404/410) au moment d'envoyer.
 *
 * Un brouillon restauré peut porter des adresses mortes : musique d'un post
 * supprimé, fond IA expiré (replicate.delivery), rush retiré du stockage.
 * Avant ce tri, n'importe lequel bloquait « Composer et envoyer », même
 * une musique facultative.
 *
 *  - FACULTATIFS (musique, fonds de séquence) : retirés, et c'est DIT ;
 *    le montage continue sans eux.
 *  - OBLIGATOIRES (rush, narration) : arrêt AVANT tout débit, message clair,
 *    le média est à remplacer — jamais un montage amputé en silence.
 */
export type RoleMedia = 'musique' | 'fond' | 'narration' | 'rush';
export interface MediaAVerifier { role: RoleMedia; url: string; /** Séquence du fond (titre, cartes…). */ cle?: string }

const FACULTATIFS: ReadonlySet<RoleMedia> = new Set(['musique', 'fond']);

const LIBELLE: Record<RoleMedia, string> = {
  musique: 'la musique',
  fond: 'une image de fond',
  narration: 'une narration',
  rush: 'un rush',
};

/** Adresses réellement absentes (404/410). Réseau en échec = présumée présente. */
export async function urlsIntrouvables(urls: ReadonlyArray<string | null | undefined>, f: typeof fetch = fetch): Promise<Set<string>> {
  const cibles = Array.from(new Set(urls.filter((u): u is string =>
    typeof u === 'string' && u.length > 0 && !u.startsWith('blob:') && !u.startsWith('data:'))));
  const absentes = await Promise.all(cibles.map(async (u) => {
    try {
      const r = await f(u, { method: 'HEAD' });
      return r.status === 404 || r.status === 410 ? u : null;
    } catch {
      return null;
    }
  }));
  return new Set(absentes.filter((u): u is string => !!u));
}

export function trierMediasMorts(morts: ReadonlyArray<MediaAVerifier>): { aRetirer: MediaAVerifier[]; bloquants: MediaAVerifier[] } {
  return {
    aRetirer: morts.filter((m) => FACULTATIFS.has(m.role)),
    bloquants: morts.filter((m) => !FACULTATIFS.has(m.role)),
  };
}

const nomFichier = (u: string) => {
  try { return decodeURIComponent(u.split('?')[0].split('/').pop() || u); } catch { return u; }
};

export function messageMediasBloquants(bloquants: ReadonlyArray<MediaAVerifier>): string {
  const liste = bloquants.map((m) => `${LIBELLE[m.role]} (${nomFichier(m.url)})`).join(', ');
  return `Fichier introuvable (supprimé ?) : ${liste}. Remplacez-le avant d’envoyer — rien n’a été composé ni débité.`;
}

export function messageMediasRetires(retires: ReadonlyArray<MediaAVerifier>): string {
  const musique = retires.some((m) => m.role === 'musique');
  const fonds = retires.filter((m) => m.role === 'fond').length;
  const parties = [
    musique ? 'la musique' : null,
    fonds === 1 ? 'une image de fond' : fonds > 1 ? `${fonds} images de fond` : null,
  ].filter(Boolean).join(' et ');
  return `Introuvable dans le stockage (fichier supprimé ou expiré) : ${parties}. Retiré de ce montage, qui continue sans. Rechoisissez si besoin.`;
}

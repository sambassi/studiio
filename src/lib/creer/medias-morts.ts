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
export interface MediaAVerifier {
  role: RoleMedia;
  url: string;
  /** Séquence du fond (titre, cartes…). */
  cle?: string;
  /** Nom d'origine du fichier quand on le connaît (import, médiathèque). */
  nom?: string;
  /** Place (1, 2…) du média dans la séquence « Vidéo ». */
  position?: number;
  /** Type du média, pour l'icône et le choix de la médiathèque. */
  type?: 'video' | 'image';
}

/**
 * Pourquoi un média est introuvable, quand on peut le savoir :
 *  - `supprime` : le stockage répond 404/410 — le fichier n'existe plus ;
 *  - `lien_expire` : un lien SIGNÉ (temporaire) refusé (400/401/403) — le
 *    fichier existe peut-être encore, seul le lien a vieilli ;
 *  - `local_autre_session` : une adresse `blob:` qui ne se lit plus — un
 *    fichier de l'ordinateur choisi lors d'une session précédente, jamais
 *    envoyé au stockage.
 */
export type CauseManquant = 'supprime' | 'lien_expire' | 'local_autre_session';
export interface MediaManquant extends MediaAVerifier { cause?: CauseManquant }

export const CAUSE_TEXTE: Record<CauseManquant, string> = {
  supprime: 'supprimé du stockage',
  lien_expire: 'lien temporaire expiré',
  local_autre_session: 'fichier de votre ordinateur choisi lors d’une session précédente, jamais envoyé',
};

/** Lien signé / temporaire (Supabase `object/sign`, S3/MinIO présigné). */
export function estLienSigne(url: string): boolean {
  return /\/object\/sign\//.test(url) || /[?&](token|X-Amz-Signature|X-Amz-Expires|Signature|Expires)=/i.test(url);
}

/** Cause d'après la réponse du stockage ; `null` = présumé présent. */
export function classerReponse(url: string, status: number): CauseManquant | null {
  if (status === 404 || status === 410) return 'supprime';
  if ((status === 400 || status === 401 || status === 403) && estLienSigne(url)) return 'lien_expire';
  return null;
}

/**
 * Comme `urlsIntrouvables`, avec la CAUSE de chaque absence. Les adresses
 * `blob:` sont lues : celle d'une session précédente ne répond plus. Réseau
 * en échec sur une adresse http = présumée présente (jamais un faux blocage).
 */
export async function diagnostiquerIntrouvables(
  urls: ReadonlyArray<string | null | undefined>, f: typeof fetch = fetch,
): Promise<Map<string, CauseManquant>> {
  const cibles = Array.from(new Set(urls.filter((u): u is string =>
    typeof u === 'string' && u.length > 0 && !u.startsWith('data:'))));
  const res = await Promise.all(cibles.map(async (u): Promise<[string, CauseManquant | null]> => {
    if (u.startsWith('blob:')) {
      try { const r = await f(u); return [u, r.ok ? null : 'local_autre_session']; } catch { return [u, 'local_autre_session']; }
    }
    try {
      const r = await f(u, { method: 'HEAD' });
      return [u, classerReponse(u, r.status)];
    } catch {
      return [u, null];
    }
  }));
  return new Map(res.filter((e): e is [string, CauseManquant] => e[1] !== null));
}

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

export function trierMediasMorts<M extends MediaAVerifier>(morts: ReadonlyArray<M>): { aRetirer: M[]; bloquants: M[] } {
  return {
    aRetirer: morts.filter((m) => FACULTATIFS.has(m.role)),
    bloquants: morts.filter((m) => !FACULTATIFS.has(m.role)),
  };
}

const nomFichier = (u: string) => {
  try { return decodeURIComponent(u.split('?')[0].split('/').pop() || u); } catch { return u; }
};

/** Un identifiant technique (uuid, empreinte, clé d'envoi) n'est pas un nom. */
const NOM_TECHNIQUE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+|envoi-[\w-]+|blob:.*)(?:\.[a-z0-9]{2,5})?$/i;

/**
 * Le nom à montrer pour un média : le nom d'origine s'il est connu et
 * lisible, sinon celui du fichier dans l'adresse s'il est lisible, sinon
 * `null` (on montrera sa place, jamais un identifiant technique).
 */
export function nomLisible(nom: string | null | undefined, url: string): string | null {
  for (const brut of [nom, url.startsWith('blob:') ? null : nomFichier(url)]) {
    if (!brut) continue;
    const n = brut.replace(/\s*·\s*\d+:\d{2}\s*$/, '').replace(/^\d{10,}[-_]/, '').trim();
    if (!n || NOM_TECHNIQUE.test(n) || /pexels|unsplash/i.test(n)) continue;
    return n;
  }
  return null;
}

/** « le rush 2 de la séquence Vidéo (plage.mp4) — supprimé du stockage ». */
export function libelleMediaManquant(m: MediaManquant): string {
  const base = typeof m.position === 'number'
    ? `le ${m.type === 'image' ? 'média' : 'rush'} ${m.position} de la séquence Vidéo`
    : LIBELLE[m.role];
  const nom = nomLisible(m.nom, m.url);
  const avecNom = nom ? `${base} (${nom})` : base;
  return m.cause ? `${avecNom} — ${CAUSE_TEXTE[m.cause]}` : avecNom;
}

export function messageMediasBloquants(bloquants: ReadonlyArray<MediaManquant>): string {
  const liste = bloquants.map(libelleMediaManquant).join(', ');
  const tete = bloquants.every((m) => m.cause) ? 'Fichier introuvable' : 'Fichier introuvable (supprimé ?)';
  const geste = bloquants.some((m) => typeof m.position === 'number')
    ? 'Retrouvez-le ou remplacez-le avant d’envoyer'
    : 'Remplacez-le avant d’envoyer';
  return `${tete} : ${liste}. ${geste} — rien n’a été composé ni débité.`;
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

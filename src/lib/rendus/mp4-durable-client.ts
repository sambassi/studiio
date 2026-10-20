/**
 * Demande au serveur le MP4 DURABLE d'un post qui vient d'être créé.
 *
 * Non bloquant : le post existe déjà avec son WebM confirmé. Le serveur
 * convertit jusqu'au bout même si l'onglet se ferme ; ce client ne fait que
 * déclencher, et réessaie un peu si le serveur est occupé (429).
 */
const RENDU_WEBM = /\/rendus\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webm$/i;

/** Ce montage est-il un rendu WebM qui doit recevoir un MP4 ? */
export function renduAttendUnMp4(url: string | null | undefined): boolean {
  return typeof url === 'string' && RENDU_WEBM.test(url.split('?')[0]);
}

export async function demanderMp4Durable(
  postId: string,
  { essais = 3, attenteMs = 30_000 }: { essais?: number; attenteMs?: number } = {},
): Promise<{ ok: boolean; mp4Url?: string; motif?: string }> {
  for (let i = 0; i < essais; i++) {
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/mp4`, {
        method: 'POST', credentials: 'include',
      });
      const json = await res.json().catch(() => null);
      if (res.status === 429 && i < essais - 1) {
        await new Promise((r) => setTimeout(r, attenteMs));
        continue;
      }
      return { ok: !!json?.ok, mp4Url: json?.mp4Url, motif: json?.motif };
    } catch {
      return { ok: false, motif: 'reseau' };
    }
  }
  return { ok: false, motif: 'occupe' };
}

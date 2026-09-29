/**
 * Noms des fichiers du montage qui n'existent plus (404/410) sur le stockage.
 * Seules les URL durables sont vérifiées (`blob:`/`data:` sont locales). Une
 * erreur réseau n'est PAS un « introuvable » : on ne bloque pas l'envoi sur un
 * doute, seulement sur une absence prouvée.
 */
export async function mediasIntrouvables(urls: Array<string | null | undefined>): Promise<string[]> {
  const cibles = Array.from(new Set(urls.filter((u): u is string =>
    typeof u === 'string' && u.length > 0 && !u.startsWith('blob:') && !u.startsWith('data:'))));
  const absents = await Promise.all(cibles.map(async (u) => {
    try {
      const r = await fetch(u, { method: 'HEAD' });
      return r.status === 404 || r.status === 410 ? decodeURIComponent(u.split('/').pop() || u) : null;
    } catch {
      return null;
    }
  }));
  return absents.filter((n): n is string => !!n);
}

/**
 * Requête Pexels d'affiche — module PUR, sans dépendance serveur.
 *
 * ⚠️ SÉPARÉ DE `poster.ts` : le navigateur (Créer → `sample.ts`) n'a besoin
 * que de cette fonction, alors que `poster.ts` importe le fetch sûr et le
 * stockage (dns, fs, minio) — l'importer côté client cassait le build.
 */

/**
 * Mots-clés envoyés à la banque d'images, à partir du sujet.
 *
 * Le sujet vient des objectifs de l'utilisateur, en français. Pexels indexe
 * en anglais : sans traduction, « routine du matin » ne ramène rien et le
 * montage repart sur un dégradé. On garde un repli générique plutôt qu'une
 * requête vide.
 */
export function posterQuery(topic: string): string {
  const propre = (topic || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const table: Array<[RegExp, string]> = [
    [/sommeil|dormir|nuit|repos/, 'sleep rest recovery'],
    [/nutrition|manger|aliment|repas/, 'healthy food nutrition'],
    [/cardio|course|courir|running/, 'cardio running workout'],
    [/muscu|force|halter/, 'weightlifting gym strength'],
    [/yoga|meditation|stress|mental/, 'yoga meditation calm'],
    [/danse|dance/, 'dance fitness energy'],
    [/matin|reveil|routine/, 'morning routine sunrise'],
    [/eau|hydrat/, 'water hydration drink'],
    [/energie|motivation/, 'athlete motivation training'],
  ];
  for (const [motif, requete] of table) {
    if (motif.test(propre)) return requete;
  }
  // Repli : le même que la route `/api/pexels` quand elle ne reconnaît rien.
  return 'fitness dance workout';
}

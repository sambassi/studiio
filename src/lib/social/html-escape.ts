/**
 * Echappements pour les pages de retour OAuth, qui interpolent un message
 * d'erreur venu de l'URL (`error_description`) dans du HTML ET dans du JS.
 *
 * Deux contextes, deux echappements — les confondre est une XSS.
 */

/**
 * Litteral de chaine JS sur, utilisable a l'interieur d'une balise <script>.
 *
 * `JSON.stringify` seul NE SUFFIT PAS : il n'echappe pas `/`, donc la sequence
 * `</script>` traverse intacte et ferme la balise au niveau du PARSEUR HTML,
 * avant meme que le JS soit evalue. Le litteral de chaine ne protege alors
 * plus rien :
 *
 *   ...?error_description=</script><img src=x onerror=alert(1)>
 *
 * On neutralise donc `<`, `>` et `&` en echappements unicode — invisibles pour
 * le parseur HTML, strictement equivalents pour JS. U+2028 / U+2029 sont des
 * terminateurs de ligne en JS mais pas en JSON : sans eux, la chaine peut etre
 * coupee.
 */
export function toJsStringLiteral(value: unknown): string {
  return JSON.stringify(String(value ?? ''))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Echappement HTML complet (contexte texte et attribut).
 *
 * Les cinq caracteres comptent : `'` et `"` parce que le helper peut servir en
 * contexte d'attribut, `&` en premier sous peine de re-echapper les entites
 * produites par les remplacements suivants.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

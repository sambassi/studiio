/**
 * Lecture de la sortie TEXTE d'un modele Replicate (action `ocr`).
 *
 * Vit ici et non dans la route : un fichier `route.ts` d'App Router ne peut
 * exporter QUE ses handlers et sa config. Un export supplementaire fait
 * echouer le type genere par Next (`.next/types/.../route.ts`), aujourd'hui
 * masque par `ignoreBuildErrors`.
 *
 * Trois formes de sortie possibles selon le modele et le SDK :
 *   - `string` — le cas de abiruyt/text-extract-ocr ;
 *   - `string[]` — sortie declaree `Iterator[str]` : `replicate.run` rend les
 *     morceaux streames dans l'ordre, a recoller sans separateur ;
 *   - objet avec `toString()`.
 *
 * Renvoie `null` si rien n'est lisible — a distinguer de `''`, qui veut dire
 * « lu correctement, mais aucun texte dans l'image ».
 */
export function extractText(output: unknown): string | null {
  if (output == null) return null;
  if (typeof output === 'string') return output.trim();
  if (Array.isArray(output)) {
    const parts = output.filter((p) => typeof p === 'string') as string[];
    if (parts.length !== output.length) return null;
    return parts.join('').trim();
  }
  if (typeof output === 'object') {
    const obj = output as { toString?: () => string };
    if (typeof obj.toString === 'function') {
      const str = obj.toString().trim();
      // `[object Object]` = pas de toString utile.
      if (!str || str.startsWith('[object ')) return null;
      // Un `FileOutput` du SDK rend son URL via toString() : c'est un
      // FICHIER, pas du texte reconnu. L'afficher sous « Texte reconnu »
      // (et facturer pour ca) serait un mensonge.
      if (/^https?:\/\//i.test(str)) return null;
      return str;
    }
  }
  return null;
}

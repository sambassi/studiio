// Fusion des catalogues : le français est la BASE, le catalogue d'une langue est une SURCOUCHE.
// Une clé absente de la langue choisie retombe donc en français — jamais une clé brute
// à l'écran. Pur (sans React) : testable seul.
export type Messages = Record<string, unknown>;

const estObjet = (v: unknown): v is Messages => !!v && typeof v === 'object' && !Array.isArray(v);

/** Copie profonde de `base` recouverte par `surcouche`. Une chaîne vide dans la surcouche
 *  est ignorée : « non traduit » ne doit pas effacer le français. */
export function fusionner(base: Messages, surcouche: Messages | null | undefined): Messages {
  const sortie: Messages = {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const s = surcouche ? surcouche[k] : undefined;
    if (estObjet(b)) sortie[k] = fusionner(b, estObjet(s) ? s : undefined);
    else if (typeof s === 'string' && s.trim() !== '') sortie[k] = s;
    else sortie[k] = b;
  }
  return sortie;
}

/** Aplatit en `a.b.c → texte` (pour la couverture et les tests). */
export function aplatir(m: Messages, prefixe = '', sortie: Record<string, string> = {}): Record<string, string> {
  for (const k of Object.keys(m)) {
    const v = m[k];
    const cle = prefixe ? `${prefixe}.${k}` : k;
    if (estObjet(v)) aplatir(v, cle, sortie);
    else if (typeof v === 'string') sortie[cle] = v;
  }
  return sortie;
}

/** Part (0..1) des clés du français réellement traduites dans `surcouche`. */
export function couverture(base: Messages, surcouche: Messages | null | undefined): number {
  const b = aplatir(base);
  const s = aplatir(surcouche || {});
  const cles = Object.keys(b);
  if (!cles.length) return 1;
  let n = 0;
  for (const c of cles) if (s[c] && s[c].trim() !== '' && s[c] !== b[c]) n += 1;
  return n / cles.length;
}

/** Texte normalisé (NFC, espaces écrasés) — clé de recherche des libellés. */
export function normaliserLibelle(t: string): string {
  return String(t).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Empreinte FNV-1a 32 bits (base 36) d'un libellé français : clé dans `ui.libelles`.
 *  Identique à scripts/i18n/hash.cjs (test d'égalité). */
export function empreinteLibelle(t: string): string {
  const s = normaliserLibelle(t);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `h${h.toString(36)}${s.length.toString(36)}`;
}

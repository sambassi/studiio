/**
 * Empreinte du CONTENU d'un projet — « ce post est-il bien ce projet-là ? ».
 *
 * Titre, sous-titre, cartes et CTA : ce que l'utilisateur lit dans l'aperçu
 * et doit retrouver, à l'identique, dans le MP4 et dans le Calendrier. Écrite
 * dans `metadata.contenuSignature` par Créer et par l'Autopilote, elle permet
 * de prouver en une comparaison qu'un post n'a pas reçu le contenu d'un autre
 * projet (sujet tiré ailleurs, brouillon précédent, variante différente).
 *
 * ⚠️ LE STYLE N'Y EST PAS : il a déjà sa propre empreinte (`renderSignature`,
 * qui couvre toutes les options de rendu). Ici, seul le TEXTE compte — c'est
 * lui qui trahit un mélange entre deux projets.
 *
 * Fonction PURE, sans React ni réseau : la même s'exécute dans l'aperçu
 * (navigateur) et à la production (serveur).
 */

export interface ContenuSignable {
  title?: string | null;
  subtitle?: string | null;
  cards?: ReadonlyArray<{ title?: string | null; description?: string | null; value?: string | null }> | null;
  cta?: string | null;
  ctaSub?: string | null;
}

/** Espaces rognés, casse ignorée : `SequenceTitle` met de toute façon en capitales. */
function norme(v: string | null | undefined): string {
  return (v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** FNV-1a 32 bits — même famille que `renderSignature`, suffisant pour comparer. */
function fnv1a(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Empreinte COURTE d'un texte long — p. ex. `renderSignature(options)`, qui
 * est le JSON stable de toutes les options (affiche `data:` comprise) : on ne
 * l'écrit jamais tel quel en base, seulement son empreinte.
 */
export function empreinteCourte(texte: string): string {
  return `r1-${fnv1a(texte)}-${texte.length.toString(36)}`;
}

export function signatureContenu(c: ContenuSignable): string {
  const parties = [
    norme(c.title),
    norme(c.subtitle),
    ...(c.cards ?? []).map((k) => [norme(k.title), norme(k.description), norme(k.value)].join('\u0001')),
    norme(c.cta),
    norme(c.ctaSub),
  ];
  return `c1-${fnv1a(parties.join('\u0002'))}`;
}

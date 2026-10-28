/**
 * EMPREINTES — ce qui decide qu'une scene doit etre refaite, et rien d'autre.
 *
 * Un film regenere en entier a chaque aperçu, c'est un cout fournisseur qui se
 * repaie pour un resultat identique. L'empreinte est le hash de ce qui CHANGE
 * l'image : le texte des plans, les cadres, les durees, les personnages
 * presents, la VERSION de leur reference, et le MEDIA IMPORTE du plan. Elle
 * ignore volontairement l'etat (`validee`), le cout deja paye et les medias
 * GENERES par le rendu — sinon produire un media changerait l'empreinte et
 * demanderait aussitot de le reproduire.
 *
 * La distinction tient en une phrase : un media que l'UTILISATEUR choisit
 * change le film et doit le marquer ; un media que le RENDU fabrique est une
 * consequence du film, pas une cause.
 *
 * Hash non cryptographique (FNV-1a) : il tourne dans le navigateur comme sur
 * le serveur, sans dependance. On compare des empreintes, on n'en protege
 * aucune.
 */
import type { Film, Personnage, SceneCinema } from '@/lib/cinema/types';

/** FNV-1a 32 bits, en hexadecimal. */
export function hash(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** La partie d'une scene qui determine son image. */
export function matiereScene(scene: SceneCinema, versionsReferences: Record<string, number> = {}): string {
  const plans = scene.plans.map((p) => [
    p.cadre,
    p.description,
    // La duree d'un plan PARLE est DERIVEE de sa voix, mesuree apres la
    // synthese (`ajusterDureesSurVoix`). La compter ici rendrait chaque
    // production salissante pour sa propre empreinte : la scene produite
    // serait aussitot declaree « a reproduire », pour toujours. Celle d'un
    // plan muet, elle, est un choix de montage et compte.
    p.dialogue ? '' : p.dureeS.toFixed(1),
    p.dialogue?.texte ?? '',
    // Media IMPORTE seulement : l'url, son genre, sa duree et son son.
    p.media && p.media.origine === 'import'
      ? `${p.media.url}|${p.media.genre}|${p.media.dureeS ?? ''}|${p.media.sonActif ? 1 : 0}`
      // Media GENERE sous la direction artistique : un nouveau media (autre style ou camera,
      // donc autre fichier) doit invalider le rendu de la scene. Les medias generes d'avant
      // (sans `direction`) restent hors empreinte : aucun film d'avant n'est declare perime.
      : p.media && p.media.origine === 'genere' && p.media.direction
        ? `gen|${p.media.url}|${p.media.direction}`
        : '',
    p.personnages.map((id) => `${id}@${versionsReferences[id] ?? 0}`).join(','),
  ].join('|'));
  return [scene.titre, scene.lieu, scene.intention, ...plans].join('\n');
}

/** Versions actives des references du casting, par personnage. */
export function versionsActives(personnages: readonly Personnage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of personnages) {
    const active = p.references.find((r) => r.id === p.referenceActiveId) ?? p.references.at(-1);
    out[p.id] = active?.version ?? 0;
  }
  return out;
}

export function empreinteScene(scene: SceneCinema, personnages: readonly Personnage[] = []): string {
  return hash(matiereScene(scene, versionsActives(personnages)));
}

/** Les scenes dont l'empreinte ne correspond plus a leur contenu. */
export function scenesAReproduire(film: Film): SceneCinema[] {
  const versions = versionsActives(film.personnages);
  return film.scenes.filter((s) => hash(matiereScene(s, versions)) !== s.empreinte);
}

/**
 * Marque une scene comme produite : son empreinte devient celle de son
 * contenu actuel. A n'appeler qu'APRES un rendu reussi — sinon on declare
 * valide un media qui n'existe pas.
 */
export function scelleScene(scene: SceneCinema, personnages: readonly Personnage[]): SceneCinema {
  return { ...scene, empreinte: empreinteScene(scene, personnages) };
}

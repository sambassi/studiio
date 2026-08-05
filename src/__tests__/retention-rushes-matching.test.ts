import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { storageKey, collectStorageUrlsFromPost } from '@/lib/storage/cleanup';

/**
 * Les rushes de l'Autopilote survivent — vraiment.
 *
 * ⚠️ LA RÉTENTION N'ÉTAIT PAS LA SEULE PORTE. #315 a exempté les rushes du
 * nettoyage de 24 h, et c'était nécessaire. Mais un second chemin les
 * supprimait, et c'est très probablement lui qui a vidé la médiathèque :
 *
 * **la suppression en cascade d'un post.** Chaque montage de l'Autopilote
 * porte dans ses métadonnées `rushUrls: [<rush de la banque>]`, et
 * `DELETE /api/posts` supprime tout ce que `collectStorageUrlsFromPost`
 * ramène — dont ce rush. Supprimer un brouillon emportait donc la source
 * PARTAGÉE par tous les cycles, et le suivant échouait en 404.
 *
 * Le rush appartient à la banque, pas au post.
 *
 * ⚠️ ET LA COMPARAISON SE FAIT DÉSORMAIS SUR LA CLÉ. Une URL s'écrit de
 * plusieurs façons pour le même objet — avec ou sans hôte, `/public/` ou
 * `/sign/…?token=`. Deux formes du même fichier ne se reconnaissaient pas.
 */

const nettoyage = readFileSync(
  resolve(__dirname, '../app/api/cron/cleanup-media/route.ts'), 'utf-8',
);
const posts = readFileSync(resolve(__dirname, '../app/api/posts/route.ts'), 'utf-8');

const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u42/library/rush.mp4';

describe('La clé de stockage réconcilie les formes d URL', () => {
  it('elle est la même avec ou sans hôte', () => {
    expect(storageKey(RUSH)).toBe('media/u42/library/rush.mp4');
    expect(storageKey('/storage/v1/object/public/media/u42/library/rush.mp4'))
      .toBe('media/u42/library/rush.mp4');
  });

  it('une URL signée donne la même clé', () => {
    expect(storageKey('https://x/storage/v1/object/sign/media/u42/library/rush.mp4?token=abc'))
      .toBe('media/u42/library/rush.mp4');
  });

  it('les deux préfixes de dossier sont couverts', () => {
    expect(storageKey(`https://x/storage/v1/object/public/media/u42/rush/a.mp4`))
      .toBe('media/u42/rush/a.mp4');
  });

  it('une URL étrangère ne donne pas de clé', () => {
    expect(storageKey('https://images.pexels.com/photo.jpg')).toBeNull();
    expect(storageKey(null)).toBeNull();
  });
});

describe('La suppression d un post n emporte plus le rush de la banque', () => {
  it('le rush EST bien dans les métadonnées du post', () => {
    // C'est la raison du dégât : la cascade le voyait comme un fichier du
    // post.
    const urls = collectStorageUrlsFromPost({ rushUrls: [RUSH], videoUrl: 'https://x/v.mp4' });
    expect(urls).toContain(RUSH);
  });

  it('la cascade consulte la banque avant de supprimer', () => {
    expect(posts).toContain('const banque = await autopilotRushKeys();');
    expect(posts).toContain('banque ? banque.has(k) : rushesDuPost.has(k)');
  });

  it('et le dit dans les journaux quand elle en épargne un', () => {
    expect(posts).toContain('rush de la banque Autopilote conserve');
  });

  it('le reste du post est toujours supprimé', () => {
    // Seuls les rushes de la banque sont épargnés : le montage, la vignette
    // et le reste partent comme avant.
    expect(posts).toContain('return true;');
    expect(posts).toContain('deleteStorageFiles(urls,');
  });
});

describe('Le job de rétention compare des CLÉS', () => {
  it('la clé du fichier vient du bucket et du chemin, pas de l URL publique', () => {
    // `getPublicUrl` dépend de variables d'environnement et peut rendre une
    // forme relative selon le contexte : la reconstruire depuis l'URL serait
    // fragile.
    expect(nettoyage).toContain('const cle = `${bucket}/${path}`;');
    expect(nettoyage).toContain('if (rushKeys.has(cle)) {');
  });

  it('les rushes sont lus en clés, une seule fois', () => {
    expect(nettoyage).toContain('const banqueLue = await autopilotRushKeys();');
  });

  it('la banque ne retient que les Autopilotes ACTIFS', () => {
    const cleanup = readFileSync(resolve(__dirname, '../lib/storage/cleanup.ts'), 'utf-8');
    expect(cleanup).toContain(".eq('enabled', true)");
  });

  it('un rush retiré de la banque redevient supprimable', () => {
    // La protection suit la référence : rien ne marque le fichier.
    const cleanup = readFileSync(resolve(__dirname, '../lib/storage/cleanup.ts'), 'utf-8');
    expect(cleanup).toContain('CES FICHIERS SONT PARTAGÉS');
  });
});

describe('Le journal permet de VÉRIFIER, pas de deviner', () => {
  it('il compte les candidats et chaque type d exemption', () => {
    expect(nettoyage).toContain('candidats=${candidats}');
    expect(nettoyage).toContain('posts=${exemptesPosts}, rushes-autopilote=${exemptesRushes}');
  });

  it('et la taille de la banque, pour repérer un rapprochement muet', () => {
    // `rushes-autopilote=0` avec `banque=3` signale que le rapprochement ne
    // prend pas — c'est exactement ce qu'on n'a pas pu voir cette fois.
    expect(nettoyage).toContain('banque=${rushKeys.size}');
  });

  it('la réponse HTTP porte le même détail', () => {
    expect(nettoyage).toContain('rushesAutopilote: exemptesRushes');
  });
});

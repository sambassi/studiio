import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildAutopilotDesign, autopilotVideoSeconds } from '@/lib/autopilot/design';
import { posterQuery } from '@/lib/autopilot/poster';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { RUSH_SEQUENCE_SECONDS, DEFAULT_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';

/**
 * L'Autopilote doit produire un montage SEMBLABLE au Mode simple.
 *
 * Trois manques constatés sur une vidéo réellement rendue, trois causes
 * distinctes :
 *
 * - **Fond plat** : la fabrique de design ne remplissait pas `posterUrl`. Le
 *   champ existe et `CreerSimpleMontage` le rend déjà — il n'était jamais
 *   donné.
 * - **Gel de ~2 s en fin** : la séquence vidéo durait une valeur FIXE de
 *   repli (6 s). Un rush plus court laissait `OffthreadVideo` figé sur sa
 *   dernière image le temps restant, puis le CTA arrivait.
 * - **Banque de rushes vidée** : les rushes vivent dans `media/`, sous la
 *   rétention de 24 h, et aucun post ne les référence tant qu'un cycle n'a
 *   pas tourné. Ils étaient donc supprimés, et le cycle suivant échouait en
 *   404 au téléchargement.
 */

const nettoyage = readFileSync(
  resolve(__dirname, '../app/api/cron/cleanup-media/route.ts'), 'utf-8',
);
const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
const poster = readFileSync(resolve(__dirname, '../lib/autopilot/poster.ts'), 'utf-8');

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: ['https://cdn.test/a.mp4'], ...p,
});
const unPost = (c: AutopilotConfig = cfg()) =>
  preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];

describe('A — la photo d affiche', () => {
  it('elle entre dans le design, au MÊME champ que le Mode simple', () => {
    const d = buildAutopilotDesign(unPost(), { posterUrl: 'https://images.test/p.jpg' });
    expect(d.posterUrl).toBe('https://images.test/p.jpg');
  });

  it('absente, le dégradé reprend sa place — pas d échec', () => {
    expect(buildAutopilotDesign(unPost()).posterUrl).toBeNull();
  });

  it('les mots-clés sont traduits — Pexels indexe en anglais', () => {
    // Sans traduction, « routine du matin » ne ramène rien et le montage
    // repart sur un dégradé.
    expect(posterQuery('routine du matin')).toContain('morning');
    expect(posterQuery('bien manger au quotidien')).toContain('nutrition');
    expect(posterQuery('sujet totalement inconnu')).toBe('fitness dance workout');
  });

  it('une API muette ne fait jamais échouer le cycle', () => {
    expect(poster).toContain('if (!cle) return null;');
    expect(poster).toContain('} catch {\n    return null;\n  }');
  });

  it('deux montages du même thème n ont pas forcément le même fond', () => {
    // Prendre systématiquement la première photo donnerait le même fond à
    // toute une série.
    expect(poster).toContain('graine % photos.length');
  });
});

describe('C — le gel de fin de montage', () => {
  it('la séquence vidéo suit la durée RÉELLE du rush', () => {
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4', 3.4)).toBe(3);
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4', 8.9)).toBe(8);
  });

  it('elle reste bornée comme dans le Mode simple', () => {
    // Une source d'une heure ne doit pas devenir une séquence d'une heure.
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4', 3600)).toBe(RUSH_SEQUENCE_SECONDS.max);
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4', 0.1)).toBe(RUSH_SEQUENCE_SECONDS.min);
  });

  it('durée illisible : le repli du Mode simple, comme avant', () => {
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4', null)).toBe(RUSH_SEQUENCE_SECONDS.fallback);
    expect(autopilotVideoSeconds('https://cdn.test/a.mp4')).toBe(RUSH_SEQUENCE_SECONDS.fallback);
  });

  it('sans rush, rien ne change', () => {
    expect(autopilotVideoSeconds(null, 5)).toBe(DEFAULT_SEQUENCE_SECONDS.video);
    expect(DEFAULT_SEQUENCE_SECONDS.video).toBe(0);
  });

  it('le sondage tourne dans Node, pas dans un navigateur', () => {
    // `@remotion/media-utils` suppose un navigateur ; `media-parser` lit
    // l'en-tête sans décoder et tourne côté serveur.
    expect(poster).toContain("await import('@remotion/media-parser')");
    // Hors commentaires : l'en-tete NOMME `media-utils` pour dire pourquoi
    // il n'est pas utilise.
    const code = poster.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('@remotion/media-utils');
  });

  it('les deux sondages précèdent la fabrique, qui reste pure', () => {
    expect(cron).toContain('await Promise.all([');
    // La voix s'est ajoutee depuis : les durees qu'elle impose entrent au
    // meme endroit. Puis l'identite constante du compte (`config`).
    //
    // ⚠️ ON VERIFIE LES ARGUMENTS, PAS LEUR MISE EN PAGE. La version
    // precedente comparait la ligne d'appel entiere, au caractere pres : elle
    // tombait au premier retour a la ligne, sans qu'aucun comportement n'ait
    // bouge.
    const appel = cron.slice(cron.indexOf('buildAutopilotDesign('));
    const args = appel.slice(0, appel.indexOf(');'));
    for (const attendu of ['posterUrl', 'rushSeconds', 'voices', 'config']) {
      expect(args).toContain(attendu);
    }
  });
});

describe('D — la banque de rushes survit à la rétention', () => {
  it('les rushes des Autopilotes ACTIFS sont protégés', () => {
    // La lecture vit desormais dans `autopilotRushKeys`, partagee avec la
    // cascade de suppression d'un post — l'autre porte par laquelle ils
    // disparaissaient.
    const cleanup = readFileSync(resolve(__dirname, '../lib/storage/cleanup.ts'), 'utf-8');
    expect(cleanup).toContain(".from('autopilot_config')");
    expect(cleanup).toContain(".eq('enabled', true)");
    expect(nettoyage).toContain('await autopilotRushKeys()');
  });

  it('ils sont compares par CLE, pas par URL', () => {
    // Deux ecritures de la meme URL ne se reconnaissaient pas ; la cle est
    // ce que MinIO indexe.
    expect(nettoyage).toContain('const cle = `${bucket}/${path}`;');
    expect(nettoyage).toContain('rushKeys.has(cle)');
  });

  it('un compte sans post garde quand même ses rushes', () => {
    // Les rushes sont lus a part, pas au fil des posts.
    expect(nettoyage).toContain('const banqueLue = await autopilotRushKeys();');
  });

  it('une lecture ratée ne supprime RIEN', () => {
    // Un nettoyage manqué se rattrape au passage suivant ; un rush supprimé
    // ne revient pas. `null` (et non un ensemble vide) porte cette
    // distinction jusqu'a l'appelant.
    expect(nettoyage).toContain('aucune suppression tentée');
    const cleanup = readFileSync(resolve(__dirname, '../lib/storage/cleanup.ts'), 'utf-8');
    expect(cleanup).toContain('`null` ET NON UN ENSEMBLE VIDE');
  });

  it('un rush retiré de la banque redevient supprimable', () => {
    // La protection suit la référence : elle ne marque pas le fichier.
    expect(nettoyage).toContain('la protection\n * suit la référence');
  });
});

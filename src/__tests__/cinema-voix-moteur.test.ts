/**
 * CINEMA IA — la voix : GRATUITE, et joignable depuis le serveur.
 *
 * Cause du « Connect Error » en production (verifiee le 2026-10-27 depuis le serveur
 * Hetzner, dans un conteneur jetable) : `msedge-tts@2.0.4` → « Connect Error : {} »,
 * `msedge-tts@2.1.1` → 39 456 octets d'audio, meme serveur, meme minute. Le service de
 * Microsoft exige desormais le jeton `Sec-MS-GEC`, que seules les versions >= 2.1 envoient.
 * Ce n'etait donc PAS un blocage des adresses de centre de donnees.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const racine = process.cwd();

describe('moteur de voix de Cinema IA', () => {
  it('le depot exige msedge-tts >= 2.1 (jeton Sec-MS-GEC), dans package.json ET le verrou', () => {
    const pkg = JSON.parse(readFileSync(path.join(racine, 'package.json'), 'utf8'));
    expect(pkg.dependencies['msedge-tts']).toMatch(/^\^2\.(1|[2-9])\./);
    const lock = JSON.parse(readFileSync(path.join(racine, 'package-lock.json'), 'utf8'));
    const [maj, min] = String(lock.packages['node_modules/msedge-tts'].version).split('.').map(Number);
    expect(maj > 2 || (maj === 2 && min >= 1)).toBe(true);
  });

  it('la version installee porte bien le module Sec-MS-GEC', () => {
    expect(existsSync(path.join(racine, 'node_modules/msedge-tts/dist/SecMsGec.js'))).toBe(true);
  });

  it('aucun fournisseur PAYANT n’est branche sur la voix de Cinema (ni ElevenLabs, ni autre)', () => {
    // Le CODE, pas les commentaires (qui expliquent justement pourquoi il n'y a pas de repli payant).
    const v = readFileSync(path.join(racine, 'src/lib/cinema/voix.ts'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(v).not.toMatch(/elevenlabs|openai|replicate/i);
    expect(v).toContain("from 'msedge-tts'");
  });

  it('la connexion ne peut pas pendre : delai dur autour de setMetadata (deja en place), et echec annonce', () => {
    const v = readFileSync(path.join(racine, 'src/lib/cinema/voix.ts'), 'utf8');
    expect(v).toContain('DELAI_CONNEXION_MS');
    expect(v).toMatch(/Promise\.race\(\[\s*tts\.setMetadata/);
  });
});

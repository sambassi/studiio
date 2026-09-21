/**
 * D'une URL de media a une cible de stockage — le parseur UNIQUE, ses
 * origines configurees, la recevabilite partagee avec le relais public, la
 * propriete stricte, et la regle d'adresse privee etendue aux IPv6 mappees.
 *
 * Tests de valeurs seulement : aucun reseau, aucun stockage, aucune base.
 */

import { describe, it, expect } from 'vitest';
import {
  PREFIXE_RELAIS_PUBLIC,
  originesStockageConfigurees,
  extraireCibleStockage,
  cibleRecevable,
  cleDuCompteStrict,
  clePossedeePar,
} from '@/lib/storage/acces-objet';
import { estAdressePrivee, isPubliableMediaUrl } from '@/lib/videos/playable-url';

const U = 'u1';
const ORIGINES = ['https://studiio.pro'] as const;

// ───────────────────────────────────────────────────────────────────────────

describe('originesStockageConfigurees', () => {
  it('retire la barre oblique finale', () => {
    expect(originesStockageConfigurees({ NEXT_PUBLIC_APP_URL: 'https://studiio.pro/' }))
      .toEqual(['https://studiio.pro']);
  });

  it('ne garde que l ORIGINE de PUBLIC_STORAGE_URL', () => {
    expect(originesStockageConfigurees({
      PUBLIC_STORAGE_URL: 'https://cdn.studiio.pro/storage/v1/object/public/',
    })).toEqual(['https://cdn.studiio.pro']);
  });

  it('ignore ce qui n est pas http(s)', () => {
    expect(originesStockageConfigurees({
      NEXT_PUBLIC_APP_URL: 'ftp://studiio.pro',
      NEXTAUTH_URL: 'pas une url',
      PUBLIC_STORAGE_URL: 'file:///tmp',
      NEXT_PUBLIC_SUPABASE_URL: 'javascript:alert(1)',
    })).toEqual([]);
  });

  it('dedoublonne, y compris a travers la casse et le port par defaut', () => {
    expect(originesStockageConfigurees({
      NEXT_PUBLIC_APP_URL: 'https://studiio.pro',
      NEXTAUTH_URL: 'https://Studiio.PRO:443/',
      PUBLIC_STORAGE_URL: 'https://studiio.pro/storage/v1/object/public',
      NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co',
    })).toEqual(['https://studiio.pro', 'https://xyz.supabase.co']);
  });

  it('env vide → []', () => {
    expect(originesStockageConfigurees({})).toEqual([]);
  });

  it('garde http en developpement, jamais le Host de la requete', () => {
    expect(originesStockageConfigurees({ NEXTAUTH_URL: 'http://localhost:3000' }))
      .toEqual(['http://localhost:3000']);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('extraireCibleStockage', () => {
  const opts = { origines: ORIGINES };
  const CLE = `${U}/rendus/1700000000-montage.webm`;

  it('le prefixe est celui du relais', () => {
    expect(PREFIXE_RELAIS_PUBLIC).toBe('/storage/v1/object/public/');
  });

  it('chemin relatif → cible', () => {
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${CLE}`, opts))
      .toEqual({ bucket: 'media', cle: CLE });
  });

  it('URL absolue sur une origine admise → cible', () => {
    expect(extraireCibleStockage(`https://studiio.pro/storage/v1/object/public/media/${CLE}`, opts))
      .toEqual({ bucket: 'media', cle: CLE });
  });

  it('hote en majuscules et port 443 explicite : meme origine', () => {
    expect(extraireCibleStockage(`https://STUDIIO.pro/storage/v1/object/public/media/${CLE}`, opts))
      .toEqual({ bucket: 'media', cle: CLE });
    expect(extraireCibleStockage(`https://studiio.pro:443/storage/v1/object/public/media/${CLE}`, opts))
      .toEqual({ bucket: 'media', cle: CLE });
  });

  it('les origines admises sont elles-memes normalisees', () => {
    expect(extraireCibleStockage(
      `https://studiio.pro/storage/v1/object/public/media/${CLE}`,
      { origines: ['https://Studiio.PRO:443/'] },
    )).toEqual({ bucket: 'media', cle: CLE });
  });

  it('autre origine → null (meme avec notre chemin)', () => {
    for (const url of [
      `https://evil.example/storage/v1/object/public/media/${CLE}`,
      `https://studiio.pro.evil.example/storage/v1/object/public/media/${CLE}`,
      `https://evil.studiio.pro/storage/v1/object/public/media/${CLE}`,
      `https://studiio.pro:8443/storage/v1/object/public/media/${CLE}`,
      `http://studiio.pro/storage/v1/object/public/media/${CLE}`,
      `https://studiio.pro./storage/v1/object/public/media/${CLE}`,
    ]) {
      expect(extraireCibleStockage(url, opts), url).toBeNull();
    }
  });

  it('aucune origine configuree → aucune URL absolue ne passe, le relatif si', () => {
    expect(extraireCibleStockage(`https://studiio.pro/storage/v1/object/public/media/${CLE}`, { origines: [] }))
      .toBeNull();
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${CLE}`, { origines: [] }))
      .toEqual({ bucket: 'media', cle: CLE });
  });

  it('relatif au protocole `//hote/…` → null', () => {
    expect(extraireCibleStockage(`//evil.example/storage/v1/object/public/media/${CLE}`, opts)).toBeNull();
    expect(extraireCibleStockage(`//studiio.pro/storage/v1/object/public/media/${CLE}`, opts)).toBeNull();
    expect(extraireCibleStockage(`/\\evil.example/storage/v1/object/public/media/${CLE}`, opts)).toBeNull();
  });

  it('schemas non http(s) → null', () => {
    for (const url of [
      `data:text/plain,/storage/v1/object/public/media/${CLE}`,
      `file:///storage/v1/object/public/media/${CLE}`,
      `ftp://studiio.pro/storage/v1/object/public/media/${CLE}`,
      `javascript:/storage/v1/object/public/media/${CLE}`,
      `blob:https://studiio.pro/storage/v1/object/public/media/${CLE}`,
    ]) {
      expect(extraireCibleStockage(url, opts), url).toBeNull();
    }
  });

  it('identifiants dans l URL → null', () => {
    expect(extraireCibleStockage(`https://u:p@studiio.pro/storage/v1/object/public/media/${CLE}`, opts)).toBeNull();
    expect(extraireCibleStockage(`https://studiio.pro@evil.example/storage/v1/object/public/media/${CLE}`, opts)).toBeNull();
  });

  it('chaine de requete ou fragment → null', () => {
    expect(extraireCibleStockage(`https://studiio.pro/storage/v1/object/public/media/${CLE}?token=x`, opts)).toBeNull();
    expect(extraireCibleStockage(`https://studiio.pro/storage/v1/object/public/media/${CLE}#f`, opts)).toBeNull();
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${CLE}?token=x`, opts)).toBeNull();
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${CLE}#f`, opts)).toBeNull();
  });

  it('`%2F` dans le compartiment : decode, contient `/`, → null', () => {
    expect(extraireCibleStockage(`/storage/v1/object/public/media%2Fx/${CLE}`, opts)).toBeNull();
  });

  it('echappement invalide → null', () => {
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${U}/%zz.mp4`, opts)).toBeNull();
    expect(extraireCibleStockage(`/storage/v1/object/public/me%zzdia/${CLE}`, opts)).toBeNull();
  });

  it('autre prefixe → null', () => {
    for (const url of [
      `/storage/v1/object/sign/media/${CLE}`,
      `/storage/v1/object/media/${CLE}`,
      `/x/storage/v1/object/public/media/${CLE}`,
      `https://studiio.pro/x/storage/v1/object/public/media/${CLE}`,
      `storage/v1/object/public/media/${CLE}`,
    ]) {
      expect(extraireCibleStockage(url, opts), url).toBeNull();
    }
  });

  it('compartiment sans cle, ou vides → null', () => {
    expect(extraireCibleStockage('/storage/v1/object/public/media', opts)).toBeNull();
    expect(extraireCibleStockage('/storage/v1/object/public/media/', opts)).toBeNull();
    expect(extraireCibleStockage('/storage/v1/object/public/', opts)).toBeNull();
    expect(extraireCibleStockage(`/storage/v1/object/public//${CLE}`, opts)).toBeNull();
  });

  it('garde une cle a plusieurs segments', () => {
    expect(extraireCibleStockage(`/storage/v1/object/public/videos/${U}/a/b/c/d.mp4`, opts))
      .toEqual({ bucket: 'videos', cle: `${U}/a/b/c/d.mp4` });
  });

  it('decode la cle UNE fois', () => {
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${U}/mon%20rush.mp4`, opts))
      .toEqual({ bucket: 'media', cle: `${U}/mon rush.mp4` });
    // Un double encodage ne redevient pas `..` ici : c'est `cibleRecevable`
    // qui relit les formes decodees.
    expect(extraireCibleStockage(`/storage/v1/object/public/media/${U}/%252e%252e/x.mp4`, opts))
      .toEqual({ bucket: 'media', cle: `${U}/%2e%2e/x.mp4` });
  });

  it('ne valide pas le contenu : `..` decode est rendu, et refuse ensuite', () => {
    const cible = extraireCibleStockage(`/storage/v1/object/public/media/${U}/%2e%2e/x.mp4`, opts);
    expect(cible).toEqual({ bucket: 'media', cle: `${U}/../x.mp4` });
    expect(cibleRecevable(cible!.bucket, cible!.cle)).toBe(false);
  });

  it('pas une chaine, vide, ou blanc de tete/queue → null', () => {
    for (const v of [null, undefined, 42, {}, [], '', ` /storage/v1/object/public/media/${CLE}`, `/storage/v1/object/public/media/${CLE}\n`]) {
      expect(extraireCibleStockage(v, opts)).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('cibleRecevable — la composition du relais, partagee', () => {
  it('un rendu ordinaire est recevable', () => {
    expect(cibleRecevable('media', `${U}/rendus/x.webm`)).toBe(true);
    expect(cibleRecevable('videos', `${U}/autopilote/clips/x.mp4`)).toBe(true);
  });

  it('compartiment hors liste → false', () => {
    expect(cibleRecevable('backups', `${U}/dump.mp4`)).toBe(false);
    expect(cibleRecevable('', `${U}/x.mp4`)).toBe(false);
  });

  it('cle malformee → false', () => {
    expect(cibleRecevable('media', `${U}/../x.mp4`)).toBe(false);
    expect(cibleRecevable('media', `${U}\\x.mp4`)).toBe(false);
    expect(cibleRecevable('media', `https://evil/x.mp4`)).toBe(false);
    expect(cibleRecevable('media', `${U}/%2e%2e/x.mp4`)).toBe(false);
    expect(cibleRecevable('media', '')).toBe(false);
  });

  it('namespaces prives → false', () => {
    expect(cibleRecevable('media', `${U}/analyse/an-1/vignette-01.jpg`)).toBe(false);
    expect(cibleRecevable('videos', `${U}/montages/r-1/montage.mp4`)).toBe(false);
    expect(cibleRecevable('media', `${U}/lut/look.cube`)).toBe(false);
  });

  it('avatar : la source et le consentement sont prives, la video generee reste servie', () => {
    expect(cibleRecevable('media', `${U}/avatar/source-1.webm`)).toBe(false);
    expect(cibleRecevable('media', `${U}/avatar/consent-1700000000000-${'a'.repeat(32)}.mp4`)).toBe(false);
    expect(cibleRecevable('media', `${U}/avatar/audio-123e4567-e89b-12d3-a456-426614174000.mp3`)).toBe(false);
    expect(cibleRecevable('media', `${U}/avatar/123e4567-e89b-12d3-a456-426614174000.mp4`)).toBe(true);
  });

  it('formes encodees des namespaces → false', () => {
    expect(cibleRecevable('media', `${U}/%61nalyse/an-1/vignette-01.jpg`)).toBe(false);
    expect(cibleRecevable('media', `${U}/avatar/source%2D1.webm`)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('cleDuCompteStrict', () => {
  it('son propre prefixe → true', () => {
    expect(cleDuCompteStrict(`${U}/rendus/x.webm`, U)).toBe(true);
  });

  it('le prefixe partage `converted/` → false (contrairement a clePossedeePar)', () => {
    expect(cleDuCompteStrict('converted/x.mp4', U)).toBe(false);
    expect(clePossedeePar('converted/x.mp4', U)).toBe(true);
  });

  it('un autre compte → false', () => {
    expect(cleDuCompteStrict('u2/rendus/x.webm', U)).toBe(false);
  });

  it('`u1x/…` n appartient pas a `u1`', () => {
    expect(cleDuCompteStrict('u1x/rendus/x.webm', U)).toBe(false);
  });

  it('userId avec `/`, vide, ou pas une chaine → false', () => {
    expect(cleDuCompteStrict('u1/u2/x.webm', 'u1/u2')).toBe(false);
    expect(cleDuCompteStrict(`${U}/x.webm`, '')).toBe(false);
    expect(cleDuCompteStrict(`${U}/x.webm`, undefined)).toBe(false);
    expect(cleDuCompteStrict(`${U}/x.webm`, null)).toBe(false);
    expect(cleDuCompteStrict(`${U}/x.webm`, 42)).toBe(false);
  });

  it('cle invalide → false, meme sous le bon prefixe', () => {
    expect(cleDuCompteStrict(`${U}/../u2/x.webm`, U)).toBe(false);
    expect(cleDuCompteStrict(`${U}/a\\b.webm`, U)).toBe(false);
    expect(cleDuCompteStrict(`${U}/%zz.webm`, U)).toBe(false);
    expect(cleDuCompteStrict('', U)).toBe(false);
    expect(cleDuCompteStrict(undefined, U)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────

describe('estAdressePrivee', () => {
  it('cas existants', () => {
    for (const h of [
      'localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5', '192.168.1.10',
      '172.16.0.1', '172.31.255.254', '169.254.169.254', 'metadata.google.internal',
      'base-interne.local', 'api.internal', '::1', '[::1]', 'fd00::1', '[fd00::1]', 'fe80::1',
      '224.0.0.1', '255.255.255.255',
    ]) {
      expect(estAdressePrivee(h), h).toBe(true);
    }
    for (const h of ['172.32.0.1', '11.0.0.1', '8.8.8.8', 'studiio.pro', 'xyz.supabase.co', '2606:4700::1111']) {
      expect(estAdressePrivee(h), h).toBe(false);
    }
  });

  it('IPv4 mappee en IPv6 : la regle IPv4 s applique a l adresse deballee', () => {
    expect(estAdressePrivee('::ffff:127.0.0.1')).toBe(true);
    expect(estAdressePrivee('[::ffff:7f00:1]')).toBe(true);
    expect(estAdressePrivee('::ffff:169.254.169.254')).toBe(true);
    expect(estAdressePrivee('[::ffff:a9fe:a9fe]')).toBe(true);
    expect(estAdressePrivee('::ffff:10.0.0.1')).toBe(true);
    expect(estAdressePrivee('::ffff:c0a8:0101')).toBe(true);
    expect(estAdressePrivee('0:0:0:0:0:ffff:7f00:1')).toBe(true);
    expect(estAdressePrivee('::FFFF:127.0.0.1')).toBe(true);
    expect(estAdressePrivee('::ffff:8.8.8.8')).toBe(false);
    expect(estAdressePrivee('::ffff:808:808')).toBe(false);
  });

  it('adresse non specifiee et boucle developpee', () => {
    expect(estAdressePrivee('::')).toBe(true);
    expect(estAdressePrivee('[::]')).toBe(true);
    expect(estAdressePrivee('0:0:0:0:0:0:0:0')).toBe(true);
    expect(estAdressePrivee('0:0:0:0:0:0:0:1')).toBe(true);
    expect(estAdressePrivee('::127.0.0.1')).toBe(true);
  });

  it('normalisation : blancs, casse, point final, crochets', () => {
    expect(estAdressePrivee('localhost.')).toBe(true);
    expect(estAdressePrivee('LOCALHOST')).toBe(true);
    expect(estAdressePrivee(' localhost ')).toBe(true);
    expect(estAdressePrivee('app.localhost')).toBe(true);
    expect(estAdressePrivee('Metadata.Google.Internal.')).toBe(true);
    expect(estAdressePrivee('studiio.pro.')).toBe(false);
    expect(estAdressePrivee('')).toBe(true);
  });

  it('isPubliableMediaUrl refuse une IPv4 mappee', () => {
    expect(isPubliableMediaUrl('https://[::ffff:127.0.0.1]/x.mp4')).toBe(false);
    expect(isPubliableMediaUrl('https://[::ffff:a9fe:a9fe]/x.mp4')).toBe(false);
    expect(isPubliableMediaUrl('https://[::]/x.mp4')).toBe(false);
    expect(isPubliableMediaUrl('https://studiio.pro/x.mp4')).toBe(true);
  });
});

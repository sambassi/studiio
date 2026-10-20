/**
 * « Fichier introuvable (supprimé ?) : un rush <id technique> » — le message
 * dit désormais LEQUEL (nom d'origine, place) et POURQUOI (supprimé, lien
 * expiré, fichier local d'une session précédente).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  classerReponse, diagnostiquerIntrouvables, estLienSigne, libelleMediaManquant,
  messageMediasBloquants, nomLisible, trierMediasMorts, type MediaManquant,
} from '@/lib/creer/medias-morts';

const SIGNE_SUPA = 'https://x.supabase.co/storage/v1/object/sign/media/u/a.mp4?token=eyJ';
const SIGNE_S3 = 'https://s3.studiio.pro/media/u/a.mp4?X-Amz-Signature=abc&X-Amz-Expires=3600';
const PUBLIC = 'https://s3.studiio.pro/media/u/a.mp4';

describe('classerReponse', () => {
  it('404/410 = supprimé, signé et 400/401/403 = lien expiré', () => {
    expect(classerReponse(PUBLIC, 404)).toBe('supprime');
    expect(classerReponse(SIGNE_S3, 410)).toBe('supprime');
    expect(classerReponse(SIGNE_SUPA, 400)).toBe('lien_expire');
    expect(classerReponse(SIGNE_S3, 403)).toBe('lien_expire');
  });
  it('403 sur une adresse publique, 200, 500 : présumé présent (jamais un faux blocage)', () => {
    expect(classerReponse(PUBLIC, 403)).toBeNull();
    expect(classerReponse(PUBLIC, 200)).toBeNull();
    expect(classerReponse(SIGNE_S3, 500)).toBeNull();
  });
  it('estLienSigne', () => {
    expect(estLienSigne(SIGNE_SUPA)).toBe(true);
    expect(estLienSigne(SIGNE_S3)).toBe(true);
    expect(estLienSigne(PUBLIC)).toBe(false);
  });
});

describe('diagnostiquerIntrouvables', () => {
  it('cause par adresse ; blob mort = fichier local d’une autre session ; réseau coupé = présent', async () => {
    const f = (async (u: string, init?: RequestInit) => {
      if (u === 'blob:http://x/mort') throw new TypeError('Failed to fetch');
      if (u === 'blob:http://x/vivant') return { ok: true, status: 200 } as Response;
      if (u === '/coupe.mp4') throw new Error('réseau');
      expect(init?.method).toBe('HEAD');
      return { status: u === PUBLIC ? 404 : u === SIGNE_S3 ? 403 : 200 } as Response;
    }) as unknown as typeof fetch;
    const r = await diagnostiquerIntrouvables([PUBLIC, SIGNE_S3, 'blob:http://x/mort', 'blob:http://x/vivant', '/coupe.mp4', '/ok.mp4', 'data:x', null], f);
    expect(Object.fromEntries(r)).toEqual({
      [PUBLIC]: 'supprime', [SIGNE_S3]: 'lien_expire', 'blob:http://x/mort': 'local_autre_session',
    });
  });
});

describe('nomLisible', () => {
  it('nom d’origine d’abord, préfixe horodaté retiré', () => {
    expect(nomLisible('Plage été.mov', '/u/3f2a.mp4')).toBe('Plage été.mov');
    expect(nomLisible(undefined, '/u/1697712345678-plage.mp4')).toBe('plage.mp4');
  });
  it('jamais un identifiant technique', () => {
    expect(nomLisible(undefined, '/u/2b6c1e0a-9f1d-4c3e-8a7b-1234567890ab.mp4')).toBeNull();
    expect(nomLisible('a1b2c3d4e5f60718293a4b5c.mp4', 'blob:http://x/1')).toBeNull();
    expect(nomLisible(undefined, '/u/1697712345678.mp4')).toBeNull();
  });
});

describe('message', () => {
  it('place + nom + cause, et les deux gestes', () => {
    const m: MediaManquant = { role: 'rush', url: '/u/2b6c1e0a-9f1d-4c3e-8a7b-1234567890ab.mp4', position: 2, type: 'video', nom: 'Squat.mp4', cause: 'supprime' };
    expect(libelleMediaManquant(m)).toBe('le rush 2 de la séquence Vidéo (Squat.mp4) — supprimé du stockage');
    const msg = messageMediasBloquants([m]);
    expect(msg).toMatch(/^Fichier introuvable : /);
    expect(msg).toContain('Retrouvez-le ou remplacez-le');
    expect(msg).not.toContain('2b6c1e0a');
  });
  it('sans nom lisible : la place seule, pas l’identifiant', () => {
    const msg = messageMediasBloquants([{ role: 'rush', url: 'blob:http://x/9', position: 1, cause: 'local_autre_session' }]);
    expect(msg).toContain('le rush 1 de la séquence Vidéo — fichier de votre ordinateur');
  });
  it('trierMediasMorts conserve la cause', () => {
    const t = trierMediasMorts<MediaManquant>([{ role: 'rush', url: '/a', cause: 'lien_expire' }]);
    expect(t.bloquants[0].cause).toBe('lien_expire');
  });
});

describe('Câblage Créer', () => {
  const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  it('les deux gestes existent, et « Retrouver » garde la place du média', () => {
    expect(w).toContain('Retrouver ce fichier');
    expect(w).toContain('Remplacer ce média');
    expect(w).toContain('if (remplace !== null && cible?.retrouver) { retrouverMediaListe(remplace, url, name); return; }');
    expect(w).toContain('remplacerMedia(listeMediasRef.current, i, { ...ancien, url, ...(nom ? { nom } : {}) })');
  });
  it('l’envoi s’arrête avant tout débit', () => {
    const i = w.indexOf('setMediasManquants(bloquants);');
    expect(i).toBeGreaterThan(0);
    expect(w.indexOf('return;', i)).toBeLessThan(w.indexOf('genererEtAttendreVideoJumeau(', i));
  });
});

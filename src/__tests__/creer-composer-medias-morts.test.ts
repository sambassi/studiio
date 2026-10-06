/**
 * P0 production 2026-10-06 — « Composer et envoyer » ne partait pas : le
 * brouillon restauré portait une musique (.mp3), un rush (.mp4) et un fond IA
 * (replicate.delivery) devenus introuvables, et TOUT 404 bloquait l'envoi,
 * avec un message affiché hors de vue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  urlsIntrouvables, trierMediasMorts, messageMediasBloquants, messageMediasRetires, type MediaAVerifier,
} from '@/lib/creer/medias-morts';

const statuts: Record<string, number> = {
  '/storage/v1/object/public/media/u/musique.mp3': 404,
  '/storage/v1/object/public/media/u/rush.mp4': 404,
  'https://replicate.delivery/x/fond.png': 404,
  '/storage/v1/object/public/media/u/titre.mp3': 200,
  '/expire.mp4': 410,
};
const f = (async (u: string) => {
  if (u === '/reseau-coupe.mp4') throw new Error('réseau');
  return { status: statuts[u] ?? 200 } as Response;
}) as unknown as typeof fetch;

describe('urlsIntrouvables', () => {
  it('404 et 410 = introuvables ; 200 et erreur réseau = présumés présents ; blob/data ignorés', async () => {
    const r = await urlsIntrouvables([
      ...Object.keys(statuts), '/reseau-coupe.mp4', 'blob:xyz', 'data:audio/mp3;base64,AA', null, '',
    ], f);
    expect([...r].sort()).toEqual([
      '/expire.mp4', '/storage/v1/object/public/media/u/musique.mp3', '/storage/v1/object/public/media/u/rush.mp4', 'https://replicate.delivery/x/fond.png',
    ]);
  });
  it('une seule requête par adresse (pas de boucle de 404)', async () => {
    let n = 0;
    const compte = (async () => { n += 1; return { status: 404 } as Response; }) as unknown as typeof fetch;
    await urlsIntrouvables(['/a.mp3', '/a.mp3', '/a.mp3'], compte);
    expect(n).toBe(1);
  });
});

describe('trierMediasMorts', () => {
  const morts: MediaAVerifier[] = [
    { role: 'musique', url: '/m.mp3' },
    { role: 'fond', url: 'https://replicate.delivery/x/fond.png', cle: 'titre' },
  ];
  it('musique et fond morts → retirés, AUCUN blocage (le brouillon réel du P0)', () => {
    const t = trierMediasMorts(morts);
    expect(t.bloquants).toEqual([]);
    expect(t.aRetirer.map((m) => m.role)).toEqual(['musique', 'fond']);
    expect(messageMediasRetires(t.aRetirer)).toMatch(/la musique et une image de fond/);
  });
  it('rush ou narration morts → bloquants, message clair, rien débité', () => {
    const t = trierMediasMorts([...morts, { role: 'rush', url: '/u/rush.mp4' }, { role: 'narration', url: '/u/voix.mp3' }]);
    expect(t.bloquants.map((m) => m.role)).toEqual(['rush', 'narration']);
    const msg = messageMediasBloquants(t.bloquants);
    expect(msg).toContain('un rush (rush.mp4)');
    expect(msg).toContain('une narration (voix.mp3)');
    expect(msg).toMatch(/rien n’a été composé ni débité/);
  });
});

describe('Câblage dans Créer', () => {
  const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  it('vérification AVANT la génération payante du jumeau', () => {
    expect(w.indexOf('const introuvables = await urlsIntrouvables(')).toBeLessThan(w.lastIndexOf('const video = await genererEtAttendreVideoJumeau('));
  });
  it('en mode jumeau « avatar », l’ancien rush (remplacé) n’est pas exigé', () => {
    expect(w).toContain("...(jumeauMode === 'avatar' ? [] : [plateau.rushUrl, ...rushSuivants.map((r) => r.url)]");
  });
  it('le rendu lit la musique et les fonds NETTOYÉS, jamais l’état mort', () => {
    expect(w).toContain('const rythme = musiqueRendu ? await analyserMusiqueNavigateur(musiqueRendu) : null;');
    expect(w).toContain('musicUrl: musiqueRendu || undefined,');
    expect(w).toContain('musicUrl: persistableUrl(musiqueRendu),');
    expect(w).toContain('sequenceBackgrounds: Object.keys(fondsRendu).length');
    expect(w).toContain('setMontageNotice(messageMediasRetires(aRetirer));');
  });
  it('aucun clic silencieux : le message d’erreur est amené à l’écran', () => {
    expect(w).toContain("if (error) erreurRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });");
    expect(w).toContain('<div ref={erreurRef} data-creer-erreur');
  });
});

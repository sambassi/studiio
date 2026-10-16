/**
 * M1 suite — UNE analyse par rush (panneau Qualité + export), et bornes du
 * navigateur : durée analysée ≤ 180 s, taille vérifiée AVANT de télécharger le son.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { creerMemoAnalyses, energieAudio, AUDIO_OCTETS_MAX, DUREE_ANALYSEE_MAX } from '@/lib/creer/analyse-rush';
import type { AnalyseRushQualite } from '@/lib/creer/nettete-hd';

const A = (url: string): AnalyseRushQualite => ({ url, duree: 5, echantillons: [{ t: 0, mouvement: 0, luminosite: 0.5, nettete: 0.1, audio: 0 }] });

describe('analyse mémorisée', () => {
  it('panneau puis export : UNE seule analyse, la même promesse, progression relayée aux deux', async () => {
    let progression: (f: number) => void = () => {};
    let fin: (a: AnalyseRushQualite) => void = () => {};
    const analyser = vi.fn((_u: string, p?: (f: number) => void) => { progression = p!; return new Promise<AnalyseRushQualite | null>((r) => { fin = r; }); });
    const { analyserMemo } = creerMemoAnalyses(analyser);
    const panneau = analyserMemo('u1');
    const vuesExport: number[] = [];
    const exportP = analyserMemo('u1', (f) => vuesExport.push(f));
    expect(analyser).toHaveBeenCalledTimes(1);
    progression(0.5);
    fin(A('u1'));
    const [a, b] = await Promise.all([panneau, exportP]);
    expect(a).toBe(b);
    expect(vuesExport).toEqual([0.5]);
    await analyserMemo('u1');
    expect(analyser).toHaveBeenCalledTimes(1);
  });
  it('résultat null ou erreur : purgé, un nouvel essai relance l’analyse', async () => {
    const analyser = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('x')).mockResolvedValue(A('u'));
    const { analyserMemo, taille } = creerMemoAnalyses(analyser);
    expect(await analyserMemo('u')).toBeNull();
    expect(taille()).toBe(0);
    expect(await analyserMemo('u')).toBeNull();
    expect(await analyserMemo('u')).toMatchObject({ url: 'u' });
    expect(analyser).toHaveBeenCalledTimes(3);
  });
  it('mémoire bornée', async () => {
    const { analyserMemo, taille } = creerMemoAnalyses(async (u) => A(u), 3);
    for (const u of ['a', 'b', 'c', 'd', 'e']) await analyserMemo(u);
    expect(taille()).toBe(3);
  });
});

describe('bornes navigateur', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('fichier annoncé au-delà de la limite : le son n’est PAS téléchargé (HEAD seul)', async () => {
    const f = vi.fn(async (_u: string, _init?: RequestInit) => new Response(null, { status: 200, headers: { 'content-length': String(AUDIO_OCTETS_MAX + 1) } }));
    vi.stubGlobal('fetch', f);
    expect(await energieAudio('https://x/r.mp4', 10, 0.5)).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
  });
  it('taille inconnue : chemin d’avant (lecture puis contrôle de taille) — mesures de l’export inchangées', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === 'HEAD' ? Promise.reject(new Error('pas de HEAD')) : new Response(new ArrayBuffer(8))));
    vi.stubGlobal('fetch', f);
    await energieAudio('https://x/r.mp4', 10, 0.5);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('durée analysée bornée à 180 s, comme le serveur', () => {
    expect(DUREE_ANALYSEE_MAX).toBe(180);
    expect(readFileSync('src/lib/creer/analyse-rush.ts', 'utf8')).toContain('const duree = Math.min(dureeTotale, DUREE_ANALYSEE_MAX);');
    expect(readFileSync('src/lib/creer/analyse-rush-serveur.ts', 'utf8')).toContain('const DUREE_ANALYSEE_MAX = 180;');
  });
});

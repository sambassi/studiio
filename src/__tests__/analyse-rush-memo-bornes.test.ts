/**
 * M1 suite — UNE analyse par rush (panneau Qualité + export), et bornes du
 * navigateur : durée analysée ≤ 180 s, taille vérifiée AVANT de télécharger le son.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { creerMemoAnalyses, energieAudio, dureeAnalysee, AUDIO_OCTETS_MAX, DUREE_ANALYSEE_MAX, type AnalyseNavigateur } from '@/lib/creer/analyse-rush';
import { planMontage, type EchantillonRush } from '@/lib/creer/smart-montage';
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
  it('borne 180 s : PANNEAU seulement ; l’export analyse le rush entier comme avant', () => {
    expect(DUREE_ANALYSEE_MAX).toBe(180);
    expect(dureeAnalysee(200)).toBe(200);
    expect(dureeAnalysee(200, null)).toBe(200);
    expect(dureeAnalysee(200, 180)).toBe(180);
    expect(dureeAnalysee(60, 180)).toBe(60);
    const src = readFileSync('src/lib/creer/analyse-rush.ts', 'utf8');
    expect(src).toContain('const duree = dureeAnalysee(dureeTotale, options.dureeMax);');
    // Export (Créer) : appel SANS borne.
    expect(readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8')).toMatch(/await analyserRushMemo\(rushsDurables\[i\]\.url, \(f\) => setRenderProgress\([^\n]*\)\);/);
    expect(readFileSync('src/components/creer/QualiteRushs.tsx', 'utf8')).toContain('return analyserRushMemo(url, undefined, { borne: true });');
  });
});

describe('rush > 180 s : plan d’export identique à avant M1', () => {
  /** Grille d'échantillons de `analyserRush` AVANT M1 (0d78bb2) : durée entière, pas = max(0,5 ; durée / 240). */
  const grilleAvant = (dureeTotale: number) => { const pas = Math.max(0.5, dureeTotale / 240); const ts: number[] = []; for (let i = 0, t = 0; t < dureeTotale; i++, t = i * pas) ts.push(Math.round(t * 1000) / 1000); return ts; };
  const grilleApres = (dureeTotale: number, dureeMax?: number | null) => { const d = dureeAnalysee(dureeTotale, dureeMax); const pas = Math.max(0.5, d / 240); const ts: number[] = []; for (let i = 0, t = 0; t < d; i++, t = i * pas) ts.push(Math.round(t * 1000) / 1000); return ts; };
  const analyse = (url: string, ts: number[]) => ({ url, duree: ts.length ? ts[ts.length - 1] + 0.5 : 0, echantillons: ts.map((t, i): EchantillonRush => ({ t, mouvement: 0.03 + ((i * 7) % 11) / 200, luminosite: 0.45, nettete: 0.12, audio: 0.2, empreinte: Array.from({ length: 64 }, (_, k) => ((i * 13 + k * 17) % 97) / 97) })) });
  it('200 s : même grille d’échantillons et même plan qu’avant (export sans borne)', () => {
    expect(grilleApres(200)).toEqual(grilleAvant(200));
    const avant = planMontage([analyse('a', grilleAvant(200)), analyse('b', grilleAvant(60))], 30);
    const apres = planMontage([analyse('a', grilleApres(200)), analyse('b', grilleApres(60))], 30);
    expect(JSON.stringify(apres)).toBe(JSON.stringify(avant));
    // Le panneau, lui, est borné : il ne doit donc jamais servir l'export.
    expect(grilleApres(200, 180)).not.toEqual(grilleAvant(200));
  });
  it('panneau borné sur 200 s : résultat PARTIEL, jamais réutilisé ; l’export relance une analyse entière', async () => {
    const analyser = vi.fn(async (url: string, _p?: (f: number) => void, borne?: boolean): Promise<AnalyseNavigateur> => ({ ...A(url), duree: borne ? 180 : 200, ...(borne ? { partielle: true as const } : null) }));
    const { analyserMemo } = creerMemoAnalyses(analyser);
    expect((await analyserMemo('long', undefined, { borne: true }))?.partielle).toBe(true);
    const exp = await analyserMemo('long', () => {});
    expect(exp).toMatchObject({ duree: 200 });
    expect(exp?.partielle).toBeUndefined();
    expect(analyser).toHaveBeenCalledTimes(2);
    expect(analyser.mock.calls[1][2]).toBe(false);
    // Ensuite le panneau reprend l'analyse entière (aucune 3e mesure).
    expect(await analyserMemo('long', undefined, { borne: true })).toBe(exp);
    expect(analyser).toHaveBeenCalledTimes(2);
  });
  it('rush de 60 s : UNE seule analyse partagée panneau → export', async () => {
    const analyser = vi.fn(async (url: string): Promise<AnalyseNavigateur> => ({ ...A(url), duree: 60 }));
    const { analyserMemo } = creerMemoAnalyses(analyser);
    const p = await analyserMemo('court', undefined, { borne: true });
    const e = await analyserMemo('court', () => {});
    expect(e).toBe(p);
    expect(analyser).toHaveBeenCalledTimes(1);
  });
});

/**
 * M2-a — Créer : fiches demandées au serveur, bornées, jamais bloquantes ;
 * écrites dans le post à côté du diagnostic M1, sans effet sur le plan.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { chargerFichesContenu, auPlus } from '@/lib/creer/fiche-contenu-client';
import { ficheContenuRush } from '@/lib/creer/fiche-contenu';

const U1 = '/storage/v1/object/public/media/u/library/stock-pexels-video-1.mp4';
const U2 = '/storage/v1/object/public/media/u/library/converted_2.mp4';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('chargerFichesContenu', () => {
  it('une requête GET, propriétaire = session (aucun identifiant envoyé), fiches validées', async () => {
    const fiche = ficheContenuRush({ pexels: { description: 'women dancing' } });
    const appels: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      appels.push(u);
      return new Response(JSON.stringify({ success: true, fiches: [{ url: U1, fiche }, { url: U2, fiche: { version: 9 } }, { url: 'autre', fiche }] }), { status: 200 });
    }));
    const r = await chargerFichesContenu([U1, U2, U1, 'blob:http://x/1']);
    expect(appels).toHaveLength(1);
    expect(appels[0]).toBe(`/api/creer/fiches-contenu?url=${encodeURIComponent(U1)}&url=${encodeURIComponent(U2)}`);
    expect([...r.keys()]).toEqual([U1]); // fiche invalide et URL non demandée ignorées
  });
  it('réseau en panne / 401 / aucune URL : carte vide, jamais d’exception', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await chargerFichesContenu([U1])).size).toBe(0);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"success":false}', { status: 401 })));
    expect((await chargerFichesContenu([U1])).size).toBe(0);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await chargerFichesContenu([])).size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
  it('auPlus : un serveur lent ne retient jamais l’export', async () => {
    const t0 = Date.now();
    expect(await auPlus(new Promise<number>(() => {}), 30, 7)).toBe(7);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(await auPlus(Promise.reject(new Error('x')), 30, 7)).toBe(7);
    expect(await auPlus(null, 30, 7)).toBe(7);
  });
});

describe('Créer (AssistantWizard) : branchement minimal', () => {
  const aw = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
  it('fiches demandées après les analyses, attendues au plus 1,5 s APRÈS le rendu, jamais passées au plan', () => {
    const demande = aw.indexOf('fichesCreer = chargerFichesContenu(rushsDurables.map((r) => r.url));');
    const plan = aw.indexOf('planMontageRushs = planMontage(analyses, cibleEcran, { rythme: rythmeVideo, contexte: contexteMontage });');
    const rendu = aw.indexOf('composed = await composerEtFacturer(');
    const attente = aw.indexOf('const fichesRecues = await auPlus(fichesCreer, 1500, new Map() as FichesParUrl);');
    expect(demande).toBeGreaterThan(0);
    expect(plan).toBeGreaterThan(demande);
    expect(attente).toBeGreaterThan(rendu);
    expect(aw).toContain('...decisionMontagePourMetadata(qualiteRushsCreer, contenuRushsCreer, pertinenceRushsCreer),');
    // M2-c : + 2 lectures de `fichesRecues` pour le diagnostic de pertinence (consultatif, après le rendu).
    expect(aw.match(/fichesCreer|contenuRushsCreer|fichesRecues/g)?.length).toBe(9);
  });
});

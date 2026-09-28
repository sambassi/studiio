import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chargerLutPourRendu } from '@/lib/luts/charger';
import { renderSignature } from '@/lib/creer/renderSignature';

/**
 * Lecture d'une LUT pour le rendu : la table part au compositeur, ou `null`
 * — JAMAIS une exception. Un filtre ne doit jamais faire échouer un export.
 */
const E = 'a'.repeat(64);
const REF = { empreinte: E, nom: 'teal', intensite: 0.5 };
const CUBE = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';

const reponse = (corps: string, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => corps }) as Response;

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('chargerLutPourRendu', () => {
  it('lit la LUT par la route authentifiée de son empreinte, sans cache', async () => {
    const f = vi.fn(async () => reponse(CUBE));
    const r = await chargerLutPourRendu(REF, { fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(`/api/creatif/luts/${E}`, { method: 'GET', cache: 'no-store' });
    expect(r?.intensity).toBe(0.5);
    expect(r?.lut.kind).toBe('3d');
    expect(r?.lut.size).toBe(2);
    expect(r?.lut.table.length).toBe(24);
  });

  it('sans référence : null, et aucun appel réseau', async () => {
    const f = vi.fn();
    expect(await chargerLutPourRendu(null, { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(await chargerLutPourRendu(undefined, { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('intensité nulle : rendu brut, rien à télécharger', async () => {
    const f = vi.fn();
    expect(await chargerLutPourRendu({ ...REF, intensite: 0 }, { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('empreinte invalide : null, sans construire d’URL avec', async () => {
    const f = vi.fn();
    expect(await chargerLutPourRendu({ ...REF, empreinte: '../../etc' }, { fetch: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('intensité hors plage : bornée', async () => {
    const f = vi.fn(async () => reponse(CUBE));
    const r = await chargerLutPourRendu({ ...REF, intensite: 3 }, { fetch: f as unknown as typeof fetch });
    expect(r?.intensity).toBe(1);
  });

  it.each([
    ['404', () => reponse('{"ok":false}', 404)],
    ['503 socle absent', () => reponse('{"ok":false}', 503)],
    ['cube tronqué', () => reponse('LUT_3D_SIZE 2\n0 0 0\n')],
    ['texte quelconque', () => reponse('<html>oops</html>')],
  ])('%s : null, jamais une exception', async (_nom, rep) => {
    const f = vi.fn(async () => rep());
    await expect(chargerLutPourRendu(REF, { fetch: f as unknown as typeof fetch })).resolves.toBeNull();
  });

  it('réseau coupé : null, jamais une exception', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(chargerLutPourRendu(REF, { fetch: f as unknown as typeof fetch })).resolves.toBeNull();
  });
});

/**
 * La signature du montage (réutilisation de l'aperçu à l'export) doit voir
 * le filtre : changer de LUT, ou d'intensité, invalide le montage déjà payé.
 */
describe('signature du rendu — le filtre en fait partie', () => {
  const lut = (v: number) => ({
    kind: '3d', size: 2, table: new Float32Array(24).fill(v),
    domainMin: [0, 0, 0], domainMax: [1, 1, 1],
  });

  it('même table, même intensité : même signature', () => {
    expect(renderSignature({ rushLut: { lut: lut(0.5), intensity: 1 } }))
      .toBe(renderSignature({ rushLut: { lut: lut(0.5), intensity: 1 } }));
  });

  it('⚠️ une autre table de même taille change la signature', () => {
    expect(renderSignature({ rushLut: { lut: lut(0.5), intensity: 1 } }))
      .not.toBe(renderSignature({ rushLut: { lut: lut(0.25), intensity: 1 } }));
  });

  it('une autre intensité change la signature', () => {
    expect(renderSignature({ rushLut: { lut: lut(0.5), intensity: 1 } }))
      .not.toBe(renderSignature({ rushLut: { lut: lut(0.5), intensity: 0.5 } }));
  });

  it('la table reste compacte dans la signature (pas un objet de 800 000 clés)', () => {
    const grosse = new Float32Array(65 ** 3 * 3);
    const sig = renderSignature({ rushLut: { lut: { ...lut(0), size: 65, table: grosse }, intensity: 1 } });
    expect(sig.length).toBeLessThan(500);
  });

  it('sans filtre : la signature est celle d’avant (aucune clé ajoutée)', () => {
    expect(renderSignature({ title: 'T', videoUrl: 'u' })).toBe('{"title":"T","videoUrl":"u"}');
  });
});

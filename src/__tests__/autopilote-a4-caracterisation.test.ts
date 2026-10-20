/**
 * A4 — CARACTÉRISATION : les montages SANS jumeau (et le script de l'avatar
 * monté avec d'autres sources) restent identiques à l'octet. Empreintes
 * relevées sur la base 9f85d63, AVANT la correction A4.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG } from '@/lib/autopilot/rules';
import { versEntreeRemotion } from '@/lib/render/spec-rendu';
import { scriptPourDuree } from '@/lib/autopilot/duree-cible';

const h = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

function cas() {
  const out: Record<string, unknown> = {};
  const voix = { titre: { url: 'v1', seconds: 4 }, cartes: { url: 'v2', seconds: 6 }, video: { url: 'v4', seconds: 5 }, cta: { url: 'v3', seconds: 2 } } as never;
  for (const duree of [undefined, 15, 30, 45, 60]) {
    for (const rush of [false, true]) {
      const brief = duree ? { duree } : {};
      const [post] = preparePosts({ config: { ...DEFAULT_CONFIG, rushUrls: rush ? ['https://x/r.mp4'] : [], brief }, topic: 'finance', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
      for (const avecVoix of [false, true]) {
        const d = buildAutopilotDesign(post, { rushSeconds: rush ? 20 : null, voices: avecVoix ? voix : undefined, posterUrl: 'https://x/p.jpg' });
        out[`d${duree}-r${rush}-v${avecVoix}`] = [d, versEntreeRemotion(d)];
      }
      out[`script${duree}-r${rush}`] = scriptPourDuree({ titre: post.title, sousTitre: post.content.subtitle, cartes: post.content.cards, cta: post.content.tagLine, brief });
    }
  }
  return out;
}

describe('A4 — caractérisation sans jumeau', () => {
  it('montages sans jumeau et script complet identiques à l’octet', () => {
    const c = cas();
    const empreintes = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, h(v)]));
    expect(empreintes).toMatchInlineSnapshot(`
      {
        "d15-rfalse-vfalse": "89d661f3ca294e09",
        "d15-rfalse-vtrue": "3c6213e8ec3c6072",
        "d15-rtrue-vfalse": "7ec86d14ff81f17b",
        "d15-rtrue-vtrue": "d75d9573fe9bcf85",
        "d30-rfalse-vfalse": "7a22366b215a6249",
        "d30-rfalse-vtrue": "a9fdc795774b1fc9",
        "d30-rtrue-vfalse": "1c19ab913c9dc7ee",
        "d30-rtrue-vtrue": "2b1bd7e84464b3cb",
        "d45-rfalse-vfalse": "1696772e0b3cac7a",
        "d45-rfalse-vtrue": "38576e35a6ed6c07",
        "d45-rtrue-vfalse": "ea5c75325cc5d713",
        "d45-rtrue-vtrue": "acef26d44120322f",
        "d60-rfalse-vfalse": "ced21a5e48f42d3e",
        "d60-rfalse-vtrue": "fe3a01de0db3c61a",
        "d60-rtrue-vfalse": "da825e97ae3a896b",
        "d60-rtrue-vtrue": "2759b64801c17f87",
        "dundefined-rfalse-vfalse": "ced21a5e48f42d3e",
        "dundefined-rfalse-vtrue": "5acb603a7b192d6c",
        "dundefined-rtrue-vfalse": "bc6fe686112bdf3f",
        "dundefined-rtrue-vtrue": "af2d97d38ce08267",
        "script15-rfalse": "15a9e75cda2305cd",
        "script15-rtrue": "15a9e75cda2305cd",
        "script30-rfalse": "e119e0527ee4227b",
        "script30-rtrue": "e119e0527ee4227b",
        "script45-rfalse": "42d8b04f3e9909bc",
        "script45-rtrue": "42d8b04f3e9909bc",
        "script60-rfalse": "ca66656f5bc1af41",
        "script60-rtrue": "ca66656f5bc1af41",
        "scriptundefined-rfalse": "74234e98afe7498f",
        "scriptundefined-rtrue": "74234e98afe7498f",
      }
    `);
  });
});

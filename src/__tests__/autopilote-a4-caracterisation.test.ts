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
        "d15-rfalse-vfalse": "9c3f985200a6b5e3",
        "d15-rfalse-vtrue": "0bd6531637b32d1f",
        "d15-rtrue-vfalse": "8d706f6ad63c20fa",
        "d15-rtrue-vtrue": "ac04239d8e6b789d",
        "d30-rfalse-vfalse": "ae4d69526d660df3",
        "d30-rfalse-vtrue": "322f48b6c127ec1d",
        "d30-rtrue-vfalse": "2b84d5ad3d31e874",
        "d30-rtrue-vtrue": "ff16ef460f818535",
        "d45-rfalse-vfalse": "d51bd34badb39a76",
        "d45-rfalse-vtrue": "e41732f4397557ef",
        "d45-rtrue-vfalse": "5d8e0ebd8165e682",
        "d45-rtrue-vtrue": "fe2b51c8102d8b29",
        "d60-rfalse-vfalse": "d51bd34badb39a76",
        "d60-rfalse-vtrue": "e41732f4397557ef",
        "d60-rtrue-vfalse": "5d8e0ebd8165e682",
        "d60-rtrue-vtrue": "fe2b51c8102d8b29",
        "dundefined-rfalse-vfalse": "d51bd34badb39a76",
        "dundefined-rfalse-vtrue": "24cf52a99ecbde8f",
        "dundefined-rtrue-vfalse": "ea8ff35e094f94b7",
        "dundefined-rtrue-vtrue": "4c9e6b85ebde901f",
        "script15-rfalse": "fc6b492a0275a9f4",
        "script15-rtrue": "fc6b492a0275a9f4",
        "script30-rfalse": "a7715ce75725c157",
        "script30-rtrue": "a7715ce75725c157",
        "script45-rfalse": "c1f045737cf33914",
        "script45-rtrue": "c1f045737cf33914",
        "script60-rfalse": "ebe43661063878f2",
        "script60-rtrue": "ebe43661063878f2",
        "scriptundefined-rfalse": "74234e98afe7498f",
        "scriptundefined-rtrue": "74234e98afe7498f",
      }
    `);
  });
});

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
        "d15-rfalse-vfalse": "64d312428a396997",
        "d15-rfalse-vtrue": "db207ebe43cf4236",
        "d15-rtrue-vfalse": "0114d09ea84b9e55",
        "d15-rtrue-vtrue": "aab14d19bbe14ae5",
        "d30-rfalse-vfalse": "5cbc8963f3962aec",
        "d30-rfalse-vtrue": "4e2d85eb1d001438",
        "d30-rtrue-vfalse": "bb98d906b84a3b1c",
        "d30-rtrue-vtrue": "2b79ca4f6062de70",
        "d45-rfalse-vfalse": "6c21d346a4aaed3b",
        "d45-rfalse-vtrue": "06bf8f078ee0ed5e",
        "d45-rtrue-vfalse": "7c9056d8553d6c6f",
        "d45-rtrue-vtrue": "a05ea1e1e210ec4f",
        "d60-rfalse-vfalse": "bb480c0498f94033",
        "d60-rfalse-vtrue": "861d55d23f7e8cb5",
        "d60-rtrue-vfalse": "b9cdd002d6ff2e55",
        "d60-rtrue-vtrue": "ae4e633c58ad39c6",
        "dundefined-rfalse-vfalse": "bb480c0498f94033",
        "dundefined-rfalse-vtrue": "212b28b23406f77d",
        "dundefined-rtrue-vfalse": "d4d70fb68106feb3",
        "dundefined-rtrue-vtrue": "1c84fdd1779fcfbd",
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

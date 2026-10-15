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
        "d15-rfalse-vfalse": "eb114dc15a671beb",
        "d15-rfalse-vtrue": "d624d2cb5af1aba1",
        "d15-rtrue-vfalse": "5eee354e88ae6571",
        "d15-rtrue-vtrue": "75db1af237a2c570",
        "d30-rfalse-vfalse": "4db4de49cb5e912e",
        "d30-rfalse-vtrue": "c1ff7656a9e1e1bb",
        "d30-rtrue-vfalse": "1fd2ea5095c5488f",
        "d30-rtrue-vtrue": "a35b2facde75b0df",
        "d45-rfalse-vfalse": "d4c3c8cd2356c22d",
        "d45-rfalse-vtrue": "c06ccaadc86187a0",
        "d45-rtrue-vfalse": "e1a8ba1e653a92d4",
        "d45-rtrue-vtrue": "91f01bc66eb30425",
        "d60-rfalse-vfalse": "d5cc4c56378e0152",
        "d60-rfalse-vtrue": "010704436c4d13ee",
        "d60-rtrue-vfalse": "1e1f79cabd6b34ff",
        "d60-rtrue-vtrue": "e6f3955c171d446e",
        "dundefined-rfalse-vfalse": "d5cc4c56378e0152",
        "dundefined-rfalse-vtrue": "3468f9787fdc83d3",
        "dundefined-rtrue-vfalse": "1b9c4e40a736cd5d",
        "dundefined-rtrue-vtrue": "0d328505d29370a4",
        "script15-rfalse": "c73f5b5c0600da12",
        "script15-rtrue": "c73f5b5c0600da12",
        "script30-rfalse": "678c578943f47bc0",
        "script30-rtrue": "678c578943f47bc0",
        "script45-rfalse": "ac4cba5ea15ed193",
        "script45-rtrue": "ac4cba5ea15ed193",
        "script60-rfalse": "d0e7751485d79d73",
        "script60-rtrue": "d0e7751485d79d73",
        "scriptundefined-rfalse": "74234e98afe7498f",
        "scriptundefined-rtrue": "74234e98afe7498f",
      }
    `);
  });
});

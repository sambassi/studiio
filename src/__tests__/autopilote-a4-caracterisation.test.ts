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
        "d15-rfalse-vfalse": "09cbcd00a7f25b8f",
        "d15-rfalse-vtrue": "08af5747f2faccf9",
        "d15-rtrue-vfalse": "358b34ee04b7d13a",
        "d15-rtrue-vtrue": "6e7e90085ec778bc",
        "d30-rfalse-vfalse": "0c9afe78750caa36",
        "d30-rfalse-vtrue": "af2b7777b6ab8395",
        "d30-rtrue-vfalse": "e6ebc2606ff5aadb",
        "d30-rtrue-vtrue": "c8f83d5c4c58fde6",
        "d45-rfalse-vfalse": "0958498e8239cc89",
        "d45-rfalse-vtrue": "362175617c0b0734",
        "d45-rtrue-vfalse": "cc095ee1664787cb",
        "d45-rtrue-vtrue": "3b5c76a551c136af",
        "d60-rfalse-vfalse": "e7b73709e5c47fe1",
        "d60-rfalse-vtrue": "868121e354797bf6",
        "d60-rtrue-vfalse": "b52883773a0a4767",
        "d60-rtrue-vtrue": "2fafd1719eaa3d2a",
        "dundefined-rfalse-vfalse": "e7b73709e5c47fe1",
        "dundefined-rfalse-vtrue": "3f023965b413415c",
        "dundefined-rtrue-vfalse": "b672a628d1458d56",
        "dundefined-rtrue-vtrue": "c4c4cc1f4eb7ec56",
        "script15-rfalse": "b81fdd1fd0c1853d",
        "script15-rtrue": "b81fdd1fd0c1853d",
        "script30-rfalse": "858439e23dc2cc70",
        "script30-rtrue": "858439e23dc2cc70",
        "script45-rfalse": "7b3765a1eae8ada5",
        "script45-rtrue": "7b3765a1eae8ada5",
        "script60-rfalse": "04784d448184d2ed",
        "script60-rtrue": "04784d448184d2ed",
        "scriptundefined-rfalse": "74234e98afe7498f",
        "scriptundefined-rtrue": "74234e98afe7498f",
      }
    `);
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Garanties de COÛT de POST /api/voice/prononciations/suggestion :
 * Anthropic jamais appelé quand la règle locale est sûre ; panne
 * (fetch jette / 5xx / délai dépassé) → suggestion locale ; limites
 * 10/min et 60/h par compte (429) ; longueur bornée à 80. Anthropic MOCKÉ.
 */

const session = vi.hoisted(() => ({ courante: { user: { id: 'u' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

type Mode = 'ok' | 'jette' | '500' | 'bloque';
const reseau = vi.hoisted(() => ({ anthropic: 0, autres: [] as string[], mode: 'ok' as 'ok' | 'jette' | '500' | 'bloque' }));

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u !== 'https://api.anthropic.com/v1/messages') { reseau.autres.push(u); throw new Error(`fetch inattendu ${u}`); }
  reseau.anthropic += 1;
  const mode: Mode = reseau.mode;
  if (mode === 'jette') throw new TypeError('fetch failed');
  if (mode === '500') return new Response('erreur', { status: 503 });
  if (mode === 'bloque') {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('abort')));
    });
  }
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Afro-boust' }] }), { status: 200 });
}) as unknown as typeof fetch;

const { POST } = await import('@/app/api/voice/prononciations/suggestion/route');

const post = (affiche: unknown) =>
  POST(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ affiche }) }));

let n = 0;
beforeEach(() => {
  n += 1;
  session.courante = { user: { id: `cout-${n}` } };
  reseau.anthropic = 0; reseau.autres.length = 0; reseau.mode = 'ok';
  process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('route suggestion — coût', () => {
  it('(6a) locale sûre : jamais d’appel Anthropic, même répété (et sans consommer le quota)', async () => {
    for (let i = 0; i < 15; i += 1) {
      const res = await post('3-en-1 OS RENFORCÉS');
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ suggestion: 'trois en un os renforcés', source: 'locale' });
    }
    expect(reseau.anthropic).toBe(0);
    // Le quota n'a pas été entamé : un cas difficile passe encore.
    expect((await (await post('Afroboost')).json()).data.source).toBe('ia');
  });

  it('(6b) Anthropic jette : suggestion locale, 200', async () => {
    reseau.mode = 'jette';
    const res = await post('ADN');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ suggestion: 'A D N', source: 'locale' });
    expect(reseau.anthropic).toBe(1);
  });

  it('(6c) Anthropic 5xx : suggestion locale, 200', async () => {
    reseau.mode = '500';
    const res = await post('Afroboost');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ suggestion: null, source: 'aucune', message: 'Aucune suggestion de prononciation différente trouvée.' });
  });

  it('(6d/7) délai de 10 s : au-delà, la requête est abandonnée et la suggestion locale rendue', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('délai', 'TimeoutError')), ms);
      return c.signal;
    });
    reseau.mode = 'bloque';
    let fini = false;
    const p = post('Afroboost').then((r) => { fini = true; return r; });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await p;
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ suggestion: null, source: 'aucune', message: 'Aucune suggestion de prononciation différente trouvée.' });
  });

  it('(7) 10 par minute par compte → 429 + Retry-After, sans appel Anthropic ; un autre compte n’est pas touché', async () => {
    for (let i = 0; i < 10; i += 1) expect((await post('Afroboost')).status).toBe(200);
    const refus = await post('Afroboost');
    expect(refus.status).toBe(429);
    expect(Number(refus.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(reseau.anthropic).toBe(10);
    session.courante = { user: { id: `autre-${n}` } };
    expect((await post('Afroboost')).status).toBe(200);
  });

  it('(7) 60 par heure par compte → 429 même en respectant 10/min', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'));
    for (let m = 0; m < 6; m += 1) {
      for (let i = 0; i < 10; i += 1) expect((await post('Afroboost')).status).toBe(200);
      vi.setSystemTime(Date.now() + 61_000);
    }
    const refus = await post('Afroboost');
    expect(refus.status).toBe(429);
    expect(Number(refus.headers.get('Retry-After'))).toBeGreaterThan(60);
    expect(reseau.anthropic).toBe(60);
  });

  it('(7) longueur : 80 caractères acceptés, 81 → 400 sans appel Anthropic', async () => {
    expect((await post('Z'.repeat(80).toLowerCase().replace(/^z/, 'Z'))).status).toBe(200);
    const avant = reseau.anthropic;
    const res = await post('Zorglub'.padEnd(81, 'x'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('trop_long');
    expect(reseau.anthropic).toBe(avant);
    expect(reseau.autres).toEqual([]);
  });
});

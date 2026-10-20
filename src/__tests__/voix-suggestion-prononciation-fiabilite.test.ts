// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * « Suggérer » — FIABILITÉ : une suggestion n'est rendue que si elle
 * change vraiment la prononciation, de façon plausible.
 *  - « lien en bio » → aucune (et aucun appel au modèle) ;
 *  - « lien en bioo » (micro-variation) → rejetée ;
 *  - « 3 séances » → « trois séances » acceptée ; sigle « HIIT » géré ;
 *  - réponse « AUCUNE » du modèle → aucune.
 * Anthropic est MOCKÉ : aucun appel réseau réel.
 */
const reseau = vi.hoisted(() => ({ anthropic: [] as Array<{ content: string; system: string }>, texte: 'AUCUNE' }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: `fiab-${Math.random()}` } }) }));
globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  if (String(url) !== 'https://api.anthropic.com/v1/messages') throw new Error(`fetch inattendu ${String(url)}`);
  const b = JSON.parse(String(init?.body));
  reseau.anthropic.push({ content: b.messages[0].content, system: b.system });
  return new Response(JSON.stringify({ content: [{ type: 'text', text: reseau.texte }] }), { status: 200 });
}) as unknown as typeof fetch;

const {
  suggestionUtile, clePhonetique, distanceEdition, expressionOrdinaire, suggererPrononciationLocale,
  nettoyerSuggestion, MESSAGE_AUCUNE_SUGGESTION,
} = await import('@/lib/voice/suggestion-prononciation');
const { POST } = await import('@/app/api/voice/prononciations/suggestion/route');
const post = async (affiche: string) => (await POST(new NextRequest('https://studiio.pro/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ affiche }),
}))).json();

beforeEach(() => {
  reseau.anthropic.length = 0;
  reseau.texte = 'AUCUNE';
  process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
});

describe('clé phonétique grossière et distance', () => {
  it('minuscules, sans accents, ponctuation, tirets, espaces ; lettres doublées réduites', () => {
    expect(clePhonetique('Lien-en  bioo !')).toBe('lienenbio');
    expect(clePhonetique('lien en bio')).toBe('lienenbio');
    expect(clePhonetique('Séances')).toBe('seances');
  });
  it('Levenshtein', () => {
    expect(distanceEdition('chat', 'chats')).toBe(1);
    expect(distanceEdition('', 'abc')).toBe(3);
    expect(distanceEdition('kitten', 'sitting')).toBe(3);
  });
});

describe('suggestionUtile — filtre de fiabilité', () => {
  it('« lien en bio » → aucune ; « bioo » et autres micro-variations rejetées', () => {
    expect(suggestionUtile('lien en bio', 'lien en bio')).toBeNull();
    expect(suggestionUtile('lien en bio', 'lien en bioo')).toBeNull();
    expect(suggestionUtile('lien en bio', 'Lien-en-bio')).toBeNull();
    expect(suggestionUtile('lien en bio', 'lien an bio')).toBeNull(); // d = 1
  });
  it('chiffres : « 3 séances » → « trois séances » accepté', () => {
    expect(suggestionUtile('3 séances', 'trois séances')).toBe('trois séances');
    expect(suggererPrononciationLocale('3 séances').suggestion).toBe('trois séances');
    expect(suggestionUtile('-33 %', 'moins trente-trois pour cent')).toBe('moins trente-trois pour cent');
  });
  it('sigles : « HIIT » → « hit » et « ADN » → « A D N » acceptés malgré la même clé', () => {
    expect(suggestionUtile('HIIT', 'hit')).toBe('hit');
    expect(suggestionUtile('ADN', 'A D N')).toBe('A D N');
    expect(suggererPrononciationLocale('séance HIIT').suggestion).toBe('séance hit');
  });
  it('non plausible : ratio > 0,8 ou plus de deux fois plus de mots → aucune', () => {
    expect(suggestionUtile('Afroboost', 'xyz')).toBeNull();
    expect(suggestionUtile('Afroboost', 'le club de danse afro de Genève')).toBeNull();
    // Avec chiffre : une forme démesurée reste refusée.
    expect(suggestionUtile('3', 'trois ' + 'mots '.repeat(10))).toBeNull();
  });
  it('réponse « AUCUNE » → aucune', () => {
    expect(suggestionUtile('Afroboost', 'AUCUNE')).toBeNull();
    expect(nettoyerSuggestion('AUCUNE', 'Afroboost')).toBeNull();
    expect(nettoyerSuggestion('Aucune.', 'Afroboost')).toBeNull();
  });
  it('une vraie forme dite d’un nom propre est gardée', () => {
    expect(suggestionUtile('Worcestershire', 'Wousteur-chire')).toBe('Wousteur-chire');
  });
  it('expression ordinaire : minuscules, sans chiffre ni sigle ni nom propre', () => {
    expect(expressionOrdinaire('lien en bio')).toBe(true);
    expect(expressionOrdinaire('3 séances')).toBe(false);
    expect(expressionOrdinaire('HIIT')).toBe(false);
    expect(expressionOrdinaire('Afroboost')).toBe(false);
  });
  it('message UI', () => {
    expect(MESSAGE_AUCUNE_SUGGESTION).toBe('Aucune suggestion fiable — vous pouvez saisir la prononciation vous-même.');
  });
});

describe('route — appels au modèle', () => {
  it('« lien en bio » : aucune suggestion et AUCUN appel au modèle, même avec la clé', async () => {
    reseau.texte = 'lien en bioo';
    const r = await post('lien en bio');
    expect(r.data).toEqual({ suggestion: null, source: 'aucune', message: MESSAGE_AUCUNE_SUGGESTION });
    expect(reseau.anthropic).toHaveLength(0);
  });
  it('le modèle répond « AUCUNE » → aucune ; la consigne le prévoit', async () => {
    const r = await post('Afroboost');
    expect(r.data.suggestion).toBeNull();
    expect(reseau.anthropic).toHaveLength(1);
    expect(reseau.anthropic[0].system).toContain('réponds exactement AUCUNE');
    // Aucune « proposition automatique » identique au texte n'est envoyée.
    expect(reseau.anthropic[0].content).not.toContain('Proposition automatique');
  });
  it('le modèle renvoie une micro-variation (« Afroboostt ») → rejetée', async () => {
    reseau.texte = 'Afroboostt';
    expect((await post('Afroboost')).data.suggestion).toBeNull();
  });
  it('« 3 séances » : suggestion locale sûre, sans modèle', async () => {
    const r = await post('3 séances');
    expect(r.data).toEqual({ suggestion: 'trois séances', source: 'locale' });
    expect(reseau.anthropic).toHaveLength(0);
  });
  it('sigle inconnu : la proposition locale DIFFÉRENTE est jointe au modèle', async () => {
    reseau.texte = 'AUCUNE';
    const r = await post('ADN');
    expect(r.data).toEqual({ suggestion: 'A D N', source: 'locale' });
    expect(reseau.anthropic[0].content).toContain('Proposition automatique : A D N');
  });
});

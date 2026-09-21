import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `/api/content/ai-generate` et le brief de la vidéo.
 *
 * Le brief (objectif, message, public, CTA) doit atteindre le PROMPT du
 * modèle — et un appel sans brief doit envoyer EXACTEMENT le prompt d'avant.
 * Anthropic est doublé : on lit ce que la route lui envoie.
 */

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {} }));

/** Corps envoyés à Anthropic, dans l'ordre. */
const envois: Array<Record<string, unknown>> = [];

const reponseModele = (texte: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ content: [{ type: 'text', text: texte }] }),
  text: async () => '',
}) as unknown as Response;

const CONTENU = JSON.stringify({
  title: 'ÉNERGIE EXPRESS',
  subtitle: 'Bouger fait du bien',
  cards: [{ iconName: 'Zap', label: 'ÉNERGIE', value: '+30%', description: 'Plus de pêche au quotidien.' }],
  salesPhrases: ['a', 'b', 'c', 'd', 'e'],
  pexelsQuery: 'dance class',
});

beforeEach(() => {
  envois.length = 0;
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    envois.push(JSON.parse(String(init?.body ?? '{}')));
    return reponseModele(CONTENU);
  }) as unknown as typeof fetch;
});

const { POST } = await import('@/app/api/content/ai-generate/route');

const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const promptUtilisateur = (i = 0) =>
  String((envois[i].messages as Array<{ content: string }>)[0].content);

const BRIEF = {
  objectif: 'Donner envie de découvrir Afroboost à Neuchâtel et réserver un cours d’essai.',
  message: 'Un cours accessible qui donne de l’énergie.',
  public: 'Adultes de Neuchâtel.',
  cta: 'Réservez votre cours d’essai.',
};

describe('Génération de contenu — le brief dans le prompt', () => {
  it('avec brief : le prompt le contient, champ par champ', async () => {
    const { status, body } = await post({ topic: 'danse', cardCount: 1, brief: BRIEF });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const p = promptUtilisateur();
    expect(p).toContain(BRIEF.objectif);
    expect(p).toContain(BRIEF.message);
    expect(p).toContain(BRIEF.public);
    expect(p).toContain(BRIEF.cta);
    expect(p).toContain('BRIEF DE LA VIDÉO');
  });

  it('sans brief : le prompt est INCHANGÉ — identique à un appel avec un brief vide', async () => {
    await post({ topic: 'danse', cardCount: 1, variationNonce: 'n1' });
    await post({ topic: 'danse', cardCount: 1, variationNonce: 'n1', brief: {} });
    await post({ topic: 'danse', cardCount: 1, variationNonce: 'n1', brief: 'texte' });
    expect(promptUtilisateur(0)).not.toContain('BRIEF');
    expect(promptUtilisateur(1)).toBe(promptUtilisateur(0));
    expect(promptUtilisateur(2)).toBe(promptUtilisateur(0));
    // Et le système non plus.
    expect(envois[1].system).toBe(envois[0].system);
  });

  it('un champ seul suffit, et un brief trop long est borné', async () => {
    await post({ topic: 'danse', cardCount: 1, brief: { cta: 'x'.repeat(1000) } });
    const p = promptUtilisateur();
    expect(p).toContain('x'.repeat(300));
    expect(p).not.toContain('x'.repeat(301));
    expect(p).not.toContain('Objectif de la vidéo');
  });

  it('le script voix-off (fieldType tts) reçoit aussi le brief, et garde la consigne JSON en dernier', async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      envois.push(JSON.parse(String(init?.body ?? '{}')));
      return reponseModele('{"text":"Venez danser à Neuchâtel."}');
    }) as unknown as typeof fetch;
    const { body } = await post({ topic: 'danse', fieldType: 'tts', brief: BRIEF });
    expect(body.success).toBe(true);
    const p = promptUtilisateur();
    expect(p).toContain(BRIEF.objectif);
    expect(p.trim().endsWith('{"text":"..."}')).toBe(true);
  });
});

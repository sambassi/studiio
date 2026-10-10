/**
 * Génération d'image — la demande de l'utilisateur est respectée.
 *
 * Causes trouvées dans ce qui partait réellement au générateur
 * (`/api/ai/image`, action `generate-bg`) :
 *  - texte → image : la demande était suivie de « professional background »
 *    — le modèle produisait un décor vide au lieu de la personne demandée ;
 *  - « partir de ma photo » : la demande passait dans une substitution mot à
 *    mot français → anglais (`personne` → `person`, `fond` → `background`…)
 *    qui la rendait bancale ;
 *  - aucun bouton pour détailler une demande courte.
 *
 * Verrouillé ici, sans aucun appel réel (générateur, stockage, crédits et
 * modèle texte doublés) :
 *  1. le prompt FINAL envoyé au générateur contient la demande d'origine mot
 *     pour mot, EN TÊTE, et chacun de ses éléments essentiels ;
 *  2. « Détailler avec l'IA » : une proposition qui perd un élément est écartée
 *     par le serveur ; une proposition fidèle est AFFICHÉE avant génération,
 *     et c'est elle — une fois acceptée — qui part au générateur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  termesEssentiels,
  termesManquants,
  verifierPromptDetaille,
  construirePromptTexteImage,
  construirePromptReferenceImage,
} from '@/lib/ai/prompt-image';

const runMock = vi.fn();
const authMock = vi.fn();
vi.mock('replicate', () => ({ default: class { run = runMock; } }));
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 100,
  deductCredits: async () => true,
}));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: () => {}, reportServiceAlert: () => {} }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: 'x' }, error: null }),
        remove: async () => ({ data: [], error: null }),
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${p}` } }),
      }),
    },
  },
  supabase: {},
}));

const { POST: postImage } = await import('@/app/api/ai/image/route');
const { POST: postTexte } = await import('@/app/api/content/ai-generate/route');
const { default: AfficheIA } = await import('@/components/creer/AfficheIA');

const DEMANDE = 'Une femme noire de 30 ans en tenue de sport rose, qui danse dans un studio avec des miroirs, tenant une bouteille d’eau, style photo réaliste, format vertical';

const webp = () => {
  const b = new Uint8Array(64);
  b.set([0x52, 0x49, 0x46, 0x46, 0x38, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 0);
  return { blob: async () => new Blob([b as BlobPart]), url: () => new URL('https://replicate.delivery/x.webp') };
};

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = 'r8_test';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  runMock.mockResolvedValue([webp()]);
  spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
});
afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  cleanup();
});

/** Le prompt réellement transmis au générateur lors du dernier appel. */
const promptEnvoye = (): string => String(runMock.mock.calls.at(-1)?.[1]?.input?.prompt ?? '');

describe('Ce qui part au générateur garde la demande', () => {
  it('texte → image : demande mot pour mot, en tête, sans « professional background »', async () => {
    const res = await postImage({ json: async () => ({ action: 'generate-bg', prompt: DEMANDE, format: '9:16' }) } as never);
    expect(res.status).toBe(200);
    const envoye = promptEnvoye();
    expect(envoye.startsWith(DEMANDE)).toBe(true);
    expect(envoye).not.toMatch(/professional background/i);
    expect(termesManquants(DEMANDE, envoye)).toEqual([]);
    // Le format reste un paramètre du générateur, pas un mot du prompt.
    expect(runMock.mock.calls.at(-1)?.[1]?.input?.aspect_ratio).toBe('9:16');
  });

  it('« partir de ma photo » : demande intacte (aucune substitution mot à mot)', async () => {
    const res = await postImage({ json: async () => ({ action: 'generate-bg', prompt: DEMANDE, format: '9:16', imageUrl: 'https://studiio.pro/ref.jpg' }) } as never);
    expect(res.status).toBe(200);
    const envoye = promptEnvoye();
    expect(envoye.startsWith(DEMANDE)).toBe(true);
    expect(termesManquants(DEMANDE, envoye)).toEqual([]);
    expect(runMock.mock.calls.at(-1)?.[1]?.input?.input_image).toBe('https://studiio.pro/ref.jpg');
  });

  it('constructeurs purs : la demande est toujours la première chose lue', () => {
    expect(construirePromptTexteImage(`  ${DEMANDE} `).startsWith(DEMANDE)).toBe(true);
    expect(construirePromptReferenceImage(DEMANDE).startsWith(DEMANDE)).toBe(true);
  });
});

describe('Relevé des éléments essentiels', () => {
  it('sujet, personne, tenue, action, décor, accessoire, style, format', () => {
    const t = termesEssentiels(DEMANDE);
    for (const m of ['femme', 'noire', '30', 'tenue', 'sport', 'rose', 'danse', 'studio', 'miroirs', 'bouteille', 'eau', 'realiste', 'vertical']) {
      expect(t).toContain(m);
    }
  });

  it('un élément changé ou retiré est détecté ; accents et accords tolérés', () => {
    expect(termesManquants('une femme en robe rouge', 'un homme en costume rouge, lumière douce')).toEqual(['femme', 'robe']);
    expect(termesManquants('baskets blanches', 'Baskets blanches, éclairage studio')).toEqual([]);
    expect(termesManquants('femme âgée', 'femme agee souriante')).toEqual([]);
  });

  it('verdict : fidèle → accepté ; perte d’élément / trop long / vide → écarté', () => {
    expect(verifierPromptDetaille(DEMANDE, `${DEMANDE}, lumière douce, plan américain`)).toMatchObject({ ok: true });
    expect(verifierPromptDetaille(DEMANDE, DEMANDE.replace('femme', 'homme'))).toMatchObject({ ok: false, motif: 'manquants', manquants: ['femme'] });
    expect(verifierPromptDetaille(DEMANDE, `${DEMANDE} ${'x'.repeat(1000)}`)).toMatchObject({ ok: false, motif: 'trop-long' });
    expect(verifierPromptDetaille(DEMANDE, '  ')).toMatchObject({ ok: false, motif: 'vide' });
  });
});

describe('« Détailler avec l’IA » — route (modèle texte doublé)', () => {
  const repondre = (texte: string) => {
    const envois: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      envois.push(String(JSON.parse(String(init?.body ?? '{}')).messages?.[0]?.content ?? ''));
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ text: texte }) }] }), text: async () => '' } as unknown as Response;
    }) as unknown as typeof fetch;
    return envois;
  };
  const detailler = async (sourceText: string) => {
    const res = await postTexte({ json: async () => ({ fieldType: 'promptImage', topic: 'x', sourceText }) } as never);
    return { status: res.status, body: await res.json() };
  };

  it('proposition fidèle → renvoyée ; la consigne cite la demande et interdit d’en retirer', async () => {
    const envois = repondre(`${DEMANDE}, lumière naturelle douce, plan américain, faible profondeur de champ`);
    const { status, body } = await detailler(DEMANDE);
    expect(status).toBe(200);
    expect(body.text.startsWith(DEMANDE)).toBe(true);
    expect(envois[0]).toContain(DEMANDE);
    expect(envois[0]).toMatch(/Ne retire, ne remplace et ne contredis AUCUN élément/);
  });

  it('proposition qui change la personne et la tenue → écartée (422), jamais proposée', async () => {
    repondre('Un homme en costume noir dans un bureau, photo réaliste');
    const { status, body } = await detailler(DEMANDE);
    expect(status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.text).toBeUndefined();
    expect(body.manquants).toEqual(expect.arrayContaining(['femme', 'rose', 'danse', 'miroirs', 'bouteille']));
  });

  it('demande vide → 400, aucun appel au modèle', async () => {
    const envois = repondre('peu importe');
    const { status } = await detailler('   ');
    expect(status).toBe(400);
    expect(envois).toHaveLength(0);
  });
});

describe('« Détailler avec l’IA » — composant Affiche IA', () => {
  const DETAILLE = `${DEMANDE}, lumière naturelle douce, plan américain`;
  let appels: Array<{ url: string; body: any }>;
  beforeEach(() => {
    appels = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const body = JSON.parse(String(init?.body ?? '{}'));
      appels.push({ url: u, body });
      if (u.includes('/api/content/ai-generate')) {
        return { ok: true, status: 200, json: async () => ({ success: true, text: DETAILLE }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, resultUrl: 'https://studiio.pro/a.webp' }) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  it('proposition affichée AVANT génération, rien de généré ; acceptée → c’est elle qui part', async () => {
    render(<AfficheIA onUtiliser={() => {}} />);
    const zone = document.querySelector('[data-affiche-ia-prompt]') as HTMLTextAreaElement;
    fireEvent.change(zone, { target: { value: DEMANDE } });
    fireEvent.click(document.querySelector('[data-affiche-ia-detailler]')!);
    await waitFor(() => expect(document.querySelector('[data-affiche-ia-detail-proposition]')).not.toBeNull());
    expect(screen.getByText(DETAILLE)).toBeTruthy();
    expect(appels.map((a) => a.url)).toEqual(['/api/content/ai-generate']);
    expect(appels[0].body).toMatchObject({ fieldType: 'promptImage', sourceText: DEMANDE });
    // Rien n'est remplacé d'office.
    expect(zone.value).toBe(DEMANDE);

    fireEvent.click(document.querySelector('[data-affiche-ia-detail-utiliser]')!);
    expect(zone.value).toBe(DETAILLE);
    fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/ai/image')).toBe(true));
    expect(appels.find((a) => a.url === '/api/ai/image')!.body.prompt).toBe(DETAILLE);
  });

  it('« Garder le mien » → la demande d’origine reste et part telle quelle', async () => {
    render(<AfficheIA onUtiliser={() => {}} />);
    const zone = document.querySelector('[data-affiche-ia-prompt]') as HTMLTextAreaElement;
    fireEvent.change(zone, { target: { value: DEMANDE } });
    fireEvent.click(document.querySelector('[data-affiche-ia-detailler]')!);
    await waitFor(() => expect(document.querySelector('[data-affiche-ia-detail-ignorer]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-affiche-ia-detail-ignorer]')!);
    expect(zone.value).toBe(DEMANDE);
    fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/ai/image')).toBe(true));
    expect(appels.find((a) => a.url === '/api/ai/image')!.body.prompt).toBe(DEMANDE);
  });
});

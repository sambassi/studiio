import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Action `ocr` de /api/ai/image — tests de COMPORTEMENT de la route.
 *
 * Replicate est remplace par un double : ce qu'on verifie ici, c'est NOTRE
 * code — le nouveau chemin texte, le debit de credits, et surtout le fait que
 * le chemin image des huit autres outils n'a pas bouge. L'appel reel au
 * modele (preuve de bout en bout) demande REPLICATE_API_TOKEN et se fait
 * hors CI.
 */

const runMock = vi.fn();
const deductCreditsMock = vi.fn();
const getUserCreditsMock = vi.fn();

vi.mock('replicate', () => ({
  default: class {
    run = runMock;
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: async () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/credits/system', () => ({
  getUserCredits: (...a: unknown[]) => getUserCreditsMock(...a),
  deductCredits: (...a: unknown[]) => deductCreditsMock(...a),
}));

vi.mock('@/lib/service-alerts', () => ({
  detectAndReportServiceError: () => {},
}));

const { POST, extractText } = await import('@/app/api/ai/image/route');

/** Faux NextRequest : la route n'utilise que `.json()`. */
const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = 'test-token';
  getUserCreditsMock.mockResolvedValue(100);
  deductCreditsMock.mockResolvedValue(undefined);
});

describe('Action ocr — le texte de l\'image revient bien au client', () => {
  it('renvoie le texte reconnu, non vide, tel que le modele l\'a rendu', async () => {
    runMock.mockResolvedValue('BIENVENUE CHEZ STUDIIO\n3 seances par semaine');

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/affiche.png' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.text).toBe('BIENVENUE CHEZ STUDIIO\n3 seances par semaine');
    expect(body.text.length).toBeGreaterThan(0);
    // Une action texte ne doit surtout pas renvoyer d'URL d'image : le
    // panneau remplacerait le fond par le resultat.
    expect(body.resultUrl).toBeUndefined();
  });

  it('appelle le modele OCR verifie, avec son hash de version et le bon champ d\'entree', async () => {
    runMock.mockResolvedValue('texte');

    await post({ action: 'ocr', imageUrl: 'https://cdn.test/affiche.png' });

    expect(runMock).toHaveBeenCalledTimes(1);
    const [model, options] = runMock.mock.calls[0];
    // Modele communautaire → sans hash, Replicate repond 422.
    expect(model).toBe(
      'abiruyt/text-extract-ocr:a524caeaa23495bc9edc805ab08ab5fe943afd3febed884a4f3747aa32e9cd61',
    );
    expect(options).toEqual({ input: { image: 'https://cdn.test/affiche.png' } });
  });

  it('debite 1 credit une seule fois, APRES lecture reussie', async () => {
    runMock.mockResolvedValue('du texte');

    const { body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
    expect(deductCreditsMock).toHaveBeenCalledWith('user-1', 1, 'ai-ocr');
    expect(body.creditsUsed).toBe(1);
    expect(body.creditsRemaining).toBe(99);
  });

  it('recolle une sortie streamee en morceaux', async () => {
    runMock.mockResolvedValue(['SALLE ', 'DE ', 'SPORT']);

    const { body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(body.text).toBe('SALLE DE SPORT');
  });

  it('image sans texte : succes, message explicite, et AUCUN credit debite', async () => {
    runMock.mockResolvedValue('   ');

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/ciel.png' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.text).toBe('');
    expect(body.empty).toBe(true);
    expect(body.creditsUsed).toBe(0);
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('sortie illisible : erreur 500 et AUCUN credit debite', async () => {
    runMock.mockResolvedValue({ unexpected: true });

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('sans image, refus immediat sans appeler le modele ni debiter', async () => {
    const { status, body } = await post({ action: 'ocr' });

    expect(status).toBe(400);
    expect(body.error).toContain('imageUrl');
    expect(runMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('credits insuffisants : refus 402 avant tout appel au modele', async () => {
    getUserCreditsMock.mockResolvedValue(0);

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(402);
    expect(body.creditsNeeded).toBe(1);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('Non-regression — le chemin image des autres outils est inchange', () => {
  /** FileOutput du SDK Replicate 1.x : `url` est une METHODE. */
  const fileOutput = (u: string) => ({ url: () => new URL(u) });

  it('remove-bg renvoie toujours une URL d\'image, jamais du texte', async () => {
    runMock.mockResolvedValue(fileOutput('https://replicate.delivery/out.png'));

    const { status, body } = await post({ action: 'remove-bg', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(200);
    expect(body.resultUrl).toBe('https://replicate.delivery/out.png');
    expect(body.text).toBeUndefined();
    expect(body.empty).toBeUndefined();
    expect(deductCreditsMock).toHaveBeenCalledWith('user-1', 2, 'ai-remove-bg');
  });

  it('upscale garde son cout et son chemin image', async () => {
    runMock.mockResolvedValue(fileOutput('https://replicate.delivery/big.png'));

    const { body } = await post({ action: 'upscale', imageUrl: 'https://cdn.test/a.png' });

    expect(body.resultUrl).toBe('https://replicate.delivery/big.png');
    expect(deductCreditsMock).toHaveBeenCalledWith('user-1', 3, 'ai-upscale');
  });

  it('une action image dont la sortie est du texte reste une erreur (pas de fuite du chemin OCR)', async () => {
    runMock.mockResolvedValue('ceci n\'est pas une url');

    const { status, body } = await post({ action: 'remove-bg', imageUrl: 'https://cdn.test/a.png' });

    // `extractUrl` accepte les strings : c'est le comportement d'origine,
    // inchange. Ce qui compte : aucun champ `text` n'apparait sur ce chemin.
    expect(status).toBe(200);
    expect(body.text).toBeUndefined();
  });
});

describe('extractText — lecture de la sortie du modele', () => {
  it('distingue « rien trouve » (chaine vide) de « illisible » (null)', () => {
    expect(extractText('  du texte  ')).toBe('du texte');
    expect(extractText('   ')).toBe('');
    expect(extractText(null)).toBeNull();
    expect(extractText(undefined)).toBeNull();
    expect(extractText({})).toBeNull();
    expect(extractText({ foo: 1 })).toBeNull();
  });

  it('recolle les tableaux de morceaux, refuse les tableaux non textuels', () => {
    expect(extractText(['a', 'b', 'c'])).toBe('abc');
    expect(extractText([])).toBe('');
    expect(extractText(['a', 42])).toBeNull();
  });

  it('lit un objet dote d\'un toString utile (FileOutput du SDK)', () => {
    expect(extractText({ toString: () => 'texte du modele' })).toBe('texte du modele');
  });
});

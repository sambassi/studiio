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
const authMock = vi.fn();
const alertMock = vi.fn();

vi.mock('replicate', () => ({
  default: class {
    run = runMock;
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/credits/system', () => ({
  getUserCredits: (...a: unknown[]) => getUserCreditsMock(...a),
  deductCredits: (...a: unknown[]) => deductCreditsMock(...a),
}));

vi.mock('@/lib/service-alerts', () => ({
  detectAndReportServiceError: (...a: unknown[]) => alertMock(...a),
}));

const { POST } = await import('@/app/api/ai/image/route');
// `extractText` vit dans la lib, pas dans la route : un fichier route.ts ne
// peut exporter que ses handlers.
const { extractText } = await import('@/lib/ai/extract-text');

/** Faux NextRequest : la route n'utilise que `.json()`. */
const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = 'test-token';
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
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

  it('image sans texte : succes, drapeau `empty`, et le run est bien facture', async () => {
    runMock.mockResolvedValue('   ');

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/ciel.png' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.text).toBe('');
    expect(body.empty).toBe(true);
    // Le modele a tourne et nous a coute : un chemin gratuit serait le seul
    // appel a une API payante sans compteur de cette route.
    expect(body.creditsUsed).toBe(1);
    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
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

describe('Garde-fous de la route (partages par tous les outils)', () => {
  it('sans session, 401 — et rien n\'est appele', async () => {
    authMock.mockResolvedValue(null);

    const { status } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('sans REPLICATE_API_TOKEN, 503 explicite plutot qu\'une erreur opaque', async () => {
    delete process.env.REPLICATE_API_TOKEN;

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(503);
    expect(body.error).toContain('non configuré');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('action inconnue : 400, aucun appel au modele', async () => {
    const { status } = await post({ action: 'teleportation', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('un 422 « Invalid version » devient un 503 lisible et alerte l\'admin', async () => {
    // C'est LE mode de panne d'un modele communautaire dont le hash de
    // version a ete retire de Replicate — donc celui du modele OCR.
    runMock.mockRejectedValue(new Error('422 Invalid version'));

    const { status, body } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(alertMock).toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('des credits Replicate epuisses donnent un 503, pas un 500 muet', async () => {
    runMock.mockRejectedValue(new Error('402 Insufficient credit'));

    const { status } = await post({ action: 'ocr', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(503);
    expect(alertMock).toHaveBeenCalled();
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

  it('remove-bg garde son modele (avec hash) et son champ d\'entree', async () => {
    runMock.mockResolvedValue(fileOutput('https://replicate.delivery/out.png'));

    await post({ action: 'remove-bg', imageUrl: 'https://cdn.test/a.png' });

    const [model, options] = runMock.mock.calls[0];
    // Communautaire lui aussi : sans hash, Replicate repond 422.
    expect(model).toBe('cjwbw/rembg:fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003');
    expect(options).toEqual({ input: { image: 'https://cdn.test/a.png' } });
  });

  it('magic-eraser exige un prompt : sinon 400, sans appel ni debit', async () => {
    const { status } = await post({ action: 'magic-eraser', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('style-transfer exige un style : sinon 400, sans appel ni debit', async () => {
    const { status } = await post({ action: 'style-transfer', imageUrl: 'https://cdn.test/a.png' });

    expect(status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('upscale garde son cout et son chemin image', async () => {
    runMock.mockResolvedValue(fileOutput('https://replicate.delivery/big.png'));

    const { body } = await post({ action: 'upscale', imageUrl: 'https://cdn.test/a.png' });

    expect(body.resultUrl).toBe('https://replicate.delivery/big.png');
    expect(deductCreditsMock).toHaveBeenCalledWith('user-1', 3, 'ai-upscale');
  });

  it('une action image ne renvoie jamais de champ texte, meme si le modele rend une chaine', async () => {
    runMock.mockResolvedValue('ceci n\'est pas une url');

    const { body } = await post({ action: 'remove-bg', imageUrl: 'https://cdn.test/a.png' });

    // `extractUrl` accepte n'importe quelle chaine : comportement d'origine,
    // volontairement inchange par cette PR. Ce qui est verifie ici, c'est
    // seulement l'etancheite : aucun champ `text` / `empty` ne fuit sur le
    // chemin image.
    expect(body.text).toBeUndefined();
    expect(body.empty).toBeUndefined();
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

  it('lit un objet dote d\'un toString utile', () => {
    expect(extractText({ toString: () => 'texte du modele' })).toBe('texte du modele');
  });

  it('refuse une URL comme « texte reconnu » (un FileOutput est un fichier)', () => {
    // Le toString() d'un FileOutput rend l'URL du fichier. L'accepter
    // afficherait « https://replicate.delivery/… » sous « Texte reconnu »,
    // et le facturerait.
    expect(extractText({ toString: () => 'https://replicate.delivery/out.txt' })).toBeNull();
    expect(extractText('http://exemple.test/a.png')).toBe('http://exemple.test/a.png');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import AiImageTools, { AI_TOOLS, POSTER_ACTIONS, STYLE_PRESETS } from '@/components/creer/AiImageTools';

/**
 * Outils IA sur la photo d'affiche — Mode simple.
 *
 * `ImageEditorPanel` ne pouvait pas être réutilisé tel quel : ses 927 lignes
 * s'articulent autour d'un `SequenceBackgroundConfig` (filtres,
 * `objectPosition`, zoom) que le Mode simple n'a pas — son affiche est un
 * `posterUrl` plus un `PosterTransform`. Le monter ici aurait aussi importé
 * un second recadrage, concurrent de celui du Mode simple.
 *
 * D'où l'extraction d'un sous-composant, et surtout d'un **catalogue
 * partagé** : c'est lui qui porte le coût en crédits de chaque action. Deux
 * copies finiraient par annoncer des tarifs différents selon l'écran, et l'un
 * des deux mentirait.
 */

const route = readFileSync(resolve(__dirname, '../app/api/ai/image/route.ts'), 'utf-8');
const panneauAvance = readFileSync(
  resolve(__dirname, '../components/creer/ImageEditorPanel.tsx'),
  'utf-8',
);
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const rendre = (props: Partial<React.ComponentProps<typeof AiImageTools>> = {}) => {
  const onImageResult = vi.fn();
  const showToast = vi.fn();
  render(
    <AiImageTools
      imageUrl="https://cdn.test/affiche.jpg"
      onImageResult={onImageResult}
      showToast={showToast}
      {...props}
    />,
  );
  return { onImageResult, showToast };
};

const bouton = (action: string) =>
  document.querySelector(`[data-ai-action="${action}"]`) as HTMLButtonElement;

describe('Le catalogue est la SEULE source du tarif', () => {
  it('le serveur et l écran annoncent le même coût', () => {
    // Le serveur est l'autorité — mais s'il annonce 5 et l'écran 3,
    // l'utilisateur est débité de ce qu'il n'a pas accepté.
    const table = route.slice(route.indexOf('const AI_CREDITS'), route.indexOf('// ── Replicate model IDs ──'));
    for (const tool of AI_TOOLS) {
      const ligne = new RegExp(`'${tool.action}':\\s*(\\d+)`);
      const m = table.match(ligne);
      expect(m, tool.action).not.toBeNull();
      expect(Number(m![1]), tool.action).toBe(tool.credits);
    }
  });

  it('l éditeur avancé lit ce même catalogue', () => {
    expect(panneauAvance).toContain("} from '@/components/creer/AiImageTools';");
    // Plus de seconde définition chez lui.
    expect(panneauAvance).not.toContain('const AI_TOOLS: AiToolDef[] = [');
    expect(panneauAvance).not.toContain('const STYLE_PRESETS = [');
  });

  it('le serveur connaît toutes les actions proposées', () => {
    for (const a of POSTER_ACTIONS) {
      expect(route.includes(`'${a}'`), a).toBe(true);
    }
  });
});

describe('Ce qui est proposé sur une AFFICHE', () => {
  it('ni vidéo ni OCR — aucun des deux ne peut devenir un fond', () => {
    expect(POSTER_ACTIONS).not.toContain('image-to-video');
    expect(POSTER_ACTIONS).not.toContain('ocr');
  });

  it('les outils demandés par le brief sont là', () => {
    for (const a of ['generate-bg', 'magic-edit', 'remove-bg', 'magic-eraser', 'upscale'] as const) {
      expect(POSTER_ACTIONS, a).toContain(a);
    }
  });

  it('chaque bouton annonce son coût AVANT le clic', () => {
    rendre();
    for (const tool of AI_TOOLS.filter((t) => POSTER_ACTIONS.includes(t.action))) {
      expect(bouton(tool.action).textContent, tool.action).toContain(`${tool.credits} cr.`);
    }
  });
});

describe('Sans image, seuls les outils qui s en passent sont actifs', () => {
  it('« Générer arrière-plan » reste utilisable', () => {
    rendre({ imageUrl: null });
    expect(bouton('generate-bg').disabled).toBe(false);
  });

  it('les outils qui retouchent une image sont désarmés, et le disent', () => {
    rendre({ imageUrl: null });
    expect(bouton('remove-bg').disabled).toBe(true);
    expect(bouton('remove-bg').title).toContain('Choisissez d’abord une photo');
  });
});

describe('Une consigne manquante n envoie RIEN', () => {
  it('le premier clic ouvre le champ au lieu de partir', async () => {
    // Un appel sans consigne consommerait des crédits pour rien.
    const appels = vi.fn();
    vi.stubGlobal('fetch', appels);
    rendre();
    fireEvent.click(bouton('magic-edit'));
    await waitFor(() => expect(document.querySelector('[data-ai-prompt]')).not.toBeNull());
    expect(appels).not.toHaveBeenCalled();
  });

  it('le bouton « Lancer » reste inerte tant que la consigne est vide', async () => {
    rendre();
    fireEvent.click(bouton('magic-edit'));
    await waitFor(() => expect(document.querySelector('[data-ai-confirm]')).not.toBeNull());
    expect((document.querySelector('[data-ai-confirm]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('avec une consigne, l appel part avec l action et l image', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, resultUrl: 'https://cdn.test/resultat.png', creditsUsed: 5 }),
    }));
    vi.stubGlobal('fetch', fetchMock as never);
    const { onImageResult, showToast } = rendre();

    fireEvent.click(bouton('magic-edit'));
    await waitFor(() => expect(document.querySelector('[data-ai-prompt]')).not.toBeNull());
    fireEvent.change(document.querySelector('[data-ai-prompt]')!, {
      target: { value: 'change le ciel en coucher de soleil' },
    });
    fireEvent.click(document.querySelector('[data-ai-confirm]')!);

    await waitFor(() => expect(onImageResult).toHaveBeenCalledWith('https://cdn.test/resultat.png'));
    const corps = JSON.parse((fetchMock.mock.calls[0] as never[])[1]!['body']);
    expect(corps.action).toBe('magic-edit');
    expect(corps.prompt).toBe('change le ciel en coucher de soleil');
    expect(corps.imageUrl).toBe('https://cdn.test/affiche.jpg');
    // Le coût réellement débité vient du SERVEUR, pas du catalogue.
    expect(showToast.mock.calls[0][0]).toContain('5 cr.');
  });

  it('un outil sans consigne part au premier clic', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, resultUrl: 'https://cdn.test/sansfond.png' }),
    }));
    vi.stubGlobal('fetch', fetchMock as never);
    const { onImageResult } = rendre();
    fireEvent.click(bouton('remove-bg'));
    await waitFor(() => expect(onImageResult).toHaveBeenCalledWith('https://cdn.test/sansfond.png'));
  });
});

describe('Les échecs sont DITS, jamais avalés', () => {
  it('le message du serveur est relayé tel quel', async () => {
    // C'est lui qui dit « Service IA non configuré » quand
    // REPLICATE_API_TOKEN manque, ou « Crédits insuffisants ».
    vi.stubGlobal('fetch', async () => ({
      ok: false, json: async () => ({ success: false, error: 'Service IA non configuré' }),
    }) as never);
    const { showToast, onImageResult } = rendre();
    fireEvent.click(bouton('remove-bg'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Service IA non configuré', 'error'));
    expect(onImageResult).not.toHaveBeenCalled();
  });

  it('une réponse sans image est une erreur, pas un succès silencieux', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true, json: async () => ({ success: true }),
    }) as never);
    const { showToast, onImageResult } = rendre();
    fireEvent.click(bouton('remove-bg'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Aucune image renvoyée.', 'error'));
    expect(onImageResult).not.toHaveBeenCalled();
  });

  it('un réseau coupé ne laisse pas le bouton tourner indéfiniment', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { showToast } = rendre();
    fireEvent.click(bouton('remove-bg'));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    // Le `finally` a rendu la main : les boutons sont réarmés.
    await waitFor(() => expect(bouton('remove-bg').disabled).toBe(false));
  });

  it('un traitement en cours désarme TOUS les boutons', async () => {
    let debloquer: (v: unknown) => void = () => {};
    vi.stubGlobal('fetch', () => new Promise((r) => { debloquer = r; }));
    rendre();
    fireEvent.click(bouton('remove-bg'));
    // Deux appels concurrents doubleraient la facture.
    await waitFor(() => expect(bouton('upscale').disabled).toBe(true));
    debloquer({ ok: true, json: async () => ({ success: true, resultUrl: 'x' }) });
  });
});

describe('Le débit est affaire du SERVEUR', () => {
  it('il vérifie le solde avant, et débite APRÈS extraction réussie', () => {
    // Rien à faire côté client : le débit ne peut pas partir sur un échec.
    expect(route).toContain('// Extract URL from output BEFORE deducting credits');
    const extraction = route.indexOf('// Extract URL from output BEFORE deducting credits');
    const debit = route.indexOf('// Deduct credits AFTER successful extraction');
    expect(debit).toBeGreaterThan(extraction);
  });

  it('un token absent répond 503 avec un message clair', () => {
    expect(route).toContain("{ success: false, error: 'Service IA non configuré' }, { status: 503 }");
  });

  it('le client n implémente AUCUN débit de son côté', () => {
    const src = readFileSync(resolve(__dirname, '../components/creer/AiImageTools.tsx'), 'utf-8');
    expect(src).not.toContain('/api/credits/deduct');
  });
});

describe('L intégration dans le Mode simple', () => {
  it('les outils travaillent sur le fond EFFECTIF', () => {
    // `fondAffiche.url` = le fond de la séquence affichée, ou l'affiche
    // globale sur « Tout ».
    expect(wizard).toContain('imageUrl={fondAffiche.url}');
  });

  it('le résultat repart au MÊME endroit', () => {
    // Retoucher le fond du Titre et voir l'affiche globale changer serait
    // incompréhensible : `applyPhoto` route déjà au bon endroit.
    expect(wizard).toContain('onImageResult={(url) => {');
    expect(wizard).toContain('applyPhoto(url);');
  });

  it('l écran annonce OÙ le résultat ira', () => {
    expect(wizard).toContain("? 'le fond de la séquence affichée'");
    expect(wizard).toContain(": 'l’affiche globale'");
  });

  it('les erreurs remontent au bandeau, les réussites à la section', () => {
    expect(wizard).toContain("if (type === 'error') { setAiNotice(null); setError(msg); }");
    expect(wizard).toContain('else { setError(null); setAiNotice(msg); }');
  });

  it('les styles proposés sont ceux du catalogue', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThan(0);
    rendre();
    fireEvent.click(bouton('style-transfer'));
    expect(screen.getByText(STYLE_PRESETS[0].label)).toBeTruthy();
  });
});

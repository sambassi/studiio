import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * L'étape « Style & médias » — l'identité CONSTANTE, à l'écran.
 *
 * ⚠️ CE TEST MONTE LE COMPOSANT, il ne lit pas son source. Le dépôt a déjà
 * payé le prix des tests qui vérifient la présence de lignes plutôt qu'un
 * comportement (cf. `tasks/lessons.md`, 2026-07-30 : « un test qui ne peut
 * pas échouer quand le produit est cassé n'est pas une vérification »). Ce
 * qu'on vérifie ici, c'est ce que le serveur REÇOIT quand on clique.
 */

/** Ce que l'écran a réellement envoyé en `PUT`, dans l'ordre. */
let envois: AutopilotConfig[] = [];
let configServeur: AutopilotConfig = DEFAULT_CONFIG;
let voixDuCompte: Array<{ id: string; name: string; lang: string | null }> = [];
let brandingReady = true;

beforeEach(() => {
  envois = [];
  configServeur = DEFAULT_CONFIG;
  voixDuCompte = [];
  brandingReady = true;

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: voixDuCompte }) };
    }
    if (String(url).startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(recu);
        configServeur = recu;
        return { ok: true, json: async () => ({ success: true, brandingReady, config: recu }) };
      }
      return {
        ok: true,
        json: async () => ({ success: true, ready: true, brandingReady, config: configServeur }),
      };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Monte l'écran et se place sur l'étape « Style & médias » (la 3ᵉ). */
async function ouvrirStyleEtMedias() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="2"]') as Element);
  await waitFor(() => expect(screen.getByText('Style & médias')).toBeTruthy());
}

/** Le dernier réglage envoyé au serveur. */
function dernierEnvoi(): AutopilotConfig {
  expect(envois.length).toBeGreaterThan(0);
  return envois[envois.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — l étape existe et annonce ce qu elle règle', () => {
  it('elle dit que ces réglages valent pour TOUTES les futures vidéos', async () => {
    await ouvrirStyleEtMedias();
    // ⚠️ C'EST LA PROMESSE PRODUIT. Sans cette phrase, l'utilisateur ne sait
    // pas qu'il règle une identité et non le montage du jour.
    expect(screen.getByText(/toutes\s*les futures vidéos/)).toBeTruthy();
  });

  it('les six réglages constants sont là', async () => {
    await ouvrirStyleEtMedias();
    expect(document.querySelector('[data-autopilot-color-start]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-color-end]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-color-title]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-cards-poster]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-add-music]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-keep-rush-audio]')).toBeTruthy();
    for (const cle of ['musicVolume', 'voiceVolume', 'rushVolume']) {
      expect(document.querySelector(`[data-autopilot-volume="${cle}"]`)).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — le fond des cartes', () => {
  it('il est éteint au départ : les cartes sont sur les couleurs', async () => {
    await ouvrirStyleEtMedias();
    const bouton = document.querySelector('[data-autopilot-cards-poster]') as HTMLElement;
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/Les cartes se posent sur vos couleurs/)).toBeTruthy();
  });

  it('l allumer envoie bien `cardsShowPoster: true`', async () => {
    await ouvrirStyleEtMedias();
    fireEvent.click(document.querySelector('[data-autopilot-cards-poster]') as Element);
    await waitFor(() => expect(dernierEnvoi().cardsShowPoster).toBe(true));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — le son du rush et le mixeur', () => {
  it('le son du rush est coupé au départ', async () => {
    await ouvrirStyleEtMedias();
    const bouton = document.querySelector('[data-autopilot-keep-rush-audio]') as HTMLElement;
    expect(bouton.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText(/La séquence vidéo est muette/)).toBeTruthy();
  });

  it('le curseur du rush est INACTIF tant que son son est coupé', async () => {
    // ⚠️ GRISÉ, PAS CACHÉ : le masquer ferait croire que le réglage n'existe
    // pas, et il serait perdu de vue en rallumant le son.
    await ouvrirStyleEtMedias();
    const curseur = document.querySelector('[data-autopilot-volume="rushVolume"]') as HTMLInputElement;
    expect(curseur.disabled).toBe(true);
    expect((document.querySelector('[data-autopilot-volume="musicVolume"]') as HTMLInputElement).disabled)
      .toBe(false);
  });

  it('garder le son du rush réactive son curseur', async () => {
    await ouvrirStyleEtMedias();
    fireEvent.click(document.querySelector('[data-autopilot-keep-rush-audio]') as Element);
    await waitFor(() => expect(dernierEnvoi().keepRushAudio).toBe(true));
    await waitFor(() => {
      const curseur = document.querySelector('[data-autopilot-volume="rushVolume"]') as HTMLInputElement;
      expect(curseur.disabled).toBe(false);
    });
  });

  it('bouger un curseur puis relâcher envoie le niveau en 0–1', async () => {
    // ⚠️ L'ÉCRAN AFFICHE DES POUR-CENT, LA BASE STOCKE DES RÉELS. Envoyer 35
    // au lieu de 0,35 serait borné à 1 par `sanitizeVolume` — donc un volume
    // à fond, silencieusement.
    await ouvrirStyleEtMedias();
    const curseur = document.querySelector('[data-autopilot-volume="musicVolume"]') as HTMLInputElement;
    fireEvent.change(curseur, { target: { value: '35' } });
    fireEvent.mouseUp(curseur);
    await waitFor(() => expect(dernierEnvoi().musicVolume).toBeCloseTo(0.35, 5));
  });

  it('le niveau affiché suit le curseur', async () => {
    await ouvrirStyleEtMedias();
    const curseur = document.querySelector('[data-autopilot-volume="voiceVolume"]') as HTMLInputElement;
    fireEvent.change(curseur, { target: { value: '20' } });
    await waitFor(() => expect(screen.getByText('20 %')).toBeTruthy());
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — les couleurs', () => {
  it('elles ne partent qu au clic « Enregistrer », pas à chaque pixel', async () => {
    // ⚠️ UNE ROUE CHROMATIQUE ÉMET UNE COULEUR PAR MOUVEMENT DE SOURIS.
    // Enregistrer sur `onChange` enverrait des centaines de `PUT` pour un
    // seul choix.
    await ouvrirStyleEtMedias();
    const champ = document.querySelector('[data-autopilot-color-start] input') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: '#123456' } });
    expect(envois).toHaveLength(0);

    fireEvent.click(document.querySelector('[data-autopilot-colors-save]') as Element);
    await waitFor(() => expect(dernierEnvoi().cardGradientStart).toBe('#123456'));
  });

  it('les trois couleurs partent ensemble', async () => {
    await ouvrirStyleEtMedias();
    fireEvent.click(document.querySelector('[data-autopilot-colors-save]') as Element);
    await waitFor(() => {
      const envoi = dernierEnvoi();
      expect(envoi.cardGradientStart).toBe(DEFAULT_CONFIG.cardGradientStart);
      expect(envoi.cardGradientEnd).toBe(DEFAULT_CONFIG.cardGradientEnd);
      expect(envoi.titleColor).toBe(DEFAULT_CONFIG.titleColor);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — la voix clonée', () => {
  it('sans voix clonée, l écran renvoie vers « Mon avatar »', async () => {
    await ouvrirStyleEtMedias();
    expect(screen.getByText(/Mon avatar/)).toBeTruthy();
    expect(document.querySelector('[data-autopilot-voice-id]')).toBeNull();
  });

  it('avec des voix clonées, le sélecteur les propose', async () => {
    voixDuCompte = [
      { id: 'elevenlabs-AAA', name: 'Ma voix', lang: 'FR' },
      { id: 'elevenlabs-BBB', name: 'Ma seconde voix', lang: null },
    ];
    await ouvrirStyleEtMedias();
    const select = await waitFor(() =>
      document.querySelector('[data-autopilot-voice-id]') as HTMLSelectElement);
    // « Voix par défaut » plus les deux voix du compte.
    expect(select.options).toHaveLength(3);
  });

  it('en choisir une envoie son identifiant PRÉFIXÉ', async () => {
    // Le dépréfixage se fait côté serveur, au moment de l'appel ElevenLabs :
    // c'est l'identifiant Studiio qui est stocké.
    voixDuCompte = [{ id: 'elevenlabs-AAA', name: 'Ma voix', lang: 'FR' }];
    await ouvrirStyleEtMedias();
    const select = await waitFor(() =>
      document.querySelector('[data-autopilot-voice-id]') as HTMLSelectElement);
    fireEvent.change(select, { target: { value: 'elevenlabs-AAA' } });
    await waitFor(() => expect(dernierEnvoi().voiceId).toBe('elevenlabs-AAA'));
  });

  it('quand la narration est éteinte, l écran le DIT', async () => {
    voixDuCompte = [{ id: 'elevenlabs-AAA', name: 'Ma voix', lang: 'FR' }];
    await ouvrirStyleEtMedias();
    // Sinon l'utilisateur choisit une voix et n'entend jamais rien.
    expect(screen.getByText(/La narration est désactivée/)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F — le récapitulatif sépare le fixe du variable', () => {
  it('il montre trois blocs, dont « ce qui ne change jamais »', async () => {
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="5"]') as Element);
    await waitFor(() => expect(screen.getByText('Récapitulatif')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-recap="variable"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-recap="constant"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-recap="diffusion"]')).toBeTruthy();
    expect(screen.getByText('Ce qui ne change jamais')).toBeTruthy();
  });

  it('il annonce le son du rush coupé et les cartes sur les couleurs', async () => {
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="5"]') as Element);
    await waitFor(() => expect(screen.getByText('Coupé')).toBeTruthy());
    expect(screen.getByText('Les couleurs choisies')).toBeTruthy();
  });

  it('avec un seul rush, il prévient qu il sera répété', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: ['https://x.test/a.mp4'] });
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="5"]') as Element);
    await waitFor(() => expect(screen.getByText(/il sera répété/)).toBeTruthy());
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('G — sans la migration, l écran ne ment pas', () => {
  it('il prévient que couleurs, musique et mixeur ne seront pas conservés', async () => {
    // ⚠️ UN FORMULAIRE SILENCIEUSEMENT SANS EFFET EST PIRE QU'UN FORMULAIRE
    // ABSENT : l'utilisateur règle son identité, part, et la retrouve intacte
    // au retour sans jamais comprendre pourquoi.
    brandingReady = false;
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() =>
      expect(document.querySelector('[data-autopilot-identite-absente]')).toBeTruthy());
  });

  it('migration appliquée, aucun avertissement', async () => {
    render(<AutopilotPanel accent="#7C3AED" />);
    await waitFor(() => expect(screen.getByText('Thèmes')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-identite-absente]')).toBeNull();
  });
});

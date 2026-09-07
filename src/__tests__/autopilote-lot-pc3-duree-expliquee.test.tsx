/**
 * LOT PC-3 — EXPLIQUER LA DUREE REELLEMENT OBTENUE.
 *
 * ---------------------------------------------------------------------------
 * LE DEFAUT QU'ON FERME
 * ---------------------------------------------------------------------------
 *
 * Le moteur traite la duree comme une CIBLE, pas comme une obligation : il ne
 * meuble pas. Mesure en production : une cible de 60 s a rendu 13,1 s, et
 * `ecart_secondes` valait 46,9 — la base le savait, l'ecran ne le disait pas.
 * Treize secondes apres en avoir demande soixante se lisent comme une panne.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ CE QUI EST TESTE ICI, ET CE QUI NE L'EST PAS
 * ---------------------------------------------------------------------------
 *
 * Ce lot ne touche NI la selection des clips, NI la duree maximale, NI
 * l'anti-repetition, NI le scoring. Il lit trois nombres que le serveur
 * ecrivait deja et les met en francais. Les tests portent donc sur le SEUIL,
 * la COMPATIBILITE avec les rendus anciens, et le TON.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const {
  ecartNotable, montageDepuisReponse, renduDepuisReponse,
  ECART_NOTABLE_SECONDES, ECART_NOTABLE_PART,
} = await import('@/lib/autopilot/analyse/rendu-passerelle');
const VideosPretes = (await import('@/components/creer/VideosPretes')).default;

const SESSION = '11111111-1111-4111-8111-111111111111';

const VIDEO = {
  dureeSecondes: 13.1, largeur: 1080, hauteur: 1920,
  fps: 30, octets: 5493401, chemin: '/api/autopilot/rendus-montage/x/fichier',
};

function reponse(montage: unknown, video = VIDEO) {
  return {
    ok: true,
    rendu: { id: 'r1', etat: 'reussie', etape: null, motif: null, video },
    montage,
  };
}

function monter(corps: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corps), {
    headers: { 'Content-Type': 'application/json' },
  })));
  return render(
    <VideosPretes sessionId={SESSION} aucunRush={false} formatSouhaite="9:16" />,
  );
}

const phrase = () => document.querySelector('[data-videos-ecart]');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le seuil — parler quand ça compte, se taire sinon', () => {
  it('1.1 un gros écart est notable : 60 s demandées, 13 s rendues', () => {
    expect(ecartNotable({ demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 }))
      .toBe(true);
  });

  it('1.2 un écart minime se tait : 15 s demandées, 14,6 s rendues', () => {
    expect(ecartNotable({ demandeeSecondes: 15, ecartSecondes: 0.4, clipsEcartes: 0 }))
      .toBe(false);
  });

  it('1.3 IL FAUT LES DEUX CONDITIONS, et voici pourquoi', () => {
    // Assez de secondes, mais une part derisoire : 4 s sur 120 s. Se taire.
    expect(ecartNotable({ demandeeSecondes: 120, ecartSecondes: 4, clipsEcartes: 0 }))
      .toBe(false);
    // Une grosse part, mais deux secondes : un plan tronque de rien. Se taire.
    expect(ecartNotable({ demandeeSecondes: 8, ecartSecondes: 2, clipsEcartes: 0 }))
      .toBe(false);
  });

  it('1.4 les seuils sont ceux annoncés', () => {
    expect(ECART_NOTABLE_SECONDES).toBe(3);
    expect(ECART_NOTABLE_PART).toBe(0.2);
    // Juste au-dessus des deux : on parle.
    expect(ecartNotable({ demandeeSecondes: 15, ecartSecondes: 3, clipsEcartes: 0 }))
      .toBe(true);
  });

  it('1.5 rien à dire quand on ne sait rien', () => {
    expect(ecartNotable(null)).toBe(false);
    expect(ecartNotable({ demandeeSecondes: 0, ecartSecondes: 5, clipsEcartes: 0 }))
      .toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Les rendus anciens ne cassent rien', () => {
  it('2.1 un bloc absent rend `null`, jamais un zéro fabriqué', () => {
    // ⚠️ VINGT-TROIS REUSSITES EXISTENT DEJA EN BASE, sans ce bloc. Afficher
    // « 0 s demandée » sur tout l'historique serait un mensonge lisible.
    expect(montageDepuisReponse(undefined)).toBeNull();
    expect(montageDepuisReponse(null)).toBeNull();
    expect(montageDepuisReponse({})).toBeNull();
    expect(montageDepuisReponse({ demandeeSecondes: 0 })).toBeNull();
    expect(montageDepuisReponse({ demandeeSecondes: 'soixante' })).toBeNull();
  });

  it('2.2 un écart ou un compte invalide retombe à zéro, sans perdre la cible', () => {
    expect(montageDepuisReponse({ demandeeSecondes: 60, ecartSecondes: 'x', clipsEcartes: -3 }))
      .toEqual({ demandeeSecondes: 60, ecartSecondes: 0, clipsEcartes: 0 });
  });

  it('2.3 un rendu ancien s’affiche SANS la phrase, et sans casser', async () => {
    monter(reponse(undefined));
    await waitFor(() => expect(screen.getByText(/Votre vidéo est prête/)).toBeTruthy());
    expect(phrase()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. À l’écran', () => {
  it('3.1 gros écart : la durée demandée est dite, en clair', async () => {
    monter(reponse({ demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 }));
    await waitFor(() => expect(phrase()).toBeTruthy());
    expect(phrase()!.textContent).toContain('1:00');
    expect(phrase()!.textContent).toMatch(/meilleurs passages/);
  });

  it('3.2 écart minime : rien ne s’affiche', async () => {
    monter(reponse({ demandeeSecondes: 15, ecartSecondes: 0.4, clipsEcartes: 0 },
      { ...VIDEO, dureeSecondes: 14.6 }));
    await waitFor(() => expect(screen.getByText(/Votre vidéo est prête/)).toBeTruthy());
    expect(phrase()).toBeNull();
  });

  it('3.3 AUCUN JARGON, et ce n’est pas une erreur', async () => {
    monter(reponse({ demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 }));
    await waitFor(() => expect(phrase()).toBeTruthy());
    const t = phrase()!.textContent ?? '';
    for (const mot of [
      'm3e', 'm3g', 'quality', 'palier', 'guard', 'scoreMontage', 'intersection',
      'clip_', 'rang-', 'échec', 'erreur', 'Erreur',
    ]) {
      expect(t).not.toContain(mot);
    }
    // Le ton : gris, pas rouge. Un rendu reussi ne s'annonce pas en alerte.
    expect(phrase()!.className).toContain('text-gray-400');
    expect(phrase()!.className).not.toContain('text-red');
    expect(phrase()!.className).not.toContain('text-amber');
  });

  it('3.4 la phrase n’existe QUE sur une réussite', () => {
    // ⚠️ Expliquer une duree pendant un rendu en cours ferait lire un ecart
    // comme un echec annonce.
    const enCours = renduDepuisReponse(
      { id: 'r1', etat: 'en_cours', etape: 'encodage', motif: null, video: null },
      { demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 },
    );
    expect(enCours?.montage).toBeNull();

    const reussi = renduDepuisReponse(
      { id: 'r1', etat: 'reussie', etape: null, motif: null, video: VIDEO },
      { demandeeSecondes: 60, ecartSecondes: 46.9, clipsEcartes: 1 },
    );
    expect(reussi?.montage).toMatchObject({ demandeeSecondes: 60 });
  });
});

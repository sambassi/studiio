import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import JumeauAutopilote from '@/components/creer/JumeauAutopilote';
import {
  moteurJumeauDisponiblePour,
  MESSAGE_MOTEUR_JUMEAU_AVATAR_VIDEO,
  MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE,
} from '@/lib/avatar/jumeau';

/**
 * AVATAR D-ID (créé à partir d'une vidéo) ET JUMEAU — ce qui marche, dit tel quel.
 *
 * Observé en prod : « Votre avatar vidéo n'est pas encore pris en charge par le
 * jumeau numérique. », interrupteur « Utiliser mon jumeau » inerte dans
 * l'Autopilote — alors que l'Autopilote n'utilise QUE la voix du jumeau, qui
 * ne dépend pas du fournisseur de l'avatar. La garde D-ID portait sur
 * « prêt » au lieu de porter sur le moteur VIDÉO.
 *
 * Trois couches, trois réponses :
 *  - avatar (D-ID, validé)  → prêt ;
 *  - voix clonée            → utilisable (narration Autopilote, voix par séquence) ;
 *  - moteur vidéo du jumeau → HeyGen seulement : indisponible pour D-ID, et
 *    le message dit ce qui manque et ce qui marche déjà.
 *
 * Le moteur global (`JUMEAU_MOTEUR_ACTIVE`) n'est PAS activé pour faire
 * disparaître le message : `moteurJumeauDisponiblePour('did')` reste faux même
 * avec tous les drapeaux et clés.
 */

const ENV_MOTEUR_ACTIF = { JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'k', ELEVENLABS_API_KEY: 'k' } as NodeJS.ProcessEnv;

describe('moteurJumeauDisponiblePour — le moteur se juge POUR un avatar', () => {
  it('D-ID : indisponible même moteur actif, avec le message qui dit quoi et pourquoi', () => {
    const r = moteurJumeauDisponiblePour('did', ENV_MOTEUR_ACTIF);
    expect(r.disponible).toBe(false);
    expect(r.message).toBe(MESSAGE_MOTEUR_JUMEAU_AVATAR_VIDEO);
    expect(r.message).toContain('créés à partir d’une photo');
    expect(r.message).toContain('voix reste utilisable');
    expect(r.message).not.toContain('pas encore pris en charge');
  });

  it('HeyGen : suit le drapeau global — actif → disponible ; absent → message générique qui rappelle que la voix marche', () => {
    expect(moteurJumeauDisponiblePour('heygen', ENV_MOTEUR_ACTIF)).toEqual({ disponible: true, message: null });
    const sans = moteurJumeauDisponiblePour('heygen', {} as NodeJS.ProcessEnv);
    expect(sans.disponible).toBe(false);
    expect(sans.message).toBe(MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE);
    expect(sans.message).toContain('voix reste utilisable');
  });

  it('fournisseur inconnu : jamais disponible', () => {
    expect(moteurJumeauDisponiblePour('inconnu', ENV_MOTEUR_ACTIF).disponible).toBe(false);
  });
});

describe('JumeauAutopilote avec un avatar D-ID', () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        pret: true, motif: null, message: null,
        jumeau: { avatar: { id: 'a', version: 1, nom: 'Bassi', valideLe: '2026-09-15', fournisseur: 'did' }, voix: { id: 'v-compte', nom: 'Bassi' }, prononciations: 0 },
        moteurDisponible: false,
        messageMoteur: MESSAGE_MOTEUR_JUMEAU_AVATAR_VIDEO,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); globalThis.fetch = fetchOriginal; });

  it('la voix du jumeau est activable (c’est la seule chose que l’Autopilote en fait), et le message dit ce que l’image ne fait pas', async () => {
    const onChange = vi.fn();
    render(<JumeauAutopilote actif={false} onChange={onChange} voixCompte={[{ id: 'elevenlabs-xyz', accountVoiceId: 'v-compte' }]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    const sw = screen.getByRole('switch', { name: 'Utiliser mon jumeau' }) as HTMLInputElement;
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true, 'elevenlabs-xyz');
    const video = document.querySelector('[data-jumeau-autopilote-video]')!.textContent!;
    expect(video).toContain('créés à partir d’une photo');
    expect(document.querySelector('[data-jumeau-autopilote]')!.textContent).not.toContain('pas encore pris en charge');
  });
});

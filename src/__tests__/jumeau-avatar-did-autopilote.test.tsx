import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import JumeauAutopilote from '@/components/creer/JumeauAutopilote';
import {
  moteurJumeauDisponiblePour,
  MESSAGE_MOTEUR_JUMEAU_DID_NON_CONFIGURE,
  MESSAGE_MOTEUR_JUMEAU_VOIX_NON_CONFIGUREE,
  MESSAGE_MOTEUR_JUMEAU_FOURNISSEUR_INCONNU,
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
 * Puis, signalé par l'utilisateur : « Votre jumeau est prêt » suivi de « Votre
 * jumeau à l'image n'est pas monté par l'Autopilote » — une contradiction. Le
 * titre dit maintenant CE QUI est prêt (la voix, pour la narration), et une
 * ligne dit où l'avatar à l'image existe (Créer une vidéo).
 *
 * Trois couches, trois réponses :
 *  - avatar (D-ID, validé)  → prêt ;
 *  - voix clonée            → utilisable (narration Autopilote, voix par séquence) ;
 *  - moteur vidéo du jumeau → PAR FOURNISSEUR : HeyGen suit `JUMEAU_MOTEUR_ACTIVE`
 *    + clés ; D-ID suit le gate de l'aperçu (`DID_VIDEO_AVATAR_ACTIVE` +
 *    `DID_API_KEY` + `ELEVENLABS_API_KEY`), sans drapeau global. Indisponible,
 *    le message NOMME la dépendance manquante.
 */

const ENV_MOTEUR_HEYGEN = { JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'k', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;
const ENV_APERCU_DID = { DID_VIDEO_AVATAR_ACTIVE: '1', DID_API_KEY: 'user:secret', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;

describe('moteurJumeauDisponiblePour — le moteur se juge POUR un avatar', () => {
  it('⚠️ D-ID : le drapeau HeyGen ne dit rien — indisponible sans D-ID, et le message nomme DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY', () => {
    const r = moteurJumeauDisponiblePour('did', ENV_MOTEUR_HEYGEN);
    expect(r.disponible).toBe(false);
    expect(r.message).toBe(MESSAGE_MOTEUR_JUMEAU_DID_NON_CONFIGURE);
    expect(r.message).toContain('D-ID');
    expect(r.message).toContain('DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY');
    expect(r.message).toContain('Aucun crédit n’est débité');
    expect(r.message).toContain('voix reste utilisable');
    expect(r.message).not.toContain('pas encore pris en charge');
    expect(r.message).not.toContain('créés à partir d’une photo');
  });

  it('⚠️ D-ID : disponible avec EXACTEMENT le gate de l’aperçu (DID actif + clé + ElevenLabs), sans JUMEAU_MOTEUR_ACTIVE', () => {
    expect(moteurJumeauDisponiblePour('did', ENV_APERCU_DID)).toEqual({ disponible: true, message: null });
    // Drapeau D-ID sans clé, ou clé sans drapeau : indisponible.
    expect(moteurJumeauDisponiblePour('did', { DID_VIDEO_AVATAR_ACTIVE: '1', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).disponible).toBe(false);
    expect(moteurJumeauDisponiblePour('did', { DID_API_KEY: 'user:secret', ELEVENLABS_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).disponible).toBe(false);
    // ElevenLabs absente : c'est ELLE qui est nommée.
    const sansVoix = moteurJumeauDisponiblePour('did', { DID_VIDEO_AVATAR_ACTIVE: '1', DID_API_KEY: 'user:secret' } as unknown as NodeJS.ProcessEnv);
    expect(sansVoix.disponible).toBe(false);
    expect(sansVoix.message).toBe(MESSAGE_MOTEUR_JUMEAU_VOIX_NON_CONFIGUREE);
    expect(sansVoix.message).toContain('ELEVENLABS_API_KEY');
  });

  it('HeyGen : suit le drapeau global — actif → disponible ; absent → message générique qui rappelle que la voix marche ; le gate D-ID ne l’active pas', () => {
    expect(moteurJumeauDisponiblePour('heygen', ENV_MOTEUR_HEYGEN)).toEqual({ disponible: true, message: null });
    const sans = moteurJumeauDisponiblePour('heygen', {} as unknown as NodeJS.ProcessEnv);
    expect(sans.disponible).toBe(false);
    expect(sans.message).toBe(MESSAGE_MOTEUR_JUMEAU_INDISPONIBLE);
    expect(sans.message).toContain('voix reste utilisable');
    expect(moteurJumeauDisponiblePour('heygen', ENV_APERCU_DID).disponible).toBe(false);
  });

  it('fournisseur inconnu : jamais disponible, quelles que soient les clés', () => {
    const r = moteurJumeauDisponiblePour('inconnu', { ...ENV_MOTEUR_HEYGEN, ...ENV_APERCU_DID } as unknown as NodeJS.ProcessEnv);
    expect(r.disponible).toBe(false);
    expect(r.message).toBe(MESSAGE_MOTEUR_JUMEAU_FOURNISSEUR_INCONNU);
  });
});

describe('JumeauAutopilote avec un avatar D-ID', () => {
  const fetchOriginal = globalThis.fetch;
  const stub = (moteurDisponible: boolean) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        pret: true, motif: null, message: null,
        jumeau: { avatar: { id: 'a', version: 1, nom: 'Bassi', valideLe: '2026-09-15', fournisseur: 'did' }, voix: { id: 'v-compte', nom: 'Bassi' }, prononciations: 0 },
        moteurDisponible,
        messageMoteur: moteurDisponible ? null : MESSAGE_MOTEUR_JUMEAU_DID_NON_CONFIGURE,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  };
  beforeEach(() => { stub(false); });
  afterEach(() => { cleanup(); globalThis.fetch = fetchOriginal; });

  it('moteur vidéo INDISPONIBLE : la voix reste activable, et le bloc dit honnêtement que la vidéo n’est pas disponible (le message serveur), sans rien promettre', async () => {
    const onChange = vi.fn();
    // `onAvatarChange` fourni, mais le moteur est indisponible (stub(false)) :
    // l'interrupteur vidéo ne doit PAS apparaître.
    render(<JumeauAutopilote actif={false} onChange={onChange} onAvatarChange={() => {}} jumeauReady voixCompte={[{ id: 'elevenlabs-xyz', accountVoiceId: 'v-compte' }]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    const sw = screen.getByRole('switch', { name: 'Utiliser mon jumeau' }) as HTMLInputElement;
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true, 'elevenlabs-xyz');
    const bloc = document.querySelector('[data-jumeau-autopilote]')!.textContent!;
    expect(bloc).toContain('Voix du jumeau prête pour la narration');
    expect(bloc).not.toContain('pas encore pris en charge');
    // Pas d'interrupteur vidéo quand le moteur est indisponible.
    expect(document.querySelector('[data-jumeau-autopilote-avatar]')).toBeNull();
    // Le bloc vidéo affiche le message serveur (D-ID non configuré), sans promesse.
    const video = document.querySelector('[data-jumeau-autopilote-video="indisponible"]')!.textContent!;
    expect(video).toContain('n’est pas configuré sur ce serveur');
  });

  it('moteur vidéo DISPONIBLE + migration appliquée : l’interrupteur « Monter la vidéo de mon jumeau » apparaît et le clic l’active', async () => {
    stub(true);
    const onAvatarChange = vi.fn();
    render(<JumeauAutopilote actif={false} onChange={() => {}} onAvatarChange={onAvatarChange} avatarActif={false} jumeauReady voixCompte={[{ id: 'elevenlabs-xyz', accountVoiceId: 'v-compte' }]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    const bloc = document.querySelector('[data-jumeau-autopilote]')!.textContent!;
    expect(bloc).toContain('Monter la vidéo de mon jumeau');
    const sw = screen.getByRole('switch', { name: 'Monter la vidéo de mon jumeau' }) as HTMLInputElement;
    expect(sw).not.toBeNull();
    fireEvent.click(sw);
    expect(onAvatarChange).toHaveBeenCalledWith(true);
  });

  it('moteur DISPONIBLE mais migration ABSENTE (jumeauReady=false) : pas d’interrupteur, un message qui nomme la migration', async () => {
    stub(true);
    render(<JumeauAutopilote actif={false} onChange={() => {}} onAvatarChange={() => {}} avatarActif={false} jumeauReady={false} voixCompte={[{ id: 'elevenlabs-xyz', accountVoiceId: 'v-compte' }]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-autopilote-avatar]')).toBeNull();
    const video = document.querySelector('[data-jumeau-autopilote-video="migration"]')!.textContent!;
    expect(video).toContain('2026-09-23-autopilot-jumeau.sql');
  });
});

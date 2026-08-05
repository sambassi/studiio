import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { withTimeout, TTS_TIMEOUT_MS, SERVER_TTS_PROVIDER } from '@/lib/autopilot/voice';
import { sanitizeConfig, DEFAULT_CONFIG } from '@/lib/autopilot/rules';

/**
 * Le gel du cycle, et la voix devenue payante.
 *
 * ⚠️ LE DÉLAI ÉTAIT POSÉ APRÈS L'APPEL QUI PENDAIT.
 *
 * La version précédente gardait le FLUX (`data`, `end`, `error`) — donc tout
 * ce qui vient après `setMetadata()`. Or c'est `setMetadata()` qui ouvre le
 * WebSocket, et depuis une adresse de centre de données Microsoft ne refuse
 * pas : il ne répond jamais. Le `await` ne rendait pas la main, aucun délai
 * n'était encore armé, et le cycle entier restait suspendu — aucune vidéo, la
 * requête du cron sans fin. Un « default-safe » qui n'attrape que les
 * *erreurs* ne protège pas d'un *blocage*.
 *
 * ⚠️ ET LA VOIX EST DÉSORMAIS FACTURÉE. ElevenLabs est le seul fournisseur
 * qui réponde depuis le serveur, mais il facture à l'usage : l'activer
 * d'office ferait payer une narration que personne n'a demandée. D'où un
 * réglage explicite, faux par défaut.
 */

const voix = readFileSync(resolve(__dirname, '../lib/autopilot/voice.ts'), 'utf-8');
const cron = readFileSync(resolve(__dirname, '../app/api/cron/autopilot/route.ts'), 'utf-8');
const panneau = readFileSync(resolve(__dirname, '../components/creer/AutopilotPanel.tsx'), 'utf-8');
const migration = readFileSync(
  resolve(__dirname, '../../migrations/2026-08-05-autopilot-voice-enabled.sql'), 'utf-8',
);

describe('Fix 1 — plus rien ne peut geler le cycle', () => {
  it('une promesse qui ne finit jamais rend `null` dans le délai', async () => {
    const debut = Date.now();
    const r = await withTimeout(new Promise<string>(() => { /* pend a jamais */ }), 120);
    expect(r).toBeNull();
    expect(Date.now() - debut).toBeLessThan(2000);
  });

  it('elle libère la ressource en expirant', async () => {
    // Sans ça, le WebSocket resterait ouvert derrière nous et le processus ne
    // se terminerait pas.
    let libere = false;
    await withTimeout(new Promise(() => {}), 60, () => { libere = true; });
    expect(libere).toBe(true);
  });

  it('une promesse qui aboutit passe normalement', async () => {
    expect(await withTimeout(Promise.resolve('ok'), 1000)).toBe('ok');
  });

  it('une promesse qui échoue rend `null`, sans lever', async () => {
    expect(await withTimeout(Promise.reject(new Error('boum')), 1000)).toBeNull();
  });

  it("L'OUVERTURE DE CONNEXION est DANS le délai", () => {
    // C'est tout le correctif : `setMetadata` est dans la promesse enveloppée,
    // pas avant elle.
    const bloc = voix.slice(voix.indexOf('async function synthetiserEdge'));
    const ouverture = bloc.indexOf('await tts.setMetadata');
    const enveloppe = bloc.indexOf('const travail = (async () => {');
    expect(enveloppe).toBeGreaterThan(-1);
    expect(enveloppe).toBeLessThan(ouverture);
    expect(bloc).toContain('await withTimeout(travail, TTS_TIMEOUT_MS');
  });

  it('le délai est court — un cycle ne doit pas attendre une minute par clip', () => {
    expect(TTS_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });

  it('ElevenLabs aussi est borné, et sa requête interrompue', () => {
    expect(voix).toContain('controleur.abort()');
    expect(voix).toContain('TTS_TIMEOUT_MS,');
  });
});

describe('Fix 2 — la voix est une option payante, décochée', () => {
  it('le défaut est FAUX', () => {
    expect(DEFAULT_CONFIG.voiceEnabled).toBe(false);
  });

  it('une colonne absente vaut « pas de voix »', () => {
    // Tant que la migration n'est pas appliquée, `voice_enabled` est
    // `undefined` : surtout pas une synthèse facturée.
    expect(sanitizeConfig({}).voiceEnabled).toBe(false);
    expect(sanitizeConfig({ voiceEnabled: undefined }).voiceEnabled).toBe(false);
    expect(sanitizeConfig({ voiceEnabled: 'oui' }).voiceEnabled).toBe(false);
    expect(sanitizeConfig({ voiceEnabled: true }).voiceEnabled).toBe(true);
  });

  it('le moteur n appelle AUCUN TTS quand c est désactivé', () => {
    // Sans ce garde, chaque montage déclencherait quatre synthèses payantes.
    expect(cron).toContain('config.voiceEnabled\n            ? await buildAutopilotVoices(');
    expect(cron).toContain(': {};');
  });

  it('le serveur passe par ElevenLabs — le seul qui réponde', () => {
    expect(SERVER_TTS_PROVIDER).toBe('elevenlabs');
    expect(voix).toContain('api.elevenlabs.io/v1/text-to-speech');
  });

  it('le manuel garde le service gratuit', () => {
    // Il tourne dans le navigateur de l'utilisateur, sur une adresse
    // résidentielle : Edge y répond.
    const client = readFileSync(resolve(__dirname, '../lib/tts/edge-tts-client.ts'), 'utf-8');
    expect(client).toContain('fr-FR-DeniseNeural');
    expect(voix).toContain("export type TtsProvider = 'edge' | 'elevenlabs';");
  });

  it('sans clé ElevenLabs : montage muet, pas d échec', () => {
    expect(voix).toContain('ELEVENLABS_API_KEY absente');
  });
});

describe('L option est visible et son coût annoncé', () => {
  it('l interrupteur écrit `voiceEnabled`', () => {
    expect(panneau).toContain('enregistrer({ voiceEnabled: !config.voiceEnabled })');
    expect(panneau).toContain('data-autopilot-voice');
  });

  it('le prix est dans l étiquette, pas dans une aide au survol', () => {
    expect(panneau).toContain('option payante');
    expect(panneau).toContain('crédits ElevenLabs');
  });

  it('et il dit ce qui se passe quand c est éteint', () => {
    expect(panneau).toContain('Aucune narration, aucun coût');
  });

  it('la colonne est ajoutée sans toucher aux lignes existantes', () => {
    expect(migration).toContain('add column if not exists voice_enabled boolean not null default false');
    // Les deux étapes que PostgREST exige (cf. CLAUDE.md).
    expect(migration).toContain('grant all on table public.autopilot_config to public');
    expect(migration).toContain('docker kill -s SIGUSR1 studiio-postgrest');
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * #541 — le prix « audio complet » ne s'applique QU'À l'opération autonome.
 * Stock, TTS internes, Créer, Jumeau, Autopilote, avatar : aucun nouveau
 * débit audio (VIDEO_TTS_DOUBLE_CHARGED = NON). Garde-fou sur les sources.
 */

const racine = process.cwd();
const lire = (p: string) => readFileSync(join(racine, p), 'utf-8');
function fichiers(dossier: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(racine, dossier))) {
    const p = `${dossier}/${n}`;
    if (statSync(join(racine, p)).isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const DEBIT = /deductCredits|debiterOperationAtomique|debiterRenduAtomique|getUserCredits|@\/lib\/credits/;

describe('Stock Pexels / Unsplash : 0 crédit', () => {
  it('ni le moteur stock ni ses routes ne touchent aux crédits', () => {
    for (const f of [...fichiers('src/lib/stock'), ...fichiers('src/app/api/stock'), 'src/app/api/pexels/route.ts']) {
      expect(DEBIT.test(lire(f)), f).toBe(false);
    }
  });
});

describe('Le débit « audio-complet » n’existe que dans sa route', () => {
  it('aucun autre fichier de src ne débite « audio-complet »', () => {
    const porteurs = fichiers('src')
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => /OPERATION_AUDIO_COMPLET|['"`]audio-complet['"`:]/.test(lire(f)) && /deductCredits\(/.test(lire(f)));
    expect(porteurs).toEqual(['src/app/api/voice/audio-complet/route.ts']);
  });

  it('les routes TTS internes (Créer, Jumeau, Autopilote) et la pré-écoute ne débitent rien', () => {
    for (const f of [...fichiers('src/app/api/tts'), 'src/app/api/voice/ecoute/route.ts', 'src/app/api/voice/prononciations/ecoute/route.ts', 'src/lib/autopilot/voice.ts']) {
      expect(DEBIT.test(lire(f)), f).toBe(false);
    }
  });

  it('Jumeau, Autopilote et avatar gardent leurs propres prix, sans audio en plus', () => {
    for (const f of ['src/lib/avatar/moteur-jumeau.ts', 'src/lib/autopilot/produire.ts', 'src/app/api/avatar/generate/route.ts', 'src/app/api/credits/deduct/route.ts', 'src/app/dashboard/creer/AssistantWizard.tsx']) {
      expect(lire(f), f).not.toMatch(/coutAudioComplet|audio-complet|OPERATION_AUDIO_COMPLET/);
    }
  });
});

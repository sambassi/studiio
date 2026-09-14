/**
 * A_8g — CE QUE LE JUMEAU DIT PASSE PAR LE PIPELINE PARLÉ A_8d, ET PAR LUI SEUL.
 *
 * Le texte affiché reste ce que la personne a écrit ; ce qui part au moteur
 * de synthèse est une vue — « 25 % » devient « vingt-cinq pour cent »,
 * « 18h30 » « dix-huit heures trente », « 25 CHF » « vingt-cinq francs
 * suisses », et « Afroboost » ce que le dictionnaire du compte en dit.
 *
 * ⚠️ AUCUN CHEMIN SPÉCIAL. Le script d'aperçu (A_8f) traverse la même porte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparerParoleJumeau } from '@/lib/avatar/parole-jumeau';
import { texteParle } from '@/lib/voice/pipeline';
import { SCRIPT_APERCU } from '@/lib/avatar/contrat';
import type { VoixJumeau } from '@/lib/avatar/voix-jumeau';

const VOIX: VoixJumeau = {
  userVoiceId: 'eeeeeeee-5555-4555-8555-555555555555', providerVoiceId: 'el_moi',
  provider: 'elevenlabs', nom: 'Ma voix', langue: 'fr-CH',
};
const AFROBOOST = [{ display: 'Afroboost', spoken: 'Afro boost' }];

describe('1. Le texte parlé du jumeau', () => {
  it('1.1 ⚠️ % / HEURES / CHF — sur le chemin jumeau réel', () => {
    const r = preparerParoleJumeau({
      voix: VOIX, displayScript: 'Profite de 25 % à partir de 18h30, seulement 25 CHF.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parole.spokenScript).toBe(
      'Profite de vingt-cinq pour cent à partir de dix-huit heures trente, seulement vingt-cinq francs suisses.',
    );
    expect(r.parole.langue).toBe('fr-CH');
  });

  it('1.2 ⚠️ LE TEXTE AFFICHÉ RESSORT INTACT', () => {
    const display = 'Profite de 25 % à partir de 18h30, seulement 25 CHF.';
    const r = preparerParoleJumeau({ voix: VOIX, displayScript: display });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.displayScript).toBe(display);
    expect(r.parole.displayScript).toContain('25 %');
    expect(r.parole.displayScript).toContain('18h30');
    expect(r.parole.displayScript).toContain('25 CHF');
    expect(r.parole.spokenScript).not.toContain('25');
  });

  it('1.3 ⚠️ LA PRONONCIATION DU COMPTE S’APPLIQUE, EN DERNIER', () => {
    const r = preparerParoleJumeau({
      voix: VOIX, displayScript: 'Afroboost à 18h30', prononciations: AFROBOOST,
    });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.spokenScript).toBe('Afro boost à dix-huit heures trente');
    expect(r.parole.displayScript).toBe('Afroboost à 18h30');
  });

  it('1.4 ⚠️ UN SEUL PIPELINE : le résultat est celui de `texteParle`, au caractère près', () => {
    const display = 'Rendez-vous chez Afroboost à 18h30, 25 CHF.';
    const r = preparerParoleJumeau({ voix: VOIX, displayScript: display, prononciations: AFROBOOST });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.spokenScript).toBe(texteParle(display, { langue: 'fr-CH', prononciations: AFROBOOST }));
  });

  it('1.5 la langue : celle passée, sinon celle de la voix, sinon fr-FR', () => {
    const a = preparerParoleJumeau({ voix: VOIX, displayScript: 'x', langue: 'fr-FR' });
    const b = preparerParoleJumeau({ voix: VOIX, displayScript: 'x' });
    const c = preparerParoleJumeau({ voix: { ...VOIX, langue: 'fr-FR' }, displayScript: 'x', langue: 'martien' });
    expect(a.ok && a.parole.langue).toBe('fr-FR');
    expect(b.ok && b.parole.langue).toBe('fr-CH');
    expect(c.ok && c.parole.langue).toBe('fr-FR');
  });

  it('1.6 ⚠️ SANS TEXTE, LE JUMEAU NE DIT RIEN — motif nommé, pas une phrase inventée', () => {
    expect(preparerParoleJumeau({ voix: VOIX, displayScript: '' })).toEqual({ ok: false, motif: 'script_absent' });
    expect(preparerParoleJumeau({ voix: VOIX, displayScript: '   ' })).toEqual({ ok: false, motif: 'script_absent' });
    expect(preparerParoleJumeau({ voix: VOIX, displayScript: null })).toEqual({ ok: false, motif: 'script_absent' });
  });

  it('1.7 la voix résolue est transmise telle quelle — référence Studiio en tête', () => {
    const r = preparerParoleJumeau({ voix: VOIX, displayScript: 'Bonjour' });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.voix.userVoiceId).toBe(VOIX.userVoiceId);
    expect(r.parole.voix.providerVoiceId).toBe('el_moi');
  });
});

describe('2. L’aperçu du clone traverse la même porte', () => {
  it('2.1 SCRIPT_APERCU est un DISPLAY_SCRIPT comme un autre', () => {
    const r = preparerParoleJumeau({ voix: VOIX, displayScript: SCRIPT_APERCU });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.displayScript).toBe(SCRIPT_APERCU);
    expect(r.parole.spokenScript).toBe(texteParle(SCRIPT_APERCU, { langue: 'fr-CH' }));
  });

  it('2.2 ⚠️ SI L’APERÇU PORTE UN JOUR DES CHIFFRES, LE MÊME NORMALISEUR LES DIRA', () => {
    const r = preparerParoleJumeau({ voix: VOIX, displayScript: `${SCRIPT_APERCU} Rendez-vous à 18h30.` });
    if (!r.ok) throw new Error('attendu ok');
    expect(r.parole.spokenScript).toContain('dix-huit heures trente');
  });
});

describe('3. Aucune deuxième implémentation', () => {
  const sansProse = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  it('3.1 ⚠️ `parole-jumeau` APPELLE `texteParle` et n’a ni normaliseur ni table à lui', () => {
    const src = sansProse(readFileSync(path.join(process.cwd(), 'src/lib/avatar/parole-jumeau.ts'), 'utf8'));
    expect(src).toContain("from '@/lib/voice/pipeline'");
    expect(src).toContain('texteParle(');
    expect(src).not.toMatch(/normaliserTexteParle\(|appliquerPrononciations\(|replace\(/);
    expect(src).not.toMatch(/pour cent|francs|heures/);
  });

  it('3.2 ⚠️ AUCUN APPEL FOURNISSEUR DANS LE CODE JUMEAU', () => {
    for (const f of ['src/lib/avatar/parole-jumeau.ts', 'src/lib/avatar/voix-jumeau.ts', 'src/lib/avatar/jumeau-serveur.ts']) {
      const src = sansProse(readFileSync(path.join(process.cwd(), f), 'utf8'));
      expect(src, f).not.toMatch(/fetch\(|elevenlabs\.io|heygen\.com|axios/);
    }
  });
});

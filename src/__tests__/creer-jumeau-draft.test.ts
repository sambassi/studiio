/**
 * A_8h — « UTILISER MON CLONE » DANS LE BROUILLON, ET CE QUE LE JUMEAU DIT.
 *
 *   - le brouillon ne porte qu'une INTENTION (`useDigitalTwin`), éteinte par
 *     défaut, relue seulement si elle vaut exactement `true` ;
 *   - le texte affiché du jumeau est celui des voix-off des séquences
 *     actives, dans l'ordre — jamais composé à la place de la personne ;
 *   - la création avec le clone est refusée nommément AVANT toute
 *     composition, et le parcours éteint est celui d'hier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import { displayScriptJumeau } from '@/lib/creer/jumeauScript';

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16', '1:1', '16:9'], maxStep: 3,
  defaults: {
    themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
      { key: 'video', enabled: false }, { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

describe('1. Le brouillon', () => {
  it('1.1 ⚠️ NOUVEAU PROJET / BROUILLON ANCIEN : ÉTEINT', () => {
    expect(lire({}).useDigitalTwin).toBeUndefined();
  });

  it('1.2 ⚠️ SEUL `true` ALLUME — pas une chaîne, pas un 1, pas un objet', () => {
    expect(lire({ useDigitalTwin: true }).useDigitalTwin).toBe(true);
    expect(lire({ useDigitalTwin: 'true' }).useDigitalTwin).toBeUndefined();
    expect(lire({ useDigitalTwin: 1 }).useDigitalTwin).toBeUndefined();
    expect(lire({ useDigitalTwin: {} }).useDigitalTwin).toBeUndefined();
    expect(lire({ useDigitalTwin: false }).useDigitalTwin).toBeUndefined();
  });

  it('1.3 ⚠️ LE BROUILLON NE PORTE NI AVATAR NI VOIX — une intention, rien d’autre', () => {
    /* Un identifiant rangé hier désignerait peut-être une version d'hier ;
       le serveur relit l'avatar vivant et la voix choisie à la création. */
    const d = lire({ useDigitalTwin: true, avatarId: 'x', userVoiceId: 'y', jumeau: { avatarId: 'x' } }) as unknown as Record<string, unknown>;
    expect(d.avatarId).toBeUndefined();
    expect(d.userVoiceId).toBeUndefined();
    expect(d.jumeau).toBeUndefined();
  });
});

describe('2. Ce que le jumeau dit : les voix-off des séquences actives, dans l’ordre', () => {
  const seq = (video = false) => [
    { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
    { key: 'video', enabled: video }, { key: 'cta', enabled: true },
  ];
  const voix = {
    titre: { text: 'Afroboost : 25 CHF à 18h30, -25 %.' },
    cartes: { text: '  Trois séances par semaine.  ' },
    video: { text: 'Regardez ceci.' },
    cta: { text: 'Réservez maintenant.' },
  };

  it('2.1 assemble les séquences actives, sans la vidéo désactivée', () => {
    expect(displayScriptJumeau(seq(false), voix))
      .toBe('Afroboost : 25 CHF à 18h30, -25 %. Trois séances par semaine. Réservez maintenant.');
  });

  it('2.2 la vidéo active entre à sa place', () => {
    expect(displayScriptJumeau(seq(true), voix)).toContain('Trois séances par semaine. Regardez ceci. Réservez');
  });

  it('2.3 ⚠️ LE TEXTE AFFICHÉ EST REPRIS TEL QUEL — 25 %, 18h30, CHF intacts', () => {
    const d = displayScriptJumeau(seq(), voix);
    expect(d).toContain('25 CHF');
    expect(d).toContain('18h30');
    expect(d).toContain('-25 %');
    expect(d).not.toMatch(/vingt-cinq|heures trente|francs/);
  });

  it('2.4 sans texte : chaîne vide → le serveur répondra script_absent', () => {
    expect(displayScriptJumeau(seq(), { titre: { text: '' }, cartes: {}, cta: { text: '   ' } })).toBe('');
  });
});

describe('3. Le geste « Créer ma vidéo » avec le clone', () => {
  const sansProse = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const WIZARD = sansProse(readFileSync(path.join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8'));

  it('3.1 ⚠️ LA GARDE PRÉCÈDE TOUTE COMPOSITION ET TOUT ÉTAT D’ENVOI', () => {
    const debut = WIZARD.indexOf('const runRenderInterne = async');
    const garde = WIZARD.indexOf('if (useDigitalTwin) {', debut);
    const envoi = WIZARD.indexOf('setSending(true);', debut);
    const composition = WIZARD.indexOf('composeVideo(optionsRendu)', debut);
    expect(garde).toBeGreaterThan(debut);
    expect(garde).toBeLessThan(envoi);
    expect(garde).toBeLessThan(composition);
    // La garde sort SANS composer : un `return` avant la fin du bloc.
    const bloc = WIZARD.slice(garde, WIZARD.indexOf('}', WIZARD.indexOf('setError(', garde)) + 1);
    expect(bloc).toContain('return;');
    expect(bloc).not.toContain('composeVideo');
  });

  it('3.2 ⚠️ LE NAVIGATEUR N’ENVOIE QUE LE TEXTE AFFICHÉ — ni avatar ni voix', () => {
    const debut = WIZARD.indexOf('const preparerContratJumeau');
    const corps = WIZARD.slice(debut, WIZARD.indexOf('const runRender = async'));
    expect(corps).toContain("fetch('/api/creer/jumeau'");
    expect(corps).toContain('JSON.stringify({ displayScript })');
    expect(corps).not.toMatch(/avatarId:|userVoiceId:|provider/);
  });

  it('3.3 le texte parlé vient de `displayScriptJumeau(sequences, sequenceVoices)`', () => {
    expect(WIZARD).toContain('displayScriptJumeau(sequences, sequenceVoices)');
  });

  it('3.4 ⚠️ ÉTEINT PAR DÉFAUT, ET LE BROUILLON NE L’ALLUME QUE SUR `true`', () => {
    expect(WIZARD).toContain('useState(false)');
    expect(WIZARD).toContain('if (draft.useDigitalTwin) setUseDigitalTwin(true);');
    expect(WIZARD).toContain('useDigitalTwin: useDigitalTwin || undefined,');
  });

  it('3.5 le bloc vit dans l’étape Sujet, avant « Continuer »', () => {
    const sujet = WIZARD.indexOf('{step === S.sujet && (');
    const bloc = WIZARD.indexOf('<JumeauCreerPanel', sujet);
    const continuer = WIZARD.indexOf('onClick={goToStyle}', sujet);
    expect(bloc).toBeGreaterThan(sujet);
    expect(bloc).toBeLessThan(continuer);
  });
});

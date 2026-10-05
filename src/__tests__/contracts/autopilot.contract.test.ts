/**
 * CONTRAT — AUTOPILOTE (LOCKED). Même règle de CTA que Créer ; tout repli est DIT.
 */
import { describe, it, expect } from 'vitest';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import type { PreparedPost } from '@/lib/autopilot/engine';
import { avertissementsMontage } from '@/lib/autopilot/produire';

const CTA = 'Réservez votre cours d’essai sur afroboost.com.';
const post = (brief?: PreparedPost['brief']): PreparedPost => ({
  title: 'danse', caption: '', scheduledDate: '2026-10-05', scheduledTime: '18:00', platforms: [],
  rushUrl: 'https://exemple.test/rush.mp4',
  content: { subtitle: 'Danser', tagLine: 'LE SPORT LE PLUS COMPLET', cards: [] } as unknown as PreparedPost['content'],
  ...(brief ? { brief } : {}),
});

describe('AUTOPILOTE — CTA', () => {
  it('CTA utilisateur rendu tel quel, jamais « LIEN EN BIO » à sa place', () => {
    const d = buildAutopilotDesign(post({ cta: CTA }), {}) as { ctaText?: string; ctaSubText?: string };
    expect(d.ctaText).toBe('LE SPORT LE PLUS COMPLET');
    expect(d.ctaSubText).toBe(CTA);
    expect(JSON.stringify(d)).not.toMatch(/LIEN EN BIO/i);
  });
  it('aucun CTA utilisateur → aucune ligne inventée', () => {
    expect((buildAutopilotDesign(post(), {}) as { ctaSubText?: string }).ctaSubText).toBeUndefined();
  });
});

describe('AUTOPILOTE — aucun repli silencieux', () => {
  const base = { musiqueIntrouvable: false, audioSilencieux: false, voixRepliEdge: false, montageSimple: false };
  it('rendu nominal → aucun avertissement', () => {
    expect(avertissementsMontage(base)).toEqual([]);
  });
  it('voix clonée remplacée par la voix standard → c’est dit', () => {
    expect(avertissementsMontage({ ...base, voixRepliEdge: true, voixPersonnelle: true }).join(' ')).toMatch(/Voix clonée indisponible/);
  });
  it('musique perdue, son absent, montage simplifié → chacun est dit', () => {
    const a = avertissementsMontage({ musiqueIntrouvable: true, audioSilencieux: true, voixRepliEdge: false, montageSimple: true });
    expect(a).toHaveLength(3);
  });
});

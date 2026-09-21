import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import JumeauPanel from '../components/creer/JumeauPanel';

/**
 * Le bloc « Jumeau numérique » de l'étape Sujet, et le champ de brouillon.
 *
 * DEUX intentions explicites (`jumeauMode`) : « Utiliser ma voix clonée »
 * (narration : pose la voix `elevenlabs-…` du compte, correspondance exacte
 * par `accountVoiceId`) et « Faire apparaître mon avatar parlant » (séquence
 * « Vidéo » à l'envoi, activable seulement si le moteur est disponible POUR
 * cet avatar — sinon le message nomme la dépendance et la case est inerte).
 * 'aucun' par défaut ; l'état vient du serveur ; quand ce n'est pas prêt,
 * l'écran dit quoi faire. Brouillon : `jumeauMode` explicite fait foi ; les
 * anciens brouillons `useDigitalTwin: true` → 'avatar' ; tout le reste →
 * 'aucun'.
 */

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16', '1:1', '16:9'], maxStep: 3,
  defaults: {
    themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) => sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

describe('Brouillon Créer — jumeauMode (rétro-compat useDigitalTwin)', () => {
  it('⚠️ absent (ancien brouillon) → aucun ; useDigitalTwin:true → avatar ; jumeauMode explicite fait foi ; valeurs inconnues → aucun', () => {
    expect(lire({}).jumeauMode).toBe('aucun');
    expect(lire({}).useDigitalTwin).toBe(false);
    expect(lire({ useDigitalTwin: false }).jumeauMode).toBe('aucun');
    expect(lire({ useDigitalTwin: true }).jumeauMode).toBe('avatar');
    expect(lire({ useDigitalTwin: true }).useDigitalTwin).toBe(true);
    for (const v of ['true', 1, {}, [], 'oui']) expect(lire({ useDigitalTwin: v }).jumeauMode, String(v)).toBe('aucun');
    expect(lire({ jumeauMode: 'voix' }).jumeauMode).toBe('voix');
    expect(lire({ jumeauMode: 'voix' }).useDigitalTwin).toBe(false);
    expect(lire({ jumeauMode: 'avatar' }).useDigitalTwin).toBe(true);
    // Explicite > historique, dans les deux sens.
    expect(lire({ jumeauMode: 'aucun', useDigitalTwin: true }).jumeauMode).toBe('aucun');
    expect(lire({ jumeauMode: 'voix', useDigitalTwin: true }).jumeauMode).toBe('voix');
    for (const v of ['AVATAR', 'video', 1, true, {}, null]) expect(lire({ jumeauMode: v }).jumeauMode, String(v)).toBe('aucun');
  });

  it('⚠️ aucun objet avatar/voix du navigateur n’est persisté comme autorité', () => {
    const d = lire({ jumeauMode: 'avatar', jumeau: { avatarId: 'x', providerAvatarId: 'y' }, voix: { providerVoiceId: 'z' } });
    expect(Object.keys(d)).not.toContain('jumeau');
    expect(Object.keys(d)).not.toContain('voix');
    expect(JSON.stringify(d)).not.toMatch(/providerAvatarId|providerVoiceId/);
  });
});

const MSG_DID = 'Votre avatar (créé à partir d’une vidéo) est prêt, mais le fournisseur d’avatar vidéo D-ID n’est pas configuré sur ce serveur (DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY). Aucun crédit n’est débité. Votre voix reste utilisable pour la narration.';
const MSG_HEYGEN = 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible — votre voix reste utilisable pour la narration.';
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 2, nom: 'Bassi', valideLe: '2026-09-03', fournisseur: 'heygen' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 2 }, moteurDisponible: false, messageMoteur: MSG_HEYGEN };
const PRET_DID = { ...PRET, jumeau: { ...PRET.jumeau, avatar: { ...PRET.jumeau.avatar, fournisseur: 'did' } } };
const VOIX_COMPTE = [{ id: 'elevenlabs-zzz', accountVoiceId: 'autre', name: 'Bassi' }, { id: 'elevenlabs-abc', accountVoiceId: 'v', name: 'Bassi' }];

function stub(etat: unknown, ok = true, voix: unknown[] = VOIX_COMPTE) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u === '/api/voice/clone') return { ok: true, status: 200, json: async () => ({ success: true, voices: voix }) } as unknown as Response;
    return { ok, status: ok ? 200 : 500, json: async () => (ok ? { success: true, data: etat } : { success: false }) } as unknown as Response;
  }) as unknown as typeof fetch;
}
const TEXTES = { titre: 'Bienvenue chez Afroboost', cartes: 'Trois conseils pour bien dormir', cta: 'Rejoignez-nous' };
const choix = (m: string) => document.querySelector(`[data-jumeau-choix="${m}"]`) as HTMLInputElement;
const monter = (props: Partial<Parameters<typeof JumeauPanel>[0]> = {}) => {
  const onModeChange = vi.fn(); const onVoixJumeau = vi.fn();
  render(<JumeauPanel mode="aucun" onModeChange={onModeChange} onVoixJumeau={onVoixJumeau} textes={TEXTES} coutAvatar={40} {...props} />);
  return { onModeChange, onVoixJumeau };
};
const attendrePret = () => waitFor(() => expect(document.querySelector('[data-jumeau-etat="pret"]')).not.toBeNull());

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('JumeauPanel — deux intentions, dites en clair', () => {
  it('⚠️ prêt (HeyGen, moteur indisponible) : avatar nommé « créé à partir d’une photo (HeyGen) », voix, CE QU’IL DIRA, mode aucun par défaut ; « ma voix clonée » activable et pose elevenlabs-abc (par accountVoiceId, jamais par le nom) ; « avatar parlant » inerte avec le message', async () => {
    stub(PRET);
    const { onModeChange, onVoixJumeau } = monter();
    await attendrePret();
    const panneau = document.querySelector('[data-jumeau-panel]')!;
    expect(panneau.getAttribute('data-jumeau-mode')).toBe('aucun');
    const t = panneau.textContent!;
    expect(t).toContain('Votre jumeau est prêt');
    expect(t).toContain('Avatar : Bassi (v2), validé — créé à partir d’une photo (HeyGen)');
    expect(t).toContain('Voix : Ma voix — Bassi');
    expect(t).toContain('2 prononciations personnalisées');
    // Ce qu'il dira : les textes de narration, séquence par séquence.
    const dira = document.querySelector('[data-jumeau-dira]')!.textContent!;
    expect(dira).toContain('Titre : Bienvenue chez Afroboost');
    expect(dira).toContain('Cartes : Trois conseils pour bien dormir');
    expect(dira).toContain('CTA : Rejoignez-nous');
    expect(dira).toContain('Modifiable dans le panneau des voix par séquence');
    expect(document.querySelector('[data-jumeau-dira-sequence="video"]')).toBeNull();
    // Les trois choix.
    expect(choix('aucun').checked).toBe(true);
    expect(choix('voix').disabled).toBe(false);
    expect(choix('avatar').disabled).toBe(true);
    expect(document.querySelector('[data-jumeau-moteur="indisponible"]')!.textContent).toContain(MSG_HEYGEN);
    expect(t).toContain('40 crédits en plus du rendu');
    fireEvent.click(choix('voix'));
    expect(onVoixJumeau).toHaveBeenCalledWith('elevenlabs-abc');
    expect(onVoixJumeau).not.toHaveBeenCalledWith('elevenlabs-zzz');
    expect(onModeChange).toHaveBeenCalledWith('voix');
    // La case inerte ne pose rien, même cliquée (jsdom déclenche onChange sur un disabled).
    fireEvent.click(choix('avatar'));
    expect(onModeChange).not.toHaveBeenCalledWith('avatar');
  });

  it('⚠️ avatar D-ID + moteur disponible : « créé à partir d’une vidéo (D-ID) », avatar parlant ACTIVABLE ; en mode avatar le récap dit séquence « Vidéo », votre voix, le coût', async () => {
    stub({ ...PRET_DID, moteurDisponible: true, messageMoteur: null });
    const { onModeChange, onVoixJumeau } = monter();
    await attendrePret();
    expect(document.querySelector('[data-jumeau-avatar]')!.textContent).toContain('créé à partir d’une vidéo (D-ID)');
    expect(choix('avatar').disabled).toBe(false);
    expect(document.querySelector('[data-jumeau-moteur="indisponible"]')).toBeNull();
    fireEvent.click(choix('avatar'));
    expect(onModeChange).toHaveBeenCalledWith('avatar');
    // Le mode avatar ne touche pas à la voix TTS des autres séquences.
    expect(onVoixJumeau).not.toHaveBeenCalled();
    cleanup();
    stub({ ...PRET_DID, moteurDisponible: true, messageMoteur: null });
    monter({ mode: 'avatar', voixCourante: 'fr-FR-DeniseNeural' });
    await attendrePret();
    expect(document.querySelector('[data-jumeau-panel]')!.getAttribute('data-jumeau-mode')).toBe('avatar');
    expect(choix('avatar').checked).toBe(true);
    const recap = document.querySelector('[data-jumeau-recap]')!.textContent!;
    expect(recap).toContain('la séquence « Vidéo » montre votre avatar (v2) disant ces textes avec votre voix (Bassi)');
    expect(recap).toContain('dite avec la voix choisie dans Audio');
    expect(recap).toContain('Coût : 40 crédits en plus du rendu');
    expect(document.querySelector('[data-jumeau-sequences]')!.textContent).toContain('séquence « Vidéo »');
  });

  it('⚠️ avatar D-ID + moteur INDISPONIBLE : le message nomme la dépendance (D-ID / variables), la case avatar est inerte, la voix reste activable ; une intention avatar posée retombe à aucun', async () => {
    stub({ ...PRET_DID, moteurDisponible: false, messageMoteur: MSG_DID });
    const { onModeChange } = monter({ mode: 'avatar' });
    await attendrePret();
    expect(choix('avatar').disabled).toBe(true);
    const moteur = document.querySelector('[data-jumeau-moteur="indisponible"]')!.textContent!;
    expect(moteur).toContain('D-ID');
    expect(moteur).toContain('DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY');
    expect(moteur).toContain('Aucun crédit n’est débité');
    expect(moteur).not.toContain('pas encore pris en charge');
    expect(choix('voix').disabled).toBe(false);
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('aucun'));
  });

  it('⚠️ mode voix : récap « Titre, Cartes et CTA … avec votre voix », avatar pas à l’image, aucun coût ; voix courante = celle du jumeau reconnue', async () => {
    stub(PRET);
    monter({ mode: 'voix', voixCourante: 'elevenlabs-abc' });
    await attendrePret();
    expect(choix('voix').checked).toBe(true);
    const recap = document.querySelector('[data-jumeau-recap]')!.textContent!;
    expect(recap).toContain('les séquences Titre, Cartes et CTA sont dites avec votre voix (Bassi)');
    expect(recap).toContain('Votre avatar n’apparaît pas à l’image');
    expect(recap).toContain('Aucun coût avatar');
    expect(document.querySelector('[data-jumeau-sequences]')!.textContent).toContain('Titre, Cartes, CTA');
    // Mode aucun : dit honnêtement qu'aucune des deux choses n'est dans la vidéo, avec la voix réellement utilisée.
    cleanup();
    stub(PRET);
    monter({ mode: 'aucun', voixCourante: 'elevenlabs-abc' });
    await attendrePret();
    expect(document.querySelector('[data-jumeau-recap]')!.textContent).toContain('ni votre voix ni votre avatar — la narration est dite avec votre voix (Bassi)');
  });

  it('⚠️ voix du jumeau sans correspondance dans /api/voice/clone : « ma voix clonée » inerte, le message dit pourquoi, rien n’est posé ; une intention voix posée retombe', async () => {
    stub(PRET, true, [{ id: 'elevenlabs-zzz', accountVoiceId: 'autre', name: 'Bassi' }]);
    const { onModeChange, onVoixJumeau } = monter({ mode: 'voix' });
    await attendrePret();
    expect(choix('voix').disabled).toBe(true);
    const msg = document.querySelector('[data-jumeau-voix-non-reliee]')!.textContent!;
    expect(msg).toContain('« Bassi »');
    expect(msg).toContain('n’est pas dans la liste des voix clonées de votre compte');
    fireEvent.click(choix('voix'));
    expect(onVoixJumeau).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalledWith('voix');
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('aucun'));
  });

  it('textes vides : « Ce qu’il dira » renvoie à l’étape Contenu ; un texte vidéo non vide est listé', async () => {
    stub(PRET);
    monter({ textes: {} });
    await attendrePret();
    expect(document.querySelector('[data-jumeau-dira]')!.textContent).toContain('seront ceux générés à l’étape Contenu');
    cleanup();
    stub(PRET);
    monter({ textes: { ...TEXTES, video: 'Regardez bien' } });
    await attendrePret();
    expect(document.querySelector('[data-jumeau-dira-sequence="video"]')!.textContent).toContain('Vidéo : Regardez bien');
  });

  it('⚠️ CAS non prêt : avatar non validé → message + « Gérer mon avatar » ; voix absente → « Configurer ma voix » ; choix requis ; serveur injoignable → aucun choix, intention retombée', async () => {
    stub({ pret: false, motif: 'avatar_non_valide', message: 'Votre avatar doit être validé avant de pouvoir utiliser votre jumeau.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    let r = monter({ mode: 'avatar' });
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="avatar_non_valide"]')).not.toBeNull());
    expect(document.body.textContent).toContain('Votre avatar doit être validé avant de pouvoir utiliser votre jumeau.');
    const lien = document.querySelector('[data-jumeau-action]') as HTMLAnchorElement;
    expect(lien.textContent).toBe('Gérer mon avatar');
    expect(lien.getAttribute('href')).toBe('/dashboard/avatar');
    expect(document.querySelector('[data-jumeau-choix="avatar"]')).toBeNull();
    await waitFor(() => expect(r.onModeChange).toHaveBeenCalledWith('aucun'));
    expect(document.querySelector('[data-jumeau-etat="pret"]')).toBeNull();
    cleanup();
    stub({ pret: false, motif: 'voix_absente', message: 'Ajoutez ou sélectionnez votre voix personnelle avant d’utiliser votre jumeau.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    monter();
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="voix_absente"]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-action]')!.textContent).toBe('Configurer ma voix');
    cleanup();
    stub({ pret: false, motif: 'choix_voix_requis', message: 'Sélectionnez la voix que votre jumeau doit utiliser.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    monter();
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="choix_voix_requis"]')).not.toBeNull());
    expect(document.body.textContent).toContain('Sélectionnez la voix que votre jumeau doit utiliser.');
    cleanup();
    stub(null, false);
    r = monter({ mode: 'voix' });
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="indisponible"]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-choix="voix"]')).toBeNull();
    await waitFor(() => expect(r.onModeChange).toHaveBeenCalledWith('aucun'));
  });
});

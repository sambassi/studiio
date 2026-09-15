import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';
import JumeauPanel from '../components/creer/JumeauPanel';

/**
 * Le bloc « Jumeau numérique » de l'étape Sujet, et le champ de brouillon.
 *
 * Désactivé par défaut ; l'état vient du serveur ; quand ce n'est pas prêt,
 * l'interrupteur est inerte et l'écran dit quoi faire ; les anciens
 * brouillons (sans `useDigitalTwin`) restent en mode normal ; seul `true`
 * active.
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

describe('Brouillon Créer — useDigitalTwin', () => {
  it('⚠️ absent (ancien brouillon) → false ; false → false ; seul le booléen true active ; "true", 1, objet → false', () => {
    expect(lire({}).useDigitalTwin).toBe(false);
    expect(lire({ useDigitalTwin: false }).useDigitalTwin).toBe(false);
    expect(lire({ useDigitalTwin: true }).useDigitalTwin).toBe(true);
    for (const v of ['true', 1, {}, [], 'oui']) expect(lire({ useDigitalTwin: v }).useDigitalTwin, String(v)).toBe(false);
  });

  it('⚠️ aucun objet avatar/voix du navigateur n’est persisté comme autorité', () => {
    const d = lire({ useDigitalTwin: true, jumeau: { avatarId: 'x', providerAvatarId: 'y' }, voix: { providerVoiceId: 'z' } });
    expect(Object.keys(d)).not.toContain('jumeau');
    expect(Object.keys(d)).not.toContain('voix');
    expect(JSON.stringify(d)).not.toMatch(/providerAvatarId|providerVoiceId/);
  });
});

const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 2, nom: 'Bassi', valideLe: '2026-09-03' }, voix: { id: 'v', nom: 'Bassi' }, prononciations: 2 }, moteurDisponible: false, messageMoteur: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' };

function stub(etat: unknown, ok = true) {
  globalThis.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => (ok ? { success: true, data: etat } : { success: false }) } as unknown as Response)) as unknown as typeof fetch;
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('JumeauPanel', () => {
  it('⚠️ CAS 1 prêt : « Votre jumeau est prêt », Avatar : Validé, Voix : Ma voix — Bassi ; interrupteur actif, désactivé par défaut', async () => {
    stub(PRET);
    const onChange = vi.fn();
    render(<JumeauPanel actif={false} onChange={onChange} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="pret"]')).not.toBeNull());
    const t = document.querySelector('[data-jumeau-panel]')!.textContent!;
    expect(t).toContain('Votre jumeau est prêt');
    expect(t).toContain('Avatar : Validé');
    expect(t).toContain('Voix : Ma voix — Bassi');
    expect(t).toContain('Votre avatar et votre voix personnelle seront utilisés pour présenter cette vidéo.');
    const sw = screen.getByRole('switch', { name: 'Utiliser mon jumeau' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('activé et moteur indisponible : la phrase honnête est affichée sous l’état prêt', async () => {
    stub(PRET);
    render(<JumeauPanel actif onChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-moteur="indisponible"]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-moteur="indisponible"]')!.textContent).toBe(PRET.messageMoteur);
  });

  it('⚠️ CAS 2 avatar non validé : message + « Gérer mon avatar » → /dashboard/avatar ; interrupteur inerte ; une intention active retombe', async () => {
    stub({ pret: false, motif: 'avatar_non_valide', message: 'Votre avatar doit être validé avant de pouvoir utiliser votre jumeau.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    const onChange = vi.fn();
    render(<JumeauPanel actif onChange={onChange} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="avatar_non_valide"]')).not.toBeNull());
    expect(document.body.textContent).toContain('Votre avatar doit être validé avant de pouvoir utiliser votre jumeau.');
    const lien = document.querySelector('[data-jumeau-action]') as HTMLAnchorElement;
    expect(lien.textContent).toBe('Gérer mon avatar');
    expect(lien.getAttribute('href')).toBe('/dashboard/avatar');
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    expect(onChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('[data-jumeau-etat="pret"]')).toBeNull();
  });

  it('CAS 3 voix absente → « Configurer ma voix » ; CAS 4 plusieurs voix sans choix → « Sélectionnez la voix… » ; CAS 5 serveur injoignable → inerte', async () => {
    stub({ pret: false, motif: 'voix_absente', message: 'Ajoutez ou sélectionnez votre voix personnelle avant d’utiliser votre jumeau.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    render(<JumeauPanel actif={false} onChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="voix_absente"]')).not.toBeNull());
    expect(document.querySelector('[data-jumeau-action]')!.textContent).toBe('Configurer ma voix');
    cleanup();
    stub({ pret: false, motif: 'choix_voix_requis', message: 'Sélectionnez la voix que votre jumeau doit utiliser.', jumeau: null, moteurDisponible: false, messageMoteur: null });
    render(<JumeauPanel actif={false} onChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="choix_voix_requis"]')).not.toBeNull());
    expect(document.body.textContent).toContain('Sélectionnez la voix que votre jumeau doit utiliser.');
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    cleanup();
    stub(null, false);
    render(<JumeauPanel actif={false} onChange={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-etat="indisponible"]')).not.toBeNull());
    expect((screen.getByRole('switch') as HTMLInputElement).disabled).toBe(true);
    expect(document.querySelector('[data-jumeau-etat="pret"]')).toBeNull();
  });
});

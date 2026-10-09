import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act, screen } from '@testing-library/react';

/**
 * MINI-STUDIO AVATAR — écrans. Tout est mocké : AUCUN fournisseur, AUCUN
 * crédit réel, aucune caméra réelle.
 */

const composeur = vi.hoisted(() => ({ downloadBlob: vi.fn(async () => {}), composeVideo: vi.fn(async () => ({ video: new Blob(['w'], { type: 'video/webm' }), thumbnail: null })) }));
vi.mock('@/lib/video-composer', () => composeur);

import EnregistreurSource from '../components/avatar/studio/EnregistreurSource';
import TexteAvecPrononciations from '../components/avatar/studio/TexteAvecPrononciations';
import MiniStudioAvatar from '../components/avatar/studio/MiniStudioAvatar';
import { CLE_GENERATION_STUDIO } from '../lib/avatar/studio';

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, blob: async () => new Blob(['mp4'], { type: 'video/mp4' }), headers: new Headers() } as unknown as Response);
const appels: Array<{ url: string; method: string; body?: string }> = [];
const GEN = '33333333-3333-4333-8333-000000000001';
const URL_VIDEO = `https://studiio.pro/storage/v1/object/public/media/u1/avatar/${GEN}.mp4`;
const serveur = {
  solde: 500 as number | null,
  prononciations: [{ affiche: 'NEJM', prononce: 'Nèjm' }] as Array<{ affiche: string; prononce: string }>,
  luts: [] as unknown[],
  statut: 'completed' as 'completed' | 'processing',
};
const PRET = { pret: true, motif: null, message: null, jumeau: { avatar: { id: 'a', version: 3, nom: 'Mon avatar', valideLe: '2026-10-07', fournisseur: 'heygen' }, voix: { id: 'uv1', nom: 'Bassi' }, prononciations: 1 }, moteurDisponible: true, messageMoteur: null };

beforeEach(() => {
  appels.length = 0;
  serveur.solde = 500; serveur.luts = []; serveur.statut = 'completed';
  serveur.prononciations = [{ affiche: 'NEJM', prononce: 'Nèjm' }];
  window.localStorage.clear();
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method, body: init?.body as string | undefined });
    if (u === '/api/creer/jumeau') return json(200, { success: true, data: PRET });
    if (u === '/api/credits/balance') return json(200, { ok: true, politique: 'credits', balance: serveur.solde });
    if (u === '/api/voice/profil') return json(200, { success: true, data: { voix: [], prononciations: serveur.prononciations, ecouteDisponible: true, voixResolue: { nom: 'Bassi' } } });
    if (u === '/api/voice/profil/prononciations') {
      const liste = JSON.parse(String(init?.body)).prononciations;
      serveur.prononciations = liste;
      return json(200, { success: true, data: { prononciations: liste } });
    }
    if (u === '/api/creatif/luts') return json(200, { ok: true, luts: serveur.luts });
    if (u === '/api/creer/jumeau/generer') return json(200, { success: true, data: { generationId: GEN, status: 'pending', avatarVersion: 3 } });
    if (u.startsWith('/api/avatar/status?generationId=')) return json(200, { success: true, data: { generationId: GEN, status: serveur.statut, videoUrl: serveur.statut === 'completed' ? URL_VIDEO : null, error: null, avatarVersion: 3 } });
    if (u === '/api/avatar/status') return json(200, { success: true, data: { generations: [
      { id: 'g-v3', status: 'completed', video_url: URL_VIDEO, created_at: '2026-10-08T10:00:00Z', avatar_version: 3, aspect_ratio: '9:16', intention: 'normale', user_avatar_id: 'a' },
      { id: 'g-v2', status: 'completed', video_url: URL_VIDEO, created_at: '2026-10-01T10:00:00Z', avatar_version: 2, aspect_ratio: '16:9', intention: 'normale', user_avatar_id: 'a' },
      { id: 'g-ap', status: 'completed', video_url: URL_VIDEO, created_at: '2026-10-07T10:00:00Z', avatar_version: 3, aspect_ratio: '9:16', intention: 'apercu', user_avatar_id: 'a' },
    ] } });
    if (u === URL_VIDEO) return json(200, {});
    return json(200, { success: true, data: {} });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const generations = () => appels.filter((a) => a.url === '/api/creer/jumeau/generer');

// ─────────────────────────────────────────────────────────────────────────
// Caméra + prompteur
// ─────────────────────────────────────────────────────────────────────────
class FauxRecorder {
  static instances: FauxRecorder[] = [];
  static isTypeSupported = (m: string) => m.startsWith('video/webm');
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: MediaStream, readonly options: { mimeType: string }) { FauxRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['images'], { type: 'video/webm' }) }); this.onstop?.(); }
}
const piste = (kind: string) => ({ kind, stop: vi.fn(), getSettings: () => ({ deviceId: `${kind}-1` }) });
const fauxFlux = { getTracks: () => [piste('video'), piste('audio')], getVideoTracks: () => [piste('video')], getAudioTracks: () => [] } as unknown as MediaStream;

function installerCamera(comportement: 'ok' | 'refus' | 'absente') {
  FauxRecorder.instances = [];
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FauxRecorder;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (comportement === 'refus') throw Object.assign(new Error('x'), { name: 'NotAllowedError' });
        if (comportement === 'absente') throw Object.assign(new Error('x'), { name: 'NotFoundError' });
        return fauxFlux;
      }),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput', deviceId: 'c1', label: 'Caméra A' }, { kind: 'videoinput', deviceId: 'c2', label: 'Caméra B' }, { kind: 'audioinput', deviceId: 'm1', label: 'Micro A' }]),
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
  if (!URL.createObjectURL) (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:prise';
  if (!URL.revokeObjectURL) (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
}

describe('Enregistrer ma source — caméra', () => {
  it('⚠️ permission refusée : message clair, sortie « Importer une vidéo », aucun envoi', async () => {
    installerCamera('refus');
    const importer = vi.fn();
    render(<EnregistreurSource mp4Requis={false} onUtiliser={vi.fn()} onImporterAlaPlace={importer} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/refusé/));
    fireEvent.click(screen.getByText('Importer une vidéo à la place'));
    expect(importer).toHaveBeenCalledTimes(1);
    expect(appels).toEqual([]);
  });

  it('caméra absente : message clair', async () => {
    installerCamera('absente');
    render(<EnregistreurSource mp4Requis={false} onUtiliser={vi.fn()} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/Aucune caméra/));
  });

  it('⚠️ MP4 exigé et navigateur WebM seulement : refus nommé AVANT d’ouvrir la caméra', async () => {
    installerCamera('ok');
    render(<EnregistreurSource mp4Requis onUtiliser={vi.fn()} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-erreur]')?.textContent).toMatch(/MP4/));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('⚠️ permission acceptée → choix caméra, prompteur, 3-2-1, enregistrement, arrêt, recommencer, utiliser : un FICHIER rendu, aucune requête réseau', async () => {
    installerCamera('ok');
    const utiliser = vi.fn();
    render(<EnregistreurSource mp4Requis={false} onUtiliser={utiliser} onImporterAlaPlace={vi.fn()} />);
    await act(async () => { fireEvent.click(q('[data-enregistreur-activer]')!); });
    await waitFor(() => expect(q('[data-enregistreur-source="pret"]')).not.toBeNull());
    expect(q<HTMLSelectElement>('[data-enregistreur-camera]')?.options).toHaveLength(2);

    // Prompteur : texte, vitesse, taille, miroir.
    fireEvent.click(q('[data-prompteur-ouvrir]')!);
    fireEvent.change(q('[data-prompteur-texte]')!, { target: { value: 'Bonjour, je suis Bassi.' } });
    fireEvent.change(q('[data-prompteur-taille]')!, { target: { value: '40' } });
    fireEvent.change(q('[data-prompteur-vitesse]')!, { target: { value: '7' } });
    fireEvent.click(q('[data-prompteur-miroir]')!);
    expect(q('[data-prompteur]')?.textContent).toBe('Bonjour, je suis Bassi.');
    expect(q<HTMLElement>('[data-prompteur] p')!.style.fontSize).toBe('40px');
    expect(q<HTMLElement>('[data-prompteur]')!.style.transform).toBe('scaleX(-1)');

    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    expect(q('[data-enregistreur-decompte="3"]')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(q('[data-enregistreur-source="enregistrement"]')).not.toBeNull();
    // Le texte défile ; pause/reprise.
    expect(q('[data-prompteur-defilement="oui"]')).not.toBeNull();
    fireEvent.click(q('[data-prompteur-lecture]')!);
    expect(q('[data-prompteur-defilement="non"]')).not.toBeNull();
    // ⚠️ Le prompteur n'est PAS dans la vidéo : le recorder capte le flux CAMÉRA.
    expect(FauxRecorder.instances).toHaveLength(1);
    expect(FauxRecorder.instances[0].stream).toBe(fauxFlux);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(q('[data-enregistreur-duree]')?.textContent).toBe('0:02');
    vi.useRealTimers();

    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    expect(q('[data-enregistreur-source="apercu"]')).not.toBeNull();
    expect(q('[data-enregistreur-video="prise"]')).not.toBeNull();
    fireEvent.click(q('[data-enregistreur-recommencer]')!);
    expect(q('[data-enregistreur-source="pret"]')).not.toBeNull();
    expect(utiliser).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.click(q('[data-enregistreur-demarrer]')!);
    await act(async () => { vi.advanceTimersByTime(3100); });
    vi.useRealTimers();
    await act(async () => { fireEvent.click(q('[data-enregistreur-arreter]')!); });
    fireEvent.click(q('[data-enregistreur-utiliser]')!);
    expect(utiliser).toHaveBeenCalledTimes(1);
    const fichier = utiliser.mock.calls[0][0] as File;
    expect(fichier.type).toBe('video/webm');
    expect(fichier.name).toBe('ma-source-avatar.webm');
    // ⚠️ Rien envoyé, rien écrit : le fichier repart vers le parcours d'import
    // (consentement). Seule lecture : le dictionnaire de prononciations du prompteur.
    expect(appels.filter((x) => x.method !== 'GET')).toEqual([]);
    expect(appels.some((x) => x.url.startsWith('/api/avatar'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Prononciations
// ─────────────────────────────────────────────────────────────────────────
describe('Mots difficiles — le dictionnaire du compte, jamais un second', () => {
  it('⚠️ sélection « Neuchâtel » → prononciation enregistrée par la route EXISTANTE, liste complète conservée ; texte visible inchangé, texte parlé corrigé', async () => {
    let valeur = 'Bienvenue au cours Afroboost à Neuchâtel.';
    const onChange = vi.fn((v: string) => { valeur = v; });
    render(<TexteAvecPrononciations valeur={valeur} onChange={onChange} montrerParle />);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/voice/profil')).toBe(true));
    const zone = q<HTMLTextAreaElement>('textarea')!;
    const d = valeur.indexOf('Neuchâtel');
    zone.setSelectionRange(d, d + 'Neuchâtel'.length);
    fireEvent.select(zone);
    expect(q('[data-prononciation-ajouter]')?.textContent).toContain('« Neuchâtel »');
    fireEvent.click(q('[data-prononciation-ajouter]')!);
    expect(q<HTMLInputElement>('[data-prononciation-mot]')!.value).toBe('Neuchâtel');
    fireEvent.change(q('[data-prononciation-prononce]')!, { target: { value: 'Neu-cha-tel' } });
    await act(async () => { fireEvent.click(q('[data-prononciation-enregistrer]')!); });
    await waitFor(() => expect(q('[data-prononciation-message="succes"]')).not.toBeNull());
    const put = appels.find((a) => a.url === '/api/voice/profil/prononciations' && a.method === 'PUT')!;
    expect(JSON.parse(put.body!).prononciations).toEqual([{ affiche: 'NEJM', prononce: 'Nèjm' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }]);
    expect(onChange).not.toHaveBeenCalled();
    expect(zone.value).toBe('Bienvenue au cours Afroboost à Neuchâtel.');
    await waitFor(() => expect(q('[data-texte-parle]')?.textContent).toContain('Neu-cha-tel'));
  });

  it('doublon : refus nommé, rien écrit', async () => {
    render(<TexteAvecPrononciations valeur="Le NEJM" onChange={vi.fn()} />);
    await waitFor(() => expect(appels.some((a) => a.url === '/api/voice/profil')).toBe(true));
    fireEvent.click(q('[data-prononciation-ajouter]')!);
    fireEvent.change(q('[data-prononciation-mot]')!, { target: { value: 'nejm' } });
    fireEvent.change(q('[data-prononciation-prononce]')!, { target: { value: 'Nedj' } });
    await act(async () => { fireEvent.click(q('[data-prononciation-enregistrer]')!); });
    await waitFor(() => expect(q('[data-prononciation-message="erreur"]')).not.toBeNull());
    expect(appels.filter((a) => a.method === 'PUT')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Faire parler mon avatar — crédits, génération, téléchargement
// ─────────────────────────────────────────────────────────────────────────
describe('Faire parler mon avatar', () => {
  const ecrire = (t: string) => fireEvent.change(q('[data-mini-studio-texte]')!, { target: { value: t } });

  it('⚠️ Avatar actif · v3, voix, coût et solde visibles AVANT toute génération ; rien n’est lancé au chargement', async () => {
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-avatar]')?.textContent).toBe('Avatar actif · v3'));
    expect(q('[data-mini-studio]')!.textContent).toContain('Voix : Ma voix — Bassi');
    await waitFor(() => expect(q('[data-mini-studio-cout]')!.textContent).toContain('Votre solde : 500 crédits'));
    expect(q('[data-mini-studio-cout-valeur]')!.textContent).toBe('40 crédits');
    expect(q<HTMLButtonElement>('[data-mini-studio-generer]')!.disabled).toBe(true);
    expect(generations()).toEqual([]);
  });

  it('⚠️ crédits insuffisants : bouton désactivé, « Crédits insuffisants », aucun appel', async () => {
    serveur.solde = 10;
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-insuffisant]')).not.toBeNull());
    ecrire('Bonjour');
    expect(q<HTMLButtonElement>('[data-mini-studio-generer]')!.disabled).toBe(true);
    fireEvent.click(q('[data-mini-studio-generer]')!);
    expect(generations()).toEqual([]);
  });

  it('⚠️ double clic : UNE génération, au format choisi, par la chaîne du jumeau ; puis « Votre vidéo est prête »', async () => {
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-avatar]')).not.toBeNull());
    await waitFor(() => expect(q('[data-mini-studio-cout]')!.textContent).toContain('500'));
    ecrire('Bonjour, je suis Bassi.');
    fireEvent.click(q('[data-mini-studio-format="1:1"]')!);
    await act(async () => {
      fireEvent.click(q('[data-mini-studio-generer]')!);
      fireEvent.click(q('[data-mini-studio-generer]')!);
    });
    await waitFor(() => expect(q('[data-mini-studio-resultat]')).not.toBeNull());
    expect(generations()).toHaveLength(1);
    expect(JSON.parse(generations()[0].body!)).toEqual({ textes: ['Bonjour, je suis Bassi.'], aspectRatio: '1:1' });
    expect(q('[data-mini-studio-resultat]')!.textContent).toContain('Votre vidéo est prête');
    expect(appels.some((a) => a.url === '/api/avatar/generate')).toBe(false);
  });

  it('⚠️ Télécharger MP4 : le fichier final lu tel quel — aucune nouvelle génération, aucun débit, aucun rendu', async () => {
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-cout]')!.textContent).toContain('500'));
    ecrire('Bonjour');
    await act(async () => { fireEvent.click(q('[data-mini-studio-generer]')!); });
    await waitFor(() => expect(q('[data-mini-studio-telecharger]')).not.toBeNull());
    const avant = generations().length;
    await act(async () => { fireEvent.click(q('[data-mini-studio-telecharger]')!); });
    await waitFor(() => expect(composeur.downloadBlob).toHaveBeenCalled());
    expect(appels.some((a) => a.url === URL_VIDEO)).toBe(true);
    expect(generations()).toHaveLength(avant);
    expect(composeur.composeVideo).not.toHaveBeenCalled();
    expect(appels.some((a) => a.url.startsWith('/api/render/jobs'))).toBe(false);
    const [blob, nom] = composeur.downloadBlob.mock.calls.at(-1) as unknown as [Blob, string];
    expect(blob.type).toBe('video/mp4');
    expect(nom).toMatch(/^mon-avatar-.*\.mp4$/);
  });

  it('⚠️ après un rafraîchissement : la génération mémorisée est REPRISE (statut), jamais relancée', async () => {
    window.localStorage.setItem(CLE_GENERATION_STUDIO, JSON.stringify({ generationId: GEN, format: '16:9', lanceeLe: Date.now() }));
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-resultat]')).not.toBeNull());
    expect(generations()).toEqual([]);
    expect(appels.some((a) => a.url.startsWith(`/api/avatar/status?generationId=${GEN}`))).toBe(true);
    expect(window.localStorage.getItem(CLE_GENERATION_STUDIO)).toBeNull();
  });

  it('⚠️ derniers rendus : une génération v2 est dite « ancienne version », jamais présentée comme l’avatar actif ; l’aperçu de validation n’y figure pas', async () => {
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(document.querySelectorAll('[data-mini-studio-rendu]')).toHaveLength(2));
    expect(q('[data-mini-studio-rendu="3"]')!.textContent).toContain('Avatar actif · v3');
    expect(q('[data-mini-studio-rendu="2"]')!.textContent).toContain('Créé avec Avatar v2 — ancienne version');
  });

  it('style visuel : Original + les LUT RÉELLES de la bibliothèque (3D seulement) — aucune collection inventée', async () => {
    serveur.luts = [
      { empreinte: 'a'.repeat(64), cle: 'k', nom: 'Cinéma maison', titre: null, kind: '3d', origine: 'cube', taille: 2, octets: 10, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-10-01' },
      { empreinte: 'b'.repeat(64), cle: 'k2', nom: 'Courbe 1D', titre: null, kind: '1d', origine: 'cube', taille: 2, octets: 10, domainMin: [0, 0, 0], domainMax: [1, 1, 1], importeeLe: '2026-10-01' },
    ];
    render(<MiniStudioAvatar />);
    await waitFor(() => expect(q('[data-mini-studio-lut="Cinéma maison"]')).not.toBeNull());
    expect(q('[data-mini-studio-lut="original"]')!.getAttribute('aria-checked')).toBe('true');
    expect(q('[data-mini-studio-lut="Courbe 1D"]')).toBeNull();
  });

  it('cadrage : 9:16 / 16:9 / 1:1 ; le recadrage réutilise CropRushModal (cadre 1:1)', async () => {
    render(<MiniStudioAvatar videoReference={URL_VIDEO} />);
    await waitFor(() => expect(q('[data-mini-studio-recadrer]')).not.toBeNull());
    expect(['9:16', '16:9', '1:1'].every((f) => q(`[data-mini-studio-format="${f}"]`))).toBe(true);
    fireEvent.click(q('[data-mini-studio-format="1:1"]')!);
    fireEvent.click(q('[data-mini-studio-recadrer]')!);
    await waitFor(() => expect(q('[data-recadrage-cadre="1:1"]')).not.toBeNull());
  });
});

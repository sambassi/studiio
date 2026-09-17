import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen, act } from '@testing-library/react';

/**
 * /dashboard/avatar — REFONTE « Mon avatar » (chantier 3 du cahier UX).
 *
 * Ces tests SPÉCIFIENT la page refondue, écrits AVANT l'implémentation : ils
 * échouent sur le code actuel là où la refonte n'est pas faite (c'est
 * attendu) et passent une fois la refonte livrée. Ils ne décrivent que ce que
 * la personne voit et fait — jamais l'implémentation.
 *
 * Ce que la page refondue montre :
 *   - un `EnteteSection` « Mon avatar » ;
 *   - un `FilEtapes` à 5 étapes (Source → Consentement → Entraînement →
 *     Aperçu → Validation) DÉRIVÉ de l'état serveur, et lui seul ;
 *   - une `Consigne` par étape (« quoi faire maintenant ») ;
 *   - deux colonnes : l'étape à gauche, UNE `ZoneApercu` à droite ;
 *   - la génération HeyGen à la demande seulement une fois l'avatar validé ;
 *   - une seule `Notification` sous l'en-tête (la plus récente remplace) ;
 *   - les régressions déjà couvertes ailleurs, toujours vraies.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => <div data-ma-voix-panel>Ma voix</div> }));
// La refonte peut naviguer (« Créer une vidéo ») : le routeur Next est factice, rien n'est asserté dessus.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/avatar',
  useSearchParams: () => new URLSearchParams(),
}));

import AvatarPage from '../app/dashboard/avatar/page';
import { installerXhrDeTest, type XhrDeTest } from './aides/xhr-de-test';

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';
const URL_APERCU = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/${G}.mp4`;
const URL_VIDEO = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/video-g2.mp4`;

type Ligne = Record<string, unknown> | null;
type Generation = { status: 'processing' | 'completed' | 'failed'; videoUrl: string | null; error: string | null };

/** L'état SERVEUR : la page ne montre que ce qu'il dit. */
const serveur = {
  avatar: null as Ligne,
  etape: 'consentement_a_demander',
  texte: null as string | null,
  nom: null as string | null,
  expireLe: null as string | null,
  apercu: { statut: 'aucun' } as Record<string, unknown>,
  /** Réponse de POST /api/avatar/generate pour l'APERÇU (HeyGen) : par défaut, la voix manque. */
  generate: { success: false, error: 'Voix indisponible', code: 'voix_indisponible' } as Record<string, unknown>,
  /** Ce que GET /api/avatar/status répond pour toute génération. */
  generation: { status: 'processing', videoUrl: null, error: null } as Generation,
};
const appels: Array<{ url: string; method: string; body?: unknown }> = [];

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method, body: init?.body });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    const ligne = () => (serveur.avatar ? { ...serveur.avatar, etape_did: serveur.etape, provider_consent_text: serveur.texte, consent_name: serveur.nom, consent_expire_le: serveur.expireLe } : null);
    if (u === '/api/avatar/create' && method === 'GET') return json(200, { success: true, data: { avatar: ligne(), voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri Bassi' } });
    if (u === '/api/avatar/create' && method === 'POST') {
      const fd = init?.body as FormData;
      const did = fd.get('provider') === 'did';
      serveur.avatar = { id: A, name: did ? 'Mon avatar vidéo' : 'Mon avatar', status: did ? 'source_ready' : 'training', avatar_type: did ? 'video' : 'photo', provider: did ? 'did' : 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat: did ? 'source_prete' : 'entrainement', version: 1, validated_at: null };
      return json(200, { success: true, data: { avatar: ligne() } });
    }
    if (u === '/api/avatar' && method === 'DELETE') { serveur.avatar = null; return json(200, { success: true, data: { sourceRetiree: true } }); }
    if (u === '/api/avatar/did/consentement' && method === 'POST') {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { nom?: string; renouveler?: boolean };
      serveur.nom = corps.nom ?? null; serveur.texte = `Je soussigné(e), ${serveur.nom}, confirme. pomme vélo nuage`; serveur.etape = 'consentement_texte_pret';
      serveur.expireLe = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      return json(200, { success: true, data: { texte: serveur.texte, nom: serveur.nom, etape: serveur.etape, deja: false, expireLe: serveur.expireLe } });
    }
    // ⚠️ La route vidéo AVANT le `startsWith` du consentement.
    if (u === '/api/avatar/did/consentement/video') { serveur.etape = 'consentement_en_verification'; return json(200, { success: true, data: { etape: serveur.etape } }); }
    if (u.startsWith('/api/avatar/did/consentement')) return json(200, { success: true, data: { etape: serveur.etape, texte: serveur.texte, nom: serveur.nom, expireLe: serveur.expireLe, erreur: null, reutilisable: null } });
    if (u === '/api/avatar/did/creer') { serveur.etape = 'creation_en_cours'; serveur.avatar = { ...serveur.avatar, status: 'processing', etat: 'entrainement' }; return json(200, { success: true, data: { etape: serveur.etape, avatarId: A, version: 1 } }); }
    if (u === '/api/avatar/did/apercu') { serveur.apercu = { statut: 'en_cours', generationId: G }; return json(200, { success: true, data: { generationId: G, display: 'x', spoken: 'x' } }); }
    if (u === '/api/avatar/generate') {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { intention?: string; script?: string };
      if (corps.intention === 'apercu') {
        if (serveur.generate.success) serveur.apercu = { statut: 'en_cours', generationId: G };
        return json(serveur.generate.success ? 200 : 409, serveur.generate.success ? { success: true, data: { generationId: G } } : serveur.generate);
      }
      return json(200, { success: true, data: { generationId: 'g2' } });
    }
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u === '/api/avatar/apercu/ouverture') {
      if (serveur.apercu.statut !== 'pret') return json(409, { success: false, error: "L'aperçu réel de votre avatar n'est pas encore disponible.", code: `apercu_${serveur.apercu.statut}` });
      return json(200, { success: true, data: { avatarId: A, version: 1, generationId: G, url: URL_APERCU, jeton: 'JETON-SERVEUR' } });
    }
    if (u === '/api/avatar/validation') {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { jeton?: string };
      if (corps.jeton !== 'JETON-SERVEUR') return json(409, { success: false, error: 'Ouvrez d’abord l’aperçu.', code: 'apercu_non_ouvert' });
      serveur.avatar = { ...serveur.avatar, etat: 'valide', validated_at: '2026-09-16T00:00:00Z' };
      serveur.apercu = { statut: 'aucun' };
      return json(200, { success: true, data: { avatarId: A, version: 1, validatedAt: '2026-09-16T00:00:00Z', dejaValide: false, etat: 'valide' } });
    }
    if (u.startsWith('/api/avatar/status')) {
      const g = serveur.generation;
      const generationId = u.split('generationId=')[1] ?? G;
      return json(200, { success: true, data: { generationId, status: g.status, videoUrl: g.videoUrl, error: g.error } });
    }
    return json(200, { success: true, data: { generations: [] } });
  }) as unknown as typeof fetch;
}

// ── Fabriques d'état serveur ─────────────────────────────────────────────
type EtatAvatar = 'entrainement' | 'entraine_non_valide' | 'valide' | 'echec';
const STATUT_HEYGEN: Record<EtatAvatar, string> = { entrainement: 'training', entraine_non_valide: 'completed', valide: 'completed', echec: 'failed' };
const avatarHeygen = (etat: EtatAvatar, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar', status: STATUT_HEYGEN[etat], avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat, version: 1, validated_at: etat === 'valide' ? '2026-09-16T11:00:00Z' : null, ...extra };
};
const avatarDid = (etape: string, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar vidéo', status: 'source_ready', avatar_type: 'video', provider: 'did', created_at: '2026-09-15T00:00:00Z', etat: 'source_prete', version: 1, validated_at: null, ...extra };
  serveur.etape = etape;
};
/** Un avatar D-ID à l'étape « phrase prête » (ou refusée), avec la phrase et le nom que le serveur rend. */
const avatarDidAvecPhrase = (etape: 'consentement_texte_pret' | 'consentement_refuse', extra: Record<string, unknown> = {}) => {
  avatarDid(etape, { consent_name: 'Henri Bassi', ...extra });
  serveur.texte = 'Je soussigné(e), Henri Bassi, confirme. pomme vélo nuage'; serveur.nom = 'Henri Bassi'; serveur.expireLe = new Date(Date.now() + 600_000).toISOString();
};

// ── Lecture de l'écran ───────────────────────────────────────────────────
const texte = () => document.body.textContent ?? '';
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
/** Le fil d'étapes : `{ cle: etat }`. */
const etatsFil = () => Object.fromEntries(qa('[data-fil-etapes] [data-etape]').map((e) => [e.getAttribute('data-etape'), e.getAttribute('data-etape-etat')]));
const CLES = ['source', 'consentement', 'entrainement', 'apercu', 'validation'] as const;
const LIBELLES = ['Source', 'Consentement', 'Entraînement', 'Aperçu', 'Validation'];
const filAttendu = (etats: Partial<Record<(typeof CLES)[number], string>>) => Object.fromEntries(CLES.map((c) => [c, etats[c] ?? 'a_venir']));
/** La Consigne DE LA PAGE (pas celle, interne, du panneau de consentement D-ID). */
const consignePage = () => qa('[data-consigne]').find((e) => !e.closest('[data-avatar-did]')) ?? null;
const titreConsigne = () => consignePage()?.querySelector('[data-consigne-titre]')?.textContent ?? null;
/** Les notifications DE LA PAGE (hors panneau D-ID, qui garde les siennes). */
const notifsPage = () => qa('[data-notification]').filter((e) => !e.closest('[data-avatar-did]'));
const actionApercu = (re: RegExp) => qa('[data-apercu-action]').find((b) => re.test(b.getAttribute('data-apercu-action') ?? '')) as HTMLButtonElement | undefined;
const precede = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const attendreFil = () => waitFor(() => expect(q('[data-fil-etapes]')).not.toBeNull());
/** Rend la page dans un état serveur, attend le fil, rend la main ; `cleanup` entre deux cas. */
const monterEtLireFil = async () => { cleanup(); render(<AvatarPage />); await attendreFil(); await tourner(); return etatsFil(); };
/** Rend la page et attend un hook EXISTANT (pour les régressions : elles ne dépendent pas de la refonte). */
const monterSur = async (sel: string) => { cleanup(); render(<AvatarPage />); await waitFor(() => expect(q(sel)).not.toBeNull()); await tourner(); };

let xhr: XhrDeTest;
beforeEach(() => {
  xhr = installerXhrDeTest();
  appels.length = 0; window.localStorage.clear();
  serveur.avatar = null; serveur.etape = 'consentement_a_demander'; serveur.texte = null; serveur.nom = null; serveur.expireLe = null; serveur.apercu = { statut: 'aucun' };
  serveur.generate = { success: false, error: 'Voix indisponible', code: 'voix_indisponible' };
  serveur.generation = { status: 'processing', videoUrl: null, error: null };
  stubApi();
});
afterEach(() => { cleanup(); xhr.restaurer(); vi.useRealTimers(); });

describe('A. Le fil d’étapes — dérivé de l’état serveur, et de lui seul', () => {
  it('⚠️ en-tête « Mon avatar » + sous-titre ; 5 étapes libellées dans l’ordre ; sans avatar → Source active (aria-current), le reste à venir', async () => {
    render(<AvatarPage />);
    await attendreFil();
    expect(q('[data-entete] [data-entete-titre]')?.textContent).toBe('Mon avatar');
    expect(q('[data-entete] [data-entete-sous-titre]')?.textContent).toMatch(/^Votre double vidéo, à partir d['’]une photo ou d['’]une vidéo\.$/);
    expect(qa('[data-fil-etapes] [data-etape]').map((e) => e.getAttribute('data-etape'))).toEqual([...CLES]);
    qa('[data-fil-etapes] [data-etape]').forEach((e, i) => expect(e.textContent, `étape ${i + 1}`).toContain(LIBELLES[i]));
    expect(etatsFil()).toEqual(filAttendu({ source: 'active' }));
    expect(q('[data-fil-etapes] [aria-current="step"]')?.getAttribute('data-etape')).toBe('source');
  });

  it('⚠️ D-ID, consentement : à demander / phrase prête / en vérification / réutilisable / accepté → Consentement active ; refusé → correction ; Source terminée partout', async () => {
    for (const etape of ['consentement_a_demander', 'consentement_reutilisable', 'consentement_en_verification', 'consentement_accepte']) {
      avatarDid(etape);
      expect(await monterEtLireFil(), etape).toEqual(filAttendu({ source: 'terminee', consentement: 'active' }));
    }
    avatarDidAvecPhrase('consentement_texte_pret');
    expect(await monterEtLireFil(), 'consentement_texte_pret').toEqual(filAttendu({ source: 'terminee', consentement: 'active' }));
    avatarDidAvecPhrase('consentement_refuse', { provider_consent_status: 'error' });
    expect(await monterEtLireFil(), 'consentement_refuse').toEqual(filAttendu({ source: 'terminee', consentement: 'correction' }));
    expect(q('[data-fil-etapes] [aria-current="step"]')?.getAttribute('data-etape')).toBe('consentement');
  });

  it('⚠️ entraînement : HeyGen `training` ou D-ID `creation_en_cours` → Entraînement active ; HeyGen `failed` ou D-ID `echec` → correction', async () => {
    avatarHeygen('entrainement');
    expect(await monterEtLireFil(), 'heygen training').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'active' }));
    avatarDid('creation_en_cours', { status: 'processing', etat: 'entrainement' });
    expect(await monterEtLireFil(), 'did creation_en_cours').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'active' }));
    avatarHeygen('echec', { training_error: 'face not detected' });
    expect(await monterEtLireFil(), 'heygen failed').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'correction' }));
    avatarDid('echec', { status: 'failed', etat: 'echec', training_error: 'face not detected' });
    expect(await monterEtLireFil(), 'did echec').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'correction' }));
  });

  it('⚠️ entraîné non validé : Aperçu active (aucun, en cours), correction (échec, indisponible) ; aperçu prêt → Aperçu terminée, Validation active', async () => {
    for (const apercu of [{ statut: 'aucun' }, { statut: 'en_cours', generationId: G }]) {
      avatarHeygen('entraine_non_valide'); serveur.apercu = apercu;
      expect(await monterEtLireFil(), apercu.statut).toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'active' }));
    }
    // `echec` et `indisponible` (vidéo non conservée, définitif pour la version) demandent une correction.
    for (const apercu of [{ statut: 'echec', generationId: G, erreur: 'x' }, { statut: 'indisponible', generationId: G }]) {
      avatarHeygen('entraine_non_valide'); serveur.apercu = apercu;
      expect(await monterEtLireFil(), apercu.statut).toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'correction' }));
    }
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    expect(await monterEtLireFil(), 'pret').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'terminee', validation: 'active' }));
    // Un avatar D-ID « prêt » suit la même règle : le fil ne dépend pas du fournisseur.
    avatarDid('pret', { status: 'completed', etat: 'entraine_non_valide' }); serveur.apercu = { statut: 'aucun' };
    expect(await monterEtLireFil(), 'did pret').toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'active' }));
  });

  it('⚠️ validé : les 5 étapes terminées, l’en-tête porte « Prêt » ; et l’ancien pipeline interne D-ID n’existe plus, dans aucun état', async () => {
    avatarHeygen('valide');
    expect(await monterEtLireFil()).toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'terminee', validation: 'terminee' }));
    expect(q('[data-entete] [data-entete-statut]')?.textContent?.trim()).toBe('Prêt');
    expect(q('[data-avatar-did-pipeline]')).toBeNull();
    for (const etape of ['consentement_a_demander', 'consentement_reutilisable', 'consentement_en_verification', 'consentement_accepte', 'pret']) {
      avatarDid(etape, etape === 'pret' ? { status: 'completed', etat: 'entraine_non_valide' } : {});
      await monterEtLireFil();
      expect(q('[data-avatar-did-pipeline]'), etape).toBeNull();
    }
    avatarDidAvecPhrase('consentement_texte_pret'); await monterEtLireFil();
    expect(q('[data-avatar-did-pipeline]'), 'consentement_texte_pret').toBeNull();
    avatarDidAvecPhrase('consentement_refuse', { provider_consent_status: 'error' }); await monterEtLireFil();
    expect(q('[data-avatar-did-pipeline]'), 'consentement_refuse').toBeNull();
    avatarDid('echec', { status: 'failed', etat: 'echec' }); await monterEtLireFil();
    expect(q('[data-avatar-did-pipeline]'), 'echec').toBeNull();
  });
});

describe('B. La consigne — « quoi faire maintenant », une par étape', () => {
  it('⚠️ Source : « À partir de quelle photo ? » ; en choisissant la vidéo → « À partir de quelle vidéo ? »', async () => {
    render(<AvatarPage />);
    await attendreFil();
    expect(titreConsigne()).toBe('À partir de quelle photo ?');
    fireEvent.click(screen.getByRole('button', { name: /À partir d’une vidéo/ }));
    expect(titreConsigne()).toBe('À partir de quelle vidéo ?');
    expect(qa('[data-consigne]')).toHaveLength(1);
  });

  it('⚠️ Consentement, Entraînement, Aperçu, Validation, Prêt : le titre exact de la consigne de la page suit l’étape', async () => {
    avatarDid('consentement_a_demander');
    await monterEtLireFil();
    expect(titreConsigne(), 'consentement').toBe('Confirmez votre nom, puis obtenez votre phrase.');
    avatarHeygen('entrainement');
    await monterEtLireFil();
    expect(titreConsigne(), 'entrainement heygen').toMatch(/^Plus rien à faire pour l['’]instant\.$/);
    avatarDid('creation_en_cours', { status: 'processing', etat: 'entrainement' });
    await monterEtLireFil();
    expect(titreConsigne(), 'entrainement did').toMatch(/^Plus rien à faire pour l['’]instant\.$/);
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterEtLireFil();
    expect(titreConsigne(), 'apercu').toBe('Regardez votre avatar avant de le valider.');
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    expect(titreConsigne(), 'validation').toBe('Ça vous ressemble ? Validez.');
    avatarHeygen('valide');
    await monterEtLireFil();
    expect(titreConsigne(), 'pret').toBe('Votre avatar est prêt.');
  });
});

describe('C. La zone d’aperçu — deux colonnes, UNE zone, quatre états', () => {
  it('⚠️ deux colonnes (étape à gauche, aperçu à droite), une seule ZoneApercu ; avant import → vide ; étapes 2–3 → la source dans une zone prête', async () => {
    render(<AvatarPage />);
    await attendreFil();
    const colonnes = q('[data-avatar-colonnes]')!;
    expect(colonnes).not.toBeNull();
    const etape = colonnes.querySelector('[data-avatar-colonne="etape"]')!;
    const apercu = colonnes.querySelector('[data-avatar-colonne="apercu"]')!;
    expect(etape).not.toBeNull(); expect(apercu).not.toBeNull();
    expect(precede(etape, apercu), 'la colonne étape précède l’aperçu').toBe(true);
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(apercu.querySelector('[data-apercu]')?.getAttribute('data-apercu')).toBe('vide');
    expect(etape.contains(consignePage()!), 'la consigne vit dans la colonne étape').toBe(true);
    // Étape 2 (D-ID, consentement) et étape 3 (HeyGen, entraînement) : la source est le média de la zone.
    avatarDid('consentement_a_demander');
    await monterEtLireFil();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-avatar-colonne="apercu"] [data-apercu="pret"] [data-avatar-source-apercu]')).not.toBeNull();
    avatarHeygen('entrainement');
    await monterEtLireFil();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-avatar-colonne="apercu"] [data-apercu="pret"] [data-avatar-source-apercu]')).not.toBeNull();
  });

  it('⚠️ étape Aperçu : aucun → vide + « Générer mon aperçu » ; en cours → chargement ; échec → erreur + « Relancer l’aperçu » (les hooks generer / en-cours restent)', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterEtLireFil();
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('vide');
    expect(q('[data-apercu="vide"] [data-apercu-action]')?.getAttribute('data-apercu-action')).toBe('Générer mon aperçu');
    expect(q('[data-avatar-apercu="generer"]')).not.toBeNull();
    expect(qa('[data-apercu]')).toHaveLength(1);

    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'en_cours', generationId: G };
    await monterEtLireFil();
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('chargement');
    expect(q('[data-avatar-apercu="en-cours"]')).not.toBeNull();
    expect(qa('[data-apercu]')).toHaveLength(1);

    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'echec', generationId: G, erreur: 'moteur indisponible' };
    await monterEtLireFil();
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('erreur');
    const relancer = actionApercu(/^Relancer l['’]aperçu$/);
    expect(relancer, '« Relancer l’aperçu » dans la zone en erreur').toBeTruthy();
    expect(q('[data-apercu="erreur"]')!.contains(relancer!)).toBe(true);
    expect(q('[data-avatar-apercu="generer"]')).not.toBeNull();
    expect(qa('[data-apercu]')).toHaveLength(1);
    // « Relancer » lance UNE nouvelle génération d'aperçu, comme « Générer ».
    serveur.generate = { success: true };
    await act(async () => { fireEvent.click(relancer!); });
    await tourner();
    expect(appels.filter((a) => a.url === '/api/avatar/generate' && a.method === 'POST')).toHaveLength(1);
  });

  it('⚠️ aperçu prêt : zone prête + « Voir mon aperçu » (hook voir) → la vraie vidéo DANS la zone → lecture réelle → « Valider mon avatar » → POST /api/avatar/validation avec le jeton', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('pret');
    const voir = actionApercu(/^Voir mon aperçu$/);
    expect(voir, '« Voir mon aperçu » est l’action suivante de la zone').toBeTruthy();
    expect(q('[data-apercu="pret"]')!.contains(voir!)).toBe(true);
    expect(q('[data-avatar-apercu="voir"]')).not.toBeNull();
    expect(q('video[data-avatar-apercu="video"]')).toBeNull();
    expect(q('[data-avatar-apercu="valider"]')).toBeNull();
    fireEvent.click(voir!);
    const video = await waitFor(() => q<HTMLVideoElement>('[data-apercu="pret"] video[data-avatar-apercu="video"]')!);
    expect(video).not.toBeNull();
    expect(video.getAttribute('src')).toBe(URL_APERCU);
    // Aucun jeton, aucun « Valider » avant le démarrage RÉEL de la lecture.
    expect(appels.some((a) => a.url === '/api/avatar/apercu/ouverture')).toBe(false);
    expect(q('[data-avatar-apercu="valider"]')).toBeNull();
    fireEvent.playing(video);
    await waitFor(() => expect(q('[data-avatar-apercu="valider"]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/apercu/ouverture' && a.method === 'POST')).toHaveLength(1);
    fireEvent.click(q('[data-avatar-apercu="valider"]')!);
    await waitFor(() => expect(etatsFil().validation).toBe('terminee'));
    const validation = appels.find((a) => a.url === '/api/avatar/validation' && a.method === 'POST')!;
    expect(JSON.parse(String(validation.body))).toEqual({ jeton: 'JETON-SERVEUR' });
    expect(qa('[data-apercu]')).toHaveLength(1);
  });

  it('⚠️ validé : la zone est prête avec l’avatar ; la vidéo HeyGen générée (« Votre vidéo ») arrive dans la MÊME zone, pas dans une carte à part', async () => {
    avatarHeygen('valide');
    await monterEtLireFil();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('pret');
    expect(q('[data-apercu="pret"] [data-apercu-media] video') ?? q('[data-apercu="pret"] [data-apercu-media] img'), 'un média dans la zone prête').not.toBeNull();
    // Génération à la demande : le fournisseur a fini → la vidéo est le média de la zone.
    serveur.generation = { status: 'completed', videoUrl: URL_VIDEO, error: null };
    fireEvent.change(q<HTMLTextAreaElement>('textarea')!, { target: { value: 'Bonjour, je suis votre avatar.' } });
    const generer = screen.getAllByRole('button', { name: /Générer/ }).find((b) => !/aperçu/i.test(b.textContent ?? ''))!;
    await act(async () => { fireEvent.click(generer); });
    await waitFor(() => expect(q(`[data-apercu="pret"] video[src="${URL_VIDEO}"]`)).not.toBeNull());
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-apercu="pret"]')!.textContent).toContain('Votre vidéo');
    expect(qa(`video[src="${URL_VIDEO}"]`)).toHaveLength(1);
  });
});

describe('D. La génération HeyGen à la demande — seulement sous « Prêt », sous la zone d’aperçu', () => {
  it('⚠️ avant validation (entraînement, entraîné non validé, aperçu prêt) : ni « Ce que dit votre avatar » ni bouton Générer ; validé → le formulaire apparaît APRÈS la ZoneApercu', async () => {
    avatarHeygen('entrainement');
    await monterEtLireFil();
    expect(texte(), 'entrainement').not.toContain('Ce que dit votre avatar');
    expect(q('textarea')).toBeNull();
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterEtLireFil();
    expect(texte(), 'entraine_non_valide').not.toContain('Ce que dit votre avatar');
    expect(q('textarea')).toBeNull();
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    expect(texte(), 'apercu pret').not.toContain('Ce que dit votre avatar');
    expect(screen.queryAllByRole('button', { name: /Générer/ }).filter((b) => !/aperçu/i.test(b.textContent ?? ''))).toHaveLength(0);

    avatarHeygen('valide');
    await monterEtLireFil();
    const label = qa('label').find((l) => /Ce que dit votre avatar/.test(l.textContent ?? ''));
    expect(label, 'le formulaire de génération').toBeTruthy();
    expect(q('textarea')).not.toBeNull();
    const generer = screen.getAllByRole('button', { name: /Générer/ }).find((b) => !/aperçu/i.test(b.textContent ?? ''));
    expect(generer).toBeTruthy();
    expect(precede(q('[data-apercu]')!, label!), 'la ZoneApercu précède le formulaire').toBe(true);
  });
});

describe('E. Les actions secondaires — en texte, sous la colonne étape', () => {
  it('⚠️ « Changer de source » et « Supprimer mon avatar » : dans la colonne étape, sans button-primary ; suppression en deux clics → DELETE une fois → retour à Source, zone vide', async () => {
    avatarHeygen('valide');
    await monterEtLireFil();
    const colonneEtape = q('[data-avatar-colonne="etape"]')!;
    const changer = screen.getByRole('button', { name: /Changer de source/ });
    const armer = q<HTMLButtonElement>('[data-avatar-supprimer="armer"]')!;
    expect(armer).not.toBeNull();
    expect(armer.textContent).toContain('Supprimer mon avatar');
    expect(colonneEtape.contains(changer)).toBe(true);
    expect(colonneEtape.contains(armer)).toBe(true);
    expect(changer.className).not.toMatch(/button-primary/);
    expect(armer.className).not.toMatch(/button-primary/);
    // Aucun DELETE au premier clic : il arme.
    fireEvent.click(armer);
    expect(appels.filter((a) => a.method === 'DELETE')).toHaveLength(0);
    const confirmer = q<HTMLButtonElement>('[data-avatar-supprimer="confirmer"]')!;
    expect(confirmer).not.toBeNull();
    expect(confirmer.className).not.toMatch(/button-primary/);
    await act(async () => { fireEvent.click(confirmer); });
    await waitFor(() => expect(etatsFil()).toEqual(filAttendu({ source: 'active' })));
    expect(appels.filter((a) => a.url === '/api/avatar' && a.method === 'DELETE')).toHaveLength(1);
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('vide');
    expect(q('[data-avatar-supprimer]')).toBeNull();
  });
});

describe('F. La notification — une seule, sous l’en-tête, la plus récente remplace', () => {
  it('⚠️ voix manquante → avertissement « Votre voix personnelle est nécessaire pour l’aperçu. » + « Configurer ma voix » ; une erreur suivante la REMPLACE (jamais deux notifications)', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterEtLireFil();
    expect(notifsPage()).toHaveLength(0);
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="generer"]')!); });
    await waitFor(() => expect(notifsPage()).toHaveLength(1));
    const avert = notifsPage()[0];
    expect(avert.getAttribute('data-notification')).toBe('avertissement');
    expect(avert.querySelector('[data-notification-titre]')?.textContent).toMatch(/^Votre voix personnelle est nécessaire pour l['’]aperçu\.$/);
    expect(avert.querySelector('[data-notification-action="principale"]')?.textContent).toContain('Configurer ma voix');
    // Dans la carte principale, sous le fil d'étapes (la notification concerne l'étape).
    expect(precede(q('[data-entete]')!, avert)).toBe(true);
    expect(q('[data-avatar-carte-principale]')!.contains(avert)).toBe(true);
    expect(precede(q('[data-fil-etapes]')!, avert)).toBe(true);
    // « Configurer ma voix » mène au panneau Ma voix.
    const zone = q('[data-avatar-ma-voix]')!;
    const defiler = vi.fn(); zone.scrollIntoView = defiler;
    fireEvent.click(avert.querySelector('[data-notification-action="principale"]')!);
    expect(defiler).toHaveBeenCalledTimes(1);
    // Une nouvelle notification (échec de lancement) prend la place : une seule à la fois.
    serveur.generate = { success: false, error: "L'aperçu n'a pas pu être lancé.", code: 'fournisseur_indisponible' };
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="generer"]')!); });
    await waitFor(() => expect(notifsPage()[0]?.getAttribute('data-notification')).toBe('erreur'));
    expect(notifsPage()).toHaveLength(1);
    expect(q('[data-notification="avertissement"]')).toBeNull();
  });

  it('⚠️ après validation : succès « Avatar validé. » avec l’action « Créer une vidéo » (secondaire : le CTA de l’écran est « Générer »), seule notification de la page', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    fireEvent.click(actionApercu(/^Voir mon aperçu$/)!);
    const video = await waitFor(() => q<HTMLVideoElement>('video[data-avatar-apercu="video"]')!);
    fireEvent.playing(video);
    await waitFor(() => expect(q('[data-avatar-apercu="valider"]')).not.toBeNull());
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="valider"]')!); });
    await waitFor(() => expect(notifsPage()).toHaveLength(1));
    const notif = notifsPage()[0];
    expect(notif.getAttribute('data-notification')).toBe('succes');
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe('Avatar validé.');
    expect(notif.querySelector('[data-notification-action="secondaire"]')?.textContent).toContain('Créer une vidéo');
    expect(notif.querySelector('[data-notification-action="principale"]')).toBeNull();
    expect(precede(q('[data-entete]')!, notif)).toBe(true);
    expect(q('[data-avatar-carte-principale]')!.contains(notif)).toBe(true);
    expect(precede(q('[data-fil-etapes]')!, notif)).toBe(true);
    expect(etatsFil()).toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'terminee', validation: 'terminee' }));
    expect(q('[data-entete] [data-entete-statut]')?.textContent?.trim()).toBe('Prêt');
  });

  it('⚠️ l’aperçu passe à prêt (suivi repris au montage, #406) : succès « Votre aperçu est prêt. » (information), UN SEUL « Voir mon aperçu » (dans la zone), sans clic ni nouveau POST', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'en_cours', generationId: G };
    render(<AvatarPage />);
    await tourner();
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('chargement');
    expect(notifsPage()).toHaveLength(0);
    serveur.generation = { status: 'completed', videoUrl: URL_APERCU, error: null };
    serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner(12);
    expect(q('[data-apercu]')?.getAttribute('data-apercu')).toBe('pret');
    expect(notifsPage()).toHaveLength(1);
    const notif = notifsPage()[0];
    expect(notif.getAttribute('data-notification')).toBe('succes');
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toBe('Votre aperçu est prêt.');
    expect(notif.querySelector('[data-notification-action]')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Voir mon aperçu/ })).toHaveLength(1);
    expect(q('[data-apercu="pret"]')!.contains(screen.getByRole('button', { name: /Voir mon aperçu/ }))).toBe(true);
    expect(appels.filter((a) => a.url === '/api/avatar/generate' || a.url === '/api/avatar/did/apercu')).toHaveLength(0);
    expect(etatsFil()).toEqual(filAttendu({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'terminee', validation: 'active' }));
  });
});

describe('G. Régressions à garder — ce qui était vrai reste vrai (indépendant des nouveaux hooks : vert avant ET après)', () => {
  it('⚠️ reprise du suivi d’un aperçu en cours au montage (#406) : GET /api/avatar/status part TOUT SEUL, sans clic, sans nouveau POST aperçu ; un seul timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    avatarDid('pret', { status: 'completed', etat: 'entraine_non_valide' }); serveur.apercu = { statut: 'en_cours', generationId: G };
    render(<AvatarPage />);
    await tourner();
    const statusCalls = () => appels.filter((a) => a.url.startsWith('/api/avatar/status')).length;
    expect(q('[data-avatar-apercu="en-cours"]')).not.toBeNull();
    expect(statusCalls()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(5000); });
    await tourner();
    expect(statusCalls()).toBe(2);
    expect(appels.filter((a) => a.url === '/api/avatar/did/apercu' || a.url === '/api/avatar/generate')).toHaveLength(0);
  });

  it('⚠️ envoi de la source par XHR : le pourcentage est celui des octets partis (5 o / 10 o → 50 %), puis l’avatar apparaît en entraînement', async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /À partir d’une photo/ })).toBeTruthy());
    const input = q<HTMLInputElement>('input[type="file"]')!;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'moi.jpg', { type: 'image/jpeg' })] } }); });
    fireEvent.click(screen.getByRole('checkbox'));
    xhr.retenir = true;
    xhr.etapes = [{ loaded: 5, total: 10 }];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Créer mon avatar/ })); });
    await tourner();
    const suivi = q('[data-progress-status="en_cours"]')!;
    expect(suivi).not.toBeNull();
    expect(suivi.getAttribute('data-progress-determinee')).toBe('oui');
    expect(suivi.querySelector('[data-progress-pourcentage]')?.textContent).toBe('50 %');
    expect(suivi.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
    expect(xhr.envois.map((e) => e.url)).toEqual(['/api/avatar/create']);
    expect(appels.filter((a) => a.url === '/api/avatar/create' && a.method === 'POST')).toHaveLength(0);
    await act(async () => { xhr.liberer(); });
    await waitFor(() => expect(texte()).toContain('Entraînement de votre avatar'));
    expect(texte()).not.toContain('Envoi de votre');
    expect(appels.filter((a) => a.url === '/api/avatar/create' && a.method === 'POST')).toHaveLength(1);
  });

  it('⚠️ aucun pourcentage fournisseur inventé : pendant l’entraînement (HeyGen et D-ID), la barre est INDÉTERMINÉE, sans pourcentage', async () => {
    avatarHeygen('entrainement');
    await monterSur('[data-progress-status="en_cours"]');
    let suivi = q('[data-progress-status="en_cours"]')!;
    expect(suivi.getAttribute('data-progress-determinee')).toBe('non');
    expect(suivi.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(suivi.querySelector('[data-progress-pourcentage]')).toBeNull();
    // Le seul chiffre autorisé est le « Progression du workflow » (étapes connues), nommé à part.
    expect(suivi.querySelector('[data-progress-workflow]')).not.toBeNull();
    avatarDid('creation_en_cours', { status: 'processing', etat: 'entrainement' });
    await monterSur('[data-avatar-did-entrainement] [data-progress-status="en_cours"]');
    suivi = q('[data-avatar-did-entrainement] [data-progress-status="en_cours"]')!;
    expect(suivi.getAttribute('data-progress-determinee')).toBe('non');
    expect(suivi.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
    expect(suivi.querySelector('[data-progress-pourcentage]')).toBeNull();
  });

  it('⚠️ D-ID : chaque bouton appelle SA route, une fois — « Obtenir ma phrase » (double clic → 1 POST), « Créer mon avatar » (double clic → 1 POST)', async () => {
    avatarDid('consentement_a_demander');
    await monterSur('[data-avatar-did-action="phrase"]');
    const phrase = q<HTMLButtonElement>('[data-avatar-did-action="phrase"]')!;
    await act(async () => { fireEvent.click(phrase); fireEvent.click(phrase); });
    await waitFor(() => expect(q('[data-avatar-did="consentement_texte_pret"]')).not.toBeNull());
    const demandes = appels.filter((a) => a.url === '/api/avatar/did/consentement' && a.method === 'POST');
    expect(demandes).toHaveLength(1);
    expect(JSON.parse(String(demandes[0].body))).toEqual({ nom: 'Henri Bassi', renouveler: false });

    avatarDid('consentement_accepte', { consent_name: 'Henri Bassi', provider_consent_status: 'done' });
    await monterSur('[data-avatar-did-accepte] [data-notification-action="principale"]');
    const creer = q<HTMLButtonElement>('[data-avatar-did-accepte] [data-notification-action="principale"]')!;
    await act(async () => { fireEvent.click(creer); fireEvent.click(creer); });
    await waitFor(() => expect(q('[data-avatar-did-entrainement]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/creer')).toHaveLength(1);
  });
});

describe('H. Un seul CTA, aucune impasse (correctif #409)', () => {
  it('⚠️ consentement accepté : exactement UNE action visible « Créer mon avatar » ; un clic (même double) → exactement un POST /api/avatar/did/creer', async () => {
    avatarDid('consentement_accepte', { consent_name: 'Henri Bassi', provider_consent_status: 'done' });
    await monterSur('[data-avatar-did-accepte] [data-notification-action="principale"]');
    const visibles = screen.getAllByRole('button', { name: /Créer mon avatar/ });
    expect(visibles).toHaveLength(1);
    expect(q('[data-avatar-did-action="creer"]'), 'plus de second bouton').toBeNull();
    expect(qa('[data-avatar-did] .button-primary')).toHaveLength(1);
    await act(async () => { fireEvent.click(visibles[0]); fireEvent.click(visibles[0]); });
    await waitFor(() => expect(q('[data-avatar-did-entrainement]')).not.toBeNull());
    expect(appels.filter((a) => a.url === '/api/avatar/did/creer' && a.method === 'POST')).toHaveLength(1);
  });

  it('⚠️ aperçu indisponible (vidéo non conservée) : message explicite, zone en erreur avec la seule sortie réelle « Changer de source » ; aucun POST fournisseur automatique ; le lien texte n’est pas dupliqué', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'indisponible', generationId: G };
    await monterEtLireFil();
    expect(q('[data-avatar-apercu="indisponible"]')).not.toBeNull();
    const zone = q('[data-apercu]')!;
    expect(zone.getAttribute('data-apercu')).toBe('erreur');
    expect(zone.textContent).toContain("n'a pas pu être conservée");
    expect(zone.textContent).not.toMatch(/pas encore disponible/);
    const sortie = actionApercu(/^Changer de source$/);
    expect(sortie, 'une sortie réelle').toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Changer de source/ })).toHaveLength(1);
    expect(q('[data-avatar-apercu="generer"]'), 'aucune relance possible pour cette version').toBeNull();
    expect(appels.filter((a) => a.method === 'POST')).toHaveLength(0);
    // La sortie ramène à l'import d'une nouvelle source — sans aucun appel fournisseur.
    await act(async () => { fireEvent.click(sortie!); });
    await waitFor(() => expect(etatsFil()).toEqual(filAttendu({ source: 'active' })));
    expect(appels.filter((a) => a.method === 'POST')).toHaveLength(0);
  });
});

describe('I. Un seul CTA principal visible à la fois — dans chaque état touché', () => {
  /** Les `.button-primary` de la page (les panneaux Voix sont factices ici). */
  const primaires = () => qa('.button-primary').filter((b) => !(b as HTMLButtonElement).hidden);

  it('⚠️ aperçu prêt : exactement une action visible « Voir mon aperçu »', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    expect(screen.getAllByRole('button', { name: /Voir mon aperçu/ })).toHaveLength(1);
    expect(primaires()).toHaveLength(1);
  });

  it('⚠️ consentement refusé (sans vidéo, avec vidéo choisie) et phrase expirée : au plus un `.button-primary` ; « Envoyer » désactivé ne ressemble pas à un CTA', async () => {
    avatarDidAvecPhrase('consentement_refuse', { provider_consent_status: 'error' });
    await monterEtLireFil();
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Réenregistrer']);
    const envoyer = q<HTMLButtonElement>('[data-avatar-did-action="video"]')!;
    expect(envoyer.disabled).toBe(true);
    expect(envoyer.className).not.toMatch(/button-primary/);
    // Une vidéo choisie : c'est « Envoyer » qui devient LE geste ; « Réenregistrer » redevient secondaire.
    const input = q<HTMLInputElement>('[data-avatar-did] input[type="file"]')!;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'c.mp4', { type: 'video/mp4' })] } }); });
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Envoyer ma vidéo de consentement']);
    expect(q('[data-avatar-did-refus]')).not.toBeNull();

    // Phrase expirée : « Obtenir une nouvelle phrase » est le seul CTA ; « Envoyer » reste visible, désactivé, secondaire.
    avatarDidAvecPhrase('consentement_texte_pret'); serveur.expireLe = new Date(Date.now() - 1000).toISOString();
    await monterEtLireFil();
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Obtenir une nouvelle phrase']);
    expect(q<HTMLButtonElement>('[data-avatar-did-action="video"]')!.disabled).toBe(true);
    // Refusée ET expirée : toujours un seul.
    avatarDidAvecPhrase('consentement_refuse', { provider_consent_status: 'error' }); serveur.expireLe = new Date(Date.now() - 1000).toISOString();
    await monterEtLireFil();
    expect(primaires()).toHaveLength(1);
  });

  it('⚠️ échec D-ID : une seule sortie « Changer de source » (la notification), pas de lien texte en double', async () => {
    avatarDid('echec', { status: 'failed', etat: 'echec', training_error: 'x' });
    await monterEtLireFil();
    expect(screen.getAllByRole('button', { name: /Changer de source/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Changer de vidéo/ })).toBeNull();
    expect(primaires()).toHaveLength(1);
  });

  it('⚠️ matrice : dans chaque état rendu par le chantier 3, au plus un `.button-primary`', async () => {
    const cas: Array<[string, () => void]> = [
      ['sans avatar', () => { serveur.avatar = null; }],
      ['did a_demander', () => avatarDid('consentement_a_demander')],
      ['did reutilisable', () => avatarDid('consentement_reutilisable')],
      ['did texte_pret', () => avatarDidAvecPhrase('consentement_texte_pret')],
      ['did en_verification', () => avatarDid('consentement_en_verification')],
      ['did accepte', () => avatarDid('consentement_accepte', { consent_name: 'Henri Bassi', provider_consent_status: 'done' })],
      ['did creation_en_cours', () => avatarDid('creation_en_cours', { status: 'processing', etat: 'entrainement' })],
      ['did pret', () => { avatarDid('pret', { status: 'completed', etat: 'entraine_non_valide' }); serveur.apercu = { statut: 'aucun' }; }],
      ['heygen entrainement', () => avatarHeygen('entrainement')],
      ['heygen failed', () => avatarHeygen('echec', { training_error: 'x' })],
      ['apercu aucun', () => { avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' }; }],
      ['apercu en_cours', () => { avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'en_cours', generationId: G }; }],
      ['apercu echec', () => { avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'echec', generationId: G, erreur: 'x' }; }],
      ['apercu indisponible', () => { avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'indisponible', generationId: G }; }],
      ['apercu pret', () => { avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU }; }],
      ['valide', () => avatarHeygen('valide')],
    ];
    for (const [nom, poser] of cas) {
      serveur.apercu = { statut: 'aucun' }; serveur.texte = null; serveur.nom = null; serveur.expireLe = null;
      poser();
      await monterEtLireFil();
      expect(primaires().length, `${nom} : ${primaires().map((b) => b.textContent?.trim()).join(' | ')}`).toBeLessThanOrEqual(1);
    }
    // Voix manquante à l'étape Aperçu : « Configurer ma voix » est LE CTA ; « Générer » passe en secondaire.
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterEtLireFil();
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="generer"]')!); });
    await waitFor(() => expect(q('[data-notification="avertissement"]')).not.toBeNull());
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Configurer ma voix']);
    expect(q('[data-avatar-apercu="generer"]')).not.toBeNull();
    // Aperçu prêt, lu : « Valider mon avatar » seul.
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monterEtLireFil();
    fireEvent.click(actionApercu(/^Voir mon aperçu$/)!);
    const video = await waitFor(() => q<HTMLVideoElement>('video[data-avatar-apercu="video"]')!);
    expect(primaires()).toHaveLength(0);
    fireEvent.playing(video);
    await waitFor(() => expect(q('[data-avatar-apercu="valider"]')).not.toBeNull());
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Valider mon avatar']);
    // Validé, notification « Avatar validé. » affichée : « Générer » est le seul primaire.
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="valider"]')!); });
    await waitFor(() => expect(etatsFil().validation).toBe('terminee'));
    expect(primaires().map((b) => b.textContent?.trim())).toEqual(['Générer (40 crédits)']);
  });
});

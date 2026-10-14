/**
 * A2.3 — RENDU SERVEUR DERRIÈRE UN INTERRUPTEUR : /api/render/jobs/[id]/serveur.
 *
 * Contrat : éteint par défaut (404 neutre avant toute lecture), administrateurs
 * seulement, une tentative `reserved` rendue UNE fois, confirmée par la MÊME
 * porte que le navigateur (`confirmerAvecPreuve`), place unique en processus,
 * délai qui annule le rendu, aucun réseau.
 *
 * Doublures : session, admin, service des rendus, politique, preuve objet,
 * téléversement, localisation des médias et worker Remotion. Le VRAI
 * `renderCreerSimple` est utilisé (espionné) : les props confiées au worker
 * doivent être exactement `versEntreeRemotion(spec)`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { existsSync, writeFileSync } from 'fs';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/admin', () => ({ isAdmin: (e: string | null | undefined) => e === 'admin@studiio.test' }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: new Proxy({}, { get: () => { throw new Error('base interdite dans ce test'); } }),
  supabase: {},
}));

const lireRendu = vi.fn();
const confirmerRendu = vi.fn();
const confirmerRenduSansDebit = vi.fn();
const cloreRendu = vi.fn();
const reserverRendu = vi.fn();
vi.mock('@/lib/rendus/service', () => ({
  lireRendu: (...a: unknown[]) => lireRendu(...a),
  confirmerRendu: (...a: unknown[]) => confirmerRendu(...a),
  confirmerRenduSansDebit: (...a: unknown[]) => confirmerRenduSansDebit(...a),
  cloreRendu: (...a: unknown[]) => cloreRendu(...a),
  reserverRendu: (...a: unknown[]) => reserverRendu(...a),
}));

const politiqueDeLUtilisateur = vi.fn();
vi.mock('@/lib/facturation/politique', () => ({
  politiqueDeLUtilisateur: (...a: unknown[]) => politiqueDeLUtilisateur(...a),
  consommeDesCredits: (p: string) => p === 'credits',
}));

const verifierObjet = vi.fn();
vi.mock('@/lib/storage/verifier-objet', () => ({ verifierObjet: (...a: unknown[]) => verifierObjet(...a) }));

const uploadToStorage = vi.fn();
vi.mock('@/lib/storage/upload', () => ({ uploadToStorage: (...a: unknown[]) => uploadToStorage(...a) }));

/** Localisation doublée : remplace l'URL vidéo par « notre » copie. */
const localiserEntreesRendu = vi.fn(async (d: Record<string, unknown>) => (
  typeof d.videoUrl === 'string' ? { ...d, videoUrl: 'https://studiio.pro/storage/v1/object/public/media/externes/v.mp4' } : { ...d }
));
vi.mock('@/lib/securite/medias-externes', () => ({
  localiserEntreesRendu: (...a: unknown[]) => localiserEntreesRendu(...(a as [Record<string, unknown>])),
}));

type ArgsWorker = { jobId: string; inputProps: Record<string, unknown>; cancelSignal?: (cb: () => void) => void };
const renderVideo = vi.fn(async (a: ArgsWorker) => ({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) }));
vi.mock('@/lib/render/worker', () => ({ renderVideo: (...a: unknown[]) => renderVideo(...(a as [ArgsWorker])) }));

const renderCreerSimpleEspion = vi.fn();
vi.mock('@/lib/render/creerSimple', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/render/creerSimple')>();
  return {
    ...actual,
    renderCreerSimple: (arg: Parameters<typeof actual.renderCreerSimple>[0]) => {
      renderCreerSimpleEspion(arg);
      return actual.renderCreerSimple(arg);
    },
  };
});

const { POST, GET } = await import('@/app/api/render/jobs/[id]/serveur/route');
const { POST: CONFIRMER } = await import('@/app/api/render/jobs/[id]/confirm/route');
const moteur = await import('@/lib/render/moteur-export-serveur');
const { versEntreeRemotion } = await import('@/lib/render/spec-rendu');

const SPEC = {
  title: 'Bouger chaque jour', subtitle: 'Trois minutes suffisent', format: '9:16',
  cards: [{ icon: 'Dumbbell', title: 'Force', description: 'x', value: '3' }],
  videoUrl: 'https://exemple.test/rush.mp4', introDuration: 3, ctaText: 'Go',
};
const ligne = (o: Record<string, unknown> = {}) => ({
  id: 'job-1', user_id: 'admin-1', operation: 'apercu', format: 'reel', cout: 10,
  bucket: 'media', cle_objet: 'admin-1/rendus/job-1.webm', etat: 'reserved', politique: 'credits', ...o,
});

/** Requête au corps BRUT : la route lit `req.text()` (borne de taille). */
const requete = (texte: string | Promise<string>, entetes: Record<string, string> = {}) => {
  const text = vi.fn(async () => texte);
  return { req: { text, headers: new Headers(entetes) }, text };
};
const postBrut = async (texte: string | Promise<string>, entetes: Record<string, string> = {}, id = 'job-1') => {
  const { req, text } = requete(texte, entetes);
  const res = await POST(req as never, { params: { id } } as never);
  return { status: res.status, body: await res.json(), headers: res.headers, text };
};
const post = async (body: unknown = { spec: SPEC }, id = 'job-1') => postBrut(JSON.stringify(body) ?? '', {}, id);
const get = async (id = 'job-1') => {
  const res = await GET({} as never, { params: { id } } as never);
  return { status: res.status, body: await res.json() };
};
/** Le travail de fond du job — connu même s'il est déjà terminé. */
const finTravail = async (id = 'job-1') => {
  const t = moteur.travailRenduServeur(id);
  expect(t, `travail de fond de ${id}`).toBeDefined();
  return t!;
};

/** Aucun effet, nulle part. */
const aucunEffet = () => {
  expect(renderVideo).not.toHaveBeenCalled();
  expect(uploadToStorage).not.toHaveBeenCalled();
  expect(confirmerRendu).not.toHaveBeenCalled();
  expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
  expect(cloreRendu).not.toHaveBeenCalled();
  expect(reserverRendu).not.toHaveBeenCalled();
  expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
};

beforeEach(() => {
  moteur.reinitialiserMoteurExportServeurPourTests();
  vi.stubGlobal('fetch', () => { throw new Error('réseau interdit dans ce test'); });
  process.env.MOTEUR_EXPORT_SERVEUR = 'true';
  for (const m of [authMock, lireRendu, confirmerRendu, confirmerRenduSansDebit, cloreRendu, reserverRendu,
    politiqueDeLUtilisateur, verifierObjet, uploadToStorage, renderVideo, renderCreerSimpleEspion, localiserEntreesRendu]) m.mockClear();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@studiio.test' } });
  lireRendu.mockReset();
  lireRendu.mockResolvedValue({ rendu: ligne(), socleAbsent: false });
  politiqueDeLUtilisateur.mockReset();
  politiqueDeLUtilisateur.mockResolvedValue({ politique: 'credits', role: 'admin' });
  verifierObjet.mockReset();
  verifierObjet.mockResolvedValue({ ok: true, taille: 200_000, contentType: 'video/mp4' });
  confirmerRendu.mockReset();
  confirmerRendu.mockResolvedValue({ ok: true, etat: 'confirmed', solde: 90, dejaConfirme: false, motif: null });
  confirmerRenduSansDebit.mockReset();
  confirmerRenduSansDebit.mockResolvedValue({ ok: true, etat: 'confirmed', dejaConfirme: false, motif: null });
  cloreRendu.mockReset();
  cloreRendu.mockResolvedValue({ ok: true, etat: 'failed' });
  uploadToStorage.mockReset();
  uploadToStorage.mockResolvedValue('https://studiio.pro/x');
  renderVideo.mockReset();
  renderVideo.mockImplementation(async (a: ArgsWorker) => ({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) }));
});

afterEach(() => {
  delete process.env.MOTEUR_EXPORT_SERVEUR;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('1-2. Interrupteur éteint → 404 neutre, rien n’est lu', () => {
  for (const valeur of [undefined, 'false', 'TRUE', '1', ' true', 'true ', 'yes']) {
    it(`MOTEUR_EXPORT_SERVEUR=${JSON.stringify(valeur)}`, async () => {
      if (valeur === undefined) delete process.env.MOTEUR_EXPORT_SERVEUR;
      else process.env.MOTEUR_EXPORT_SERVEUR = valeur;
      const r = await post();
      expect(r).toMatchObject({ status: 404, body: { ok: false } });
      expect(Object.keys(r.body)).toEqual(['ok']);
      const g = await get();
      expect(g).toEqual({ status: 404, body: { ok: false } });
      expect(authMock).not.toHaveBeenCalled();
      expect(lireRendu).not.toHaveBeenCalled();
      expect(localiserEntreesRendu).not.toHaveBeenCalled();
      aucunEffet();
    });
  }

  it('relu à chaque appel, jamais mémoïsé', async () => {
    process.env.MOTEUR_EXPORT_SERVEUR = 'false';
    expect(moteur.moteurExportServeurActif()).toBe(false);
    process.env.MOTEUR_EXPORT_SERVEUR = 'true';
    expect(moteur.moteurExportServeurActif()).toBe(true);
    delete process.env.MOTEUR_EXPORT_SERVEUR;
    expect(moteur.moteurExportServeurActif()).toBe(false);
  });
});

describe('3-4b. Accès', () => {
  it('3. sans session → même 404 neutre que l’interrupteur éteint (C2)', async () => {
    authMock.mockResolvedValue(null);
    const r = await post();
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ ok: false });
    expect(await get()).toEqual({ status: 404, body: { ok: false } });
    expect(lireRendu).not.toHaveBeenCalled();
    aucunEffet();
  });

  it('4. tentative d’autrui (lireRendu null) → 404, lecture filtrée par le propriétaire', async () => {
    lireRendu.mockResolvedValue({ rendu: null, socleAbsent: false });
    const r = await post({ spec: SPEC }, 'job-autrui');
    expect(r.status).toBe(404);
    expect(lireRendu).toHaveBeenCalledWith('admin-1', 'job-autrui');
    expect((await get('job-autrui')).status).toBe(404);
    aucunEffet();
  });

  it('socle absent → 503', async () => {
    lireRendu.mockResolvedValue({ rendu: null, socleAbsent: true });
    expect((await post()).status).toBe(503);
    aucunEffet();
  });

  it('4b. allumé mais non-administrateur → même 404 neutre, aucune lecture', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-2', email: 'quelquun@exemple.test' } });
    const r = await post();
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ ok: false });
    expect((await get()).body).toEqual({ ok: false });
    expect(lireRendu).not.toHaveBeenCalled();
    aucunEffet();
  });
});

describe('5-6. Job valide → 202, rendu, confirmation unique', () => {
  it('202 immédiat, puis rendu → téléversement à la clé de la ligne → une confirmation', async () => {
    const r = await post();
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ ok: true, jobId: 'job-1', etat: 'reserved', enCours: true });
    expect(await finTravail()).toEqual({ issue: 'confirme' });
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(uploadToStorage).toHaveBeenCalledTimes(1);
    expect(uploadToStorage).toHaveBeenCalledWith({
      filePath: path.join(os.tmpdir(), 'studiio-render-job-1.mp4'),
      bucket: 'media', storagePath: 'admin-1/rendus/job-1.webm', contentType: 'video/mp4',
    });
    expect(verifierObjet).toHaveBeenCalledTimes(1);
    expect(verifierObjet).toHaveBeenCalledWith('media', 'admin-1/rendus/job-1.webm', 'admin-1');
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledWith('admin-1', 'job-1', 200_000, 'video/mp4');
    expect(cloreRendu).not.toHaveBeenCalled();
    expect(reserverRendu).not.toHaveBeenCalled();
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });

  it('politique partenaire → confirmation SANS débit, une fois', async () => {
    politiqueDeLUtilisateur.mockResolvedValue({ politique: 'partner_cost_only', role: 'admin' });
    lireRendu.mockResolvedValue({ rendu: ligne({ politique: 'partner_cost_only' }), socleAbsent: false });
    await post();
    expect(await finTravail()).toEqual({ issue: 'confirme' });
    expect(confirmerRenduSansDebit).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).not.toHaveBeenCalled();
  });

  it('GET pendant le rendu : enCours true ; après : false', async () => {
    let lacher!: () => void;
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((ok) => {
      lacher = () => ok({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) });
    }));
    await post();
    await vi.waitFor(() => expect(renderVideo).toHaveBeenCalled());
    expect((await get()).body).toEqual({ ok: true, jobId: 'job-1', etat: 'reserved', enCours: true });
    lacher();
    await finTravail();
    expect((await get()).body.enCours).toBe(false);
  });
});

describe('7. Objet invalide → aucune confirmation, failed', () => {
  for (const motif of ['objet_absent', 'trop_petit', 'type_refuse'] as const) {
    it(motif, async () => {
      verifierObjet.mockResolvedValue({ ok: false, taille: 10, contentType: 'text/html', motif });
      await post();
      expect(await finTravail()).toEqual({ issue: 'echec', motif });
      expect(confirmerRendu).not.toHaveBeenCalled();
      expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
      expect(cloreRendu).toHaveBeenCalledTimes(1);
      expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', motif);
    });
  }
});

describe('8. Rendu échoué → failed', () => {
  it('le worker jette → failed rendu_echoue, ni téléversement ni confirmation', async () => {
    renderVideo.mockRejectedValue(new Error('chromium a planté sur /home/x'));
    await post();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'rendu_echoue' });
    expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', 'rendu_echoue');
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });

  it('localisation refusée (SSRF) → failed, aucun rendu', async () => {
    localiserEntreesRendu.mockRejectedValueOnce(new Error('RefusSsrf'));
    await post();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'localisation_refusee' });
    expect(renderVideo).not.toHaveBeenCalled();
  });

  it('téléversement échoué → failed, fichier temporaire effacé', async () => {
    const fichier = path.join(os.tmpdir(), `studiio-render-a23-test-${process.pid}.mp4`);
    renderVideo.mockImplementation(async () => { writeFileSync(fichier, 'x'); return { outputPath: fichier }; });
    uploadToStorage.mockRejectedValue(new Error('Storage upload failed'));
    await post();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'televersement_echoue' });
    expect(existsSync(fichier)).toBe(false);
    expect(confirmerRendu).not.toHaveBeenCalled();
  });
});

describe('9. Délai dépassé', () => {
  it('signal annulé, failed, place libérée seulement après la fin effective du rendu', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let annule = false;
    let demarre!: () => void;
    const aDemarre = new Promise<void>((ok) => { demarre = ok; });
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((_ok, ko) => {
      a.cancelSignal!(() => {
        annule = true;
        // Remotion met un moment à s'arrêter réellement.
        setTimeout(() => ko(new Error('renderMedia() got cancelled')), 5_000);
      });
      demarre();
    }));
    expect((await post()).status).toBe(202);
    await aDemarre;
    await vi.advanceTimersByTimeAsync(moteur.DELAI_RENDU_SERVEUR_MS - 1);
    expect(annule).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(annule).toBe(true);
    // P-b : la tentative est close TOUT DE SUITE ; annulé mais pas encore
    // arrêté, le rendu garde sa place.
    expect(cloreRendu).toHaveBeenCalledTimes(1);
    expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', 'delai_depasse');
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(1);
    expect(moteur.renduServeurEnCours('job-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'delai_depasse' });
    expect(cloreRendu).toHaveBeenCalledTimes(1);
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });

  it('délai injectable au niveau du module', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const place = moteur.prendreExecution('job-d');
    if (!place.ok) throw new Error('place');
    let demarre!: () => void;
    const aDemarre = new Promise<void>((ok) => { demarre = ok; });
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((_ok, ko) => {
      a.cancelSignal!(() => ko(new Error('cancelled')));
      demarre();
    }));
    const travail = moteur.executerRenduServeur({
      userId: 'admin-1', rendu: ligne({ id: 'job-d' }) as never, spec: SPEC as never, place: place.place, delaiMs: 50,
    });
    await aDemarre;
    await vi.advanceTimersByTimeAsync(50);
    expect(await travail).toEqual({ issue: 'echec', motif: 'delai_depasse' });
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });
});

describe('10-12. Ré-essais et concurrence', () => {
  it('10. après failed → 409, ni rendu ni confirmation', async () => {
    lireRendu.mockResolvedValue({ rendu: ligne({ etat: 'failed' }), socleAbsent: false });
    const r = await post();
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ ok: false, motif: 'etat_invalide', etat: 'failed' });
    aucunEffet();
  });

  it('11. deux requêtes simultanées sur le même job → un seul rendu, 409 deja_en_cours', async () => {
    let lacher!: () => void;
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((ok) => {
      lacher = () => ok({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) });
    }));
    const [a, b] = await Promise.all([post(), post()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    expect((a.status === 409 ? a : b).body).toMatchObject({ ok: false, motif: 'deja_en_cours' });
    await vi.waitFor(() => expect(renderVideo).toHaveBeenCalled());
    lacher();
    await finTravail();
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
  });

  it('11b. deux jobs différents → 429 + Retry-After pour le second, aucune ligne touchée', async () => {
    let lacher!: () => void;
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((ok) => {
      lacher = () => ok({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) });
    }));
    lireRendu.mockImplementation(async (_u: string, id: string) => ({
      rendu: ligne({ id, cle_objet: `admin-1/rendus/${id}.webm` }), socleAbsent: false,
    }));
    expect((await post({ spec: SPEC }, 'job-1')).status).toBe(202);
    const r2 = await post({ spec: SPEC }, 'job-2');
    expect(r2.status).toBe(429);
    // Le reste du budget du job en cours + la marge de nettoyage Chromium/ffmpeg.
    const ra = Number(r2.headers.get('Retry-After'));
    expect(ra).toBeGreaterThan(Math.ceil(moteur.DELAI_RENDU_SERVEUR_MS / 1000));
    expect(ra).toBeLessThanOrEqual(Math.ceil(moteur.DELAI_RENDU_SERVEUR_MS / 1000) + moteur.MARGE_NETTOYAGE_S);
    expect(r2.body).toMatchObject({ ok: false, motif: 'capacite_saturee' });
    await vi.waitFor(() => expect(renderVideo).toHaveBeenCalled());
    lacher();
    await finTravail('job-1');
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(cloreRendu).not.toHaveBeenCalled();
    // La place est rendue : le second job passe maintenant.
    expect((await post({ spec: SPEC }, 'job-2')).status).toBe(202);
    await vi.waitFor(() => expect(renderVideo).toHaveBeenCalledTimes(2));
    lacher();
    expect(await finTravail('job-2')).toEqual({ issue: 'confirme' });
  });

  it('12. relancé après succès (confirmed) → 409, confirmation toujours unique', async () => {
    await post();
    await finTravail();
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    lireRendu.mockResolvedValue({ rendu: ligne({ etat: 'confirmed' }), socleAbsent: false });
    const r = await post();
    expect(r.status).toBe(409);
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
  });

  it('12b. confirmation interrompue → aucun second appel, GET relisible, /confirm rend dejaConfirme', async () => {
    confirmerRendu.mockRejectedValueOnce(new Error('ECONNRESET'));
    await post();
    expect(await finTravail()).toEqual({ issue: 'laisse_ouvert', motif: 'confirmation_interrompue' });
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(cloreRendu).not.toHaveBeenCalled();
    // La RPC avait abouti en base avant la coupure.
    lireRendu.mockResolvedValue({ rendu: ligne({ etat: 'confirmed' }), socleAbsent: false });
    expect(await get()).toEqual({ status: 200, body: { ok: true, jobId: 'job-1', etat: 'confirmed', enCours: false } });
    confirmerRendu.mockResolvedValue({ ok: true, etat: 'confirmed', solde: 90, dejaConfirme: true, motif: null });
    const res = await CONFIRMER({} as never, { params: { id: 'job-1' } } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dejaConfirme: true, etat: 'confirmed' });
  });
});

describe('13-15. Formats : visuel transmis tel quel, facturé = la ligne', () => {
  const cas: Array<[string, string]> = [['9:16', 'reel'], ['1:1', 'tv'], ['16:9', 'tv']];
  for (const [visuel, facture] of cas) {
    it(`${visuel} sur une ligne ${facture} → rendu en ${visuel}, aucune réservation`, async () => {
      lireRendu.mockResolvedValue({ rendu: ligne({ format: facture }), socleAbsent: false });
      expect((await post({ spec: { ...SPEC, format: visuel } })).status).toBe(202);
      await finTravail();
      expect(renderCreerSimpleEspion.mock.calls[0][0].design.format).toBe(visuel);
      expect(renderVideo.mock.calls[0][0].inputProps.format).toBe(visuel);
      expect(reserverRendu).not.toHaveBeenCalled();
      expect(confirmerRendu).toHaveBeenCalledTimes(1);
    });
  }

  const incoherents: Array<[string, string]> = [['9:16', 'tv'], ['16:9', 'reel'], ['1:1', 'reel']];
  for (const [visuel, facture] of incoherents) {
    it(`${visuel} sur une ligne ${facture} → 422 sans effet`, async () => {
      lireRendu.mockResolvedValue({ rendu: ligne({ format: facture }), socleAbsent: false });
      const r = await post({ spec: { ...SPEC, format: visuel } });
      expect(r).toMatchObject({ status: 422, body: { ok: false, motif: 'format_incoherent' } });
      aucunEffet();
    });
  }

  it('format absent ou inconnu → 422', async () => {
    const { format: _f, ...sans } = SPEC;
    expect((await post({ spec: sans })).status).toBe(422);
    expect((await post({ spec: { ...SPEC, format: '4:5' } })).status).toBe(422);
    aucunEffet();
  });
});

describe('16. La spec canonique, sans nouveau mapper', () => {
  it('renderCreerSimple reçoit la spec (localisée) ; le worker reçoit versEntreeRemotion(spec)', async () => {
    await post();
    await finTravail();
    expect(localiserEntreesRendu).toHaveBeenCalledWith(SPEC);
    const localisee = await localiserEntreesRendu.mock.results[0].value;
    const arg = renderCreerSimpleEspion.mock.calls[0][0];
    expect(arg.jobId).toBe('job-1');
    expect(arg.userId).toBe('admin-1');
    expect(arg.design).toStrictEqual(localisee);
    expect(typeof arg.cancelSignal).toBe('function');
    const w = renderVideo.mock.calls[0][0];
    expect(w.inputProps).toStrictEqual(versEntreeRemotion(localisee as never));
    expect(w.cancelSignal).toBe(arg.cancelSignal);
  });

  for (const cle of ['surimpressions', 'ctaCopies', 'logoUrl', 'watermarkBool', '__proto__x']) {
    it(`clé hors liste blanche « ${cle} » → 422`, async () => {
      const r = await post({ spec: { ...SPEC, [cle]: cle === 'ctaCopies' ? [] : {} } });
      expect(r.status).toBe(422);
      expect(String(r.body.motif)).toMatch(/^cle_refusee:/);
      aucunEffet();
    });
  }

  it('types de base vérifiés', async () => {
    for (const mauvais of [{ title: 3 }, { introDuration: '4' }, { introDuration: Number.NaN }, { titleBold: 'oui' }, { cards: {} }, { videoUrl: 7 }]) {
      const r = await post({ spec: { ...SPEC, ...mauvais } });
      expect(r.status).toBe(422);
    }
    expect((await post({ spec: null })).status).toBe(422);
    expect((await post(null)).status).toBe(422);
    aucunEffet();
  });
});

describe('17. État, stockage, solde, opération', () => {
  it('job annulé pendant le rendu → ni téléversement ni confirmation, fichier effacé', async () => {
    const fichier = path.join(os.tmpdir(), `studiio-render-a23-annule-${process.pid}.mp4`);
    renderVideo.mockImplementation(async () => { writeFileSync(fichier, 'x'); return { outputPath: fichier }; });
    // Route (avant puis après la place), début du travail : reserved ;
    // après le rendu : annulé.
    lireRendu
      .mockResolvedValueOnce({ rendu: ligne(), socleAbsent: false })
      .mockResolvedValueOnce({ rendu: ligne(), socleAbsent: false })
      .mockResolvedValueOnce({ rendu: ligne(), socleAbsent: false })
      .mockResolvedValue({ rendu: ligne({ etat: 'cancelled' }), socleAbsent: false });
    await post();
    expect(await finTravail()).toEqual({ issue: 'abandonne', motif: 'etat_change' });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
    expect(cloreRendu).not.toHaveBeenCalled();
    expect(existsSync(fichier)).toBe(false);
  });

  it('stockage injoignable à la vérification → laissé reserved, pas de failed', async () => {
    verifierObjet.mockResolvedValue({ ok: false, taille: 0, contentType: '', motif: 'stockage_injoignable' });
    await post();
    expect(await finTravail()).toEqual({ issue: 'laisse_ouvert', motif: 'stockage_injoignable' });
    expect(cloreRendu).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
  });

  it('solde insuffisant → failed', async () => {
    confirmerRendu.mockResolvedValue({ ok: false, etat: 'reserved', solde: 2, dejaConfirme: false, motif: 'solde_insuffisant' });
    await post();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'solde_insuffisant' });
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', 'solde_insuffisant');
  });

  for (const operation of ['avance-brouillon', 'avance-bureau', 'inconnue']) {
    it(`opération « ${operation} » → 403 sans effet`, async () => {
      lireRendu.mockResolvedValue({ rendu: ligne({ operation }), socleAbsent: false });
      const r = await post();
      expect(r).toMatchObject({ status: 403, body: { ok: false, motif: 'operation_refusee' } });
      aucunEffet();
    });
  }

  for (const operation of ['apercu', 'bureau', 'calendrier']) {
    it(`opération « ${operation} » acceptée`, async () => {
      lireRendu.mockResolvedValue({ rendu: ligne({ operation }), socleAbsent: false });
      expect((await post()).status).toBe(202);
      await finTravail();
    });
  }
});

describe('Place idempotente', () => {
  it('liberer deux fois ne rend qu’une place', () => {
    const a = moteur.prendreExecution('x');
    if (!a.ok) throw new Error('place');
    expect(moteur.prendreExecution('y')).toEqual({ ok: false, motif: 'capacite_saturee' });
    expect(moteur.prendreExecution('x')).toEqual({ ok: false, motif: 'deja_en_cours' });
    a.place.liberer();
    a.place.liberer();
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
    const b = moteur.prendreExecution('y');
    expect(b.ok).toBe(true);
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Lot de revue A2.3 — sécurité, bornes, délai, relectures
// ─────────────────────────────────────────────────────────────────────────

const occupation = await import('@/lib/render/occupation-remotion');

/** Refus 422 sans aucun effet, localisation comprise. */
const refuse422 = async (spec: unknown, motif?: RegExp) => {
  const r = await post({ spec });
  expect(r.status).toBe(422);
  if (motif) expect(String(r.body.motif)).toMatch(motif);
  expect(localiserEntreesRendu).not.toHaveBeenCalled();
  aucunEffet();
};

describe('B1. Champs média : URL http(s) canonique ou rien', () => {
  const MAUVAISES = [
    '//169.254.169.254/x',
    ' http://169.254.169.254/x',
    '\thttp://studiio-postgrest:3000/users',
    'https:169.254.169.254/x.mp4',
    'http:\\\\studiio-postgrest:3000\\users',
    'file:///etc/passwd',
    'data:video/mp4;base64,AAAA',
    'javascript:alert(1)',
    '/api/x',
    'blob:https://studiio.pro/1234',
    'http://169.254.169.254/x ',
    'ftp://exemple.test/x.mp4',
  ];
  const champs: Array<[string, (u: string) => Record<string, unknown>]> = [
    ['videoUrl', (u) => ({ videoUrl: u })],
    ['posterUrl', (u) => ({ posterUrl: u })],
    ['musicUrl', (u) => ({ musicUrl: u })],
    ['voiceUrl', (u) => ({ voiceUrl: u })],
    ['rushs[].url', (u) => ({ rushs: [{ url: u, secondes: 3 }] })],
    ['montage[].url', (u) => ({ montage: [{ url: u, debut: 0, fin: 2, depuis: 0, score: 1 }] })],
    ['sequenceBackgrounds.*', (u) => ({ sequenceBackgrounds: { titre: u } })],
    ['sequenceVoiceUrls.*', (u) => ({ sequenceVoiceUrls: { cta: u } })],
  ];
  for (const url of MAUVAISES) {
    it(`videoUrl ${JSON.stringify(url)} → 422 media_invalide`, async () => {
      await refuse422({ ...SPEC, videoUrl: url }, /^media_invalide/);
    });
  }
  for (const [nom, f] of champs) {
    it(`${nom} : chaque forme refusée, null accepté`, async () => {
      for (const url of ['//169.254.169.254/x', 'https:169.254.169.254/x.mp4', 'file:///etc/passwd', '/api/x']) {
        await refuse422({ ...SPEC, ...f(url) }, /^media_invalide/);
      }
    });
  }
  it('URL canonique http(s) et null acceptés', async () => {
    const r = await post({ spec: { ...SPEC, posterUrl: null, musicUrl: 'https://studiio.pro/storage/v1/object/public/media/a.mp3', sequenceBackgrounds: { titre: null } } });
    expect(r.status).toBe(202);
    await finTravail();
  });
});

describe('B2. Couleurs : hex ou rgb(a) stricts', () => {
  const INJECTION = 'red 0%, red 100%), url(http://169.254.169.254/), linear-gradient(red';
  for (const cle of ['gradientStart', 'gradientEnd', 'titleColor', 'subtitleColor', 'ctaColor', 'ctaSubColor', 'ctaBackground', 'cardBackground', 'cardValueColor']) {
    it(`${cle} injecté → 422 couleur_invalide`, async () => {
      await refuse422({ ...SPEC, [cle]: INJECTION }, /^couleur_invalide/);
    });
  }
  it('elements[].color injecté → 422', async () => {
    await refuse422({ ...SPEC, elements: [{ id: 'e', iconName: 'Star', x: 1, y: 1, sizePct: 5, color: INJECTION }] }, /^couleur_invalide/);
  });
  it('noms CSS, var(), gradients refusés', async () => {
    for (const c of ['red', 'var(--x)', 'linear-gradient(#000,#fff)', '#12345', 'rgb(1,2)', 'rgba(1,2,3,4)', '#FFF ']) {
      await refuse422({ ...SPEC, titleColor: c }, /^couleur_invalide/);
    }
  });
  it('#RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba() acceptés', async () => {
    const r = await post({ spec: { ...SPEC, gradientStart: '#FFF', gradientEnd: '#7C3AED', titleColor: '#7C3AED80', ctaColor: 'rgb(255, 255, 255)', ctaBackground: 'rgba(0,0,0,0.5)', subtitleColor: null } });
    expect(r.status).toBe(202);
    await finTravail();
  });
});

describe('C1. Bornes', () => {
  for (const cle of ['introDuration', 'cardsDuration', 'videoDuration', 'ctaDuration']) {
    it(`${cle} 1e9, -1, NaN, 121 → 422`, async () => {
      for (const v of [1e9, -1, Number.NaN, 121]) await refuse422({ ...SPEC, [cle]: v });
    });
  }
  it('durée 0 et 120 acceptées', async () => {
    expect((await post({ spec: { ...SPEC, videoDuration: 0, ctaDuration: 120 } })).status).toBe(202);
    await finTravail();
  });
  it('21 cartes → 422 ; 100 000 cartes → 413/422 sans effet', async () => {
    const carte = { title: 'a' };
    await refuse422({ ...SPEC, cards: Array.from({ length: 21 }, () => carte) });
    const r = await post({ spec: { ...SPEC, cards: Array.from({ length: 100_000 }, () => carte) } });
    expect([413, 422]).toContain(r.status);
    aucunEffet();
  });
  it('11 rushes, 51 éléments → 422', async () => {
    await refuse422({ ...SPEC, rushs: Array.from({ length: 11 }, () => ({ url: 'https://exemple.test/r.mp4' })) });
    await refuse422({ ...SPEC, elements: Array.from({ length: 51 }, (_v, i) => ({ id: `e${i}`, iconName: 'Star', x: 1, y: 1, sizePct: 5, color: '#FFF' })) });
  });
  it('texte de 2001 caractères (même imbriqué) → 422', async () => {
    await refuse422({ ...SPEC, title: 'x'.repeat(2001) });
    await refuse422({ ...SPEC, cards: [{ title: 'x'.repeat(2001) }] });
  });
  it('corps > 256 Ko → 413 ; Content-Length annoncé > 256 Ko → 413 sans lire le corps', async () => {
    const gros = await postBrut(JSON.stringify({ spec: { ...SPEC, subtitle: 'x'.repeat(300 * 1024) } }));
    expect(gros.status).toBe(413);
    const annonce = await postBrut(JSON.stringify({ spec: SPEC }), { 'content-length': String(300 * 1024) });
    expect(annonce.status).toBe(413);
    expect(annonce.text).not.toHaveBeenCalled();
    aucunEffet();
  });
  it('JSON illisible → 422', async () => {
    expect((await postBrut('{ pas du json')).status).toBe(422);
    aucunEffet();
  });
  it('clé héritée (constructor, toString, __proto__) → 422', async () => {
    for (const cle of ['constructor', 'toString', 'hasOwnProperty']) await refuse422({ ...SPEC, [cle]: 'x' }, /^cle_refusee/);
    const r = await postBrut('{"spec":{"title":"t","format":"9:16","__proto__":{"x":1}}}');
    expect(r.status).toBe(422);
    aucunEffet();
  });
});

describe('P-a. Un rendu Remotion étranger (Autopilote…) occupe la place', () => {
  it('rendusRemotionActifs() > 0 → 429 + Retry-After, sans effet ; libéré → 202', async () => {
    const sortir = occupation.entrerRenduRemotion();
    try {
      const r = await post();
      expect(r.status).toBe(429);
      expect(r.body).toMatchObject({ ok: false, motif: 'capacite_saturee' });
      expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
      aucunEffet();
    } finally { sortir(); }
    expect(occupation.rendusRemotionActifs()).toBe(0);
    expect((await post()).status).toBe(202);
    await finTravail();
  });
});

describe('P-b. Échéance : clôture immédiate, place gardée, rien d’écrit ensuite', () => {
  it('localisation bloquée à l’échéance → failed tout de suite, aucun rendu ensuite', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let lacher!: () => void;
    let entree!: () => void;
    const aCommence = new Promise<void>((ok) => { entree = ok; });
    localiserEntreesRendu.mockImplementationOnce((d: Record<string, unknown>) => new Promise((ok) => {
      lacher = () => ok({ ...d });
      entree();
    }));
    expect((await post()).status).toBe(202);
    await aCommence;
    await vi.advanceTimersByTimeAsync(moteur.DELAI_RENDU_SERVEUR_MS);
    expect(cloreRendu).toHaveBeenCalledTimes(1);
    expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', 'delai_depasse');
    // Conservateur : la place reste prise tant que la promesse n'a pas rendu la main.
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(1);
    lacher();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'delai_depasse' });
    expect(renderVideo).not.toHaveBeenCalled();
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
    expect(cloreRendu).toHaveBeenCalledTimes(1);
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });

  it('rendu qui RÉUSSIT après l’échéance → ni téléversement ni confirmation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let lacher!: () => void;
    let demarre!: () => void;
    const aDemarre = new Promise<void>((ok) => { demarre = ok; });
    renderVideo.mockImplementation((a: ArgsWorker) => new Promise((ok) => {
      lacher = () => ok({ outputPath: path.join(os.tmpdir(), `studiio-render-${a.jobId}.mp4`) });
      demarre();
    }));
    await post();
    await aDemarre;
    await vi.advanceTimersByTimeAsync(moteur.DELAI_RENDU_SERVEUR_MS);
    expect(cloreRendu).toHaveBeenCalledWith('admin-1', 'job-1', 'failed', 'delai_depasse');
    lacher();
    expect(await finTravail()).toEqual({ issue: 'echec', motif: 'delai_depasse' });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(verifierObjet).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
    expect(cloreRendu).toHaveBeenCalledTimes(1);
  });
});

/** Doublure À ÉTAT de la ligne et du débit (RPC idempotente). */
function ligneAEtat() {
  const etat = { valeur: 'reserved' as string, debits: 0 };
  lireRendu.mockImplementation(async () => ({ rendu: ligne({ etat: etat.valeur }), socleAbsent: false }));
  confirmerRendu.mockImplementation(async () => {
    if (etat.valeur === 'confirmed') return { ok: true, etat: 'confirmed', solde: 90, dejaConfirme: true, motif: null };
    if (etat.valeur !== 'reserved') return { ok: false, etat: etat.valeur, solde: 100, dejaConfirme: false, motif: 'etat_invalide' };
    etat.valeur = 'confirmed';
    etat.debits += 1;
    return { ok: true, etat: 'confirmed', solde: 90, dejaConfirme: false, motif: null };
  });
  cloreRendu.mockImplementation(async (_u: string, _id: string, e: string) => {
    if (etat.valeur !== 'reserved') return { ok: false, etat: etat.valeur };
    etat.valeur = e;
    return { ok: true, etat: e };
  });
  return etat;
}

describe('P1. Relecture après la place et au début du travail', () => {
  it('corps lent pendant qu’une autre requête rend et confirme → un seul rendu', async () => {
    const etat = ligneAEtat();
    let lacherCorps!: (t: string) => void;
    const corpsLent = new Promise<string>((ok) => { lacherCorps = ok; });
    const a = postBrut(corpsLent);
    await vi.waitFor(() => expect(lireRendu).toHaveBeenCalledTimes(1));
    // B passe entièrement pendant que A attend son corps.
    expect((await post()).status).toBe(202);
    expect(await finTravail()).toEqual({ issue: 'confirme' });
    lacherCorps(JSON.stringify({ spec: SPEC }));
    const ra = await a;
    expect(ra.status).toBe(409);
    expect(renderVideo).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(etat.debits).toBe(1);
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });

  it('ligne annulée entre la réponse 202 et le début du travail → aucun rendu', async () => {
    const place = moteur.prendreExecution('job-1');
    if (!place.ok) throw new Error('place');
    lireRendu.mockResolvedValue({ rendu: ligne({ etat: 'cancelled' }), socleAbsent: false });
    const issue = await moteur.executerRenduServeur({
      userId: 'admin-1', rendu: ligne() as never, spec: SPEC as never, place: place.place,
    });
    expect(issue).toEqual({ issue: 'abandonne', motif: 'etat_change' });
    expect(localiserEntreesRendu).not.toHaveBeenCalled();
    expect(renderVideo).not.toHaveBeenCalled();
    expect(moteur.rendusServeurEnCoursMaintenant()).toBe(0);
  });
});

describe('10b. Tentative restée reserved (stockage injoignable) puis relancée', () => {
  it('le second POST refait le rendu ; une seule confirmation, un seul débit', async () => {
    const etat = ligneAEtat();
    verifierObjet
      .mockResolvedValueOnce({ ok: false, taille: 0, contentType: '', motif: 'stockage_injoignable' })
      .mockResolvedValue({ ok: true, taille: 200_000, contentType: 'video/mp4' });
    expect((await post()).status).toBe(202);
    expect(await finTravail()).toEqual({ issue: 'laisse_ouvert', motif: 'stockage_injoignable' });
    expect(etat.valeur).toBe('reserved');
    expect((await post()).status).toBe(202);
    expect(await finTravail()).toEqual({ issue: 'confirme' });
    expect(renderVideo).toHaveBeenCalledTimes(2);
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(etat.debits).toBe(1);
    expect((await post()).status).toBe(409);
    expect(etat.debits).toBe(1);
  });
});

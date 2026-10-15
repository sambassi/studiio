/**
 * A2.3 — CARACTÉRISATION de POST /api/render/jobs/[id]/confirm.
 *
 * Fige le comportement ACTUEL de la route (statut HTTP, corps, appels exacts
 * aux doublures du service, de la politique et de `verifierObjet`) AVANT que
 * la logique preuve + politique ne soit extraite dans
 * `src/lib/rendus/confirmation.ts`. Écrit et passé VERT sur le code non
 * modifié (commit 1a1a044), puis relancé SANS modification après
 * l'extraction : tout écart est une régression.
 *
 * Aucun réseau, aucune base : les modules touchés sont doublés au niveau du
 * module, donc la doublure s'applique aussi bien à la route qu'au module
 * extrait.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

const lireRendu = vi.fn();
const confirmerRendu = vi.fn();
const confirmerRenduSansDebit = vi.fn();
const cloreRendu = vi.fn();
vi.mock('@/lib/rendus/service', () => ({
  lireRendu: (...a: unknown[]) => lireRendu(...a),
  confirmerRendu: (...a: unknown[]) => confirmerRendu(...a),
  confirmerRenduSansDebit: (...a: unknown[]) => confirmerRenduSansDebit(...a),
  cloreRendu: (...a: unknown[]) => cloreRendu(...a),
}));

const politiqueDeLUtilisateur = vi.fn();
vi.mock('@/lib/facturation/politique', () => ({
  politiqueDeLUtilisateur: (...a: unknown[]) => politiqueDeLUtilisateur(...a),
  consommeDesCredits: (p: string) => p === 'credits',
}));

const verifierObjet = vi.fn();
vi.mock('@/lib/storage/verifier-objet', () => ({
  verifierObjet: (...a: unknown[]) => verifierObjet(...a),
}));

const { POST } = await import('@/app/api/render/jobs/[id]/confirm/route');

const confirmer = async (id = 'job-1') => {
  const res = await POST({} as never, { params: { id } } as never);
  return { status: res.status, body: await res.json() };
};

const LIGNE = {
  id: 'job-1', user_id: 'moi', operation: 'apercu', format: 'reel', cout: 10,
  bucket: 'media', cle_objet: 'moi/rendus/job-1.webm', etat: 'reserved', politique: 'credits',
};
const PREUVE_OK = { ok: true, taille: 120_000, contentType: 'video/webm' };

beforeEach(() => {
  for (const m of [authMock, lireRendu, confirmerRendu, confirmerRenduSansDebit, cloreRendu, politiqueDeLUtilisateur, verifierObjet]) m.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
  lireRendu.mockResolvedValue({ rendu: { ...LIGNE }, socleAbsent: false });
  politiqueDeLUtilisateur.mockResolvedValue({ politique: 'credits', role: 'user' });
  verifierObjet.mockResolvedValue({ ...PREUVE_OK });
  confirmerRendu.mockResolvedValue({ ok: true, etat: 'confirmed', solde: 90, dejaConfirme: false, motif: null });
  confirmerRenduSansDebit.mockResolvedValue({ ok: true, etat: 'confirmed', dejaConfirme: false, motif: null });
  cloreRendu.mockResolvedValue({ ok: true, etat: 'failed' });
});

const partenaire = () => {
  politiqueDeLUtilisateur.mockResolvedValue({ politique: 'partner_cost_only', role: 'admin' });
  lireRendu.mockResolvedValue({ rendu: { ...LIGNE, politique: 'partner_cost_only' }, socleAbsent: false });
};

describe('Accès', () => {
  it('sans session → 401, rien n’est lu', async () => {
    authMock.mockResolvedValue(null);
    const r = await confirmer();
    expect(r).toEqual({ status: 401, body: { ok: false, error: 'Unauthorized' } });
    expect(lireRendu).not.toHaveBeenCalled();
    expect(verifierObjet).not.toHaveBeenCalled();
  });

  it('session sans id → 401', async () => {
    authMock.mockResolvedValue({ user: {} });
    expect((await confirmer()).status).toBe(401);
    expect(lireRendu).not.toHaveBeenCalled();
  });

  it('socle absent → 503, rien d’autre', async () => {
    lireRendu.mockResolvedValue({ rendu: null, socleAbsent: true });
    const r = await confirmer();
    expect(r).toEqual({ status: 503, body: { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' } });
    expect(politiqueDeLUtilisateur).not.toHaveBeenCalled();
  });

  it('inconnu ou d’autrui → 404, lecture filtrée par le propriétaire', async () => {
    lireRendu.mockResolvedValue({ rendu: null, socleAbsent: false });
    const r = await confirmer('job-x');
    expect(r).toEqual({ status: 404, body: { ok: false, error: 'Rendu introuvable' } });
    expect(lireRendu).toHaveBeenCalledWith('moi', 'job-x');
    expect(politiqueDeLUtilisateur).not.toHaveBeenCalled();
    expect(verifierObjet).not.toHaveBeenCalled();
  });
});

describe('Déjà confirmé', () => {
  it('partenaire : même résultat, aucun appel SQL, aucune vérification', async () => {
    partenaire();
    lireRendu.mockResolvedValue({ rendu: { ...LIGNE, politique: 'partner_cost_only', etat: 'confirmed' }, socleAbsent: false });
    const r = await confirmer();
    expect(r).toEqual({ status: 200, body: { ok: true, etat: 'confirmed', dejaConfirme: true, politique: 'partner_cost_only', balance: null } });
    expect(politiqueDeLUtilisateur).toHaveBeenCalledWith('moi');
    expect(confirmerRendu).not.toHaveBeenCalled();
    expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
    expect(verifierObjet).not.toHaveBeenCalled();
  });

  it('crédits : relit le solde via confirmerRendu(…, 0, \'\')', async () => {
    lireRendu.mockResolvedValue({ rendu: { ...LIGNE, etat: 'confirmed' }, socleAbsent: false });
    confirmerRendu.mockResolvedValue({ ok: true, etat: 'confirmed', solde: 77, dejaConfirme: true, motif: null });
    const r = await confirmer();
    expect(r).toEqual({ status: 200, body: { ok: true, etat: 'confirmed', dejaConfirme: true, politique: 'credits', balance: 77 } });
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledWith('moi', 'job-1', 0, '');
    expect(verifierObjet).not.toHaveBeenCalled();
  });
});

describe('La preuve', () => {
  it('vérifie l’objet à la clé de la ligne, pour le propriétaire', async () => {
    await confirmer();
    expect(verifierObjet).toHaveBeenCalledTimes(1);
    expect(verifierObjet).toHaveBeenCalledWith('media', 'moi/rendus/job-1.webm', 'moi');
  });

  it('stockage injoignable → 503, tentative laissée ouverte', async () => {
    verifierObjet.mockResolvedValue({ ok: false, taille: 0, contentType: '', motif: 'stockage_injoignable' });
    const r = await confirmer();
    expect(r).toEqual({ status: 503, body: { ok: false, error: 'Stockage injoignable', motif: 'stockage_injoignable' } });
    expect(cloreRendu).not.toHaveBeenCalled();
    expect(confirmerRendu).not.toHaveBeenCalled();
  });

  for (const motif of ['objet_absent', 'trop_petit', 'type_refuse', 'cle_hors_perimetre'] as const) {
    it(`${motif} → failed + 422, aucun débit`, async () => {
      verifierObjet.mockResolvedValue({ ok: false, taille: 10, contentType: 'text/plain', motif });
      const r = await confirmer();
      expect(r).toEqual({ status: 422, body: { ok: false, error: 'Aucun montage valide a cette cle', motif } });
      expect(cloreRendu).toHaveBeenCalledTimes(1);
      expect(cloreRendu).toHaveBeenCalledWith('moi', 'job-1', 'failed', motif);
      expect(confirmerRendu).not.toHaveBeenCalled();
      expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
    });
  }

  it('preuve refusée sans motif → clôture « objet invalide »', async () => {
    verifierObjet.mockResolvedValue({ ok: false, taille: 0, contentType: '' });
    const r = await confirmer();
    expect(r).toEqual({ status: 422, body: { ok: false, error: 'Aucun montage valide a cette cle' } });
    expect(cloreRendu).toHaveBeenCalledWith('moi', 'job-1', 'failed', 'objet invalide');
  });
});

describe('Politique crédits', () => {
  it('succès → 200, débit avec taille et type prouvés', async () => {
    const r = await confirmer();
    expect(r).toEqual({ status: 200, body: { ok: true, etat: 'confirmed', balance: 90, dejaConfirme: false, motif: null, politique: 'credits', taille: 120_000 } });
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(confirmerRendu).toHaveBeenCalledWith('moi', 'job-1', 120_000, 'video/webm');
    expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
    expect(cloreRendu).not.toHaveBeenCalled();
  });

  it('solde insuffisant → 402, pas de clôture', async () => {
    confirmerRendu.mockResolvedValue({ ok: false, etat: 'reserved', solde: 3, dejaConfirme: false, motif: 'solde_insuffisant' });
    const r = await confirmer();
    expect(r).toEqual({ status: 402, body: { ok: false, etat: 'reserved', balance: 3, dejaConfirme: false, motif: 'solde_insuffisant', politique: 'credits', taille: 120_000 } });
    expect(cloreRendu).not.toHaveBeenCalled();
  });

  it('ligne non reserved (annulée) : la preuve est vérifiée, la RPC refuse → 402', async () => {
    lireRendu.mockResolvedValue({ rendu: { ...LIGNE, etat: 'cancelled' }, socleAbsent: false });
    confirmerRendu.mockResolvedValue({ ok: false, etat: 'cancelled', solde: 50, dejaConfirme: false, motif: 'etat_invalide' });
    const r = await confirmer();
    expect(verifierObjet).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: 402, body: { ok: false, etat: 'cancelled', balance: 50, dejaConfirme: false, motif: 'etat_invalide', politique: 'credits', taille: 120_000 } });
  });

  it('socle absent à la confirmation → 503', async () => {
    confirmerRendu.mockResolvedValue({ ok: false, etat: null, solde: 0, dejaConfirme: false, motif: 'socle_absent', socleAbsent: true });
    const r = await confirmer();
    expect(r).toEqual({ status: 503, body: { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' } });
  });

  it('confirmerRendu jette → 500 avec le message', async () => {
    confirmerRendu.mockRejectedValue(new Error('coupure reseau'));
    const r = await confirmer();
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'coupure reseau' } });
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
  });

  it('jet non-Error → 500 « confirmation impossible »', async () => {
    verifierObjet.mockRejectedValue('x');
    const r = await confirmer();
    expect(r).toEqual({ status: 500, body: { ok: false, error: 'confirmation impossible' } });
  });

  it('ligne partenaire mais rôle actuel crédits → facturée en crédits', async () => {
    lireRendu.mockResolvedValue({ rendu: { ...LIGNE, politique: 'partner_cost_only' }, socleAbsent: false });
    const r = await confirmer();
    expect(r.body.politique).toBe('credits');
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
  });

  it('rôle actuel partenaire mais ligne crédits → facturée en crédits', async () => {
    politiqueDeLUtilisateur.mockResolvedValue({ politique: 'partner_cost_only', role: 'admin' });
    const r = await confirmer();
    expect(r.body.politique).toBe('credits');
    expect(confirmerRendu).toHaveBeenCalledTimes(1);
    expect(confirmerRenduSansDebit).not.toHaveBeenCalled();
  });
});

describe('Politique partner_cost_only', () => {
  it('succès → 200 sans débit, aucun coût inventé', async () => {
    partenaire();
    const r = await confirmer();
    expect(r).toEqual({ status: 200, body: { ok: true, etat: 'confirmed', dejaConfirme: false, motif: null, politique: 'partner_cost_only', balance: null, taille: 120_000 } });
    expect(confirmerRenduSansDebit).toHaveBeenCalledTimes(1);
    expect(confirmerRenduSansDebit).toHaveBeenCalledWith('moi', 'job-1', 120_000, 'video/webm', { partenaire: null, operationPartenaire: null, cout: null });
    expect(confirmerRendu).not.toHaveBeenCalled();
  });

  it('refus SQL → 422', async () => {
    partenaire();
    confirmerRenduSansDebit.mockResolvedValue({ ok: false, etat: 'failed', dejaConfirme: false, motif: 'etat_invalide' });
    const r = await confirmer();
    expect(r).toEqual({ status: 422, body: { ok: false, etat: 'failed', dejaConfirme: false, motif: 'etat_invalide', politique: 'partner_cost_only', balance: null, taille: 120_000 } });
  });

  it('socle absent → 503 (message facturation)', async () => {
    partenaire();
    confirmerRenduSansDebit.mockResolvedValue({ ok: false, etat: null, dejaConfirme: false, motif: 'socle_absent', socleAbsent: true });
    const r = await confirmer();
    expect(r).toEqual({ status: 503, body: { ok: false, error: 'Rendu indisponible : migration de facturation non appliquee.' } });
  });
});

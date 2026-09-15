import { describe, it, expect } from 'vitest';
import {
  SUJET_AVATAR, SUJETS_AVATAR, VERSION_CONSENTEMENT, TEXTE_CONSENTEMENT, estSujetAvatar,
  ETAT_SOURCE_PRETE, ETATS_PRETS, estEtatLocal, estEtatPret,
  INTENTION_APERCU, INTENTION_NORMALE, lireIntention,
  avatarLigneValide, etatAvatar, estActif, validationPossible, MESSAGES_VALIDATION,
  type AvatarLigne,
} from '@/lib/avatar/contrat';

/**
 * AVATAR-1B — le contrat du clone, dérivé de la ligne, jamais stocké.
 *
 * Ce que ces tests verrouillent : les valeurs que la migration 1A accepte,
 * l'ordre des règles qui donne l'état d'un avatar, et le fait qu'une ligne
 * d'un autre compte n'existe pas pour l'appelant.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';

const ligne = (over: Partial<AvatarLigne> = {}): AvatarLigne => ({
  id: '11111111-1111-4111-8111-000000000001', user_id: U, status: ETAT_SOURCE_PRETE,
  provider_avatar_id: null, source_object_key: `${U}/avatar/source-1.mp4`, subject_type: 'self',
  consent_version: VERSION_CONSENTEMENT, validated_at: null, version: 1, deleted_at: null,
  ...over,
});

describe('consentement et sujet — ce que la contrainte 1A accepte', () => {
  it('le produit n’enrôle que soi-même ; les deux valeurs de la CHECK sont les seules reconnues', () => {
    expect(SUJET_AVATAR).toBe('self');
    expect([...SUJETS_AVATAR]).toEqual(['self', 'third_party']);
    expect(estSujetAvatar('self')).toBe(true);
    expect(estSujetAvatar('third_party')).toBe(true);
    expect(estSujetAvatar('moi')).toBe(false);
    expect(estSujetAvatar(null)).toBe(false);
  });

  it('⚠️ le texte de consentement certifie « être la personne visible » — ce que le report 1A reconnaît', () => {
    expect(TEXTE_CONSENTEMENT).toMatch(/^Je certifie être la personne visible/);
    expect(VERSION_CONSENTEMENT).toMatch(/^[a-z0-9]+-\d{4}-\d{2}-\d{2}$/);
  });
});

describe('statuts — local, fournisseur, prêt', () => {
  it('source_ready est local ; les trois orthographes fournisseur de « prêt » le sont ; le reste non', () => {
    expect(estEtatLocal(ETAT_SOURCE_PRETE)).toBe(true);
    expect(estEtatLocal('completed')).toBe(false);
    for (const s of ETATS_PRETS) expect(estEtatPret(s)).toBe(true);
    expect(estEtatPret('processing')).toBe(false);
    expect(estEtatPret('failed')).toBe(false);
    expect(estEtatPret(ETAT_SOURCE_PRETE)).toBe(false);
    expect(estEtatPret(undefined)).toBe(false);
  });

  it('l’intention se lit comme la colonne : tout inconnu est « normale »', () => {
    expect(lireIntention(INTENTION_APERCU)).toBe('apercu');
    expect(lireIntention(INTENTION_NORMALE)).toBe('normale');
    expect(lireIntention(null)).toBe('normale');
    expect(lireIntention('APERCU')).toBe('normale');
  });
});

describe('avatarLigneValide — la propriété se vérifie une fois, avant toute décision', () => {
  it('une ligne bien formée de ce compte passe', () => {
    expect(avatarLigneValide(ligne(), U)).toBe(true);
    expect(avatarLigneValide(ligne({ provider_avatar_id: 'hg-1', status: 'completed', validated_at: '2026-09-15T00:00:00Z' }), U)).toBe(true);
    expect(avatarLigneValide(ligne({ subject_type: null, source_object_key: null }), U)).toBe(true);
  });

  it('⚠️ la ligne d’un autre compte n’existe pas pour l’appelant', () => {
    expect(avatarLigneValide(ligne({ user_id: AUTRUI }), U)).toBe(false);
    expect(avatarLigneValide(ligne(), AUTRUI)).toBe(false);
  });

  it('version < 1, non entière, sujet inconnu, id non-UUID, statut vide, non-objet → refusés', () => {
    expect(avatarLigneValide(ligne({ version: 0 }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ version: 1.5 }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ version: '1' as unknown as number }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ subject_type: 'moi' }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ id: 'pas-un-uuid' }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ status: '' }), U)).toBe(false);
    expect(avatarLigneValide(ligne({ deleted_at: 12 as unknown as string }), U)).toBe(false);
    expect(avatarLigneValide(null, U)).toBe(false);
    expect(avatarLigneValide('x', U)).toBe(false);
  });
});

describe('etatAvatar — dérivé, dans l’ordre des règles', () => {
  it('deleted_at l’emporte sur tout ; estActif est son contraire', () => {
    const a = ligne({ deleted_at: '2026-09-15T00:00:00Z', provider_avatar_id: 'hg', status: 'completed', validated_at: '2026-09-15T00:00:00Z' });
    expect(etatAvatar(a)).toBe('supprime');
    expect(estActif(a)).toBe(false);
    expect(estActif(ligne())).toBe(true);
  });

  it('sans fournisseur : source_ready → source_prete ; tout autre statut → echec', () => {
    expect(etatAvatar(ligne())).toBe('source_prete');
    expect(etatAvatar(ligne({ status: 'failed' }))).toBe('echec');
    // « completed » sans identifiant fournisseur n'est PAS prêt : rien n'a été entraîné.
    expect(etatAvatar(ligne({ status: 'completed' }))).toBe('echec');
  });

  it('avec fournisseur : processing → entrainement ; prêt → entraine_non_valide ; prêt + validated_at → valide ; failed → echec', () => {
    expect(etatAvatar(ligne({ provider_avatar_id: 'hg', status: 'processing' }))).toBe('entrainement');
    for (const s of ETATS_PRETS) {
      expect(etatAvatar(ligne({ provider_avatar_id: 'hg', status: s }))).toBe('entraine_non_valide');
      expect(etatAvatar(ligne({ provider_avatar_id: 'hg', status: s, validated_at: '2026-09-15T00:00:00Z' }))).toBe('valide');
    }
    expect(etatAvatar(ligne({ provider_avatar_id: 'hg', status: 'failed' }))).toBe('echec');
  });

  it('⚠️ un validated_at sur un modèle NON prêt ne compte pas (nouvelle version en cours)', () => {
    expect(etatAvatar(ligne({ provider_avatar_id: 'hg', status: 'processing', validated_at: '2026-09-15T00:00:00Z' }))).toBe('entrainement');
    expect(etatAvatar(ligne({ validated_at: '2026-09-15T00:00:00Z' }))).toBe('source_prete');
  });
});

describe('validationPossible — ce qui manque avant d’accepter son clone', () => {
  const pret = ligne({ provider_avatar_id: 'hg', status: 'completed' });
  it('prêt + aperçu vu → ok ; prêt sans aperçu → apercu_absent', () => {
    expect(validationPossible(pret, true)).toEqual({ ok: true });
    expect(validationPossible(pret, false)).toEqual({ ok: false, motif: 'apercu_absent' });
  });
  it('chaque autre état a son motif, et chaque motif a son message', () => {
    expect(validationPossible(ligne(), true)).toEqual({ ok: false, motif: 'aucun_clone' });
    expect(validationPossible(ligne({ provider_avatar_id: 'hg', status: 'processing' }), true)).toEqual({ ok: false, motif: 'entrainement_en_cours' });
    expect(validationPossible(ligne({ ...pret, validated_at: '2026-09-15T00:00:00Z' }), true)).toEqual({ ok: false, motif: 'deja_valide' });
    expect(validationPossible(ligne({ ...pret, deleted_at: '2026-09-15T00:00:00Z' }), true)).toEqual({ ok: false, motif: 'supprime' });
    expect(validationPossible(ligne({ provider_avatar_id: 'hg', status: 'failed' }), true)).toEqual({ ok: false, motif: 'aucun_clone' });
    for (const motif of ['supprime', 'aucun_clone', 'entrainement_en_cours', 'apercu_absent', 'deja_valide'] as const) {
      expect(MESSAGES_VALIDATION[motif].length).toBeGreaterThan(10);
    }
  });
});

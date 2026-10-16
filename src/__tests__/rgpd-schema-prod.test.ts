import { describe, it, expect } from 'vitest';
import { creerDemandeCompte, executerDemande } from '@/lib/rgpd/suppression-donnees';
import { colonneAbsente } from '@/lib/rgpd/adaptateurs';
import { etatDepuisLigne } from '@/lib/auth/etat-compte';
import { A, B, dependances } from './helpers/rgpd-faux';

/**
 * Schéma RÉEL de la production (relevé en lecture seule le 16/10) :
 * `users` = id, name, email, password_hash, image, credits, role, created_at,
 * updated_at, avatar_url, stripe_customer_id, plan, zernio_profile_id,
 * publishing_enabled — SANS `deleted_at` ni `blocked` ; tables absentes :
 * chat_logs, user_drive, email_suppressions.
 */
function depsSchemaProd() {
  const d = dependances();
  d.base.colonnesAbsentes.users = new Set(['deleted_at', 'blocked']);
  for (const t of ['chat_logs', 'user_drive', 'email_suppressions']) d.base.absentes.add(t);
  for (const u of d.base.tables.users) {
    delete u.deleted_at; delete u.blocked;
    Object.assign(u, { image: 'https://lh3.googleusercontent.com/x.jpg', password_hash: '$2b$10$hash' });
  }
  return d;
}

describe('suppression sur le schéma de PRODUCTION', () => {
  it('se termine : compte anonymisé (photo et mot de passe effacés), sans écrire de colonne absente', async () => {
    const { deps, base } = depsSchemaProd();
    const avantB = JSON.stringify(base.tables.users.find((u) => u.id === B));
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'compte')?.statut).toBe('terminee');
    expect(d.statut === 'terminee' || d.statut === 'terminee_studiio_externes_restantes').toBe(true);
    const ua = base.tables.users.find((u) => u.id === A)!;
    expect(ua.email).toBe(`supprime-${A}@supprime.invalid`);
    expect(ua.image).toBeNull();
    expect(ua.password_hash).toBeNull();
    expect(ua.name).toBe('');
    expect('deleted_at' in ua).toBe(false);
    expect('blocked' in ua).toBe(false);
    expect(JSON.stringify(base.tables.users.find((u) => u.id === B))).toBe(avantB);
  });

  it('la session du compte supprimé est coupée par la seule adresse anonymisée', async () => {
    const { deps, base } = depsSchemaProd();
    await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    const ua = base.tables.users.find((u) => u.id === A)!;
    expect(etatDepuisLigne({ email: ua.email })).toBe('supprime');
    expect(etatDepuisLigne({ email: base.tables.users.find((u) => u.id === B)!.email })).toBe('actif');
  });

  it('une colonne absente qui n’est pas optionnelle (email) reste un échec, jamais un faux succès', async () => {
    const { deps, base } = depsSchemaProd();
    base.colonnesAbsentes.users = new Set(['email']);
    const d = await executerDemande((await creerDemandeCompte(A, 'utilisateur', deps)).code, deps);
    expect(d.etapes.find((e) => e.id === 'compte')?.statut).toBe('echec');
    expect(d.statut).not.toMatch(/^terminee/);
  });

  it('reconnaît la colonne absente dans les erreurs Postgres et PostgREST', () => {
    expect(colonneAbsente({ code: '42703', message: 'column "deleted_at" does not exist' })).toBe('deleted_at');
    expect(colonneAbsente({ code: 'PGRST204', message: "Could not find the 'blocked' column of 'users' in the schema cache" })).toBe('blocked');
    expect(colonneAbsente({ code: '42P01', message: 'relation "x" does not exist' })).toBeUndefined();
    expect(colonneAbsente(null)).toBeUndefined();
  });
});

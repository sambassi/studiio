/**
 * Harnais PostgreSQL réel.
 *
 * Ces tests ne mockent RIEN. L'atomicité et l'idempotence sont des propriétés
 * du MOTEUR — un faux client rejoue ce qu'on lui programme, il « prouverait »
 * aussi bien une implémentation cassée. Il faut donc de vraies connexions
 * distinctes sur un vrai Postgres.
 *
 * La base est fournie par le service `postgres` du job `credits-postgres`
 * (`.github/workflows/ci.yml`). En local, poser `DATABASE_URL` suffit.
 */
import { Client } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const RACINE = process.cwd();

/**
 * Les fichiers de migration RÉELS, ceux destinés à la production, dans
 * l'ordre où ils s'appliquent. Aucun n'est recopié dans les tests : un test
 * qui réécrirait la fonction atomique ne testerait que sa propre copie.
 */
export const MIGRATIONS = [
  join(RACINE, 'migrations/2026-08-27-credits-atomiques.sql'),
  join(RACINE, 'migrations/2026-08-28-rendus-preuve-serveur.sql'),
  join(RACINE, 'migrations/2026-08-29-facturation-partenaires.sql'),
  join(RACINE, 'migrations/2026-08-30-debit-operation.sql'),
  join(RACINE, 'migrations/2026-08-31-shoot-sessions-rushes.sql'),
];

/** La première, conservée pour les tests qui ne parlent que de crédits. */
export const MIGRATION = MIGRATIONS[0];

export function urlBase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL absente. Ces tests exigent un vrai PostgreSQL — '
      + 'ils ne peuvent pas être simulés. En CI, le service `postgres` la fournit.',
    );
  }
  return url;
}

export async function connecter(): Promise<Client> {
  const client = new Client({ connectionString: urlBase() });
  await client.connect();
  return client;
}

/**
 * Repose la base à neuf : schéma préalable minimal, puis LA VRAIE MIGRATION.
 *
 * La migration n'est jamais recopiée ici — c'est le fichier de production qui
 * est joué. Un test qui recopierait la fonction atomique ne testerait que sa
 * propre copie.
 */
export async function preparerBase(client: Client): Promise<void> {
  await client.query('drop schema if exists public cascade; create schema public;');
  await client.query(readFileSync(join(RACINE, 'tests-pg/schema-prealable.sql'), 'utf-8'));

  for (const fichier of MIGRATIONS) {
    if (!existsSync(fichier)) {
      throw new Error(
        `Migration absente : ${fichier}\n`
        + "C'est le résultat attendu tant que le correctif n'est pas écrit.",
      );
    }
    await client.query(readFileSync(fichier, 'utf-8'));
  }
}

/** Applique les migrations une seconde fois — elles doivent être rejouables. */
export async function rejouerMigration(client: Client): Promise<void> {
  for (const fichier of MIGRATIONS) {
    await client.query(readFileSync(fichier, 'utf-8'));
  }
}

export interface Rendu {
  id: string;
  etat: string;
  cout: number;
  bucket: string;
  cle_objet: string;
  transaction_id: string | null;
  taille_octets: string | null;
}

/** Réserve une tentative, comme le fera la route de création. */
export async function reserverRendu(
  client: Client, userId: string, operation: string, format: string,
): Promise<Rendu> {
  const { rows } = await client.query<Rendu>(
    // Les casts sont indispensables : `$1` sert a la fois d'uuid (colonne
    // `user_id`) et de texte (dans la cle d'objet). Sans eux, Postgres refuse
    // — « inconsistent types deduced for parameter $1 ».
    `insert into public.rendus (user_id, operation, format, cout, bucket, cle_objet)
     select $1::uuid, $2::text, $3::text, t.credits, 'media',
            $1::text || '/rendus/' || gen_random_uuid()::text || '.webm'
       from public.tarifs_rendu t where t.format = $3::text
     returning id, etat, cout, bucket, cle_objet, transaction_id, taille_octets`,
    [userId, operation, format],
  );
  return rows[0];
}

export async function lireRendu(client: Client, id: string): Promise<Rendu | null> {
  const { rows } = await client.query<Rendu>(
    'select id, etat, cout, bucket, cle_objet, transaction_id, taille_octets from public.rendus where id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export interface Confirmation {
  ok: boolean;
  etat: string | null;
  solde: number;
  deja_confirme: boolean;
  motif: string | null;
}

/** Appelle la fonction de production. Aucune logique n'est réimplémentée. */
export async function confirmer(
  client: Client, userId: string, renduId: string,
  taille = 120_000, contentType = 'video/webm',
): Promise<Confirmation> {
  const { rows } = await client.query<Confirmation>(
    'select * from public.confirmer_rendu($1, $2, $3, $4)',
    [userId, renduId, taille, contentType],
  );
  return rows[0];
}

export async function clore(
  client: Client, userId: string, renduId: string, etat: string, motif = 'test',
): Promise<{ ok: boolean; etat: string | null }> {
  const { rows } = await client.query<{ ok: boolean; etat: string | null }>(
    'select * from public.clore_rendu($1, $2, $3, $4)', [userId, renduId, etat, motif],
  );
  return rows[0];
}

let compteur = 0;

/** Crée un utilisateur avec un solde donné et rend son identifiant. */
export async function creerUtilisateur(client: Client, credits: number): Promise<string> {
  compteur += 1;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.users (id, email, credits)
     values (gen_random_uuid(), $1, $2) returning id`,
    [`u${compteur}-${credits}@test.local`, credits],
  );
  return rows[0].id;
}

export async function solde(client: Client, userId: string): Promise<number> {
  const { rows } = await client.query<{ credits: number }>(
    'select credits from public.users where id = $1', [userId],
  );
  return rows[0]?.credits ?? -1;
}

export async function transactions(client: Client, userId: string) {
  const { rows } = await client.query(
    'select amount, type, reference_id from public.credit_transactions where user_id = $1 order by created_at',
    [userId],
  );
  return rows as Array<{ amount: number; type: string; reference_id: string | null }>;
}

export interface Debit {
  ok: boolean;
  solde: number;
  deja_debite: boolean;
  motif: string | null;
}

/** Appelle la fonction de production. Aucune logique n'est réimplémentée ici. */
export async function debiter(
  client: Client, userId: string, format: string, reference: string,
): Promise<Debit> {
  const { rows } = await client.query<Debit>(
    'select * from public.debiter_credits($1, $2, $3)', [userId, format, reference],
  );
  return rows[0];
}

/**
 * Lance N appels sur N CONNEXIONS distinctes, relâchés par une barrière.
 *
 * Sans barrière, la première requête a le temps de finir avant que la seconde
 * parte : on ne testerait pas la concurrence, seulement une séquence. Ici les
 * connexions sont toutes ouvertes et réchauffées d'abord, puis libérées
 * ensemble — le départ est déterministe, jamais dépendant d'un `sleep`.
 */
export async function enConcurrence<T>(
  n: number, travail: (client: Client, index: number) => Promise<T>,
): Promise<Array<{ ok: true; valeur: T } | { ok: false; erreur: string }>> {
  const clients: Client[] = [];
  for (let i = 0; i < n; i += 1) clients.push(await connecter());
  // Réchauffe : le premier aller-retour de chaque connexion ne doit pas
  // compter dans la course.
  await Promise.all(clients.map((c) => c.query('select 1')));

  let ouvrir: () => void;
  const barriere = new Promise<void>((r) => { ouvrir = r; });

  const courses = clients.map(async (client, i) => {
    await barriere;
    try {
      return { ok: true as const, valeur: await travail(client, i) };
    } catch (e) {
      return { ok: false as const, erreur: e instanceof Error ? e.message : String(e) };
    }
  });

  ouvrir!();
  const resultats = await Promise.all(courses);
  await Promise.all(clients.map((c) => c.end()));
  return resultats;
}


/** Cree un utilisateur avec un role donne. */
export async function creerUtilisateurAvecRole(
  client: Client, credits: number, role: string | null,
): Promise<string> {
  compteur += 1;
  const { rows } = await client.query<{ id: string }>(
    `insert into public.users (id, email, credits, role)
     values (gen_random_uuid(), $1, $2, $3) returning id`,
    [`r${compteur}-${role ?? 'nul'}@test.local`, credits, role],
  );
  return rows[0].id;
}

/** Appelle la confirmation SANS debit, telle qu'elle est en production. */
export async function confirmerSansDebit(
  client: Client, userId: string, renduId: string,
  taille = 120_000, contentType = 'video/webm',
  partenaire: string | null = null, operation: string | null = null,
  cout: number | null = null,
): Promise<{ ok: boolean; etat: string | null; deja_confirme: boolean; motif: string | null }> {
  const { rows } = await client.query(
    'select * from public.confirmer_rendu_sans_debit($1, $2, $3, $4, $5, $6, $7)',
    [userId, renduId, taille, contentType, partenaire, operation, cout],
  );
  return rows[0] as { ok: boolean; etat: string | null; deja_confirme: boolean; motif: string | null };
}

/** Lit les colonnes de facturation d'une tentative. */
export async function lireFacturation(client: Client, renduId: string) {
  const { rows } = await client.query(
    `select politique, partenaire, operation_partenaire, cout_partenaire, transaction_id, etat
       from public.rendus where id = $1`, [renduId],
  );
  return rows[0] as {
    politique: string; partenaire: string | null; operation_partenaire: string | null;
    cout_partenaire: string | null; transaction_id: string | null; etat: string;
  } | undefined;
}

/**
 * Appelle `debiter_credits_operation` — la fonction de production, telle
 * quelle. Rien n'est réimplémenté ici : une copie du SQL ne prouverait que
 * sa propre correction.
 */
export async function debiterOperation(
  client: Client,
  userId: string,
  montant: number,
  reference: string,
  type = 'render',
  description: string | null = null,
): Promise<Debit> {
  const { rows } = await client.query<Debit>(
    'select * from public.debiter_credits_operation($1, $2, $3, $4, $5)',
    [userId, montant, type, reference, description],
  );
  return rows[0];
}

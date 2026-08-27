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

/** Le fichier de migration RÉEL, celui destiné à la production. */
export const MIGRATION = join(RACINE, 'migrations/2026-08-27-credits-atomiques.sql');

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

  if (!existsSync(MIGRATION)) {
    throw new Error(
      `Migration absente : ${MIGRATION}\n`
      + "C'est le résultat attendu tant que le correctif n'est pas écrit.",
    );
  }
  await client.query(readFileSync(MIGRATION, 'utf-8'));
}

/** Applique la migration une seconde fois — elle doit être rejouable. */
export async function rejouerMigration(client: Client): Promise<void> {
  await client.query(readFileSync(MIGRATION, 'utf-8'));
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

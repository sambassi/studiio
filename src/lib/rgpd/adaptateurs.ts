/**
 * Adaptateurs RÉELS de la suppression des données (base PostgREST, MinIO).
 *
 * Séparés du cœur (`suppression-donnees.ts`) pour que celui-ci soit testé
 * sans aucune base ni aucun stockage. Rien ici ne décide QUI peut supprimer
 * QUOI : ce sont des tuyaux.
 *
 * Registre des demandes : `media/suppressions/<code>.json` (objet privé —
 * hors des dossiers `<uid>/`, donc ni lisible par un compte ni écrivable par
 * un envoi navigateur ; durable, épargné par la rétention). Aucune migration.
 *
 * Liens d'identité Meta : `media/liens-meta/<sha256(appli:id)>.json` → uid,
 * plus un index inverse `media/liens-meta/compte/<uid>/<hash>.json` pour les
 * retirer à la suppression du compte. Écrits à la connexion Facebook
 * (`enregistrerLienMetaSilencieux`). Ni l'identifiant Meta en clair, ni
 * l'adresse : seul son condensat est une clé.
 */
import { createHash } from 'crypto';
import type {
  BaseSuppression, DemandeSuppression, DependancesSuppression, Filtre, LiensMeta,
  RegistreSuppressions, ResultatBase, StockageSuppression,
} from '@/lib/rgpd/suppression-donnees';
import { CODE_CONFIRMATION, uidValide } from '@/lib/rgpd/suppression-donnees';
import type { AppliMeta } from '@/lib/rgpd/meta-signed-request';

export const BUCKET_REGISTRE = 'media';
export const PREFIXE_REGISTRE = 'suppressions/';
export const PREFIXE_LIENS_META = 'liens-meta/';
const DELAI_MINIO_MS = 10_000;
const TAILLE_JSON_MAX = 64 * 1024;

// ─── Base (PostgREST via supabaseAdmin) ──────────────────────────────────

function estTableAbsente(e: { code?: string } | null): boolean {
  // Strict : 42703 (colonne absente) n'est PAS une table absente.
  return !!e && (e.code === '42P01' || e.code === 'PGRST205');
}

function appliquer<Q extends { eq(c: string, v: unknown): Q; in(c: string, v: unknown[]): Q }>(q: Q, filtres: Filtre[]): Q {
  let r = q;
  for (const f of filtres) r = f.op === 'eq' ? r.eq(f.colonne, f.valeur) : r.in(f.colonne, f.valeur);
  return r;
}

export function baseSupabase(): BaseSuppression {
  const client = async () => (await import('@/lib/db/supabase')).supabaseAdmin;
  const res = (error: { code?: string; message?: string } | null): ResultatBase => (
    error ? { erreur: error.code || 'erreur', tableAbsente: estTableAbsente(error) } : { erreur: null }
  );
  return {
    async supprimer(table, filtres) {
      if (filtres.length === 0) return { erreur: 'sans_filtre' }; // jamais de DELETE sans WHERE
      const { error } = await appliquer((await client()).from(table).delete() as any, filtres);
      return res(error);
    },
    async mettreAJour(table, valeurs, filtres) {
      if (filtres.length === 0) return { erreur: 'sans_filtre' };
      const { error } = await appliquer((await client()).from(table).update(valeurs) as any, filtres);
      return res(error);
    },
    async lire(table, colonnes, filtres) {
      const { data, error } = await appliquer((await client()).from(table).select(colonnes) as any, filtres);
      return { ...res(error), lignes: Array.isArray(data) ? data : [] };
    },
  };
}

// ─── MinIO ───────────────────────────────────────────────────────────────

interface ClientMinioComplet {
  listObjectsV2(bucket: string, prefix: string, recursive: boolean): NodeJS.ReadableStream & { destroy?: () => void };
  removeObjects(bucket: string, noms: string[]): Promise<Array<null | undefined | { Error?: { Code?: string } }>>;
  putObject(bucket: string, cle: string, corps: Buffer, taille: number, entetes?: Record<string, string>): Promise<unknown>;
  getObject(bucket: string, cle: string): Promise<NodeJS.ReadableStream>;
  removeObject(bucket: string, cle: string): Promise<void>;
}

let moduleMinio: Promise<typeof import('@/lib/storage/minio-client')> | null = null;

async function minio(): Promise<ClientMinioComplet> {
  if (process.env.STORAGE_PROVIDER !== 's3') throw new Error('stockage_non_configure');
  moduleMinio ??= import('@/lib/storage/minio-client');
  const { clientMinio } = await moduleMinio;
  return clientMinio({ timeoutMs: DELAI_MINIO_MS }) as unknown as ClientMinioComplet;
}

const estAbsent = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  const message = e instanceof Error ? e.message : String(e);
  return code === 'NoSuchKey' || code === 'NotFound' || /NoSuchKey|not found/i.test(message);
};

async function lireJson(bucket: string, cle: string): Promise<unknown | null> {
  const c = await minio();
  let flux: NodeJS.ReadableStream;
  try { flux = await c.getObject(bucket, cle); } catch (e) { if (estAbsent(e)) return null; throw e; }
  const morceaux: Buffer[] = [];
  let total = 0;
  for await (const m of flux as AsyncIterable<Buffer | string>) {
    const b = typeof m === 'string' ? Buffer.from(m) : m;
    total += b.length;
    if (total > TAILLE_JSON_MAX) throw new Error('json_trop_grand');
    morceaux.push(b);
  }
  return JSON.parse(Buffer.concat(morceaux).toString('utf-8'));
}

async function ecrireJson(bucket: string, cle: string, valeur: unknown): Promise<void> {
  const corps = Buffer.from(JSON.stringify(valeur));
  await (await minio()).putObject(bucket, cle, corps, corps.length, { 'Content-Type': 'application/json' });
}

async function supprimerObjet(bucket: string, cle: string): Promise<void> {
  try { await (await minio()).removeObject(bucket, cle); } catch (e) { if (!estAbsent(e)) throw e; }
}

export function stockageMinio(): StockageSuppression {
  return {
    async lister(bucket, prefixe, max) {
      if (!prefixe || !prefixe.endsWith('/')) throw new Error('prefixe_invalide');
      const c = await minio();
      const flux = c.listObjectsV2(bucket, prefixe, true);
      return await new Promise<string[]>((resolve, reject) => {
        const cles: string[] = [];
        let fini = false;
        flux.on('data', (o: { name?: string }) => {
          if (fini || !o?.name) return;
          cles.push(o.name);
          if (cles.length >= max) { fini = true; flux.destroy?.(); resolve(cles); }
        });
        flux.on('error', (e: unknown) => { if (!fini) { fini = true; reject(e); } });
        flux.on('end', () => { if (!fini) { fini = true; resolve(cles); } });
        flux.on('close', () => { if (!fini) { fini = true; resolve(cles); } });
      });
    },
    async supprimer(bucket, cles) {
      if (cles.length === 0) return;
      const r = await (await minio()).removeObjects(bucket, cles);
      const ratees = (r || []).filter((x) => x && x.Error && x.Error.Code !== 'NoSuchKey');
      if (ratees.length > 0) throw new Error(`suppression_partielle:${ratees.length}`);
    },
  };
}

export function registreMinio(): RegistreSuppressions {
  return {
    async lire(code) {
      if (!CODE_CONFIRMATION.test(code)) return null;
      const v = await lireJson(BUCKET_REGISTRE, `${PREFIXE_REGISTRE}${code}.json`);
      if (!v || typeof v !== 'object' || (v as DemandeSuppression).code !== code) return null;
      return v as DemandeSuppression;
    },
    async ecrire(d) {
      if (!CODE_CONFIRMATION.test(d.code)) throw new Error('code_invalide');
      await ecrireJson(BUCKET_REGISTRE, `${PREFIXE_REGISTRE}${d.code}.json`, d);
    },
  };
}

export function condensatMeta(appli: AppliMeta, metaUserId: string): string {
  return createHash('sha256').update(`${appli}:${metaUserId}`).digest('hex');
}

const cleLien = (h: string) => `${PREFIXE_LIENS_META}${h}.json`;
const prefixeInverse = (uid: string) => `${PREFIXE_LIENS_META}compte/${uid}/`;

export function liensMetaMinio(): LiensMeta {
  return {
    async resoudre(appli, metaUserId) {
      const v = await lireJson(BUCKET_REGISTRE, cleLien(condensatMeta(appli, metaUserId)));
      const uid = (v as { uid?: unknown } | null)?.uid;
      return uidValide(uid) ? uid : null;
    },
    async supprimer(appli, metaUserId, userId) {
      if (!uidValide(userId)) throw new Error('uid_invalide');
      const h = condensatMeta(appli, metaUserId);
      const v = await lireJson(BUCKET_REGISTRE, cleLien(h));
      if ((v as { uid?: unknown } | null)?.uid === userId) await supprimerObjet(BUCKET_REGISTRE, cleLien(h));
      await supprimerObjet(BUCKET_REGISTRE, `${prefixeInverse(userId)}${h}.json`);
    },
    async supprimerPourCompte(userId) {
      if (!uidValide(userId)) throw new Error('uid_invalide');
      const prefixe = prefixeInverse(userId);
      const cles = await stockageMinio().lister(BUCKET_REGISTRE, prefixe, 1000);
      for (const cle of cles) {
        const h = cle.slice(prefixe.length).replace(/\.json$/, '');
        if (!/^[0-9a-f]{64}$/.test(h)) continue;
        const v = await lireJson(BUCKET_REGISTRE, cleLien(h));
        if ((v as { uid?: unknown } | null)?.uid === userId) await supprimerObjet(BUCKET_REGISTRE, cleLien(h));
        await supprimerObjet(BUCKET_REGISTRE, cle);
      }
    },
  };
}

/**
 * Enregistre le lien « identifiant Facebook → compte Studiio » à la
 * connexion. Fire-and-forget, JAMAIS bloquant ni levant : la connexion ne
 * dépend pas du stockage. Sans stockage S3 configuré : ne fait rien.
 */
export function enregistrerLienMetaSilencieux(appli: AppliMeta, metaUserId: unknown, userId: unknown): void {
  if (process.env.STORAGE_PROVIDER !== 's3') return;
  if (typeof metaUserId !== 'string' || !/^[0-9]{1,32}$/.test(metaUserId) || !uidValide(userId)) return;
  const h = condensatMeta(appli, metaUserId);
  (async () => {
    await ecrireJson(BUCKET_REGISTRE, cleLien(h), { v: 1, uid: userId });
    await ecrireJson(BUCKET_REGISTRE, `${prefixeInverse(userId)}${h}.json`, { v: 1 });
  })().catch((e) => console.error('[rgpd] lien Meta non enregistré :', e instanceof Error ? e.message : e));
}

export function dependancesReelles(): DependancesSuppression {
  return {
    base: baseSupabase(),
    stockage: stockageMinio(),
    registre: registreMinio(),
    liensMeta: liensMetaMinio(),
    journal: (evenement, details) => console.log(`[rgpd] ${evenement}`, details),
  };
}

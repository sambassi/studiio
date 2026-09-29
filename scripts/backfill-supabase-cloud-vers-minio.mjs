#!/usr/bin/env node
/**
 * Backfill : anciens medias Supabase Cloud → MinIO, puis reecriture des URL.
 *
 * ⚠️ PREPARE, JAMAIS EXECUTE PAR LA PR QUI L'AJOUTE. A lancer a la main, sur le
 * serveur (reseau Docker : PostgREST + MinIO), APRES sauvegarde de la base.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 * Avant la migration MinIO, les medias etaient servis par Supabase Cloud :
 * des URL absolues `https://<projet>.supabase.co/storage/v1/object/public/
 * <bucket>/<cle>` sont persistees en base (scheduled_posts.metadata,
 * videos.*, avatars…). Le projet cloud est en plan gratuit hors quota : le
 * jour ou il est coupe, ces anciens contenus deviennent illisibles.
 *
 * Le relais `/storage/v1/object/public/<bucket>/<cle>` de l'application sert
 * deja MinIO sous LE MEME chemin. Il suffit donc (1) de copier chaque objet a
 * la meme `<bucket>/<cle>` dans MinIO, puis (2) de remplacer l'ORIGINE cloud
 * par celle de l'application. La cle est conservee : les controles de
 * propriete (`<userId>/…`) restent valides.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS PHASES, CHACUNE EXPLICITE
 * ─────────────────────────────────────────────────────────────────────────
 *   (defaut)   INVENTAIRE, lecture seule. Parcourt les tables, liste les URL
 *              cloud trouvees (texte ET JSON, a toute profondeur), ecrit un
 *              rapport. N'appelle NI Supabase Cloud NI MinIO.
 *   --copy     Copie les objets manquants cloud → MinIO (idempotent : un
 *              objet deja present dans MinIO avec la meme taille est saute).
 *              Aucune ecriture en base.
 *   --rewrite  Reecrit les URL en base, UNIQUEMENT pour les objets verifies
 *              presents dans MinIO. Exige `--confirm` et `--app-origin`.
 *              Chaque ligne est relue juste avant l'ecriture : si elle a
 *              change depuis l'inventaire, elle est sautee. Les valeurs
 *              d'origine sont ecrites dans un fichier de sauvegarde AVANT
 *              toute modification.
 *
 * Sans `--confirm`, `--copy` et `--rewrite` se contentent de simuler.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VARIABLES
 * ─────────────────────────────────────────────────────────────────────────
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   PostgREST auto-heberge (lecture/ecriture base)
 *   LEGACY_ORIGIN                        origine cloud (defaut : SUPABASE_LEGACY_STORAGE_URL,
 *                                        puis NEXT_PUBLIC_SUPABASE_URL)
 *   MINIO_ENDPOINT, MINIO_PORT, MINIO_USE_SSL, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
 *
 * Exemples :
 *   node scripts/backfill-supabase-cloud-vers-minio.mjs
 *   node scripts/backfill-supabase-cloud-vers-minio.mjs --copy --confirm
 *   node scripts/backfill-supabase-cloud-vers-minio.mjs --rewrite --confirm --app-origin https://studiio.pro
 *   … --tables scheduled_posts,videos --out /tmp/backfill
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Arguments ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valeur = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const MODE_COPY = flag('--copy');
const MODE_REWRITE = flag('--rewrite');
const CONFIRM = flag('--confirm');
const OUT = valeur('--out') || join(process.cwd(), `backfill-supabase-${Date.now()}`);
const APP_ORIGIN = valeur('--app-origin');

/**
 * Tables parcourues par defaut. Une table absente est signalee et sautee :
 * la liste peut donc etre large sans connaitre le schema exact. Chaque ligne
 * est lue EN ENTIER (`select *`) et toutes ses colonnes sont inspectees.
 */
const TABLES_DEFAUT = [
  'scheduled_posts', 'videos', 'users', 'render_jobs', 'rendus',
  'user_avatars', 'avatar_generations', 'user_voices', 'user_drive',
  'user_settings', 'site_settings', 'autopilot_config', 'autopilot_jumeau_attente',
  'rushes', 'shoot_sessions', 'creer_draft_rushes', 'lut_assets',
  'rush_analyses', 'rush_transcriptions', 'rush_clip_sets', 'rush_candidate_sets',
  'rush_montage_plans', 'rush_montage_renders', 'user_notifications',
];
const TABLES = (valeur('--tables') || '').split(',').map((s) => s.trim()).filter(Boolean);
const tables = TABLES.length ? TABLES : TABLES_DEFAUT;
const PAGE = 500;

// ── Origines ───────────────────────────────────────────────────────────────

function origine(brut) {
  if (!brut) return null;
  try {
    const u = new URL(brut);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch { return null; }
}

const LEGACY = origine(
  process.env.LEGACY_ORIGIN
  || process.env.SUPABASE_LEGACY_STORAGE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL,
);
if (!LEGACY || !/\.supabase\.co$/i.test(new URL(LEGACY).hostname)) {
  console.error('LEGACY_ORIGIN absente ou pas un hote *.supabase.co — arret.');
  process.exit(2);
}
if (MODE_REWRITE && (!origine(APP_ORIGIN) || !CONFIRM)) {
  console.error('--rewrite exige --confirm et --app-origin https://… — arret.');
  process.exit(2);
}
const CIBLE = origine(APP_ORIGIN);

const PREFIXE_PUBLIC = '/storage/v1/object/public/';
const BUCKETS = new Set(['media', 'audio', 'videos', 'images']);

/**
 * `{ bucket, cle }` d'une URL publique cloud, ou `null`. La cle est gardee
 * telle quelle (echappements compris) : c'est la meme chaine que le relais
 * applicatif recevra apres reecriture d'origine.
 */
function cibleCloud(chaine) {
  if (typeof chaine !== 'string' || !chaine.startsWith(LEGACY + PREFIXE_PUBLIC)) return null;
  const reste = chaine.slice((LEGACY + PREFIXE_PUBLIC).length).split(/[?#]/)[0];
  const i = reste.indexOf('/');
  if (i <= 0) return null;
  const bucket = reste.slice(0, i);
  const cleBrute = reste.slice(i + 1);
  let cle;
  try { cle = decodeURIComponent(cleBrute); } catch { return null; }
  if (!cle || cle.includes('..') || cle.includes('\\')) return null;
  return { bucket, cle, cleBrute };
}

/** Toutes les chaines d'une valeur (texte ou JSON), a toute profondeur. */
function* chaines(v) {
  if (typeof v === 'string') { yield v; return; }
  if (Array.isArray(v)) { for (const x of v) yield* chaines(x); return; }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) yield* chaines(x); }
}

/** Remplace l'origine cloud par `CIBLE` dans une valeur, si l'objet est verifie. */
function reecrire(v, verifies) {
  if (typeof v === 'string') {
    const c = cibleCloud(v);
    if (!c || !verifies.has(`${c.bucket}/${c.cle}`)) return v;
    return CIBLE + v.slice(LEGACY.length);
  }
  if (Array.isArray(v)) return v.map((x) => reecrire(x, verifies));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = reecrire(x, verifies);
    return o;
  }
  return v;
}

// ── Clients (paresseux : l'inventaire n'ouvre que PostgREST) ───────────────

async function base() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes.'); process.exit(2); }
  if (origine(url) === LEGACY) { console.error('SUPABASE_URL vise le cloud : attendu le PostgREST auto-heberge.'); process.exit(2); }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function minio() {
  const { Client } = await import('minio');
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD;
  if (!secretKey) { console.error('MINIO_SECRET_KEY manquante.'); process.exit(2); }
  return new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'studiio-minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'studiio',
    secretKey,
  });
}

async function tailleMinio(mc, bucket, cle) {
  try { return (await mc.statObject(bucket, cle)).size; } catch { return null; }
}

// ── Phase 1 : inventaire (lecture seule) ───────────────────────────────────

async function inventaire(db) {
  const lignes = [];          // { table, id, colonnes: string[] }
  const objets = new Map();   // "bucket/cle" → { bucket, cle, cleBrute, url, refs }
  const horsPublic = [];      // URL cloud non migrables telles quelles (signees, bucket inconnu)
  const absentes = [];

  for (const table of tables) {
    for (let debut = 0; ; debut += PAGE) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await db.from(table).select('*').order('id', { ascending: true })
        .range(debut, debut + PAGE - 1);
      if (error) { absentes.push({ table, erreur: error.message }); break; }
      for (const row of data) {
        const colonnes = [];
        for (const [col, v] of Object.entries(row)) {
          let touche = false;
          for (const s of chaines(v)) {
            if (!s.includes(LEGACY)) continue;
            const c = cibleCloud(s);
            if (!c || !BUCKETS.has(c.bucket)) { horsPublic.push({ table, id: row.id, col, url: s }); continue; }
            touche = true;
            const k = `${c.bucket}/${c.cle}`;
            const o = objets.get(k) || { ...c, url: s.split(/[?#]/)[0], refs: 0 };
            o.refs += 1;
            objets.set(k, o);
          }
          if (touche) colonnes.push(col);
        }
        if (colonnes.length) lignes.push({ table, id: row.id, colonnes });
      }
      if (data.length < PAGE) break;
    }
  }
  return { lignes, objets, horsPublic, absentes };
}

// ── Phase 2 : copie cloud → MinIO ──────────────────────────────────────────

async function copier(objets) {
  const mc = await minio();
  const bilan = { deja: 0, copies: 0, echecs: [] };
  for (const o of objets.values()) {
    // eslint-disable-next-line no-await-in-loop
    const dejaTaille = await tailleMinio(mc, o.bucket, o.cle);
    if (dejaTaille !== null) { bilan.deja += 1; continue; }
    if (!CONFIRM) { bilan.copies += 1; continue; } // simulation
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await fetch(o.url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' };
      // eslint-disable-next-line no-await-in-loop
      await mc.putObject(o.bucket, o.cle, buf, buf.length, meta);
      // eslint-disable-next-line no-await-in-loop
      if ((await tailleMinio(mc, o.bucket, o.cle)) !== buf.length) throw new Error('taille MinIO differente');
      bilan.copies += 1;
    } catch (e) {
      bilan.echecs.push({ objet: `${o.bucket}/${o.cle}`, erreur: String(e?.message || e) });
    }
  }
  return bilan;
}

// ── Phase 3 : reecriture des URL en base ───────────────────────────────────

async function reecrireBase(db, lignes, objets) {
  const mc = await minio();
  const verifies = new Set();
  for (const [k, o] of objets) {
    // eslint-disable-next-line no-await-in-loop
    if ((await tailleMinio(mc, o.bucket, o.cle)) !== null) verifies.add(k);
  }
  const sauvegarde = [];
  const bilan = { lignes: 0, sautees: [], objetsVerifies: verifies.size, objetsManquants: objets.size - verifies.size };
  for (const l of lignes) {
    // eslint-disable-next-line no-await-in-loop
    const { data: row, error } = await db.from(l.table).select('*').eq('id', l.id).single();
    if (error || !row) { bilan.sautees.push({ ...l, raison: 'relecture impossible' }); continue; }
    const patch = {};
    for (const col of l.colonnes) {
      const nv = reecrire(row[col], verifies);
      if (JSON.stringify(nv) !== JSON.stringify(row[col])) patch[col] = nv;
    }
    if (!Object.keys(patch).length) continue;
    sauvegarde.push({ table: l.table, id: l.id, avant: Object.fromEntries(Object.keys(patch).map((c) => [c, row[c]])) });
    // Sauvegarde ecrite AVANT chaque ecriture : un arret brutal laisse une trace complete.
    writeFileSync(join(OUT, 'sauvegarde-avant-reecriture.json'), JSON.stringify(sauvegarde, null, 2));
    // eslint-disable-next-line no-await-in-loop
    const { error: e2 } = await db.from(l.table).update(patch).eq('id', l.id);
    if (e2) bilan.sautees.push({ ...l, raison: e2.message }); else bilan.lignes += 1;
  }
  return bilan;
}

// ── Principal ──────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
const db = await base();
const inv = await inventaire(db);
const rapport = {
  legacy: LEGACY,
  mode: MODE_REWRITE ? 'rewrite' : MODE_COPY ? 'copy' : 'inventaire',
  confirme: CONFIRM,
  tables,
  tablesIgnorees: inv.absentes,
  lignesConcernees: inv.lignes.length,
  objetsUniques: inv.objets.size,
  urlNonMigrables: inv.horsPublic,
  parTable: inv.lignes.reduce((acc, l) => { acc[l.table] = (acc[l.table] || 0) + 1; return acc; }, {}),
};
writeFileSync(join(OUT, 'inventaire.json'), JSON.stringify({
  ...rapport, lignes: inv.lignes, objets: [...inv.objets.values()],
}, null, 2));

if (MODE_COPY) rapport.copie = await copier(inv.objets);
if (MODE_REWRITE) rapport.reecriture = await reecrireBase(db, inv.lignes, inv.objets);

writeFileSync(join(OUT, 'rapport.json'), JSON.stringify(rapport, null, 2));
console.log(JSON.stringify({ ...rapport, urlNonMigrables: rapport.urlNonMigrables.length }, null, 2));
console.log(`Rapports : ${OUT}`);

/**
 * Doublures EN MÉMOIRE de la suppression RGPD : base, stockage, registre,
 * liens Meta. Aucune base, aucun MinIO, aucun réseau.
 */
import type {
  BaseSuppression, DemandeSuppression, DependancesSuppression, Filtre, LiensMeta,
  RegistreSuppressions, StockageSuppression,
} from '@/lib/rgpd/suppression-donnees';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';

export type Ligne = Record<string, unknown>;

function correspond(l: Ligne, filtres: Filtre[]): boolean {
  return filtres.every((f) => (f.op === 'eq' ? l[f.colonne] === f.valeur : (f.valeur as unknown[]).includes(l[f.colonne])));
}

export interface FausseBase extends BaseSuppression {
  tables: Record<string, Ligne[]>;
  absentes: Set<string>;
  enPanne: Set<string>;
  appels: { op: string; table: string; filtres: Filtre[] }[];
}

export function fausseBase(tables: Record<string, Ligne[]>): FausseBase {
  const b: FausseBase = {
    tables,
    absentes: new Set(),
    enPanne: new Set(),
    appels: [],
    async supprimer(table, filtres) {
      b.appels.push({ op: 'delete', table, filtres });
      if (b.absentes.has(table)) return { erreur: 'PGRST205', tableAbsente: true };
      if (b.enPanne.has(table)) return { erreur: '42703' };
      b.tables[table] = (b.tables[table] ?? []).filter((l) => !correspond(l, filtres));
      return { erreur: null };
    },
    async mettreAJour(table, valeurs, filtres) {
      b.appels.push({ op: 'update', table, filtres });
      if (b.enPanne.has(table)) return { erreur: '42703' };
      for (const l of b.tables[table] ?? []) if (correspond(l, filtres)) Object.assign(l, valeurs);
      return { erreur: null };
    },
    async lire(table, _colonnes, filtres) {
      b.appels.push({ op: 'select', table, filtres });
      if (b.absentes.has(table)) return { erreur: 'PGRST205', tableAbsente: true, lignes: [] };
      if (b.enPanne.has(table)) return { erreur: '42703', lignes: [] };
      return { erreur: null, lignes: (b.tables[table] ?? []).filter((l) => correspond(l, filtres)).map((l) => ({ ...l })) };
    },
  };
  return b;
}

export interface FauxStockage extends StockageSuppression {
  objets: Record<string, Set<string>>;
  /** Nombre d'appels `supprimer` réussis avant la panne (null = jamais). */
  panneApres: number | null;
  appelsSupprimer: number;
  /** Clés ajoutées à chaque listage (simule un listage anormal). */
  intrus: string[];
}

export function fauxStockage(objets: Record<string, string[]>): FauxStockage {
  const s: FauxStockage = {
    objets: Object.fromEntries(Object.entries(objets).map(([k, v]) => [k, new Set(v)])),
    panneApres: null,
    appelsSupprimer: 0,
    intrus: [],
    async lister(bucket, prefixe, max) {
      const toutes = [...(s.objets[bucket] ?? [])].filter((c) => c.startsWith(prefixe)).sort();
      const res = toutes.slice(0, max);
      return res.length > 0 || s.intrus.length === 0 ? [...res, ...(res.length ? s.intrus : [])] : res;
    },
    async supprimer(bucket, cles) {
      if (s.panneApres !== null && s.appelsSupprimer >= s.panneApres) throw new Error('MinIO indisponible');
      s.appelsSupprimer++;
      for (const c of cles) s.objets[bucket]?.delete(c);
    },
  };
  return s;
}

export interface FauxRegistre extends RegistreSuppressions {
  demandes: Map<string, DemandeSuppression>;
}

export function fauxRegistre(): FauxRegistre {
  const r: FauxRegistre = {
    demandes: new Map(),
    async lire(code) {
      const d = r.demandes.get(code);
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    async ecrire(d) {
      r.demandes.set(d.code, JSON.parse(JSON.stringify(d)));
    },
  };
  return r;
}

export interface FauxLiens extends LiensMeta {
  liens: Map<string, string>;
}

export function fauxLiens(initial: Record<string, string> = {}): FauxLiens {
  const l: FauxLiens = {
    liens: new Map(Object.entries(initial)),
    async existePourCompte(uid) { return [...l.liens.values()].includes(uid); },
    async resoudre(appli, id) { return l.liens.get(`${appli}:${id}`) ?? null; },
    async supprimer(appli, id, uid) { if (l.liens.get(`${appli}:${id}`) === uid) l.liens.delete(`${appli}:${id}`); },
    async supprimerPourCompte(uid) { for (const [k, v] of [...l.liens]) if (v === uid) l.liens.delete(k); },
  };
  return l;
}

let compteur = 0;
export function codeSuivant(): string {
  compteur++;
  return compteur.toString(16).padStart(32, '0');
}

/** Un jeu complet : A et B ont chacun des données partout. */
export function jeuComplet() {
  const lignesDe = (uid: string, extra: Ligne = {}) => [{ id: `${uid}-1`, user_id: uid, ...extra }];
  const tablesUtilisateur = [
    'social_accounts', 'user_drive', 'zernio_accounts',
    'avatar_generations', 'avatar_versions', 'avatar_verrous_creation', 'user_avatars',
    'rush_montage_renders', 'rush_montage_plans', 'rush_clip_sets', 'rush_candidate_sets',
    'rush_transcriptions', 'rush_analyses', 'creer_draft_rushes', 'rushes', 'shoot_sessions',
    'autopilot_jumeau_attente', 'autopilot_config', 'agent_plans',
    'render_jobs', 'scheduled_posts', 'videos', 'objectives',
    'lut_assets', 'user_voices', 'user_notifications', 'user_settings', 'chat_logs',
    'credit_transactions', 'subscriptions', 'rendus',
  ];
  const tables: Record<string, Ligne[]> = {};
  for (const t of tablesUtilisateur) tables[t] = [...lignesDe(A), ...lignesDe(B)];
  tables.social_accounts = [
    { id: 'sa-a-fb', user_id: A, platform: 'facebook', access_token: 'jeton-a-fb' },
    { id: 'sa-a-ig', user_id: A, platform: 'instagram', access_token: 'jeton-a-ig' },
    { id: 'sa-a-yt', user_id: A, platform: 'youtube', access_token: 'jeton-a-yt' },
    { id: 'sa-b-fb', user_id: B, platform: 'facebook', access_token: 'jeton-b-fb' },
  ];
  tables.subscriptions = [
    { id: 'sub-a', user_id: A, status: 'canceled', cancel_at_period_end: false },
    { id: 'sub-b', user_id: B, status: 'active', cancel_at_period_end: false },
  ];
  tables.users = [
    { id: A, email: 'a@exemple.test', name: 'Alice', avatar_url: 'https://scontent.xx.fbcdn.net/a.jpg', blocked: false, deleted_at: null },
    { id: B, email: 'b@exemple.test', name: 'Bob', avatar_url: 'https://platform-lookaside.fbsbx.com/b.jpg', blocked: false, deleted_at: null },
  ];
  tables.audit_log = [{ id: 'log-1', admin_email: 'admin@x', action: 'x' }];
  tables.email_suppressions = [{ email: 'a@exemple.test' }];

  const objetsDe = (uid: string) => [
    `${uid}/rush-1.mp4`, `${uid}/library/musique.mp3`, `${uid}/avatar/source-1-x.mp4`,
    `${uid}/autopilote/montages/r1/montage.mp4`, `${uid}/analyse/a1/v.jpg`,
    `fiches-contenu/${uid}/analyse/${'a'.repeat(40)}.12.v1.json`,
    `stock-attributions/${uid}/img.json`,
  ];
  const objets: Record<string, string[]> = {
    media: [...objetsDe(A), ...objetsDe(B), 'converted/partage.mp4', 'externes/abc.jpg', 'suppressions/x.json'],
    audio: [`${A}/voice/v.mp3`, `audio-complet/${A}/${'b'.repeat(24)}.mp3`, `${B}/voice/v.mp3`, `audio-complet/${B}/${'c'.repeat(24)}.mp3`],
    videos: [`${A}/v.webm`, `${B}/v.webm`],
    images: [`${A}/i.png`, `${B}/i.png`],
  };
  return { tables, objets };
}

export function dependances(over: Partial<DependancesSuppression> = {}) {
  const { tables, objets } = jeuComplet();
  const base = fausseBase(tables);
  const stockage = fauxStockage(objets);
  const registre = fauxRegistre();
  const liensMeta = fauxLiens({ 'facebook:1000001': A, 'facebook:1000002': B });
  const deps: DependancesSuppression = {
    base, stockage, registre, liensMeta,
    genererCode: codeSuivant,
    maintenant: () => new Date('2026-10-16T10:00:00.000Z'),
    ...over,
  };
  return { deps, base, stockage, registre, liensMeta };
}

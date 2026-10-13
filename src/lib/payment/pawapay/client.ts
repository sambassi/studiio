/**
 * Client PawaPay v2 — propre à Studiio, côté serveur uniquement.
 *
 * Configuration lue dans l'environnement (noms seulement, jamais de valeur
 * ici) :
 *   - `PAWAPAY_API_TOKEN` : jeton Bearer du compte PawaPay de Studiio ;
 *   - `PAWAPAY_BASE_URL`  : `https://api.sandbox.pawapay.io` ou
 *     `https://api.pawapay.io`. Selon la doc « Going live », jeton et URL de
 *     base sont les SEULS paramètres qui changent entre sandbox et prod.
 *
 * Aucun appel vers un autre site que l'API PawaPay.
 */
import { PawapayErreur, type DepotDistant } from './types';

const BASE_PAR_DEFAUT = 'https://api.sandbox.pawapay.io';

/**
 * Délai maximal de CHAQUE appel à PawaPay. Sans lui, un PawaPay muet bloque
 * un appel ~300 s (délai par défaut d'undici) et le rattrapage séquentiel
 * peut durer des heures. Au-delà, l'appel lève une `PawapayErreur` : aucune
 * conclusion n'en est tirée, le dépôt reste en attente.
 */
export const DELAI_APPEL_PAWAPAY_MS = 10_000;

function signalDelai(): AbortSignal {
  return AbortSignal.timeout(DELAI_APPEL_PAWAPAY_MS);
}

interface ConfigPawapay {
  token: string;
  base: string;
}

/**
 * Seules origines autorisées pour `PAWAPAY_BASE_URL` (prod et sandbox). Toute
 * autre valeur est refusée AVANT le moindre appel : le jeton ne part jamais
 * vers un hôte inconnu.
 */
const BASES_AUTORISEES = new Set(['https://api.pawapay.io', 'https://api.sandbox.pawapay.io']);

/** Origine normalisée si autorisée, sinon `null`. */
export function baseAutorisee(brut: string): string | null {
  let url: URL;
  try {
    url = new URL(brut.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return BASES_AUTORISEES.has(url.origin) ? url.origin : null;
}

/** Lue à CHAQUE appel : un test ou un redémarrage ne garde pas une vieille valeur. */
function lireConfig(): ConfigPawapay {
  const token = process.env.PAWAPAY_API_TOKEN || '';
  if (!token) throw new PawapayErreur('PawaPay non configuré (PAWAPAY_API_TOKEN absent)');
  const base = baseAutorisee(process.env.PAWAPAY_BASE_URL || BASE_PAR_DEFAUT);
  if (!base) throw new PawapayErreur('PAWAPAY_BASE_URL refusée : hôte hors liste blanche');
  return { token, base };
}

/** L'URL de paiement renvoyée doit être en https sur un hôte `*.pawapay.io`. */
function estUrlPaiementPawapay(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.endsWith('.pawapay.io');
  } catch {
    return false;
  }
}

export function pawapayConfigure(): boolean {
  return Boolean(process.env.PAWAPAY_API_TOKEN);
}

/** `depositId` généré par Studiio : un UUIDv4 (36 caractères), exigé par PawaPay. */
export function genererDepositId(): string {
  return crypto.randomUUID();
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estDepositIdValide(id: unknown): id is string {
  return typeof id === 'string' && UUID_RX.test(id);
}

async function lireJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    throw new PawapayErreur(`Réponse PawaPay illisible (HTTP ${r.status})`, r.status);
  }
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─────────────────────────────────────────────────────────────────────────
// Relecture d'un dépôt — la SEULE source de vérité sur un paiement
// ─────────────────────────────────────────────────────────────────────────

/**
 * `GET /v2/deposits/{depositId}`.
 *
 * Enveloppe v2 : `{ "status": "FOUND", "data": { "status": "COMPLETED", … } }`
 * ou `{ "status": "NOT_FOUND" }`.
 *
 * ⚠️ Le `status` de l'enveloppe (`FOUND`) n'est PAS celui du paiement. Lire
 * `d.status || d.data.status` renvoie « FOUND » pour tout dépôt existant —
 * c'est le bug corrigé ici : on lit `data.status`, et seulement lui.
 *
 * Lève une `PawapayErreur` en cas de panne réseau, de HTTP non-200 ou de
 * réponse inattendue : l'appelant doit alors répondre 5xx, jamais conclure.
 */
export async function lireDepot(depositId: string): Promise<DepotDistant> {
  const { token, base } = lireConfig();
  let r: Response;
  try {
    r = await fetch(`${base}/v2/deposits/${encodeURIComponent(depositId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: signalDelai(),
    });
  } catch (e) {
    throw new PawapayErreur(`PawaPay injoignable : ${(e as Error)?.message ?? e}`);
  }
  if (r.status !== 200) {
    throw new PawapayErreur(`Relecture du dépôt refusée (HTTP ${r.status})`, r.status);
  }
  const d = await lireJson(r);
  if (!estObjet(d)) throw new PawapayErreur('Relecture du dépôt : réponse inattendue', r.status);

  if (d.status === 'NOT_FOUND') return { trouve: false, depositId };

  if (d.status === 'FOUND' && estObjet(d.data)) {
    const data = d.data;
    const statut = typeof data.status === 'string' ? data.status : '';
    const montant = typeof data.amount === 'string' || typeof data.amount === 'number'
      ? String(data.amount) : '';
    const devise = typeof data.currency === 'string' ? data.currency : '';
    if (!statut) throw new PawapayErreur('Relecture du dépôt : data.status absent', r.status);
    return {
      trouve: true,
      depositId: typeof data.depositId === 'string' ? data.depositId : depositId,
      statut,
      montant,
      devise,
      pays: typeof data.country === 'string' ? data.country : undefined,
      metadata: estObjet(data.metadata) ? data.metadata : undefined,
    };
  }
  throw new PawapayErreur(`Relecture du dépôt : enveloppe inconnue (${String(d.status)})`, r.status);
}

// ─────────────────────────────────────────────────────────────────────────
// Payment Page
// ─────────────────────────────────────────────────────────────────────────

export interface ArgsPagePaiement {
  /** UUID généré par Studiio et ENREGISTRÉ avant l'appel (seule trace si le réseau lâche). */
  depositId: string;
  /** Montant en unité majeure, chaîne décimale (ex. « 5900 »). */
  montant: string;
  devise: string;
  /** ISO 3166-1 alpha-3 (ex. « CIV »). */
  pays?: string;
  /** Affiché au client, 50 caractères maximum. */
  motif?: string;
  /** Redirection NAVIGATEUR après paiement — ce n'est PAS un callback. */
  urlRetour: string;
  telephone?: string;
  langue?: 'FR' | 'EN';
  /**
   * Métadonnées : au plus 10 champs. Format v2 : TABLEAU d'objets à une clé,
   * `[{ "orderId": "…" }, { "customerId": "…", "isPII": true }]`.
   */
  metadata?: Array<Record<string, string | boolean>>;
}

/** Noms tolérés pour l'URL renvoyée (`redirectUrl` dans la doc v2). */
const CHAMPS_URL = ['redirectUrl', 'redirectURL', 'paymentPageUrl', 'paymentUrl', 'url', 'sessionUrl'];

async function posterPagePaiement(base: string, token: string, payload: Record<string, unknown>) {
  let r: Response;
  try {
    r = await fetch(`${base}/v2/paymentpage`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signalDelai(),
    });
  } catch (e) {
    throw new PawapayErreur(`PawaPay injoignable : ${(e as Error)?.message ?? e}`);
  }
  const d = await lireJson(r);
  if (!estObjet(d)) throw new PawapayErreur('Payment Page : réponse inattendue', r.status);
  return { r, d };
}

function codeEchec(d: Record<string, unknown>): { code: string; message: string } | null {
  const f = d.failureReason;
  if (!estObjet(f)) return null;
  return {
    code: typeof f.failureCode === 'string' ? f.failureCode : '',
    message: typeof f.failureMessage === 'string' ? f.failureMessage : '',
  };
}

/**
 * `POST /v2/paymentpage` — ouvre une session et renvoie l'URL de paiement.
 *
 * - Schéma v2 : `amountDetails: { amount, currency }` et `phoneNumber`.
 * - Un refus peut arriver avec HTTP 200 et un `failureReason` : sa présence
 *   fait foi, quel que soit le code HTTP.
 * - Sur `INVALID_PHONE_NUMBER`, UNE relance sans téléphone : le client le
 *   saisira sur la page. Le montant reste fixé.
 */
export async function creerPagePaiement(args: ArgsPagePaiement): Promise<{ redirectUrl: string }> {
  const { token, base } = lireConfig();
  if (!estDepositIdValide(args.depositId)) {
    throw new PawapayErreur('depositId invalide : un UUID est exigé');
  }
  const payload: Record<string, unknown> = {
    depositId: args.depositId,
    returnUrl: args.urlRetour,
    language: args.langue ?? 'FR',
    amountDetails: { amount: args.montant, currency: args.devise },
  };
  if (args.pays) payload.country = args.pays;
  if (args.motif) payload.reason = args.motif.slice(0, 50);
  const tel = (args.telephone || '').replace(/[^0-9]/g, '');
  if (tel) payload.phoneNumber = tel;
  if (args.metadata && args.metadata.length > 0) payload.metadata = args.metadata.slice(0, 10);

  let { r, d } = await posterPagePaiement(base, token, payload);
  let echec = codeEchec(d);

  if (echec?.code === 'INVALID_PHONE_NUMBER' && 'phoneNumber' in payload) {
    delete payload.phoneNumber;
    ({ r, d } = await posterPagePaiement(base, token, payload));
    echec = codeEchec(d);
  }

  if (echec || (r.status !== 200 && r.status !== 201)) {
    const detail = [`HTTP ${r.status}`, echec?.code, echec?.message?.slice(0, 200)]
      .filter(Boolean).join(' / ');
    throw new PawapayErreur(`Payment Page refusée (${detail})`, r.status, echec?.code);
  }

  // Seule une URL https sur `*.pawapay.io` est acceptée : le navigateur de
  // l'utilisateur ne doit jamais être envoyé ailleurs.
  for (const champ of CHAMPS_URL) {
    const v = d[champ];
    if (estUrlPaiementPawapay(v)) return { redirectUrl: v };
  }
  // Les NOMS des champs seulement : une URL de paiement porte un jeton de session.
  throw new PawapayErreur(
    `Payment Page sans URL PawaPay valide (champs reçus : ${Object.keys(d).sort().join(', ')})`,
    r.status,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pays actifs sur le compte
// ─────────────────────────────────────────────────────────────────────────

export interface PaysActif {
  /** ISO alpha-3. */
  pays: string;
  devises: string[];
}

const DUREE_CACHE_MS = 5 * 60 * 1000;
let cachePays: { expire: number; valeur: PaysActif[] } | null = null;

/** Pour les tests. */
export function viderCachePays(): void {
  cachePays = null;
}

/**
 * `GET /v2/active-conf` — pays et devises RÉELLEMENT ouverts sur le compte.
 * Jamais de liste en dur. Cache court (5 min) ; une erreur n'est pas mise en
 * cache.
 */
export async function paysActifs(maintenant: number = Date.now()): Promise<PaysActif[]> {
  if (cachePays && cachePays.expire > maintenant) return cachePays.valeur;
  const { token, base } = lireConfig();
  let r: Response;
  try {
    r = await fetch(`${base}/v2/active-conf`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: signalDelai(),
    });
  } catch (e) {
    throw new PawapayErreur(`PawaPay injoignable : ${(e as Error)?.message ?? e}`);
  }
  if (r.status !== 200) throw new PawapayErreur(`active-conf refusée (HTTP ${r.status})`, r.status);
  const d = await lireJson(r);
  const pays = estObjet(d) && Array.isArray(d.countries) ? d.countries : [];
  const valeur: PaysActif[] = [];
  for (const p of pays) {
    if (!estObjet(p) || typeof p.country !== 'string') continue;
    const devises = new Set<string>();
    for (const prov of Array.isArray(p.providers) ? p.providers : []) {
      if (!estObjet(prov)) continue;
      for (const c of Array.isArray(prov.currencies) ? prov.currencies : []) {
        if (estObjet(c) && typeof c.currency === 'string') devises.add(c.currency);
      }
    }
    if (devises.size > 0) valeur.push({ pays: p.country, devises: [...devises].sort() });
  }
  valeur.sort((a, b) => a.pays.localeCompare(b.pays));
  cachePays = { expire: maintenant + DUREE_CACHE_MS, valeur };
  return valeur;
}

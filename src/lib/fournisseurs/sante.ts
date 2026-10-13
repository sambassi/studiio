/**
 * SANTÉ ET FINANCEMENT DES FOURNISSEURS — le solde de STUDIIO chez ses
 * prestataires, à ne JAMAIS confondre avec les crédits de l'utilisateur.
 *
 * L'utilisateur paie Studiio (abonnement, crédits Studiio). Studiio paie ses
 * fournisseurs. Le 2026-10-12, neuf vidéos d'avatar ont échoué parce que le
 * compte API HeyGen était vide (« Insufficient credit. This operation requires
 * 'api' credits. ») : l'utilisateur l'a découvert en générant, sans que
 * personne n'ait été prévenu. Ce module :
 *
 *   - lit le solde là où le fournisseur l'expose OFFICIELLEMENT (HeyGen
 *     `GET /v3/users/me`, D-ID `GET /credits`, ElevenLabs `GET
 *     /v1/user/subscription` = quota de caractères) ; Replicate n'expose aucun
 *     solde : « non mesurable », jamais inventé ;
 *   - classe l'état (opérationnel / faible / critique / bloqué / inconnu) ;
 *   - constate les recharges automatiques (solde qui remonte) et les compte,
 *     avec plafonds jour/mois — une boucle de recharge se voit et alerte ;
 *   - alerte l'admin (bannière Studiio Admin + email pour le CRITICAL) ;
 *   - sait dire, avant un appel coûteux, si le fournisseur est utilisable, et
 *     tenter UNE récupération (relecture du solde) sous bail : deux
 *     utilisateurs simultanés ne déclenchent qu'une vérification.
 *
 * ⚠️ AUCUN FOURNISSEUR NE DOCUMENTE DE RECHARGE PAR API (HeyGen, ElevenLabs,
 * Replicate, D-ID — vérifié dans leurs docs officielles). Studiio ne déclenche
 * donc JAMAIS de paiement : la recharge est le mécanisme officiel du compte
 * fournisseur (auto-reload / auto top-up), que Studiio SURVEILLE. Aucun numéro
 * de carte, aucune clé n'est lu, stocké ou affiché ici.
 *
 * Stockage SANS MIGRATION : `app_settings` (key, value jsonb, updated_at).
 *   - `provider_billing_config` : seuils et plafonds réglés par l'admin ;
 *   - `provider_health_state`   : dernier solde, statut, recharges, erreurs ;
 *   - `provider_lock:<id>`      : bail court (une vérification à la fois).
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { reportServiceAlert, type AlertSeverity } from '@/lib/service-alerts';
import { sendEmailSilent } from '@/lib/email/resend';
import { enteteAutorisationDid } from '@/lib/providers/did/client';

export const FOURNISSEURS_SURVEILLES = ['heygen', 'elevenlabs', 'replicate', 'did'] as const;
export type FournisseurId = (typeof FOURNISSEURS_SURVEILLES)[number];

export const NOMS_FOURNISSEURS: Record<FournisseurId, string> = {
  heygen: 'HeyGen',
  elevenlabs: 'ElevenLabs',
  replicate: 'Replicate',
  did: 'D-ID',
};

/** Ce que chaque fournisseur permet OFFICIELLEMENT — rien de plus. */
export const CAPACITES: Record<FournisseurId, { soldeApi: boolean; unite: string; rechargeOfficielle: string }> = {
  heygen: {
    soldeApi: true,
    unite: 'usd',
    rechargeOfficielle: 'Auto-reload du wallet API, réglé dans le compte HeyGen (lu par Studiio, jamais déclenché).',
  },
  elevenlabs: {
    soldeApi: true,
    unite: 'caractères',
    rechargeOfficielle: 'Auto Top Up (Developers → Top Up) dans le compte ElevenLabs. Le solde PAYG n’est pas exposé par l’API : seul le quota de caractères l’est.',
  },
  replicate: {
    soldeApi: false,
    unite: 'usd',
    rechargeOfficielle: 'Auto-reload dans les billing settings Replicate. Aucune API de solde : surveillance par les refus seulement.',
  },
  did: {
    soldeApi: true,
    unite: 'crédits',
    rechargeOfficielle: 'Crédits d’abonnement mensuels D-ID ; aucune recharge automatique documentée.',
  },
};

export type StatutFournisseur = 'operationnel' | 'faible' | 'critique' | 'bloque' | 'inconnu';

export interface ConfigFournisseur {
  /** Sous ce solde : WARNING. */
  seuilBas: number;
  /** Sous ce solde : CRITICAL (et pré-vérification renforcée). */
  seuilCritique: number;
  /** L'admin a activé la recharge automatique CHEZ le fournisseur. */
  autoRechargeAttendue: boolean;
  /** Montant attendu d'une recharge (sert à reconnaître une recharge). */
  montantRecharge: number;
  /** Au-delà, des recharges constatées sont une anomalie (boucle) : CRITICAL. */
  maxRechargesJour: number;
  maxRechargesMois: number;
}

export const CONFIG_PAR_DEFAUT: Record<FournisseurId, ConfigFournisseur> = {
  heygen: { seuilBas: 30, seuilCritique: 10, autoRechargeAttendue: true, montantRecharge: 30, maxRechargesJour: 3, maxRechargesMois: 20 },
  elevenlabs: { seuilBas: 20_000, seuilCritique: 5_000, autoRechargeAttendue: true, montantRecharge: 20, maxRechargesJour: 3, maxRechargesMois: 20 },
  replicate: { seuilBas: 20, seuilCritique: 5, autoRechargeAttendue: true, montantRecharge: 15, maxRechargesJour: 3, maxRechargesMois: 20 },
  did: { seuilBas: 20, seuilCritique: 5, autoRechargeAttendue: false, montantRecharge: 0, maxRechargesJour: 0, maxRechargesMois: 0 },
};

export interface EtatFournisseur {
  statut: StatutFournisseur;
  solde: number | null;
  devise: string;
  /** Réglage d'auto-reload LU chez le fournisseur, s'il l'expose. */
  autoReload: { active: boolean; seuil: number | null; montant: number | null } | null;
  derniereVerification: string | null;
  derniereRecharge: string | null;
  derniereRechargeMontant: number | null;
  rechargesJour: { jour: string; n: number };
  rechargesMois: { mois: string; n: number };
  /** Dernière consommation constatée (baisse de solde entre deux lectures). */
  derniereConsommation: { le: string; montant: number } | null;
  /** Message brut du fournisseur — ADMIN SEULEMENT. */
  derniereErreur: string | null;
  bloqueDepuis: string | null;
}

export function etatVide(id: FournisseurId): EtatFournisseur {
  return {
    statut: 'inconnu', solde: null, devise: CAPACITES[id].unite, autoReload: null,
    derniereVerification: null, derniereRecharge: null, derniereRechargeMontant: null,
    rechargesJour: { jour: '', n: 0 }, rechargesMois: { mois: '', n: 0 },
    derniereConsommation: null, derniereErreur: null, bloqueDepuis: null,
  };
}

// ── Lecture du solde (adaptateurs officiels) ────────────────────────────────

export interface LectureSolde {
  solde: number;
  devise: string;
  autoReload: EtatFournisseur['autoReload'];
}

type Fetch = typeof fetch;

/**
 * Le solde tel que le fournisseur l'expose — `null` si aucune API officielle
 * (Replicate) ou clé absente. Une erreur réseau/HTTP LÈVE : l'appelant la
 * consigne sans changer le statut (une panne de lecture n'est pas un solde nul).
 */
export async function lireSolde(id: FournisseurId, deps: { env?: NodeJS.ProcessEnv; fetch?: Fetch } = {}): Promise<LectureSolde | null> {
  const env = deps.env ?? process.env;
  const f = deps.fetch ?? fetch;
  const lire = async (url: string, headers: Record<string, string>) => {
    const res = await f(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`${NOMS_FOURNISSEURS[id]} : lecture du solde HTTP ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

  if (id === 'heygen') {
    const cle = env.HEYGEN_API_KEY;
    if (!cle) return null;
    // https://developers.heygen.com/reference/get-current-user
    const json = await lire('https://api.heygen.com/v3/users/me', { 'x-api-key': cle, Accept: 'application/json' });
    const d = (json.data ?? json) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const wallet = d?.wallet ?? null;
    if (wallet && nombre(wallet.remaining_balance) !== null) {
      const ar = wallet.auto_reload ?? null;
      return {
        solde: nombre(wallet.remaining_balance)!,
        devise: typeof wallet.currency === 'string' ? wallet.currency : 'usd',
        autoReload: ar ? { active: ar.enabled === true, seuil: nombre(ar.threshold_usd), montant: nombre(ar.amount_usd) } : null,
      };
    }
    const ub = d?.usage_based ?? null;
    if (ub && nombre(ub.spending_cap_usd) !== null && nombre(ub.spending_current_usd) !== null) {
      return { solde: nombre(ub.spending_cap_usd)! - nombre(ub.spending_current_usd)!, devise: 'usd', autoReload: null };
    }
    const sub = d?.subscription?.credits ?? null;
    if (sub) {
      const total = (nombre(sub.premium_credits?.remaining) ?? 0) + (nombre(sub.add_on_credits?.remaining) ?? 0);
      return { solde: total, devise: 'crédits', autoReload: null };
    }
    throw new Error('HeyGen : réponse de solde sans wallet, usage_based ni subscription.');
  }
  if (id === 'did') {
    const cle = env.DID_API_KEY;
    if (!cle) return null;
    // https://docs.d-id.com/reference/getcredits
    // Même en-tête que le client D-ID (clé `user:secret` encodée en base64).
    const json = await lire('https://api.d-id.com/credits', { Authorization: enteteAutorisationDid(cle), Accept: 'application/json' });
    const restant = nombre(json.remaining);
    if (restant === null) throw new Error('D-ID : réponse de crédits sans `remaining`.');
    return { solde: restant, devise: 'crédits', autoReload: null };
  }
  if (id === 'elevenlabs') {
    const cle = env.ELEVENLABS_API_KEY;
    if (!cle) return null;
    // https://elevenlabs.io/docs/api-reference/user/subscription/get
    const json = await lire('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': cle, Accept: 'application/json' });
    const limite = nombre(json.character_limit);
    const conso = nombre(json.character_count);
    if (limite === null || conso === null) throw new Error('ElevenLabs : réponse d’abonnement sans character_limit/character_count.');
    return { solde: Math.max(0, limite - conso), devise: 'caractères', autoReload: null };
  }
  return null; // replicate : aucune API de solde documentée.
}

// ── Classement (pur) ────────────────────────────────────────────────────────

export function evaluerStatut(solde: number | null, config: ConfigFournisseur): StatutFournisseur {
  if (solde === null) return 'inconnu';
  if (solde <= 0) return 'bloque';
  if (solde < config.seuilCritique) return 'critique';
  if (solde < config.seuilBas) return 'faible';
  return 'operationnel';
}

/** Un refus fournisseur dit-il « solde/crédits épuisés » ? (HeyGen, ElevenLabs, D-ID, Replicate) */
export function estRefusDeSolde(brut: string | null | undefined, httpStatus?: number | null): boolean {
  if (httpStatus === 402) return true;
  if (!brut) return false;
  return /insufficient[_\s-]*credit|requires\s+'?api'?\s+credits|not\s+enough\s+credits|out\s+of\s+credits|payment[_\s-]*required|did_insufficient_credits/i.test(brut);
}

// ── Stockage (app_settings) — injectable pour les tests ─────────────────────

export interface Magasin {
  lire<T>(cle: string): Promise<T | null>;
  ecrire(cle: string, valeur: unknown): Promise<void>;
  /** Crée la clé SEULEMENT si elle n'existe pas ; `false` si elle existe déjà. */
  creerSiAbsente(cle: string, valeur: unknown): Promise<boolean>;
  supprimer(cle: string): Promise<void>;
}

/** Une valeur jsonb écrite tantôt en objet, tantôt en chaîne JSON (/api/admin/settings). */
function relire<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return null; } }
  return v as T;
}

export const magasinAppSettings: Magasin = {
  async lire<T>(cle: string) {
    const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', cle).maybeSingle();
    if (error) throw new Error(`app_settings ${cle} : ${error.message}`);
    return relire<T>((data as { value?: unknown } | null)?.value);
  },
  async ecrire(cle, valeur) {
    const { error } = await supabaseAdmin.from('app_settings')
      .upsert({ key: cle, value: valeur, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw new Error(`app_settings ${cle} : ${error.message}`);
  },
  async creerSiAbsente(cle, valeur) {
    const { error } = await supabaseAdmin.from('app_settings')
      .insert({ key: cle, value: valeur, updated_at: new Date().toISOString() });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(`app_settings ${cle} : ${error.message}`);
  },
  async supprimer(cle) {
    await supabaseAdmin.from('app_settings').delete().eq('key', cle);
  },
};

export const CLE_CONFIG = 'provider_billing_config';
export const CLE_ETAT = 'provider_health_state';
const cleBail = (id: FournisseurId) => `provider_lock:${id}`;
export const DUREE_BAIL_MS = 60_000;

export async function lireConfig(m: Magasin = magasinAppSettings): Promise<Record<FournisseurId, ConfigFournisseur>> {
  const brut = (await m.lire<Partial<Record<FournisseurId, Partial<ConfigFournisseur>>>>(CLE_CONFIG).catch(() => null)) ?? {};
  const out = {} as Record<FournisseurId, ConfigFournisseur>;
  for (const id of FOURNISSEURS_SURVEILLES) out[id] = assainirConfig({ ...CONFIG_PAR_DEFAUT[id], ...(brut[id] ?? {}) }, id);
  return out;
}

/** Bornes de sécurité : aucun plafond négatif ou infini ne passe. */
export function assainirConfig(c: Partial<ConfigFournisseur>, id: FournisseurId): ConfigFournisseur {
  const d = CONFIG_PAR_DEFAUT[id];
  const n = (v: unknown, def: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : def);
  const seuilBas = n(c.seuilBas, d.seuilBas, 1e9);
  return {
    seuilBas,
    seuilCritique: Math.min(n(c.seuilCritique, d.seuilCritique, 1e9), seuilBas),
    autoRechargeAttendue: typeof c.autoRechargeAttendue === 'boolean' ? c.autoRechargeAttendue : d.autoRechargeAttendue,
    montantRecharge: n(c.montantRecharge, d.montantRecharge, 10_000),
    maxRechargesJour: Math.floor(n(c.maxRechargesJour, d.maxRechargesJour, 50)),
    maxRechargesMois: Math.floor(n(c.maxRechargesMois, d.maxRechargesMois, 500)),
  };
}

export async function lireEtats(m: Magasin = magasinAppSettings): Promise<Record<FournisseurId, EtatFournisseur>> {
  const brut = (await m.lire<Partial<Record<FournisseurId, Partial<EtatFournisseur>>>>(CLE_ETAT).catch(() => null)) ?? {};
  const out = {} as Record<FournisseurId, EtatFournisseur>;
  for (const id of FOURNISSEURS_SURVEILLES) out[id] = { ...etatVide(id), ...(brut[id] ?? {}) };
  return out;
}

async function ecrireEtat(id: FournisseurId, etat: EtatFournisseur, m: Magasin): Promise<void> {
  // Relu juste avant d'écrire : les autres fournisseurs ne sont pas écrasés.
  const tous = await lireEtats(m);
  tous[id] = etat;
  await m.ecrire(CLE_ETAT, tous);
}

// ── Bail : une seule vérification/récupération à la fois ────────────────────

/**
 * Exécute `fn` sous un bail `provider_lock:<id>` (création exclusive de la clé
 * dans `app_settings`). Un bail périmé (instance tombée) est repris. Rend
 * `null` si un autre détient le bail : l'appelant ATTEND, il ne refait pas.
 */
export async function sousBail<T>(id: FournisseurId, fn: () => Promise<T>, m: Magasin = magasinAppSettings, now = () => Date.now()): Promise<T | null> {
  const cle = cleBail(id);
  const jeton = `${now()}-${Math.random().toString(36).slice(2)}`;
  let pris = await m.creerSiAbsente(cle, { jeton, expireLe: now() + DUREE_BAIL_MS });
  if (!pris) {
    const actuel = await m.lire<{ jeton?: string; expireLe?: number }>(cle).catch(() => null);
    if (actuel && typeof actuel.expireLe === 'number' && actuel.expireLe < now()) {
      await m.supprimer(cle);
      pris = await m.creerSiAbsente(cle, { jeton, expireLe: now() + DUREE_BAIL_MS });
    }
  }
  if (!pris) return null;
  try {
    return await fn();
  } finally {
    const actuel = await m.lire<{ jeton?: string }>(cle).catch(() => null);
    if (actuel?.jeton === jeton) await m.supprimer(cle);
  }
}

// ── Alertes admin ───────────────────────────────────────────────────────────

export interface Alerteur {
  (id: FournisseurId, severite: AlertSeverity, message: string, details?: string): Promise<void>;
}

/** Bannière Studiio Admin (`service_alerts`) ; CRITICAL → aussi un email admin. */
export const alerterAdmin: Alerteur = async (id, severite, message, details) => {
  await reportServiceAlert(id, severite, message, details);
  if (severite === 'critical') {
    const to = process.env.ADMIN_EMAIL || 'admin@studiio.pro';
    const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    void sendEmailSilent({
      to,
      subject: `[Studiio Fournisseurs] ${message}`,
      html: `<p><b>${esc(message)}</b></p>${details ? `<p>${esc(details)}</p>` : ''}<p>Studiio n’a déclenché aucun paiement. Détail : Admin › Fournisseurs.</p>`,
    });
  }
};

export const MESSAGES_ADMIN = {
  rechargeConstatee: (nom: string, montant: number, devise: string) => `${nom} : ${formatMontant(montant, devise)} ajoutés automatiquement.`,
  soldeFaible: (nom: string) => `${nom} : solde fournisseur faible.`,
  rechargeImpossible: (nom: string) => `${nom} : recharge automatique impossible.`,
  bloque: (nom: string) => `${nom} : fournisseur bloqué — génération mise en attente.`,
  rechargesAnormales: (nom: string) => `${nom} : recharges automatiques anormalement fréquentes.`,
} as const;

function formatMontant(montant: number, devise: string): string {
  const arrondi = Math.round(montant * 100) / 100;
  if (devise === 'usd') return `${arrondi} $`;
  return `${arrondi} ${devise}`;
}

// ── Vérification d'un fournisseur ───────────────────────────────────────────

export interface DepsSante {
  magasin?: Magasin;
  alerter?: Alerteur;
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  now?: () => number;
}

/**
 * Lit le solde, met à jour l'état, émet les alertes. À appeler SOUS BAIL
 * (`verifierFournisseur`). Une recharge est CONSTATÉE quand le solde remonte
 * d'au moins la moitié du montant attendu — comptée contre les plafonds.
 */
export async function majEtatDepuisSolde(id: FournisseurId, deps: DepsSante = {}): Promise<EtatFournisseur> {
  const m = deps.magasin ?? magasinAppSettings;
  const alerter = deps.alerter ?? alerterAdmin;
  const now = deps.now ?? (() => Date.now());
  const config = (await lireConfig(m))[id];
  const avant = (await lireEtats(m))[id];
  const iso = new Date(now()).toISOString();
  const nom = NOMS_FOURNISSEURS[id];

  let lecture: LectureSolde | null;
  try {
    lecture = await lireSolde(id, { env: deps.env, fetch: deps.fetch });
  } catch (e) {
    const etat = { ...avant, derniereVerification: iso, derniereErreur: e instanceof Error ? e.message : String(e) };
    await ecrireEtat(id, etat, m);
    return etat;
  }
  if (!lecture) {
    // Aucune API de solde : on garde le statut déduit des refus (bloqué ou non).
    const etat = { ...avant, derniereVerification: iso };
    await ecrireEtat(id, etat, m);
    return etat;
  }

  const jour = iso.slice(0, 10);
  const mois = iso.slice(0, 7);
  const etat: EtatFournisseur = {
    ...avant,
    solde: lecture.solde,
    devise: lecture.devise,
    autoReload: lecture.autoReload,
    derniereVerification: iso,
    rechargesJour: avant.rechargesJour.jour === jour ? avant.rechargesJour : { jour, n: 0 },
    rechargesMois: avant.rechargesMois.mois === mois ? avant.rechargesMois : { mois, n: 0 },
  };
  const delta = avant.solde === null ? 0 : lecture.solde - avant.solde;
  const seuilRecharge = Math.max(0.01, config.montantRecharge * 0.5);
  if (avant.solde !== null && delta >= seuilRecharge) {
    etat.derniereRecharge = iso;
    etat.derniereRechargeMontant = delta;
    etat.rechargesJour = { jour, n: etat.rechargesJour.n + 1 };
    etat.rechargesMois = { mois, n: etat.rechargesMois.n + 1 };
    await alerter(id, 'info', MESSAGES_ADMIN.rechargeConstatee(nom, delta, lecture.devise));
    if (etat.rechargesJour.n > config.maxRechargesJour || etat.rechargesMois.n > config.maxRechargesMois) {
      await alerter(id, 'critical', MESSAGES_ADMIN.rechargesAnormales(nom),
        `${etat.rechargesJour.n} recharge(s) aujourd’hui (plafond ${config.maxRechargesJour}), ${etat.rechargesMois.n} ce mois (plafond ${config.maxRechargesMois}). Vérifiez le réglage d’auto-reload chez ${nom}.`);
    }
  } else if (delta < 0) {
    etat.derniereConsommation = { le: iso, montant: -delta };
  }

  etat.statut = evaluerStatut(lecture.solde, config);
  if (etat.statut === 'operationnel' || etat.statut === 'faible') {
    etat.bloqueDepuis = null;
    etat.derniereErreur = avant.statut === 'bloque' ? null : avant.derniereErreur;
  }
  const autoActive = lecture.autoReload ? lecture.autoReload.active : config.autoRechargeAttendue;
  if (etat.statut === 'faible') {
    await alerter(id, 'warning', MESSAGES_ADMIN.soldeFaible(nom), `Solde ${formatMontant(lecture.solde, lecture.devise)} (seuil ${config.seuilBas}).`);
  } else if (etat.statut === 'critique' || etat.statut === 'bloque') {
    await alerter(id, 'warning', MESSAGES_ADMIN.soldeFaible(nom), `Solde ${formatMontant(lecture.solde, lecture.devise)} (seuil critique ${config.seuilCritique}).`);
    if (!autoActive) {
      await alerter(id, 'critical', MESSAGES_ADMIN.rechargeImpossible(nom),
        `Recharge automatique désactivée chez ${nom}. Solde ${formatMontant(lecture.solde, lecture.devise)}. Activez l’auto-reload ou rechargez manuellement.`);
    }
  }
  if (etat.statut === 'bloque') etat.bloqueDepuis = avant.bloqueDepuis ?? iso;
  await ecrireEtat(id, etat, m);
  return etat;
}

/** Vérifie sous bail ; `null` si une autre instance vérifie déjà. */
export async function verifierFournisseur(id: FournisseurId, deps: DepsSante = {}): Promise<EtatFournisseur | null> {
  return sousBail(id, () => majEtatDepuisSolde(id, deps), deps.magasin ?? magasinAppSettings, deps.now);
}

/**
 * Un appel fournisseur vient d'être REFUSÉ faute de solde : statut « bloqué »,
 * alerte CRITICAL (bannière + email), message brut gardé pour l'admin.
 */
export async function signalerRefusDeSolde(id: FournisseurId, brut: string, deps: DepsSante = {}): Promise<void> {
  const m = deps.magasin ?? magasinAppSettings;
  const alerter = deps.alerter ?? alerterAdmin;
  const now = deps.now ?? (() => Date.now());
  try {
    const avant = (await lireEtats(m))[id];
    const iso = new Date(now()).toISOString();
    await ecrireEtat(id, { ...avant, statut: 'bloque', bloqueDepuis: avant.bloqueDepuis ?? iso, derniereErreur: brut.slice(0, 500) }, m);
    await alerter(id, 'critical', MESSAGES_ADMIN.bloque(NOMS_FOURNISSEURS[id]), `Refus du fournisseur : ${brut.slice(0, 300)}`);
  } catch (e) {
    console.error(`[Fournisseurs] ${id} : refus de solde non consigné :`, e instanceof Error ? e.message : e);
  }
}

// ── Pré-vérification avant un appel coûteux ─────────────────────────────────

/** Récupérations en cours DANS cette instance : un seul appel concurrent. */
const recuperationsEnCours = new Map<FournisseurId, Promise<boolean>>();

/**
 * Le fournisseur est-il utilisable MAINTENANT ?
 *
 *   - jamais bloqué → oui, sans aucun appel réseau (le chemin normal ne paie
 *     aucune latence) ;
 *   - bloqué → UNE tentative de récupération : relecture du solde sous bail.
 *     Recharge automatique passée entre-temps → oui, la génération continue
 *     (l'utilisateur ne voit rien). Toujours vide, ou vérification déjà en
 *     cours ailleurs → non : l'appelant met le travail EN ATTENTE.
 *   - fournisseur sans API de solde (Replicate) bloqué → on retente après
 *     `REESSAI_SANS_SOLDE_MS` : seul un nouvel appel peut prouver la recharge.
 */
export const REESSAI_SANS_SOLDE_MS = 10 * 60_000;

export async function fournisseurDisponible(id: FournisseurId, deps: DepsSante = {}): Promise<boolean> {
  const m = deps.magasin ?? magasinAppSettings;
  const now = deps.now ?? (() => Date.now());
  let etat: EtatFournisseur;
  try {
    etat = (await lireEtats(m))[id];
  } catch {
    return true; // état illisible : on ne bloque pas un utilisateur sur une panne de lecture.
  }
  if (etat.statut !== 'bloque') return true;
  if (!CAPACITES[id].soldeApi) {
    const depuis = etat.bloqueDepuis ? Date.parse(etat.bloqueDepuis) : 0;
    return now() - depuis > REESSAI_SANS_SOLDE_MS;
  }
  const enCours = recuperationsEnCours.get(id);
  if (enCours) return enCours;
  const tentative = (async () => {
    const nouvel = await verifierFournisseur(id, deps).catch(() => null);
    return !!nouvel && nouvel.statut !== 'bloque' && nouvel.statut !== 'inconnu';
  })();
  recuperationsEnCours.set(id, tentative);
  try {
    return await tentative;
  } finally {
    recuperationsEnCours.delete(id);
  }
}

/** Pour les tests : vide l'état mémoire. */
export function _reinitialiserSante(): void {
  recuperationsEnCours.clear();
}

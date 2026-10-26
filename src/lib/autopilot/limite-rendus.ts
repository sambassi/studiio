/**
 * LIMITE GLOBALE DE RENDUS AUTOPILOTE — tous comptes, toutes instances.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME
 * ─────────────────────────────────────────────────────────────────────────
 * Un montage Autopilote lance Chromium + ffmpeg. Les verrous existants sont PAR
 * COMPTE (`enVol`, ligne `manuel-direct`, jeton de créneau) : N comptes qui
 * produisent en même temps lançaient N rendus sur une machine qui n'en porte
 * qu'un ou deux. Le compteur Remotion (`occupation-remotion.ts`) est passif et
 * ne refuse rien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE FAIT CE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 * Un BAIL en base (`rendu_baux`, migration `2026-10-28-rendus-baux-globaux.sql`) par
 * rendu actif. La base compte et insère sous UN verrou consultatif : au plus
 * `STUDIIO_RENDUS_MAX_SIMULTANES` rendus, quel que soit le nombre de conteneurs.
 *
 *   - le rendu ATTEND sa place (sondage borné par `STUDIIO_RENDUS_ATTENTE_MAX_S`)
 *     au lieu d'échouer ; la progression dit « en file d'attente » ;
 *   - le bail est renouvelé pendant le rendu et expire seul si le conteneur meurt
 *     (aucune place bloquée pour toujours) ;
 *   - le même `jobId` ne tient jamais deux baux : un second lancement du même
 *     créneau reçoit `doublon` (jamais deux exécutions, jamais deux débits) ;
 *   - le bail est libéré dans tous les cas (succès, erreur, exception).
 *
 * Attente épuisée : `RenduOccupeError` — rien n'a été rendu ni débité (le débit
 * vient APRÈS le rendu, référence `autopilote:<jobId>`), le cron retentera au
 * passage suivant, la production manuelle l'annonce.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SI LA BASE N'A PAS LES FONCTIONS / SI ELLE EST EN PANNE
 * ─────────────────────────────────────────────────────────────────────────
 * - Fonctions ABSENTES (migration non appliquée, PostgREST non rechargé : PGRST202, 42883, 404) :
 *   état de déploiement, pas une panne. Repli sur un sémaphore EN MÉMOIRE de l'instance, même
 *   plafond, journalisé. Ce n'est PAS la protection globale (une seule instance la voit).
 * - PANNE (exception réseau, erreur 5xx, réponse vide ou illisible) : AUCUN repli, aucun rendu
 *   « par défaut ». On réessaie jusqu'à l'échéance, puis `RenduIndeterminError` (cron : tout de
 *   suite) — rien n'a été rendu, publié ni débité, le créneau est repris au passage suivant.
 * - Juste avant le dépôt du post, `ctx.verifierBail()` renouvelle le bail en base : expiré, repris
 *   ou base muette → `RenduBailPerduError` / `RenduIndeterminError`, donc ni post ni débit.
 * Ni crédits, ni paiement, ni fournisseur ne sont touchés ici.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

/** Plafond par défaut : 1 rendu à la fois. À relever (variable) quand la machine le permet. */
export const RENDUS_MAX_PAR_DEFAUT = 1;
export const RENDUS_MAX_BORNE = 16;
/** Attente maximale d'une place, par défaut (10 min) et plafond (1 h). */
export const ATTENTE_MAX_PAR_DEFAUT_S = 600;
export const ATTENTE_MAX_BORNE_S = 3600;
/** Durée d'un bail (s) et rythme de renouvellement (ms) : 3 battements manqués avant expiration. */
export const BAIL_TTL_S = 120;
export const BAIL_BATTEMENT_MS = 30_000;
/** Sondage pendant l'attente (ms) : assez rare pour ne pas charger la base. */
export const SONDAGE_MIN_MS = 3_000;
export const SONDAGE_MAX_MS = 8_000;

export const VARIABLE_MAX = 'STUDIIO_RENDUS_MAX_SIMULTANES';
/** Places SUPPLÉMENTAIRES réservées aux actions interactives de Créer (export, MP4) : jamais bloquées par Autopilote seul. */
export const VARIABLE_RESERVE_INTERACTIF = 'STUDIIO_RENDUS_RESERVE_INTERACTIF';
export const RESERVE_INTERACTIF_PAR_DEFAUT = 1;
export const RESERVE_INTERACTIF_BORNE = 8;
export const VARIABLE_ATTENTE = 'STUDIIO_RENDUS_ATTENTE_MAX_S';

type Env = Record<string, string | undefined>;

function entierBorne(brut: string | undefined, min: number, max: number, defaut: number): number {
  const v = brut?.trim();
  if (!v || !/^\d+$/.test(v)) return defaut;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : defaut;
}

/** Combien de rendus Autopilote en même temps, sur toute la machine. Valeur invalide : le défaut (prudent). */
export function rendusMaxSimultanes(env: Env = process.env): number {
  return entierBorne(env[VARIABLE_MAX], 1, RENDUS_MAX_BORNE, RENDUS_MAX_PAR_DEFAUT);
}

/**
 * Plafond des actions INTERACTIVES (Créer : export serveur, MP4, rendu de plan) sur le même pool de baux.
 * = plafond d'Autopilote + réserve : Autopilote (en arrière-plan) cède la place à un utilisateur qui attend,
 * mais l'ensemble reste borné (1 + 1 = 2 par défaut). Jamais plus de 16, borne du pool.
 */
export function rendusMaxInteractifs(env: Env = process.env): number {
  const reserve = entierBorne(env[VARIABLE_RESERVE_INTERACTIF], 0, RESERVE_INTERACTIF_BORNE, RESERVE_INTERACTIF_PAR_DEFAUT);
  return Math.min(RENDUS_MAX_BORNE, rendusMaxSimultanes(env) + reserve);
}

/** Attente maximale d'une place (ms). `0` accepté : refus immédiat si occupé. */
export function attenteMaxMs(env: Env = process.env): number {
  return entierBorne(env[VARIABLE_ATTENTE], 0, ATTENTE_MAX_BORNE_S, ATTENTE_MAX_PAR_DEFAUT_S) * 1000;
}

/** Aucune place libre avant la fin de l'attente : rien n'a été rendu, rien n'est débité. */
export class RenduOccupeError extends Error {
  readonly code = 'rendu-occupe';
  constructor() {
    super('Le serveur est très sollicité : aucun emplacement de rendu libre. Rien n’a été débité — réessayez dans quelques minutes.');
    this.name = 'RenduOccupeError';
  }
}

/** Ce travail (même `jobId`) tient déjà un bail vivant : un autre exécutant le traite. */
export class RenduDoublonError extends Error {
  readonly code = 'rendu-doublon';
  constructor(readonly jobId: string, readonly raison: 'en_cours' | 'deja_produit' = 'en_cours') {
    super(raison === 'deja_produit'
      ? `Ce créneau a déjà été produit (${jobId}). Rien n’a été lancé en double.`
      : `Ce montage est déjà en cours de rendu (${jobId}). Rien n’a été lancé en double.`);
    this.name = 'RenduDoublonError';
  }
}

/**
 * À appeler UNE FOIS LE BAIL OBTENU : le créneau a-t-il été produit pendant l'attente ?
 * Le bail n'empêche que les rendus SIMULTANÉS ; un second passage qui attendait derrière
 * le premier obtient le bail dès qu'il le libère — le post existe alors déjà. On relit donc
 * les créneaux produits avant tout travail : s'il y est, `RenduDoublonError('deja_produit')`
 * (levée avant tout rendu et tout débit, le bail est libéré par l'appelant).
 */
export async function verifierCreneauLibre(
  jobId: string, jeton: string, lire: () => Promise<Set<string>>,
): Promise<void> {
  if ((await lire()).has(jeton)) throw new RenduDoublonError(jobId, 'deja_produit');
}

/**
 * La base ne répond pas (ou a répondu de travers) : on ne SAIT PAS si le créneau est déjà produit
 * ni si une place est libre. On ne lance donc rien « par défaut » : rien n'a été rendu, publié ni débité.
 */
export class RenduIndeterminError extends Error {
  readonly code = 'rendu-indetermine';
  constructor(readonly detail: string = '') {
    super('Vérification impossible (base de données indisponible) : rien n’a été lancé, publié ni débité — réessayez dans quelques minutes.');
    this.name = 'RenduIndeterminError';
  }
}

/** Le bail a expiré ou été repris avant le dépôt : sans lui, le montage ne se publie pas. */
export class RenduBailPerduError extends Error {
  readonly code = 'rendu-bail-perdu';
  constructor(readonly jobId: string = '') {
    super('Le droit de rendu a expiré avant le dépôt : rien n’a été publié ni débité — le montage sera relancé.');
    this.name = 'RenduBailPerduError';
  }
}

/** Les erreurs de file : jamais imputables au rush ni au montage, jamais un échec à compter. */
export function estErreurDeFile(err: unknown): err is RenduOccupeError | RenduDoublonError | RenduIndeterminError | RenduBailPerduError {
  return err instanceof RenduOccupeError || err instanceof RenduDoublonError
    || err instanceof RenduIndeterminError || err instanceof RenduBailPerduError;
}

// ── Accès base ─────────────────────────────────────────────────────────────

interface ReponseRpc { data: unknown; error: { code?: string; message?: string } | null }
export type AppelRpc = (fn: string, params: Record<string, unknown>) => PromiseLike<ReponseRpc>;

const rpcParDefaut: AppelRpc = (fn, params) => {
  const client = supabaseAdmin as unknown as { rpc?: AppelRpc };
  // Un client sans `rpc` (doubles de test, environnement sans PostgREST) n'a pas les fonctions : même cas que la migration absente.
  if (typeof client.rpc !== 'function') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'rpc indisponible : client sans rpc' } });
  return client.rpc(fn, params);
};

const premiereLigne = (data: unknown): Record<string, unknown> | null => {
  const l = Array.isArray(data) ? data[0] : data;
  return l && typeof l === 'object' ? (l as Record<string, unknown>) : null;
};

type Prise =
  | { etat: 'pris' }
  | { etat: 'occupe' }
  | { etat: 'doublon' }
  /** Fonctions absentes (migration non appliquée, schéma PostgREST non rechargé) : repli mémoire, journalisé. */
  | { etat: 'absent'; raison: string }
  /** Panne ou réponse illisible : on ne contourne PAS, on réessaie puis on reporte. */
  | { etat: 'panne'; raison: string };

/** Les fonctions `rendu_bail_*` n'existent pas (encore) : c'est un état de déploiement, pas une panne. */
function fonctionAbsente(e: { code?: string; message?: string; status?: number }): boolean {
  return e.code === 'PGRST202' || e.code === '42883' || e.status === 404
    || /could not find the function|schema cache|function .* does not exist/i.test(e.message ?? '');
}

async function prendre(
  rpc: AppelRpc, userId: string, jobId: string, instance: string, max: number,
): Promise<Prise> {
  let r: ReponseRpc;
  try {
    r = await rpc('rendu_bail_prendre', { p_user: userId, p_job: jobId, p_instance: instance, p_max: max, p_ttl_s: BAIL_TTL_S });
  } catch (e) {
    return { etat: 'panne', raison: e instanceof Error ? e.message : String(e) };
  }
  if (!r) return { etat: 'panne', raison: 'aucune réponse' };
  if (r.error) {
    const raison = `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim();
    return fonctionAbsente(r.error) ? { etat: 'absent', raison } : { etat: 'panne', raison };
  }
  const l = premiereLigne(r.data);
  if (!l) return { etat: 'panne', raison: 'réponse vide' };
  if (l.pris === true) return { etat: 'pris' };
  if (l.motif === 'doublon') return { etat: 'doublon' };
  if (l.motif === 'occupe') return { etat: 'occupe' };
  return { etat: 'panne', raison: `réponse inattendue : ${JSON.stringify(l).slice(0, 120)}` };
}

// ── Repli : sémaphore en mémoire de l'instance ─────────────────────────────

interface Local { instance: string; actifs: Set<string>; }
const CLE_LOCALE = Symbol.for('studiio.rendusAutopilote.local');
/**
 * L'état est celui de l'INSTANCE courante : un processus redémarré (nouvel identifiant,
 * `instanceProcessus`) repart d'une mémoire vide — comme en production, où un redémarrage
 * efface tout. Un rendu mort avec son processus ne bloque donc jamais le suivant.
 */
function local(): Local {
  const g = globalThis as unknown as Record<symbol, Local | undefined>;
  const instance = instanceLocale();
  const l = g[CLE_LOCALE];
  if (!l || l.instance !== instance) g[CLE_LOCALE] = { instance, actifs: new Set<string>() };
  return g[CLE_LOCALE] as Local;
}

/** Nombre de rendus tenus par CETTE instance (repli) — pour les tests et le diagnostic. */
export function rendusLocauxActifs(): number { return local().actifs.size; }

// ── Orchestration ──────────────────────────────────────────────────────────

export interface OptionsLimite {
  rpc?: AppelRpc;
  env?: Env;
  instance?: string;
  /** Appelée à chaque tour d'attente (la progression « en file d'attente »). */
  onAttente?: () => void;
  /** Plafond imposé par l'appelant (actions interactives : `rendusMaxInteractifs`). Défaut : `rendusMaxSimultanes`. */
  max?: number;
  /** Attente maximale (ms) imposée par l'appelant, avant la variable. `0` = refus immédiat (cron). */
  attenteMaxMs?: number;
  /** Exécutée bail OBTENU, avant le travail ; si elle lève, le bail est libéré et le travail n'a pas lieu. */
  apresBail?: () => Promise<void>;
  /** Injectables pour les tests. */
  maintenant?: () => number;
  dormir?: (ms: number) => Promise<void>;
  hasard?: () => number;
  avertir?: (message: string) => void;
}

const dormirReel = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/** Ce que `travail` reçoit : de quoi PROUVER, au moment critique, que le bail est toujours le sien. */
export interface ContexteRendu {
  /**
   * À appeler JUSTE AVANT de déposer le post. Renouvelle le bail en base : s'il a expiré, été repris
   * ou si la base ne répond pas, lève (`RenduBailPerduError` / `RenduIndeterminError`) — rien n'est
   * alors publié ni débité. Sans effet en mode mémoire (aucun bail en base à prouver).
   */
  verifierBail: () => Promise<void>;
}

/**
 * Exécute `travail` quand une place de rendu est libre pour `jobId`, la libère ensuite.
 * Lève `RenduOccupeError` / `RenduDoublonError` / `RenduIndeterminError` AVANT d'avoir appelé `travail`.
 *
 * Base en PANNE (ni fonction absente, ni réponse valide) : on NE bascule PAS sur la mémoire. On
 * réessaie jusqu'à l'échéance, puis `RenduIndeterminError` — rien n'est lancé « par défaut ».
 * Seule l'ABSENCE des fonctions (migration non appliquée) retombe sur la limite mémoire, journalisée.
 */
export async function avecLimiteRendus<T>(
  userId: string,
  jobId: string,
  travail: (ctx: ContexteRendu) => Promise<T>,
  o: OptionsLimite = {},
): Promise<T> {
  const rpc = o.rpc ?? rpcParDefaut;
  const env = o.env ?? process.env;
  const max = o.max ?? rendusMaxSimultanes(env);
  const attenteMax = o.attenteMaxMs ?? attenteMaxMs(env);
  const instance = o.instance ?? instanceLocale();
  const maintenant = o.maintenant ?? Date.now;
  const dormir = o.dormir ?? dormirReel;
  const hasard = o.hasard ?? Math.random;
  const avertir = o.avertir ?? ((m: string) => console.warn(m));

  const echeance = maintenant() + attenteMax;
  let modeLocal = false;
  let avertiLocal = false;
  let avertiPanne = false;
  let derniereRaisonPanne = '';

  for (;;) {
    let issue: Prise;
    if (modeLocal) {
      const l = local();
      issue = l.actifs.has(jobId) ? { etat: 'doublon' } : l.actifs.size >= max ? { etat: 'occupe' } : (l.actifs.add(jobId), { etat: 'pris' });
    } else {
      issue = await prendre(rpc, userId, jobId, instance, max);
      if (issue.etat === 'absent') {
        // Migration non appliquée : état de déploiement, pas une panne. Une seule alerte, pas une par tour.
        if (!avertiLocal) {
          avertiLocal = true;
          avertir(`[Autopilote/File] baux globaux absents (${issue.raison}) — limite EN MÉMOIRE de l'instance (${max}) : ce n'est pas une protection globale.`);
        }
        modeLocal = true;
        continue;
      }
    }

    if (issue.etat === 'doublon') throw new RenduDoublonError(jobId);

    if (issue.etat === 'pris') {
      // Preuve de bail : dernier renouvellement RÉUSSI, et verdict définitif « perdu ».
      let dernierOk = maintenant();
      let perdu = false;
      const renouveler = async (): Promise<'ok' | 'perdu' | 'incertain'> => {
        try {
          const r = await rpc('rendu_bail_battre', { p_user: userId, p_job: jobId, p_ttl_s: BAIL_TTL_S });
          const l = r && !r.error ? premiereLigne(r.data) : null;
          if (l && l.ok === true) { dernierOk = maintenant(); return 'ok'; }
          if (l && l.ok === false) return 'perdu';
        } catch { /* incertain */ }
        // Pas de réponse exploitable : perdu seulement si le bail a, de toute façon, dû expirer.
        return maintenant() - dernierOk >= BAIL_TTL_S * 1000 ? 'perdu' : 'incertain';
      };
      let battement: ReturnType<typeof setInterval> | null = null;
      if (!modeLocal) {
        battement = setInterval(() => {
          void renouveler().then((v) => {
            if (v === 'perdu' && !perdu) {
              perdu = true;
              avertir(`[Autopilote/File] bail perdu pour ${jobId} (expiré ou repris) — le dépôt du montage sera refusé.`);
            }
          });
        }, BAIL_BATTEMENT_MS);
        (battement as { unref?: () => void }).unref?.();
      }
      const verifierBail = async (): Promise<void> => {
        if (modeLocal) return;
        if (perdu) throw new RenduBailPerduError(jobId);
        const v = await renouveler();
        if (v === 'perdu') { perdu = true; throw new RenduBailPerduError(jobId); }
        if (v === 'incertain') throw new RenduIndeterminError('bail non confirmé');
      };
      try {
        await o.apresBail?.();
        return await travail({ verifierBail });
      } finally {
        if (battement) clearInterval(battement);
        if (modeLocal) local().actifs.delete(jobId);
        else {
          try { await rpc('rendu_bail_liberer', { p_user: userId, p_job: jobId }); }
          catch { /* le bail expirera seul */ }
        }
      }
    }

    if (issue.etat === 'panne') {
      derniereRaisonPanne = issue.raison;
      if (!avertiPanne) {
        avertiPanne = true;
        avertir(`[Autopilote/File] base de données en panne pour les baux (${issue.raison}) — aucun rendu lancé par défaut, nouvel essai.`);
      }
    }

    // occupé ou base en panne : attendre, dans la limite fixée.
    if (maintenant() >= echeance) {
      throw issue.etat === 'panne' ? new RenduIndeterminError(derniereRaisonPanne) : new RenduOccupeError();
    }
    o.onAttente?.();
    const pas = SONDAGE_MIN_MS + Math.floor(hasard() * (SONDAGE_MAX_MS - SONDAGE_MIN_MS));
    await dormir(Math.min(pas, Math.max(0, echeance - maintenant())));
  }
}

function instanceLocale(): string {
  const g = globalThis as { __studiioInstanceAutopilote?: string };
  if (!g.__studiioInstanceAutopilote) g.__studiioInstanceAutopilote = `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return g.__studiioInstanceAutopilote;
}

// ── Places tenues par une route (travail linéaire avec `finally`) ───────────

/** Un bail tenu : à rendre avec `liberer()` (idempotent). `verifierBail` prouve qu'il est encore le nôtre. */
export interface BailTenu {
  liberer: () => Promise<void>;
  verifierBail: () => Promise<void>;
}

/**
 * Prend un bail et le TIENT (renouvelé en arrière-plan) jusqu'à `liberer()`. Pour les routes dont le
 * travail est une suite d'étapes avec un `finally`, où envelopper dans une fonction serait invasif.
 * Mêmes garanties que `avecLimiteRendus` : mêmes erreurs, avant tout travail.
 */
export function reserverBail(userId: string, jobId: string, o: OptionsLimite = {}): Promise<BailTenu> {
  return new Promise<BailTenu>((resoudre, rejeter) => {
    let fin!: () => void;
    const tenu = new Promise<void>((r) => { fin = r; });
    const termine = avecLimiteRendus(userId, jobId, async (ctx) => {
      resoudre({
        liberer: async () => { fin(); await termine.catch(() => undefined); },
        verifierBail: ctx.verifierBail,
      });
      await tenu;
    }, o);
    termine.catch(rejeter); // sans effet une fois résolue : la libération passe par `liberer()`
  });
}

export type PlaceInteractive =
  | { ok: true; bail: BailTenu }
  | { ok: false; motif: 'occupe' | 'doublon' | 'indetermine'; message: string };

/**
 * Place d'une action INTERACTIVE de Créer : sans attente (l'écran réessaie après `Retry-After`),
 * plafond = Autopilote + réserve. Ne lève jamais : le refus est une valeur que la route traduit en 429/503.
 */
export async function prendrePlaceInteractive(
  userId: string, jobId: string, o: OptionsLimite = {},
): Promise<PlaceInteractive> {
  try {
    const env = o.env ?? process.env;
    const bail = await reserverBail(userId, jobId, { max: rendusMaxInteractifs(env), attenteMaxMs: 0, ...o });
    return { ok: true, bail };
  } catch (e) {
    if (e instanceof RenduDoublonError) return { ok: false, motif: 'doublon', message: e.message };
    if (e instanceof RenduIndeterminError) return { ok: false, motif: 'indetermine', message: e.message };
    if (e instanceof RenduOccupeError) return { ok: false, motif: 'occupe', message: e.message };
    throw e;
  }
}

/** Rend le bail avec la place existante : le `liberer()` d'origine (jeton, place de rendu) libère aussi le bail. */
export function lierBailALaPlace<P extends { liberer: () => void }>(place: P, bail: BailTenu): P {
  const origine = place.liberer.bind(place);
  place.liberer = () => { origine(); void bail.liberer(); };
  return place;
}

/** Délai conseillé (s) à un écran refusé faute de place : de l'ordre d'un rendu court. */
export const RETRY_AFTER_INTERACTIF_S = 30;

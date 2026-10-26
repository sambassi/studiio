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
 * SI LA BASE N'A PAS (ENCORE) LES FONCTIONS
 * ─────────────────────────────────────────────────────────────────────────
 * Migration non appliquée, PostgREST non rechargé ou base injoignable : repli sur
 * un sémaphore EN MÉMOIRE de l'instance, même plafond — journalisé. Ce n'est PAS
 * la protection globale (une seule instance la voit), mais jamais moins sûr que
 * l'existant, et le comportement visible ne change pas. Ni crédits, ni paiement,
 * ni fournisseur ne sont touchés ici.
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
  constructor(readonly jobId: string) {
    super(`Ce montage est déjà en cours de rendu (${jobId}). Rien n’a été lancé en double.`);
    this.name = 'RenduDoublonError';
  }
}

/** Les erreurs de file : jamais imputables au rush ni au montage, jamais un échec à compter. */
export function estErreurDeFile(err: unknown): err is RenduOccupeError | RenduDoublonError {
  return err instanceof RenduOccupeError || err instanceof RenduDoublonError;
}

// ── Accès base ─────────────────────────────────────────────────────────────

interface ReponseRpc { data: unknown; error: { code?: string; message?: string } | null }
export type AppelRpc = (fn: string, params: Record<string, unknown>) => PromiseLike<ReponseRpc>;

const rpcParDefaut: AppelRpc = (fn, params) => (supabaseAdmin as unknown as { rpc: AppelRpc }).rpc(fn, params);

const premiereLigne = (data: unknown): Record<string, unknown> | null => {
  const l = Array.isArray(data) ? data[0] : data;
  return l && typeof l === 'object' ? (l as Record<string, unknown>) : null;
};

type Prise =
  | { etat: 'pris' }
  | { etat: 'occupe' }
  | { etat: 'doublon' }
  | { etat: 'indisponible'; raison: string };

async function prendre(
  rpc: AppelRpc, userId: string, jobId: string, instance: string, max: number,
): Promise<Prise> {
  let r: ReponseRpc;
  try {
    r = await rpc('rendu_bail_prendre', { p_user: userId, p_job: jobId, p_instance: instance, p_max: max, p_ttl_s: BAIL_TTL_S });
  } catch (e) {
    return { etat: 'indisponible', raison: e instanceof Error ? e.message : String(e) };
  }
  if (!r) return { etat: 'indisponible', raison: 'aucune réponse' };
  if (r.error) return { etat: 'indisponible', raison: `${r.error.code ?? ''} ${r.error.message ?? ''}`.trim() };
  const l = premiereLigne(r.data);
  if (!l) return { etat: 'indisponible', raison: 'réponse vide' };
  if (l.pris === true) return { etat: 'pris' };
  if (l.motif === 'doublon') return { etat: 'doublon' };
  if (l.motif === 'occupe') return { etat: 'occupe' };
  return { etat: 'indisponible', raison: `réponse inattendue : ${JSON.stringify(l).slice(0, 120)}` };
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
  /** Injectables pour les tests. */
  maintenant?: () => number;
  dormir?: (ms: number) => Promise<void>;
  hasard?: () => number;
  avertir?: (message: string) => void;
}

const dormirReel = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/**
 * Exécute `travail` quand une place de rendu est libre pour `jobId`, la libère ensuite.
 * Lève `RenduOccupeError` / `RenduDoublonError` AVANT d'avoir appelé `travail`.
 */
export async function avecLimiteRendus<T>(
  userId: string,
  jobId: string,
  travail: () => Promise<T>,
  o: OptionsLimite = {},
): Promise<T> {
  const rpc = o.rpc ?? rpcParDefaut;
  const env = o.env ?? process.env;
  const max = rendusMaxSimultanes(env);
  const attenteMax = attenteMaxMs(env);
  const instance = o.instance ?? instanceLocale();
  const maintenant = o.maintenant ?? Date.now;
  const dormir = o.dormir ?? dormirReel;
  const hasard = o.hasard ?? Math.random;
  const avertir = o.avertir ?? ((m: string) => console.warn(m));

  const echeance = maintenant() + attenteMax;
  let modeLocal = false;
  let avertiLocal = false;

  for (;;) {
    let issue: Prise;
    if (modeLocal) {
      const l = local();
      issue = l.actifs.has(jobId) ? { etat: 'doublon' } : l.actifs.size >= max ? { etat: 'occupe' } : (l.actifs.add(jobId), { etat: 'pris' });
    } else {
      issue = await prendre(rpc, userId, jobId, instance, max);
      if (issue.etat === 'indisponible') {
        // Repli : limite par instance. Une seule alerte, pas une par tour.
        if (!avertiLocal) {
          avertiLocal = true;
          avertir(`[Autopilote/File] baux globaux indisponibles (${issue.raison}) — limite EN MÉMOIRE de l'instance (${max}) : ce n'est pas une protection globale.`);
        }
        modeLocal = true;
        continue;
      }
    }

    if (issue.etat === 'doublon') throw new RenduDoublonError(jobId);

    if (issue.etat === 'pris') {
      let battement: ReturnType<typeof setInterval> | null = null;
      if (!modeLocal) {
        battement = setInterval(() => {
          void Promise.resolve(rpc('rendu_bail_battre', { p_user: userId, p_job: jobId, p_ttl_s: BAIL_TTL_S })).then((r) => {
            const l = premiereLigne(r.data);
            if (!r.error && l && l.ok === false) {
              avertir(`[Autopilote/File] bail perdu pour ${jobId} (expiré ou repris) — le rendu continue sans protection globale.`);
            }
          }, () => { /* panne passagère : le bail tient jusqu'à son expiration */ });
        }, BAIL_BATTEMENT_MS);
        (battement as { unref?: () => void }).unref?.();
      }
      try {
        return await travail();
      } finally {
        if (battement) clearInterval(battement);
        if (modeLocal) local().actifs.delete(jobId);
        else {
          try { await rpc('rendu_bail_liberer', { p_user: userId, p_job: jobId }); }
          catch { /* le bail expirera seul */ }
        }
      }
    }

    // occupé : attendre, dans la limite fixée.
    if (maintenant() >= echeance) throw new RenduOccupeError();
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

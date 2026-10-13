/**
 * Service Alerts — centralised monitoring for all external services.
 *
 * When an API call to Replicate / OpenAI / Anthropic / Unsplash / Pexels / Resend
 * fails because of billing, quota or auth issues the calling route should call
 * `reportServiceAlert()`.  The alert is persisted in `app_settings` under the key
 * `service_alerts` so any admin page can read it.
 *
 * `getServiceAlerts()` returns the current list so the front-end can display a
 * banner.  `dismissServiceAlert()` lets the admin acknowledge an alert.
 */

import { supabaseAdmin } from '@/lib/db/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type ServiceName =
  | 'replicate'
  | 'openai'
  | 'anthropic'
  | 'unsplash'
  | 'pexels'
  | 'resend'
  | 'supabase'
  | 'stripe'
  | 'elevenlabs'
  | 'heygen'
  | 'did'
  | 'groq'
  | 'zernio';

/** `info` : un fait sans action requise (recharge automatique constatée). */
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface ServiceAlert {
  id: string;
  service: ServiceName;
  severity: AlertSeverity;
  message: string;
  details?: string;
  timestamp: string;         // ISO-8601
  dismissed: boolean;
  dismissedAt?: string;
  /**
   * Type d'alerte (ex. `solde_faible`). Avec lui, une alerte est UNIQUE par
   * service + type : chaque passage du cron la met à jour au lieu d'en créer
   * une nouvelle, et elle est RÉSOLUE quand le problème disparaît.
   */
  cle?: string;
  /** Dernière fois que le problème a été constaté. */
  lastSeenAt?: string;
  /** Problème disparu (résolution automatique) — distinct d'un masquage par l'admin. */
  resolvedAt?: string;
  /** Nombre de constats depuis l'ouverture. */
  occurrences?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'service_alerts';

async function readAlerts(): Promise<ServiceAlert[]> {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .single();
    return alertesDepuisValeur(data?.value);
  } catch {
    return [];
  }
}

/**
 * La valeur relue, toujours un TABLEAU d'alertes.
 *
 * ⚠️ EN PRODUCTION, `app_settings.value` REVIENT EN CHAÎNE JSON (même
 * convention que `/api/admin/settings`, qui `JSON.parse` à la lecture). Rendue
 * telle quelle, la chaîne faisait planter `.filter` (GET service-health et
 * Admin › Fournisseurs en 500, constaté le 2026-10-13 dès la première alerte
 * réellement enregistrée) — et `[alerte, ...chaîne]` l'aurait découpée en
 * caractères à l'écriture suivante. Toute entrée qui n'est pas une alerte est
 * écartée.
 */
export function alertesDepuisValeur(valeur: unknown): ServiceAlert[] {
  let v = valeur;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is ServiceAlert => !!a && typeof a === 'object'
    && typeof (a as ServiceAlert).id === 'string' && typeof (a as ServiceAlert).message === 'string');
}

/**
 * ⚠️ `app_settings` N'A NI `id` NI `created_at` (key, value, updated_at). La
 * version précédente lisait `select('id')` — erreur ignorée, donc « absent » —
 * puis tentait un `insert` avec `created_at` : ÉCHEC SILENCIEUX à chaque fois.
 * Aucune alerte de service n'était donc jamais enregistrée. Un `upsert` sur la
 * clé, erreur VÉRIFIÉE.
 */
async function writeAlerts(alerts: ServiceAlert[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value: alerts, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`service_alerts : ${error.message}`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Report a service issue.  Duplicate alerts (same service + severity within
 * the last hour) are silently ignored so we don't flood the DB.
 */
export async function reportServiceAlert(
  service: ServiceName,
  severity: AlertSeverity,
  message: string,
  details?: string,
): Promise<void> {
  try {
    const alerts = await readAlerts();

    // Deduplicate — skip if the same service+severity+message exists in the
    // last hour (deux CRITICAL différents d'un même service restent visibles).
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const duplicate = alerts.find(
      (a) =>
        a.service === service &&
        a.severity === severity &&
        a.message === message &&
        !a.dismissed &&
        new Date(a.timestamp).getTime() > oneHourAgo,
    );
    if (duplicate) return;

    const alert: ServiceAlert = {
      id: `${service}-${Date.now()}`,
      service,
      severity,
      message,
      details,
      timestamp: new Date().toISOString(),
      dismissed: false,
    };

    // Keep last 50 alerts max
    const updated = [alert, ...alerts].slice(0, 50);
    await writeAlerts(updated);
  } catch (err) {
    // Never let alert reporting crash the main flow
    console.error('[ServiceAlerts] Failed to report:', err);
  }
}

/** Ce qu'a fait `signalerAlerteCle` — l'appelant n'envoie un email qu'à l'ouverture. */
export type IssueAlerte = 'creee' | 'reouverte' | 'mise_a_jour' | 'erreur';

/**
 * UNE alerte par service + type (`cle`).
 *
 * ⚠️ LE DOUBLON QU'ELLE FERME (prod 2026-10-13) : `reportServiceAlert` ne
 * dédoublonnait que les alertes NON masquées de moins d'une heure. Le cron
 * providers-health (toutes les 15 min) recréait donc la même alerte dès que
 * l'admin l'avait masquée, puis toutes les heures : 13 alertes en 1 h 30, et
 * aucune ne se fermait quand le problème disparaissait.
 *
 *   - absente → créée ;
 *   - ouverte (même masquée par l'admin) → MISE À JOUR (message, détails,
 *     dernier constat), jamais dupliquée ; un masquage est respecté tant que
 *     le problème dure ;
 *   - résolue (`resolveAlerteCle`) puis constatée de nouveau → RÉOUVERTE.
 *
 * Les anciennes alertes sans type au même message sont closes au passage.
 */
export async function signalerAlerteCle(input: {
  service: ServiceName;
  cle: string;
  severity: AlertSeverity;
  message: string;
  details?: string;
}, now: number = Date.now()): Promise<IssueAlerte> {
  try {
    const alerts = await readAlerts();
    const iso = new Date(now).toISOString();
    const i = alerts.findIndex((a) => a.service === input.service && a.cle === input.cle);
    let issue: IssueAlerte;
    let suivantes: ServiceAlert[];
    if (i < 0) {
      issue = 'creee';
      const alerte: ServiceAlert = {
        id: `${input.service}-${input.cle}-${now}`,
        service: input.service, severity: input.severity, message: input.message, details: input.details,
        timestamp: iso, lastSeenAt: iso, dismissed: false, cle: input.cle, occurrences: 1,
      };
      suivantes = [alerte, ...alerts];
    } else {
      const e = alerts[i];
      const commun = { severity: input.severity, message: input.message, details: input.details, lastSeenAt: iso };
      let maj: ServiceAlert;
      if (e.resolvedAt) {
        issue = 'reouverte';
        maj = { ...e, ...commun, timestamp: iso, dismissed: false, dismissedAt: undefined, resolvedAt: undefined, occurrences: 1 };
      } else {
        issue = 'mise_a_jour';
        maj = { ...e, ...commun, occurrences: (e.occurrences ?? 1) + 1 };
      }
      suivantes = [...alerts];
      suivantes[i] = maj;
    }
    // Les doublons historiques (sans type, même service et même message) sont clos.
    suivantes = suivantes.map((a) => (!a.cle && a.service === input.service && a.message === input.message && !a.dismissed
      ? { ...a, dismissed: true, dismissedAt: iso, resolvedAt: iso } : a));
    await writeAlerts(suivantes.slice(0, 50));
    return issue;
  } catch (err) {
    console.error('[ServiceAlerts] Failed to report:', err);
    return 'erreur';
  }
}

/** Le problème a disparu : l'alerte de ce type est résolue (et quitte le bandeau). `true` si elle l'était pas encore. */
export async function resoudreAlerteCle(service: ServiceName, cle: string, now: number = Date.now()): Promise<boolean> {
  try {
    const alerts = await readAlerts();
    const i = alerts.findIndex((a) => a.service === service && a.cle === cle && !a.resolvedAt);
    if (i < 0) return false;
    const iso = new Date(now).toISOString();
    const suivantes = [...alerts];
    suivantes[i] = { ...alerts[i], resolvedAt: iso, dismissed: true, dismissedAt: alerts[i].dismissedAt ?? iso };
    await writeAlerts(suivantes);
    return true;
  } catch (err) {
    console.error('[ServiceAlerts] Failed to resolve:', err);
    return false;
  }
}

/** Get all active (non-dismissed) alerts. */
export async function getActiveAlerts(): Promise<ServiceAlert[]> {
  const alerts = await readAlerts();
  return alerts.filter((a) => !a.dismissed);
}

/** Get all alerts (including dismissed). */
export async function getAllAlerts(): Promise<ServiceAlert[]> {
  return readAlerts();
}

/** Dismiss a specific alert by id. */
export async function dismissServiceAlert(alertId: string): Promise<void> {
  const alerts = await readAlerts();
  const updated = alerts.map((a) =>
    a.id === alertId ? { ...a, dismissed: true, dismissedAt: new Date().toISOString() } : a,
  );
  await writeAlerts(updated);
}

/** Dismiss all alerts for a given service. */
export async function dismissServiceAlerts(service: ServiceName): Promise<void> {
  const alerts = await readAlerts();
  const updated = alerts.map((a) =>
    a.service === service && !a.dismissed
      ? { ...a, dismissed: true, dismissedAt: new Date().toISOString() }
      : a,
  );
  await writeAlerts(updated);
}

// ── Error detection helper ───────────────────────────────────────────────────

/**
 * Call this from any catch block.  It inspects the error message and
 * automatically reports the right alert if it looks like a billing / quota issue.
 */
export function detectAndReportServiceError(
  service: ServiceName,
  error: unknown,
): void {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Billing / payment required
  if (
    lower.includes('402') ||
    lower.includes('insufficient credit') ||
    lower.includes('payment required') ||
    lower.includes('billing')
  ) {
    reportServiceAlert(
      service,
      'critical',
      `⚠️ ${serviceLabel(service)} — Crédits épuisés !`,
      `L'API ${serviceLabel(service)} a renvoyé une erreur de facturation. Les utilisateurs ne peuvent plus utiliser ce service. Rechargez les crédits immédiatement.`,
    );
    return;
  }

  // Rate limit
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    reportServiceAlert(
      service,
      'warning',
      `⏳ ${serviceLabel(service)} — Limite de requêtes atteinte`,
      `L'API ${serviceLabel(service)} a atteint sa limite de requêtes. Le service reprendra automatiquement dans quelques minutes.`,
    );
    return;
  }

  // Auth / key invalid
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid.*key') ||
    lower.includes('invalid.*token')
  ) {
    reportServiceAlert(
      service,
      'critical',
      `🔑 ${serviceLabel(service)} — Clé API invalide`,
      `L'API ${serviceLabel(service)} a rejeté la clé d'authentification. Vérifiez la variable d'environnement sur Coolify (service studiio-app).`,
    );
    return;
  }

  // Model / version errors (Replicate specific)
  if (
    lower.includes('422') ||
    lower.includes('invalid version') ||
    lower.includes('not permitted')
  ) {
    reportServiceAlert(
      service,
      'warning',
      `🔧 ${serviceLabel(service)} — Modèle indisponible`,
      `Un modèle sur ${serviceLabel(service)} est indisponible ou obsolète. Détails : ${msg}`,
    );
    return;
  }

  // Quota exceeded (Supabase / Resend)
  if (
    lower.includes('quota') ||
    lower.includes('limit exceeded') ||
    lower.includes('plan limit')
  ) {
    reportServiceAlert(
      service,
      'critical',
      `📊 ${serviceLabel(service)} — Quota dépassé`,
      `Le quota de ${serviceLabel(service)} est dépassé. Upgradez le plan ou attendez le prochain cycle de facturation.`,
    );
    return;
  }
}

export function serviceLabel(service: ServiceName): string {
  const labels: Record<ServiceName, string> = {
    replicate: 'Replicate (IA Image)',
    openai: 'OpenAI (Voix off)',
    anthropic: 'Anthropic (IA Texte)',
    unsplash: 'Unsplash (Photos)',
    pexels: 'Pexels (Photos)',
    resend: 'Resend (Emails)',
    supabase: 'Supabase (Base de données)',
    stripe: 'Stripe (Paiements)',
    elevenlabs: 'ElevenLabs (Voix clonée)',
    heygen: 'HeyGen (Avatar vidéo)',
    did: 'D-ID (Avatar legacy)',
    groq: 'Groq (Transcription)',
    zernio: 'Zernio (Publication)',
  };
  return labels[service] || service;
}

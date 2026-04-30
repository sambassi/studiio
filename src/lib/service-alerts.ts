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
  | 'stripe';

export type AlertSeverity = 'warning' | 'critical';

export interface ServiceAlert {
  id: string;
  service: ServiceName;
  severity: AlertSeverity;
  message: string;
  details?: string;
  timestamp: string;         // ISO-8601
  dismissed: boolean;
  dismissedAt?: string;
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
    return (data?.value as ServiceAlert[]) || [];
  } catch {
    return [];
  }
}

async function writeAlerts(alerts: ServiceAlert[]): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('app_settings')
    .select('id')
    .eq('key', SETTINGS_KEY)
    .single();

  if (existing) {
    await supabaseAdmin
      .from('app_settings')
      .update({ value: alerts, updated_at: new Date().toISOString() })
      .eq('key', SETTINGS_KEY);
  } else {
    await supabaseAdmin.from('app_settings').insert({
      key: SETTINGS_KEY,
      value: alerts,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
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

    // Deduplicate — skip if same service+severity exists in the last hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const duplicate = alerts.find(
      (a) =>
        a.service === service &&
        a.severity === severity &&
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
      `L'API ${serviceLabel(service)} a rejeté la clé d'authentification. Vérifiez la variable d'environnement sur Vercel.`,
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

function serviceLabel(service: ServiceName): string {
  const labels: Record<ServiceName, string> = {
    replicate: 'Replicate (IA Image)',
    openai: 'OpenAI (Voix off)',
    anthropic: 'Anthropic (IA Texte)',
    unsplash: 'Unsplash (Photos)',
    pexels: 'Pexels (Photos)',
    resend: 'Resend (Emails)',
    supabase: 'Supabase (Base de données)',
    stripe: 'Stripe (Paiements)',
  };
  return labels[service] || service;
}

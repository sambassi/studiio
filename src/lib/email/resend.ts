import { listUnsubscribeHeaders } from './unsubscribe';

/**
 * Resend Email Client — uses REST API directly (no npm package needed).
 * This avoids build failures when the 'resend' package isn't installed.
 *
 * DELIVRABILITE
 * Trois exigences de Gmail sont traitees ICI, une fois pour toutes, plutot
 * qu'a chaque appelant — un seul oubli suffirait sinon a faire basculer le
 * domaine en spam :
 *   1. `from` provient toujours de `RESEND_FROM`, le seul domaine dont
 *      SPF/DKIM/DMARC sont alignes. Aucun `from` n'est ecrit en dur ailleurs.
 *   2. En-tetes `List-Unsubscribe` / `List-Unsubscribe-Post` ajoutes
 *      automatiquement des lors qu'il y a UN destinataire identifiable.
 *   3. Une version texte accompagne toujours le HTML : un HTML seul est un
 *      signal de spam bien connu.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = process.env.RESEND_FROM || 'Studiio <noreply@studiio.pro>';

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
  /** Version texte. Derivee du HTML si absente. */
  text?: string;
  /** En-tetes additionnels. Ceux fournis ici l'emportent sur l'injection automatique. */
  headers?: Record<string, string>;
}

/**
 * Version texte lisible derivee du HTML.
 *
 * Volontairement simple : il ne s'agit pas de rendre le HTML, mais de fournir
 * un `text/plain` coherent avec le contenu. Les liens sont conserves sous la
 * forme « libelle (url) » pour qu'un client texte reste utilisable.
 */
export function htmlToText(html: string): string {
  return String(html || '')
    // Le contenu de <style>/<script> n'est pas du texte visible.
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = String(label).replace(/<[^>]+>/g, '').trim();
      return text ? `${text} (${href})` : String(href);
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Espaces de mise en forme du template, puis lignes vides en trop.
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Send an email using the Resend REST API directly (no SDK needed).
 */
export async function sendEmail({
  to,
  subject,
  html,
  from = DEFAULT_FROM,
  // Adresse reelle et surveillee : un Reply-To mort degrade la reputation.
  // Non definie par defaut, donc comportement identique tant que la variable
  // n'est pas renseignee.
  replyTo = process.env.RESEND_REPLY_TO?.trim() || undefined,
  text,
  headers,
}: SendEmailParams) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email');
    return { success: false, error: 'RESEND_API_KEY not set', data: null };
  }

  const recipients = Array.isArray(to) ? to : [to];

  // En-tetes de desabonnement : uniquement pour un destinataire unique, le
  // jeton etant lie a l'adresse. Les envois groupes (`to` multiple) sont
  // laisses tels quels — le canal de diffusion, lui, envoie un email par
  // destinataire, justement pour en beneficier.
  const autoHeaders =
    recipients.length === 1 ? listUnsubscribeHeaders(recipients[0]) : {};
  // L'appelant a le dernier mot : ses en-tetes ecrasent l'injection.
  const finalHeaders = { ...autoHeaders, ...(headers || {}) };

  const finalText = text?.trim() || htmlToText(html);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
        ...(finalText && { text: finalText }),
        ...(replyTo && { reply_to: replyTo }),
        ...(Object.keys(finalHeaders).length > 0 && { headers: finalHeaders }),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[Email] Resend API error:', res.status, data);
      return { success: false, error: data.message || `HTTP ${res.status}`, data: null };
    }

    console.log('[Email] Sent successfully:', data.id);
    return { success: true, data, error: null };
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: null,
    };
  }
}

/**
 * Send an email and ignore errors (fire and forget).
 * Used for non-critical notifications.
 */
export async function sendEmailSilent(params: SendEmailParams) {
  try {
    await sendEmail(params);
  } catch (error) {
    console.error('[Email] Silent send failed:', error);
  }
}

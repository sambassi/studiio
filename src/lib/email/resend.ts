/**
 * Resend Email Client — uses REST API directly (no npm package needed).
 * This avoids build failures when the 'resend' package isn't installed.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = process.env.RESEND_FROM || 'Studiio <noreply@studiio.pro>';

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

/**
 * Send an email using the Resend REST API directly (no SDK needed).
 */
export async function sendEmail({
  to,
  subject,
  html,
  from = DEFAULT_FROM,
  replyTo,
}: SendEmailParams) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email');
    return { success: false, error: 'RESEND_API_KEY not set', data: null };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(replyTo && { reply_to: replyTo }),
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

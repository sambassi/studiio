/**
 * Email Notification Helpers
 * Fire-and-forget functions for sending various notifications
 * Errors are logged but never thrown to ensure application stability
 */

import { sendEmailSilent } from './resend';
import {
  paymentConfirmation,
  adminSaleNotification,
  welcomeEmail,
  accountBanned,
  creditsAdded,
} from './templates';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for user lookups
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Get user email from database
 * @param userId - The user ID to look up
 * @returns User email or null if not found
 */
async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user email:', error);
      return null;
    }

    return data?.email || null;
  } catch (error) {
    console.error('Exception fetching user email:', error);
    return null;
  }
}

/**
 * Get admin email from environment
 * @returns Admin email or default
 */
function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL || 'admin@studiio.pro';
}

/**
 * Send admin notification about a sale
 * Fire and forget - errors are logged but not thrown
 * @param saleData - Sale information
 */
export async function notifyAdminSale(saleData: {
  customerName: string;
  customerEmail: string;
  planName: string;
  amount: number;
  timestamp: string;
  currency?: string;
  creditsAmount?: number;
}): Promise<void> {
  try {
    const adminEmail = getAdminEmail();
    const html = adminSaleNotification(saleData);

    await sendEmailSilent({
      to: adminEmail,
      subject: `Nouvelle Vente - ${saleData.planName}`,
      html,
      replyTo: saleData.customerEmail,
    });

    console.log(`Admin sale notification sent to ${adminEmail}`);
  } catch (error) {
    console.error('Failed to send admin sale notification:', error);
    // Intentionally swallow error - don't disrupt transaction flow
  }
}

/**
 * Send payment receipt to customer
 * Fire and forget - errors are logged but not thrown
 * @param userEmail - Customer email address
 * @param paymentData - Payment information
 */
export async function sendPaymentReceipt(
  userEmail: string,
  paymentData: {
    orderId: string;
    amount: number;
    date: string;
    creditsAmount: number;
    planName: string;
    currency?: string;
    customerName?: string;
  }
): Promise<void> {
  try {
    const html = paymentConfirmation(paymentData);

    await sendEmailSilent({
      to: userEmail,
      subject: 'Confirmation de Paiement - Studiio',
      html,
    });

    console.log(`Payment receipt sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send payment receipt:', error);
    // Intentionally swallow error - payment already processed
  }
}

/**
 * Send welcome email to new user
 * Fire and forget - errors are logged but not thrown
 * @param userId - New user ID
 * @param name - User's name
 * @param freeCredits - Amount of free credits granted
 */
export async function sendWelcomeEmail(
  userId: string,
  name: string,
  freeCredits: number = 100
): Promise<void> {
  try {
    const userEmail = await getUserEmail(userId);

    if (!userEmail) {
      console.error(`Could not find email for user ${userId}`);
      return;
    }

    const html = welcomeEmail({ name, freeCredits });

    await sendEmailSilent({
      to: userEmail,
      subject: 'Bienvenue sur Studiio',
      html,
    });

    console.log(`Welcome email sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    // Intentionally swallow error - user account already created
  }
}

/**
 * Notify user that their account has been banned
 * Fire and forget - errors are logged but not thrown
 * @param userId - User ID
 * @param reason - Reason for ban
 * @param appealEmail - Email for appeals (optional)
 */
export async function notifyBan(
  userId: string,
  reason: string,
  appealEmail?: string
): Promise<void> {
  try {
    const userEmail = await getUserEmail(userId);

    if (!userEmail) {
      console.error(`Could not find email for user ${userId}`);
      return;
    }

    // Get user name for personalization
    const { data, error: nameError } = await supabase
      .from('users')
      .select('name')
      .eq('id', userId)
      .single();

    const userName = data?.name || 'Utilisateur';

    const html = accountBanned({
      name: userName,
      reason,
      appealEmail,
    });

    await sendEmailSilent({
      to: userEmail,
      subject: 'Compte Suspendu - Studiio',
      html,
    });

    console.log(`Ban notification sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send ban notification:', error);
    // Intentionally swallow error - action already taken
  }
}

/**
 * Notify user that credits have been added to their account
 * Fire and forget - errors are logged but not thrown
 * @param userId - User ID
 * @param amount - Amount of credits added
 * @param reason - Reason for credit addition
 */
export async function notifyCreditsAdded(
  userId: string,
  amount: number,
  reason: string
): Promise<void> {
  try {
    const userEmail = await getUserEmail(userId);

    if (!userEmail) {
      console.error(`Could not find email for user ${userId}`);
      return;
    }

    // Get user name and current balance
    const { data, error: userError } = await supabase
      .from('users')
      .select('name, credits')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('Error fetching user data:', userError);
      return;
    }

    const userName = data?.name || 'Utilisateur';
    const newBalance = (data?.credits || 0) + amount;

    const html = creditsAdded({
      name: userName,
      amount,
      newBalance,
      reason,
    });

    await sendEmailSilent({
      to: userEmail,
      subject: 'Crédits Ajoutés - Studiio',
      html,
    });

    console.log(`Credits notification sent to ${userEmail}`);
  } catch (error) {
    console.error('Failed to send credits notification:', error);
    // Intentionally swallow error - credits already added
  }
}

/**
 * Send welcome email using user email directly
 * Useful for registration flows where email is known
 * Fire and forget - errors are logged but not thrown
 * @param email - User email
 * @param name - User name
 * @param freeCredits - Amount of free credits
 */
export async function sendWelcomeEmailDirect(
  email: string,
  name: string,
  freeCredits: number = 100
): Promise<void> {
  try {
    const html = welcomeEmail({ name, freeCredits });

    await sendEmailSilent({
      to: email,
      subject: 'Bienvenue sur Studiio',
      html,
    });

    console.log(`Welcome email sent directly to ${email}`);
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    // Intentionally swallow error
  }
}

/**
 * Send payment receipt using email directly
 * Useful for payment webhook handlers where email is known
 * Fire and forget - errors are logged but not thrown
 * @param email - Customer email
 * @param paymentData - Payment information
 */
export async function sendPaymentReceiptDirect(
  email: string,
  paymentData: {
    orderId: string;
    amount: number;
    date: string;
    creditsAmount: number;
    planName: string;
    currency?: string;
    customerName?: string;
  }
): Promise<void> {
  try {
    const html = paymentConfirmation(paymentData);

    await sendEmailSilent({
      to: email,
      subject: 'Confirmation de Paiement - Studiio',
      html,
    });

    console.log(`Payment receipt sent directly to ${email}`);
  } catch (error) {
    console.error('Failed to send payment receipt:', error);
    // Intentionally swallow error - payment already processed
  }
}

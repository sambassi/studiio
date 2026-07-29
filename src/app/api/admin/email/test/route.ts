import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { ApiResponse } from '@/lib/types/api';
import { sendEmail } from '@/lib/email/resend';
import { isSuppressed, unsubscribeFooter } from '@/lib/email/unsubscribe';

/**
 * Sends a test email to verify email configuration
 * POST /api/admin/email/test
 * Body: { to: string, subject: string, body: string }
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const body = await req.json();
    const { to, subject, emailBody } = body;

    // Validate input
    if (!to || !subject || !emailBody) {
      return NextResponse.json(
        { success: false, error: 'to, subject, and emailBody are required' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return NextResponse.json(
        { success: false, error: 'Invalid email address' },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'Email service not configured' },
        { status: 503 }
      );
    }

    // Cette route sert AUSSI aux campagnes en masse (src/app/admin/emails).
    // Elle appelait l'API Resend en direct avec
    // `from: process.env.EMAIL_FROM || 'noreply@studiio.app'` — un domaine
    // sans SPF/DKIM/DMARC alignes, et meme absent de .env.example : tous les
    // envois partaient donc d'un expediteur non authentifie, ce qui suffit a
    // faire classer le message en spam. On passe par le client partage, seul
    // detenteur de `RESEND_FROM`, qui ajoute au passage la version texte et
    // les en-tetes de desabonnement.

    // Etant un envoi en nombre (la page admin boucle dessus destinataire par
    // destinataire), il DOIT respecter les desabonnements. Sans ce filtre, un
    // destinataire qui s'est desabonne via l'en-tete un-clic recevrait quand
    // meme la campagne suivante — l'exact contraire de ce que l'en-tete
    // promet. On repond 200 : la boucle cliente compte les non-200 comme des
    // echecs, or ce n'en est pas un.
    if (await isSuppressed(to)) {
      return NextResponse.json({
        success: true,
        data: { to, subject, skipped: true },
        message: 'Destinataire désabonné — email non envoyé',
      });
    }

    try {
      const result = await sendEmail({
        to,
        subject,
        // Pied de page ajoute cote SERVEUR : le corps est saisi librement par
        // l'admin, et un lien de desabonnement visible ne doit pas dependre
        // de son bon vouloir — Gmail exige qu'il accompagne l'en-tete.
        html: `${emailBody}${unsubscribeFooter(to)}`,
        unsubscribable: true,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      const messageId = (result.data as { id?: string } | null)?.id;

      // Log the action
      await logAdminAction({
        adminEmail: session!.user.email!,
        action: 'send_test_email',
        targetType: 'email',
        details: { to, subject, messageId },
      });

      return NextResponse.json({
        success: true,
        data: { messageId, to, subject },
        message: 'Test email sent successfully',
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Still log even if email failed
      await logAdminAction({
        adminEmail: session!.user.email!,
        action: 'send_test_email_failed',
        targetType: 'email',
        details: { to, subject, error: String(emailError) },
      });

      throw emailError;
    }
  } catch (error) {
    console.error('Error in test email endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to send test email';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}

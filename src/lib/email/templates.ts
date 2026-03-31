/**
 * Email Templates for Studiio
 * All templates use inline CSS for maximum email client compatibility
 * Stylized with Studiio's dark purple and pink branding
 */

// Color palette
const colors = {
  primary: '#7C3AED', // Deep purple
  accent: '#EC4899', // Pink
  dark: '#1F2937', // Dark gray
  light: '#F9FAFB', // Light gray
  border: '#E5E7EB', // Border gray
  success: '#10B981', // Green
};

// Shared email styles
const baseStyles = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  color: #374151;
`;

const containerStyles = `
  max-width: 600px;
  margin: 0 auto;
  background-color: #FFFFFF;
`;

const headerStyles = `
  background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.accent} 100%);
  color: white;
  padding: 40px 20px;
  text-align: center;
`;

const footerStyles = `
  background-color: ${colors.light};
  border-top: 1px solid ${colors.border};
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: #6B7280;
`;

interface PaymentConfirmationData {
  orderId: string;
  amount: number;
  date: string;
  creditsAmount: number;
  planName: string;
  currency?: string;
  customerName?: string;
}

/**
 * Payment Confirmation Email Template
 * Sent to customer after successful payment
 */
export function paymentConfirmation(data: PaymentConfirmationData): string {
  const {
    orderId,
    amount,
    date,
    creditsAmount,
    planName,
    currency = 'USD',
    customerName = 'Utilisateur',
  } = data;

  const formattedAmount = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(amount);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; ${baseStyles}">
      <div style="${containerStyles}">
        <!-- Header -->
        <div style="${headerStyles}">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">
            Confirmation de Paiement
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            Merci pour votre achat
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <!-- Greeting -->
          <p style="margin-top: 0; margin-bottom: 30px;">
            Bonjour <strong>${customerName}</strong>,
          </p>

          <p style="margin-bottom: 30px;">
            Nous vous remercions pour votre confiance ! Votre commande a été traitée avec succès.
          </p>

          <!-- Receipt Box -->
          <div style="
            background-color: ${colors.light};
            border-left: 4px solid ${colors.primary};
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
          ">
            <h2 style="
              margin: 0 0 20px 0;
              color: ${colors.primary};
              font-size: 18px;
              font-weight: 600;
            ">
              Reçu de Commande
            </h2>

            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Numéro de Commande:</td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  font-weight: 600;
                  color: ${colors.primary};
                ">
                  ${orderId}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Plan:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${planName}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Crédits Achetés:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${creditsAmount.toLocaleString('fr-FR')} crédits
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Date:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${new Date(date).toLocaleDateString('fr-FR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </td>
              </tr>
              <tr style="background-color: white;">
                <td style="
                  padding: 16px 0;
                  font-size: 16px;
                  font-weight: 600;
                  color: ${colors.primary};
                ">
                  Montant Total:
                </td>
                <td style="
                  padding: 16px 0;
                  text-align: right;
                  font-size: 18px;
                  font-weight: 700;
                  color: ${colors.accent};
                ">
                  ${formattedAmount}
                </td>
              </tr>
            </table>
          </div>

          <!-- Info message -->
          <div style="
            background-color: #F0FDF4;
            border-left: 4px solid ${colors.success};
            padding: 15px;
            margin-bottom: 30px;
            border-radius: 4px;
          ">
            <p style="margin: 0; color: ${colors.success}; font-weight: 500;">
              ✓ Vos crédits ont été ajoutés à votre compte et sont maintenant disponibles.
            </p>
          </div>

          <!-- Next steps -->
          <div style="margin-bottom: 30px;">
            <h3 style="
              margin: 0 0 15px 0;
              color: ${colors.dark};
              font-size: 16px;
              font-weight: 600;
            ">
              Prochaines Étapes
            </h3>
            <ol style="margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 10px;">
                Connectez-vous à votre compte Studiio
              </li>
              <li style="margin-bottom: 10px;">
                Accédez à votre tableau de bord pour utiliser vos crédits
              </li>
              <li>
                Créez vos vidéos et contenus professionnels
              </li>
            </ol>
          </div>

          <!-- Support message -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            margin-bottom: 20px;
          ">
            Une question ? Notre équipe support est disponible pour vous aider.
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> - Créateurs de Contenu Professionnel
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            © 2024 Studiio. Tous droits réservés.
          </p>
          <p style="margin: 10px 0 0 0;">
            <a href="https://studiio.pro" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              visitez notre site
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface AdminSaleNotificationData {
  customerName: string;
  customerEmail: string;
  planName: string;
  amount: number;
  timestamp: string;
  currency?: string;
  creditsAmount?: number;
}

/**
 * Admin Sale Notification Template
 * Sent to admin when a sale occurs
 */
export function adminSaleNotification(data: AdminSaleNotificationData): string {
  const {
    customerName,
    customerEmail,
    planName,
    amount,
    timestamp,
    currency = 'USD',
    creditsAmount = 0,
  } = data;

  const formattedAmount = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(amount);

  const formattedTime = new Date(timestamp).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; ${baseStyles}">
      <div style="${containerStyles}">
        <!-- Header -->
        <div style="${headerStyles}">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">
            Nouvelle Vente
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            Une commande a été effectuée avec succès
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <p style="margin-top: 0; margin-bottom: 30px;">
            Une nouvelle vente a été enregistrée sur Studiio.
          </p>

          <!-- Sale Details Box -->
          <div style="
            background-color: ${colors.light};
            border-left: 4px solid ${colors.accent};
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
          ">
            <h2 style="
              margin: 0 0 20px 0;
              color: ${colors.accent};
              font-size: 18px;
              font-weight: 600;
            ">
              Détails de la Vente
            </h2>

            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Client:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${customerName}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Email:</td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  font-weight: 500;
                  word-break: break-all;
                ">
                  <a href="mailto:${customerEmail}" style="
                    color: ${colors.primary};
                    text-decoration: none;
                  ">
                    ${customerEmail}
                  </a>
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Plan:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${planName}
                </td>
              </tr>
              ${
                creditsAmount > 0
                  ? `
                <tr style="border-bottom: 1px solid ${colors.border};">
                  <td style="padding: 12px 0; color: #6B7280;">Crédits:</td>
                  <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                    ${creditsAmount.toLocaleString('fr-FR')}
                  </td>
                </tr>
              `
                  : ''
              }
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">Montant:</td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  font-size: 16px;
                  font-weight: 700;
                  color: ${colors.accent};
                ">
                  ${formattedAmount}
                </td>
              </tr>
              <tr>
                <td style="padding: 12px 0; color: #6B7280;">Heure:</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${formattedTime}
                </td>
              </tr>
            </table>
          </div>

          <!-- Action Button -->
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="https://studiio.pro/admin/sales" style="
              background-color: ${colors.primary};
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              display: inline-block;
            ">
              Voir les Ventes
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0;">
            Ceci est une notification automatique de l'administration Studiio
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface WelcomeEmailData {
  name: string;
  freeCredits?: number;
}

/**
 * Welcome Email Template
 * Sent to new users after registration
 */
export function welcomeEmail(data: WelcomeEmailData): string {
  const { name, freeCredits = 100 } = data;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; ${baseStyles}">
      <div style="${containerStyles}">
        <!-- Header -->
        <div style="${headerStyles}">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">
            Bienvenue sur Studiio
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            Commencez à créer du contenu professionnel
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <!-- Greeting -->
          <p style="margin-top: 0; margin-bottom: 30px; font-size: 16px;">
            Salut <strong>${name}</strong> ! 👋
          </p>

          <p style="margin-bottom: 20px;">
            Nous sommes ravis de vous accueillir dans la communauté Studiio.
            Vous avez accès à des outils puissants pour créer des vidéos et du contenu
            professionnel en quelques minutes.
          </p>

          <!-- Free Credits Box -->
          <div style="
            background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.accent} 100%);
            color: white;
            padding: 30px 20px;
            margin-bottom: 30px;
            border-radius: 8px;
            text-align: center;
          ">
            <p style="
              margin: 0 0 10px 0;
              font-size: 14px;
              opacity: 0.9;
            ">
              Crédits gratuits offerts
            </p>
            <h2 style="
              margin: 0;
              font-size: 42px;
              font-weight: 700;
            ">
              ${freeCredits.toLocaleString('fr-FR')}
            </h2>
            <p style="
              margin: 10px 0 0 0;
              font-size: 14px;
            ">
              crédits à utiliser immédiatement
            </p>
          </div>

          <!-- Getting Started -->
          <div style="margin-bottom: 30px;">
            <h3 style="
              margin: 0 0 20px 0;
              color: ${colors.primary};
              font-size: 18px;
              font-weight: 600;
            ">
              Pour Commencer
            </h3>

            <div style="
              background-color: ${colors.light};
              padding: 20px;
              border-radius: 6px;
              margin-bottom: 15px;
            ">
              <h4 style="
                margin: 0 0 10px 0;
                color: ${colors.dark};
                font-weight: 600;
              ">
                1. Complétez votre profil
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                Ajoutez une photo et des informations pour personnaliser votre expérience.
              </p>
            </div>

            <div style="
              background-color: ${colors.light};
              padding: 20px;
              border-radius: 6px;
              margin-bottom: 15px;
            ">
              <h4 style="
                margin: 0 0 10px 0;
                color: ${colors.dark};
                font-weight: 600;
              ">
                2. Explorez les modèles
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                Découvrez notre bibliothèque de modèles vidéo professionnels.
              </p>
            </div>

            <div style="
              background-color: ${colors.light};
              padding: 20px;
              border-radius: 6px;
            ">
              <h4 style="
                margin: 0 0 10px 0;
                color: ${colors.dark};
                font-weight: 600;
              ">
                3. Créez votre première vidéo
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                Utilisez l'éditeur intuitif pour créer du contenu en quelques minutes.
              </p>
            </div>
          </div>

          <!-- Features -->
          <div style="margin-bottom: 30px;">
            <h3 style="
              margin: 0 0 20px 0;
              color: ${colors.primary};
              font-size: 18px;
              font-weight: 600;
            ">
              Ce Que Vous Pouvez Faire
            </h3>
            <ul style="
              margin: 0;
              padding-left: 20px;
              color: #374151;
            ">
              <li style="margin-bottom: 10px;">
                Créer des vidéos professionnelles avec des modèles prédéfinis
              </li>
              <li style="margin-bottom: 10px;">
                Générer automatiquement des sous-titres en plusieurs langues
              </li>
              <li style="margin-bottom: 10px;">
                Ajouter de la musique et des effets sonores
              </li>
              <li style="margin-bottom: 10px;">
                Exporter en haute définition
              </li>
              <li>
                Collaborer avec votre équipe
              </li>
            </ul>
          </div>

          <!-- CTA Button -->
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="https://studiio.pro/dashboard" style="
              background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.accent} 100%);
              color: white;
              padding: 14px 40px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              display: inline-block;
              font-size: 16px;
            ">
              Accédez à votre tableau de bord
            </a>
          </div>

          <!-- Support message -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            text-align: center;
          ">
            Besoin d'aide ? Consultez notre
            <a href="https://studiio.pro/help" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              centre d'aide
            </a>
             ou
            <a href="https://studiio.pro/contact" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              contactez-nous
            </a>
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> - Créateurs de Contenu Professionnel
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            © 2024 Studiio. Tous droits réservés.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface AccountBannedData {
  name: string;
  reason: string;
  appealEmail?: string;
}

/**
 * Account Banned Notification Template
 * Sent to users when their account is banned
 */
export function accountBanned(data: AccountBannedData): string {
  const {
    name,
    reason,
    appealEmail = 'appeals@studiio.pro',
  } = data;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; ${baseStyles}">
      <div style="${containerStyles}">
        <!-- Header -->
        <div style="
          background: linear-gradient(135deg, #DC2626 0%, #991B1B 100%);
          color: white;
          padding: 40px 20px;
          text-align: center;
        ">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">
            Compte Suspendu
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            Action requise
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <p style="margin-top: 0; margin-bottom: 20px;">
            Bonjour <strong>${name}</strong>,
          </p>

          <p style="margin-bottom: 20px;">
            Nous regrettons de vous informer que votre compte Studiio a été suspendu
            en raison d'une violation de nos conditions d'utilisation.
          </p>

          <!-- Reason Box -->
          <div style="
            background-color: #FEE2E2;
            border-left: 4px solid #DC2626;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 4px;
          ">
            <h3 style="
              margin: 0 0 10px 0;
              color: #991B1B;
              font-weight: 600;
            ">
              Raison de la Suspension
            </h3>
            <p style="margin: 0; color: #7F1D1D;">
              ${reason}
            </p>
          </div>

          <!-- Appeal Process -->
          <div style="margin-bottom: 30px;">
            <h3 style="
              margin: 0 0 20px 0;
              color: ${colors.primary};
              font-size: 18px;
              font-weight: 600;
            ">
              Contester la Décision
            </h3>
            <p style="margin-bottom: 15px;">
              Si vous pensez que cette décision est une erreur, vous pouvez faire appel
              en envoyant un email à notre équipe d'appels avec les informations suivantes:
            </p>
            <ul style="
              margin: 0;
              padding-left: 20px;
              color: #374151;
            ">
              <li style="margin-bottom: 10px;">
                Votre nom d'utilisateur ou ID de compte
              </li>
              <li style="margin-bottom: 10px;">
                Une explication détaillée de pourquoi vous pensez que cette suspension est incorrecte
              </li>
              <li>
                Toute preuve pertinente soutenant votre appel
              </li>
            </ul>
          </div>

          <!-- Appeal Contact -->
          <div style="
            background-color: ${colors.light};
            padding: 20px;
            border-radius: 6px;
            margin-bottom: 30px;
            text-align: center;
          ">
            <p style="margin: 0 0 15px 0;">
              <strong>Envoyer un appel à:</strong>
            </p>
            <a href="mailto:${appealEmail}" style="
              background-color: ${colors.primary};
              color: white;
              padding: 12px 30px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              display: inline-block;
            ">
              ${appealEmail}
            </a>
            <p style="margin: 15px 0 0 0; font-size: 14px; color: #6B7280;">
              Délai de réponse estimé: 3-5 jours ouvrables
            </p>
          </div>

          <!-- Information -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            margin-bottom: 20px;
          ">
            Veuillez consulter nos
            <a href="https://studiio.pro/terms" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              conditions d'utilisation
            </a>
             pour comprendre les règles que nous appliquons à tous nos utilisateurs.
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0;">
            L'équipe Studiio
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface CreditsAddedData {
  name: string;
  amount: number;
  newBalance: number;
  reason: string;
}

/**
 * Credits Added Notification Template
 * Sent when admin adds credits to user account
 */
export function creditsAdded(data: CreditsAddedData): string {
  const { name, amount, newBalance, reason } = data;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; ${baseStyles}">
      <div style="${containerStyles}">
        <!-- Header -->
        <div style="
          background: linear-gradient(135deg, ${colors.success} 0%, #059669 100%);
          color: white;
          padding: 40px 20px;
          text-align: center;
        ">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">
            Crédits Ajoutés
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            Une bonne nouvelle
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <p style="margin-top: 0; margin-bottom: 30px;">
            Bonjour <strong>${name}</strong>,
          </p>

          <p style="margin-bottom: 30px;">
            Des crédits ont été ajoutés à votre compte Studiio !
          </p>

          <!-- Credits Box -->
          <div style="
            background-color: #F0FDF4;
            border-left: 4px solid ${colors.success};
            padding: 30px 20px;
            margin-bottom: 30px;
            border-radius: 6px;
            text-align: center;
          ">
            <h2 style="
              margin: 0 0 15px 0;
              font-size: 42px;
              font-weight: 700;
              color: ${colors.success};
            ">
              +${amount.toLocaleString('fr-FR')}
            </h2>
            <p style="
              margin: 0 0 20px 0;
              color: #6B7280;
              font-size: 14px;
            ">
              crédits ajoutés à votre compte
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="background-color: white;">
                <td style="
                  padding: 12px 0;
                  color: #6B7280;
                  border-bottom: 1px solid #DCFCE7;
                ">
                  Solde Antérieur:
                </td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  color: #374151;
                  font-weight: 500;
                  border-bottom: 1px solid #DCFCE7;
                ">
                  ${(newBalance - amount).toLocaleString('fr-FR')}
                </td>
              </tr>
              <tr>
                <td style="
                  padding: 12px 0;
                  color: #6B7280;
                ">
                  <strong>Nouveau Solde:</strong>
                </td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  color: ${colors.success};
                  font-weight: 700;
                  font-size: 18px;
                ">
                  ${newBalance.toLocaleString('fr-FR')}
                </td>
              </tr>
            </table>
          </div>

          <!-- Reason -->
          <div style="margin-bottom: 30px;">
            <h3 style="
              margin: 0 0 15px 0;
              color: ${colors.primary};
              font-weight: 600;
            ">
              Raison
            </h3>
            <p style="
              margin: 0;
              color: #374151;
              padding: 15px;
              background-color: ${colors.light};
              border-radius: 4px;
              border-left: 4px solid ${colors.primary};
            ">
              ${reason}
            </p>
          </div>

          <!-- Call to Action -->
          <div style="text-align: center; margin-bottom: 30px;">
            <a href="https://studiio.pro/dashboard" style="
              background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.accent} 100%);
              color: white;
              padding: 14px 40px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: 600;
              display: inline-block;
            ">
              Commencez à Créer
            </a>
          </div>

          <!-- Info -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            text-align: center;
          ">
            Vos crédits sont maintenant disponibles sur votre compte.
            Connectez-vous pour les utiliser.
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> - Créateurs de Contenu Professionnel
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            © 2024 Studiio. Tous droits réservés.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

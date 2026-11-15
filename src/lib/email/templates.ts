/**
 * Email Templates for Studiio
 * All templates use inline CSS for maximum email client compatibility
 * Stylized with Studiio's dark purple and pink branding
 */

import { traducteur, intlDe } from '@/lib/i18n/serveur';

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
  /** Langue du destinataire (code `locale`) ; absente = français. */
  locale?: string;
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
  const m = traducteur(data.locale, 'email.paymentConfirmation');
  const loc = intlDe(data.locale);
  const {
    orderId,
    amount,
    date,
    creditsAmount,
    planName,
    currency = 'USD',
    customerName = 'Utilisateur',
  } = data;

  const formattedAmount = new Intl.NumberFormat(loc, {
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
            ${m('confirmation_de_paiement')}
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${m('merci_pour_votre_achat')}
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <!-- Greeting -->
          <p style="margin-top: 0; margin-bottom: 30px;">
            ${m('bonjour')} <strong>${customerName}</strong>,
          </p>

          <p style="margin-bottom: 30px;">
            ${m('nous_vous_remercions_pour_votre_co')}
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
              ${m('recu_de_commande')}
            </h2>

            <table style="width: 100%; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">${m('numero_de_commande')}</td>
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
                <td style="padding: 12px 0; color: #6B7280;">${m('plan')}</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${planName}
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">${m('credits_achetes')}</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${creditsAmount.toLocaleString(loc)} crédits
                </td>
              </tr>
              <tr style="border-bottom: 1px solid ${colors.border};">
                <td style="padding: 12px 0; color: #6B7280;">${m('date')}</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 500;">
                  ${new Date(date).toLocaleDateString(loc, {
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
                  ${m('montant_total')}
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
              ${m('vos_credits_ont_ete_ajoutes_a_votr')}
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
              ${m('prochaines_etapes')}
            </h3>
            <ol style="margin: 0; padding-left: 20px;">
              <li style="margin-bottom: 10px;">
                ${m('connectez_vous_a_votre_compte_stud')}
              </li>
              <li style="margin-bottom: 10px;">
                ${m('accedez_a_votre_tableau_de_bord_po')}
              </li>
              <li>
                ${m('creez_vos_videos_et_contenus_profe')}
              </li>
            </ol>
          </div>

          <!-- Support message -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            margin-bottom: 20px;
          ">
            ${m('une_question_notre_equipe_support')}
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> ${m('createurs_de_contenu_professionnel')}
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            ${m('2024_studiio_tous_droits_reserves')}
          </p>
          <p style="margin: 10px 0 0 0;">
            <a href="https://studiio.pro" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              ${m('visitez_notre_site')}
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
  /** Langue du destinataire (code `locale`) ; absente = français. */
  locale?: string;
  name: string;
  freeCredits?: number;
}

/**
 * Welcome Email Template
 * Sent to new users after registration
 */
export function welcomeEmail(data: WelcomeEmailData): string {
  const m = traducteur(data.locale, 'email.welcomeEmail');
  const loc = intlDe(data.locale);
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
            ${m('bienvenue_sur_studiio')}
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${m('commencez_a_creer_du_contenu_profe')}
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <!-- Greeting -->
          <p style="margin-top: 0; margin-bottom: 30px; font-size: 16px;">
            ${m('salut')} <strong>${name}</strong> ! 👋
          </p>

          <p style="margin-bottom: 20px;">
            ${m('nous_sommes_ravis_de_vous_accueill')}
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
              ${m('credits_gratuits_offerts')}
            </p>
            <h2 style="
              margin: 0;
              font-size: 42px;
              font-weight: 700;
            ">
              ${freeCredits.toLocaleString(loc)}
            </h2>
            <p style="
              margin: 10px 0 0 0;
              font-size: 14px;
            ">
              ${m('credits_a_utiliser_immediatement')}
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
              ${m('pour_commencer')}
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
                ${m('1_completez_votre_profil')}
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                ${m('ajoutez_une_photo_et_des_informati')}
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
                ${m('2_explorez_les_modeles')}
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                ${m('decouvrez_notre_bibliotheque_de_mo')}
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
                ${m('3_creez_votre_premiere_video')}
              </h4>
              <p style="margin: 0; color: #6B7280; font-size: 14px;">
                ${m('utilisez_l_editeur_intuitif_pour_c')}
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
              ${m('ce_que_vous_pouvez_faire')}
            </h3>
            <ul style="
              margin: 0;
              padding-left: 20px;
              color: #374151;
            ">
              <li style="margin-bottom: 10px;">
                ${m('creer_des_videos_professionnelles')}
              </li>
              <li style="margin-bottom: 10px;">
                ${m('generer_automatiquement_des_sous_t')}
              </li>
              <li style="margin-bottom: 10px;">
                ${m('ajouter_de_la_musique_et_des_effet')}
              </li>
              <li style="margin-bottom: 10px;">
                ${m('exporter_en_haute_definition')}
              </li>
              <li>
                ${m('collaborer_avec_votre_equipe')}
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
              ${m('accedez_a_votre_tableau_de_bord')}
            </a>
          </div>

          <!-- Support message -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            text-align: center;
          ">
            ${m('besoin_d_aide_consultez_notre')}
            <a href="https://studiio.pro/help" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              ${m('centre_d_aide')}
            </a>
             ou
            <a href="https://studiio.pro/contact" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              ${m('contactez_nous')}
            </a>
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> ${m('createurs_de_contenu_professionnel')}
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            ${m('2024_studiio_tous_droits_reserves')}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface AccountBannedData {
  /** Langue du destinataire (code `locale`) ; absente = français. */
  locale?: string;
  name: string;
  reason: string;
  appealEmail?: string;
}

/**
 * Account Banned Notification Template
 * Sent to users when their account is banned
 */
export function accountBanned(data: AccountBannedData): string {
  const m = traducteur(data.locale, 'email.accountBanned');
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
            ${m('compte_suspendu')}
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${m('action_requise')}
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <p style="margin-top: 0; margin-bottom: 20px;">
            ${m('bonjour')} <strong>${name}</strong>,
          </p>

          <p style="margin-bottom: 20px;">
            ${m('nous_regrettons_de_vous_informer_q')}
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
              ${m('raison_de_la_suspension')}
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
              ${m('contester_la_decision')}
            </h3>
            <p style="margin-bottom: 15px;">
              ${m('si_vous_pensez_que_cette_decision')}
            </p>
            <ul style="
              margin: 0;
              padding-left: 20px;
              color: #374151;
            ">
              <li style="margin-bottom: 10px;">
                ${m('votre_nom_d_utilisateur_ou_id_de_c')}
              </li>
              <li style="margin-bottom: 10px;">
                ${m('une_explication_detaillee_de_pourq')}
              </li>
              <li>
                ${m('toute_preuve_pertinente_soutenant')}
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
              <strong>${m('envoyer_un_appel_a')}</strong>
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
              ${m('delai_de_reponse_estime_3_5_jours')}
            </p>
          </div>

          <!-- Information -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            margin-bottom: 20px;
          ">
            ${m('veuillez_consulter_nos')}
            <a href="https://studiio.pro/terms" style="
              color: ${colors.primary};
              text-decoration: none;
            ">
              ${m('conditions_d_utilisation')}
            </a>
             ${m('pour_comprendre_les_regles_que_nou')}
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0;">
            ${m('l_equipe_studiio')}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

interface CreditsAddedData {
  /** Langue du destinataire (code `locale`) ; absente = français. */
  locale?: string;
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
  const m = traducteur(data.locale, 'email.creditsAdded');
  const loc = intlDe(data.locale);
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
            ${m('credits_ajoutes')}
          </h1>
          <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">
            ${m('une_bonne_nouvelle')}
          </p>
        </div>

        <!-- Content -->
        <div style="padding: 40px 20px;">
          <p style="margin-top: 0; margin-bottom: 30px;">
            ${m('bonjour')} <strong>${name}</strong>,
          </p>

          <p style="margin-bottom: 30px;">
            ${m('des_credits_ont_ete_ajoutes_a_votr')}
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
              +${amount.toLocaleString(loc)}
            </h2>
            <p style="
              margin: 0 0 20px 0;
              color: #6B7280;
              font-size: 14px;
            ">
              ${m('credits_ajoutes_a_votre_compte')}
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="background-color: white;">
                <td style="
                  padding: 12px 0;
                  color: #6B7280;
                  border-bottom: 1px solid #DCFCE7;
                ">
                  ${m('solde_anterieur')}
                </td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  color: #374151;
                  font-weight: 500;
                  border-bottom: 1px solid #DCFCE7;
                ">
                  ${(newBalance - amount).toLocaleString(loc)}
                </td>
              </tr>
              <tr>
                <td style="
                  padding: 12px 0;
                  color: #6B7280;
                ">
                  <strong>${m('nouveau_solde')}</strong>
                </td>
                <td style="
                  padding: 12px 0;
                  text-align: right;
                  color: ${colors.success};
                  font-weight: 700;
                  font-size: 18px;
                ">
                  ${newBalance.toLocaleString(loc)}
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
              ${m('raison')}
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
              ${m('commencez_a_creer')}
            </a>
          </div>

          <!-- Info -->
          <p style="
            color: #6B7280;
            font-size: 14px;
            text-align: center;
          ">
            ${m('vos_credits_sont_maintenant_dispon')}
          </p>
        </div>

        <!-- Footer -->
        <div style="${footerStyles}">
          <p style="margin: 0 0 10px 0;">
            <strong>Studiio</strong> ${m('createurs_de_contenu_professionnel')}
          </p>
          <p style="margin: 0; color: #9CA3AF;">
            ${m('2024_studiio_tous_droits_reserves')}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

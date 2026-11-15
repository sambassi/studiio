'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Languages, LayoutDashboard, Users, CreditCard, Zap, Film, Settings, FileText, Mail, Shield, ArrowLeft, Globe, Coins, Server, Clapperboard } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { ETAT_INTERACTIF_SANS_FOND } from '@/lib/ui/etats';

/**
 * Libellé d'une entrée du menu admin — MISE EN PAGE SEULEMENT, aucun texte n'est raccourci.
 *
 * Cette barre était la SEULE navigation de l'application à composer ses intitulés à la taille
 * de base (16 px) alors que la barre du tableau de bord emploie `text-sm` (14 px) ; dans une
 * colonne de 256 px, ces 2 px faisaient toute la différence. « Cinema IA — formules » et
 * « Conditions Générales » repassaient à la ligne DÈS LE FRANÇAIS, « Kumbukumbu ya ukaguzi »,
 * « Gharama za avatar » et « Rudi kwenye tovuti » en kiswahili, « Retounen sou sit la » en
 * créole, « Terms & Conditions » en anglais — avec l'interligne large du 16 px, les deux
 * lignes se détachaient l'une de l'autre et l'icône flottait entre les deux.
 *
 * L'intitulé reprend donc le gabarit de la barre du tableau de bord (14 px, `leading-tight`),
 * les entrées passent de `px-4 py-3` à `px-3 py-2.5` et l'icône de 20 à 18 px : la place utile
 * passe de 143 à 162 px pendant que le texte rétrécit de 12 %. Voir le commentaire jumeau dans
 * `Sidebar.tsx` pour le détail de `min-w-0` / `break-words` / `text-balance`.
 */
const CLASSE_LIBELLE = 'min-w-0 font-medium text-sm leading-tight text-balance break-words';

/**
 * `ouvert` : sur mobile (< md) la barre est masquée et s'ouvre en
 * superposition depuis le bouton menu du layout admin. À partir de md elle
 * est toujours visible, à l'identique d'avant.
 */
export function AdminSidebar({ ouvert = false, onNaviguer }: { ouvert?: boolean; onNaviguer?: () => void } = {}) {
  const tUi = useTranslations('ui.componentsLayoutAdminSidebar');
  const pathname = usePathname();
  const t = useTranslations('adminSidebar');

  const menuItems = [
    { icon: LayoutDashboard, label: t('dashboard'), href: '/admin' },
    { icon: Users, label: t('users'), href: '/admin/users' },
    { icon: CreditCard, label: t('subscriptions'), href: '/admin/subscriptions' },
    { icon: Zap, label: t('payments'), href: '/admin/payments' },
    { icon: Film, label: t('videos'), href: '/admin/videos' },
    { icon: Globe, label: t('landingPage'), href: '/admin/landing' },
    { icon: Settings, label: t('settings'), href: '/admin/settings' },
    { icon: CreditCard, label: 'Tarification', href: '/admin/pricing' },
    { icon: Coins, label: tUi('tarifs_credits'), href: '/admin/tarifs' },
    { icon: Clapperboard, label: 'Cinema IA — formules', href: '/admin/cinema-formules' },
    { icon: Film, label: tUi('couts_avatar'), href: '/admin/avatar-couts' },
    { icon: Server, label: 'Fournisseurs', href: '/admin/fournisseurs' },
    { icon: Languages, label: 'Traductions', href: '/admin/traductions' },
    { icon: FileText, label: t('terms'), href: '/admin/terms' },
    { icon: Mail, label: t('emails'), href: '/admin/emails' },
    { icon: Shield, label: t('auditLog'), href: '/admin/logs' },
  ];

  return (
    /* `px-5` et non `p-6` : la barre garde sa largeur (`w-64`, dont dépend le `md:ml-64` du
       gabarit admin) et rend 8 px au contenu. Voir CLASSE_LIBELLE ci-dessus. */
    <aside className={`fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-orange-900/50 px-5 py-6 z-50 flex-col ${ouvert ? 'flex' : 'hidden'} md:flex`}>
      <Link href="/admin" className="text-2xl font-bold text-orange-500 mb-8 block">
        Studiio Admin
      </Link>

      <nav className="space-y-2 flex-1 overflow-y-auto">
        {menuItems.map(({ icon: Icon, label, href }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              onClick={onNaviguer}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${ETAT_INTERACTIF_SANS_FOND} ${
                isActive
                  ? 'bg-orange-500/10 text-orange-500 border border-orange-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span className={CLASSE_LIBELLE}>{label}</span>
            </Link>
          );
        })}
      </nav>

      <Link
        href="/dashboard"
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 border-t border-gray-800 pt-4 mt-4 ${ETAT_INTERACTIF_SANS_FOND}`}
      >
        <ArrowLeft size={18} className="shrink-0" />
        <span className={CLASSE_LIBELLE}>{t('backToSite')}</span>
      </Link>
    </aside>
  );
}

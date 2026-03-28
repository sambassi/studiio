'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, CreditCard, Zap, Film, Settings } from 'lucide-react';

const menuItems = [
  { icon: LayoutDashboard, label: 'Tableau de bord', href: '/admin' },
  { icon: Users, label: 'Utilisateurs', href: '/admin/users' },
  { icon: CreditCard, label: 'Abonnements', href: '/admin/subscriptions' },
  { icon: Zap, label: 'Paiements', href: '/admin/payments' },
  { icon: Film, label: 'Vidéos', href: '/admin/videos' },
  { icon: Settings, label: 'Paramètres', href: '/admin/settings' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-orange-900/50 p-6 z-50">
      <Link href="/admin" className="text-2xl font-bold text-orange-500 mb-8 block">
        Studiio Admin
      </Link>
      
      <nav className="space-y-2">
        {menuItems.map(({ icon: Icon, label, href }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                isActive
                  ? 'bg-orange-500/10 text-orange-500 border border-orange-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

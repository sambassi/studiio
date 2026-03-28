'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Zap, Library, Target, Share2, CreditCard } from 'lucide-react';

const menuItems = [
  { icon: LayoutDashboard, label: 'Tableau de bord', href: '/dashboard' },
  { icon: Zap, label: 'Créer', href: '/dashboard/creator' },
  { icon: Library, label: 'Bibliothèque', href: '/dashboard/library' },
  { icon: Target, label: 'Objectifs', href: '/dashboard/objectives' },
  { icon: Share2, label: 'Réseaux sociaux', href: '/dashboard/social' },
  { icon: CreditCard, label: 'Facturation', href: '/dashboard/billing' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 p-6 z-50">
      <Link href="/" className="text-2xl font-bold text-gradient mb-8 block">
        Studiio
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
                  ? 'bg-studiio-primary/10 text-studiio-primary border border-studiio-primary/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-80'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="absolute bottom-6 left-6 right-6 card-base p-4">
        <div className="text-xs text-gray-500 mb-2">Crédits disponibles</div>
        <div className="text-2xl font-bold text-studiio-accent mb-4">1,250</div>
        <Link href="/dashboard/billing" className="w-full button-primary text-center text-sm">
          Acheter
        </Link>
      </div>
    </aside>
  +}

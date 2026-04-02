'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, Zap, Library, Target, Share2, CreditCard, Image, Calendar, Shield, Volume2 } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';

const menuKeys = [
  { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard' },
  { icon: Zap, key: 'create', href: '/dashboard/creator' },
  { icon: Image, key: 'infographic', href: '/dashboard/infographic' },
  { icon: Volume2, key: 'audioStudio', href: '/dashboard/audio-studio' },
  { icon: Calendar, key: 'calendar', href: '/dashboard/calendar' },
  { icon: Library, key: 'library', href: '/dashboard/library' },
  { icon: Target, key: 'objectives', href: '/dashboard/objectives' },
  { icon: Share2, key: 'social', href: '/dashboard/social' },
  { icon: CreditCard, key: 'billing', href: '/dashboard/billing' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [credits, setCredits] = useState<number | null>(null);
  const isAdmin = session?.user?.email === 'contact.artboost@gmail.com';
  const t = useTranslations('sidebar');

  useEffect(() => {
    async function fetchCredits() {
      try {
        const res = await fetch('/api/credits/balance');
        const data = await res.json();
        if (data.success) {
          setCredits(data.data?.credits || 0);
        }
      } catch {
        // Silently fail - will show placeholder
      }
    }
    fetchCredits();
  }, []);

  return (
    <aside className="fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 p-6 z-50 flex flex-col">
      <Link href="/" className="text-2xl font-bold text-gradient mb-8 block">
        Studiio
      </Link>

      <nav className="space-y-2 flex-1">
        {menuKeys.map(({ icon: Icon, key, href }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                isActive
                  ? 'bg-studiio-primary/10 text-studiio-primary border border-studiio-primary/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              <Icon size={20} />
              <span className="font-medium">{t(key)}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
              pathname.startsWith('/admin')
                ? 'bg-studiio-primary/10 text-orange-500 border border-orange-500/30'
                : 'text-orange-600 hover:text-orange-400 hover:bg-gray-800'
            }`}
          >
            <Shield size={20} />
            <span className="font-medium">{t('admin')}</span>
          </Link>
        )}
      </nav>

      <div className="space-y-4">
        <LanguageSelector variant="sidebar" />
        <div className="card-base p-4">
          <div className="text-xs text-gray-500 mb-2">{t('creditsAvailable')}</div>
          <div className="text-2xl font-bold text-studiio-accent mb-4">
            {credits !== null ? credits.toLocaleString() : '...'}
          </div>
          <Link href="/dashboard/billing" className="w-full button-primary text-center text-sm block">
            {t('buy')}
          </Link>
        </div>
      </div>
    </aside>
  );
}

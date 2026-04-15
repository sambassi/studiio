'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Bell, User, LogOut, Shield, Zap } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';

const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'];

export function Navbar() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email?.toLowerCase() || '');
  const t = useTranslations('navbar');
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setCredits(d.balance ?? 0); })
      .catch(() => {});
  }, [session?.user?.id]);

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <nav className="fixed top-0 right-0 left-0 lg:left-64 h-16 bg-gray-900 border-b border-gray-800 z-40 lg:z-40">
      <div className="h-full px-6 flex justify-between items-center">
        <div className="text-gray-400 hidden lg:block">{t('dashboard')}</div>
        <div className="flex items-center gap-4 lg:ml-0 ml-12">
          <LanguageSelector variant="navbar" />
          {credits !== null && (
            <button
              onClick={() => router.push('/dashboard/billing')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-600/20 border border-purple-500/40 text-purple-200 hover:bg-purple-600/30 transition text-sm font-semibold"
              title="Crédits restants"
            >
              <Zap size={14} className="text-purple-300" />
              {credits}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="text-yellow-400 hover:text-yellow-300 transition"
              title={t('admin')}
            >
              <Shield size={20} />
            </button>
          )}
          <button className="text-gray-400 hover:text-white transition relative">
            <Bell size={20} />
            <span className="absolute top-0 right-0 w-2 h-2 bg-studiio-accent rounded-full"></span>
          </button>
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="text-gray-400 hover:text-white transition"
            title={t('profile')}
          >
            <User size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-red-400 transition"
            title={t('logout')}
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
}

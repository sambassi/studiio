'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, Zap, Library, Target, Share2, CreditCard, Image, Calendar, Shield, Volume2, Menu, X } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';

const menuKeys = [
  { icon: LayoutDashboard, key: 'dashboard', href: '/dashboard', color: '#7C3AED' },
  { icon: Zap, key: 'create', href: '/dashboard/creator', color: '#F59E0B' },
  { icon: Image, key: 'infographic', href: '/dashboard/infographic', color: '#EC4899' },
  { icon: Volume2, key: 'audioStudio', href: '/dashboard/audio-studio', color: '#10B981' },
  { icon: Calendar, key: 'calendar', href: '/dashboard/calendar', color: '#3B82F6' },
  { icon: Library, key: 'library', href: '/dashboard/library', color: '#8B5CF6' },
  { icon: Target, key: 'objectives', href: '/dashboard/objectives', color: '#F97316' },
  { icon: Share2, key: 'social', href: '/dashboard/social', color: '#06B6D4' },
  { icon: CreditCard, key: 'billing', href: '/dashboard/billing', color: '#EF4444' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [credits, setCredits] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
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

  // Close sidebar when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const handleNavClick = () => {
    setIsOpen(false);
  };

  const SidebarContent = () => (
    <>
      <Link href="/" className="text-2xl font-bold text-gradient mb-8 block">
        Studiio
      </Link>

      <nav className="space-y-1.5 flex-1">
        {menuKeys.map(({ icon: Icon, key, href, color }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={handleNavClick}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}20`, color }}
              >
                <Icon size={18} />
              </div>
              <span className={`font-medium text-sm ${isActive ? 'text-white' : ''}`}>{t(key)}</span>
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            onClick={handleNavClick}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${
              pathname.startsWith('/admin')
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#F59E0B20', color: '#F59E0B' }}>
              <Shield size={18} />
            </div>
            <span className="font-medium text-sm">{t('admin')}</span>
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
    </>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 p-6 z-50 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-0 left-0 z-50 p-4 text-gray-400 hover:text-white transition mt-4"
        title="Menu"
      >
        <Menu size={24} />
      </button>

      {/* Mobile Sidebar Backdrop */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`lg:hidden fixed left-0 top-0 w-64 h-screen bg-gray-900 border-r border-gray-800 p-6 z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close Button */}
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-6 right-6 text-gray-400 hover:text-white transition"
          title="Close"
        >
          <X size={24} />
        </button>

        <div className="mt-8">
          <SidebarContent />
        </div>
      </aside>
    </>
  );
}

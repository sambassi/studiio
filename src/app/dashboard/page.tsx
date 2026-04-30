'use client';

import { useSession } from 'next-auth/react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { CreditsDisplay } from '@/components/billing/CreditsDisplay';
import { RecentVideos } from '@/components/dashboard/RecentVideos';
import { Video, Film, Zap, Eye, Sparkles, Calendar, Music, Library, Share2, Settings, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { useTranslations } from '@/i18n/client';

export default function DashboardPage() {
  const { data: session } = useSession();
  const userName = session?.user?.name?.split(' ')[0] || 'utilisateur';
  const t = useTranslations('dashboardHome');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('welcome', { name: userName })} 👋</h1>
        <p className="text-gray-400">{t('subtitle')}</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatsCard
          icon={Video}
          label={t('stats.videosCreated')}
          value={24}
          change={t('stats.videosThisWeek', { count: '5' })}
          changePositive={true}
        />
        <StatsCard
          icon={Zap}
          label={t('stats.creditsRemaining')}
          value={1250}
          change={t('stats.creditsBoughtThisWeek', { count: '500' })}
          changePositive={true}
        />
        <StatsCard
          icon={Film}
          label={t('stats.publications')}
          value={12}
          change={t('stats.pubsThisWeek', { count: '2' })}
          changePositive={true}
        />
        <StatsCard
          icon={Eye}
          label={t('stats.totalViews')}
          value="48.2K"
          change={t('stats.viewsIncrease', { percent: '12' })}
          changePositive={true}
        />
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white">{t('directAccess.title')}</h2>
          <p className="text-sm text-gray-400">{t('directAccess.subtitle')}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { href: '/dashboard/creer', icon: Sparkles, color: '#F59E0B', label: t('directAccess.create'), desc: t('directAccess.createDesc') },
            { href: '/dashboard/calendar', icon: Calendar, color: '#3B82F6', label: t('directAccess.calendar'), desc: t('directAccess.calendarDesc') },
            // Studio Son route removed — audio editing is now integrated into /creer's audio panel
            { href: '/dashboard/library', icon: Library, color: '#8B5CF6', label: t('directAccess.library'), desc: t('directAccess.libraryDesc') },
            { href: '/dashboard/social', icon: Share2, color: '#06B6D4', label: t('directAccess.social'), desc: t('directAccess.socialDesc') },
            { href: '/dashboard/settings', icon: Settings, color: '#6B7280', label: t('directAccess.settings'), desc: t('directAccess.settingsDesc') },
          ].map(({ href, icon: Icon, color, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="group card-base p-4 hover:bg-white/5 transition-colors flex flex-col gap-3 min-h-[120px]"
            >
              <div className="flex items-center justify-between">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${color}20` }}
                >
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <ArrowRight className="w-4 h-4 text-gray-500 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <div className="font-semibold text-white text-sm">{label}</div>
                <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <RecentVideos />
        </div>
        <div className="space-y-6">
          <CreditsDisplay credits={1250} isPro={true} />
          <div className="card-base p-6 space-y-4">
            <h3 className="font-bold text-white">{t('quickActions')}</h3>
            <Link href="/dashboard/creer" className="block">
              <Button variant="primary" size="lg" className="w-full">
                {t('createVideo')}
              </Button>
            </Link>
            <Link href="/dashboard/social" className="block">
              <Button variant="secondary" size="lg" className="w-full">
                {t('connectSocial')}
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Retention policy note */}
      <div className="flex items-center gap-2 rounded-lg bg-gray-800/50 border border-gray-700/50 px-4 py-2.5 mt-2">
        <span className="text-gray-500 text-xs">ℹ️</span>
        <p className="text-[11px] text-gray-500">
          Rétention médias : vidéos 24h · audio/images 7j · préservés si post programmé
        </p>
      </div>
    </div>
  );
}

'use client';

import { useSession } from 'next-auth/react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { CreditsDisplay } from '@/components/billing/CreditsDisplay';
import { RecentVideos } from '@/components/dashboard/RecentVideos';
import { Video, Film, Zap, Eye } from 'lucide-react';
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

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <RecentVideos />
        </div>
        <div className="space-y-6">
          <CreditsDisplay credits={1250} isPro={true} />
          <div className="card-base p-6 space-y-4">
            <h3 className="font-bold text-white">{t('quickActions')}</h3>
            <Link href="/dashboard/creator" className="block">
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
    </div>
  );
}

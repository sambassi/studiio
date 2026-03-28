'use client';

import { StatsCard } from '@/components/dashboard/StatsCard';
import { CreditsDisplay } from 'A/components/billing/CreditsDisplay';
import { RecentVideos } from '@/components/dashboard/RecentVideos';
import { Video, Film, Zap, Eye } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Bienvenue, Jean 👋</h1>
        <p className="text-gray-400">Vous avez un nouveau message de support</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatsCard
          icon={Video}
          label="Vidéos créées"
          value={24}
          change="5 cette semaine"
          changePositive={true}
        />
        <StatsCard
          icon={Zap}
          label="Crédits restants"
          value={1250}
          change="500 achetés cette semaine"
          changePositive={true}
        />
        <StatsCard
          icon={Film}
          label="Publications"
          value={12}
          change="2 cette semaine"
          changePositive={true}
        />
        <StatsCard
          icon={Eye}
          label="Vues totales"
          value="48.2K"
          change="12% d'augmentation"
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
            <h3 className="font-bold text-white">Actions rapides</h3>
            <Link href="/dashboard/creator" className="block">
              <Button variant="primary" size="lg" className="w-full">
                Créer s��une vidéo
              </Button>
            </Link>
            <Link href="/dashboard/social" className="block">
              <Button variant="secondary" size="lg" className="w-full">
                Connecter réseaux sociaux
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

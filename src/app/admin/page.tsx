'use client';

import { StatsCard } from '@/components/dashboard/StatsCard';
import { RevenueChart } from '@/components/admin/RevenueChart';
import { ActivityFeed } from '@/components/admin/ActivityFeed';
import { Users, TrendingUp, ShoppingCart, Film } from 'lucide-react';

export default function AdminDashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Tableau de bord admin</h1>
        <p className="text-gray-400">Vue d'ensemble de la plateforme Studiio</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatsCard
          icon={Users}
          label="Total utilisateurs"
          value={1248}
          change="125 cette semaine"
          changePositive={true}
        />
        <StatsCard
          icon={TrendingUp}
          label="Revenus du mois"
          value="€18,450"
          change="22% augmentation"
          changePositive={true}
        />
        <StatsCard
          icon={ShoppingCart}
          label="Abonnements actifs"
          value={342}
          change="12 nouveaux"
          changePositive={true}
        />
        <StatsCard
          icon={Film}
          label="Vidéos rendues"
          value={4127}
          change="340 cette semaine"
          changePositive={true}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <RevenueChart />
        <ActivityFeed />
      </div>
    </div>
  +}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, TrendingUp, ShoppingCart, Film, Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';

interface StatsData {
  totalUsers: number;
  monthlyRevenue: number;
  activeSubscriptions: number;
  videosRendered: number;
}

interface Activity {
  id: string;
  admin: string;
  action: string;
  target: string;
  timestamp: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        const [statsRes, logsRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/logs?limit=10'),
        ]);

        if (statsRes.status === 401 || statsRes.status === 403) {
          router.push('/dashboard');
          return;
        }

        if (!statsRes.ok) throw new Error('Erreur lors du chargement des statistiques');

        const statsData = await statsRes.json();
        setStats(statsData);

        if (logsRes.ok) {
          const logsData = await logsRes.json();
          setActivities(logsData.logs || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-400">Chargement du tableau de bord...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Tableau de bord admin</h1>
        <p className="text-gray-400">Vue d'ensemble de la plateforme Studiio</p>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {stats && (
        <>
          <div className="grid md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Total utilisateurs</p>
                  <p className="text-3xl font-bold text-white">{stats.totalUsers.toLocaleString('fr-FR')}</p>
                </div>
                <Users className="w-12 h-12 text-orange-500 opacity-20" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Revenus du mois</p>
                  <p className="text-3xl font-bold text-white">€{(stats.monthlyRevenue / 100).toLocaleString('fr-FR')}</p>
                </div>
                <TrendingUp className="w-12 h-12 text-orange-500 opacity-20" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Abonnements actifs</p>
                  <p className="text-3xl font-bold text-white">{stats.activeSubscriptions.toLocaleString('fr-FR')}</p>
                </div>
                <ShoppingCart className="w-12 h-12 text-orange-500 opacity-20" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm mb-2">Vidéos rendues</p>
                  <p className="text-3xl font-bold text-white">{stats.videosRendered.toLocaleString('fr-FR')}</p>
                </div>
                <Film className="w-12 h-12 text-orange-500 opacity-20" />
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Activités récentes</CardTitle>
              </CardHeader>
              <CardContent>
                {activities.length > 0 ? (
                  <div className="space-y-4">
                    {activities.map((activity) => (
                      <div key={activity.id} className="flex items-start justify-between pb-4 border-b border-gray-800 last:border-0">
                        <div className="flex-1">
                          <p className="text-white font-medium">{activity.action}</p>
                          <p className="text-sm text-gray-400">{activity.admin}</p>
                          <p className="text-xs text-gray-500 mt-1">{activity.target}</p>
                        </div>
                        <p className="text-xs text-gray-500 ml-4 whitespace-nowrap">
                          {new Date(activity.timestamp).toLocaleDateString('fr-FR', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">Aucune activité récente</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actions rapides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="primary" className="w-full">
                  Créditer un utilisateur
                </Button>
                <Button variant="secondary" className="w-full">
                  Voir les paiements
                </Button>
                <Button variant="secondary" className="w-full">
                  Gérer les CGV
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

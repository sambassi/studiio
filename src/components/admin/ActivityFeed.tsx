'use client';

import { Card, CardHeader, CardTitle, CardContent } from 'A/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const activities = [
  { id: 1, type: 'subscription', user: 'Jean Dupont', action: 'a souscrit au plan Pro', time: 'il y a 2h', icon: '📱' },
  { id: 2, type: 'video', user: 'Marie Martin', action: 'a créé une vidéo (50 crédits)', time: 'il y a 4h', icon: '🎬' },
  { id: 3, type: 'payment', user: 'Pierre Bernard', action: 'a acheté 500 crédits', time: 'il y a 5h', icon: '💳' },
  { id: 4, type: 'signup', user: 'Jeanne Dupuis', action: 's\'est inscrit', time: 'il y a 1j', icon: '✨' },
  { id: 5, type: 'subscription', user: 'Luc Boulanger', action: 'a résilié son abonnement', time: 'il y a 1j', icon: '👋' },
];

export function ActivityFeed() {
  return (
    <Card>
      <CardHeader className="border-b border-gray-800">
        <CardTitle>Activité récente</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex items-start gap-4 pb-4 border-b border-gray-800 last:border-0">
              <div className="text-2xl">{activity.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-300">
                  <span className="font-semibold text-white">{activity.user}</span> {activity.action}
                </p>
                <p className="text-xs text-gray-500 mt-1">{activity.time}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

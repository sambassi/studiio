'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Play } from 'lucide-react';

const videos = [
  {
    id: 1,
    title: 'Reel Instagram - Tendance',
    format: 'Reel 9:16',
    status: 'completed',
    date: '2024-03-25',
    views: 1240,
  },
  {
    id: 2,
    title: 'TikTok Challenge',
    format: 'Reel 9:16',
    status: 'rendering',
    date: '2024-03-24',
    views: 0,
  },
  {
    id: 3,
    title: 'Tutorial YouTube',
    format: 'TV 16:9',
    status: 'draft',
    date: '2024-03-24',
    views: 0,
  },
];

export function RecentVideos() {
  return (
    <Card>
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle>Vidéos récentes</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-4">
          {videos.map((video) => (
            <div key={video.id} className="flex justify-between items-center p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-700 rounded-lg flex items-center justify-center">
                  <Play size={20} className="text-studiio-accent" />
                </div>
                <div>
                  <p className="font-semibold text-white text-sm">{video.title}</p>
                  <p className="text-xs text-gray-400">{video.format}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={video.status === 'completed' ? 'success' : video.status === 'rendering' ? 'warning' : 'default'}>
                  {video.status === 'completed' ? 'Terminée' : video.status === 'rendering' ? 'Rendu' : 'Brouillon'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        <Link href="/dashboard/library" className="block text-center mt-4 text-studiio-primary hover:text-purple-400 font-semibold text-sm">
          Voir toutes les vidéos →
        </Link>
      </CardContent>
    </Card>
  );
}

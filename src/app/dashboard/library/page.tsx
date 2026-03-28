'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Play, Trash2, Download } from 'lucide-react';

const mockVideos = [
  { id: '1', title: 'Reel Instagram - Tendance', thumbnail: '🎬', format: 'Reel 9:16', status: 'completed', date: '2024-03-25', views: 1240 },
  { id: '2', title: 'TikTok Challenge', thumbnail: '🎬', format: 'Reel 9:16', status: 'rendering', date: '2024-03-24', views: 0 },
  { id: '3', title: 'Tutorial YouTube', thumbnail: '🎬', format: 'TV 16:9', status: 'draft', date: '2024-03-24', views: 0 },
  { id: '4', title: 'Promo produit', thumbnail: '🎬', format: 'Reel 9:16', status: 'completed', date: '2024-03-23', views: 562 },
  { id: '5', title: 'Behind the scenes', thumbnail: '🎬', format: 'TV 16:9', status: 'completed', date: '2024-03-22', views: 890 },
  { id: '6', title: 'Astuce du jour', thumbnail: '🎬', format: 'Reel 9:16', status: 'draft', date: '2024-03-21', views: 0 },
];

export default function LibraryPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const filtered = mockVideos.filter(
    (video) =>
      video.title.toLowerCase().includes(search.toLowerCase()) &&
      (!filterStatus || video.status === filterStatus)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Bibliothèque</h1>
        <p className="text-gray-400">Gérez toutes vos vidéos créées</p>
      </div>

      <div className="flex gap-4 items-end">
        <Input
          placeholder="Rechercher une vidéo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select
          options={[
            { value: 'completed', label: 'Terminée' },
            { value: 'rendering', label: 'Rendu' },
            { value: 'draft', label: 'Brouillon' },
          ]}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((video) => (
          <div key={video.id} className="card-base overflow-hidden hover:border-studiio-primary transition">
            <div className={`w-full bg-gray-800 flex items-center justify-center text-4xl ${
              video.format === 'Reel 9:16' ? 'aspect-[9/16]' : 'aspect-video'
            }`}>
              <Play className="text-studiio-accent" size={48} />
            </div>
            <div className="p-4 space-y-3">
              <div>
                <p className="font-semibold text-white text-sm">{video.title}</p>
                <p className="text-xs text-gray-400">{video.format}</p>
              </div>
              <div className="flex justify-between items-center">
                <Badge variant={video.status === 'completed' ? 'success' : video.status === 'rendering' ? 'warning' : 'default'}>
                  {video.status === 'completed' ? 'Terminée' : video.status === 'rendering' ? 'Rendu' : 'Brouillon'}
                </Badge>
                <span className="text-xs text-gray-400">{video.views} vues</span>
              </div>
              <div className="flex gap-2 pt-2 border-t border-gray-800">
                <Button size="sm" variant="secondary" className="flex-1">
                  <Download size={16} />
                </Button>
                <Button size="sm" variant="secondary" className="flex-1">
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const mockVideos = [
  { id: '1', title: 'Reel Instagram - Tendance', user: 'Jean Dupont', format: 'Reel 9:16', status: 'completed', credits: 10, date: '2024-03-25' },
  { id: '2', title: 'TikTok Challenge', user: 'Marie Martin', format: 'Reel 9:16', status: 'rendering', credits: 10, date: '2024-03-24' },
  { id: '3', title: 'Tutorial YouTube', user: 'Pierre Bernard', format: 'TV 16:9', status: 'completed', credits: 15, date: '2024-03-24' },
  { id: '4', title: 'Promo produit', user: 'Sophie Lefevre', format: 'Reel 9:16', status: 'completed', credits: 10, date: '2024-03-23' },
  { id: '5', title: 'Behind the scenes', user: 'Luc Boulanger', format: 'TV 16:9', status: 'completed', credits: 15, date: '2024-03-22' },
];

export default function VideosPage() {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFormat, setFilterFormat] = useState('');

  const filtered = mockVideos.filter(
    (video) =>
      (video.title.toLowerCase().includes(search.toLowerCase()) ||
        video.user.toLowerCase().includes(search.toLowerCase())) &&
      (!filterStatus || video.status === filterStatus) &&
      (!filterFormat || video.format === filterFormat)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Gestion des vidéos</h1>
        <p className="text-gray-400">Toutes les vidéos créées sur la plateforme</p>
      </div>

      <div className="flex gap-4 items-end flex-wrap">
        <Input
          placeholder="Rechercher par titre ou utilisateur..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-64"
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
        <Select
          options={[
            { value: 'Reel 9:16', label: 'Reel 9:16' },
            { value: 'TV 16:9', label: 'TV 16:9' },
          ]}
          value={filterFormat}
          onChange={(e) => setFilterFormat(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Titre</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Utilisateur</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Format</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Statut</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Crédits</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((video) => (
                  <tr key={video.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition">
                    <td className="py-3 px-4 text-white font-medium">{video.title}</td>
                    <td className="py-3 px-4 text-gray-300">{video.user}</td>
                    <td className="py-3 px-4 text-gray-300">{video.format}</td>
                    <td className="py-3 px-4">
                      <Badge variant={video.status === 'completed' ? 'success' : video.status === 'rendering' ? 'warning' : 'default'}>
                        {video.status === 'completed' ? 'Terminée' : video.status === 'rendering' ? 'Rendu' : 'Brouillon'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-white">{video.credits}</td>
                    <td className="py-3 px-4 text-gray-300">{video.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

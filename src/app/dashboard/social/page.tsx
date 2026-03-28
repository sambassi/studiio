'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from 'A/components/ui/Badge';
import { Instagram, Music, Facebook, Youtube, Check, Plus } from 'lucide-react';

const socialNetworks = [
  { id: 'instagram', name: 'Instagram', icon: Instagram, connected: true, account: 'studiio_video' },
  { id: 'tiktok', name: 'TikTok', icon: Music, connected: true, account: 'studiio.official' },
  { id: 'facebook', name: 'Facebook', icon: Facebook, connected: false, account: null },
  { id: 'youtube', name: 'YouTube', icon: Youtube, connected: false, account: null },
];

export default function SocialPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Réseaux sociaux</h1>
        <p className="text-gray-400">Connectez vos comptes pour publier automatiquement</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {socialNetworks.map((network) => {
          const Icon = network.icon;
          return (
            <Card key={network.id} className={network.connected ? 'border-studiio-primary/30' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Icon size={32} className={network.connected ? 'text-studiio-accent' : 'text-gray-600'} />
                    <div>
                      <h3 className="font-semibold text-white">{network.name}</h3>
                      {network.connected && (
                        <p className="text-sm text-gray-400">@{network.account}</p>
                      )}
                    </div>
                  </div>
                  {network.connected && (
                    <Badge variant="success">
                      <Check size={14} className="mr-1" />
                      Connecté
                    </Badge>
                  )}
                </div>
                <Button
                  variant={network.connected ? 'secondary' : 'primary'}
                  className="w-full"
                >
                  {network.connected ? 'Reconnecter' : 'Connecter'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          <h3 className="font-semibold text-white mb-4">Publication automatique</h3>
          <div className="space-y-4">
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4" defaultChecked />
              <div>
                <p className="font-medium text-white text-sm">Publier sur les réseaux connectés</p>
                <p className="text-xs text-gray-400">Publiez automatiquement vos vidéos sur tous vos comptes</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4" />
              <div>
                <p className="font-medium text-white text-sm">Programmer la publication</p>
                <p className="text-xs text-gray-400">Choisissez l'heure de publication optimale</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4" defaultChecked />
              <div>
                <p className="font-medium text-white text-sm">Tracker les performances</p>
                <p className="text-xs text-gray-400">Recevez des rapports détaillés sur vos vidéos</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

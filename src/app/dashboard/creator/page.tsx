'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

export default function CreatorPage() {
  const [format, setFormat] = useState('reel');
  const [objective, setObjective] = useState('');
  const [title, setTitle] = useState('');
  const [script, setScript] = useState('');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Créer une vidéo</h1>
        <p className="text-gray-400">Utilisez notre IA pour créer des vidéos virales en quelques minutes</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="border-b border-gray-800">
              <CardTitle>Paramètres de la vidéo</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Format</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setFormat('reel')}
                    className={`p-4 rounded-lg border-2 transition ${
                      format === 'reel'
                        ? 'border-studiio-primary bg-studiio-primary/10'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <p className="font-semibold text-white">Reel 9:16</p>
                    <p className="text-xs text-gray-400">Instagram, TikTok</p>
                  </button>
                  <button
                    onClick={() => setFormat('tv')}
                    className={`p-4 rounded-lg border-2 transition ${
                      format === 'tv'
                        ? 'border-studiio-primary bg-studiio-primary/10'
                        : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <p className="font-semibold text-white">TV 16:9</p>
                    <p className="text-xs text-gray-400">YouTube, Facebook</p>
                  </button>
                </div>
              </div>

              <Select
                label="Objectif"
                options={[
                  { value: 'awareness', label: 'Sensibilisation' },
                  { value: 'engagement', label: 'Engagement' },
                  { value: 'conversion', label: 'Conversion' },
                  { value: 'viral', label: 'Viral' },
                ]}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />

              <Input
                label="Titre de la vidéo"
                placeholder="Par exemple: 5 conseils pour débuter en vidéo"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Script</label>
                <textarea
                  className="input-base w-full h-32 font-mono text-sm"
                  placeholder="Décrivez le contenu de votre vidéo..."
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                ></textarea>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="primary" size="lg" disabled={!title || !script}>
                Générer la vidéo
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold text-white mb-4">Aperçu</h3>
              <div className={`w-full bg-gray-800 rounded-lg flex items-center justify-center ${
                format === 'reel' ? 'aspect-[9/16]' : 'aspect-video'
              }`}>
                <p className="text-gray-400">Aperçu vidéo</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Coût estimé</p>
                <p className="text-2xl font-bold text-studiio-accent">{format === 'reel' ? '10' : '15'} crédits</p>
              </div>
              <div className="pt-4 border-t border-gray-800">
                <p className="text-xs text-gray-500 mb-2">Capacités de l'IA</p>
                <div className="space-y-2">
                  <Badge variant="primary">Génération de script</Badge>
                  <Badge variant="primary">Musique IA</Badge>
                  <Badge variant="primary">Montage automatique</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

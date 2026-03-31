'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Trash2, Edit2 } from 'lucide-react';

const mockObjectives = [
  { id: '1', name: 'Croissance Instagram', description: 'Augmenter les followers', target: 'Jeunes adultes', platform: 'Instagram', tone: 'Ludique' },
  { id: '2', name: 'Ventes TikTok', description: 'Promouvoir les produits', target: 'Gen Z', platform: 'TikTok', tone: 'Tendance' },
  { id: '3', name: 'Blog YouTube', description: 'Partager des tutorials', target: 'Passionnés', platform: 'YouTube', tone: 'Éducatif' },
];

export default function ObjectivesPage() {
  const [objectives, setObjectives] = useState(mockObjectives);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', target: '', platform: '', tone: '' });

  const handleDelete = (id: string) => {
    setObjectives(objectives.filter((obj) => obj.id !== id));
  };

  const handleEdit = (objective: typeof mockObjectives[0]) => {
    setEditingId(objective.id);
    setFormData({
      name: objective.name,
      description: objective.description,
      target: objective.target,
      platform: objective.platform,
      tone: objective.tone,
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      // Update existing objective
      setObjectives(objectives.map((obj) =>
        obj.id === editingId ? { ...formData, id: editingId } : obj
      ));
      setEditingId(null);
    } else {
      // Create new objective
      setObjectives([...objectives, { ...formData, id: Date.now().toString() }]);
    }
    setFormData({ name: '', description: '', target: '', platform: '', tone: '' });
    setShowForm(false);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ name: '', description: '', target: '', platform: '', tone: '' });
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Objectifs</h1>
          <p className="text-gray-400">Définissez vos objectifs de création vidéo</p>
        </div>
        <Button variant="primary" onClick={() => {
          if (showForm) {
            handleCancel();
          } else {
            setEditingId(null);
            setFormData({ name: '', description: '', target: '', platform: '', tone: '' });
            setShowForm(true);
          }
        }}>
          {showForm ? 'Annuler' : '+ Créer un objectif'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="border-b border-gray-800">
            <CardTitle>{editingId ? 'Modifier l\u2019objectif' : 'Nouvel objectif'}</CardTitle>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="pt-6 space-y-4">
              <Input
                label="Nom"
                placeholder="Par exemple: Croissance Instagram"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
              <Input
                label="Description"
                placeholder="Décrivez votre objectif"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
              <Input
                label="Public cible"
                placeholder="Par exemple: Jeunes adultes"
                value={formData.target}
                onChange={(e) => setFormData({ ...formData, target: e.target.value })}
              />
              <Select
                label="Plateforme"
                options={[
                  { value: 'instagram', label: 'Instagram' },
                  { value: 'tiktok', label: 'TikTok' },
                  { value: 'youtube', label: 'YouTube' },
                  { value: 'facebook', label: 'Facebook' },
                ]}
                value={formData.platform}
                onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
              />
              <Select
                label="Ton"
                options={[
                  { value: 'ludique', label: 'Ludique' },
                  { value: 'educatif', label: 'Éducatif' },
                  { value: 'tendance', label: 'Tendance' },
                  { value: 'professionnel', label: 'Professionnel' },
                ]}
                value={formData.tone}
                onChange={(e) => setFormData({ ...formData, tone: e.target.value })}
              />
            </CardContent>
            <CardFooter className="flex gap-2">
              {editingId && (
                <Button variant="secondary" type="button" onClick={handleCancel}>
                  Annuler
                </Button>
              )}
              <Button variant="primary" type="submit">
                {editingId ? 'Enregistrer' : 'Créer'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      <div className="grid gap-4">
        {objectives.map((objective) => (
          <Card key={objective.id}>
            <CardContent className="pt-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="font-semibold text-white mb-2">{objective.name}</h3>
                  <p className="text-sm text-gray-400 mb-4">{objective.description}</p>
                  <div className="flex gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Public: </span>
                      <span className="text-gray-300">{objective.target}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Plateforme: </span>
                      <span className="text-gray-300">{objective.platform}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Ton: </span>
                      <span className="text-gray-300">{objective.tone}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => handleEdit(objective)}>
                    <Edit2 size={16} />
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleDelete(objective.id)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

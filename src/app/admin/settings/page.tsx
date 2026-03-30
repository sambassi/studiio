'use client';

import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { STRIPE_PLANS, CREDIT_PACKAGES, FREE_CREDITS } from '@/lib/stripe/constants';

export default function SettingsPage() {
  const [freeCredits, setFreeCredits] = useState(FREE_CREDITS);
  const [settings, setSettings] = useState({
    maintenanceMode: false,
    newSignupsEnabled: true,
    aiGenerationEnabled: true,
  });

  const handleSave = () => {
    console.log('Settings saved:', { freeCredits, ...settings });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">ParamÃ¨tres de la plateforme</h1>
        <p className="text-gray-400">Configurez la plateforme Studiio</p>
      </div>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>CrÃ©dits gratuits</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <Input
            label="CrÃ©dits offerts aux nouveaux utilisateurs"
            type="number"
            value={freeCredits}
            onChange={(e) => setFreeCredits(parseInt(e.target.value))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>FonctionnalitÃ©s</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
            <input
              type="checkbox"
              checked={settings.maintenanceMode}
              onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium text-white text-sm">Mode maintenance</p>
              <p className="text-xs text-gray-400">DÃ©sactiver tous les accÃ¨s utilisateurs</p>
            </div>
          </label>
          <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
            <input
              type="checkbox"
              checked={settings.newSignupsEnabled}
              onChange={(e) => setSettings({ ...settings, newSignupsEnabled: e.target.checked })}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium text-white text-sm">Autoriser el les nouvelles inscriptions</p>
              <p className="text-xs text-gray-400">Permettre aux nouveaux utilisateurs de sinscrire</p>
            </div>
          </label>
          <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800 transition">
            <input
              type="checkbox"
              checked={settings.aiGenerationEnabled}
              onChange={(e) => setSettings({ ...settings, aiGenerationEnabled: e.target.checked })}
              className="w-4 h-4"
            />
            <div>
              <p className="font-medium text-white text-sm">Activation de la gÃ©nÃ©ration IA</p>
              <p className="text-xs text-gray-400">Permettre la crÃ©ation de vidÃ©os avec l'IA</p>
            </div>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>Tarification des plans</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {Object.entries(STRIPE_PLANS).map(([key, plan]) => (
              <div key={key} className="p-4 bg-gray-800/50 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-semibold text-white">{plan.name}</h4>
                  <span className="text-studiio-accent font-bold">{plan.priceFr}</span>
                </div>
                <p className="text-xs text-gray-400">CrÃ©dits: {plan.credits || 'IllimitÃ©es'}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>Packages de crÃ©dits</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {Object.entries(CREDIT_PACKAGES).map(([key, pkg]) => (
              <div key={key} className="p-4 bg-gray-800/50 rounded-lg">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold text-white">{pkg.name}</h4>
                  <span className="text-studiio-accent font-bold">{pkg.priceFr}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardFooter className="border-t-0 pt-0">
          <Button variant="primary" size="lg" onClick={handleSave}>
            Sauvegarder les paramÃ¨tres
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

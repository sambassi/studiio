'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface NotificationSettings {
  notifyOnSale: boolean;
  dailyDigest: boolean;
  notifyNewUser: boolean;
  adminEmail: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  description: string;
}

export default function EmailsPage() {
  const [testEmail, setTestEmail] = useState('');
  const [testSubject, setTestSubject] = useState('');
  const [testBody, setTestBody] = useState('');
  const [notifyOnSale, setNotifyOnSale] = useState(false);
  const [dailyDigest, setDailyDigest] = useState(false);
  const [notifyNewUser, setNotifyNewUser] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  const [testLoading, setTestLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError('');

      const [notificationsRes, templatesRes] = await Promise.all([
        fetch('/api/admin/notifications'),
        fetch('/api/admin/email-templates'),
      ]);

      if (notificationsRes.ok) {
        const data: NotificationSettings = await notificationsRes.json();
        setNotifyOnSale(data.notifyOnSale);
        setDailyDigest(data.dailyDigest);
        setNotifyNewUser(data.notifyNewUser);
        setAdminEmail(data.adminEmail);
      }

      if (templatesRes.ok) {
        const data = await templatesRes.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSendTestEmail = async () => {
    if (!testEmail || !testSubject || !testBody) {
      showToast('Veuillez remplir tous les champs', 'error');
      return;
    }

    try {
      setTestLoading(true);
      const res = await fetch('/api/admin/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmail,
          subject: testSubject,
          body: testBody,
        }),
      });

      if (!res.ok) throw new Error('Erreur lors de l\'envoi du test');

      showToast('Email de test envoyé avec succès', 'success');
      setTestEmail('');
      setTestSubject('');
      setTestBody('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
    } finally {
      setTestLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSettingsLoading(true);
      const res = await fetch('/api/admin/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifyOnSale,
          dailyDigest,
          notifyNewUser,
          adminEmail,
        }),
      });

      if (!res.ok) throw new Error('Erreur lors de la sauvegarde');

      showToast('Paramètres de notification sauvegardés avec succès', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
    } finally {
      setSettingsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-400">Chargement des paramètres...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Gestion des emails</h1>
        <p className="text-gray-400">Gérez les paramètres de notifications et les templates d'emails</p>
      </div>

      {toast && (
        <div className={`px-4 py-3 rounded-lg flex items-center gap-3 ${
          toast.type === 'success'
            ? 'bg-green-900/20 border border-green-800 text-green-300'
            : 'bg-red-900/20 border border-red-800 text-red-300'
        }`}>
          {toast.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Envoyer un email de test</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Email destinataire"
              type="email"
              placeholder="test@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <Input
              label="Sujet"
              placeholder="Sujet de l'email..."
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
            />
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">Corps du message</label>
              <textarea
                placeholder="Contenu de l'email..."
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                className="input-base w-full h-32 resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={handleSendTestEmail}
                disabled={testLoading || !testEmail || !testSubject || !testBody}
              >
                {testLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Envoi...
                  </>
                ) : (
                  'Envoyer le test'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paramètres de notification</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <Input
              label="Email administrateur"
              type="email"
              placeholder="admin@studiio.com"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <div>
                  <p className="font-medium text-white">Notification pour chaque vente</p>
                  <p className="text-sm text-gray-400">Recevoir une notification à chaque vente</p>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyOnSale}
                    onChange={(e) => setNotifyOnSale(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 text-orange-500 focus:ring-orange-500"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <div>
                  <p className="font-medium text-white">Email digest quotidien</p>
                  <p className="text-sm text-gray-400">Recevoir un résumé quotidien des activités</p>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dailyDigest}
                    onChange={(e) => setDailyDigest(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 text-orange-500 focus:ring-orange-500"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <div>
                  <p className="font-medium text-white">Alertes nouvel utilisateur</p>
                  <p className="text-sm text-gray-400">Être alerté à chaque nouvelle inscription</p>
                </div>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyNewUser}
                    onChange={(e) => setNotifyNewUser(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 text-orange-500 focus:ring-orange-500"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-800">
              <Button
                variant="primary"
                onClick={handleSaveSettings}
                disabled={settingsLoading}
              >
                {settingsLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Sauvegarde...
                  </>
                ) : (
                  'Sauvegarder les paramètres'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Templates d'email</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {templates.map((template) => (
                <div key={template.id} className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-orange-500 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-white">{template.name}</p>
                      <p className="text-sm text-gray-400 mt-1">{template.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, Mail, Users, Send, X } from 'lucide-react';
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

interface UserForEmail {
  id: string;
  name: string;
  email: string;
  plan: string;
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

  // Bulk email state
  const [bulkMode, setBulkMode] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserForEmail[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserForEmail[]>([]);
  const [bulkSubject, setBulkSubject] = useState('');
  const [bulkBody, setBulkBody] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ sent: 0, total: 0 });

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
    setTimeout(() => setToast(null), 4000);
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
          emailBody: testBody, // API expects emailBody, not body
        }),
      });

      if (!res.ok) throw new Error('Erreur lors de l\'envoi du test');

      showToast('Email de test envoye avec succes', 'success');
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

      showToast('Parametres de notification sauvegardes avec succes', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
    } finally {
      setSettingsLoading(false);
    }
  };

  // Bulk email functions
  const searchUsers = async (query: string) => {
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      setSearchLoading(true);
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults((data.data || []).map((u: any) => ({
          id: u.id,
          name: u.name || u.full_name || u.email?.split('@')[0] || 'Sans nom',
          email: u.email,
          plan: u.plan || 'free',
        })));
      }
    } catch { /* ignore */ } finally {
      setSearchLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      setSearchLoading(true);
      const res = await fetch('/api/admin/users?limit=500');
      if (res.ok) {
        const data = await res.json();
        const allUsers = (data.data || []).map((u: any) => ({
          id: u.id,
          name: u.name || u.full_name || u.email?.split('@')[0] || 'Sans nom',
          email: u.email,
          plan: u.plan || 'free',
        }));
        setSelectedUsers(allUsers);
        showToast(`${allUsers.length} utilisateurs selectionnes`, 'success');
      }
    } catch { /* ignore */ } finally {
      setSearchLoading(false);
    }
  };

  const toggleUser = (user: UserForEmail) => {
    setSelectedUsers((prev) => {
      const exists = prev.find((u) => u.id === user.id);
      if (exists) return prev.filter((u) => u.id !== user.id);
      return [...prev, user];
    });
  };

  const isSelected = (userId: string) => selectedUsers.some((u) => u.id === userId);

  const handleSendBulkEmail = async () => {
    if (selectedUsers.length === 0 || !bulkSubject || !bulkBody) {
      showToast('Selectionnez des utilisateurs et remplissez tous les champs', 'error');
      return;
    }

    if (!confirm(`Envoyer cet email a ${selectedUsers.length} utilisateur(s) ?`)) return;

    try {
      setBulkSending(true);
      setBulkProgress({ sent: 0, total: selectedUsers.length });

      let sentCount = 0;
      let errorCount = 0;

      // Send emails one by one (to avoid rate limits)
      for (const user of selectedUsers) {
        try {
          const res = await fetch('/api/admin/email/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: user.email,
              subject: bulkSubject,
              emailBody: bulkBody.replace(/\{nom\}/g, user.name).replace(/\{email\}/g, user.email).replace(/\{plan\}/g, user.plan),
            }),
          });

          if (res.ok) {
            sentCount++;
          } else {
            errorCount++;
          }
        } catch {
          errorCount++;
        }
        setBulkProgress({ sent: sentCount + errorCount, total: selectedUsers.length });
      }

      if (errorCount > 0) {
        showToast(`${sentCount} emails envoyes, ${errorCount} erreurs`, sentCount > 0 ? 'success' : 'error');
      } else {
        showToast(`${sentCount} emails envoyes avec succes`, 'success');
      }

      // Reset
      setSelectedUsers([]);
      setBulkSubject('');
      setBulkBody('');
      setBulkMode(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally {
      setBulkSending(false);
      setBulkProgress({ sent: 0, total: 0 });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500 mx-auto mb-4" />
          <p className="text-gray-400">Chargement des parametres...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Gestion des emails</h1>
          <p className="text-gray-400">Envoyez des emails et gerez les notifications</p>
        </div>
        <Button
          variant={bulkMode ? 'secondary' : 'primary'}
          onClick={() => setBulkMode(!bulkMode)}
        >
          {bulkMode ? (
            <><X size={16} className="mr-2" /> Fermer</>
          ) : (
            <><Users size={16} className="mr-2" /> Email grouper</>
          )}
        </Button>
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

      {/* Bulk Email Section */}
      {bulkMode && (
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Send size={20} className="text-orange-500" />
                Envoyer un email a plusieurs utilisateurs
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* User Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-300">
                    Destinataires ({selectedUsers.length} selectionnes)
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={loadAllUsers} disabled={searchLoading}>
                      Tous les utilisateurs
                    </Button>
                    {selectedUsers.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => setSelectedUsers([])}>
                        Tout deselectionner
                      </Button>
                    )}
                  </div>
                </div>

                <Input
                  placeholder="Rechercher par nom ou email..."
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value);
                    searchUsers(e.target.value);
                  }}
                />

                {searchLoading && (
                  <div className="text-center py-2">
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto" />
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto border border-gray-700 rounded-lg">
                    {searchResults.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => toggleUser(user)}
                        className={`w-full text-left px-4 py-2 text-sm transition border-b border-gray-800 last:border-0 ${
                          isSelected(user.id) ? 'bg-purple-900/20 text-purple-300' : 'hover:bg-gray-800/50 text-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{user.name} ({user.email})</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="primary">{user.plan}</Badge>
                            {isSelected(user.id) && <Check size={14} className="text-green-400" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Selected users chips */}
                {selectedUsers.length > 0 && selectedUsers.length <= 20 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedUsers.map((user) => (
                      <span
                        key={user.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-purple-900/20 border border-purple-700/50 rounded-full text-xs text-purple-300"
                      >
                        {user.name}
                        <button onClick={() => toggleUser(user)} className="hover:text-white">
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {selectedUsers.length > 20 && (
                  <p className="mt-3 text-sm text-purple-300">{selectedUsers.length} utilisateurs selectionnes</p>
                )}
              </div>

              {/* Email content */}
              <Input
                label="Sujet"
                placeholder="Sujet de l'email..."
                value={bulkSubject}
                onChange={(e) => setBulkSubject(e.target.value)}
              />
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  Corps du message
                  <span className="text-xs text-gray-500 ml-2">Variables: {'{nom}'}, {'{email}'}, {'{plan}'}</span>
                </label>
                <textarea
                  placeholder="Contenu de l'email... Utilisez {nom} pour le nom de l'utilisateur"
                  value={bulkBody}
                  onChange={(e) => setBulkBody(e.target.value)}
                  className="input-base w-full h-40 resize-none"
                />
              </div>

              {bulkSending && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>Envoi en cours...</span>
                    <span>{bulkProgress.sent}/{bulkProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full transition-all"
                      style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.sent / bulkProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={handleSendBulkEmail}
                  disabled={bulkSending || selectedUsers.length === 0 || !bulkSubject || !bulkBody}
                >
                  {bulkSending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Envoi {bulkProgress.sent}/{bulkProgress.total}</>
                  ) : (
                    <><Send size={16} className="mr-2" /> Envoyer a {selectedUsers.length} utilisateur(s)</>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test Email */}
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
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Envoi...</>
                ) : (
                  'Envoyer le test'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Parametres de notification</CardTitle>
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
                  <p className="text-sm text-gray-400">Recevoir une notification a chaque vente</p>
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
                  <p className="text-sm text-gray-400">Recevoir un resume quotidien des activites</p>
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
                  <p className="text-sm text-gray-400">Etre alerte a chaque nouvelle inscription</p>
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
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sauvegarde...</>
                ) : (
                  'Sauvegarder les parametres'
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Templates d&apos;email</CardTitle>
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

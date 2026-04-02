'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, Mail, Users, Send, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useTranslations } from '@/i18n/client';

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
  const t = useTranslations('admin');
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
      setError(err instanceof Error ? err.message : t('common.errorOccurred'));
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
      showToast(t('emails.testEmail.fillAll'), 'error');
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
          emailBody: testBody,
        }),
      });

      if (!res.ok) throw new Error(t('emails.testEmail.error'));

      showToast(t('emails.testEmail.sent'), 'success');
      setTestEmail('');
      setTestSubject('');
      setTestBody('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
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

      if (!res.ok) throw new Error(t('emails.notifications.error'));

      showToast(t('emails.notifications.saved'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
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
          name: u.name || u.full_name || u.email?.split('@')[0] || t('users.noName'),
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
          name: u.name || u.full_name || u.email?.split('@')[0] || t('users.noName'),
          email: u.email,
          plan: u.plan || 'free',
        }));
        setSelectedUsers(allUsers);
        showToast(t('emails.bulk.usersSelected', { count: String(allUsers.length) }), 'success');
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
      showToast(t('emails.bulk.fillAll'), 'error');
      return;
    }

    if (!confirm(t('emails.bulk.confirmSend', { count: String(selectedUsers.length) }))) return;

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
        showToast(t('emails.bulk.successPartial', { sent: String(sentCount), errors: String(errorCount) }), sentCount > 0 ? 'success' : 'error');
      } else {
        showToast(t('emails.bulk.successAll', { sent: String(sentCount) }), 'success');
      }

      // Reset
      setSelectedUsers([]);
      setBulkSubject('');
      setBulkBody('');
      setBulkMode(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
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
          <p className="text-gray-400">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">{t('emails.title')}</h1>
          <p className="text-gray-400">{t('emails.subtitle')}</p>
        </div>
        <Button
          variant={bulkMode ? 'secondary' : 'primary'}
          onClick={() => setBulkMode(!bulkMode)}
        >
          {bulkMode ? (
            <><X size={16} className="mr-2" /> {t('emails.close')}</>
          ) : (
            <><Users size={16} className="mr-2" /> {t('emails.bulkButton')}</>
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
                {t('emails.bulk.title')}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* User Selection */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-300">
                    {t('emails.bulk.recipients')} ({t('emails.bulk.recipientsCount', { count: String(selectedUsers.length) })})
                  </label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={loadAllUsers} disabled={searchLoading}>
                      {t('emails.bulk.allUsers')}
                    </Button>
                    {selectedUsers.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => setSelectedUsers([])}>
                        {t('emails.bulk.deselectAll')}
                      </Button>
                    )}
                  </div>
                </div>

                <Input
                  placeholder={t('emails.bulk.searchPlaceholder')}
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
                  <p className="mt-3 text-sm text-purple-300">{t('emails.bulk.usersSelected', { count: String(selectedUsers.length) })}</p>
                )}
              </div>

              {/* Email content */}
              <Input
                label={t('emails.bulk.subject')}
                placeholder={t('emails.bulk.subjectPlaceholder')}
                value={bulkSubject}
                onChange={(e) => setBulkSubject(e.target.value)}
              />
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-300">
                  {t('emails.bulk.body')}
                  <span className="text-xs text-gray-500 ml-2">{t('emails.bulk.bodyVariables')}</span>
                </label>
                <textarea
                  placeholder={t('emails.bulk.bodyPlaceholder')}
                  value={bulkBody}
                  onChange={(e) => setBulkBody(e.target.value)}
                  className="input-base w-full h-40 resize-none"
                />
              </div>

              {bulkSending && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-400">
                    <span>{t('emails.bulk.sendingProgress')}</span>
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
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('emails.bulk.sending', { sent: String(bulkProgress.sent), total: String(bulkProgress.total) })}</>
                  ) : (
                    <><Send size={16} className="mr-2" /> {t('emails.bulk.sendTo', { count: String(selectedUsers.length) })}</>
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
          <CardTitle>{t('emails.testEmail.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Input
              label={t('emails.testEmail.to')}
              type="email"
              placeholder={t('emails.testEmail.toPlaceholder')}
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <Input
              label={t('emails.testEmail.subject')}
              placeholder={t('emails.testEmail.subjectPlaceholder')}
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
            />
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-300">{t('emails.testEmail.body')}</label>
              <textarea
                placeholder={t('emails.testEmail.bodyPlaceholder')}
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
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('emails.testEmail.sending')}</>
                ) : (
                  t('emails.testEmail.send')
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('emails.notifications.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <Input
              label={t('emails.notifications.adminEmail')}
              type="email"
              placeholder={t('emails.notifications.adminEmailPlaceholder')}
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <div>
                  <p className="font-medium text-white">{t('emails.notifications.notifyOnSale')}</p>
                  <p className="text-sm text-gray-400">{t('emails.notifications.notifyOnSaleDesc')}</p>
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
                  <p className="font-medium text-white">{t('emails.notifications.dailyDigest')}</p>
                  <p className="text-sm text-gray-400">{t('emails.notifications.dailyDigestDesc')}</p>
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
                  <p className="font-medium text-white">{t('emails.notifications.notifyNewUser')}</p>
                  <p className="text-sm text-gray-400">{t('emails.notifications.notifyNewUserDesc')}</p>
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
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('emails.notifications.saving')}</>
                ) : (
                  t('emails.notifications.save')
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('emails.templates.title')}</CardTitle>
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

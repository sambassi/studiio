'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, AlertCircle, Save, CreditCard, Edit2, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { STRIPE_PLANS, CREDIT_PACKAGES, FREE_CREDITS } from '@/lib/stripe/constants';
import { useTranslations } from '@/i18n/client';

interface UserForCredit {
  id: string;
  name: string;
  email: string;
  credits: number;
  plan: string;
}

export default function SettingsPage() {
  const t = useTranslations('admin');
  const [freeCredits, setFreeCredits] = useState(FREE_CREDITS);
  const [settings, setSettings] = useState({
    maintenanceMode: false,
    newSignupsEnabled: true,
    aiGenerationEnabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Credit user modal
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [users, setUsers] = useState<UserForCredit[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserForCredit | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [creditAction, setCreditAction] = useState<'add' | 'deduct'>('add');
  const [creditSaving, setCreditSaving] = useState(false);

  // Plan edit modal
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planUsers, setPlanUsers] = useState<UserForCredit[]>([]);
  const [planUsersLoading, setPlanUsersLoading] = useState(false);
  const [planUserSearch, setPlanUserSearch] = useState('');
  const [selectedPlanUser, setSelectedPlanUser] = useState<UserForCredit | null>(null);
  const [newPlan, setNewPlan] = useState('');
  const [planSaving, setPlanSaving] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.data) {
          setFreeCredits(data.data.freeCredits ?? FREE_CREDITS);
          setSettings({
            maintenanceMode: data.data.maintenanceMode ?? false,
            newSignupsEnabled: data.data.newSignupsEnabled ?? true,
            aiGenerationEnabled: data.data.aiGenerationEnabled ?? true,
          });
        }
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          freeCredits,
          ...settings,
        }),
      });

      if (!res.ok) throw new Error(t('settings.errorSaving'));

      showToast(t('settings.saved'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const searchUsers = async (query: string) => {
    if (query.length < 2) return;
    try {
      setUsersLoading(true);
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setUsers((data.data || []).map((u: any) => ({
          id: u.id,
          name: u.name || u.full_name || u.email?.split('@')[0] || t('users.noName'),
          email: u.email,
          credits: u.credits || 0,
          plan: u.plan || 'free',
        })));
      }
    } catch { /* ignore */ } finally {
      setUsersLoading(false);
    }
  };

  const searchPlanUsers = async (query: string) => {
    if (query.length < 2) return;
    try {
      setPlanUsersLoading(true);
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(query)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setPlanUsers((data.data || []).map((u: any) => ({
          id: u.id,
          name: u.name || u.full_name || u.email?.split('@')[0] || t('users.noName'),
          email: u.email,
          credits: u.credits || 0,
          plan: u.plan || 'free',
        })));
      }
    } catch { /* ignore */ } finally {
      setPlanUsersLoading(false);
    }
  };

  const handleCreditUser = async () => {
    if (!selectedUser || !creditAmount || !creditReason) return;
    try {
      setCreditSaving(true);
      const amount = creditAction === 'deduct' ? -Math.abs(parseInt(creditAmount)) : Math.abs(parseInt(creditAmount));
      const res = await fetch(`/api/admin/users/${selectedUser.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: creditReason }),
      });

      if (!res.ok) throw new Error(t('users.errorAddCredits'));

      showToast(`${Math.abs(amount)} credits ${creditAction === 'add' ? 'ajoutes a' : 'retires de'} ${selectedUser.name}`, 'success');
      setCreditModalOpen(false);
      setSelectedUser(null);
      setCreditAmount('');
      setCreditReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setCreditSaving(false);
    }
  };

  const handleChangePlan = async () => {
    if (!selectedPlanUser || !newPlan) return;
    try {
      setPlanSaving(true);
      const res = await fetch(`/api/admin/users/${selectedPlanUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      });

      if (!res.ok) throw new Error(t('users.errorModify'));

      showToast(`Plan de ${selectedPlanUser.name} change en ${newPlan}`, 'success');
      setPlanModalOpen(false);
      setSelectedPlanUser(null);
      setNewPlan('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.error'), 'error');
    } finally {
      setPlanSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('settings.title')}</h1>
        <p className="text-gray-400">{t('settings.subtitle')}</p>
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

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setCreditModalOpen(true)}
          className="p-6 bg-gray-800/60 rounded-xl border border-gray-700/50 hover:border-purple-500/50 transition text-left group"
        >
          <div className="flex items-center gap-3 mb-2">
            <CreditCard size={24} className="text-purple-400 group-hover:text-purple-300" />
            <h3 className="text-lg font-bold text-white">{t('settings.creditUser')}</h3>
          </div>
          <p className="text-sm text-gray-400">{t('settings.creditUserDesc')}</p>
        </button>

        <button
          onClick={() => setPlanModalOpen(true)}
          className="p-6 bg-gray-800/60 rounded-xl border border-gray-700/50 hover:border-orange-500/50 transition text-left group"
        >
          <div className="flex items-center gap-3 mb-2">
            <Edit2 size={24} className="text-orange-400 group-hover:text-orange-300" />
            <h3 className="text-lg font-bold text-white">{t('settings.changePlan')}</h3>
          </div>
          <p className="text-sm text-gray-400">{t('settings.changePlanDesc')}</p>
        </button>
      </div>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>{t('settings.freeCredits')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <Input
            label={t('settings.freeCreditsLabel')}
            type="number"
            value={freeCredits}
            onChange={(e) => setFreeCredits(parseInt(e.target.value) || 0)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>{t('settings.features')}</CardTitle>
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
              <p className="font-medium text-white text-sm">{t('settings.maintenanceMode')}</p>
              <p className="text-xs text-gray-400">{t('settings.maintenanceModeDesc')}</p>
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
              <p className="font-medium text-white text-sm">{t('settings.newSignups')}</p>
              <p className="text-xs text-gray-400">{t('settings.newSignupsDesc')}</p>
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
              <p className="font-medium text-white text-sm">{t('settings.aiGeneration')}</p>
              <p className="text-xs text-gray-400">{t('settings.aiGenerationDesc')}</p>
            </div>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>{t('settings.planPricing')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {Object.entries(STRIPE_PLANS).map(([key, plan]) => (
              <div key={key} className="p-4 bg-gray-800/50 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-semibold text-white">{plan.name}</h4>
                  <span className="text-studiio-accent font-bold">{plan.priceFr}</span>
                </div>
                <p className="text-xs text-gray-400">Credits: {plan.credits || 'Illimitees'}</p>
              </div>
            ))}
          </div>
          <a href="/admin/landing" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-400 text-sm font-medium hover:bg-orange-500/20 transition">
            <Edit2 size={14} />
            {t('settings.editLandingPlans')}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>{t('settings.creditPackages')}</CardTitle>
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
          <Button variant="primary" size="lg" onClick={handleSave} disabled={saving}>
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('settings.saving')}</>
            ) : (
              <><Save size={16} className="mr-2" /> {t('settings.saveSettings')}</>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* Credit User Modal */}
      <Modal isOpen={creditModalOpen} onClose={() => { setCreditModalOpen(false); setSelectedUser(null); }} title={t('settings.creditUser')}>
        <div className="space-y-4">
          {!selectedUser ? (
            <>
              <Input
                label={t('settings.searchUser')}
                placeholder={t('settings.searchUserPlaceholder')}
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  searchUsers(e.target.value);
                }}
              />
              {usersLoading && <div className="text-center py-2"><Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto" /></div>}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className="w-full text-left p-3 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition"
                  >
                    <p className="text-sm font-medium text-white">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email} - {u.credits} credits - Plan: {u.plan}</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="p-3 bg-gray-800/50 rounded-lg flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-white">{selectedUser.name}</p>
                  <p className="text-xs text-gray-400">{selectedUser.email} - {selectedUser.credits} {t('settings.creditsActuels')}</p>
                </div>
                <button onClick={() => setSelectedUser(null)} className="text-gray-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCreditAction('add')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${creditAction === 'add' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                >
                  + {t('settings.addCredits')}
                </button>
                <button
                  onClick={() => setCreditAction('deduct')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${creditAction === 'deduct' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                >
                  - {t('settings.deductCredits')}
                </button>
              </div>
              <Input label={t('settings.amount')} type="number" placeholder="100" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} min="1" />
              <Input label={t('settings.reason')} placeholder={t('settings.reasonPlaceholder')} value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
              <div className="flex gap-3 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => { setCreditModalOpen(false); setSelectedUser(null); }}>{t('common.cancel')}</Button>
                <Button variant="primary" className="flex-1" onClick={handleCreditUser} disabled={creditSaving || !creditAmount || !creditReason}>
                  {creditSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.confirmAction')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Change Plan Modal */}
      <Modal isOpen={planModalOpen} onClose={() => { setPlanModalOpen(false); setSelectedPlanUser(null); }} title={t('settings.changePlanDesc')}>
        <div className="space-y-4">
          {!selectedPlanUser ? (
            <>
              <Input
                label={t('settings.searchUser')}
                placeholder={t('settings.searchUserPlaceholder')}
                value={planUserSearch}
                onChange={(e) => {
                  setPlanUserSearch(e.target.value);
                  searchPlanUsers(e.target.value);
                }}
              />
              {planUsersLoading && <div className="text-center py-2"><Loader2 className="w-5 h-5 animate-spin text-orange-500 mx-auto" /></div>}
              <div className="max-h-48 overflow-y-auto space-y-1">
                {planUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedPlanUser(u); setNewPlan(u.plan); }}
                    className="w-full text-left p-3 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition"
                  >
                    <p className="text-sm font-medium text-white">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email} - {t('settings.currentPlan')}: {u.plan}</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="p-3 bg-gray-800/50 rounded-lg flex justify-between items-center">
                <div>
                  <p className="text-sm font-medium text-white">{selectedPlanUser.name}</p>
                  <p className="text-xs text-gray-400">{selectedPlanUser.email} - {t('settings.currentPlan')}: {selectedPlanUser.plan}</p>
                </div>
                <button onClick={() => setSelectedPlanUser(null)} className="text-gray-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <Select
                label={t('settings.newPlan')}
                options={[
                  { value: 'free', label: t('users.plans.free') },
                  { value: 'starter', label: 'Starter - 29,99 EUR' },
                  { value: 'pro', label: 'Pro - 79,99 EUR' },
                  { value: 'enterprise', label: 'Enterprise - 299,99 EUR' },
                ]}
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
              />
              <div className="flex gap-3 pt-2">
                <Button variant="secondary" className="flex-1" onClick={() => { setPlanModalOpen(false); setSelectedPlanUser(null); }}>{t('common.cancel')}</Button>
                <Button variant="primary" className="flex-1" onClick={handleChangePlan} disabled={planSaving || !newPlan}>
                  {planSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.modifyPlan')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

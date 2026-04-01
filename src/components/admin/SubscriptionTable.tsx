'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';

interface Subscription {
  id: string;
  user_id: string;
  user_email?: string;
  user_name?: string;
  plan: string;
  status: string;
  created_at: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  stripe_subscription_id?: string;
}

export function SubscriptionTable() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Edit modal
  const [editModal, setEditModal] = useState(false);
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/admin/subscriptions?limit=50');
      if (!res.ok) throw new Error('Erreur de chargement');
      const data = await res.json();
      setSubscriptions(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedSub) return;
    try {
      setActionLoading(true);
      const updates: any = {};
      if (editPlan && editPlan !== selectedSub.plan) updates.plan = editPlan;
      if (editStatus && editStatus !== selectedSub.status) updates.status = editStatus;

      if (Object.keys(updates).length === 0) {
        showToast('Aucune modification', 'error');
        return;
      }

      const res = await fetch('/api/admin/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedSub.id, ...updates }),
      });

      if (!res.ok) throw new Error('Erreur de modification');

      showToast('Abonnement modifie avec succes', 'success');
      setEditModal(false);
      setSelectedSub(null);
      fetchSubscriptions();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (sub: Subscription) => {
    if (!confirm(`Annuler l'abonnement de ${sub.user_name || sub.user_email || sub.user_id} ?`)) return;
    try {
      setActionLoading(true);
      const res = await fetch('/api/admin/subscriptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sub.id, status: 'canceled', cancel_at_period_end: true }),
      });

      if (!res.ok) throw new Error('Erreur d\'annulation');

      showToast('Abonnement annule', 'success');
      fetchSubscriptions();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
        <AlertCircle size={20} />
        {error}
      </div>
    );
  }

  return (
    <>
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-lg flex items-center gap-3 ${
          toast.type === 'success'
            ? 'bg-green-900/20 border border-green-800 text-green-300'
            : 'bg-red-900/20 border border-red-800 text-red-300'
        }`}>
          {toast.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </div>
      )}

      {subscriptions.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Aucun abonnement actif</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Utilisateur</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Plan</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Statut</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Debut</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Fin periode</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition">
                  <td className="px-6 py-4 text-gray-300 text-sm">
                    {sub.user_name || sub.user_email || sub.user_id}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant="primary">{sub.plan}</Badge>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={sub.status === 'active' ? 'success' : 'error'}>
                      {sub.status === 'active' ? 'Actif' : sub.status === 'canceled' ? 'Resilie' : sub.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-gray-300 text-sm">
                    {sub.created_at ? new Date(sub.created_at).toLocaleDateString('fr-FR') : '-'}
                  </td>
                  <td className="px-6 py-4 text-gray-300 text-sm">
                    {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('fr-FR') : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setSelectedSub(sub);
                          setEditPlan(sub.plan);
                          setEditStatus(sub.status);
                          setEditModal(true);
                        }}
                      >
                        Editer
                      </Button>
                      {sub.status === 'active' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleCancel(sub)}
                          disabled={actionLoading}
                          className="text-red-400 hover:text-red-300"
                        >
                          Annuler
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={editModal} onClose={() => { setEditModal(false); setSelectedSub(null); }} title="Modifier l'abonnement">
        <div className="space-y-4">
          <Select
            label="Plan"
            options={[
              { value: 'starter', label: 'Starter' },
              { value: 'pro', label: 'Pro' },
              { value: 'enterprise', label: 'Enterprise' },
            ]}
            value={editPlan}
            onChange={(e) => setEditPlan(e.target.value)}
          />
          <Select
            label="Statut"
            options={[
              { value: 'active', label: 'Actif' },
              { value: 'canceled', label: 'Resilie' },
              { value: 'past_due', label: 'En retard' },
            ]}
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value)}
          />
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" className="flex-1" onClick={() => { setEditModal(false); setSelectedSub(null); }} disabled={actionLoading}>
              Annuler
            </Button>
            <Button variant="primary" className="flex-1" onClick={handleEdit} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Sauvegarder'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

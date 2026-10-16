'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, Edit2, Trash2, Lock, Unlock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useTranslations } from '@/i18n/client';
import { PHRASE_SUPPRESSION_ADMIN, saisieConfirmationValide } from '@/lib/rgpd/confirmation-admin';

interface User {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  credits: number;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  joinedAt: string;
  avatar?: string;
}

interface UsersResponse {
  success: boolean;
  data: any[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export default function UsersPage() {
  const t = useTranslations('admin');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [creditModal, setCreditModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  // Suppression DÉFINITIVE : modale dédiée + phrase exacte (le serveur la
  // revérifie, avec l'identifiant). Remplace l'ancien `confirm()`.
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteSaisie, setDeleteSaisie] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editCredits, setEditCredits] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchUsers();
  }, [search, filterPlan, filterStatus, filterRole, page]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams({
        search,
        plan: filterPlan,
        status: filterStatus,
        role: filterRole,
        page: String(page),
        limit: String(limit),
      });

      const res = await fetch(`/api/admin/users?${params}`);

      if (!res.ok) throw new Error(t('users.errorLoading'));

      const data: UsersResponse = await res.json();
      // Map Supabase fields to frontend User interface
      const mappedUsers: User[] = (data.data || []).map((u: any) => ({
        id: u.id,
        name: u.name || u.full_name || u.email?.split('@')[0] || t('users.noName'),
        email: u.email,
        plan: u.plan || 'free',
        credits: u.credits || 0,
        role: u.role || 'user',
        status: u.blocked ? 'blocked' : 'active',
        joinedAt: u.created_at || new Date().toISOString(),
        avatar: u.avatar_url || u.image || undefined,
      }));
      setUsers(mappedUsers);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleAddCredits = async () => {
    if (!selectedUser || !creditAmount || !creditReason) return;

    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/users/${selectedUser.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseInt(creditAmount),
          reason: creditReason,
        }),
      });

      if (!res.ok) throw new Error(t('users.errorAddCredits'));

      showToast(t('users.creditsAdded'), 'success');
      setCreditModal(false);
      setCreditAmount('');
      setCreditReason('');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;

    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editRole || selectedUser.role,
          plan: editPlan || selectedUser.plan,
          credits: editCredits ? parseInt(editCredits) : selectedUser.credits,
        }),
      });

      if (!res.ok) throw new Error(t('users.errorModify'));

      showToast(t('users.userModified'), 'success');
      setEditModal(false);
      setEditRole('');
      setEditPlan('');
      setEditCredits('');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const openDeleteModal = (user: User) => {
    setDeleteSaisie('');
    setDeleteTarget(user);
  };

  const closeDeleteModal = () => {
    if (actionLoading) return;
    setDeleteTarget(null);
    setDeleteSaisie('');
  };

  const handleDeleteUser = async () => {
    const user = deleteTarget;
    if (!user || !saisieConfirmationValide(deleteSaisie)) return;

    try {
      setActionLoading(true);
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: PHRASE_SUPPRESSION_ADMIN, userId: user.id }),
      });

      // 409 = abonnement actif (rien supprimé) ; 202 = suppression partielle, à relancer.
      if (res.status === 409) throw new Error(t('users.userDeleteSubscribed', { name: user.name }));
      if (!res.ok) throw new Error(t('users.errorDelete'));
      setDeleteTarget(null);
      setDeleteSaisie('');
      if (res.status === 202) {
        showToast(t('users.userDeletePartial', { name: user.name }), 'error');
        fetchUsers();
        return;
      }

      // Terminée dans Studiio, mais des opérations restent à faire à la main
      // chez des fournisseurs : on ne l'annonce pas comme un succès complet.
      const body = await res.json().catch(() => null);
      const restants: string[] = Array.isArray(body?.data?.externes)
        ? body.data.externes.filter((e: any) => e?.etat === 'a_faire_manuellement').map((e: any) => String(e.fournisseur))
        : [];
      if (restants.length > 0) {
        showToast(t('users.userDeletedExternes', { name: user.name, fournisseurs: restants.join(', ') }), 'error');
      } else {
        showToast(t('users.userDeleted', { name: user.name }), 'success');
      }
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleBan = async (user: User) => {
    let reason = '';
    if (user.status === 'active') {
      reason = prompt(t('users.banReason', { name: user.name })) || '';
      if (!reason) return;
    } else {
      if (!confirm(t('users.confirmUnban', { name: user.name }))) return;
    }

    try {
      setActionLoading(true);
      const method = user.status === 'active' ? 'POST' : 'DELETE';
      const res = await fetch(`/api/admin/users/${user.id}/ban`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || t('users.confirmUnban', { name: user.name }) }),
      });

      if (!res.ok) throw new Error(t('users.errorBan'));

      showToast(user.status === 'active' ? t('users.userBanned') : t('users.userUnbanned'), 'success');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.errorOccurred'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const planLabels: Record<string, string> = {
    free: t('users.plans.free'),
    starter: t('users.plans.starter'),
    pro: t('users.plans.pro'),
    enterprise: t('users.plans.enterprise'),
  };

  const roleLabels: Record<string, string> = {
    user: t('users.roles.user'),
    admin: t('users.roles.admin'),
  };

  const pages = Math.ceil(total / limit);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('users.title')}</h1>
        <p className="text-gray-400">{t('users.subtitle')}</p>
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

      <div className="space-y-4">
        <div className="flex gap-4 items-end flex-wrap">
          <Input
            placeholder={t('users.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 min-w-[250px]"
          />
          <Select
            options={[
              { value: '', label: t('users.allPlans') },
              { value: 'free', label: t('users.plans.free') },
              { value: 'starter', label: t('users.plans.starter') },
              { value: 'pro', label: t('users.plans.pro') },
              { value: 'enterprise', label: t('users.plans.enterprise') },
            ]}
            value={filterPlan}
            onChange={(e) => {
              setFilterPlan(e.target.value);
              setPage(1);
            }}
            className="min-w-[150px]"
          />
          <Select
            options={[
              { value: '', label: t('users.allStatuses') },
              { value: 'active', label: t('users.statuses.active') },
              { value: 'blocked', label: t('users.statuses.blocked') },
            ]}
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value);
              setPage(1);
            }}
            className="min-w-[150px]"
          />
          <Select
            options={[
              { value: '', label: t('users.allRoles') },
              { value: 'user', label: t('users.roles.user') },
              { value: 'admin', label: t('users.roles.admin') },
            ]}
            value={filterRole}
            onChange={(e) => {
              setFilterRole(e.target.value);
              setPage(1);
            }}
            className="min-w-[150px]"
          />
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
            <AlertCircle size={20} />
            {error}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.tableHeaders.name')} ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            </div>
          ) : users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.name')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.email')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.plan')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.credits')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.role')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.status')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.joined')}</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">{t('users.tableHeaders.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition">
                      <td className="px-6 py-4 text-gray-300">
                        <div className="flex items-center gap-3">
                          {user.avatar && (
                            <img src={user.avatar} alt={user.name} className="w-8 h-8 rounded-full" />
                          )}
                          <span>{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-sm">{user.email}</td>
                      <td className="px-6 py-4">
                        <Badge variant="primary">{planLabels[user.plan]}</Badge>
                      </td>
                      <td className="px-6 py-4 text-gray-300">{user.credits}</td>
                      <td className="px-6 py-4 text-gray-300 text-sm">{roleLabels[user.role]}</td>
                      <td className="px-6 py-4">
                        <Badge variant={user.status === 'active' ? 'success' : 'error'}>
                          {user.status === 'active' ? t('users.statuses.active') : t('users.statuses.blocked')}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-sm">
                        {new Date(user.joinedAt).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedUser(user);
                              setCreditAmount('');
                              setCreditReason('');
                              setCreditModal(true);
                            }}
                          >
                            {t('users.actions.credit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedUser(user);
                              setEditRole(user.role);
                              setEditPlan(user.plan);
                              setEditCredits(String(user.credits));
                              setEditModal(true);
                            }}
                          >
                            <Edit2 size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant={user.status === 'active' ? 'secondary' : 'primary'}
                            onClick={() => handleToggleBan(user)}
                            disabled={actionLoading}
                            title={user.status === 'active' ? t('users.actions.banHint') : t('users.actions.unbanHint')}
                          >
                            <span className="inline-flex items-center gap-1">
                              {user.status === 'active' ? <Lock size={14} /> : <Unlock size={14} />}
                              {user.status === 'active' ? t('users.actions.ban') : t('users.actions.unban')}
                            </span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openDeleteModal(user)}
                            disabled={actionLoading}
                            title={t('users.actions.deletePermanently')}
                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20 border border-red-800/60"
                          >
                            <span className="inline-flex items-center gap-1">
                              <Trash2 size={14} />
                              {t('users.actions.deletePermanently')}
                            </span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">{t('users.noUsersFound')}</p>
          )}

          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                {t('users.pagination.previous')}
              </Button>
              <span className="text-gray-400 text-sm">
                {t('users.pagination.pageOf', { page: String(page), pages: String(pages) })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page === pages}
                onClick={() => setPage(Math.min(pages, page + 1))}
              >
                {t('users.pagination.next')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={deleteTarget !== null} onClose={closeDeleteModal} title={t('users.deleteModal.title')}>
        {deleteTarget && (
          <div className="space-y-4">
            <div className="rounded-lg border border-red-800/60 bg-red-950/30 p-3 text-sm">
              <p className="text-gray-400 mb-2">{t('users.deleteModal.account')}</p>
              <dl className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
                <dt className="text-gray-400">{t('users.deleteModal.name')}</dt>
                <dd className="text-white break-all">{deleteTarget.name}</dd>
                <dt className="text-gray-400">{t('users.deleteModal.email')}</dt>
                <dd className="text-white break-all">{deleteTarget.email}</dd>
                <dt className="text-gray-400">{t('users.deleteModal.id')}</dt>
                <dd className="text-white font-mono text-xs break-all">{deleteTarget.id}</dd>
              </dl>
            </div>
            <p className="text-sm text-red-300">{t('users.deleteModal.effects')}</p>
            <p className="text-sm text-gray-400">{t('users.deleteModal.banInstead')}</p>
            <Input
              label={t('users.deleteModal.typeToConfirm', { phrase: PHRASE_SUPPRESSION_ADMIN })}
              placeholder={PHRASE_SUPPRESSION_ADMIN}
              value={deleteSaisie}
              onChange={(e) => setDeleteSaisie(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" className="flex-1" onClick={closeDeleteModal} disabled={actionLoading}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="secondary"
                className="flex-1 bg-red-700 text-white hover:bg-red-600 border border-red-600"
                onClick={handleDeleteUser}
                disabled={actionLoading || !saisieConfirmationValide(deleteSaisie)}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <span className="inline-flex items-center gap-1"><Trash2 size={14} />{t('users.deleteModal.confirm')}</span>
                )}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={creditModal} onClose={() => setCreditModal(false)} title={t('users.creditModal.title')}>
        <div className="space-y-4">
          <Input
            label={t('users.creditModal.amount')}
            type="number"
            placeholder="100"
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            min="0"
          />
          <Input
            label={t('users.creditModal.reason')}
            placeholder={t('users.creditModal.reasonPlaceholder')}
            value={creditReason}
            onChange={(e) => setCreditReason(e.target.value)}
          />
          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setCreditModal(false)}
              disabled={actionLoading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleAddCredits}
              disabled={actionLoading || !creditAmount || !creditReason}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('users.creditModal.add')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={editModal} onClose={() => setEditModal(false)} title={t('users.editModal.title')}>
        <div className="space-y-4">
          <Select
            label={t('users.editModal.role')}
            options={[
              { value: 'user', label: t('users.roles.user') },
              { value: 'admin', label: t('users.roles.admin') },
            ]}
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
          />
          <Select
            label={t('users.editModal.plan')}
            options={[
              { value: 'free', label: t('users.plans.free') },
              { value: 'starter', label: t('users.plans.starter') },
              { value: 'pro', label: t('users.plans.pro') },
              { value: 'enterprise', label: t('users.plans.enterprise') },
            ]}
            value={editPlan}
            onChange={(e) => setEditPlan(e.target.value)}
          />
          <Input
            label={t('users.editModal.credits')}
            type="number"
            placeholder="0"
            value={editCredits}
            onChange={(e) => setEditCredits(e.target.value)}
            min="0"
          />
          <div className="flex gap-3 pt-4">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setEditModal(false)}
              disabled={actionLoading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleEditUser}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : t('users.editModal.modify')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

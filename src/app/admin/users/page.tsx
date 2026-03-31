'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, X, Edit2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

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
  users: User[];
  total: number;
  page: number;
  limit: number;
}

export default function UsersPage() {
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

      if (!res.ok) throw new Error('Erreur lors du chargement des utilisateurs');

      const data: UsersResponse = await res.json();
      setUsers(data.users);
      setTotal(data.total);
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

      if (!res.ok) throw new Error('Erreur lors de l\'ajout de crédits');

      showToast('Crédits ajoutés avec succès', 'success');
      setCreditModal(false);
      setCreditAmount('');
      setCreditReason('');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
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

      if (!res.ok) throw new Error('Erreur lors de la modification');

      showToast('Utilisateur modifié avec succès', 'success');
      setEditModal(false);
      setEditRole('');
      setEditPlan('');
      setEditCredits('');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleBan = async (user: User) => {
    if (!confirm(`${user.status === 'active' ? 'Bannir' : 'Débannir'} cet utilisateur ?`)) return;

    try {
      setActionLoading(true);
      const method = user.status === 'active' ? 'POST' : 'DELETE';
      const res = await fetch(`/api/admin/users/${user.id}/ban`, {
        method,
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('Erreur lors du bannissement');

      showToast(`Utilisateur ${user.status === 'active' ? 'banni' : 'débanni'} avec succès`, 'success');
      fetchUsers();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Une erreur est survenue', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const planLabels: Record<string, string> = {
    free: 'Gratuit',
    starter: 'Starter',
    pro: 'Pro',
    enterprise: 'Entreprise',
  };

  const roleLabels: Record<string, string> = {
    user: 'Utilisateur',
    admin: 'Admin',
  };

  const pages = Math.ceil(total / limit);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Gestion des utilisateurs</h1>
        <p className="text-gray-400">Gérez tous les utilisateurs de la plateforme</p>
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
            placeholder="Rechercher par nom ou email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="flex-1 min-w-[250px]"
          />
          <Select
            options={[
              { value: '', label: 'Tous les plans' },
              { value: 'free', label: 'Gratuit' },
              { value: 'starter', label: 'Starter' },
              { value: 'pro', label: 'Pro' },
              { value: 'enterprise', label: 'Entreprise' },
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
              { value: '', label: 'Tous les statuts' },
              { value: 'active', label: 'Actif' },
              { value: 'blocked', label: 'Bloqué' },
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
              { value: '', label: 'Tous les rôles' },
              { value: 'user', label: 'Utilisateur' },
              { value: 'admin', label: 'Admin' },
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
          <CardTitle>Utilisateurs ({total})</CardTitle>
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
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Nom</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Email</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Plan</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Crédits</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Rôle</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Statut</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Inscrit</th>
                    <th className="px-6 py-3 text-left text-sm font-semibold text-gray-300">Actions</th>
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
                          {user.status === 'active' ? 'Actif' : 'Bloqué'}
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
                            Créditer
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
                          >
                            {user.status === 'active' ? 'Bannir' : 'Débannir'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">Aucun utilisateur trouvé</p>
          )}

          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage(Math.max(1, page - 1))}
              >
                Précédent
              </Button>
              <span className="text-gray-400 text-sm">
                Page {page} / {pages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page === pages}
                onClick={() => setPage(Math.min(pages, page + 1))}
              >
                Suivant
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={creditModal} onClose={() => setCreditModal(false)} title="Ajouter des crédits">
        <div className="space-y-4">
          <Input
            label="Montant des crédits"
            type="number"
            placeholder="100"
            value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            min="0"
          />
          <Input
            label="Raison"
            placeholder="Ex: Compensation, bonus..."
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
              Annuler
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleAddCredits}
              disabled={actionLoading || !creditAmount || !creditReason}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ajouter'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={editModal} onClose={() => setEditModal(false)} title="Modifier l'utilisateur">
        <div className="space-y-4">
          <Select
            label="Rôle"
            options={[
              { value: 'user', label: 'Utilisateur' },
              { value: 'admin', label: 'Admin' },
            ]}
            value={editRole}
            onChange={(e) => setEditRole(e.target.value)}
          />
          <Select
            label="Plan"
            options={[
              { value: 'free', label: 'Gratuit' },
              { value: 'starter', label: 'Starter' },
              { value: 'pro', label: 'Pro' },
              { value: 'enterprise', label: 'Entreprise' },
            ]}
            value={editPlan}
            onChange={(e) => setEditPlan(e.target.value)}
          />
          <Input
            label="Crédits"
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
              Annuler
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleEditUser}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Modifier'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

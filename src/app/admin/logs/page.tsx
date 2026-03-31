'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface AuditLog {
  id: string;
  date: string;
  admin: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
}

interface LogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

const ACTION_COLORS: Record<string, string> = {
  create: 'success',
  update: 'primary',
  delete: 'error',
  block: 'warning',
  unblock: 'success',
  credit: 'primary',
  login: 'default',
  logout: 'default',
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const [filterTargetType, setFilterTargetType] = useState('');
  const limit = 50;

  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    fetchLogs();
  }, [page, filterAction, filterTargetType]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        action: filterAction,
        targetType: filterTargetType,
      });

      const res = await fetch(`/api/admin/logs?${params}`);

      if (!res.ok) throw new Error('Erreur lors du chargement des logs');

      const data: LogsResponse = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const pages = Math.ceil(total / limit);

  const uniqueActions = Array.from(
    new Set(logs.map((log) => log.action))
  ).sort();

  const uniqueTargetTypes = Array.from(
    new Set(logs.map((log) => log.targetType))
  ).sort();

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      create: 'Créé',
      update: 'Modifié',
      delete: 'Supprimé',
      block: 'Bloqué',
      unblock: 'Débloqué',
      credit: 'Crédité',
      login: 'Connexion',
      logout: 'Déconnexion',
      ban: 'Banni',
      unban: 'Débanni',
    };
    return labels[action] || action;
  };

  const getTargetTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      user: 'Utilisateur',
      payment: 'Paiement',
      subscription: 'Abonnement',
      video: 'Vidéo',
      content: 'Contenu',
      settings: 'Paramètres',
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Journal d'audit</h1>
        <p className="text-gray-400">Consultez l'historique complet des actions administrateur</p>
      </div>

      <div className="flex gap-4 items-end flex-wrap">
        <Select
          options={[
            { value: '', label: 'Toutes les actions' },
            ...uniqueActions.map((action) => ({
              value: action,
              label: getActionLabel(action),
            })),
          ]}
          value={filterAction}
          onChange={(e) => {
            setFilterAction(e.target.value);
            setPage(1);
          }}
          className="min-w-[180px]"
        />
        <Select
          options={[
            { value: '', label: 'Tous les types' },
            ...uniqueTargetTypes.map((type) => ({
              value: type,
              label: getTargetTypeLabel(type),
            })),
          ]}
          value={filterTargetType}
          onChange={(e) => {
            setFilterTargetType(e.target.value);
            setPage(1);
          }}
          className="min-w-[180px]"
        />
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-300 px-4 py-3 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Logs d'audit ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            </div>
          ) : logs.length > 0 ? (
            <div className="space-y-2">
              {logs.map((log) => (
                <div key={log.id}>
                  <button
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    className="w-full p-4 bg-gray-800/50 hover:bg-gray-800 rounded-lg border border-gray-700 transition text-left"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge variant={ACTION_COLORS[log.action] as any}>
                            {getActionLabel(log.action)}
                          </Badge>
                          <span className="text-white font-medium">{getTargetTypeLabel(log.targetType)}</span>
                          <span className="text-gray-400 text-sm">ID: {log.targetId}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-sm">
                          <span className="text-gray-400">{log.admin}</span>
                          <span className="text-gray-500">
                            {new Date(log.date).toLocaleDateString('fr-FR', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="text-gray-400">
                        {expandedLog === log.id ? '▼' : '▶'}
                      </div>
                    </div>
                  </button>

                  {expandedLog === log.id && (
                    <div className="mt-2 p-4 bg-gray-900 rounded-lg border border-gray-800 border-t-0 rounded-t-none">
                      <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Détails</p>
                      <pre className="bg-gray-800 p-3 rounded text-xs text-gray-300 overflow-x-auto max-h-64 overflow-y-auto font-mono">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-8">Aucun log trouvé</p>
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
    </div>
  );
}

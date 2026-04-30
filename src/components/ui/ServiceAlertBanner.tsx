'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, X } from 'lucide-react';

const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'];

interface ServiceAlert {
  id: string;
  service: string;
  severity: 'warning' | 'critical';
  message: string;
  details?: string;
  timestamp: string;
  dismissed: boolean;
}

/**
 * Admin-only banner that polls /api/admin/service-health every 5 minutes.
 * Displays critical/warning alerts for external service issues
 * (Replicate, OpenAI, Anthropic, etc.).
 */
export default function ServiceAlertBanner() {
  const { data: session } = useSession();
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email?.toLowerCase() || '');

  const fetchAlerts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch('/api/admin/service-health');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.alerts) {
        setAlerts(data.alerts);
      }
    } catch {
      // Silently fail — we don't want the alert system to itself cause errors
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchAlerts();
    // Poll every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const dismissAlert = async (alertId: string) => {
    try {
      await fetch('/api/admin/service-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', alertId }),
      });
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch {
      // Silently fail
    }
  };

  if (!isAdmin || alerts.length === 0) return null;

  const criticals = alerts.filter((a) => a.severity === 'critical');
  const warnings = alerts.filter((a) => a.severity === 'warning');

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] pointer-events-none">
      <div className="pointer-events-auto">
        {criticals.map((alert) => (
          <div
            key={alert.id}
            className="bg-red-600/95 text-white px-4 py-2.5 text-sm flex items-center gap-3 backdrop-blur-sm"
          >
            <AlertTriangle size={16} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">{alert.message}</span>
              {expanded === alert.id && alert.details && (
                <p className="text-red-100 text-xs mt-1">{alert.details}</p>
              )}
            </div>
            <button
              onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
              className="text-xs underline opacity-80 hover:opacity-100 shrink-0"
            >
              {expanded === alert.id ? 'Moins' : 'Détails'}
            </button>
            <button
              onClick={() => dismissAlert(alert.id)}
              className="hover:bg-white/20 rounded p-1 shrink-0"
              title="Masquer cette alerte"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {warnings.map((alert) => (
          <div
            key={alert.id}
            className="bg-amber-500/95 text-black px-4 py-2 text-sm flex items-center gap-3 backdrop-blur-sm"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">{alert.message}</span>
              {expanded === alert.id && alert.details && (
                <p className="text-amber-900 text-xs mt-1">{alert.details}</p>
              )}
            </div>
            <button
              onClick={() => setExpanded(expanded === alert.id ? null : alert.id)}
              className="text-xs underline opacity-70 hover:opacity-100 shrink-0"
            >
              {expanded === alert.id ? 'Moins' : 'Détails'}
            </button>
            <button
              onClick={() => dismissAlert(alert.id)}
              className="hover:bg-black/10 rounded p-1 shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Bell, User, LogOut, Shield, Zap, AlertTriangle } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';

const ADMIN_EMAILS = ['contact.artboost@gmail.com', 'bassicustomshoes@gmail.com'];

/** Une notification, telle que la rend `GET /api/notifications`. */
interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/** « il y a 3 h » — l'ancienneté, plutôt qu'une date que personne ne relit. */
function anciennete(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const minutes = Math.max(0, Math.round((now - t) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return `il y a ${jours} j`;
}

export function Navbar() {
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = ADMIN_EMAILS.includes(session?.user?.email?.toLowerCase() || '');
  const t = useTranslations('navbar');
  const [credits, setCredits] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nonLues, setNonLues] = useState(0);
  const [clocheOuverte, setClocheOuverte] = useState(false);
  const clocheRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setCredits(d.balance ?? 0); })
      .catch(() => {});
  }, [session?.user?.id]);

  const chargerNotifications = useCallback(() => {
    if (!session?.user?.id) return;
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        setNotifications(Array.isArray(d.notifications) ? d.notifications : []);
        setNonLues(Number(d.unread) || 0);
      })
      // Silencieux : la cloche est un ornement, son échec ne doit ni casser
      // la barre de navigation ni alerter l'utilisateur sur un incident qui
      // ne le concerne pas.
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => { chargerNotifications(); }, [chargerNotifications]);

  // Fermeture au clic extérieur — sans quoi le panneau resterait ouvert
  // par-dessus la page pendant qu'on travaille dessous.
  useEffect(() => {
    if (!clocheOuverte) return;
    const surClic = (e: MouseEvent) => {
      if (clocheRef.current && !clocheRef.current.contains(e.target as Node)) {
        setClocheOuverte(false);
      }
    };
    document.addEventListener('mousedown', surClic);
    return () => document.removeEventListener('mousedown', surClic);
  }, [clocheOuverte]);

  /**
   * Ouvre le panneau et marque les notifications comme lues.
   *
   * ⚠️ LE COMPTEUR EST REMIS À ZÉRO TOUT DE SUITE, sans attendre la réponse
   * du serveur : le geste « j'ai vu » doit se voir immédiatement. Si l'appel
   * échoue, le compteur reviendra au prochain chargement de page — un badge
   * qui réapparaît vaut mieux qu'une pastille figée sur un clic sans effet.
   */
  const basculerCloche = useCallback(() => {
    setClocheOuverte((ouvert) => {
      const suivant = !ouvert;
      if (suivant) {
        chargerNotifications();
        if (nonLues > 0) {
          setNonLues(0);
          fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).catch(() => {});
        }
      }
      return suivant;
    });
  }, [chargerNotifications, nonLues]);

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <nav className="fixed top-0 right-0 left-0 lg:left-64 h-16 bg-gray-900 border-b border-gray-800 z-40 lg:z-40">
      <div className="h-full px-6 flex justify-between items-center">
        <div className="text-gray-400 hidden lg:block">{t('dashboard')}</div>
        <div className="flex items-center gap-4 lg:ml-0 ml-12">
          <LanguageSelector variant="navbar" />
          {credits !== null && (
            <button
              onClick={() => router.push('/dashboard/billing')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-600/20 border border-purple-500/40 text-purple-200 hover:bg-purple-600/30 transition text-sm font-semibold"
              title="Crédits restants"
            >
              <Zap size={14} className="text-purple-300" />
              {credits}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => router.push('/admin')}
              className="text-yellow-400 hover:text-yellow-300 transition"
              title={t('admin')}
            >
              <Shield size={20} />
            </button>
          )}
          {/* ── Cloche ─────────────────────────────────────────────────
              ⚠️ ELLE ÉTAIT DÉCORATIVE : pas de gestionnaire de clic, et une
              pastille rouge écrite en dur qui annonçait en permanence des
              notifications qui n'existaient nulle part. Elle lit désormais
              `/api/notifications`, et la pastille ne s'allume que s'il y a
              réellement quelque chose à lire. */}
          <div className="relative" ref={clocheRef}>
            <button
              type="button"
              onClick={basculerCloche}
              aria-expanded={clocheOuverte}
              aria-label={nonLues > 0 ? `${nonLues} notification(s) non lue(s)` : 'Notifications'}
              data-notifications-bell
              className="text-gray-400 hover:text-white transition relative"
            >
              <Bell size={20} />
              {nonLues > 0 && (
                <span
                  data-notifications-badge
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-studiio-accent text-[10px] font-bold text-white"
                >
                  {nonLues > 9 ? '9+' : nonLues}
                </span>
              )}
            </button>
            {clocheOuverte && (
              <div
                data-notifications-panel
                className="absolute right-0 top-9 w-80 max-h-96 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 shadow-2xl z-50"
              >
                <p className="px-3 py-2 text-xs font-semibold text-gray-300 border-b border-gray-800">
                  Notifications
                </p>
                {notifications.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-gray-500">
                    Rien à signaler.
                  </p>
                ) : (
                  <ul>
                    {notifications.map((n) => (
                      <li key={n.id} className="border-b border-gray-800 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setClocheOuverte(false);
                            if (n.href) router.push(n.href);
                          }}
                          disabled={!n.href}
                          className="w-full text-left px-3 py-2.5 hover:bg-gray-800/60 transition disabled:cursor-default"
                        >
                          <span className="flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400" />
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-gray-100">{n.title}</span>
                              {n.body && (
                                <span className="block text-[11px] text-gray-400 mt-0.5">{n.body}</span>
                              )}
                              <span className="block text-[10px] text-gray-600 mt-1">
                                {anciennete(n.createdAt, Date.now())}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="text-gray-400 hover:text-white transition"
            title={t('profile')}
          >
            <User size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="text-gray-400 hover:text-red-400 transition"
            title={t('logout')}
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
}

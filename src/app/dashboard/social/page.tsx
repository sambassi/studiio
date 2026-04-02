'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { useTranslations } from '@/i18n/client';
import {
  Instagram,
  Music2,
  Facebook,
  Youtube,
  Check,
  Loader2,
  X,
  Settings,
  Hash,
  FileText,
  Bell,
  ExternalLink,
} from 'lucide-react';

interface SocialAccount {
  id: string;
  platform: string;
  username: string;
  connected: boolean;
  connectedAt: string;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface PublishingSettings {
  autoPublish: boolean;
  bestTimeToPublish: boolean;
  defaultHashtags: string;
  defaultDescription: string;
}

const PLATFORMS = [
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Instagram,
    color: 'text-pink-400',
    gradient: 'from-pink-500/20 to-purple-500/20',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: Music2,
    color: 'text-slate-900',
    gradient: 'from-slate-500/20 to-slate-600/20',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: Facebook,
    color: 'text-blue-500',
    gradient: 'from-blue-500/20 to-blue-600/20',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: Youtube,
    color: 'text-red-500',
    gradient: 'from-red-500/20 to-orange-500/20',
  },
];

const STORAGE_KEY = 'studiio_social_accounts';
const SETTINGS_KEY = 'studiio_publishing_settings';

export default function SocialPage() {
  const t = useTranslations('social');
  const tc = useTranslations('common');

  const [accounts, setAccounts] = useState<Record<string, SocialAccount | null>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settings, setSettings] = useState<PublishingSettings>({
    autoPublish: true,
    bestTimeToPublish: false,
    defaultHashtags: '',
    defaultDescription: '',
  });
  const [isLoading, setIsLoading] = useState(true);

  const [oauthStatus, setOauthStatus] = useState<Record<string, boolean>>({});

  // Initialize accounts and settings from API only (no stale localStorage)
  useEffect(() => {
    const initializeData = async () => {
      try {
        // Load settings from localStorage (settings are safe to cache)
        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
          setSettings(JSON.parse(savedSettings));
        }

        // IMPORTANT: Clear any stale account data from localStorage
        // Only trust the server API for connection status
        localStorage.removeItem(STORAGE_KEY);

        // Fetch real connection status from API
        try {
          const statusRes = await fetch('/api/social/status');
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.success && statusData.platforms) {
              const accountsMap: Record<string, SocialAccount | null> = {};
              const oauthMap: Record<string, boolean> = {};
              Object.entries(statusData.platforms).forEach(([platform, info]: [string, any]) => {
                oauthMap[platform] = info.oauthAvailable ?? false;
                if (info.connected) {
                  accountsMap[platform] = {
                    id: `${platform}_oauth`,
                    platform,
                    username: info.username || `@${platform}`,
                    connected: true,
                    connectedAt: new Date().toISOString(),
                  };
                }
              });
              setAccounts(accountsMap);
              setOauthStatus(oauthMap);
            }
          }
        } catch (error) {
          console.warn('Could not fetch social status:', error);
          // Start with empty accounts — no fake connections
          setAccounts({});
        }
      } finally {
        setIsLoading(false);
      }
    };

    initializeData();
  }, []);

  // Save settings to localStorage and API
  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

      // Try to save to API (fire and forget)
      fetch('/api/social/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).catch(() => {
        // Silently fail - localStorage is our fallback
      });
    }
  }, [settings, isLoading]);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    const id = Date.now().toString();
    const toast: Toast = { id, message, type };
    setToasts((prev) => [...prev, toast]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleConnect = async (platformId: string) => {
    try {
      setConnecting(platformId);
      const platform = PLATFORMS.find((p) => p.id === platformId);

      if (!platform) {
        showToast(t('toasts.platformNotRecognized'), 'error');
        setConnecting(null);
        return;
      }

      // IMPORTANT: Open popup IMMEDIATELY on user click to avoid browser blocking
      // The popup starts with about:blank, then gets redirected after API call
      const width = 500;
      const height = 600;
      const left =
        typeof window !== 'undefined'
          ? window.screenX + (window.outerWidth - width) / 2
          : 0;
      const top =
        typeof window !== 'undefined'
          ? window.screenY + (window.outerHeight - height) / 2
          : 0;

      const popup = window.open(
        'about:blank',
        `oauth_${platformId}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        showToast(t('toasts.popupsRequired'), 'error');
        setConnecting(null);
        return;
      }

      showToast(t('toasts.connectionInProgress'), 'info');

      // Call API to get the OAuth URL
      try {
        const response = await fetch('/api/social/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform: platformId }),
        });

        const data = await response.json();

        if (!response.ok) {
          popup.close();
          if (data.needsConfig) {
            showToast(
              t('toasts.oauthNotConfigured', { platform: platform.name }),
              'error'
            );
            setConnecting(null);
            return;
          }
          if (response.status === 404 || response.status === 500) {
            showToast(t('toasts.serverError'), 'error');
            setConnecting(null);
            return;
          }
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        // Redirect the already-open popup to the OAuth URL
        if (data.authUrl) {
          popup.location.href = data.authUrl;

          if (!popup) {
            showToast(t('toasts.popupsRequired'), 'error');
            setConnecting(null);
            return;
          }

          // Poll for window closure
          const pollInterval = setInterval(() => {
            if (popup.closed) {
              clearInterval(pollInterval);
              setConnecting(null);

              // Refresh accounts after OAuth completes
              setTimeout(() => {
                fetch('/api/social/accounts')
                  .then((res) => res.json())
                  .then((data) => {
                    if (data.success && data.accounts) {
                      const accountsMap: Record<string, SocialAccount | null> =
                        {};
                      data.accounts.forEach((acc: SocialAccount) => {
                        accountsMap[acc.platform] = acc;
                      });
                      setAccounts(accountsMap);
                      localStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify(accountsMap)
                      );
                      showToast(
                        t('toasts.connectionSuccess', { platform: platform.name }),
                        'success'
                      );
                    }
                  })
                  .catch(() => {
                    showToast(
                      t('toasts.connectionInitiated', { platform: platform.name }),
                      'success'
                    );
                  });
              }, 1000);
            }
          }, 500);

          // Clear interval after 5 minutes (safety timeout)
          setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
        } else {
          // Successful response but no authUrl — should not happen with new API
          popup.close();
          showToast(t('toasts.noAuthUrl', { platform: platform.name }), 'error');
          setConnecting(null);
        }
      } catch (error) {
        console.error('Error during connection:', error);
        if (popup && !popup.closed) popup.close();
        showToast(t('toasts.connectionError'), 'error');
        setConnecting(null);
      }
    } catch (error) {
      console.error('Error in handleConnect:', error);
      showToast(t('toasts.connectionError'), 'error');
      setConnecting(null);
    }
  };

  const handleDisconnect = async (platformId: string) => {
    try {
      const platform = PLATFORMS.find((p) => p.id === platformId);

      // Try API disconnect
      try {
        const response = await fetch(
          `/api/social/disconnect`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: platformId }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            const updated = { ...accounts };
            delete updated[platformId];
            setAccounts(updated);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            showToast(t('toasts.disconnected', { platform: platform?.name || platformId }), 'success');
            return;
          }
        }
      } catch (error) {
        // Continue with localStorage removal if API fails
        console.warn('API disconnect failed, removing from localStorage:', error);
      }

      // Fallback: remove from localStorage
      const updated = { ...accounts };
      delete updated[platformId];
      setAccounts(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      showToast(t('toasts.disconnected', { platform: platform?.name || platformId }), 'success');
    } catch (error) {
      console.error('Error disconnecting account:', error);
      showToast(t('toasts.disconnectError'), 'error');
    }
  };

  const connectedCount = Object.values(accounts).filter((a) => a?.connected).length;
  const hasConnectedPlatforms = connectedCount > 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="animate-spin text-studiio-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-lg shadow-lg flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-2 ${
              toast.type === 'success'
                ? 'bg-green-900/50 border border-green-500/50 text-green-100'
                : toast.type === 'error'
                  ? 'bg-red-900/50 border border-red-500/50 text-red-100'
                  : 'bg-blue-900/50 border border-blue-500/50 text-blue-100'
            }`}
          >
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-current hover:opacity-70 transition flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">{t('title')}</h1>
        <p className="text-gray-400">
          {t('subtitle')}
        </p>
      </div>

      {/* Connection Status Banner */}
      {!hasConnectedPlatforms && (
        <div className="bg-amber-900/30 border border-amber-500/50 rounded-lg p-4 flex items-start gap-3">
          <Bell size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-100 font-semibold">
              {t('noNetworkConnected')}
            </p>
            <p className="text-amber-200/80 text-sm">
              {t('connectAtLeastOne')}
            </p>
          </div>
        </div>
      )}

      {/* Summary Card */}
      {hasConnectedPlatforms && (
        <Card className="border-studiio-primary/20 bg-gradient-to-r from-studiio-primary/10 to-studiio-accent/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-studiio-primary/20 rounded-full flex items-center justify-center">
                <Check className="text-studiio-primary" size={24} />
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold">
                  {t('networksConnected', { count: connectedCount })}
                </p>
                <p className="text-sm text-gray-400">
                  {t('videosAutoPublish')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Platform Cards - 2x2 Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          const account = accounts[platform.id];
          const isConnecting = connecting === platform.id;
          const isConnected = account?.connected ?? false;
          const hasOAuth = oauthStatus[platform.id] ?? false;
          const platformDescription = t(`platforms.${platform.id}.description`);

          return (
            <Card
              key={platform.id}
              className={`card-base overflow-hidden transition ${
                isConnected ? 'border-green-500/30 bg-green-500/5' : ''
              }`}
            >
              {/* Platform Header Gradient */}
              <div
                className={`h-1 bg-gradient-to-r ${platform.gradient}`}
              />

              <CardContent className="pt-6">
                {/* Platform Info */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition ${
                        isConnected
                          ? 'bg-green-500/20'
                          : hasOAuth
                            ? 'bg-gray-800'
                            : 'bg-gray-800/50'
                      }`}
                    >
                      <Icon
                        size={24}
                        className={
                          isConnected ? platform.color : hasOAuth ? 'text-gray-400' : 'text-gray-600'
                        }
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">
                        {platform.name}
                      </h3>
                      {isConnected && account ? (
                        <p className="text-sm text-green-400">
                          @{account.username}
                        </p>
                      ) : hasOAuth ? (
                        <p className="text-sm text-gray-500">
                          {platformDescription}
                        </p>
                      ) : (
                        <p className="text-sm text-amber-500">
                          {t('status.oauthNotConfigured')}
                        </p>
                      )}
                    </div>
                  </div>

                  {isConnected ? (
                    <Badge
                      variant="success"
                      className="flex items-center gap-1 bg-green-500/20 text-green-300 border-green-500/30"
                    >
                      <Check size={12} /> {t('status.connected')}
                    </Badge>
                  ) : hasOAuth ? (
                    <Badge className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border-blue-500/30">
                      {t('status.ready')}
                    </Badge>
                  ) : null}
                </div>

                {/* OAuth not configured info */}
                {!hasOAuth && !isConnected && (
                  <div className="mb-3 p-3 bg-amber-900/20 border border-amber-500/30 rounded-lg">
                    <p className="text-xs text-amber-300">
                      {t('oauthInfo', { platform: platform.name })}
                    </p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-2">
                  <Button
                    variant={isConnected ? 'ghost' : 'primary'}
                    className="w-full"
                    disabled={isConnecting || (!hasOAuth && !isConnected)}
                    onClick={() => handleConnect(platform.id)}
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 size={16} className="animate-spin mr-2" />
                        {t('actions.connecting')}
                      </>
                    ) : isConnected ? (
                      <>
                        <ExternalLink size={16} className="mr-2" />
                        {t('actions.reconnect')}
                      </>
                    ) : (
                      <>
                        <ExternalLink size={16} className="mr-2" />
                        {t('actions.connect', { platform: platform.name })}
                      </>
                    )}
                  </Button>

                  {isConnected && (
                    <Button
                      variant="ghost"
                      className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => handleDisconnect(platform.id)}
                    >
                      <X size={16} className="mr-2" />
                      {t('actions.disconnect')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Publishing Settings Section */}
      <Card className="border-studiio-primary/20">
        <CardHeader className="border-b border-gray-800">
          <CardTitle className="flex items-center gap-2">
            <Settings size={20} className="text-studiio-primary" />
            {t('settings.title')}
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-6">
          <div className="space-y-6">
            {/* Publication Automatique */}
            <div className="flex items-start gap-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700/30">
              <input
                type="checkbox"
                id="autoPublish"
                checked={settings.autoPublish}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    autoPublish: e.target.checked,
                  }))
                }
                className="w-4 h-4 mt-1 accent-studiio-primary cursor-pointer"
              />
              <div className="flex-1">
                <label
                  htmlFor="autoPublish"
                  className="font-medium text-white cursor-pointer block"
                >
                  {t('settings.autoPublish.title')}
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  {t('settings.autoPublish.description')}
                </p>
              </div>
            </div>

            {/* Meilleur Moment pour Publier */}
            <div className="flex items-start gap-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700/30">
              <input
                type="checkbox"
                id="bestTime"
                checked={settings.bestTimeToPublish}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    bestTimeToPublish: e.target.checked,
                  }))
                }
                className="w-4 h-4 mt-1 accent-studiio-primary cursor-pointer"
              />
              <div className="flex-1">
                <label
                  htmlFor="bestTime"
                  className="font-medium text-white cursor-pointer block"
                >
                  {t('settings.bestTime.title')}
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  {t('settings.bestTime.description')}
                </p>
              </div>
            </div>

            {/* Hashtags par défaut */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 font-medium text-white">
                <Hash size={16} className="text-studiio-primary" />
                {t('settings.defaultHashtags.title')}
              </label>
              <Input
                placeholder={t('settings.defaultHashtags.placeholder')}
                value={settings.defaultHashtags}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultHashtags: e.target.value,
                  }))
                }
                className="bg-gray-800/50 border-gray-700/50 text-white placeholder-gray-500"
              />
              <p className="text-xs text-gray-400">
                {t('settings.defaultHashtags.example')}
              </p>
            </div>

            {/* Description par défaut */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 font-medium text-white">
                <FileText size={16} className="text-studiio-primary" />
                {t('settings.defaultDescription.title')}
              </label>
              <textarea
                placeholder={t('settings.defaultDescription.placeholder')}
                value={settings.defaultDescription}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultDescription: e.target.value,
                  }))
                }
                rows={4}
                className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-studiio-primary/50 transition"
              />
              <p className="text-xs text-gray-400">
                {t('settings.defaultDescription.info')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

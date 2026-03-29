'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Instagram, Music, Facebook, Youtube, Check, Loader2, X, Calendar, Share2 } from 'lucide-react';

interface SocialAccount {
  id: string;
  platform: string;
  account_name: string;
  account_id: string;
  connected: boolean;
  created_at: string;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  timestamp: number;
}

const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', icon: Instagram, color: 'text-pink-400', description: 'Reels, Stories, Posts', oauthProvider: 'facebook' },
  { id: 'tiktok', name: 'TikTok', icon: Music, color: 'text-cyan-400', description: 'Vidéos courtes virales', oauthProvider: 'tiktok' },
  { id: 'facebook', name: 'Facebook', icon: Facebook, color: 'text-blue-400', description: 'Vidéos, Reels, Stories', oauthProvider: 'facebook' },
  { id: 'youtube', name: 'YouTube', icon: Youtube, color: 'text-red-400', description: 'Shorts, vidéos longues', oauthProvider: 'google' },
];

const OAUTH_URLS = {
  facebook: () => {
    const clientId = process.env.NEXT_PUBLIC_META_CLIENT_ID;
    if (!clientId) return null;
    const redirectUri = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/callback/facebook`;
    return `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=instagram_basic,instagram_content_publish,pages_read_engagement,pages_manage_metadata`;
  },
  tiktok: () => {
    const clientId = process.env.NEXT_PUBLIC_TIKTOK_CLIENT_ID;
    if (!clientId) return null;
    const redirectUri = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/callback/tiktok`;
    return `https://www.tiktok.com/v1/oauth/authorize?client_key=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user.info.basic,video.list`;
  },
  google: () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) return null;
    const redirectUri = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/callback/youtube`;
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/youtube.upload`;
  },
};

export default function SocialPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [_loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch('/api/social/accounts');
        const data = await res.json();
        if (data.success) {
          setAccounts(data.data || []);
        }
      } catch (error) {
        console.error('Error fetching social accounts:', error);
        showToast('Erreur lors du chargement des comptes', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchAccounts();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString();
    const toast: Toast = { id, message, type, timestamp: Date.now() };
    setToasts(prev => [...prev, toast]);

    // Auto-remove after 4 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getAccountForPlatform = (platformId: string) => {
    return accounts.find(a => a.platform === platformId && a.connected);
  };

  const handleConnect = async (platformId: string) => {
    try {
      setConnecting(platformId);

      const platform = PLATFORMS.find(p => p.id === platformId);
      if (!platform) {
        showToast('Plateforme non reconnue', 'error');
        return;
      }

      const oauthProvider = platform.oauthProvider as 'facebook' | 'tiktok' | 'google';
      const getOAuthUrl = OAUTH_URLS[oauthProvider];

      if (!getOAuthUrl) {
        showToast('Erreur de configuration OAuth', 'error');
        return;
      }

      const oauthUrl = getOAuthUrl();

      if (!oauthUrl) {
        showToast(
          `Configuration manquante: Variables d'environnement OAuth pour ${platform.name} non trouvées`,
          'error'
        );
        return;
      }

      // Open OAuth popup
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        oauthUrl,
        `oauth_${platformId}`,
        `width=${width},height=${height},left=${left},top=${top}`
      );

      if (!popup) {
        showToast('Les popups doivent être activées pour se connecter', 'error');
        return;
      }

      showToast(`Redirection vers ${platform.name}...`, 'info');

      // Poll for window closure to detect when OAuth completes
      const pollInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollInterval);
          setConnecting(null);
          // Refresh accounts after OAuth completes
          setTimeout(() => {
            fetch('/api/social/accounts')
              .then(res => res.json())
              .then(data => {
                if (data.success) {
                  setAccounts(data.data || []);
                  showToast(`Connexion à ${platform.name} réussie!`, 'success');
                }
              });
          }, 1000);
        }
      }, 500);

      // Clear interval after 5 minutes (safety timeout)
      setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
    } catch (error) {
      console.error('Error during OAuth connection:', error);
      showToast('Erreur lors de la connexion', 'error');
      setConnecting(null);
    }
  };

  const handleDisconnect = async (platformId: string) => {
    try {
      const platform = PLATFORMS.find(p => p.id === platformId);
      const response = await fetch(`/api/social/disconnect/${platformId}`, {
        method: 'POST',
      });

      const data = await response.json();
      if (data.success) {
        setAccounts(accounts.filter(a => a.platform !== platformId));
        showToast(`Déconnecté de ${platform?.name}`, 'success');
      } else {
        showToast('Erreur lors de la déconnexion', 'error');
      }
    } catch (error) {
      console.error('Error disconnecting account:', error);
      showToast('Erreur lors de la déconnexion', 'error');
    }
  };

  const connectedCount = PLATFORMS.filter(p => getAccountForPlatform(p.id)).length;

  return (
    <div className="space-y-8">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-lg shadow-lg flex items-start justify-between gap-3 animate-in fade-in slide-in-from-top-2 ${
              toast.type === 'success' ? 'bg-green-900/50 border border-green-500/50 text-green-100' :
              toast.type === 'error' ? 'bg-red-900/50 border border-red-500/50 text-red-100' :
              'bg-blue-900/50 border border-blue-500/50 text-blue-100'
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

      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Réseaux sociaux</h1>
        <p className="text-gray-400">
          Connectez vos comptes pour publier vos vidéos automatiquement
        </p>
      </div>

      {/* Connection status */}
      <Card className="border-studiio-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-studiio-primary/10 rounded-full flex items-center justify-center">
              <Share2 className="text-studiio-primary" size={24} />
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold">
                {connectedCount > 0
                  ? `${connectedCount} réseau${connectedCount > 1 ? 'x' : ''} connecté${connectedCount > 1 ? 's' : ''}`
                  : 'Aucun réseau connecté'}
              </p>
              <p className="text-sm text-gray-400">
                {connectedCount > 0
                  ? 'Vos vidéos peuvent être publiées automatiquement'
                  : 'Connectez au moins un réseau pour publier vos vidéos'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          const account = getAccountForPlatform(platform.id);
          const isConnecting = connecting === platform.id;

          return (
            <Card key={platform.id} className={account ? 'border-green-500/30' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      account ? 'bg-green-500/10' : 'bg-gray-800'
                    }`}>
                      <Icon size={24} className={account ? platform.color : 'text-gray-500'} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{platform.name}</h3>
                      {account ? (
                        <p className="text-sm text-green-400">@{account.account_name}</p>
                      ) : (
                        <p className="text-sm text-gray-500">{platform.description}</p>
                      )}
                    </div>
                  </div>
                  {account && (
                    <Badge variant="success">
                      <Check size={12} className="mr-1" /> Connecté
                    </Badge>
                  )}
                </div>

                <div className="space-y-2">
                  <Button
                    variant={account ? 'ghost' : 'primary'}
                    className="w-full"
                    disabled={isConnecting}
                    onClick={() => handleConnect(platform.id)}
                  >
                    {isConnecting ? (
                      <><Loader2 size={16} className="animate-spin mr-2 inline" /> Connexion...</>
                    ) : account ? (
                      <>Reconnecter</>
                    ) : (
                      <>Connecter {platform.name}</>
                    )}
                  </Button>
                  {account && (
                    <Button
                      variant="ghost"
                      className="w-full text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => handleDisconnect(platform.id)}
                    >
                      Déconnecter
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Publishing Settings */}
      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle className="flex items-center gap-2">
            <Calendar size={20} /> Paramètres de publication
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-xl cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4 accent-studiio-primary" defaultChecked />
              <div>
                <p className="font-medium text-white text-sm">Publication multi-réseaux</p>
                <p className="text-xs text-gray-400">Publiez automatiquement sur tous vos comptes connectés</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-xl cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4 accent-studiio-primary" />
              <div>
                <p className="font-medium text-white text-sm">Programmation intelligente</p>
                <p className="text-xs text-gray-400">L&apos;IA choisit l&apos;heure optimale de publication</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-4 bg-gray-800/50 rounded-xl cursor-pointer hover:bg-gray-800 transition">
              <input type="checkbox" className="w-4 h-4 accent-studiio-primary" defaultChecked />
              <div>
                <p className="font-medium text-white text-sm">Légendes IA</p>
                <p className="text-xs text-gray-400">Générez des légendes et hashtags adaptés à chaque plateforme</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

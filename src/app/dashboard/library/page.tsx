'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Play,
  Trash2,
  Download,
  Film,
  Loader2,
  Copy,
  Edit,
  Share2,
  MoreVertical,
  X,
} from 'lucide-react';
import Link from 'next/link';

interface Video {
  id: string;
  title: string;
  format: string;
  status: string;
  created_at: string;
  metadata?: {
    objective?: string;
    mode?: string;
    outputUrl?: string;
    posterUrl?: string;
  };
}

interface DeleteConfirmState {
  isOpen: boolean;
  videoId: string | null;
  videoTitle: string | null;
}

export default function LibraryPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    isOpen: false,
    videoId: null,
    videoTitle: null,
  });
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVideos() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '12' });
        const res = await fetch(`/api/videos?${params}`);
        const data = await res.json();
        if (data.success) {
          setVideos(data.data || []);
          setTotal(data.total || 0);
          setHasMore(data.hasMore || false);
        }
      } catch (error) {
        console.error('Error fetching videos:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchVideos();
  }, [page]);

  const filtered = videos.filter(
    (video) =>
      video.title.toLowerCase().includes(search.toLowerCase()) &&
      (!filterStatus || video.status === filterStatus)
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Terminée';
      case 'rendering':
        return 'Rendu en cours';
      case 'published':
        return 'Publiée';
      default:
        return 'Brouillon';
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success' as const;
      case 'rendering':
        return 'warning' as const;
      case 'published':
        return 'success' as const;
      default:
        return 'default' as const;
    }
  };

  const handleExport = async (videoId: string) => {
    setActionInProgress(`export-${videoId}`);
    try {
      // API call to export video
      const res = await fetch(`/api/videos/${videoId}/export`, { method: 'POST' });
      if (res.ok) {
        // Handle successful export
        console.log('Video exported');
      }
    } catch (error) {
      console.error('Error exporting video:', error);
    } finally {
      setActionInProgress(null);
      setOpenMenuId(null);
    }
  };

  const handleDuplicate = async (videoId: string) => {
    setActionInProgress(`duplicate-${videoId}`);
    try {
      const res = await fetch(`/api/videos/${videoId}/duplicate`, { method: 'POST' });
      if (res.ok) {
        // Refresh videos list
        const updatedRes = await fetch(`/api/videos?page=1&limit=12`);
        const data = await updatedRes.json();
        if (data.success) {
          setVideos(data.data || []);
          setPage(1);
        }
      }
    } catch (error) {
      console.error('Error duplicating video:', error);
    } finally {
      setActionInProgress(null);
      setOpenMenuId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm.videoId) return;

    setActionInProgress(`delete-${deleteConfirm.videoId}`);
    try {
      const res = await fetch(`/api/videos/${deleteConfirm.videoId}`, { method: 'DELETE' });
      if (res.ok) {
        // Remove video from list
        setVideos(videos.filter((v) => v.id !== deleteConfirm.videoId));
        setTotal(Math.max(0, total - 1));
      }
    } catch (error) {
      console.error('Error deleting video:', error);
    } finally {
      setActionInProgress(null);
      setDeleteConfirm({ isOpen: false, videoId: null, videoTitle: null });
      setOpenMenuId(null);
    }
  };

  const openDeleteDialog = (videoId: string, videoTitle: string) => {
    setDeleteConfirm({ isOpen: true, videoId, videoTitle });
    setOpenMenuId(null);
  };

  const closeDeleteDialog = () => {
    setDeleteConfirm({ isOpen: false, videoId: null, videoTitle: null });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Bibliothèque</h1>
          <p className="text-gray-400">
            {total > 0
              ? `${total} vidéo${total > 1 ? 's' : ''} créée${total > 1 ? 's' : ''}`
              : 'Gérez toutes vos vidéos créées'}
          </p>
        </div>
        <Link href="/dashboard/creator">
          <Button variant="primary" size="md">
            Créer une vidéo
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <Input
          placeholder="Rechercher une vidéo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select
          options={[
            { value: '', label: 'Tous les statuts' },
            { value: 'completed', label: 'Terminée' },
            { value: 'rendering', label: 'Rendu en cours' },
            { value: 'draft', label: 'Brouillon' },
            { value: 'published', label: 'Publiée' },
          ]}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        />
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-studiio-primary mr-3" size={24} />
          <span className="text-gray-400">Chargement...</span>
        </div>
      ) : filtered.length === 0 ? (
        /* Empty State */
        <div className="text-center py-16">
          <Film className="mx-auto text-gray-600 mb-4" size={64} />
          <h3 className="text-xl font-bold text-white mb-2">Aucune vidéo</h3>
          <p className="text-gray-400 mb-6">
            {search || filterStatus
              ? 'Aucune vidéo ne correspond à vos filtres'
              : 'Créez votre première vidéo pour la voir ici'}
          </p>
          {!search && !filterStatus && (
            <Link href="/dashboard/creator">
              <Button variant="primary" size="lg">
                Créer ma première vidéo
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Video Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((video) => (
              <div
                key={video.id}
                className="card-base overflow-hidden hover:border-studiio-primary/50 transition group flex flex-col"
              >
                {/* Thumbnail Area */}
                <div
                  className={`w-full bg-gray-800/50 flex items-center justify-center relative overflow-hidden group/thumbnail cursor-pointer transition ${
                    video.format === 'reel' ? 'aspect-[9/16] max-h-64' : 'aspect-video'
                  }`}
                  onClick={() => setPreviewVideo(video)}
                >
                  {/* Background poster if available */}
                  {video.metadata?.posterUrl && (
                    <img
                      src={video.metadata.posterUrl}
                      alt={video.title}
                      className="absolute inset-0 w-full h-full object-cover opacity-60"
                    />
                  )}

                  {/* Loading/Play Overlay */}
                  {video.status === 'rendering' ? (
                    <div className="flex flex-col items-center gap-2 z-10">
                      <Loader2 className="animate-spin text-studiio-accent" size={32} />
                      <span className="text-xs text-gray-300 font-medium">Rendu en cours</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center w-14 h-14 rounded-full bg-studiio-accent/20 group-hover/thumbnail:bg-studiio-accent/40 transition z-10">
                      <Play className="text-studiio-accent group-hover/thumbnail:scale-110 transition fill-current" size={32} />
                    </div>
                  )}
                </div>

                {/* Content Area */}
                <div className="p-4 space-y-3 flex-1 flex flex-col">
                  <div>
                    <p className="font-semibold text-white text-sm truncate">{video.title}</p>
                    <p className="text-xs text-gray-400">
                      {video.format === 'reel' ? 'Reel 9:16' : 'TV 16:9'} • {formatDate(video.created_at)}
                    </p>
                  </div>

                  <div className="flex justify-between items-center">
                    <Badge variant={getStatusVariant(video.status)}>
                      {getStatusLabel(video.status)}
                    </Badge>
                    {video.metadata?.objective && (
                      <span className="text-xs text-gray-500 capitalize">
                        {video.metadata.objective}
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2 border-t border-gray-800 mt-auto">
                    {/* Preview Button */}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPreviewVideo(video)}
                      disabled={actionInProgress !== null}
                      className="flex-1"
                    >
                      <Play size={14} className="mr-1" /> Aperçu
                    </Button>

                    {/* Menu Button */}
                    <div className="relative">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenMenuId(openMenuId === video.id ? null : video.id)}
                        disabled={actionInProgress !== null}
                      >
                        <MoreVertical size={16} />
                      </Button>

                      {/* Dropdown Menu */}
                      {openMenuId === video.id && (
                        <div className="absolute right-0 mt-1 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-lg z-20">
                          <button
                            onClick={() => handleExport(video.id)}
                            disabled={actionInProgress === `export-${video.id}`}
                            className="w-full px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-800 flex items-center gap-2 first:rounded-t-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {actionInProgress === `export-${video.id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Download size={14} />
                            )}
                            Exporter
                          </button>

                          <button
                            onClick={() => handleDuplicate(video.id)}
                            disabled={actionInProgress === `duplicate-${video.id}`}
                            className="w-full px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-800 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {actionInProgress === `duplicate-${video.id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Copy size={14} />
                            )}
                            Dupliquer
                          </button>

                          <Link href={`/dashboard/creator?id=${video.id}`}>
                            <button className="w-full px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-800 flex items-center gap-2 transition">
                              <Edit size={14} />
                              Modifier
                            </button>
                          </Link>

                          <button
                            onClick={() => {
                              // Re-publish functionality
                              handleExport(video.id);
                            }}
                            disabled={actionInProgress === `export-${video.id}`}
                            className="w-full px-4 py-2 text-sm text-left text-gray-200 hover:bg-gray-800 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            <Share2 size={14} />
                            Ré-publier
                          </button>

                          <button
                            onClick={() => openDeleteDialog(video.id, video.title)}
                            disabled={actionInProgress === `delete-${video.id}`}
                            className="w-full px-4 py-2 text-sm text-left text-red-400 hover:bg-red-900/20 flex items-center gap-2 last:rounded-b-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                          >
                            {actionInProgress === `delete-${video.id}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                            Supprimer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button variant="ghost" onClick={() => setPage((p) => p + 1)}>
                Charger plus
              </Button>
            </div>
          )}
        </>
      )}

      {/* Video Preview Modal */}
      {previewVideo && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreviewVideo(null)}>
          <div
            className="relative w-full max-w-2xl bg-gray-900 rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-white truncate">{previewVideo.title}</h2>
              <button
                onClick={() => setPreviewVideo(null)}
                className="text-gray-400 hover:text-white transition"
              >
                <X size={24} />
              </button>
            </div>

            {/* Video Player */}
            <div className="bg-black">
              {previewVideo.metadata?.outputUrl ? (
                <video
                  key={previewVideo.id}
                  controls
                  autoPlay
                  className="w-full h-auto max-h-96"
                  poster={previewVideo.metadata?.posterUrl}
                >
                  <source src={previewVideo.metadata.outputUrl} type="video/mp4" />
                  Votre navigateur ne supporte pas la lecture vidéo.
                </video>
              ) : previewVideo.status === 'rendering' ? (
                <div className="flex items-center justify-center w-full h-96 bg-gradient-to-b from-gray-800 to-black">
                  <div className="text-center">
                    <Loader2 className="animate-spin text-studiio-accent mx-auto mb-4" size={48} />
                    <p className="text-gray-300 font-medium">Rendu en cours...</p>
                    <p className="text-gray-500 text-sm mt-2">
                      La vidéo sera disponible à la fin du rendu
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center w-full h-96 bg-gradient-to-b from-gray-800 to-black">
                  <div className="text-center">
                    <Play className="text-gray-500 mx-auto mb-4" size={48} />
                    <p className="text-gray-400">Vidéo non disponible</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-800 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setPreviewVideo(null)}
                className="flex-1"
              >
                Fermer
              </Button>
              {previewVideo.metadata?.outputUrl && (
                <Button variant="primary" onClick={() => handleExport(previewVideo.id)}>
                  <Download size={16} className="mr-2" />
                  Télécharger
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-sm w-full border border-gray-800">
            <h3 className="text-lg font-semibold text-white mb-2">
              Supprimer la vidéo ?
            </h3>
            <p className="text-gray-400 mb-6">
              Êtes-vous sûr de vouloir supprimer <span className="font-semibold text-white">"{deleteConfirm.videoTitle}"</span> ?
              Cette action est irréversible.
            </p>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={closeDeleteDialog}
                disabled={actionInProgress !== null}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                onClick={handleDelete}
                disabled={actionInProgress !== null}
                className="flex-1"
              >
                {actionInProgress === `delete-${deleteConfirm.videoId}` && (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                )}
                Supprimer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

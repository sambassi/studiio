'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  Edit2,
  Copy,
  FileVideo,
  Eye,
  Move,
  Send,
  Trash2,
  Clock,
  Bot,
  Download,
  CheckSquare,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';

interface Post {
  id: string;
  title: string;
  caption: string;
  mediaUrl?: string;
  mediaType: 'video' | 'image';
  format: 'reel' | 'tv';
  platforms: string[];
  scheduledDate: string;
  scheduledTime: string;
  status: 'draft' | 'scheduled' | 'published';
}

const platformColors: Record<string, string> = {
  Instagram: 'bg-pink-500',
  TikTok: 'bg-black',
  Facebook: 'bg-blue-600',
  YouTube: 'bg-red-600',
};

const STORAGE_KEY = 'studiio_posts';

// Mock data with sample posts
const MOCK_POSTS: Post[] = [
  {
    id: '1',
    title: 'Tutoriel React Avancé',
    caption: 'Découvrez les dernières techniques React pour optimiser vos applications.',
    mediaUrl: 'https://media.w3.org/2016/12/sample_mpeg4.mp4',
    mediaType: 'video',
    format: 'reel',
    platforms: ['Instagram', 'TikTok'],
    scheduledDate: '2026-03-29',
    scheduledTime: '14:30',
    status: 'scheduled',
  },
  {
    id: '2',
    title: 'Design System Tips',
    caption: 'Les meilleures pratiques pour créer un design system scalable.',
    mediaUrl: 'https://media.w3.org/2016/12/sample_mpeg4.mp4',
    mediaType: 'video',
    format: 'tv',
    platforms: ['YouTube'],
    scheduledDate: '2026-03-29',
    scheduledTime: '18:00',
    status: 'draft',
  },
  {
    id: '3',
    title: 'Web Performance Guide',
    caption: 'Améliorez les performances de votre site web avec ces conseils.',
    mediaUrl: 'https://media.w3.org/2016/12/sample_mpeg4.mp4',
    mediaType: 'video',
    format: 'reel',
    platforms: ['Instagram'],
    scheduledDate: '2026-03-30',
    scheduledTime: '10:00',
    status: 'published',
  },
];

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date(2026, 2, 29)); // March 29, 2026
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [showAIAgent, setShowAIAgent] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // Edit modal state
  const [editTab, setEditTab] = useState<'draft' | 'scheduled' | 'published'>('draft');
  const [editFormData, setEditFormData] = useState<Partial<Post>>({
    platforms: [],
    status: 'draft',
  });

  // Load posts from localStorage or use mock data
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setPosts(JSON.parse(stored));
      } catch (error) {
        console.error('Failed to load posts:', error);
        setPosts(MOCK_POSTS);
      }
    } else {
      // Initialize with mock data
      setPosts(MOCK_POSTS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_POSTS));
    }
  }, []);

  // Save posts to localStorage
  useEffect(() => {
    if (posts.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    }
  }, [posts]);

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const getPostsForDay = (day: number): Post[] => {
    const dateStr = formatDateForStorage(currentDate, day);
    return posts.filter((post) => post.scheduledDate === dateStr);
  };

  const formatDateForStorage = (date: Date, day: number): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${month}-${dayStr}`;
  };

  const formatMonthYear = (date: Date): string => {
    return date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
    setSelectedDay(null);
  };

  const handleDayClick = (day: number) => {
    if (multiSelectMode) {
      const dayPosts = getPostsForDay(day);
      dayPosts.forEach((post) => {
        if (selectedPosts.has(post.id)) {
          selectedPosts.delete(post.id);
        } else {
          selectedPosts.add(post.id);
        }
      });
      setSelectedPosts(new Set(selectedPosts));
    } else {
      setSelectedDay(selectedDay === day ? null : day);
    }
  };

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
    setShowPreviewModal(true);
  };

  const handleEditPost = () => {
    if (selectedPost) {
      setEditFormData({ ...selectedPost });
      setEditTab(selectedPost.status as 'draft' | 'scheduled' | 'published');
      setShowEditModal(true);
      setShowPreviewModal(false);
    }
  };

  const handleDuplicatePost = () => {
    if (selectedPost) {
      const newPost: Post = {
        ...selectedPost,
        id: Math.random().toString(36).substr(2, 9),
      };
      setPosts([...posts, newPost]);
      setShowPreviewModal(false);
    }
  };

  const handleDeletePost = () => {
    if (selectedPost) {
      setPosts(posts.filter((p) => p.id !== selectedPost.id));
      setShowPreviewModal(false);
    }
  };

  const handleSavePost = () => {
    if (editFormData.id) {
      setPosts(posts.map((p) => (p.id === editFormData.id ? (editFormData as Post) : p)));
    } else {
      const newPost: Post = {
        title: editFormData.title || 'Nouveau post',
        caption: editFormData.caption || '',
        mediaUrl: editFormData.mediaUrl,
        mediaType: editFormData.mediaType || 'video',
        format: editFormData.format || 'reel',
        platforms: editFormData.platforms || [],
        scheduledDate: editFormData.scheduledDate || formatDateForStorage(new Date(), new Date().getDate()),
        scheduledTime: editFormData.scheduledTime || '12:00',
        status: editTab,
        id: Math.random().toString(36).substr(2, 9),
      };
      setPosts([...posts, newPost]);
    }
    setShowEditModal(false);
    setEditFormData({});
  };

  const handleNewPost = () => {
    setEditFormData({
      platforms: [],
      status: 'draft',
      format: 'reel',
      scheduledDate: selectedDay
        ? formatDateForStorage(currentDate, selectedDay)
        : formatDateForStorage(new Date(), new Date().getDate()),
      scheduledTime: '12:00',
      title: '',
      caption: '',
      mediaType: 'video',
    });
    setEditTab('draft');
    setShowEditModal(true);
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);

    // Simulate AI content generation
    setTimeout(() => {
      const generatedPost: Post = {
        id: Math.random().toString(36).substr(2, 9),
        title: aiPrompt.trim(),
        caption: `Contenu généré par l'IA: ${aiPrompt}`,
        mediaType: 'video',
        format: 'reel',
        platforms: ['Instagram', 'TikTok'],
        scheduledDate: selectedDay
          ? formatDateForStorage(currentDate, selectedDay)
          : formatDateForStorage(new Date(), new Date().getDate()),
        scheduledTime: '12:00',
        status: 'draft',
      };
      setPosts([...posts, generatedPost]);
      setAiGenerating(false);
      setAiPrompt('');
      setShowAIAgent(false);
    }, 1500);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,image/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event: any) => {
          const isVideo = file.type.startsWith('video/');
          setEditFormData({
            platforms: [],
            status: 'draft',
            format: 'reel',
            scheduledDate: selectedDay
              ? formatDateForStorage(currentDate, selectedDay)
              : formatDateForStorage(new Date(), new Date().getDate()),
            scheduledTime: '12:00',
            title: file.name.replace(/\.[^/.]+$/, ''),
            caption: '',
            mediaUrl: event.target.result,
            mediaType: isVideo ? 'video' : 'image',
          });
          setEditTab('draft');
          setShowEditModal(true);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const renderCalendarGrid = () => {
    const daysInMonth = getDaysInMonth(currentDate);
    const firstDay = getFirstDayOfMonth(currentDate);
    const days: React.ReactNode[] = [];

    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="aspect-square bg-gray-800 rounded-lg"></div>
      );
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayPosts = getPostsForDay(day);
      const isSelected = selectedDay === day;

      days.push(
        <div
          key={day}
          onClick={() => handleDayClick(day)}
          className={`aspect-square p-2 rounded-lg cursor-pointer transition-all ${
            isSelected
              ? 'bg-studiio-primary border-2 border-studiio-primary'
              : 'bg-gray-800 hover:bg-gray-700 border border-gray-700'
          }`}
        >
          <div className="text-sm font-medium text-white mb-1">{day}</div>
          <div className="flex gap-1 flex-wrap">
            {dayPosts.slice(0, 3).map((post) => (
              <div
                key={post.id}
                className={`w-2 h-2 rounded-full ${platformColors[post.platforms[0]] || 'bg-gray-400'}`}
              ></div>
            ))}
            {dayPosts.length > 3 && (
              <div className="text-xs text-gray-400">+{dayPosts.length - 3}</div>
            )}
          </div>
        </div>
      );
    }

    return days;
  };

  const selectedDayPosts = selectedDay ? getPostsForDay(selectedDay) : [];

  return (
    <div className="min-h-screen bg-studiio-dark p-6">
      <div className="flex gap-6 h-full max-h-[calc(100vh-48px)]">
        {/* Left: Calendar */}
        <div className="flex-1 flex flex-col">
          <Card className="p-6 flex flex-col h-full">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white capitalize">
                {formatMonthYear(currentDate)}
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePrevMonth}
                  className="text-gray-400 hover:text-white"
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNextMonth}
                  className="text-gray-400 hover:text-white"
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
                <div key={day} className="text-center text-gray-400 text-sm font-medium py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Days Grid */}
            <div className="grid grid-cols-7 gap-2 flex-1">
              {renderCalendarGrid()}
            </div>
          </Card>
        </div>

        {/* Right: Sidebar */}
        <div className="w-80 flex flex-col gap-4">
          {/* Selected Day Posts */}
          <Card className="p-4 flex-1 overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">
              {selectedDay
                ? `${selectedDay} ${formatMonthYear(currentDate)}`
                : 'Sélectionnez un jour'}
            </h3>

            <div className="space-y-3">
              {selectedDayPosts.length === 0 ? (
                <p className="text-gray-400 text-sm">Aucun post pour ce jour</p>
              ) : (
                selectedDayPosts.map((post) => (
                  <div
                    key={post.id}
                    className="card-base p-3 bg-gray-800 cursor-pointer hover:bg-gray-700 transition-colors"
                    onClick={() => handlePostClick(post)}
                  >
                    <div className="mb-2">
                      <p className="text-sm font-medium text-white truncate">{post.title}</p>
                      <div className="flex items-center gap-1 text-xs text-gray-400 mt-1">
                        <Clock className="w-3 h-3" />
                        <span>{post.scheduledTime}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap mb-2">
                      {post.platforms.map((platform) => (
                        <Badge
                          key={platform}
                          className={`${platformColors[platform]} text-white text-xs`}
                        >
                          {platform}
                        </Badge>
                      ))}
                    </div>
                    <Badge
                      className={
                        post.status === 'published'
                          ? 'bg-green-600'
                          : post.status === 'scheduled'
                            ? 'bg-blue-600'
                            : 'bg-gray-600'
                      }
                    >
                      {post.status === 'published'
                        ? 'Publié'
                        : post.status === 'scheduled'
                          ? 'Planifié'
                          : 'Brouillon'}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Action Buttons */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setShowAIAgent(true)}
              >
                <Bot className="w-4 h-4 mr-1" />
                Agent IA
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="flex-1 text-xs"
                onClick={handleImportClick}
              >
                <Download className="w-4 h-4 mr-1" />
                Importer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setMultiSelectMode(!multiSelectMode)}
              >
                <CheckSquare className="w-4 h-4 mr-1" />
                {multiSelectMode ? 'Annuler' : 'Sél. multiple'}
              </Button>
            </div>
            <Button
              className="w-full bg-studiio-primary hover:bg-studiio-primary/90 text-white"
              onClick={handleNewPost}
            >
              <Plus className="w-4 h-4 mr-2" />
              Nouveau Post
            </Button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        title="Aperçu du post"
        size="lg"
      >
        {selectedPost && (
          <div className="space-y-4">
            {/* Video Preview - BUG FIX 1: Proper sizing based on format */}
            {selectedPost.mediaUrl && (
              <div className="flex justify-center bg-black rounded-lg p-6">
                <div
                  className={`flex items-center justify-center ${
                    selectedPost.format === 'reel'
                      ? 'w-48 h-80'
                      : 'w-full max-w-2xl aspect-video'
                  }`}
                >
                  <video
                    src={selectedPost.mediaUrl}
                    controls
                    className="w-full h-full object-contain rounded"
                  />
                </div>
              </div>
            )}

            {/* Post Details */}
            <div>
              <h4 className="text-lg font-bold text-white mb-2">{selectedPost.title}</h4>
              <p className="text-gray-400 text-sm mb-3">{selectedPost.caption}</p>

              <div className="flex flex-wrap gap-2 mb-3">
                {selectedPost.platforms.map((platform) => (
                  <Badge
                    key={platform}
                    className={`${platformColors[platform]} text-white text-xs`}
                  >
                    {platform}
                  </Badge>
                ))}
                <Badge
                  className={
                    selectedPost.status === 'published'
                      ? 'bg-green-600'
                      : selectedPost.status === 'scheduled'
                        ? 'bg-blue-600'
                        : 'bg-gray-600'
                  }
                >
                  {selectedPost.status === 'published'
                    ? 'Publié'
                    : selectedPost.status === 'scheduled'
                      ? 'Planifié'
                      : 'Brouillon'}
                </Badge>
              </div>

              <div className="text-xs text-gray-400 mb-4 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>
                  {selectedPost.scheduledDate} à {selectedPost.scheduledTime}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white"
                onClick={handleEditPost}
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Modifier
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleDuplicatePost}
              >
                <Copy className="w-4 h-4 mr-2" />
                Dupliquer
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleDeletePost}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le Post"
        size="lg"
      >
        {/* BUG FIX 3: Discreet thin scrollbar with custom CSS class */}
        <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
          {/* Tabs */}
          <div className="flex gap-4 mb-6 border-b border-gray-700 pb-3">
            {['draft', 'scheduled', 'published'].map((tab) => (
              <button
                key={tab}
                onClick={() => setEditTab(tab as 'draft' | 'scheduled' | 'published')}
                className={`text-sm font-medium pb-2 transition-colors ${
                  editTab === tab
                    ? 'text-studiio-primary border-b-2 border-studiio-primary'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab === 'draft' ? 'Brouillon' : tab === 'scheduled' ? 'Planifié' : 'Publier'}
              </button>
            ))}
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Titre</label>
              <input
                type="text"
                value={editFormData.title || ''}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, title: e.target.value })
                }
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
                placeholder="Titre du post"
              />
            </div>

            {/* Caption */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Légende</label>
              <textarea
                value={editFormData.caption || ''}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, caption: e.target.value })
                }
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
                placeholder="Décrivez votre post..."
              />
            </div>

            {/* Social Networks */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Réseaux sociaux</label>
              <div className="flex flex-wrap gap-2">
                {['Instagram', 'TikTok', 'Facebook', 'YouTube'].map((platform) => (
                  <button
                    key={platform}
                    onClick={() => {
                      const platforms = editFormData.platforms || [];
                      if (platforms.includes(platform)) {
                        setEditFormData({
                          ...editFormData,
                          platforms: platforms.filter((p) => p !== platform),
                        });
                      } else {
                        setEditFormData({
                          ...editFormData,
                          platforms: [...platforms, platform],
                        });
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      editFormData.platforms?.includes(platform)
                        ? `${platformColors[platform]} text-white`
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            </div>

            {/* Media Upload - BUG FIX 2: Proper drag & drop support with import button */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Média</label>
              <div
                onClick={handleImportClick}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-studiio-primary');
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-studiio-primary');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-studiio-primary');
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith('video/')) {
                    const reader = new FileReader();
                    reader.onload = (event: any) => {
                      setEditFormData({
                        ...editFormData,
                        mediaUrl: event.target.result,
                        mediaType: 'video',
                      });
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center cursor-pointer hover:border-studiio-primary transition-colors"
              >
                {editFormData.mediaUrl ? (
                  <div className="text-white">
                    <FileVideo className="w-8 h-8 mx-auto mb-2 text-studiio-primary" />
                    <p className="text-sm font-medium">Vidéo ajoutée</p>
                    <p className="text-xs text-gray-400 mt-1">Cliquez pour changer</p>
                  </div>
                ) : (
                  <div className="text-gray-400">
                    <Upload className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Glissez-déposez une vidéo</p>
                    <p className="text-xs text-gray-400 mt-1">ou cliquez pour importer</p>
                  </div>
                )}
              </div>
            </div>

            {/* Format Selection */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">Format</label>
              <div className="flex gap-2">
                {['reel', 'tv'].map((format) => (
                  <button
                    key={format}
                    onClick={() =>
                      setEditFormData({ ...editFormData, format: format as 'reel' | 'tv' })
                    }
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      editFormData.format === format
                        ? 'bg-studiio-primary text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {format === 'reel' ? 'Reel (9:16)' : 'TV (16:9)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">Date</label>
                <input
                  type="date"
                  value={editFormData.scheduledDate || ''}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, scheduledDate: e.target.value })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-studiio-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">Heure</label>
                <input
                  type="time"
                  value={editFormData.scheduledTime || ''}
                  onChange={(e) =>
                    setEditFormData({ ...editFormData, scheduledTime: e.target.value })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-studiio-primary"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-gray-700">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowEditModal(false)}
            >
              Annuler
            </Button>
            <Button
              className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white"
              onClick={handleSavePost}
            >
              <Send className="w-4 h-4 mr-2" />
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Agent Modal */}
      <Modal
        isOpen={showAIAgent}
        onClose={() => setShowAIAgent(false)}
        title="Agent IA"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Décrivez le type de contenu que vous souhaitez créer et l'Agent IA générera un brouillon de post pour vous.
          </p>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Décrivez votre contenu
            </label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
              placeholder="Ex: Une vidéo motivante sur les bienfaits du sport matinal..."
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setShowAIAgent(false)}
            >
              Annuler
            </Button>
            <Button
              className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white"
              onClick={handleAIGenerate}
              disabled={aiGenerating || !aiPrompt.trim()}
            >
              {aiGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Génération...
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4 mr-2" />
                  Générer le post
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

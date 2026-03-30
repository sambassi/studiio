'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  media_url?: string;
  media_type: 'video' | 'image';
  format: 'reel' | 'tv';
  platforms: string[];
  scheduled_date: string;
  scheduled_time: string;
  status: 'draft' | 'scheduled' | 'published';
}

const platformColors: Record<string, string> = {
  Instagram: 'bg-pink-500',
  TikTok: 'bg-black',
  Facebook: 'bg-blue-600',
  YouTube: 'bg-red-600',
};

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedPosts, setSelectedPosts] = useState<Set<string>>(new Set());
  const [showAIAgent, setShowAIAgent] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit modal state
  const [editTab, setEditTab] = useState<'draft' | 'scheduled' | 'published'>('draft');
  const [editFormData, setEditFormData] = useState<Partial<Post>>({
    platforms: [],
    status: 'draft',
  });

  // Fetch posts from Supabase
  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/posts?month=${month}`);
      const data = await res.json();
      if (data.success && data.posts) {
        // Map DB fields to component fields
        const mapped = data.posts.map((p: any) => ({
          id: p.id,
          title: p.title,
          caption: p.caption,
          media_url: p.media_url,
          media_type: p.media_type,
          format: p.format,
          platforms: p.platforms || [],
          scheduled_date: p.scheduled_date,
          scheduled_time: p.scheduled_time,
          status: p.status,
        }));
        setPosts(mapped);
      }
    } catch (error) {
      console.error('Error fetching posts:', error);
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    const day = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    // Convert Sunday=0 to Monday-first (Mon=0, Sun=6)
    return day === 0 ? 6 : day - 1;
  };

  const getPostsForDay = (day: number): Post[] => {
    const dateStr = formatDateForStorage(currentDate, day);
    return posts.filter((post) => post.scheduled_date === dateStr);
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
      const newSelected = new Set(selectedPosts);
      dayPosts.forEach((post) => {
        if (newSelected.has(post.id)) {
          newSelected.delete(post.id);
        } else {
          newSelected.add(post.id);
        }
      });
      setSelectedPosts(newSelected);
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

  const handleDuplicatePost = async () => {
    if (!selectedPost) return;
    setSaving(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedPost.title,
          caption: selectedPost.caption,
          media_url: selectedPost.media_url,
          media_type: selectedPost.media_type,
          format: selectedPost.format,
          platforms: selectedPost.platforms,
          scheduled_date: selectedPost.scheduled_date,
          scheduled_time: selectedPost.scheduled_time,
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchPosts();
      }
    } catch (error) {
      console.error('Error duplicating post:', error);
    } finally {
      setSaving(false);
      setShowPreviewModal(false);
    }
  };

  const handleDeletePost = async () => {
    if (!selectedPost) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/posts?id=${selectedPost.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPosts(posts.filter((p) => p.id !== selectedPost.id));
      }
    } catch (error) {
      console.error('Error deleting post:', error);
    } finally {
      setSaving(false);
      setShowPreviewModal(false);
    }
  };

  const handleSavePost = async () => {
    setSaving(true);
    try {
      if (editFormData.id) {
        // Update existing post
        const res = await fetch('/api/posts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editFormData.id,
            title: editFormData.title,
            caption: editFormData.caption,
            media_url: editFormData.media_url,
            media_type: editFormData.media_type,
            format: editFormData.format,
            platforms: editFormData.platforms,
            scheduled_date: editFormData.scheduled_date,
            scheduled_time: editFormData.scheduled_time,
            status: editTab,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchPosts();
        }
      } else {
        // Create new post
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: editFormData.title || 'Nouveau post',
            caption: editFormData.caption || '',
            media_url: editFormData.media_url,
            media_type: editFormData.media_type || 'video',
            format: editFormData.format || 'reel',
            platforms: editFormData.platforms || [],
            scheduled_date: editFormData.scheduled_date || formatDateForStorage(new Date(), new Date().getDate()),
            scheduled_time: editFormData.scheduled_time || '12:00',
            status: editTab,
          }),
        });
        const data = await res.json();
        if (data.success) {
          await fetchPosts();
        }
      }
    } catch (error) {
      console.error('Error saving post:', error);
    } finally {
      setSaving(false);
      setShowEditModal(false);
      setEditFormData({});
    }
  };

  const handleNewPost = () => {
    setEditFormData({
      platforms: [],
      status: 'draft',
      format: 'reel',
      scheduled_date: selectedDay
        ? formatDateForStorage(currentDate, selectedDay)
        : formatDateForStorage(new Date(), new Date().getDate()),
      scheduled_time: '12:00',
      title: '',
      caption: '',
      media_type: 'video',
    });
    setEditTab('draft');
    setShowEditModal(true);
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: aiPrompt.trim(),
          caption: `Contenu genere par l'IA: ${aiPrompt}`,
          media_type: 'video',
          format: 'reel',
          platforms: ['Instagram', 'TikTok'],
          scheduled_date: selectedDay
            ? formatDateForStorage(currentDate, selectedDay)
            : formatDateForStorage(new Date(), new Date().getDate()),
          scheduled_time: '12:00',
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchPosts();
      }
    } catch (error) {
      console.error('Error generating AI post:', error);
    } finally {
      setAiGenerating(false);
      setAiPrompt('');
      setShowAIAgent(false);
    }
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
            scheduled_date: selectedDay
              ? formatDateForStorage(currentDate, selectedDay)
              : formatDateForStorage(new Date(), new Date().getDate()),
            scheduled_time: '12:00',
            title: file.name.replace(/\.[^/.]+$/, ''),
            caption: '',
            media_url: event.target.result,
            media_type: isVideo ? 'video' : 'image',
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
    const today = new Date();
    const isCurrentMonth =
      today.getFullYear() === currentDate.getFullYear() &&
      today.getMonth() === currentDate.getMonth();

    for (let i = 0; i < firstDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="aspect-square bg-gray-800 rounded-lg"></div>
      );
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayPosts = getPostsForDay(day);
      const isSelected = selectedDay === day;
      const isToday = isCurrentMonth && today.getDate() === day;

      days.push(
        <div
          key={day}
          onClick={() => handleDayClick(day)}
          className={`aspect-square p-2 rounded-lg cursor-pointer transition-all ${
            isSelected
              ? 'bg-studiio-primary border-2 border-studiio-primary'
              : isToday
              ? 'bg-gray-700 border-2 border-studiio-accent'
              : 'bg-gray-800 hover:bg-gray-700 border border-gray-700'
          }`}
        >
          <div className={`text-sm font-medium mb-1 ${isToday ? 'text-studiio-accent' : 'text-white'}`}>{day}</div>
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
                <Button variant="ghost" size="sm" onClick={handlePrevMonth} className="text-gray-400 hover:text-white">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={handleNextMonth} className="text-gray-400 hover:text-white">
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
              {loading ? (
                <div className="col-span-7 flex items-center justify-center py-16">
                  <Loader2 className="animate-spin text-studiio-primary mr-2" size={20} />
                  <span className="text-gray-400 text-sm">Chargement...</span>
                </div>
              ) : (
                renderCalendarGrid()
              )}
            </div>
          </Card>
        </div>

        {/* Right: Sidebar */}
        <div className="w-80 flex flex-col gap-4">
          <Card className="p-4 flex-1 overflow-y-auto">
            <h3 className="text-lg font-bold text-white mb-4">
              {selectedDay
                ? `${selectedDay} ${formatMonthYear(currentDate)}`
                : 'Selectionnez un jour'}
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
                        <span>{post.scheduled_time}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap mb-2">
                      {post.platforms.map((platform) => (
                        <Badge key={platform} className={`${platformColors[platform]} text-white text-xs`}>
                          {platform}
                        </Badge>
                      ))}
                    </div>
                    <Badge
                      className={
                        post.status === 'published' ? 'bg-green-600'
                          : post.status === 'scheduled' ? 'bg-blue-600'
                          : 'bg-gray-600'
                      }
                    >
                      {post.status === 'published' ? 'Publie'
                        : post.status === 'scheduled' ? 'Planifie'
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
              <Button variant="secondary" size="sm" className="flex-1 text-xs" onClick={() => setShowAIAgent(true)}>
                <Bot className="w-4 h-4 mr-1" />
                Agent IA
              </Button>
              <Button variant="secondary" size="sm" className="flex-1 text-xs" onClick={handleImportClick}>
                <Download className="w-4 h-4 mr-1" />
                Importer
              </Button>
              <Button variant="secondary" size="sm" className="flex-1 text-xs" onClick={() => setMultiSelectMode(!multiSelectMode)}>
                <CheckSquare className="w-4 h-4 mr-1" />
                {multiSelectMode ? 'Annuler' : 'Sel. multiple'}
              </Button>
            </div>
            <Button className="w-full bg-studiio-primary hover:bg-studiio-primary/90 text-white" onClick={handleNewPost}>
              <Plus className="w-4 h-4 mr-2" />
              Nouveau Post
            </Button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <Modal isOpen={showPreviewModal} onClose={() => setShowPreviewModal(false)} title="Apercu du post" size="lg">
        {selectedPost && (
          <div className="space-y-4">
            {selectedPost.media_url && (
              <div className="flex justify-center bg-black rounded-lg p-4">
                <div className={`flex items-center justify-center ${
                  selectedPost.format === 'reel'
                    ? 'w-64 aspect-[9/16] max-h-[60vh]'
                    : 'w-full max-w-2xl aspect-video max-h-[50vh]'
                }`}>
                  {selectedPost.media_type === 'video' ? (
                    <video src={selectedPost.media_url} controls className="w-full h-full object-contain rounded" />
                  ) : (
                    <img src={selectedPost.media_url} alt={selectedPost.title} className="w-full h-full object-contain rounded" />
                  )}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-lg font-bold text-white mb-2">{selectedPost.title}</h4>
              <p className="text-gray-400 text-sm mb-3">{selectedPost.caption}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedPost.platforms.map((platform) => (
                  <Badge key={platform} className={`${platformColors[platform]} text-white text-xs`}>{platform}</Badge>
                ))}
                <Badge className={
                  selectedPost.status === 'published' ? 'bg-green-600'
                    : selectedPost.status === 'scheduled' ? 'bg-blue-600'
                    : 'bg-gray-600'
                }>
                  {selectedPost.status === 'published' ? 'Publie'
                    : selectedPost.status === 'scheduled' ? 'Planifie'
                    : 'Brouillon'}
                </Badge>
              </div>
              <div className="text-xs text-gray-400 mb-4 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{selectedPost.scheduled_date} a {selectedPost.scheduled_time}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <Button className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white" onClick={handleEditPost}>
                <Edit2 className="w-4 h-4 mr-2" />
                Modifier
              </Button>
              <Button variant="secondary" className="flex-1" onClick={handleDuplicatePost} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Copy className="w-4 h-4 mr-2" />}
                Dupliquer
              </Button>
              <Button variant="secondary" className="flex-1" onClick={handleDeletePost} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Supprimer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={showEditModal} onClose={() => setShowEditModal(false)} title="Modifier le Post" size="lg">
        <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-700/50 [&::-webkit-scrollbar-thumb]:rounded-full">
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
                {tab === 'draft' ? 'Brouillon' : tab === 'scheduled' ? 'Planifie' : 'Publier'}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">Titre</label>
              <input
                type="text"
                value={editFormData.title || ''}
                onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
                placeholder="Titre du post"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-2">Legende</label>
              <textarea
                value={editFormData.caption || ''}
                onChange={(e) => setEditFormData({ ...editFormData, caption: e.target.value })}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
                placeholder="Decrivez votre post..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-2">Reseaux sociaux</label>
              <div className="flex flex-wrap gap-2">
                {['Instagram', 'TikTok', 'Facebook', 'YouTube'].map((platform) => (
                  <button
                    key={platform}
                    onClick={() => {
                      const platforms = editFormData.platforms || [];
                      if (platforms.includes(platform)) {
                        setEditFormData({ ...editFormData, platforms: platforms.filter((p) => p !== platform) });
                      } else {
                        setEditFormData({ ...editFormData, platforms: [...platforms, platform] });
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

            <div>
              <label className="block text-sm font-medium text-white mb-2">Media</label>
              <div
                onClick={handleImportClick}
                className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center cursor-pointer hover:border-studiio-primary transition-colors"
              >
                {editFormData.media_url ? (
                  <div className="text-white">
                    <FileVideo className="w-8 h-8 mx-auto mb-2 text-studiio-primary" />
                    <p className="text-sm font-medium">Media ajoute</p>
                    <p className="text-xs text-gray-400 mt-1">Cliquez pour changer</p>
                  </div>
                ) : (
                  <div className="text-gray-400">
                    <Upload className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Glissez-deposez un fichier</p>
                    <p className="text-xs text-gray-400 mt-1">ou cliquez pour importer</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-2">Format</label>
              <div className="flex gap-2">
                {['reel', 'tv'].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setEditFormData({ ...editFormData, format: fmt as 'reel' | 'tv' })}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      editFormData.format === fmt
                        ? 'bg-studiio-primary text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {fmt === 'reel' ? 'Reel (9:16)' : 'TV (16:9)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-2">Date</label>
                <input
                  type="date"
                  value={editFormData.scheduled_date || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, scheduled_date: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-studiio-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-2">Heure</label>
                <input
                  type="time"
                  value={editFormData.scheduled_time || ''}
                  onChange={(e) => setEditFormData({ ...editFormData, scheduled_time: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-studiio-primary"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t border-gray-700">
            <Button variant="secondary" className="flex-1" onClick={() => setShowEditModal(false)}>
              Annuler
            </Button>
            <Button
              className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white"
              onClick={handleSavePost}
              disabled={saving}
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Enregistrer
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Agent Modal */}
      <Modal isOpen={showAIAgent} onClose={() => setShowAIAgent(false)} title="Agent IA" size="lg">
        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Decrivez le type de contenu que vous souhaitez creer et l'Agent IA generera un brouillon de post pour vous.
          </p>
          <div>
            <label className="block text-sm font-medium text-white mb-2">Decrivez votre contenu</label>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-studiio-primary"
              placeholder="Ex: Une video motivante sur les bienfaits du sport matinal..."
            />
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setShowAIAgent(false)}>
              Annuler
            </Button>
            <Button
              className="flex-1 bg-studiio-primary hover:bg-studiio-primary/90 text-white"
              onClick={handleAIGenerate}
              disabled={aiGenerating || !aiPrompt.trim()}
            >
              {aiGenerating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generation...</>
              ) : (
                <><Bot className="w-4 h-4 mr-2" />Generer le post</>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

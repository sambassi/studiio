'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'studiio_chat_history';
const OPENED_KEY = 'studiio_chat_opened';

const POS_KEY = 'studiio_chat_button_pos';

export function StudiioAssistant() {
  const pathname = usePathname();
  const t = useTranslations('assistant');
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Drag state (mobile only)
  const [btnPos, setBtnPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const isMobileRef = useRef(false);

  // Load drag position
  useEffect(() => {
    isMobileRef.current = window.innerWidth < 1024;
    try {
      const saved = localStorage.getItem(POS_KEY);
      if (saved) setBtnPos(JSON.parse(saved));
    } catch {}
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth >= 1024 || open) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setIsDragging(false);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [open]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current || window.innerWidth >= 1024 || open) return;
    const dx = Math.abs(e.clientX - dragStart.current.x);
    const dy = Math.abs(e.clientY - dragStart.current.y);
    if (dx > 5 || dy > 5) setIsDragging(true);
    if (dx > 5 || dy > 5) setBtnPos({ x: e.clientX - 28, y: e.clientY - 28 });
  }, [open]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (window.innerWidth >= 1024 || open) { dragStart.current = null; return; }
    const wasDrag = isDragging;
    if (wasDrag && btnPos) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const snappedX = btnPos.x < w / 2 ? 16 : w - 72;
      const clampedY = Math.max(80, Math.min(btnPos.y, h - 80));
      const finalPos = { x: snappedX, y: clampedY };
      setBtnPos(finalPos);
      try { localStorage.setItem(POS_KEY, JSON.stringify(finalPos)); } catch {}
    }
    setIsDragging(false);
    dragStart.current = null;
    if (!wasDrag) handleOpen();
  }, [isDragging, btnPos, open]);

  // Load history + opened flag + guided onboarding
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
      setHasOpened(localStorage.getItem(OPENED_KEY) === 'true');

      // Auto-open for guided onboarding (?guided=true from signup)
      const guided = localStorage.getItem('studiio_guided_onboarding');
      if (guided === 'true') {
        localStorage.removeItem('studiio_guided_onboarding');
        setOpen(true);
        setHasOpened(true);
        localStorage.setItem(OPENED_KEY, 'true');
        setMessages([{ role: 'assistant', content: 'Bienvenue sur Studiio ! 🎉 Je suis là pour te guider. Veux-tu que je t\'explique comment créer ta première vidéo ?' }]);
      }
    } catch {}
  }, []);

  // Save history
  useEffect(() => {
    if (messages.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {}
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleOpen = () => {
    setOpen(true);
    if (!hasOpened) {
      setHasOpened(true);
      try { localStorage.setItem(OPENED_KEY, 'true'); } catch {}
    }
    if (messages.length === 0) {
      setMessages([{ role: 'assistant', content: t('greeting') }]);
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const locale = pathname?.includes('/en') ? 'en' : pathname?.includes('/de') ? 'de' : 'fr';
      const res = await fetch('/api/chat/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated, locale }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages([...updated, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages([...updated, { role: 'assistant', content: t('error') }]);
      }
    } catch {
      setMessages([...updated, { role: 'assistant', content: t('error') }]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading, pathname, t]);

  // Only show on dashboard routes
  if (!pathname?.startsWith('/dashboard')) return null;

  return (
    <>
      {/* Floating button — draggable on mobile */}
      {!open && (
        <button
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onClick={() => { if (isDragging) return; if (!btnPos) handleOpen(); }}
          className={`fixed z-40 h-14 w-14 rounded-full bg-gradient-to-br from-purple-600 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all flex items-center justify-center ${isDragging ? 'ring-4 ring-purple-400/50 scale-105' : 'hover:scale-110'} ${!btnPos ? 'bottom-4 right-4' : 'lg:bottom-4 lg:right-4'}`}
          style={btnPos ? { left: btnPos.x, top: btnPos.y, bottom: 'auto', right: 'auto', touchAction: 'none' } : { touchAction: 'none' }}
          title={t('title')}
        >
          <MessageCircle size={24} />
          {!hasOpened && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 border-2 border-gray-900 animate-pulse" />
          )}
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-0 right-0 sm:bottom-4 sm:right-4 z-50 w-full h-full sm:w-[400px] sm:h-[600px] flex flex-col bg-gray-900/95 backdrop-blur-xl sm:border border-purple-500/30 sm:rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
                <MessageCircle size={14} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">{t('title')}</p>
                <p className="text-[10px] text-green-400">En ligne</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white rounded-br-md'
                    : 'bg-gray-800 text-gray-200 rounded-bl-md'
                }`}>
                  {msg.content.split('\n').map((line, j) => (
                    <p key={j} className={j > 0 ? 'mt-1.5' : ''}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-gray-400 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  {t('thinking')}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-800 bg-gray-900/80">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder={t('placeholder')}
                className="flex-1 rounded-xl bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none resize-none max-h-24"
                rows={1}
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className="h-9 w-9 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center disabled:opacity-50 transition flex-shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  ArrowRight, Zap, Sparkles, BarChart3, Play, Check, Star,
  Video, Calendar, Share2, Target, Palette, Globe, Shield,
  ChevronDown, ChevronUp, Users, TrendingUp, Clock, Award,
  Smartphone, Monitor, Instagram, Youtube, Facebook, Music,
} from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { LanguageSelector } from '@/components/LanguageSelector';

// Dynamic content from admin CMS
interface DynamicContent {
  hero?: { badge?: string; title?: string; subtitle?: string; cta1?: string; cta2?: string; socialProof1?: string; socialProof2?: string; socialProof3?: string; demoVideoUrl?: string };
  features?: Array<{ title: string; desc: string; iconName?: string; color?: string }>;
  testimonials?: Array<{ name: string; role: string; text: string; stars: number; avatar: string }>;
  howItWorks?: Array<{ step: string; title: string; desc: string }>;
  faq?: Array<{ q: string; a: string }>;
  stats?: Array<{ value: string; label: string }>;
  plans?: Array<{ name: string; price: string; yearlyPrice: string; desc: string; credits: number; features: string[]; cta: string; popular: boolean }>;
  footer?: { description?: string; copyright?: string };
  cta?: { title?: string; subtitle?: string; button?: string; reassurance?: string };
}

/* ═══════════════════════════════════════════════════════
   STUDIIO — Landing Page de vente
   Objectif : convertir les visiteurs en utilisateurs payants
   ═══════════════════════════════════════════════════════ */

const FEATURE_ICONS = [Video, Sparkles, Calendar, Share2, Target, BarChart3];
const FEATURE_COLORS = [
  "from-violet-500 to-purple-600",
  "from-pink-500 to-rose-600",
  "from-blue-500 to-cyan-600",
  "from-green-500 to-emerald-600",
  "from-orange-500 to-amber-600",
  "from-indigo-500 to-violet-600",
];

const FORMAT_ICONS = [Smartphone, Monitor, Palette, Zap];

const SOCIAL_NETWORKS = [
  { name: "Instagram", icon: Instagram, color: "#E1306C" },
  { name: "TikTok", icon: Music, color: "#00F2EA" },
  { name: "YouTube", icon: Youtube, color: "#FF0000" },
  { name: "Facebook", icon: Facebook, color: "#1877F2" },
];

const STAT_ICONS = [Video, Users, Star, Clock];
const STAT_VALUES = ["50K+", "12K+", "98%", "<60s"];

const PLAN_DEFAULTS = [
  { credits: 300, popular: false, color: "border-gray-700 hover:border-violet-500" },
  { credits: 1000, popular: true, color: "border-violet-500 border-2" },
  { credits: 5000, popular: false, color: "border-gray-700 hover:border-violet-500" },
];

const PLAN_KEYS = ['starter', 'pro', 'enterprise'] as const;

// ── Composants ──

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-900/50 transition"
      >
        <span className="font-semibold text-white text-base pr-4">{q}</span>
        {open ? <ChevronUp size={20} className="text-violet-400 shrink-0" /> : <ChevronDown size={20} className="text-gray-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 text-gray-400 leading-relaxed text-sm animate-slide-in">
          {a}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ── PAGE PRINCIPALE ──
// ═══════════════════════════════════════════════════════

export default function LandingPage() {
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');
  const [cms, setCms] = useState<DynamicContent>({});

  // Fetch CMS content from admin panel (non-blocking, merges with defaults)
  useEffect(() => {
    fetch('/api/admin/landing')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.content) setCms(data.content); })
      .catch(() => {}); // Silently fail — defaults will be used
  }, []);

  // Merge helpers: CMS overrides defaults
  const hero = cms.hero || {};
  const cmsFeatures = cms.features;
  const cmsTestimonials = cms.testimonials;
  const cmsHowItWorks = cms.howItWorks;
  const cmsFaq = cms.faq;
  const cmsStats = cms.stats;
  const cmsPlans = cms.plans;
  const cmsFooter = cms.footer || {};
  const cmsCta = cms.cta || {};

  // Build translated arrays
  const FEATURES = Array.from({ length: 6 }, (_, i) => ({
    icon: FEATURE_ICONS[i],
    title: t(`features.items.${i}.title`),
    desc: t(`features.items.${i}.desc`),
    color: FEATURE_COLORS[i],
  }));

  const FORMATS = [
    { label: t('formats.reel.label'), desc: t('formats.reel.desc'), icon: FORMAT_ICONS[0] },
    { label: t('formats.tv.label'), desc: t('formats.tv.desc'), icon: FORMAT_ICONS[1] },
    { label: t('formats.infographic.label'), desc: t('formats.infographic.desc'), icon: FORMAT_ICONS[2] },
    { label: t('formats.batch.label'), desc: t('formats.batch.desc'), icon: FORMAT_ICONS[3] },
  ];

  const STATS = STAT_VALUES.map((value, i) => ({
    value,
    label: t(`stats.${['videosCreated', 'activeCreators', 'customerSatisfaction', 'renderTime'][i]}`),
    icon: STAT_ICONS[i],
  }));

  const HOW_IT_WORKS = Array.from({ length: 4 }, (_, i) => ({
    step: t(`howItWorks.steps.${i}.step`),
    title: t(`howItWorks.steps.${i}.title`),
    desc: t(`howItWorks.steps.${i}.desc`),
  }));

  const TESTIMONIALS = Array.from({ length: 3 }, (_, i) => ({
    name: t(`testimonials.items.${i}.name`),
    role: t(`testimonials.items.${i}.role`),
    text: t(`testimonials.items.${i}.text`),
    stars: 5,
    avatar: t(`testimonials.items.${i}.name`).charAt(0),
  }));

  const FAQ_DATA = Array.from({ length: 6 }, (_, i) => ({
    q: t(`faq.items.${i}.q`),
    a: t(`faq.items.${i}.a`),
  }));

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white overflow-x-hidden">

      {/* ══════════════════════════════════════════════
          NAVIGATION
          ══════════════════════════════════════════════ */}
      <nav className="fixed w-full bg-[#0A0A0F]/80 backdrop-blur-xl border-b border-gray-800/50 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center font-black text-sm">S</div>
              <span className="text-xl font-black tracking-tight">Studiio</span>
            </div>
            <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
              <a href="#features" className="hover:text-white transition">{t('nav.features')}</a>
              <a href="#how" className="hover:text-white transition">{t('nav.howItWorks')}</a>
              <a href="#pricing" className="hover:text-white transition">{t('nav.pricing')}</a>
              <a href="#faq" className="hover:text-white transition">{t('nav.faq')}</a>
            </div>
            <div className="flex items-center gap-3">
              {/* Language Selector */}
              <div className="hidden sm:block">
                <LanguageSelector variant="navbar" />
              </div>
              <Link href="/auth/login" className="text-sm text-gray-300 hover:text-white transition hidden sm:block">
                {t('nav.login')}
              </Link>
              <Link href="/auth/signup" className="bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-5 py-2 rounded-lg text-white text-sm font-bold transition shadow-lg shadow-violet-500/20">
                {t('nav.freeTrial')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ══════════════════════════════════════════════
          HERO
          ══════════════════════════════════════════════ */}
      <section className="relative pt-28 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-violet-600/8 blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] rounded-full bg-pink-600/5 blur-3xl pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-8">
            <Sparkles size={14} className="text-violet-400" />
            <span className="text-xs font-semibold text-violet-300 tracking-wide">{hero.badge || t('hero.badge')}</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-black mb-6 leading-[1.1] tracking-tight">
            {hero.title ? (
              <span dangerouslySetInnerHTML={{ __html: hero.title.replace(/\*(.*?)\*/g, '<span class="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-pink-400 to-violet-400">$1</span>') }} />
            ) : (
              <>{t('hero.titlePart1')}{' '}<span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-pink-400 to-violet-400">{t('hero.titleHighlight')}</span><br />{t('hero.titlePart2')}</>
            )}
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            {hero.subtitle || <>{t('hero.subtitle')} <strong className="text-gray-200">{t('hero.subtitleBold')}</strong>.</>}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link href="/auth/signup" className="group bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-8 py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/40">
              {hero.cta1 || t('hero.cta1')}
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            {hero.demoVideoUrl ? (
              <a href={hero.demoVideoUrl} target="_blank" rel="noopener noreferrer" className="border border-gray-700 hover:border-gray-500 hover:bg-white/5 px-8 py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition">
                <Play size={20} className="text-violet-400" />
                {hero.cta2 || t('hero.cta2')}
              </a>
            ) : (
              <button className="border border-gray-700 hover:border-gray-500 hover:bg-white/5 px-8 py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition">
                <Play size={20} className="text-violet-400" />
                {hero.cta2 || t('hero.cta2')}
              </button>
            )}
          </div>

          {/* Social proof */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            <div className="flex -space-x-2">
              {['S', 'M', 'A', 'L', 'K'].map((l, i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 border-2 border-[#0A0A0F] flex items-center justify-center text-xs font-bold text-white">
                  {l}
                </div>
              ))}
            </div>
            <span>{t('hero.socialProofJoinedBy')} <strong className="text-white">{hero.socialProof1 || '12 000+'}</strong> {t('hero.socialProofCreators')}</span>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map(i => <Star key={i} size={14} className="text-yellow-500 fill-yellow-500" />)}
              <span className="ml-1">{hero.socialProof3 || '4.9/5'}</span>
            </div>
          </div>
        </div>

        {/* Hero mockup */}
        <div className="max-w-5xl mx-auto mt-16 relative">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl shadow-violet-500/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 bg-gray-900/80">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="text-xs text-gray-500 ml-2">{t('heroMockup.studioTitle')}</span>
            </div>
            {hero.demoVideoUrl ? (
              <div className="aspect-[16/9]">
                <video src={hero.demoVideoUrl} controls className="w-full h-full object-cover" poster="" />
              </div>
            ) : (
              <div className="aspect-[16/9] bg-gradient-to-br from-gray-900 via-[#0d0d15] to-gray-900 flex items-center justify-center relative">
                <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-pink-600/5" />
                <div className="text-center z-10">
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
                      <Video size={24} />
                    </div>
                  </div>
                  <p className="text-2xl font-black mb-2">{t('heroMockup.readyToCreate')}</p>
                  <p className="text-gray-500 text-sm">{t('heroMockup.formatInfo')}</p>
                  <div className="flex gap-3 justify-center mt-6">
                    <div className="px-4 py-2 bg-violet-600/20 border border-violet-500/30 rounded-lg text-violet-300 text-xs font-bold">REEL 9:16</div>
                    <div className="px-4 py-2 bg-gray-800/50 border border-gray-700/30 rounded-lg text-gray-500 text-xs font-bold">TV 16:9</div>
                    <div className="px-4 py-2 bg-gray-800/50 border border-gray-700/30 rounded-lg text-gray-500 text-xs font-bold">BATCH x10</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Floating elements */}
          <div className="absolute -right-4 top-1/4 bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl hidden lg:block">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center"><Check size={12} className="text-green-400" /></div>
              <span className="text-gray-300 font-medium">{t('heroMockup.renderDone')}</span>
            </div>
          </div>
          <div className="absolute -left-4 bottom-1/4 bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl hidden lg:block">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center"><TrendingUp size={12} className="text-violet-400" /></div>
              <span className="text-gray-300 font-medium">{t('heroMockup.engagement')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          STATS BAR
          ══════════════════════════════════════════════ */}
      <section className="border-y border-gray-800/50 py-12 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s, i) => {
            const cmsS = cmsStats?.[i];
            return (
              <div key={i} className="text-center">
                <s.icon size={24} className="mx-auto text-violet-400 mb-2" />
                <div className="text-3xl font-black text-white">{cmsS?.value || s.value}</div>
                <div className="text-sm text-gray-500">{cmsS?.label || s.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FONCTIONNALITES
          ══════════════════════════════════════════════ */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-4">
              <Zap size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-violet-300 tracking-wide">{t('features.badge')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('features.title')}</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t('features.subtitle')}
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => {
              const cmsF = cmsFeatures?.[i];
              const Icon = f.icon;
              return (
                <div key={i} className="group bg-gray-900/50 border border-gray-800 rounded-2xl p-7 hover:border-violet-500/30 transition-all hover:shadow-lg hover:shadow-violet-500/5">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${cmsF?.color || f.color} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}>
                    <Icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{cmsF?.title || f.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{cmsF?.desc || f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FORMATS SUPPORTES
          ══════════════════════════════════════════════ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-violet-950/10 to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('formats.title')}</h2>
            <p className="text-gray-400">{t('formats.subtitle')}</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FORMATS.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 text-center hover:border-violet-500/30 transition">
                  <Icon size={32} className="mx-auto text-violet-400 mb-3" />
                  <div className="font-bold text-base mb-1">{f.label}</div>
                  <div className="text-xs text-gray-500">{f.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Social networks */}
          <div className="flex items-center justify-center gap-8 mt-14">
            <span className="text-sm text-gray-500">{t('formats.publishOn')}</span>
            {SOCIAL_NETWORKS.map((n, i) => (
              <div key={i} className="flex items-center gap-2 text-sm" style={{ color: n.color }}>
                <n.icon size={20} />
                <span className="hidden sm:inline font-medium">{n.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          COMMENT CA MARCHE
          ══════════════════════════════════════════════ */}
      <section id="how" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-pink-500/10 border border-pink-500/20 rounded-full px-4 py-1.5 mb-4">
              <Award size={14} className="text-pink-400" />
              <span className="text-xs font-semibold text-pink-300 tracking-wide">{t('howItWorks.badge')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('howItWorks.title')}</h2>
            <p className="text-gray-400">{t('howItWorks.subtitle')}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(cmsHowItWorks || HOW_IT_WORKS).map((s, i) => (
              <div key={i} className="relative">
                <div className="text-5xl font-black text-violet-500/15 mb-3">{s.step}</div>
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                {i < (cmsHowItWorks || HOW_IT_WORKS).length - 1 && (
                  <div className="hidden lg:block absolute top-8 -right-3 text-gray-700">
                    <ArrowRight size={20} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          TEMOIGNAGES
          ══════════════════════════════════════════════ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-pink-950/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('testimonials.title')}</h2>
            <p className="text-gray-400">{t('testimonials.subtitle')}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {(cmsTestimonials || TESTIMONIALS).map((item, i) => (
              <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-2xl p-7">
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: item.stars || 5 }).map((_, j) => (
                    <Star key={j} size={14} className="text-yellow-500 fill-yellow-500" />
                  ))}
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-6">&ldquo;{item.text}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
                    {item.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{item.name}</div>
                    <div className="text-xs text-gray-500">{item.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          TARIFS
          ══════════════════════════════════════════════ */}
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-4">
              <Shield size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-violet-300 tracking-wide">{t('pricing.badge')}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('pricing.title')}</h2>
            <p className="text-gray-400 mb-8">{t('pricing.subtitle')}</p>

            {/* Billing toggle */}
            <div className="inline-flex bg-gray-900 border border-gray-800 rounded-xl p-1">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition ${
                  billingPeriod === 'monthly' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t('pricing.monthly')}
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 ${
                  billingPeriod === 'yearly' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t('pricing.yearly')}
                <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full font-bold">{t('pricing.yearlyDiscount')}</span>
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {(cmsPlans || PLAN_KEYS.map((key, i) => ({
              name: t(`pricing.plans.${key}.name`),
              price: t(`pricing.plans.${key}.price`),
              yearlyPrice: t(`pricing.plans.${key}.yearlyPrice`),
              desc: t(`pricing.plans.${key}.desc`),
              credits: PLAN_DEFAULTS[i].credits,
              features: (() => {
                // Build features from indexed translation keys
                const features: string[] = [];
                const count = key === 'starter' ? 6 : 8;
                for (let j = 0; j < count; j++) {
                  const val = t(`pricing.plans.${key}.features.${j}`);
                  // If the key path was not found, t() returns the key itself — skip those
                  if (!val.startsWith('landing.pricing.plans.')) {
                    features.push(val);
                  }
                }
                return features;
              })(),
              cta: t(`pricing.plans.${key}.cta`),
              popular: PLAN_DEFAULTS[i].popular,
            }))).map((p, i) => {
              const popular = p.popular ?? PLAN_DEFAULTS[i]?.popular ?? false;
              const credits = p.credits || PLAN_DEFAULTS[i]?.credits || 300;
              const planSlug = p.name.toLowerCase().replace(/\s+/g, '-');
              return (
                <div key={i} className={`relative bg-gray-900/50 border rounded-2xl p-8 transition-all hover:shadow-lg hover:shadow-violet-500/5 ${
                  popular ? 'border-violet-500 border-2' : 'border-gray-700 hover:border-violet-500'
                }`}>
                  {popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-600 to-pink-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                      {t('pricing.mostPopular')}
                    </div>
                  )}
                  <h3 className="text-2xl font-black mb-1">{p.name}</h3>
                  <p className="text-sm text-gray-500 mb-5">{p.desc || ''}</p>
                  <div className="mb-6">
                    <span className="text-4xl font-black">
                      {billingPeriod === 'yearly' ? p.yearlyPrice : p.price}€
                    </span>
                    <span className="text-gray-500 text-sm">{tc('perMonth')}</span>
                    {billingPeriod === 'yearly' && (
                      <div className="text-xs text-green-400 mt-1">{t('pricing.billedYearly')}</div>
                    )}
                  </div>
                  <div className="text-sm text-violet-400 font-bold mb-5">{credits.toLocaleString()} {t('pricing.creditsPerMonth')}</div>
                  <ul className="space-y-3 mb-8">
                    {(p.features || []).map((f, j) => (
                      <li key={j} className="flex items-start gap-3 text-sm text-gray-300">
                        <Check size={16} className="text-violet-400 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/auth/signup?plan=${planSlug}&billing=${billingPeriod}`}
                    className={`block w-full text-center py-3 rounded-xl font-bold text-sm transition ${
                      popular
                        ? 'bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white shadow-lg shadow-violet-500/20'
                        : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                    }`}
                  >
                    {p.cta}
                  </Link>
                </div>
              );
            })}
          </div>

          {/* Credit packs */}
          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm mb-4">{t('pricing.extraCredits')}</p>
            <div className="inline-flex gap-4 flex-wrap justify-center">
              {[
                { credits: 50, price: "9,99" },
                { credits: 150, price: "19,99" },
                { credits: 500, price: "49,99" },
              ].map((pack, i) => (
                <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl px-6 py-3 text-sm hover:border-violet-500/30 transition cursor-pointer">
                  <span className="font-bold text-white">{pack.credits} {tc('credits')}</span>
                  <span className="text-gray-500 ml-2">— {pack.price}€</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FAQ
          ══════════════════════════════════════════════ */}
      <section id="faq" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">{t('faq.title')}</h2>
            <p className="text-gray-400">{t('faq.subtitle')}</p>
          </div>
          <div className="space-y-3">
            {(cmsFaq || FAQ_DATA).map((faq, i) => (
              <FAQItem key={i} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          CTA FINAL
          ══════════════════════════════════════════════ */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto relative">
          <div className="absolute inset-0 bg-gradient-to-r from-violet-600/20 to-pink-600/20 rounded-3xl blur-3xl" />
          <div className="relative bg-gray-900/80 border border-violet-500/20 rounded-3xl p-12 sm:p-16 text-center">
            <h2 className="text-3xl sm:text-5xl font-black mb-6">
              {cmsCta.title ? (
                <span dangerouslySetInnerHTML={{ __html: cmsCta.title.replace(/\*(.*?)\*/g, '<span class="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">$1</span>') }} />
              ) : (
                <>{t('cta.titlePart1')}{' '}<span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">{t('cta.titleHighlight')}</span> {t('cta.titlePart2')}</>
              )}
            </h2>
            <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto">
              {cmsCta.subtitle || t('cta.subtitle')}
            </p>
            <Link href="/auth/signup" className="group inline-flex items-center gap-3 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-10 py-5 rounded-xl text-white font-bold text-lg transition shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/40">
              {cmsCta.button || t('cta.button')}
              <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <p className="text-xs text-gray-500 mt-4">{cmsCta.reassurance || t('cta.reassurance')}</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FOOTER
          ══════════════════════════════════════════════ */}
      <footer className="border-t border-gray-800/50 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-10 mb-12">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center font-black text-sm">S</div>
                <span className="text-lg font-black">Studiio</span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                {cmsFooter.description || t('footer.description')}
              </p>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">{t('footer.product')}</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#features" className="hover:text-white transition">{t('footer.features')}</a></li>
                <li><a href="#pricing" className="hover:text-white transition">{t('footer.pricing')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.api')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.integrations')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">{t('footer.resources')}</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition">{t('footer.documentation')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.blog')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.tutorials')}</a></li>
                <li><a href="#faq" className="hover:text-white transition">{t('nav.faq')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">{t('footer.legal')}</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition">{t('footer.termsOfUse')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.privacyPolicy')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.legalNotice')}</a></li>
                <li><a href="#" className="hover:text-white transition">{t('footer.contact')}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800/50 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-600">{cmsFooter.copyright || t('footer.copyright')}</p>
            <div className="flex items-center gap-4">
              <LanguageSelector variant="footer" />
              {SOCIAL_NETWORKS.map((n, i) => (
                <a key={i} href="#" className="text-gray-600 hover:text-white transition">
                  <n.icon size={18} />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

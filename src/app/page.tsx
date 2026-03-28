'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight, Zap, Sparkles, BarChart3, Play, Check, Star,
  Video, Calendar, Share2, Target, Palette, Globe, Shield,
  ChevronDown, ChevronUp, Users, TrendingUp, Clock, Award,
  Smartphone, Monitor, Instagram, Youtube, Facebook, Music,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════
   STUDIIO — Landing Page de vente
   Objectif : convertir les visiteurs en utilisateurs payants
   ═══════════════════════════════════════════════════════ */

// ── Données ──
const FEATURES = [
  {
    icon: Video,
    title: "Studio Vidéo IA",
    desc: "Créez des vidéos professionnelles en quelques clics. Textes animés, transitions fluides, musique synchronisée — tout est automatisé.",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: Sparkles,
    title: "Génération IA",
    desc: "L'IA génère vos scripts, choisit les meilleures images, synchronise la musique et optimise chaque vidéo pour un maximum d'engagement.",
    color: "from-pink-500 to-rose-600",
  },
  {
    icon: Calendar,
    title: "Calendrier Éditorial",
    desc: "Planifiez vos publications sur 30 jours. L'Agent IA analyse vos rushes et crée automatiquement des brouillons prêts à publier.",
    color: "from-blue-500 to-cyan-600",
  },
  {
    icon: Share2,
    title: "Publication Multi-Réseaux",
    desc: "Publiez directement sur Instagram, TikTok, YouTube Shorts et Facebook depuis une seule interface. Fini le copier-coller.",
    color: "from-green-500 to-emerald-600",
  },
  {
    icon: Target,
    title: "Objectifs Personnalisés",
    desc: "Définissez vos objectifs marketing : promotion, abonnements, motivation... Studiio adapte chaque vidéo à votre stratégie.",
    color: "from-orange-500 to-amber-600",
  },
  {
    icon: BarChart3,
    title: "Analytics & Performance",
    desc: "Suivez les vues, likes, partages de chaque publication. Comprenez ce qui fonctionne et optimisez votre contenu.",
    color: "from-indigo-500 to-violet-600",
  },
];

const FORMATS = [
  { label: "REEL 9:16", desc: "Instagram Reels, TikTok, YouTube Shorts", icon: Smartphone },
  { label: "TV 16:9", desc: "YouTube, Facebook, LinkedIn", icon: Monitor },
  { label: "INFOGRAPHIE", desc: "Slides animées avec données clés", icon: Palette },
  { label: "BATCH x10", desc: "10 vidéos en un seul clic", icon: Zap },
];

const SOCIAL_NETWORKS = [
  { name: "Instagram", icon: Instagram, color: "#E1306C" },
  { name: "TikTok", icon: Music, color: "#00F2EA" },
  { name: "YouTube", icon: Youtube, color: "#FF0000" },
  { name: "Facebook", icon: Facebook, color: "#1877F2" },
];

const TESTIMONIALS = [
  {
    name: "Sophie M.",
    role: "Coach Fitness",
    text: "Studiio a transformé ma présence sur les réseaux. Je crée 10 vidéos par semaine en moins d'une heure. Mes abonnés ont triplé en 3 mois.",
    stars: 5,
    avatar: "S",
  },
  {
    name: "Marco D.",
    role: "Agence Marketing",
    text: "On gère 15 clients avec Studiio. La fonction batch x10 nous fait gagner 20h par semaine. Le ROI est incroyable.",
    stars: 5,
    avatar: "M",
  },
  {
    name: "Aminata K.",
    role: "Créatrice de contenu",
    text: "L'IA qui génère les légendes et les hashtags, c'est du génie. Mes vidéos TikTok font 10x plus de vues qu'avant.",
    stars: 5,
    avatar: "A",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "29,99",
    yearlyPrice: "24,99",
    desc: "Pour les créateurs qui débutent",
    credits: 300,
    features: [
      "300 crédits/mois",
      "Vidéos illimitées",
      "Formats Reel + TV",
      "Calendrier éditorial",
      "Publication Instagram",
      "Support email",
    ],
    cta: "Commencer",
    popular: false,
    color: "border-gray-700 hover:border-violet-500",
  },
  {
    name: "Pro",
    price: "79,99",
    yearlyPrice: "66,99",
    desc: "Pour les créateurs actifs et les coachs",
    credits: 1000,
    features: [
      "1 000 crédits/mois",
      "Vidéos illimitées",
      "Tous les formats + Batch x10",
      "Calendrier IA + Agent autonome",
      "Publication multi-réseaux",
      "Voix off IA",
      "Objectifs personnalisés",
      "Support prioritaire 24h",
    ],
    cta: "Essayer Pro",
    popular: true,
    color: "border-violet-500 border-2",
  },
  {
    name: "Enterprise",
    price: "299,99",
    yearlyPrice: "249,99",
    desc: "Pour les agences et équipes",
    credits: 5000,
    features: [
      "5 000 crédits/mois",
      "Utilisateurs illimités",
      "Accès API",
      "Batch illimité",
      "Marque blanche",
      "Analytics avancés",
      "Account manager dédié",
      "Support 24/7",
    ],
    cta: "Nous contacter",
    popular: false,
    color: "border-gray-700 hover:border-violet-500",
  },
];

const FAQ_DATA = [
  {
    q: "Comment fonctionnent les crédits ?",
    a: "1 crédit = 1 vidéo rendue. Quand vous créez et exportez une vidéo, un crédit est consommé. Les crédits du plan sont renouvelés chaque mois. Si un rendu échoue, le crédit est remboursé automatiquement.",
  },
  {
    q: "Puis-je essayer gratuitement ?",
    a: "Oui ! Chaque nouveau compte reçoit 10 crédits gratuits pour tester toutes les fonctionnalités. Aucune carte bancaire requise pour l'inscription.",
  },
  {
    q: "Comment connecter mes réseaux sociaux ?",
    a: "Allez dans Paramètres > Réseaux sociaux et cliquez \"Connecter\" sur le réseau souhaité. L'authentification se fait via OAuth — vos identifiants restent chez Instagram, TikTok, etc. On ne stocke jamais vos mots de passe.",
  },
  {
    q: "Puis-je annuler mon abonnement ?",
    a: "Oui, à tout moment. Votre abonnement reste actif jusqu'à la fin de la période payée. Aucun engagement, aucun frais d'annulation.",
  },
  {
    q: "Quelle est la qualité des vidéos ?",
    a: "Toutes les vidéos sont rendues en Full HD (1080p) avec codec H.264 optimisé pour chaque plateforme. Le résultat est identique à un montage professionnel.",
  },
  {
    q: "Combien de temps prend un rendu ?",
    a: "Un rendu simple prend environ 30 à 90 secondes. Un batch de 10 vidéos prend 5 à 10 minutes. Vous êtes notifié dès que c'est prêt.",
  },
];

const STATS = [
  { value: "50K+", label: "Vidéos créées", icon: Video },
  { value: "12K+", label: "Créateurs actifs", icon: Users },
  { value: "98%", label: "Satisfaction client", icon: Star },
  { value: "<60s", label: "Temps de rendu", icon: Clock },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Choisissez votre objectif",
    desc: "Promotion, motivation, abonnement... Studiio adapte tout le contenu à votre stratégie marketing.",
  },
  {
    step: "02",
    title: "Importez vos médias",
    desc: "Glissez vos vidéos ou photos. L'IA sélectionne automatiquement les meilleurs moments de chaque rush.",
  },
  {
    step: "03",
    title: "Personnalisez en un clic",
    desc: "Textes, musiques, transitions, logo — tout est modifiable. Ou laissez l'IA tout faire pour vous.",
  },
  {
    step: "04",
    title: "Publiez partout",
    desc: "Exportez ou publiez directement sur Instagram, TikTok, YouTube et Facebook en un clic.",
  },
];

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
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly');

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
              <a href="#features" className="hover:text-white transition">Fonctionnalités</a>
              <a href="#how" className="hover:text-white transition">Comment ça marche</a>
              <a href="#pricing" className="hover:text-white transition">Tarifs</a>
              <a href="#faq" className="hover:text-white transition">FAQ</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/auth/login" className="text-sm text-gray-300 hover:text-white transition hidden sm:block">
                Connexion
              </Link>
              <Link href="/auth/signup" className="bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-5 py-2 rounded-lg text-white text-sm font-bold transition shadow-lg shadow-violet-500/20">
                Essai gratuit
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
            <span className="text-xs font-semibold text-violet-300 tracking-wide">10 CRÉDITS OFFERTS — AUCUNE CARTE REQUISE</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-black mb-6 leading-[1.1] tracking-tight">
            Créez des vidéos{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-pink-400 to-violet-400">virales</span>
            <br />
            en quelques clics
          </h1>

          <p className="text-lg sm:text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            Studio vidéo IA pour les créateurs, coachs et agences.
            Créez, planifiez et publiez sur tous vos réseaux sociaux —
            <strong className="text-gray-200"> sans compétence technique</strong>.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link href="/auth/signup" className="group bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-8 py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/40">
              Commencer gratuitement
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <button className="border border-gray-700 hover:border-gray-500 hover:bg-white/5 px-8 py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition">
              <Play size={20} className="text-violet-400" />
              Voir la démo
            </button>
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
            <span>Rejoint par <strong className="text-white">12 000+</strong> créateurs</span>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map(i => <Star key={i} size={14} className="text-yellow-500 fill-yellow-500" />)}
              <span className="ml-1">4.9/5</span>
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
              <span className="text-xs text-gray-500 ml-2">Studiio — Studio Vidéo</span>
            </div>
            <div className="aspect-[16/9] bg-gradient-to-br from-gray-900 via-[#0d0d15] to-gray-900 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-pink-600/5" />
              <div className="text-center z-10">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
                    <Video size={24} />
                  </div>
                </div>
                <p className="text-2xl font-black mb-2">Votre studio, prêt à créer</p>
                <p className="text-gray-500 text-sm">Format REEL 9:16 — Rendu en 45 secondes</p>
                <div className="flex gap-3 justify-center mt-6">
                  <div className="px-4 py-2 bg-violet-600/20 border border-violet-500/30 rounded-lg text-violet-300 text-xs font-bold">REEL 9:16</div>
                  <div className="px-4 py-2 bg-gray-800/50 border border-gray-700/30 rounded-lg text-gray-500 text-xs font-bold">TV 16:9</div>
                  <div className="px-4 py-2 bg-gray-800/50 border border-gray-700/30 rounded-lg text-gray-500 text-xs font-bold">BATCH x10</div>
                </div>
              </div>
            </div>
          </div>
          {/* Floating elements */}
          <div className="absolute -right-4 top-1/4 bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl hidden lg:block">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center"><Check size={12} className="text-green-400" /></div>
              <span className="text-gray-300 font-medium">Rendu terminé — 42s</span>
            </div>
          </div>
          <div className="absolute -left-4 bottom-1/4 bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl hidden lg:block">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-6 h-6 rounded-full bg-violet-500/20 flex items-center justify-center"><TrendingUp size={12} className="text-violet-400" /></div>
              <span className="text-gray-300 font-medium">+340% engagement</span>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          STATS BAR
          ══════════════════════════════════════════════ */}
      <section className="border-y border-gray-800/50 py-12 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s, i) => (
            <div key={i} className="text-center">
              <s.icon size={24} className="mx-auto text-violet-400 mb-2" />
              <div className="text-3xl font-black text-white">{s.value}</div>
              <div className="text-sm text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FONCTIONNALITÉS
          ══════════════════════════════════════════════ */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 mb-4">
              <Zap size={14} className="text-violet-400" />
              <span className="text-xs font-semibold text-violet-300 tracking-wide">FONCTIONNALITÉS</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Tout ce qu&apos;il faut pour dominer les réseaux</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              De la création à la publication, Studiio automatise chaque étape de votre stratégie de contenu vidéo.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <div key={i} className="group bg-gray-900/50 border border-gray-800 rounded-2xl p-7 hover:border-violet-500/30 transition-all hover:shadow-lg hover:shadow-violet-500/5">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`}>
                  <f.icon size={22} className="text-white" />
                </div>
                <h3 className="text-lg font-bold mb-2">{f.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          FORMATS SUPPORT��S
          ══════════════════════════════════════════════ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-violet-950/10 to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Tous les formats, toutes les plateformes</h2>
            <p className="text-gray-400">Un seul outil pour créer du contenu adapté à chaque réseau social.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FORMATS.map((f, i) => (
              <div key={i} className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 text-center hover:border-violet-500/30 transition">
                <f.icon size={32} className="mx-auto text-violet-400 mb-3" />
                <div className="font-bold text-base mb-1">{f.label}</div>
                <div className="text-xs text-gray-500">{f.desc}</div>
              </div>
            ))}
          </div>

          {/* Social networks */}
          <div className="flex items-center justify-center gap-8 mt-14">
            <span className="text-sm text-gray-500">Publiez sur :</span>
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
          COMMENT ÇA MARCHE
          ══════════════════════════════════════════════ */}
      <section id="how" className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-pink-500/10 border border-pink-500/20 rounded-full px-4 py-1.5 mb-4">
              <Award size={14} className="text-pink-400" />
              <span className="text-xs font-semibold text-pink-300 tracking-wide">COMMENT ÇA MARCHE</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">4 étapes pour des vidéos pro</h2>
            <p className="text-gray-400">Pas besoin d&apos;être vidéaste. Studiio fait le travail pour vous.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={i} className="relative">
                <div className="text-5xl font-black text-violet-500/15 mb-3">{s.step}</div>
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.desc}</p>
                {i < HOW_IT_WORKS.length - 1 && (
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
          TÉMOIGNAGES
          ══════════════════════════════════════════════ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-transparent via-pink-950/5 to-transparent">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Ils créent avec Studiio</h2>
            <p className="text-gray-400">Découvrez comment nos utilisateurs transforment leur contenu.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-2xl p-7">
                <div className="flex items-center gap-1 mb-4">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} size={14} className="text-yellow-500 fill-yellow-500" />
                  ))}
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-6">&ldquo;{t.text}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
                    {t.avatar}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.role}</div>
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
              <span className="text-xs font-semibold text-violet-300 tracking-wide">TARIFS TRANSPARENTS</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Un plan pour chaque ambition</h2>
            <p className="text-gray-400 mb-8">Commencez gratuitement avec 10 crédits. Pas de carte bancaire requise.</p>

            {/* Billing toggle */}
            <div className="inline-flex bg-gray-900 border border-gray-800 rounded-xl p-1">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition ${
                  billingPeriod === 'monthly' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Mensuel
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 ${
                  billingPeriod === 'yearly' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Annuel
                <span className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full font-bold">-17%</span>
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((p, i) => (
              <div key={i} className={`relative bg-gray-900/50 border rounded-2xl p-8 ${p.color} transition-all hover:shadow-lg hover:shadow-violet-500/5`}>
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-violet-600 to-pink-600 text-white text-xs font-bold px-4 py-1 rounded-full">
                    LE PLUS POPULAIRE
                  </div>
                )}
                <h3 className="text-2xl font-black mb-1">{p.name}</h3>
                <p className="text-sm text-gray-500 mb-5">{p.desc}</p>
                <div className="mb-6">
                  <span className="text-4xl font-black">
                    {billingPeriod === 'yearly' ? p.yearlyPrice : p.price}€
                  </span>
                  <span className="text-gray-500 text-sm">/mois</span>
                  {billingPeriod === 'yearly' && (
                    <div className="text-xs text-green-400 mt-1">Facturé annuellement</div>
                  )}
                </div>
                <div className="text-sm text-violet-400 font-bold mb-5">{p.credits.toLocaleString()} crédits/mois</div>
                <ul className="space-y-3 mb-8">
                  {p.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-3 text-sm text-gray-300">
                      <Check size={16} className="text-violet-400 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block w-full text-center py-3 rounded-xl font-bold text-sm transition ${
                    p.popular
                      ? 'bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white shadow-lg shadow-violet-500/20'
                      : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                  }`}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>

          {/* Credit packs */}
          <div className="mt-12 text-center">
            <p className="text-gray-500 text-sm mb-4">Besoin de crédits supplémentaires ? Achetez des packs à la carte :</p>
            <div className="inline-flex gap-4 flex-wrap justify-center">
              {[
                { credits: 50, price: "9,99" },
                { credits: 150, price: "19,99" },
                { credits: 500, price: "49,99" },
              ].map((pack, i) => (
                <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl px-6 py-3 text-sm hover:border-violet-500/30 transition cursor-pointer">
                  <span className="font-bold text-white">{pack.credits} crédits</span>
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
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Questions fréquentes</h2>
            <p className="text-gray-400">Tout ce que vous devez savoir avant de commencer.</p>
          </div>
          <div className="space-y-3">
            {FAQ_DATA.map((faq, i) => (
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
              Prêt à créer des vidéos qui{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-pink-400">cartonnent</span> ?
            </h2>
            <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto">
              Rejoignez 12 000+ créateurs. 10 crédits gratuits, aucune carte bancaire.
              Votre première vidéo en moins de 2 minutes.
            </p>
            <Link href="/auth/signup" className="group inline-flex items-center gap-3 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 px-10 py-5 rounded-xl text-white font-bold text-lg transition shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/40">
              Commencer gratuitement
              <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <p className="text-xs text-gray-500 mt-4">Aucun engagement. Annulable à tout moment.</p>
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
                La plateforme de création vidéo IA pour les réseaux sociaux. Créez, planifiez, publiez.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">Produit</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#features" className="hover:text-white transition">Fonctionnalités</a></li>
                <li><a href="#pricing" className="hover:text-white transition">Tarifs</a></li>
                <li><a href="#" className="hover:text-white transition">API</a></li>
                <li><a href="#" className="hover:text-white transition">Intégrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">Ressources</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition">Blog</a></li>
                <li><a href="#" className="hover:text-white transition">Tutoriels</a></li>
                <li><a href="#faq" className="hover:text-white transition">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-sm mb-4 text-gray-300">Légal</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#" className="hover:text-white transition">Conditions d&apos;utilisation</a></li>
                <li><a href="#" className="hover:text-white transition">Politique de confidentialité</a></li>
                <li><a href="#" className="hover:text-white transition">Mentions légales</a></li>
                <li><a href="#" className="hover:text-white transition">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800/50 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-600">&copy; 2026 Studiio. Tous droits réservés.</p>
            <div className="flex items-center gap-4">
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

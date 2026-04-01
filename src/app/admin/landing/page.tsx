'use client';

import { useEffect, useState } from 'react';
import {
  Loader2, Check, AlertCircle, Save, Plus, Trash2, GripVertical,
  Eye, ChevronDown, ChevronUp, Upload, Film, X,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// ── Types ──
interface HeroContent {
  badge: string;
  title: string;
  subtitle: string;
  cta1: string;
  cta2: string;
  socialProof1: string;
  socialProof2: string;
  socialProof3: string;
  demoVideoUrl: string;
}

interface FeatureItem {
  title: string;
  desc: string;
  iconName: string;
  color: string;
}

interface TestimonialItem {
  name: string;
  role: string;
  text: string;
  stars: number;
  avatar: string;
}

interface StepItem {
  step: string;
  title: string;
  desc: string;
}

interface FAQItem {
  q: string;
  a: string;
}

interface StatItem {
  value: string;
  label: string;
}

interface PlanItem {
  name: string;
  price: string;
  yearlyPrice: string;
  desc: string;
  credits: number;
  features: string[];
  cta: string;
  popular: boolean;
}

interface FooterContent {
  description: string;
  copyright: string;
}

interface CTAContent {
  title: string;
  subtitle: string;
  button: string;
  reassurance: string;
}

interface LandingContent {
  hero: HeroContent;
  features: FeatureItem[];
  testimonials: TestimonialItem[];
  howItWorks: StepItem[];
  faq: FAQItem[];
  stats: StatItem[];
  plans: PlanItem[];
  footer: FooterContent;
  cta: CTAContent;
}

// ── Defaults ──
const DEFAULT_CONTENT: LandingContent = {
  hero: {
    badge: '10 CREDITS OFFERTS - AUCUNE CARTE REQUISE',
    title: 'Creez des videos virales en quelques clics',
    subtitle: 'Studio video IA tout-en-un pour les createurs, coachs et agences. Creez, planifiez et publiez du contenu professionnel sur tous vos reseaux - en 60 secondes.',
    cta1: 'Commencer gratuitement',
    cta2: 'Voir la demo',
    socialProof1: '12 000+ createurs',
    socialProof2: '98% satisfaction',
    socialProof3: '4.9/5',
    demoVideoUrl: '',
  },
  features: [
    { title: 'Studio Video IA', desc: 'Creez des videos professionnelles en quelques clics.', iconName: 'Video', color: 'from-violet-500 to-purple-600' },
    { title: 'Generation IA', desc: "L'IA genere vos scripts et optimise chaque video.", iconName: 'Sparkles', color: 'from-pink-500 to-rose-600' },
    { title: 'Calendrier Editorial', desc: 'Planifiez vos publications sur 30 jours.', iconName: 'Calendar', color: 'from-blue-500 to-cyan-600' },
    { title: 'Publication Multi-Reseaux', desc: 'Publiez sur Instagram, TikTok, YouTube et Facebook.', iconName: 'Share2', color: 'from-green-500 to-emerald-600' },
    { title: 'Objectifs Personnalises', desc: 'Definissez vos objectifs marketing.', iconName: 'Target', color: 'from-orange-500 to-amber-600' },
    { title: 'Analytics & Performance', desc: 'Suivez les vues, likes, partages.', iconName: 'BarChart3', color: 'from-indigo-500 to-violet-600' },
  ],
  testimonials: [
    { name: 'Sophie M.', role: 'Coach Fitness', text: 'Studiio a transforme ma presence sur les reseaux.', stars: 5, avatar: 'S' },
    { name: 'Marco D.', role: 'Agence Marketing', text: 'La fonction batch x10 nous fait gagner 20h par semaine.', stars: 5, avatar: 'M' },
    { name: 'Aminata K.', role: 'Creatrice de contenu', text: "L'IA qui genere les legendes, c'est du genie.", stars: 5, avatar: 'A' },
  ],
  howItWorks: [
    { step: '01', title: 'Choisissez votre objectif', desc: 'Promotion, motivation, abonnement...' },
    { step: '02', title: 'Importez vos medias', desc: 'Glissez vos videos ou photos.' },
    { step: '03', title: 'Personnalisez en un clic', desc: 'Textes, musiques, transitions, logo.' },
    { step: '04', title: 'Publiez partout', desc: 'Exportez ou publiez directement.' },
  ],
  faq: [
    { q: 'Comment fonctionnent les credits ?', a: '1 credit = 1 video rendue.' },
    { q: 'Puis-je essayer gratuitement ?', a: 'Oui ! 10 credits gratuits.' },
    { q: 'Puis-je annuler mon abonnement ?', a: 'Oui, a tout moment.' },
  ],
  stats: [
    { value: '50K+', label: 'Videos creees' },
    { value: '12K+', label: 'Createurs actifs' },
    { value: '98%', label: 'Satisfaction client' },
    { value: '<60s', label: 'Temps de rendu' },
  ],
  plans: [
    { name: 'Starter', price: '29,99', yearlyPrice: '24,99', desc: 'Pour les createurs qui debutent', credits: 300, features: ['300 credits/mois', 'Videos illimitees', 'Formats Reel + TV', 'Calendrier editorial', 'Publication Instagram', 'Support email'], cta: 'Commencer', popular: false },
    { name: 'Pro', price: '79,99', yearlyPrice: '66,99', desc: 'Pour les createurs actifs et les coachs', credits: 1000, features: ['1 000 credits/mois', 'Videos illimitees', 'Tous les formats + Batch x10', 'Calendrier IA + Agent autonome', 'Publication multi-reseaux', 'Voix off IA', 'Objectifs personnalises', 'Support prioritaire 24h'], cta: 'Essayer Pro', popular: true },
    { name: 'Enterprise', price: '299,99', yearlyPrice: '249,99', desc: 'Pour les agences et equipes', credits: 5000, features: ['5 000 credits/mois', 'Utilisateurs illimites', 'Acces API', 'Batch illimite', 'Marque blanche', 'Analytics avances', 'Account manager dedie', 'Support 24/7'], cta: 'Nous contacter', popular: false },
  ],
  footer: {
    description: 'La plateforme IA tout-en-un pour creer, planifier et publier vos videos sur les reseaux sociaux.',
    copyright: '2026 Studiio. Tous droits reserves.',
  },
  cta: {
    title: 'Pret a creer des videos qui convertissent ?',
    subtitle: '10 credits offerts. Premiere video en moins de 60 secondes.',
    button: 'Commencer gratuitement',
    reassurance: 'Aucun engagement. Annulable a tout moment.',
  },
};

// ── Collapsible Section ──
function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="w-full">
        <CardHeader className="border-b border-gray-800">
          <div className="flex items-center justify-between">
            <CardTitle>{title}</CardTitle>
            {open ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
          </div>
        </CardHeader>
      </button>
      {open && <CardContent className="pt-6">{children}</CardContent>}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════
// ── MAIN PAGE ──
// ═══════════════════════════════════════════════════════

export default function AdminLandingPage() {
  const [content, setContent] = useState<LandingContent>(DEFAULT_CONTENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetchContent();
  }, []);

  const fetchContent = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/landing');
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          // Merge with defaults to ensure all fields exist
          setContent({ ...DEFAULT_CONTENT, ...data.content });
        }
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/admin/landing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!res.ok) throw new Error('Erreur de sauvegarde');
      showToast('Landing page sauvegardee avec succes', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingVideo(true);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'demo');

      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success && data.file?.url) {
        setContent(prev => ({ ...prev, hero: { ...prev.hero, demoVideoUrl: data.file.url } }));
        showToast('Video demo uploadee', 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur upload', 'error');
    } finally {
      setUploadingVideo(false);
    }
  };

  // Update helpers
  const updateHero = (key: keyof HeroContent, value: string) => {
    setContent(prev => ({ ...prev, hero: { ...prev.hero, [key]: value } }));
  };

  const updateCTA = (key: keyof CTAContent, value: string) => {
    setContent(prev => ({ ...prev, cta: { ...prev.cta, [key]: value } }));
  };

  const updateFooter = (key: keyof FooterContent, value: string) => {
    setContent(prev => ({ ...prev, footer: { ...prev.footer, [key]: value } }));
  };

  const updateFeature = (idx: number, key: keyof FeatureItem, value: string) => {
    setContent(prev => {
      const features = [...prev.features];
      features[idx] = { ...features[idx], [key]: value };
      return { ...prev, features };
    });
  };

  const addFeature = () => {
    setContent(prev => ({
      ...prev,
      features: [...prev.features, { title: 'Nouvelle fonctionnalite', desc: 'Description...', iconName: 'Zap', color: 'from-violet-500 to-purple-600' }],
    }));
  };

  const removeFeature = (idx: number) => {
    setContent(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== idx) }));
  };

  const updateTestimonial = (idx: number, key: keyof TestimonialItem, value: string | number) => {
    setContent(prev => {
      const testimonials = [...prev.testimonials];
      testimonials[idx] = { ...testimonials[idx], [key]: value };
      return { ...prev, testimonials };
    });
  };

  const addTestimonial = () => {
    setContent(prev => ({
      ...prev,
      testimonials: [...prev.testimonials, { name: 'Nouveau temoin', role: 'Role', text: 'Temoignage...', stars: 5, avatar: 'N' }],
    }));
  };

  const removeTestimonial = (idx: number) => {
    setContent(prev => ({ ...prev, testimonials: prev.testimonials.filter((_, i) => i !== idx) }));
  };

  const updateStep = (idx: number, key: keyof StepItem, value: string) => {
    setContent(prev => {
      const howItWorks = [...prev.howItWorks];
      howItWorks[idx] = { ...howItWorks[idx], [key]: value };
      return { ...prev, howItWorks };
    });
  };

  const addStep = () => {
    const num = String(content.howItWorks.length + 1).padStart(2, '0');
    setContent(prev => ({
      ...prev,
      howItWorks: [...prev.howItWorks, { step: num, title: 'Nouvelle etape', desc: 'Description...' }],
    }));
  };

  const removeStep = (idx: number) => {
    setContent(prev => ({ ...prev, howItWorks: prev.howItWorks.filter((_, i) => i !== idx) }));
  };

  const updateFAQ = (idx: number, key: keyof FAQItem, value: string) => {
    setContent(prev => {
      const faq = [...prev.faq];
      faq[idx] = { ...faq[idx], [key]: value };
      return { ...prev, faq };
    });
  };

  const addFAQ = () => {
    setContent(prev => ({ ...prev, faq: [...prev.faq, { q: 'Nouvelle question ?', a: 'Reponse...' }] }));
  };

  const removeFAQ = (idx: number) => {
    setContent(prev => ({ ...prev, faq: prev.faq.filter((_, i) => i !== idx) }));
  };

  const updateStat = (idx: number, key: keyof StatItem, value: string) => {
    setContent(prev => {
      const stats = [...prev.stats];
      stats[idx] = { ...stats[idx], [key]: value };
      return { ...prev, stats };
    });
  };

  const updatePlan = (idx: number, key: string, value: any) => {
    setContent(prev => {
      const plans = [...prev.plans];
      plans[idx] = { ...plans[idx], [key]: value };
      return { ...prev, plans };
    });
  };

  const updatePlanFeature = (planIdx: number, featIdx: number, value: string) => {
    setContent(prev => {
      const plans = [...prev.plans];
      const features = [...plans[planIdx].features];
      features[featIdx] = value;
      plans[planIdx] = { ...plans[planIdx], features };
      return { ...prev, plans };
    });
  };

  const addPlanFeature = (planIdx: number) => {
    setContent(prev => {
      const plans = [...prev.plans];
      plans[planIdx] = { ...plans[planIdx], features: [...plans[planIdx].features, 'Nouvelle fonctionnalite'] };
      return { ...prev, plans };
    });
  };

  const removePlanFeature = (planIdx: number, featIdx: number) => {
    setContent(prev => {
      const plans = [...prev.plans];
      plans[planIdx] = { ...plans[planIdx], features: plans[planIdx].features.filter((_, i) => i !== featIdx) };
      return { ...prev, plans };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Landing Page</h1>
          <p className="text-gray-400">Modifiez tout le contenu de la page d&apos;accueil</p>
        </div>
        <div className="flex gap-3">
          <a href="/" target="_blank" rel="noopener noreferrer">
            <Button variant="secondary"><Eye size={16} className="mr-2" /> Voir le site</Button>
          </a>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sauvegarde...</> : <><Save size={16} className="mr-2" /> Sauvegarder</>}
          </Button>
        </div>
      </div>

      {toast && (
        <div className={`px-4 py-3 rounded-lg flex items-center gap-3 ${
          toast.type === 'success' ? 'bg-green-900/20 border border-green-800 text-green-300' : 'bg-red-900/20 border border-red-800 text-red-300'
        }`}>
          {toast.type === 'success' ? <Check size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </div>
      )}

      {/* ═══ HERO ═══ */}
      <Section title="Hero (En-tete)" defaultOpen={true}>
        <div className="space-y-4">
          <Input label="Badge" value={content.hero.badge} onChange={e => updateHero('badge', e.target.value)} />
          <Input label="Titre principal" value={content.hero.title} onChange={e => updateHero('title', e.target.value)} />
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Sous-titre</label>
            <textarea value={content.hero.subtitle} onChange={e => updateHero('subtitle', e.target.value)} className="input-base w-full h-20 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bouton CTA 1" value={content.hero.cta1} onChange={e => updateHero('cta1', e.target.value)} />
            <Input label="Bouton CTA 2" value={content.hero.cta2} onChange={e => updateHero('cta2', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Social proof 1" value={content.hero.socialProof1} onChange={e => updateHero('socialProof1', e.target.value)} />
            <Input label="Social proof 2" value={content.hero.socialProof2} onChange={e => updateHero('socialProof2', e.target.value)} />
            <Input label="Social proof 3" value={content.hero.socialProof3} onChange={e => updateHero('socialProof3', e.target.value)} />
          </div>

          {/* Demo Video Upload */}
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center gap-3 mb-3">
              <Film size={20} className="text-orange-500" />
              <h4 className="font-semibold text-white">Video de demo</h4>
            </div>
            {content.hero.demoVideoUrl ? (
              <div className="space-y-3">
                <video src={content.hero.demoVideoUrl} controls className="w-full max-w-md rounded-lg" />
                <div className="flex gap-2">
                  <Input
                    label="URL de la video"
                    value={content.hero.demoVideoUrl}
                    onChange={e => updateHero('demoVideoUrl', e.target.value)}
                    className="flex-1"
                  />
                  <button onClick={() => updateHero('demoVideoUrl', '')} className="text-red-400 hover:text-red-300 mt-6">
                    <X size={20} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label="URL de la video (YouTube, Supabase, etc.)"
                  placeholder="https://..."
                  value={content.hero.demoVideoUrl}
                  onChange={e => updateHero('demoVideoUrl', e.target.value)}
                />
                <div className="text-center">
                  <span className="text-gray-500 text-sm">ou</span>
                </div>
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-orange-500 transition">
                  {uploadingVideo ? (
                    <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                  ) : (
                    <Upload size={20} className="text-gray-400" />
                  )}
                  <span className="text-sm text-gray-400">{uploadingVideo ? 'Upload en cours...' : 'Uploader un fichier video'}</span>
                  <input type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" disabled={uploadingVideo} />
                </label>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ═══ STATS ═══ */}
      <Section title="Statistiques">
        <div className="space-y-4">
          {content.stats.map((stat, i) => (
            <div key={i} className="flex gap-4 items-end">
              <Input label={`Valeur ${i + 1}`} value={stat.value} onChange={e => updateStat(i, 'value', e.target.value)} className="w-32" />
              <Input label="Label" value={stat.label} onChange={e => updateStat(i, 'label', e.target.value)} className="flex-1" />
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ FEATURES ═══ */}
      <Section title="Fonctionnalites">
        <div className="space-y-4">
          {content.features.map((feat, i) => (
            <div key={i} className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <GripVertical size={16} className="text-gray-500" />
                  <span className="text-sm font-medium text-gray-300">Fonctionnalite {i + 1}</span>
                </div>
                <button onClick={() => removeFeature(i)} className="text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Titre" value={feat.title} onChange={e => updateFeature(i, 'title', e.target.value)} />
                <Input label="Couleur gradient" value={feat.color} onChange={e => updateFeature(i, 'color', e.target.value)} placeholder="from-violet-500 to-purple-600" />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                <textarea value={feat.desc} onChange={e => updateFeature(i, 'desc', e.target.value)} className="input-base w-full h-16 resize-none" />
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={addFeature}><Plus size={16} className="mr-2" /> Ajouter une fonctionnalite</Button>
        </div>
      </Section>

      {/* ═══ HOW IT WORKS ═══ */}
      <Section title="Comment ca marche">
        <div className="space-y-4">
          {content.howItWorks.map((step, i) => (
            <div key={i} className="flex gap-4 items-start p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <Input label="Etape" value={step.step} onChange={e => updateStep(i, 'step', e.target.value)} className="w-20" />
              <div className="flex-1 space-y-2">
                <Input label="Titre" value={step.title} onChange={e => updateStep(i, 'title', e.target.value)} />
                <textarea value={step.desc} onChange={e => updateStep(i, 'desc', e.target.value)} className="input-base w-full h-16 resize-none" placeholder="Description..." />
              </div>
              <button onClick={() => removeStep(i)} className="text-red-400 hover:text-red-300 mt-6"><Trash2 size={16} /></button>
            </div>
          ))}
          <Button variant="secondary" onClick={addStep}><Plus size={16} className="mr-2" /> Ajouter une etape</Button>
        </div>
      </Section>

      {/* ═══ TESTIMONIALS ═══ */}
      <Section title="Temoignages">
        <div className="space-y-4">
          {content.testimonials.map((t, i) => (
            <div key={i} className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-300">Temoignage {i + 1}</span>
                <button onClick={() => removeTestimonial(i)} className="text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <Input label="Nom" value={t.name} onChange={e => updateTestimonial(i, 'name', e.target.value)} />
                <Input label="Role" value={t.role} onChange={e => updateTestimonial(i, 'role', e.target.value)} />
                <Input label="Avatar (initiale)" value={t.avatar} onChange={e => updateTestimonial(i, 'avatar', e.target.value)} className="w-20" />
              </div>
              <textarea value={t.text} onChange={e => updateTestimonial(i, 'text', e.target.value)} className="input-base w-full h-16 resize-none" placeholder="Temoignage..." />
            </div>
          ))}
          <Button variant="secondary" onClick={addTestimonial}><Plus size={16} className="mr-2" /> Ajouter un temoignage</Button>
        </div>
      </Section>

      {/* ═══ PLANS ═══ */}
      <Section title="Tarification">
        <div className="space-y-6">
          {content.plans.map((plan, i) => (
            <div key={i} className={`p-4 rounded-lg border ${plan.popular ? 'border-orange-500 bg-orange-900/10' : 'border-gray-700 bg-gray-800/50'}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-white">{plan.name}</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={plan.popular} onChange={e => updatePlan(i, 'popular', e.target.checked)} className="w-4 h-4" />
                  <span className="text-xs text-gray-400">Populaire</span>
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                <Input label="Nom" value={plan.name} onChange={e => updatePlan(i, 'name', e.target.value)} />
                <Input label="Prix/mois" value={plan.price} onChange={e => updatePlan(i, 'price', e.target.value)} />
                <Input label="Prix annuel/mois" value={plan.yearlyPrice} onChange={e => updatePlan(i, 'yearlyPrice', e.target.value)} />
                <Input label="Credits" type="number" value={plan.credits} onChange={e => updatePlan(i, 'credits', parseInt(e.target.value) || 0)} />
              </div>
              <Input label="Description" value={plan.desc} onChange={e => updatePlan(i, 'desc', e.target.value)} className="mb-3" />
              <Input label="Texte bouton CTA" value={plan.cta} onChange={e => updatePlan(i, 'cta', e.target.value)} className="mb-3" />
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-400">Fonctionnalites du plan</label>
                {plan.features.map((f, fi) => (
                  <div key={fi} className="flex gap-2">
                    <input value={f} onChange={e => updatePlanFeature(i, fi, e.target.value)} className="input-base flex-1 text-sm" />
                    <button onClick={() => removePlanFeature(i, fi)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                  </div>
                ))}
                <button onClick={() => addPlanFeature(i)} className="text-xs text-purple-400 hover:text-purple-300">+ Ajouter</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ FAQ ═══ */}
      <Section title="FAQ">
        <div className="space-y-4">
          {content.faq.map((item, i) => (
            <div key={i} className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-300">Question {i + 1}</span>
                <button onClick={() => removeFAQ(i)} className="text-red-400 hover:text-red-300"><Trash2 size={16} /></button>
              </div>
              <Input label="Question" value={item.q} onChange={e => updateFAQ(i, 'q', e.target.value)} className="mb-2" />
              <textarea value={item.a} onChange={e => updateFAQ(i, 'a', e.target.value)} className="input-base w-full h-20 resize-none" placeholder="Reponse..." />
            </div>
          ))}
          <Button variant="secondary" onClick={addFAQ}><Plus size={16} className="mr-2" /> Ajouter une question</Button>
        </div>
      </Section>

      {/* ═══ CTA FINAL ═══ */}
      <Section title="Section CTA finale">
        <div className="space-y-4">
          <Input label="Titre" value={content.cta.title} onChange={e => updateCTA('title', e.target.value)} />
          <Input label="Sous-titre" value={content.cta.subtitle} onChange={e => updateCTA('subtitle', e.target.value)} />
          <Input label="Texte du bouton" value={content.cta.button} onChange={e => updateCTA('button', e.target.value)} />
          <Input label="Texte de reassurance" value={content.cta.reassurance} onChange={e => updateCTA('reassurance', e.target.value)} />
        </div>
      </Section>

      {/* ═══ FOOTER ═══ */}
      <Section title="Footer">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Description</label>
            <textarea value={content.footer.description} onChange={e => updateFooter('description', e.target.value)} className="input-base w-full h-20 resize-none" />
          </div>
          <Input label="Copyright" value={content.footer.copyright} onChange={e => updateFooter('copyright', e.target.value)} />
        </div>
      </Section>

      {/* Floating save button */}
      <div className="sticky bottom-4 flex justify-end">
        <Button variant="primary" size="lg" onClick={handleSave} disabled={saving} className="shadow-xl shadow-orange-500/20">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sauvegarde...</> : <><Save size={16} className="mr-2" /> Sauvegarder toutes les modifications</>}
        </Button>
      </div>
    </div>
  );
}

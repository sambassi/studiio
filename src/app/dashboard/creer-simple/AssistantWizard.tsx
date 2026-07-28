'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wand2,
  Rocket,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  Check,
  AlertTriangle,
  CalendarPlus,
  RefreshCw,
  MonitorPlay,
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import { CardIcon } from '@/components/ui/CardIcon';
import { Card, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Parcours « Créer avec l'assistant » (F5) — couche NON DESTRUCTIVE.
 *
 * Ce composant n'importe QUE des modules existants sans les modifier :
 *   - generateSmartContent (src/lib/smart-content.ts) pour le contenu
 *   - CardIcon (src/components/ui/CardIcon.tsx) pour les icônes de cartes
 *   - POST /api/posts pour la création du post calendrier
 *
 * Choix d'implémentation documentés :
 *
 * 1. `generateSmartContent` est importé DIRECTEMENT plutôt que via
 *    POST /api/content/generate, parce que cette route plafonne le résultat à
 *    3 cartes (route.ts, `result.cards.slice(0, 3)`) alors qu'il en faut 5.
 *    Modifier la route changerait le fallback de l'éditeur existant : exclu.
 *    L'import direct est déjà pratiqué par /dashboard/infographic.
 *
 * 2. `generateSmartContent` ne produit NI CTA NI notion de ton — elle renvoie
 *    exactement { subtitle, tagLine, cards[5] }. Le ton choisi à l'étape 2
 *    pilote donc ce qui est réellement sous notre contrôle : le texte du CTA
 *    et le seed (donc la variante de contenu). Il ne « reformule » pas les
 *    cartes, la bibliothèque ne l'permet pas.
 */

// ── Thèmes ────────────────────────────────────────────────────────────────
// `CONTENT_THEMES` de /dashboard/creer n'est pas exporté et ce fichier ne doit
// pas être modifié. On redéclare donc une liste locale dont les libellés sont
// choisis pour tomber sur les bonnes entrées de la base de connaissances
// (le matching se fait sur du texte libre, pas sur un slug).
const THEMES: Array<{ id: string; label: string; emoji: string; topic: string }> = [
  { id: 'sommeil', label: 'Sommeil & récupération', emoji: '🌙', topic: 'sommeil' },
  { id: 'nutrition', label: 'Nutrition', emoji: '🥗', topic: 'nutrition' },
  { id: 'energie', label: 'Énergie & cardio', emoji: '⚡', topic: 'energie' },
  { id: 'stress', label: 'Stress & mental', emoji: '🧠', topic: 'stress' },
  { id: 'danse', label: 'Danse', emoji: '💃', topic: 'danse' },
  { id: 'motivation', label: 'Motivation', emoji: '🔥', topic: 'motivation' },
  { id: 'eau', label: 'Hydratation', emoji: '💧', topic: 'eau' },
  { id: 'beauty', label: 'Beauté', emoji: '✨', topic: 'beauty' },
  { id: 'finance', label: 'Finance', emoji: '💰', topic: 'finance' },
  { id: 'productivity', label: 'Productivité', emoji: '🎯', topic: 'productivity' },
  { id: 'food', label: 'Cuisine', emoji: '🍽️', topic: 'food' },
  { id: 'travel', label: 'Voyage', emoji: '✈️', topic: 'travel' },
];

// ── Tons ──────────────────────────────────────────────────────────────────
// Le ton pilote le CTA (que smart-content ne fournit pas) et le décalage de
// seed, donc la variante de contenu retenue.
const TONES: Array<{
  id: string;
  label: string;
  hint: string;
  cta: string;
  ctaSub: string;
  seedOffset: number;
}> = [
  {
    id: 'punchy',
    label: 'Punchy',
    hint: 'Direct, qui accroche',
    cta: 'JE ME LANCE',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 0,
  },
  {
    id: 'pedago',
    label: 'Pédagogique',
    hint: 'Explicatif, rassurant',
    cta: 'EN SAVOIR PLUS',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 1,
  },
  {
    id: 'pro',
    label: 'Professionnel',
    hint: 'Sobre, crédible',
    cta: 'DÉCOUVRIR',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 2,
  },
  {
    id: 'friendly',
    label: 'Complice',
    hint: 'Chaleureux, proche',
    cta: 'ON EN PARLE ?',
    ctaSub: 'ÉCRIS-MOI EN DM',
    seedOffset: 3,
  },
];

const ACCENT = '#7C3AED';
const GRADIENT_END = '#EC4899';
const DARK = '#0A0A0F';

type Format = '9:16' | '16:9';

interface GeneratedCard {
  icon: string; // emoji renvoyé par smart-content
  title: string;
  description: string;
  value: string;
}

interface Generated {
  title: string;
  subtitle: string;
  cards: GeneratedCard[];
  cta: string;
  ctaSub: string;
}

const STEPS = ['Sujet', 'Style', 'Contenu', 'Envoi'] as const;

export default function AssistantWizard() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);

  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [customTopic, setCustomTopic] = useState('');
  const [toneId, setToneId] = useState(TONES[0].id);
  const [format, setFormat] = useState<Format>('9:16');

  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);

  const [scheduledDate, setScheduledDate] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date du jour posée après le montage : la calculer pendant le rendu
  // provoquerait un écart d'hydratation entre serveur et navigateur.
  useEffect(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, []);

  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const tone = TONES.find((t) => t.id === toneId) ?? TONES[0];
  const topicText = customTopic.trim() || theme.topic;

  // ── Génération ──────────────────────────────────────────────────────
  const runGeneration = useCallback(() => {
    setGenerating(true);
    setError(null);
    // Laisse le navigateur peindre l'état « génération » avant le calcul
    // synchrone de smart-content.
    setTimeout(() => {
      try {
        const seed = Math.floor(Math.random() * 100000) + tone.seedOffset;
        const result = generateSmartContent(topicText, seed);
        setGenerated({
          title: result.tagLine,
          subtitle: result.subtitle,
          cards: result.cards.slice(0, 5),
          cta: tone.cta,
          ctaSub: tone.ctaSub,
        });
      } catch {
        setError("La génération du contenu a échoué. Réessayez.");
      } finally {
        setGenerating(false);
      }
    }, 30);
  }, [topicText, tone]);

  const goToGeneration = () => {
    setStep(2);
    runGeneration();
  };

  // ── Envoi au calendrier ─────────────────────────────────────────────
  const sendToCalendar = async () => {
    if (!generated || sending) return;
    setSending(true);
    setError(null);

    try {
      // Métadonnées alignées sur celles de l'éditeur, réduites à ce que le
      // Calendrier lit réellement pour reconstruire un aperçu HTML.
      // `renderedVideoUrl` est volontairement absent : aucun montage n'a été
      // composé ici, donc le Calendrier affichera son bouton « Régénérer ».
      const metadata = {
        type: 'infographic',
        source: 'assistant-simple',
        subtitle: generated.subtitle,
        theme: theme.id,
        cards: generated.cards.map((c) => ({
          emoji: c.icon,
          label: c.title,
          value: c.value,
          description: c.description,
          color: ACCENT,
        })),
        hasAudio: false,
        sequences: {
          intro: 5,
          cards: 8,
          video: 0,
          cta: 5,
          total: 18,
          order: ['intro', 'cards', 'cta'],
        },
        branding: {
          accentColor: ACCENT,
          ctaText: generated.cta,
          ctaSubText: generated.ctaSub,
          watermarkText: 'AFROBOOST',
          borderEnabled: false,
          borderColor: null,
        },
        design: {
          titleColor: '#FFFFFF',
          ctaColor: '#FFFFFF',
          ctaSubColor: GRADIENT_END,
          ctaMainText: generated.cta,
          ctaSubText: generated.ctaSub,
          gradientColor1: ACCENT,
          gradientColor2: GRADIENT_END,
          gradientOpacity: 0.5,
          cardStyle: 'Compact',
        },
      };

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generated.title || 'Infographie',
          caption: generated.subtitle || '',
          media_url: null,
          media_type: 'image',
          format: format === '16:9' ? 'tv' : 'reel',
          platforms: [],
          scheduled_date: scheduledDate,
          scheduled_time: '12:00',
          status: 'draft',
          metadata,
        }),
      });

      const json = await res.json();
      if (!json.success || !json.post?.id) {
        setError(json.error || "L'envoi au calendrier a échoué.");
        return;
      }
      setSent(true);
    } catch {
      setError('Connexion impossible. Réessayez.');
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setStarted(false);
    setStep(0);
    setGenerated(null);
    setSent(false);
    setError(null);
  };

  // ── Aperçu (colonne de droite) ──────────────────────────────────────
  // Aucun composant d'aperçu réutilisable n'existe dans le dépôt : ceux de
  // /dashboard/creer et /dashboard/calendar sont du JSX inline dépendant de
  // dizaines de variables locales, non extractibles sans refactor. On rend
  // donc un aperçu léger, en réutilisant CardIcon pour les icônes.
  const Preview = () => (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-3">
        <MonitorPlay className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Aperçu
        </span>
      </div>

      <div
        className="w-full rounded-xl overflow-hidden flex flex-col justify-between p-4 gap-3"
        style={{
          aspectRatio: format === '9:16' ? '9 / 16' : '16 / 9',
          background: generated
            ? `linear-gradient(160deg, ${ACCENT}55 0%, ${DARK} 55%, ${GRADIENT_END}44 100%)`
            : DARK,
          border: generated ? 'none' : '1px dashed #1F2937',
        }}
      >
        {!generated ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-2">
            <MonitorPlay className="w-8 h-8 text-gray-700" />
            <p className="text-xs text-gray-600 leading-relaxed">
              Votre visuel s&apos;affichera ici
              <br />
              au fil des étapes.
            </p>
          </div>
        ) : (
          <>
            {/* Titre */}
            <div>
              <div
                className="font-extrabold uppercase leading-tight text-white"
                style={{ fontSize: format === '9:16' ? '1.05rem' : '0.95rem' }}
              >
                {generated.title}
              </div>
              <div className="text-[10px] text-gray-300 mt-1 leading-snug">
                {generated.subtitle}
              </div>
            </div>

            {/* Cartes */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 min-h-0 overflow-hidden">
              {generated.cards.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                >
                  <CardIcon name={c.icon} size={13} color="#FFFFFF" className="" />
                  <span className="text-[9px] font-semibold text-white truncate flex-1">
                    {c.title}
                  </span>
                  {c.value && (
                    <span
                      className="text-[9px] font-bold flex-shrink-0"
                      style={{ color: GRADIENT_END }}
                    >
                      {c.value}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="text-center">
              <div className="text-[11px] font-extrabold text-white">{generated.cta}</div>
              <div className="text-[8px] font-bold" style={{ color: GRADIENT_END }}>
                {generated.ctaSub}
              </div>
            </div>
          </>
        )}
      </div>

      {generated && (
        <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          Aperçu simplifié. La vidéo finale est composée depuis le calendrier ou le mode avancé.
        </p>
      )}
    </div>
  );

  // ── Rendu ───────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
      <div className="lg:col-span-3 space-y-4">
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Choix du parcours */}
        {!started && (
          <>
            <Card>
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${ACCENT}26`, color: '#C4B5FD' }}
                >
                  <Wand2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">Créer avec l&apos;assistant</CardTitle>
                  <CardContent className="mt-1 text-sm text-gray-400">
                    Quatre étapes — sujet, style, contenu, envoi. Le texte et les cartes sont
                    générés pour vous.
                  </CardContent>
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => setStarted(true)}>
                      Commencer
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#EC489926', color: '#F9A8D4' }}
                >
                  <Rocket className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg">Autopilote</CardTitle>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor: `${ACCENT}33`,
                        color: '#DDD6FE',
                        boxShadow: `inset 0 0 0 1px ${ACCENT}66`,
                      }}
                    >
                      Pro
                    </span>
                  </div>
                  <CardContent className="mt-1 text-sm text-gray-400">
                    Studiio produit et planifie vos contenus en continu à partir de vos objectifs.
                  </CardContent>
                  <div className="mt-4">
                    <Button variant="secondary" size="sm" disabled aria-disabled="true">
                      Activer
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* Wizard */}
        {started && (
          <Card>
            {/* Fil d'étapes */}
            <div className="flex items-center gap-2 mb-6">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={
                        i <= step
                          ? { backgroundColor: ACCENT, color: '#fff' }
                          : { backgroundColor: '#1F2937', color: '#6B7280' }
                      }
                    >
                      {i < step ? <Check className="w-3 h-3" /> : i + 1}
                    </span>
                    <span
                      className={`text-[11px] truncate ${i === step ? 'text-white font-medium' : 'text-gray-500'}`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className="h-px flex-1 min-w-2"
                      style={{ backgroundColor: i < step ? ACCENT : '#1F2937' }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Étape 1 — sujet */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">De quoi parle votre contenu ?</h3>
                  <p className="text-sm text-gray-400">
                    Choisissez un thème, ou saisissez votre propre sujet.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setThemeId(t.id);
                        setCustomTopic('');
                      }}
                      className={`rounded-xl px-3 py-2.5 text-left text-xs transition ${
                        themeId === t.id && !customTopic
                          ? 'bg-purple-600/20 ring-1 ring-purple-500/50 text-white'
                          : 'bg-gray-900/60 text-gray-400 hover:text-white hover:bg-gray-800/70'
                      }`}
                    >
                      <span className="mr-1.5">{t.emoji}</span>
                      {t.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Ou votre sujet</label>
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="Ex. : récupération après le sport"
                    className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="primary" size="sm" onClick={() => setStep(1)}>
                    <span className="flex items-center gap-2">
                      Continuer <ArrowRight className="w-4 h-4" />
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 2 — ton + format */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold mb-1">Quel style ?</h3>
                  <p className="text-sm text-gray-400">
                    Le ton oriente l&apos;appel à l&apos;action et la variante de contenu retenue.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setToneId(t.id)}
                      className={`rounded-xl px-3 py-2.5 text-left transition ${
                        toneId === t.id
                          ? 'bg-purple-600/20 ring-1 ring-purple-500/50'
                          : 'bg-gray-900/60 hover:bg-gray-800/70'
                      }`}
                    >
                      <div
                        className={`text-sm font-medium ${toneId === t.id ? 'text-white' : 'text-gray-300'}`}
                      >
                        {t.label}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{t.hint}</div>
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Format</label>
                  <div className="flex gap-2">
                    {(['9:16', '16:9'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFormat(f)}
                        className={`flex-1 rounded-xl px-3 py-2.5 text-sm transition ${
                          format === f
                            ? 'bg-purple-600/20 text-purple-200 ring-1 ring-purple-500/50'
                            : 'bg-gray-900 text-gray-400 hover:text-white'
                        }`}
                      >
                        {f}
                        <span className="block text-[10px] text-gray-500">
                          {f === '9:16' ? 'Reel / Short' : 'Paysage'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  <Button variant="primary" size="sm" onClick={goToGeneration}>
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Générer le contenu
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 3 — contenu généré */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">Votre contenu</h3>
                  <p className="text-sm text-gray-400">
                    Relancez si le résultat ne vous convient pas.
                  </p>
                </div>

                {generating && (
                  <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" /> Génération…
                  </div>
                )}

                {!generating && generated && (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-gray-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Titre
                      </div>
                      <div className="text-sm font-bold">{generated.title}</div>
                      <div className="text-xs text-gray-400 mt-1">{generated.subtitle}</div>
                    </div>

                    <div className="space-y-1.5">
                      {generated.cards.map((c, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 rounded-xl bg-gray-900/60 p-3"
                        >
                          <CardIcon name={c.icon} size={16} color="#C4B5FD" className="" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{c.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{c.description}</div>
                          </div>
                          {c.value && (
                            <span
                              className="text-xs font-bold flex-shrink-0"
                              style={{ color: GRADIENT_END }}
                            >
                              {c.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-gray-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Appel à l&apos;action
                      </div>
                      <div className="text-sm font-bold">{generated.cta}</div>
                      <div className="text-xs" style={{ color: GRADIENT_END }}>
                        {generated.ctaSub}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2 gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={runGeneration}
                      disabled={generating}
                    >
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" /> Relancer
                      </span>
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setStep(3)}
                      disabled={generating || !generated}
                    >
                      <span className="flex items-center gap-2">
                        Continuer <ArrowRight className="w-4 h-4" />
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Étape 4 — envoi */}
            {step === 3 && (
              <div className="space-y-4">
                {sent ? (
                  <div className="py-6 text-center space-y-4">
                    <div
                      className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                      style={{ backgroundColor: '#10B98126', color: '#6EE7B7' }}
                    >
                      <Check className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-semibold">Envoyé au calendrier</div>
                      <p className="text-sm text-gray-400 mt-1">
                        Le post est enregistré en brouillon. Composez la vidéo depuis le
                        calendrier, ou affinez le design en mode avancé.
                      </p>
                    </div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      <a href="/dashboard/calendar" className="button-primary px-4 py-2 text-sm">
                        Ouvrir le calendrier
                      </a>
                      <Button variant="ghost" size="sm" onClick={reset}>
                        Créer un autre contenu
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="font-semibold mb-1">Envoyer au calendrier</h3>
                      <p className="text-sm text-gray-400">
                        Le post est créé en brouillon, sans consommer de crédits — aucune vidéo
                        n&apos;est composée à cette étape.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Date</label>
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                      />
                    </div>

                    <div className="flex justify-between pt-2">
                      <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                        <span className="flex items-center gap-2">
                          <ArrowLeft className="w-4 h-4" /> Retour
                        </span>
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={sendToCalendar}
                        disabled={sending || !scheduledDate}
                      >
                        <span className="flex items-center gap-2">
                          {sending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" /> Envoi…
                            </>
                          ) : (
                            <>
                              <CalendarPlus className="w-4 h-4" /> Envoyer au calendrier
                            </>
                          )}
                        </span>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="lg:col-span-2">
        <Preview />
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  GripVertical,
  Eye,
  EyeOff,
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import { composeAndUpload, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { CardIcon } from '@/components/ui/CardIcon';
import { preRenderCardIcons } from '@/lib/icons/prerender';
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
const THEMES: Array<{ id: string; label: string; icon: string; topic: string }> = [
  { id: 'sommeil', label: 'Sommeil & récupération', icon: 'Moon', topic: 'sommeil' },
  { id: 'nutrition', label: 'Nutrition', icon: 'Salad', topic: 'nutrition' },
  { id: 'energie', label: 'Énergie & cardio', icon: 'Zap', topic: 'energie' },
  { id: 'stress', label: 'Stress & mental', icon: 'Brain', topic: 'stress' },
  { id: 'danse', label: 'Danse', icon: 'PersonStanding', topic: 'danse' },
  { id: 'motivation', label: 'Motivation', icon: 'Flame', topic: 'motivation' },
  { id: 'eau', label: 'Hydratation', icon: 'Droplet', topic: 'eau' },
  { id: 'beauty', label: 'Beauté', icon: 'Sparkles', topic: 'beauty' },
  { id: 'finance', label: 'Finance', icon: 'Wallet', topic: 'finance' },
  { id: 'productivity', label: 'Productivité', icon: 'Target', topic: 'productivity' },
  { id: 'food', label: 'Cuisine', icon: 'Utensils', topic: 'food' },
  { id: 'travel', label: 'Voyage', icon: 'Plane', topic: 'travel' },
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

/**
 * Durées des séquences, en secondes. Elles sont passées au compositeur ET
 * écrites dans `metadata.sequences` : une seule source, donc pas de dérive
 * entre la vidéo produite et ce que le Calendrier croit savoir.
 * `video: 0` — il n'y a jamais de rush dans ce parcours.
 */
const SEQ = { intro: 4, cards: 6, video: 0, cta: 4 } as const;

/**
 * Les 4 sequences, dans leur ordre par defaut — le meme que celui du
 * compositeur (intro -> cards -> video -> cta). L'utilisateur peut les
 * reordonner et les desactiver ; `video` part desactivee car ce parcours
 * n'accepte pas de rush.
 */
type SeqKey = 'intro' | 'cards' | 'video' | 'cta';

const SEQ_META: Record<SeqKey, { label: string; hint: string }> = {
  intro: { label: 'Titre', hint: 'Titre et sous-titre' },
  cards: { label: 'Cartes', hint: 'Les points cles' },
  video: { label: 'Vidéo', hint: 'Aucun rush dans ce parcours' },
  cta: { label: 'CTA', hint: "Appel a l'action" },
};

const DEFAULT_SEQUENCES: Array<{ key: SeqKey; enabled: boolean }> = [
  { key: 'intro', enabled: true },
  { key: 'cards', enabled: true },
  { key: 'video', enabled: false },
  { key: 'cta', enabled: true },
];

/**
 * SPEC DE DESIGN PARTAGÉE — une seule définition pour l'aperçu, le
 * compositeur et les métadonnées lues par le Calendrier.
 *
 * Chaque valeur est transmise EXPLICITEMENT au compositeur. Sans cela il
 * applique ses propres défauts, qui diffèrent de l'aperçu — c'est ce qui
 * faisait diverger le titre, le CTA et le fond.
 */
const DESIGN = {
  /** Titre : bord gauche à 8 %, haut à 8 %. Nécessite titleAlign:'left'. */
  titlePos: { x: 8, y: 8 },
  /** Largeur du bloc de titre, en % de la largeur totale. */
  titleWidth: 84,
  titleColor: '#FFFFFF',
  /** CTA : bas-centre. Le defaut du compositeur est y=97 ; on fixe 92. */
  ctaPos: { x: 50, y: 92 },
  ctaWidth: 70,
  ctaColor: '#FFFFFF',
  gradientOpacity: 0.5,
  /**
   * Police. Sans ce champ le compositeur retombe sur 'sans-serif' (Helvetica)
   * alors que l'aperçu et le snapshot des cartes sont en Inter — titre et CTA
   * n'auraient pas la même fonte que les cartes dans la vidéo.
   * 'Inter' fait partie des familles que le compositeur charge (document.fonts).
   */
  font: 'Inter',
} as const;

/**
 * Tailles de police, exprimées en POURCENTAGE DE LA LARGEUR — exactement la
 * convention du compositeur (`w * 0.04375`, etc.). L'aperçu les applique en
 * `cqw` (unités de conteneur), donc les proportions coïncident quelle que soit
 * la largeur d'affichage.
 */
const FONT_PCT = {
  '9:16': { title: 4.375, subtitle: 2.8, cta: 3.75, ctaSub: 2.8 },
  '16:9': { title: 3.5, subtitle: 2.15, cta: 3.1, ctaSub: 2.3 },
} as const;

/**
 * Reproduit `dropShadowLgFilter` du compositeur, qui vaut `4/320` et `10/320`
 * de la LARGEUR. Exprimes en `em`, il faut donc diviser par la taille de
 * police relative (4.375 % de la largeur) : 4/320 / 0.04375 = 0.2857em.
 */
const TITLE_SHADOW =
  'drop-shadow(0 0.2857em 0.2143em rgba(0,0,0,0.1)) drop-shadow(0 0.714em 0.571em rgba(0,0,0,0.04))';

/** Equivalent de `dropShadowBaseFilter`, applique au sous-titre. */
const SUBTITLE_SHADOW = 'drop-shadow(0 0.1786em 0.1071em rgba(0,0,0,0.1))';

/**
 * Angle CSS reproduisant `createLinearGradient(0, 0, w, h)` du compositeur.
 *
 * Le canvas trace la diagonale coin à coin ; l'équivalent CSS n'est PAS
 * `to bottom right` (CSS utilise la perpendiculaire à l'autre diagonale) mais
 * `180° − atan(w/h)`. En 9:16 → 150,64° ; en 16:9 → 119,36°.
 */
function backdropAngle(format: Format): number {
  const [w, h] = format === '9:16' ? [1080, 1920] : [1920, 1080];
  return 180 - (Math.atan(w / h) * 180) / Math.PI;
}

/**
 * Fond identique à celui peint par le compositeur : le backdrop diagonal
 * (paintSeqBackdrop, 2 arrêts) surmonté de l'overlay `both` (paintSeqGradient,
 * 4 arrêts verticaux). Le premier de la liste CSS est au-dessus, comme dans
 * le canvas.
 *
 * Un dégradé à 3 arrêts sur 160° — l'ancien fond de l'aperçu — n'est pas
 * exprimable via les options du compositeur : le backdrop y est figé à 2
 * arrêts sur la diagonale du canvas. Plutôt que de modifier le moteur (donc
 * de repeindre le fond de TOUS les posts existants), c'est l'aperçu qui
 * s'aligne sur le compositeur.
 */
function backdropCSS(format: Format): string {
  const a = DESIGN.gradientOpacity;
  const rgba = (hex: string, alpha: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  return [
    `linear-gradient(180deg, ${rgba(ACCENT, a)} 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, ${rgba(GRADIENT_END, a)} 100%)`,
    `linear-gradient(${backdropAngle(format).toFixed(2)}deg, ${ACCENT} 0%, ${GRADIENT_END} 100%)`,
  ].join(', ');
}

/** Style de cartes utilisé partout : aperçu, compositeur, metadata. */
const CARD_STYLE = 'Compact';

/** Coût du rendu, aligné sur l'éditeur (RENDER_COSTS). */
const COST = { reel: 10, tv: 15 } as const;

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

/** Classes de désactivation : `Button` n'en fournit aucune (ui/Button.tsx). */
const DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Aperçu — déclaré HORS du composant parent.
 *
 * Déclaré à l'intérieur, sa référence changeait à chaque rendu : React
 * démontait puis remontait tout le sous-arbre à chaque frappe dans le champ
 * « votre sujet ».
 */
function Preview({
  generated,
  format,
  previewRef,
  cardsRef,
  activeOrder,
}: {
  generated: Generated | null;
  format: Format;
  previewRef?: React.RefObject<HTMLDivElement>;
  cardsRef?: React.RefObject<HTMLDivElement>;
  /**
   * Sequences activees, dans l'ordre choisi. L'apercu est une composition
   * fixe (les 3 blocs empiles) alors que la video les joue l'une apres
   * l'autre : l'ORDRE n'y est donc pas representable, mais la VISIBILITE
   * l'est — une sequence masquee disparait de l'apercu comme de la video.
   */
  activeOrder: string[];
}) {
  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-3">
        <MonitorPlay className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Aperçu
        </span>
      </div>

      {/* `containerType: 'size'` active les unites `cqw` : 1cqw = 1 % de la
          largeur du cadre. Les tailles de police sont donc exprimees dans la
          meme unite que le compositeur (% de la largeur du canvas), et les
          proportions restent exactes quelle que soit la taille d'affichage.
          Aucun padding fixe : les insets sont en %, sinon les positions
          divergeraient du compositeur des que la fenetre change de largeur. */}
      <div
        ref={previewRef}
        className="w-full rounded-xl overflow-hidden relative"
        style={{
          aspectRatio: format === '9:16' ? '9 / 16' : '16 / 9',
          containerType: 'size',
          // Fond STRICTEMENT identique a celui peint par le compositeur.
          background: generated ? backdropCSS(format) : DARK,
          border: generated ? 'none' : '1px dashed #1F2937',
          // `var(--font-inter)` est la SEULE reference valide : Next charge la
          // police via next/font, il n'existe aucune @font-face nommee 'Inter'.
          // Sans cette variable, l'apercu ET le snapshot des cartes tombent en
          // police par defaut (serif), alors que la video serait en vraie Inter.
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {!generated ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-2">
            <MonitorPlay className="w-8 h-8 text-gray-700" />
            <p className="text-xs text-gray-600 leading-relaxed">
              Votre visuel s&apos;affichera ici
              <br />
              au fil des étapes.
            </p>
          </div>
        ) : (
          <>
            {activeOrder.includes('intro') && (
            /* Titre — ancre au bord GAUCHE (x) et au bord HAUT (y), comme
                drawIntro avec titleAlign:'left' et textBaseline:'top'.
                Graisse 900 et ombre : le compositeur les applique en dur. */
            <div
              style={{
                position: 'absolute',
                left: `${DESIGN.titlePos.x}%`,
                top: `${DESIGN.titlePos.y}%`,
                width: `${DESIGN.titleWidth}%`,
                textAlign: 'left',
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontSize: `${FONT_PCT[format].title}cqw`,
                  fontWeight: 900,
                  color: DESIGN.titleColor,
                  lineHeight: 1.1,
                  filter: TITLE_SHADOW,
                }}
              >
                {generated.title}
              </div>
              <div
                style={{
                  fontSize: `${FONT_PCT[format].subtitle}cqw`,
                  fontWeight: 900,
                  // drawIntro dessine le sous-titre en titleColor a 80 %
                  color: `${DESIGN.titleColor}CC`,
                  lineHeight: 1.1,
                  // cqw et non % : un % se resout sur la largeur du PARENT (84 %),
                  // pas sur celle du cadre. Le compositeur utilise w*4/320.
                  marginTop: '1.25cqw',
                  filter: SUBTITLE_SHADOW,
                }}
              >
                {generated.subtitle}
              </div>
            </div>
            )}

            {/* Cartes — ce conteneur est PHOTOGRAPHIÉ (modern-screenshot) et
                l'image est blittée telle quelle dans la vidéo par le
                compositeur. C'est ce qui garantit que les cartes de l'aperçu
                et celles du montage sont pixel pour pixel identiques. */}
            <div
              ref={cardsRef}
              data-cards-grid
              className="absolute flex flex-col justify-center gap-1.5"
              style={{ left: '8%', right: '8%', top: '30%', bottom: '22%' }}
            >
              {(activeOrder.includes('cards') ? generated.cards : []).map((c, i) => (
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

            {activeOrder.includes('cta') && (
            /* CTA — ancre par le BAS a ctaPos.y, centre horizontalement :
                drawCTA fait `curY = ctaPosY - blockH`, donc y designe le bas
                du bloc. Graisse 900 en dur cote compositeur. */
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: `${DESIGN.ctaPos.y}%`,
                transform: 'translate(-50%, -100%)',
                width: `${DESIGN.ctaWidth}%`,
                textAlign: 'center',
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontSize: `${FONT_PCT[format].cta}cqw`,
                  fontWeight: 900,
                  color: DESIGN.ctaColor,
                  lineHeight: 1.2,
                  textShadow: `0 0 2cqw ${DESIGN.ctaColor}66`,
                }}
              >
                {generated.cta}
              </div>
              <div
                className="uppercase"
                style={{
                  fontSize: `${FONT_PCT[format].ctaSub}cqw`,
                  fontWeight: 900,
                  color: GRADIENT_END,
                  lineHeight: 1.2,
                  marginTop: '1.25cqw',
                }}
              >
                {generated.ctaSub}
              </div>
            </div>
            )}
          </>
        )}
      </div>

      {generated && (
        <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          Les cartes de la vidéo seront exactement celles-ci. Le titre et le CTA, eux, apparaissent en séquences successives dans le montage.
        </p>
      )}
    </div>
  );
}

export default function AssistantWizard() {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);

  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [customTopic, setCustomTopic] = useState('');
  const [toneId, setToneId] = useState(TONES[0].id);
  const [format, setFormat] = useState<Format>('9:16');
  const [sequences, setSequences] = useState(DEFAULT_SEQUENCES);
  const [dragKey, setDragKey] = useState<SeqKey | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);

  const [scheduledDate, setScheduledDate] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rendu du montage
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const genTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (genTimerRef.current) clearTimeout(genTimerRef.current);
    };
  }, []);

  // Date du jour posée après le montage : la calculer pendant le rendu
  // provoquerait un écart d'hydratation entre serveur et navigateur.
  useEffect(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, []);

  /** Ordre effectif : sequences activees, dans l'ordre choisi. */
  const activeOrder = sequences.filter((s) => s.enabled).map((s) => s.key);

  const moveSequence = (from: SeqKey, to: SeqKey) => {
    if (from === to) return;
    setSequences((prev) => {
      const next = [...prev];
      const fi = next.findIndex((s) => s.key === from);
      const ti = next.findIndex((s) => s.key === to);
      if (fi === -1 || ti === -1) return prev;
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  const toggleSequence = (key: SeqKey) => {
    setSequences((prev) => {
      const next = prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      // Garde-fou : jamais zero sequence. Le compositeur retomberait sur une
      // intro d'1 s et le Calendrier afficherait une barre de progression NaN.
      return next.some((s) => s.enabled) ? next : prev;
    });
  };

  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const tone = TONES.find((t) => t.id === toneId) ?? TONES[0];
  const topicText = customTopic.trim() || theme.topic;

  // ── Génération ──────────────────────────────────────────────────────
  const runGeneration = useCallback(() => {
    setGenerating(true);
    setError(null);
    // Laisse le navigateur peindre l'état « génération » avant le calcul
    // synchrone de smart-content. Le timer est mémorisé pour être annulé au
    // démontage — même discipline que le reste du dépôt.
    if (genTimerRef.current) clearTimeout(genTimerRef.current);
    genTimerRef.current = setTimeout(() => {
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
  /**
   * Envoi au calendrier — LE point où le montage est produit.
   *
   * Cette page est la source de vérité : la vidéo est composée ICI, à partir
   * du design exact montré dans l'aperçu, puis le post est créé AVEC son
   * `renderedVideoUrl`. Le Calendrier n'a donc plus rien à recomposer : il lit
   * la vidéo telle quelle (calendar/page.tsx branche `renderedVideoUrl`).
   *
   * Ordre volontaire :
   *   1. vérification du solde   → on ne lance pas un rendu qu'on ne peut payer
   *   2. photo des cartes        → garantit apercu == video, pixel pour pixel
   *   3. composition + upload    → composeAndUpload fait les deux
   *   4. création du post
   *   5. débit des crédits       → EN DERNIER
   *
   * Le débit vient après le post, et non l'inverse : si /api/posts échoue,
   * l'utilisateur ne doit pas se retrouver débité, sans post, avec une vidéo
   * orpheline — et invité à recommencer, donc à payer une seconde fois.
   * Un échec de composition ne débite rien non plus.
   */
  const sendToCalendar = async () => {
    if (!generated || sending) return;
    setSending(true);
    setError(null);
    setRenderProgress(0);
    setRenderStage('Préparation…');

    const isReel = format === '9:16';
    // 9:16 = reel, 16:9 = tv. Même convention que l'éditeur (creer/page.tsx).
    // Inverser ces deux valeurs fait recadrer la vidéo par le Calendrier, qui
    // choisit son conteneur d'après `post.format`.
    const renderFormat: 'reel' | 'tv' = isReel ? 'reel' : 'tv';
    const cost = isReel ? COST.reel : COST.tv;

    try {
      // 1. Solde — non bloquant si l'endpoint est indisponible, comme l'éditeur.
      try {
        const check = await fetch('/api/credits/balance').then((r) => r.json());
        const balance = check?.data?.credits ?? check?.balance;
        // `check.ok` est indispensable : la route renvoie `{ok:false, balance:0}`
        // sur 401/500. Sans ce garde, une panne passagère afficherait
        // « Crédits insuffisants : 0 disponible » à un utilisateur qui en a.
        const readable = check?.success !== false && check?.ok !== false;
        if (readable && typeof balance === 'number' && balance < cost) {
          setError(`Crédits insuffisants : ${cost} requis, ${balance} disponible(s).`);
          return;
        }
      } catch {
        // On continue : un échec de lecture du solde ne doit pas bloquer.
      }

      // 2. Photo des cartes de l'aperçu (WYSIWYG). Le compositeur blitte cette
      //    image au lieu de redessiner les cartes lui-même — c'est ce qui rend
      //    l'aperçu et la vidéo strictement identiques.
      let cardsSnapshot: HTMLImageElement | undefined;
      let cardsSnapshotRect: { x: number; y: number; width: number; height: number } | undefined;
      try {
        const cardsEl = cardsRef.current;
        const previewEl = previewRef.current;
        if (cardsEl && previewEl && cardsEl.offsetWidth > 0) {
          setRenderStage('Capture de l’aperçu…');
          const { domToCanvas } = await import('modern-screenshot');
          // Les polices doivent être chargées, sinon la capture sérialise une
          // police de repli et le rendu diverge de l'écran.
          try { await (document as unknown as { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
          const videoW = isReel ? 1080 : 1920;
          const scale = videoW / (previewEl.offsetWidth || (isReel ? 320 : 512));
          const canvas = await domToCanvas(cardsEl, { backgroundColor: undefined, scale });
          const img = new Image();
          img.src = canvas.toDataURL('image/png');
          // onerror ET timeout : sans eux, une data URL qui ne se décode pas
          // laisse la promesse pendante pour toujours — le bouton reste
          // désactivé et l'utilisateur doit recharger la page.
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            const timer = setTimeout(done, 10000);
            img.onload = () => { clearTimeout(timer); done(); };
            img.onerror = () => { clearTimeout(timer); done(); };
          });
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            cardsSnapshot = img;
            const pRect = previewEl.getBoundingClientRect();
            const cRect = cardsEl.getBoundingClientRect();
            cardsSnapshotRect = {
              x: ((cRect.left - pRect.left) / pRect.width) * 100,
              y: ((cRect.top - pRect.top) / pRect.height) * 100,
              width: (cRect.width / pRect.width) * 100,
              height: (cRect.height / pRect.height) * 100,
            };
          }
        }
      } catch (err) {
        // Non fatal : sans photo, le compositeur redessine les cartes lui-même
        // (style Compact, qu'il connaît). Le rendu reste correct, simplement
        // moins fidèle au pixel près.
        console.warn('[Assistant] Capture des cartes impossible, rendu canvas de secours:', err);
      }

      // 3. Composition + upload (composeAndUpload fait les deux et produit
      //    aussi la vignette).
      setRenderStage('Rendu du montage…');
      // Cartes enrichies d'un `iconImage` : sans cela le repli canvas du
      // compositeur ecrirait « Droplet » en toutes lettres.
      const composerCards = await preRenderCardIcons(
        generated.cards.map((c) => ({
          emoji: c.icon,
          label: c.title,
          value: c.value,
          description: c.description,
          color: ACCENT,
        })),
      );
      const composed = await composeAndUpload({
        width: isReel ? 1080 : 1920,
        height: isReel ? 1920 : 1080,
        fps: 30,
        // Le compositeur ne met PAS le titre en majuscules (contrairement a
        // l'apercu, qui applique `uppercase` en CSS) : on le fait ici.
        title: (generated.title || 'Infographie').toUpperCase(),
        subtitle: generated.subtitle || undefined,
        cards: composerCards,
        // Une sequence desactivee a une duree nulle : c'est ainsi que le
        // compositeur l'exclut (conditions d'inclusion), et le Calendrier la
        // filtre pareil (`dur > 0`).
        introDuration: activeOrder.includes('intro') ? SEQ.intro : 0,
        cardsDuration: activeOrder.includes('cards') ? SEQ.cards : 0,
        videoDuration: 0,
        ctaDuration: activeOrder.includes('cta') ? SEQ.cta : 0,
        sequenceOrder: activeOrder,
        accentColor: ACCENT,
        // drawCTA lit `design.ctaMainText || watermarkText || 'AFROBOOST'` :
        // ces deux options seules ne suffisent pas, d'ou les champs `design`
        // ci-dessous. Sans eux la video affichait « AFROBOOST » en gros.
        ctaText: generated.ctaSub,
        ctaSubText: generated.ctaSub,
        watermarkText: generated.cta,
        design: {
          cardStyle: CARD_STYLE,
          // Sans ce champ : titre et CTA en Helvetica, cartes en Inter.
          font: DESIGN.font,

          // ── Fond ──────────────────────────────────────────────────────
          gradientColor1: ACCENT,
          gradientColor2: GRADIENT_END,
          gradientOpacity: DESIGN.gradientOpacity,
          // Aucune sequence en noir plein, et pas d'affiche : le backdrop
          // degrade est peint partout, exactement comme dans l'apercu.
          noColorSequences: [],

          // ── Titre : haut-gauche ───────────────────────────────────────
          titleAlign: 'left' as const,
          titleFont: DESIGN.font,
          titlePosition: { x: DESIGN.titlePos.x, y: DESIGN.titlePos.y },
          titleSize: DESIGN.titleWidth,
          titleColor: DESIGN.titleColor,

          // ── CTA : bas-centre ──────────────────────────────────────────
          // `ctaMainText` est lu EN PREMIER par drawCTA ; `ctaSubTextDesign`
          // est le nom du champ cote design pour le sous-texte.
          ctaMainText: generated.cta,
          ctaSubTextDesign: generated.ctaSub,
          watermarkPosition: { x: DESIGN.ctaPos.x, y: DESIGN.ctaPos.y },
          watermarkSize: DESIGN.ctaWidth,
          ctaColor: DESIGN.ctaColor,
          ctaSubColor: GRADIENT_END,

          // ── Cartes : image de l'apercu, blittee telle quelle ──────────
          cardsSnapshot,
          cardsSnapshotRect,
        },
        onProgress: (pct, stage) => {
          setRenderProgress(Math.max(0, Math.min(100, Math.round(pct))));
          if (stage) setRenderStage(stage);
        },
      });

      if (!composed.url) {
        setError("Le montage a été rendu mais son envoi a échoué. Réessayez.");
        return;
      }

      // 4. Création du post AVANT le débit. Dans l'autre ordre, un échec de
      //    /api/posts laissait l'utilisateur débité, sans post, avec une vidéo
      //    orpheline — et le message l'invitait à recommencer, donc à payer
      //    une seconde fois.
      setRenderStage('Finalisation…');

      // Le post, montage inclus. `renderedVideoUrl` +
      //    `thumbnailUrl` + `composerVersion` à jour : le Calendrier lit la
      //    vidéo directement et n'affiche même pas son bouton « Régénérer ».
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
        renderedVideoUrl: composed.url,
        thumbnailUrl: composed.thumbnailUrl || undefined,
        composerVersion: composed.composerVersion || CURRENT_COMPOSER_VERSION,
        // Meme source que les durees passees au compositeur : l'apercu, la
        // video et le Calendrier suivent donc strictement le meme ordre.
        sequences: {
          intro: activeOrder.includes('intro') ? SEQ.intro : 0,
          cards: activeOrder.includes('cards') ? SEQ.cards : 0,
          video: 0,
          cta: activeOrder.includes('cta') ? SEQ.cta : 0,
          total: activeOrder.reduce((t, k) => t + (SEQ[k] || 0), 0),
          order: activeOrder,
        },
        branding: {
          accentColor: ACCENT,
          ctaText: generated.cta,
          ctaSubText: generated.ctaSub,
          watermarkText: generated.cta,
          borderEnabled: false,
          borderColor: null,
        },
        design: {
          cardStyle: CARD_STYLE,
          font: DESIGN.font,
          // Persiste pour que le Calendrier (apercu HTML et regeneration)
          // ancre le titre a GAUCHE comme la video, et non centre sur x=8%.
          titleAlign: 'left',
          titleColor: DESIGN.titleColor,
          ctaColor: DESIGN.ctaColor,
          ctaSubColor: GRADIENT_END,
          ctaMainText: generated.cta,
          ctaSubText: generated.ctaSub,
          gradientColor1: ACCENT,
          gradientColor2: GRADIENT_END,
          gradientOpacity: DESIGN.gradientOpacity,
          noColorSequences: [],
          // Le Calendrier lit les positions sous `positions.*` (imbrique),
          // la ou le compositeur attend des cles a plat. On ecrit la forme
          // du Calendrier ici pour que sa reconstruction HTML de secours
          // place le titre et le CTA au meme endroit que la video.
          positions: {
            title: { x: DESIGN.titlePos.x, y: DESIGN.titlePos.y },
            watermark: { x: DESIGN.ctaPos.x, y: DESIGN.ctaPos.y },
          },
          sizes: {
            title: DESIGN.titleWidth,
            watermark: DESIGN.ctaWidth,
          },
        },
      };

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Meme casse que le titre envoye au compositeur : une recomposition
          // ulterieure repart de post.title et doit produire le meme rendu.
          title: (generated.title || 'Infographie').toUpperCase(),
          caption: generated.subtitle || '',
          media_url: composed.url,
          media_type: 'video',
          format: renderFormat,
          platforms: [],
          scheduled_date: scheduledDate,
          scheduled_time: '12:00',
          status: 'draft',
          metadata,
        }),
      });

      const json = await res.json();
      if (!json.success || !json.post?.id) {
        setError(
          res.status === 401
            ? 'Votre session a expiré. Reconnectez-vous et réessayez.'
            : "Le montage est prêt mais l'enregistrement du post a échoué.",
        );
        return;
      }
      // 5. Débit — le post existe, la vidéo est en ligne. On lit le statut :
      //    `/api/credits/deduct` répond 402 sur solde insuffisant, et un
      //    `.catch()` seul n'attrape que les erreurs réseau, pas un 402.
      try {
        const deductRes = await fetch('/api/credits/deduct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
        });
        if (!deductRes.ok) {
          console.warn(`[Assistant] Débit des crédits refusé (${deductRes.status}) — post ${json.post.id} conservé`);
        }
      } catch (e) {
        console.warn('[Assistant] Débit des crédits injoignable — post conservé:', e);
      }

      setRenderProgress(100);
      setSent(true);
    } catch (err) {
      console.error('[Assistant] Envoi au calendrier échoué:', err);
      setError(
        err instanceof Error && err.message
          ? `Le rendu a échoué : ${err.message}`
          : 'Le rendu du montage a échoué. Réessayez.',
      );
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
                    <Button variant="secondary" size="sm" disabled aria-disabled="true" className={DISABLED}>
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
                      <CardIcon name={t.icon} size={13} color="currentColor" className="inline-block mr-1.5 align-[-2px]" />
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

                {/* Sequences — reordonnables par glisser-deposer.
                    L'ordre choisi part a la fois au compositeur
                    (`sequenceOrder`) et dans `metadata.sequences.order`, donc
                    la video et l'apercu du Calendrier le suivent tous deux. */}
                <div>
                  <label className="block text-sm font-medium mb-2">Séquences</label>
                  <p className="text-xs text-gray-500 mb-2">
                    Glissez pour réordonner. L&apos;œil active ou masque une séquence.
                  </p>
                  <div className="space-y-1.5">
                    {sequences.map((seq) => {
                      const meta = SEQ_META[seq.key];
                      const position = activeOrder.indexOf(seq.key);
                      const isVideo = seq.key === 'video';
                      return (
                        <div
                          key={seq.key}
                          draggable={!isVideo}
                          onDragStart={() => setDragKey(seq.key)}
                          onDragEnd={() => setDragKey(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragKey) moveSequence(dragKey, seq.key);
                            setDragKey(null);
                          }}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                            dragKey === seq.key ? 'opacity-40' : ''
                          } ${
                            seq.enabled
                              ? 'bg-gray-900/60 ring-1 ring-purple-500/20'
                              : 'bg-gray-900/30 opacity-50'
                          } ${isVideo ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                        >
                          <GripVertical
                            className={`w-4 h-4 flex-shrink-0 ${isVideo ? 'text-gray-700' : 'text-gray-500'}`}
                          />
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={
                              seq.enabled
                                ? { backgroundColor: ACCENT, color: '#fff' }
                                : { backgroundColor: '#1F2937', color: '#6B7280' }
                            }
                          >
                            {seq.enabled ? position + 1 : '—'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{meta.label}</div>
                            <div className="text-[11px] text-gray-500 truncate">{meta.hint}</div>
                          </div>
                          <span className="text-[11px] text-gray-500 flex-shrink-0">
                            {seq.enabled ? `${SEQ[seq.key]}s` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleSequence(seq.key)}
                            disabled={isVideo}
                            title={seq.enabled ? 'Masquer' : 'Afficher'}
                            className="flex-shrink-0 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {seq.enabled ? (
                              <Eye className="w-4 h-4" />
                            ) : (
                              <EyeOff className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
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
                      {(activeOrder.includes('cards') ? generated.cards : []).map((c, i) => (
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
                      className={DISABLED}
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
                      className={DISABLED}
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
                        La vidéo est composée et le post enregistré en brouillon. Le calendrier
                        la lit telle quelle — aucun nouveau rendu n'est nécessaire.
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
                        La vidéo est composée maintenant, exactement telle que l&apos;aperçu
                        l&apos;affiche, puis enregistrée en brouillon.{' '}
                        <span className="text-gray-300">
                          {format === '9:16' ? COST.reel : COST.tv} crédits
                        </span>{' '}
                        seront débités une fois le rendu terminé.
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
                        className={DISABLED}
                      >
                        <span className="flex items-center gap-2">
                          {sending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" /> Rendu…
                            </>
                          ) : (
                            <>
                              <CalendarPlus className="w-4 h-4" /> Composer et envoyer
                            </>
                          )}
                        </span>
                      </Button>
                    </div>

                    {/* Progression du rendu — même barre fine que la page avatar */}
                    {sending && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex-1 rounded-full overflow-hidden"
                            style={{ height: 5, backgroundColor: '#1F2937' }}
                            role="progressbar"
                            aria-valuenow={renderProgress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Progression du rendu"
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${renderProgress}%`,
                                background: `linear-gradient(90deg, ${ACCENT} 0%, ${GRADIENT_END} 100%)`,
                                transition: 'width 300ms ease-out',
                              }}
                            />
                          </div>
                          <span
                            className="text-xs font-medium text-gray-400 text-right"
                            style={{ minWidth: 34, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {renderProgress}%
                          </span>
                        </div>
                        {renderStage && (
                          <p className="text-center text-xs text-gray-500">{renderStage}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="lg:col-span-2">
        <Preview
          generated={generated}
          format={format}
          previewRef={previewRef}
          cardsRef={cardsRef}
          activeOrder={activeOrder}
        />
      </div>
    </div>
  );
}

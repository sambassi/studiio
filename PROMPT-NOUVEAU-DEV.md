# PROMPT — Mission pour le nouveau developpeur

> Ce document est le briefing complet pour le developpeur (ou agent IA) qui reprend les travaux sur Studiio.
> Lire CLAUDE.md en entier AVANT de commencer.

---

## Contexte du projet

Studiio (https://studiio.pro) est une plateforme SaaS de creation de videos/infographies pour les reseaux sociaux. Le flux utilisateur est :

```
Infographie (editeur) → Studio Son (optionnel) → Export (calendrier / bureau / les deux) → Publication
```

L'utilisateur cree un montage visuel dans l'editeur `/dashboard/infographie`, peut ajouter du son dans le Studio Son `/dashboard/audio-studio`, puis exporte vers le Calendrier `/dashboard/calendar` (pour programmer une publication) et/ou sur son Bureau (telechargement local). Le montage doit etre **identique** a chaque etape.

---

## Le probleme actuel (BUG CRITIQUE)

### Symptome

Le design du montage cree par l'utilisateur dans l'editeur Infographie **ne correspond pas** a ce qui s'affiche dans la preview du Calendrier. Les couleurs, polices, tailles de texte, positions des elements, typographie (letter-spacing, line-height, bold/italic), gradient, taille du logo, etc. sont differents.

### Cause racine

Ce n'est PAS un probleme de donnees — c'est un probleme d'implementation manquante :

1. **L'export fonctionne correctement** : L'editeur Infographie envoie bien TOUS les parametres de design (30+ champs) dans `scheduled_posts.metadata.design` lors de l'export vers le calendrier.

2. **La base de donnees contient les donnees** : Le champ `metadata.design` est bien rempli avec toutes les valeurs (polices, couleurs, positions, typographie, gradient, etc.).

3. **La preview du Calendrier IGNORE les donnees** : Le code du Calendrier (`calendar/page.tsx`) ne lit JAMAIS le champ `metadata.design`. Il utilise des valeurs CSS/Tailwind **codees en dur** (hardcoded) pour rendre la preview.

### Preuve technique

**Ce que l'editeur exporte** (fichier `infographie/page.tsx`, lignes ~1074-1127) :

```typescript
design: {
  font: selectedFont,           // "Anton", "Syne", "Bebas Neue", etc.
  filter: selectedFilter,
  cardStyle: selectedCardStyle,
  textScale,                    // echelle du texte
  ctaTextScale,                 // echelle du texte CTA
  titleColor,                   // couleur du titre (ex: "#FF0000")
  ctaColor,                     // couleur du CTA
  ctaSubColor,                  // couleur du sous-titre CTA
  gradientColor1,               // couleur debut gradient
  gradientColor2,               // couleur fin gradient
  gradientOpacity,              // opacite du gradient
  positions: {
    title: { x, y },            // position du titre en %
    logo: { x, y },             // position du logo en %
    watermark: { x, y },        // position du watermark en %
    cards: { x, y },            // position des cartes en %
    overlay: { x, y },          // position du texte overlay video en %
  },
  sizes: {
    title: titleSize,           // taille du titre
    cards: cardsSize,           // taille des cartes
    watermark: watermarkSize,   // taille du watermark/CTA container
  },
  logoScale,                    // echelle du logo
  logoSequences,                // sur quelles sequences le logo apparait
  typography: {
    title: { letterSpacing, lineHeight, bold, italic },
    cta: { letterSpacing, lineHeight, bold, italic },
    overlay: { letterSpacing, lineHeight, bold, italic },
  },
  cardCustomIcons,              // icones personnalisees par carte
}
```

**Ce que le Calendrier utilise a la place** (fichier `calendar/page.tsx`, lignes ~2315-2390) :

```html
<!-- INTRO : valeurs hardcoded, ignore design.font, design.titleColor, design.positions.title -->
<h3 class="text-3xl font-black text-white uppercase tracking-wider">
<!-- ^ toujours text-3xl, toujours text-white, toujours font-black -->

<!-- BACKGROUND : gradient hardcoded, ignore design.gradientColor1/2, design.gradientOpacity -->
style="background: linear-gradient(to top, rgba(100,0,140,0.85) 0%, rgba(0,0,0,0.35) 40%, transparent 60%)"
<!-- ^ toujours violet/noir, jamais les couleurs du design -->

<!-- CARTES : fond hardcoded, ignore design.cardStyle -->
<div class="bg-gradient-to-b from-purple-950 via-gray-900 to-black">
<!-- ^ toujours ce degradee, jamais le style de carte choisi -->

<!-- LOGO : taille hardcoded 160x160, ignore design.logoScale -->
<img class="w-40 h-40">
<!-- ^ toujours 40x40 (160px), jamais la taille choisie -->

<!-- CTA : couleur limitee a accent, ignore design.ctaColor, design.ctaSubColor, design.ctaTextScale -->
style="color: accent"
<!-- ^ toujours accent, jamais ctaColor du design -->
```

**Interface TypeScript incomplete** (fichier `calendar/page.tsx`, lignes 53-85) :

```typescript
interface PostMetadata {
  // ... champs existants ...
  // ❌ MANQUANT : design?: { ... }
  // Le type ne declare meme pas le champ "design"
}
```

---

## Objectif de la mission

### Resultat attendu

L'utilisateur fait son montage dans l'editeur Infographie → il voit **exactement le meme design** dans la preview du Calendrier, dans l'export Bureau, et dans la video publiee. C'est la meme chose partout.

### Flux complet qui doit fonctionner de bout en bout

```
1. CREER   → Editeur Infographie : l'utilisateur choisit polices, couleurs, positions, etc.
2. SON     → Studio Son (optionnel) : ajouter musique et/ou voix
3. EXPORT  → Calendrier ET/OU Bureau : le design est IDENTIQUE au montage
4. PREVIEW → Calendrier : la preview modale montre le MEME design
5. PUBLIER → Publication programmee : la video publiee a le MEME design
```

---

## Plan d'implementation

### Etape 1 : Ajouter `design` a l'interface TypeScript du Calendrier

**Fichier** : `src/app/dashboard/calendar/page.tsx`
**Lignes** : 53-85

Ajouter le champ `design?` a l'interface `PostMetadata` pour que TypeScript connaisse la structure :

```typescript
interface PostMetadata {
  // ... champs existants ...
  design?: {
    font?: string;
    filter?: string;
    cardStyle?: string;
    textScale?: number;
    ctaTextScale?: number;
    titleColor?: string;
    ctaColor?: string;
    ctaSubColor?: string;
    ctaMainText?: string;
    ctaSubText?: string;
    noColorBg?: boolean;
    noColorSequences?: boolean;
    gradientColor1?: string;
    gradientColor2?: string;
    gradientOpacity?: number;
    positions?: {
      title?: { x: number; y: number };
      logo?: { x: number; y: number };
      watermark?: { x: number; y: number };
      cards?: { x: number; y: number };
      overlay?: { x: number; y: number };
    };
    sizes?: {
      title?: number;
      cards?: number;
      watermark?: number;
    };
    logoScale?: number;
    logoSequences?: string[];
    logoUrl?: string;
    typography?: {
      title?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
      cta?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
      overlay?: { letterSpacing?: number; lineHeight?: number; bold?: boolean; italic?: boolean };
    };
    cardCustomIcons?: Record<string, string>;
  };
}
```

### Etape 2 : Extraire les valeurs du design dans la preview

**Fichier** : `src/app/dashboard/calendar/page.tsx`
**Apres la ligne ~2251** (dans le bloc `showFullPreview`)

Ajouter l'extraction des valeurs design avec des fallbacks par defaut :

```typescript
const design = meta?.design;
const designFont = design?.font || 'sans-serif';
const designTitleColor = design?.titleColor || '#FFFFFF';
const designCtaColor = design?.ctaColor || accent;
const designCtaSubColor = design?.ctaSubColor || '#FFFFFF';
const designCtaTextScale = design?.ctaTextScale || 1.0;
const designTextScale = design?.textScale || 1.0;
const designGradient1 = design?.gradientColor1 || '#7C3AED';
const designGradient2 = design?.gradientColor2 || '#000000';
const designGradientOpacity = design?.gradientOpacity ?? 0.6;
const designLogoScale = design?.logoScale || 1.0;
const titleTypo = design?.typography?.title || {};
const ctaTypo = design?.typography?.cta || {};
const overlayTypo = design?.typography?.overlay || {};
const positions = design?.positions || {};
const sizes = design?.sizes || {};
```

### Etape 3 : Remplacer les valeurs hardcoded dans le rendu HTML

C'est le gros du travail. Pour chaque sequence (intro, cartes, video, CTA), remplacer les classes Tailwind et styles inline hardcoded par les valeurs extraites du design.

#### Sequence INTRO (~lignes 2315-2324)

**AVANT** (hardcoded) :
```jsx
<h3 className="text-3xl font-black text-white uppercase tracking-wider">
```

**APRES** (utilise les donnees design) :
```jsx
<h3 style={{
  fontFamily: designFont,
  color: designTitleColor,
  fontSize: `${(sizes.title || 30) * designTextScale}px`,
  letterSpacing: `${titleTypo.letterSpacing || 0}px`,
  lineHeight: titleTypo.lineHeight || 1.1,
  fontWeight: titleTypo.bold !== false ? 900 : 400,
  fontStyle: titleTypo.italic ? 'italic' : 'normal',
  textTransform: 'uppercase',
  textShadow: `0 0 20px ${accent}CC, 0 0 50px ${accent}66`,
  position: positions.title ? 'absolute' : undefined,
  left: positions.title ? `${positions.title.x}%` : undefined,
  top: positions.title ? `${positions.title.y}%` : undefined,
  transform: positions.title ? 'translate(-50%, -50%)' : undefined,
}}>
```

**Gradient fond INTRO** — remplacer le `linear-gradient(to top, rgba(100,0,140,0.85)...)` hardcoded :
```jsx
style={{
  background: posterImgSrc
    ? `linear-gradient(to top, ${designGradient1}${Math.round(designGradientOpacity * 255).toString(16)} 0%, ${designGradient2}59 40%, transparent 60%)`
    : 'transparent'
}}
```

#### Sequence CARTES (~lignes 2326-2347)

Remplacer le fond `bg-gradient-to-b from-purple-950 via-gray-900 to-black` par un gradient utilisant `designGradient1` et `designGradient2`.

Si `design.cardCustomIcons` existe, utiliser les icones personnalisees au lieu des emojis par defaut.

Appliquer `design.cardStyle` pour varier l'apparence des cartes (bords arrondis, fond, etc.).

#### Sequence VIDEO (~lignes 2349-2373)

Le texte overlay utilise des valeurs hardcoded. Appliquer `overlayTypo` :

```jsx
<p style={{
  fontFamily: designFont,
  color: design?.overlayColor || '#FFFFFF',
  letterSpacing: `${overlayTypo.letterSpacing || 0}px`,
  lineHeight: overlayTypo.lineHeight || 1.15,
  fontWeight: overlayTypo.bold !== false ? 900 : 400,
  fontStyle: overlayTypo.italic ? 'italic' : 'normal',
  position: positions.overlay ? 'absolute' : undefined,
  left: positions.overlay ? `${positions.overlay.x}%` : undefined,
  top: positions.overlay ? `${positions.overlay.y}%` : undefined,
}}>
```

#### Sequence CTA (~lignes 2375-2383)

**AVANT** :
```jsx
<img className="w-40 h-40" />  <!-- logo toujours 160px -->
<p style={{ color: accent }}>   <!-- CTA toujours accent -->
<p style={{ color: '#FFFFFF' }}> <!-- sous-titre toujours blanc -->
```

**APRES** :
```jsx
<img style={{
  width: `${160 * designLogoScale}px`,
  height: `${160 * designLogoScale}px`,
}} />
<p style={{
  fontFamily: designFont,
  color: designCtaColor,
  fontSize: `${30 * designCtaTextScale}px`,
  letterSpacing: `${ctaTypo.letterSpacing || 2}px`,
  lineHeight: ctaTypo.lineHeight || 1.2,
  fontWeight: ctaTypo.bold !== false ? 900 : 400,
  fontStyle: ctaTypo.italic ? 'italic' : 'normal',
}}>
<p style={{
  color: designCtaSubColor,
  fontFamily: designFont,
}}>
```

#### Logo sur toutes les sequences

Si `design.logoSequences` est defini, afficher le logo uniquement sur les sequences listees. Si `design.logoUrl` existe, l'afficher a la position `design.positions.logo` avec l'echelle `design.logoScale`.

### Etape 4 : Verifier l'export Bureau

**Fichier** : `src/app/dashboard/infographie/page.tsx`, lignes ~1136-1180

L'export Bureau telecharge actuellement 3 fichiers : poster, video rush, config JSON. Verifier que :
- Le fichier JSON contient bien TOUTES les valeurs design (comparer avec l'export calendrier)
- Le poster telecharge est bien l'image utilisee dans le montage
- La video rush est bien le fichier original

### Etape 5 : Verifier la coherence avec le video-composer

**Fichier** : `src/lib/video-composer.ts`

Le compositeur video (`composeVideo()`) est celui qui genere le fichier WebM final. Verifier qu'il recoit et utilise les memes parametres de design que ceux stockes dans metadata. Si le compositeur dessine le titre en blanc hardcode alors que l'utilisateur a choisi rouge, la video publiee ne correspondra pas non plus.

---

## Fichiers a modifier

| Fichier | Modification | Effort |
|---------|-------------|--------|
| `src/app/dashboard/calendar/page.tsx` | Ajouter `design` au type, extraire les valeurs, remplacer ~75 valeurs hardcoded | **Gros** |
| `src/lib/video-composer.ts` | Verifier que tous les params design sont utilises pour le rendu video | Moyen |
| `src/app/dashboard/infographie/page.tsx` | Verifier que l'export bureau est complet | Petit |

---

## Checklist de validation

Quand le travail est termine, verifier chaque point :

- [ ] L'interface `PostMetadata` dans `calendar/page.tsx` inclut le champ `design`
- [ ] La preview du Calendrier lit `metadata.design` et l'applique a CHAQUE sequence
- [ ] La police choisie dans l'editeur s'affiche dans la preview du Calendrier
- [ ] La couleur du titre choisie dans l'editeur s'affiche dans la preview
- [ ] Le gradient (couleurs + opacite) correspond entre editeur et calendrier
- [ ] La taille et position du logo correspondent
- [ ] Le texte CTA utilise `ctaColor`, `ctaSubColor`, `ctaTextScale` du design
- [ ] La typographie (letter-spacing, line-height, bold, italic) est appliquee
- [ ] Les positions personnalisees (titre, logo, overlay) sont respectees
- [ ] Les icones personnalisees des cartes s'affichent si presentes
- [ ] L'export Bureau telecharge les 3 fichiers (poster, video, config JSON)
- [ ] Le JSON de config contient les memes donnees que le metadata du calendrier
- [ ] Le compositeur video (`video-composer.ts`) utilise les memes parametres
- [ ] Les 10 posts existants (sans champ `design`) s'affichent toujours correctement avec les fallbacks
- [ ] Le flux complet fonctionne : creer → son (optionnel) → exporter → preview → publier

---

## Contraintes techniques

- **Ne pas casser les anciens posts** : Les 10 posts existants n'ont PAS de champ `metadata.design`. Tous les acces doivent utiliser `?.` (optional chaining) et des valeurs par defaut.
- **Inline styles obligatoires** : Les valeurs dynamiques (couleurs, tailles, positions) doivent etre en inline `style={}`, jamais en classes Tailwind dynamiques (elles sont purgees en production).
- **Polices Google Fonts** : Les 5 polices (Anton, Syne, Bebas Neue, Poppins, Space Grotesk) sont chargees via `next/font/google` dans `layout.tsx`. Verifier qu'elles sont accessibles dans le Calendrier via les CSS variables.
- **WebM, pas MP4** : Le compositeur doit toujours produire du WebM (VP9/VP8) en mode fast. Chrome corrompt les MP4 en mode fast.
- **Deploiement** : Chaque push sur `main` declenche un auto-deploy Vercel (~45-60s). Tester sur https://studiio.pro apres chaque push.

---

## Pour commencer

1. Lire `CLAUDE.md` en entier (guide complet du projet)
2. Lire `README.md` pour la reference des routes API
3. Ouvrir `src/app/dashboard/infographie/page.tsx` et chercher la fonction d'export (~ligne 1040) pour voir les donnees envoyees
4. Ouvrir `src/app/dashboard/calendar/page.tsx` et chercher "Full Preview Modal" (~ligne 2248) pour voir le rendu actuel
5. Commencer par l'Etape 1 (interface TypeScript), puis Etape 2 (extraction), puis Etape 3 (remplacement des hardcoded)
6. Tester en local avec `npm run dev`, creer un montage, exporter vers calendrier, ouvrir la preview et comparer visuellement

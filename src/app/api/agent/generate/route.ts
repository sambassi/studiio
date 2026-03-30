import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

type AgentObjective = 'promotion' | 'abonnement' | 'motivation' | 'bienfaits' | 'nutrition';
type AgentCaptionStyle = 'motivant' | 'vendeur' | 'educatif';

const AGENT_PHRASES: Record<AgentObjective, string[]> = {
  promotion: [
    'OFFRE SPECIALE', 'BOOSTE TON ENERGIE', 'RESERVE VITE',
    'PROMO FLASH', 'DEAL EXCLUSIF', 'PLACES LIMITEES',
    'DERNIERE CHANCE', 'TARIF REDUIT',
  ],
  abonnement: [
    'ESSAI OFFERT', 'REJOINS LA TRIBU', 'ABONNE-TOI',
    'COURS ILLIMITES', 'SANS ENGAGEMENT', '1er MOIS OFFERT',
    'ACCES VIP', 'MEMBRE PREMIUM',
  ],
  motivation: [
    'DISCIPLINE', 'DEPASSE-TOI', 'NO EXCUSES', 'VIBE UNIQUE',
    'RESTE FOCUS', 'ZERO LIMITE', 'GRIND MODE', 'LACHE RIEN',
  ],
  bienfaits: [
    'SANTE PHYSIQUE', 'MENTAL D\'ACIER', 'BIEN-ETRE TOTAL',
    'CORPS & ESPRIT', 'ENERGIE VITALE', 'CONFIANCE EN SOI',
    'ANTI-STRESS', 'FEEL GOOD',
  ],
  nutrition: [
    'REEQUILIBRAGE', 'ENERGIE NATURELLE', 'ZERO FRUSTRATION',
    'NUTRITION SMART', 'REPAS EQUILIBRE', 'FUEL TON CORPS',
    'PROTEINES POWER', 'EAT CLEAN',
  ],
};

const AGENT_HASHTAGS: Record<AgentCaptionStyle, string[]> = {
  motivant: [
    '#Afroboost', '#FitnessSuisse', '#AfrobeatVibe', '#CardioAfro',
    '#DanseFitness', '#LaPisteTAttend', '#EnergieAfrobeat', '#BoostTonCorps',
    '#FitMotivation', '#DanceWorkout', '#AfrobeatFitness', '#SuisseFit',
    '#CoachBassi', '#CaVaDanser', '#FitnessVibes', '#AfroFitness',
  ],
  vendeur: [
    '#Afroboost', '#CoursCardio', '#FitnessSuisse', '#OffreSpeciale',
    '#EssaiGratuit', '#DanseFitness', '#RejoinsLaTribu', '#AfrobeatVibe',
    '#ReserveMaintenant', '#PromoFitness', '#PackDecouverte', '#CoachBassi',
    '#FitnessAbordable', '#SportSuisse', '#AbonnementSport',
  ],
  educatif: [
    '#Afroboost', '#NutritionSport', '#BienEtre', '#SanteFitness',
    '#ConseilsFitness', '#FitnessSuisse', '#AfrobeatVibe', '#CorpsEtEsprit',
    '#EquilibreAlimentaire', '#FitTips', '#EntrainementSain', '#CoachBassi',
    '#Wellness', '#SanteMentale', '#HydratationSport',
  ],
};

const CAPTION_TEMPLATES: Record<AgentCaptionStyle, Record<AgentObjective, string[]>> = {
  motivant: {
    promotion: [
      '{phrase}\n\nL\'energie Afroboost t\'attend ! Reserve ta place et viens vibrer avec nous\n\nafroboost.com\n\n{hashtags}',
    ],
    abonnement: [
      '{phrase}\n\nRejoins la tribu Afroboost ! Premier cours offert, viens tester l\'experience\n\nafroboost.com\n\n{hashtags}',
    ],
    motivation: [
      '{phrase}\n\nPas d\'excuse. Juste toi, la musique et ta meilleure version\n\nAfroboost - La piste t\'attend !\n\n{hashtags}',
    ],
    bienfaits: [
      '{phrase}\n\nLa danse afrobeat + cardio = cocktail magique pour ton corps ET ton esprit\n\nafroboost.com\n\n{hashtags}',
    ],
    nutrition: [
      '{phrase}\n\nTon corps est ton temple. Nourris-le bien, entraine-le mieux avec Afroboost\n\nafroboost.com\n\n{hashtags}',
    ],
  },
  vendeur: {
    promotion: ['{phrase}\n\nOFFRE SPECIALE AFROBOOST\n\nCardio + afrobeat + casques immersifs = le cours le plus FUN\n\nReserve vite !\n\n{hashtags}'],
    abonnement: ['{phrase}\n\nABONNEMENT AFROBOOST\n\nAcces illimite a tous nos cours. Essai gratuit cette semaine !\n\n{hashtags}'],
    motivation: ['{phrase}\n\nViens te depasser chez Afroboost. Reserve ton prochain cours maintenant\n\n{hashtags}'],
    bienfaits: ['{phrase}\n\nInvestis dans ta sante avec Afroboost. Corps et esprit te remercieront\n\n{hashtags}'],
    nutrition: ['{phrase}\n\nNutrition + fitness = resultats. Decouvre nos conseils avec ton abonnement Afroboost\n\n{hashtags}'],
  },
  educatif: {
    promotion: ['{phrase}\n\nSavais-tu que l\'Afroboost combine les bienfaits du cardio et de la danse ? Essaie par toi-meme !\n\n{hashtags}'],
    abonnement: ['{phrase}\n\nPourquoi s\'abonner ? Parce que la regularite est la cle. Avec Afroboost, chaque cours compte\n\n{hashtags}'],
    motivation: ['{phrase}\n\nFait scientifique : l\'exercice libere des endorphines qui boostent ton moral naturellement\n\n{hashtags}'],
    bienfaits: ['{phrase}\n\nLe cardio-danse afrobeat c\'est prouve : meilleure sante cardio, coordination, reduction du stress\n\n{hashtags}'],
    nutrition: ['{phrase}\n\nConseil du Coach : 2h avant le cours, un repas leger. 30min apres, proteines + glucides\n\n{hashtags}'],
  },
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateCaption(
  objective: AgentObjective,
  style: AgentCaptionStyle,
): { caption: string; hashtags: string[] } {
  const phrase = pickRandom(AGENT_PHRASES[objective]);
  const templates = CAPTION_TEMPLATES[style][objective];
  const template = pickRandom(templates);
  const hashtagPool = AGENT_HASHTAGS[style];
  const shuffled = shuffleArray(hashtagPool);
  const selectedHashtags = shuffled.slice(0, Math.floor(Math.random() * 5) + 8);
  const hashtagStr = selectedHashtags.join(' ');

  const caption = template
    .replace('{phrase}', phrase)
    .replace('{hashtags}', hashtagStr);

  return { caption, hashtags: selectedHashtags };
}

// POST /api/agent/generate - Generate 30-day content plan
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      planDays = 30,
      postsPerDay = 1,
      networks = ['Instagram', 'TikTok'],
      objectives = ['promotion', 'motivation', 'bienfaits', 'abonnement', 'nutrition'],
      captionStyle = 'motivant' as AgentCaptionStyle,
      defaultTime = '18:00',
      format = 'reel',
    } = body;

    if (planDays < 1 || planDays > 90) {
      return NextResponse.json({ success: false, error: 'planDays must be 1-90' }, { status: 400 });
    }

    // Create agent plan record
    const { data: plan, error: planError } = await supabase
      .from('agent_plans')
      .insert({
        user_id: session.user.id,
        config: { planDays, postsPerDay, networks, objectives, captionStyle, defaultTime, format },
        plan_days: planDays,
        stats: {},
        status: 'active',
      })
      .select()
      .single();

    if (planError) {
      console.error('Failed to create agent plan:', planError);
      return NextResponse.json({ success: false, error: 'Failed to create plan' }, { status: 500 });
    }

    // Generate drafts for each day
    const totalPosts = planDays * postsPerDay;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1); // Start tomorrow
    const createdPosts = [];

    for (let i = 0; i < totalPosts; i++) {
      const dayOffset = Math.floor(i / postsPerDay);
      const postDate = new Date(startDate);
      postDate.setDate(postDate.getDate() + dayOffset);

      // Rotate objectives
      const objective = objectives[i % objectives.length] as AgentObjective;

      // Generate caption
      const { caption, hashtags } = generateCaption(objective, captionStyle);

      // Create scheduled post
      const { data: post, error: postError } = await supabase
        .from('scheduled_posts')
        .insert({
          user_id: session.user.id,
          title: pickRandom(AGENT_PHRASES[objective]),
          caption,
          media_type: 'video',
          format: format === 'tv' ? 'tv' : 'reel',
          platforms: networks,
          scheduled_date: formatDate(postDate),
          scheduled_time: defaultTime,
          status: 'draft',
          agent_plan_id: plan.id,
          agent_generated: true,
          metadata: {
            objective,
            captionStyle,
            hashtags,
            renderSeed: Date.now() + i * 1000,
          },
        })
        .select()
        .single();

      if (post) {
        createdPosts.push({
          id: post.id,
          date: formatDate(postDate),
          title: post.title,
          objective,
        });
      }
    }

    // Update plan stats
    await supabase
      .from('agent_plans')
      .update({
        stats: {
          totalDrafts: createdPosts.length,
          daysPlanned: planDays,
          postsPerDay,
        },
        status: 'completed',
      })
      .eq('id', plan.id);

    return NextResponse.json({
      success: true,
      plan: {
        id: plan.id,
        daysPlanned: planDays,
        totalDrafts: createdPosts.length,
        posts: createdPosts,
      },
    });
  } catch (error) {
    console.error('Agent generate error:', error);
    return NextResponse.json({ success: false, error: 'Agent generation failed' }, { status: 500 });
  }
}

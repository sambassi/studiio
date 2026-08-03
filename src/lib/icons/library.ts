/**
 * Bibliotheque d'icones, rangee par categorie.
 *
 * Extraite de `dashboard/creer/page.tsx` pour que le Mode simple s'en serve
 * aussi : la dupliquer aurait fait une source de verite de plus, alors que le
 * depot en compte deja deux pour les icones (`ICON_MAP` cote editeur avance et
 * `CARD_ICON_MAP` cote `CardIcon`), duplication que CLAUDE.md signale comme
 * une source de bug latente.
 *
 * Ce module ne porte que des NOMS. La resolution nom -> composant reste a
 * `CardIcon`, seul endroit ou les imports lucide sont explicites — le
 * tree-shaking de production supprime les icones resolues dynamiquement.
 */

export const ICON_LIBRARY: Record<string, string[]> = {
  sport:       ['Dumbbell', 'Flame', 'Zap', 'Trophy', 'Target', 'Activity', 'Bike', 'Medal', 'Crown'],
  santé:       ['Heart', 'Brain', 'Stethoscope', 'Pill', 'Cross', 'HeartPulse', 'Syringe', 'Thermometer', 'Bone', 'Droplet', 'Eye'],
  nutrition:   ['Apple', 'Carrot', 'Salad', 'Coffee', 'Pizza', 'Utensils', 'Wheat', 'Egg', 'Milk'],
  temps:       ['Clock', 'Timer', 'AlarmClock', 'Watch', 'Hourglass', 'Calendar', 'CalendarDays', 'CalendarCheck', 'CalendarClock', 'Sunrise', 'Sunset'],
  nature:      ['Leaf', 'Sun', 'Moon', 'Star', 'Cloud', 'Flower', 'TreePine', 'Sprout', 'Trees', 'TreeDeciduous', 'Waves', 'Mountain'],
  météo:       ['CloudRain', 'CloudSnow', 'Snowflake', 'Wind', 'Umbrella', 'Rainbow'],
  tech:        ['Laptop', 'Smartphone', 'Cpu', 'Wifi', 'Battery', 'Code', 'Bot', 'Database', 'Server', 'Terminal', 'Bug', 'FileCode'],
  finance:     ['DollarSign', 'TrendingUp', 'TrendingDown', 'Gem', 'Briefcase', 'Wallet', 'BarChart', 'PieChart', 'Receipt', 'HandCoins', 'Landmark', 'PiggyBank', 'Coins'],
  multimedia:  ['Palette', 'Camera', 'Music', 'Mic', 'Video', 'PenTool', 'Brush', 'Paintbrush', 'Image', 'Aperture', 'Clapperboard', 'Disc', 'Volume2', 'Headphones', 'Speaker', 'Radio', 'Podcast'],
  loisirs:     ['Gamepad2', 'Joystick', 'Puzzle', 'Diamond'],
  voyage:      ['Plane', 'Globe', 'Map', 'Compass', 'MapPin', 'MapPinned', 'Route', 'Hotel', 'Tent', 'Navigation', 'Flag', 'Anchor', 'Sailboat', 'Footprints'],
  émotions:    ['Smile', 'Frown', 'Meh', 'Laugh', 'Award', 'ThumbsUp', 'Gift', 'Bell', 'Megaphone', 'PartyPopper', 'Sparkles', 'Cake', 'Crown'],
  famille:     ['Baby', 'Users', 'User', 'UserPlus', 'PersonStanding'],
  animaux:     ['Dog', 'Cat', 'Bird', 'Fish', 'Rabbit', 'Turtle'],
  logement:    ['Home', 'Building', 'Store', 'Warehouse', 'Factory', 'Church'],
  transport:   ['Car', 'Bike', 'Train', 'Rocket', 'Ship', 'Bus', 'Truck'],
  communication: ['Mail', 'MessageSquare', 'MessageCircle', 'Send', 'Inbox', 'Archive'],
  outils:      ['Clipboard', 'ClipboardList', 'FileText', 'File', 'Folder', 'FolderOpen', 'Filter', 'Settings2', 'Wrench', 'Hammer', 'Scissors'],
  sécurité:    ['Shield', 'ShieldCheck', 'ShieldAlert', 'Lock', 'Unlock', 'Key', 'Fingerprint'],
  énergie:     ['Plug', 'Power', 'BatteryCharging', 'Signal'],
  shopping:    ['ShoppingBag', 'ShoppingCart', 'Tag', 'Package', 'CreditCard'],
  education:   ['Book', 'GraduationCap', 'Lightbulb', 'Library', 'Pencil', 'Ruler'],
};

/**
 * Synonymes francais pour la recherche. Ne couvre qu'une partie des icones :
 * la recherche retombe sur le nom lucide quand un terme manque.
 */
export const ICON_KEYWORDS: Record<string, string[]> = {
  Clock: ['horaire', 'heure', 'temps', 'clock'], Timer: ['chrono', 'compteur'],
  AlarmClock: ['alarme', 'réveil'], Watch: ['montre'], Hourglass: ['sablier', 'attente'],
  Calendar: ['calendrier', 'date'], CalendarDays: ['semaine'], CalendarCheck: ['rdv', 'rendez-vous'],
  CalendarClock: ['planning'], Sunrise: ['matin', 'lever'], Sunset: ['soir', 'coucher'],
  Heart: ['coeur', 'amour'], Brain: ['cerveau', 'intelligence'], Dumbbell: ['haltère', 'musculation'],
  Apple: ['pomme'], Coffee: ['café'], Music: ['musique'], Camera: ['photo', 'appareil'],
  Home: ['maison'], Car: ['voiture', 'auto'], Plane: ['avion'], Globe: ['monde', 'terre'],
  Mail: ['email', 'courrier'], Lock: ['verrou', 'cadenas'], Key: ['clé'],
  Shield: ['bouclier', 'protection'], Star: ['étoile', 'favori'],
  Headphones: ['casque', 'audio'], Mic: ['micro', 'enregistrement'],
};

/** Tous les noms d'icones de la bibliotheque, a plat. */
export const ALL_LUCIDE_NAMES: string[] = Object.values(ICON_LIBRARY).flat();

/**
 * Une icone correspond-elle a une recherche ?
 *
 * Le nom lucide est en anglais : sans les synonymes, chercher « haltere » ne
 * trouverait rien.
 */
export function iconMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  return (ICON_KEYWORDS[name] ?? []).some((k) => k.toLowerCase().includes(q));
}

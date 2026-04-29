'use client';

import React from 'react';
import {
  ThumbsUp, Heart, Brain, Flame, Zap, Sparkles, Trophy, Target, Dumbbell, Activity, Bike,
  Apple, Carrot, Salad, Coffee, Pizza, Utensils, Wheat,
  Leaf, Sun, Moon, Star, Cloud, Flower, TreePine, Sprout, Trees, TreeDeciduous, Waves,
  Laptop, Smartphone, Cpu, Wifi, Battery, Code, Bot, Database, Server, Terminal, Bug, FileCode,
  DollarSign, TrendingUp, TrendingDown, Gem, Briefcase, Wallet, BarChart, BarChart2, BarChart3, PieChart, Receipt, HandCoins, Landmark, PiggyBank, Coins,
  Palette, Camera, Music, Mic, Video, PenTool, Brush, Paintbrush, Image as LucideImage, Aperture, Clapperboard, Disc, Volume2, Headphones, Speaker, Radio, Podcast,
  Plane, Globe, Map, Mountain, Compass, MapPin, MapPinned, Route, Hotel, Tent, Navigation, Flag, Anchor, Sailboat, Footprints,
  Smile, Frown, Meh, Laugh, Award, Gift, Bell, Megaphone, PartyPopper, Cake, Crown, Diamond, Medal,
  Dog, Cat, Bird, Fish, Rabbit, Turtle,
  Home, Building, Car, Train, Rocket, Ship, Bus, Store, Warehouse, Factory, Church,
  ShoppingBag, ShoppingCart, Tag, Package, Truck, CreditCard,
  Book, GraduationCap, Lightbulb, Library, Pencil, Ruler, Scissors,
  Stethoscope, Pill, Cross, HeartPulse, Syringe, Thermometer, Bone,
  Clock, Timer, AlarmClock, Watch, Hourglass, Calendar, CalendarDays, CalendarCheck, CalendarClock, Sunrise, Sunset,
  Baby, Users, User, UserPlus, PersonStanding,
  CloudRain, CloudSnow, Snowflake, Wind, Umbrella, Rainbow,
  Gamepad2, Joystick, Puzzle,
  Clipboard, ClipboardList, FileText, File, Folder, FolderOpen, Archive, Inbox, Mail, MessageSquare, MessageCircle, Send as SendIcon,
  Filter, Settings2, Wrench, Hammer,
  Shield, ShieldCheck, ShieldAlert, Lock, Unlock, Key, Fingerprint,
  Plug, Power, BatteryCharging, Signal,
  type LucideIcon,
} from 'lucide-react';

// Single source of truth for the lucide icon set used across the app
// (cards picker in /creer, card preview in /creer + /calendar). Must mirror
// the ICON_LIBRARY listing in /creer/page.tsx exactly — adding an icon to
// one place but not the other makes the calendar preview show a missing icon.
export const CARD_ICON_MAP: Record<string, LucideIcon> = {
  ThumbsUp, Heart, Brain, Flame, Zap, Sparkles, Trophy, Target, Dumbbell, Activity, Bike,
  Apple, Carrot, Salad, Coffee, Pizza, Utensils, Wheat,
  Leaf, Sun, Moon, Star, Cloud, Flower, TreePine, Sprout, Trees, TreeDeciduous, Waves,
  Laptop, Smartphone, Cpu, Wifi, Battery, Code, Bot, Database, Server, Terminal, Bug, FileCode,
  DollarSign, TrendingUp, TrendingDown, Gem, Briefcase, Wallet, BarChart, BarChart2, BarChart3, PieChart, Receipt, HandCoins, Landmark, PiggyBank, Coins,
  Palette, Camera, Music, Mic, Video, PenTool, Brush, Paintbrush, Image: LucideImage, Aperture, Clapperboard, Disc, Volume2, Headphones, Speaker, Radio, Podcast,
  Plane, Globe, Map, Mountain, Compass, MapPin, MapPinned, Route, Hotel, Tent, Navigation, Flag, Anchor, Sailboat, Footprints,
  Smile, Frown, Meh, Laugh, Award, Gift, Bell, Megaphone, PartyPopper, Cake, Crown, Diamond, Medal,
  Dog, Cat, Bird, Fish, Rabbit, Turtle,
  Home, Building, Car, Train, Rocket, Ship, Bus, Store, Warehouse, Factory, Church,
  ShoppingBag, ShoppingCart, Tag, Package, Truck, CreditCard,
  Book, GraduationCap, Lightbulb, Library, Pencil, Ruler, Scissors,
  Stethoscope, Pill, Cross, HeartPulse, Syringe, Thermometer, Bone,
  Clock, Timer, AlarmClock, Watch, Hourglass, Calendar, CalendarDays, CalendarCheck, CalendarClock, Sunrise, Sunset,
  Baby, Users, User, UserPlus, PersonStanding,
  CloudRain, CloudSnow, Snowflake, Wind, Umbrella, Rainbow,
  Gamepad2, Joystick, Puzzle,
  Clipboard, ClipboardList, FileText, File, Folder, FolderOpen, Archive, Inbox, Mail, MessageSquare, MessageCircle, Send: SendIcon,
  Filter, Settings2, Wrench, Hammer,
  Shield, ShieldCheck, ShieldAlert, Lock, Unlock, Key, Fingerprint,
  Plug, Power, BatteryCharging, Signal,
};

interface CardIconProps {
  name: string;
  /**
   * Icon dimension. Number → px. String → any valid CSS length (e.g. `'1.5dvh'`,
   * `'2em'`). Forwarded to lucide's Icon `size` prop and to the emoji-fallback
   * `<span>`'s fontSize. Defaults to 16 (px).
   */
  size?: number | string;
  color?: string;
  className?: string;
}

export function CardIcon({ name, size = 16, color, className = 'text-purple-400' }: CardIconProps) {
  const Icon = CARD_ICON_MAP[name];
  if (Icon) return <Icon size={size as any} color={color} className={className} />;
  // Fallback: render as emoji text
  return <span style={{ fontSize: size }}>{name}</span>;
}

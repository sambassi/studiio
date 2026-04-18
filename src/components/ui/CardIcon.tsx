'use client';

import React from 'react';
import {
  Heart, Brain, Flame, Zap, Sparkles, Trophy, Target, Dumbbell, Activity,
  Apple, Coffee, Utensils, Leaf, Sun, Moon, Star, Clock, Calendar,
  Laptop, Code, Bot, DollarSign, TrendingUp, Wallet,
  Palette, Camera, Music, Mic, Video, PenTool,
  Plane, Globe, Map, Mountain, Compass, MapPin,
  Smile, Award, Gift, Bell, Megaphone, PartyPopper,
  Dog, Cat, Bird, Fish, Home, Building, Car, Rocket,
  ShoppingBag, ShoppingCart, Book, GraduationCap, Lightbulb,
  Stethoscope, Pill, HeartPulse, Baby, Users, User,
  Shield, Lock, Key, Crown, Diamond, Medal, Cake,
  Headphones, Volume2, Footprints, Anchor, Puzzle,
  Timer, AlarmClock, Sunrise, Sunset,
  type LucideIcon,
} from 'lucide-react';

const CARD_ICON_MAP: Record<string, LucideIcon> = {
  Heart, Brain, Flame, Zap, Sparkles, Trophy, Target, Dumbbell, Activity,
  Apple, Coffee, Utensils, Leaf, Sun, Moon, Star, Clock, Calendar,
  Laptop, Code, Bot, DollarSign, TrendingUp, Wallet,
  Palette, Camera, Music, Mic, Video, PenTool,
  Plane, Globe, Map, Mountain, Compass, MapPin,
  Smile, Award, Gift, Bell, Megaphone, PartyPopper,
  Dog, Cat, Bird, Fish, Home, Building, Car, Rocket,
  ShoppingBag, ShoppingCart, Book, GraduationCap, Lightbulb,
  Stethoscope, Pill, HeartPulse, Baby, Users, User,
  Shield, Lock, Key, Crown, Diamond, Medal, Cake,
  Headphones, Volume2, Footprints, Anchor, Puzzle,
  Timer, AlarmClock, Sunrise, Sunset,
};

interface CardIconProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}

export function CardIcon({ name, size = 16, color, className = 'text-purple-400' }: CardIconProps) {
  const Icon = CARD_ICON_MAP[name];
  if (Icon) return <Icon size={size} color={color} className={className} />;
  // Fallback: render as emoji text
  return <span style={{ fontSize: size }}>{name}</span>;
}

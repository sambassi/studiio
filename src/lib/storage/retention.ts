const RETENTION_MS = {
  video: 24 * 60 * 60 * 1000,
  audio: 7 * 24 * 60 * 60 * 1000,
  image: 7 * 24 * 60 * 60 * 1000,
} as const;

const POST_PUBLISH_GRACE_MS = 48 * 60 * 60 * 1000;

export function getFileType(filename: string): 'video' | 'audio' | 'image' {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'ogg', 'm4a'].includes(ext)) return 'audio';
  return 'image';
}

export function getExpiresAt(createdAt: Date, type: 'video' | 'audio' | 'image'): Date {
  return new Date(createdAt.getTime() + RETENTION_MS[type]);
}

export function getPostPublishGraceMs(): number {
  return POST_PUBLISH_GRACE_MS;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Expiré';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}j ${remHours}h` : `${days}j`;
  }
  if (hours > 0) return `${hours}h ${mins}min`;
  return `${mins}min`;
}

export function getRetentionColor(ms: number): string {
  if (ms > 24 * 60 * 60 * 1000) return 'text-green-400';
  if (ms > 2 * 60 * 60 * 1000) return 'text-amber-400';
  return 'text-red-400';
}

export function getRetentionBgColor(ms: number): string {
  if (ms > 24 * 60 * 60 * 1000) return 'bg-green-500/10 border-green-500/20';
  if (ms > 2 * 60 * 60 * 1000) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

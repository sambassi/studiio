'use client';

import { useEffect, useState } from 'react';

export function useAgentIAEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch('/api/public/settings', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setEnabled(!!d.agentMontageEnabled))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

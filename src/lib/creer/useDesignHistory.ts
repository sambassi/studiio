'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  /** How long to wait after the last change before pushing a new snapshot. */
  debounceMs?: number;
  /** Cap on history size. Old entries beyond the cap are dropped from the front. */
  maxSize?: number;
}

interface DesignHistory<T> {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => T | null;
  redo: () => T | null;
  /**
   * Record a new snapshot. Trailing redo branch is discarded. Call this
   * whenever a "committed" change has happened (input blur, mouseup,
   * button click) — the hook debounces internally so rapid slider drags
   * don't spam the history.
   */
  commit: (snapshot: T) => void;
  /** Wipe all history (e.g. when loading a post). */
  reset: (initial?: T) => void;
  /** Temporarily pause pushing — used while an undo/redo is being applied. */
  suspend: () => void;
  resume: () => void;
  stackSize: number;
  index: number;
}

/**
 * Generic undo/redo history for editor snapshots. The caller captures the
 * full design state into a plain object and passes it to `commit`. The
 * hook keeps up to `maxSize` immutable snapshots (JSON-cloned so mutating
 * the returned object can't corrupt the stack), debounces commits by
 * `debounceMs` so rapid drag updates collapse into a single entry, and
 * exposes `undo` / `redo` that return the snapshot the caller should
 * apply to its state.
 */
export function useDesignHistory<T>(
  initial: T | null,
  { debounceMs = 500, maxSize = 50 }: Options = {},
): DesignHistory<T> {
  const stackRef = useRef<T[]>(initial ? [deepClone(initial)] : []);
  const indexRef = useRef<number>(initial ? 0 : -1);
  const suspendedRef = useRef<boolean>(false);
  const pendingTimer = useRef<number | null>(null);
  const pendingSnapshot = useRef<T | null>(null);
  // Tick to trigger re-renders when canUndo / canRedo flip.
  const [, tick] = useState(0);
  const forceUpdate = useCallback(() => tick((n) => n + 1), []);

  const flushPending = useCallback(() => {
    if (pendingTimer.current !== null) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    if (pendingSnapshot.current === null) return;
    const snapshot = pendingSnapshot.current;
    pendingSnapshot.current = null;
    // Discard the redo branch.
    if (indexRef.current < stackRef.current.length - 1) {
      stackRef.current = stackRef.current.slice(0, indexRef.current + 1);
    }
    // Skip no-op commits (identical to the last snapshot).
    const last = stackRef.current[stackRef.current.length - 1];
    if (last !== undefined && isSameSnapshot(last, snapshot)) return;
    stackRef.current.push(deepClone(snapshot));
    if (stackRef.current.length > maxSize) {
      const overflow = stackRef.current.length - maxSize;
      stackRef.current = stackRef.current.slice(overflow);
    }
    indexRef.current = stackRef.current.length - 1;
    forceUpdate();
  }, [maxSize, forceUpdate]);

  const commit = useCallback(
    (snapshot: T) => {
      if (suspendedRef.current) return;
      pendingSnapshot.current = snapshot;
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
      }
      pendingTimer.current = window.setTimeout(flushPending, debounceMs);
    },
    [debounceMs, flushPending],
  );

  const undo = useCallback((): T | null => {
    // Flush any pending commit so the redo branch stays coherent.
    flushPending();
    if (indexRef.current <= 0) return null;
    indexRef.current -= 1;
    forceUpdate();
    return deepClone(stackRef.current[indexRef.current]);
  }, [flushPending, forceUpdate]);

  const redo = useCallback((): T | null => {
    if (indexRef.current >= stackRef.current.length - 1) return null;
    indexRef.current += 1;
    forceUpdate();
    return deepClone(stackRef.current[indexRef.current]);
  }, [forceUpdate]);

  const reset = useCallback(
    (next?: T) => {
      if (pendingTimer.current !== null) {
        window.clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
      pendingSnapshot.current = null;
      stackRef.current = next ? [deepClone(next)] : [];
      indexRef.current = next ? 0 : -1;
      forceUpdate();
    },
    [forceUpdate],
  );

  const suspend = useCallback(() => {
    suspendedRef.current = true;
    if (pendingTimer.current !== null) {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    pendingSnapshot.current = null;
  }, []);

  const resume = useCallback(() => {
    suspendedRef.current = false;
  }, []);

  // Flush on unmount so a last-second edit before navigating doesn't vanish.
  useEffect(() => () => flushPending(), [flushPending]);

  return {
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < stackRef.current.length - 1,
    undo,
    redo,
    commit,
    reset,
    suspend,
    resume,
    stackSize: stackRef.current.length,
    index: indexRef.current,
  };
}

function deepClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function isSameSnapshot<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

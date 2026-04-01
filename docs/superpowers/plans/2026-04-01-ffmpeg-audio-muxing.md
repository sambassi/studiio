# FFmpeg.wasm Audio Muxing + Critical Bug Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken MediaRecorder audio pipeline with FFmpeg.wasm client-side muxing, and fix 4 related bugs (music state loss, TTS timeout, 413 upload, calendar audio).

**Architecture:** Record video-only via MediaRecorder (canvas.captureStream). Pre-mix audio via OfflineAudioContext into a WAV blob. Use FFmpeg.wasm to mux the silent video + audio into a final MP4 with AAC audio. This completely bypasses Chrome's broken MediaRecorder audio capture.

**Tech Stack:** @ffmpeg/ffmpeg 0.12.x, @ffmpeg/util 0.12.x, OfflineAudioContext, MediaRecorder (video-only), Canvas API

---

### Task 1: Install FFmpeg.wasm and add COOP/COEP headers

**Files:**
- Modify: `package.json`
- Modify: `next.config.js`

### Task 2: Create FFmpeg muxing utility

**Files:**
- Create: `src/lib/ffmpeg-mux.ts`

### Task 3: Rewrite video-composer.ts audio pipeline

**Files:**
- Modify: `src/lib/video-composer.ts`

### Task 4: Fix backgroundMusic null state

**Files:**
- Modify: `src/app/dashboard/creator/page.tsx`

### Task 5: Fix TTS timeout

**Files:**
- Modify: `src/lib/tts/edge-tts-client.ts`

### Task 6: Handle COOP/COEP scoping for OAuth

**Files:**
- Modify: `next.config.js`

### Task 7: Fix calendar audio playback

**Files:**
- Modify: `src/app/dashboard/calendar/page.tsx`

### Task 8: Integration test and cleanup

See full plan details in the implementation.

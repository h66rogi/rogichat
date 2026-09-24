'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const WORKLET_URL = '/audio-worklets/soundtouch-processor.js';

type SoundTouchNodeLike = AudioNode & {
  pitchSemitones: AudioParam;
};

type SoundTouchNodeConstructor = {
  new (context: AudioContext): SoundTouchNodeLike;
  register(context: AudioContext, processorUrl: string): Promise<void>;
};

/**
 * Module-level state so a single AudioContext + worklet is reused across
 * remounts. createMediaElementSource() may only be called once per
 * HTMLMediaElement, so we also memoize the source per element via WeakMap.
 */
let sharedCtx: AudioContext | null = null;
let workletLoadPromise: Promise<boolean> | null = null;
const elementGraphs = new WeakMap<
  HTMLMediaElement,
  {
    source: MediaElementAudioSourceNode;
    pitchNode: SoundTouchNodeLike;
    gainNode: GainNode;
  }
>();
let soundTouchNodeCtorPromise: Promise<SoundTouchNodeConstructor | null> | null = null;

async function getSoundTouchNodeCtor(): Promise<SoundTouchNodeConstructor | null> {
  if (typeof window === 'undefined') return null;
  if (!soundTouchNodeCtorPromise) {
    soundTouchNodeCtorPromise = import('@soundtouchjs/audio-worklet')
      .then((mod) => mod.SoundTouchNode as unknown as SoundTouchNodeConstructor)
      .catch((err) => {
        console.error('[PitchShift] SoundTouch module load failed', err);
        soundTouchNodeCtorPromise = null;
        return null;
      });
  }
  return soundTouchNodeCtorPromise;
}

function isAudioWorkletSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const Ctor = window.AudioContext;
  if (typeof Ctor !== 'function') return false;
  // Use `in` instead of property access — `audioWorklet` is an instance
  // getter that throws "Illegal invocation" when accessed off the prototype
  // in some Chromium builds.
  try {
    return 'audioWorklet' in Ctor.prototype;
  } catch {
    return false;
  }
}

async function ensureContext(): Promise<AudioContext | null> {
  if (sharedCtx) return sharedCtx;
  if (!isAudioWorkletSupported()) return null;
  try {
    sharedCtx = new AudioContext();
    return sharedCtx;
  } catch {
    return null;
  }
}

async function loadWorklet(ctx: AudioContext): Promise<boolean> {
  const SoundTouchNode = await getSoundTouchNodeCtor();
  if (!SoundTouchNode) return false;
  if (!workletLoadPromise) {
    workletLoadPromise = SoundTouchNode.register(ctx, WORKLET_URL)
      .then(() => true)
      .catch((err) => {
        console.error('[PitchShift] SoundTouch worklet load failed', err);
        workletLoadPromise = null;
        return false;
      });
  }
  return workletLoadPromise;
}

export interface PitchShiftOptions {
  /** Enable/disable the pitch graph entirely (kill switch / bypass). */
  enabled: boolean;
  /** -12..+12 (UI clamps to ±6). 0 also disables the graph. */
  pitchSemitones: number;
}

export interface PitchShiftState {
  /** Worklet loaded and graph connected for the current videoRef. */
  ready: boolean;
  /** AudioWorklet is unavailable in this browser; UI should be disabled. */
  unsupported: boolean;
  error: string | null;
}

/**
 * Wires a Web Audio pitch-shift graph onto a <video> element using SoundTouchJS
 * (WSOLA-based). Replaces an earlier phase-vocoder implementation that produced
 * audible "지지직" artifacts magnitude-independent of the pitch setting (suspected
 * OLA accumulation/wrap bug + phasiness).
 *
 * Graph:
 *   <video> → MediaElementSource → SoundTouchNode → Gain → destination
 *
 * Behaviour:
 * - When `enabled` is false OR `pitchSemitones === 0`, the SoundTouch node is
 *   physically bypassed (source → gain) so the audio stream is bit-identical to
 *   the original. We do not rely on the worklet's "0 semitones = passthrough"
 *   path because every sample still goes through the WSOLA buffer there.
 * - The graph is created lazily on the first call where pitch !== 0 and a user
 *   gesture has resumed the AudioContext.
 * - Same <video> element is only ever attached to a MediaElementSource once,
 *   even across remounts (Web Audio API restriction).
 */
export function usePitchShift(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  options: PitchShiftOptions,
): PitchShiftState {
  const { enabled, pitchSemitones } = options;
  const [state, setState] = useState<PitchShiftState>({
    ready: false,
    unsupported: !isAudioWorkletSupported(),
    error: null,
  });

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Reroute graph + push params whenever pitch/enabled change.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const graph = elementGraphs.get(video);
    if (!graph) return;

    const usePitch = enabled && pitchSemitones !== 0;

    try {
      graph.source.disconnect();
    } catch {
      // disconnect() throws if there were no outgoing edges yet — fine.
    }
    if (usePitch) {
      graph.source.connect(graph.pitchNode);
      graph.pitchNode.pitchSemitones.value = pitchSemitones;
    } else {
      graph.source.connect(graph.gainNode);
      graph.pitchNode.pitchSemitones.value = 0;
    }
  }, [enabled, pitchSemitones, videoRef]);

  const connect = useCallback(async () => {
    if (state.unsupported) return;
    const video = videoRef.current;
    if (!video) return;
    if (elementGraphs.has(video)) {
      setState((s) => ({ ...s, ready: true }));
      return;
    }
    const ctx = await ensureContext();
    if (!ctx) {
      setState({ ready: false, unsupported: true, error: null });
      return;
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // resume() throws when called outside a user gesture; the next
        // gesture-driven attempt will succeed.
      }
    }
    const ok = await loadWorklet(ctx);
    if (!ok) {
      setState({ ready: false, unsupported: true, error: 'worklet 로드 실패' });
      return;
    }
    const SoundTouchNode = await getSoundTouchNodeCtor();
    if (!SoundTouchNode) {
      setState({ ready: false, unsupported: true, error: 'worklet 모듈 로드 실패' });
      return;
    }

    try {
      const source = ctx.createMediaElementSource(video);
      const pitchNode = new SoundTouchNode(ctx);
      const gainNode = ctx.createGain();

      // Static legs: pitchNode → gain → destination. The source is wired to
      // either pitchNode (active) or gainNode directly (bypass) below, so we
      // can swap routes without recreating any node.
      pitchNode.connect(gainNode);
      gainNode.connect(ctx.destination);

      const opts = optionsRef.current;
      const usePitch = opts.enabled && opts.pitchSemitones !== 0;
      if (usePitch) {
        source.connect(pitchNode);
        pitchNode.pitchSemitones.value = opts.pitchSemitones;
      } else {
        source.connect(gainNode);
        pitchNode.pitchSemitones.value = 0;
      }

      elementGraphs.set(video, { source, pitchNode, gainNode });
      setState({ ready: true, unsupported: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[PitchShift] connect failed', err);
      setState({
        ready: false,
        unsupported: false,
        error: `오디오 그래프 연결 실패: ${message}`,
      });
    }
  }, [state.unsupported, videoRef]);

  // Connect when needed: enabled and a non-zero pitch is requested.
  useEffect(() => {
    if (!enabled || pitchSemitones === 0) return;
    void connect();
  }, [enabled, pitchSemitones, connect]);

  // Resume an already-created AudioContext on the next user gesture if it
  // stays suspended. We deliberately do NOT call connect() here — that would
  // bind the <video> element to MediaElementSource on the user's very first
  // page click, even when pitch shift is unused. Some browsers then lock the
  // bound element to its current src and refuse to load new src values, which
  // makes recommended-video swaps appear stuck. Connection now happens only
  // through the dedicated effect below when pitch is actually engaged.
  useEffect(() => {
    if (state.unsupported) return;
    const handler = () => {
      const ctx = sharedCtx;
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', handler, { once: true });
    window.addEventListener('keydown', handler, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handler);
      window.removeEventListener('keydown', handler);
    };
  }, [state.unsupported]);

  return state;
}

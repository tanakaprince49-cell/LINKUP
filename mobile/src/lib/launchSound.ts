import { Platform, Vibration } from 'react-native';
import { webAppPath } from './webPaths';

/**
 * THE COLD-OPEN CHIME.
 *
 * Every LINKUP launch plays one short, cinematic sound as the cat wakes up: a
 * sub swell, a rising glass arpeggio, one hit, then a purr under the tail. It
 * is the app's handshake — it has to fire on the very first frame or not at all.
 *
 * Three delivery paths, in order of preference:
 *   1. web    — one HTMLAudioElement on a public URL, so the browser's autoplay
 *               policy can be handled explicitly (retry on the first gesture).
 *   2. native — expo-audio. Loaded through a guarded require: a binary that was
 *               built before the module existed stays silent instead of
 *               crashing on launch.
 *   3. anyone — a short haptic tick, so the moment still registers.
 *
 * Nothing here is allowed to throw into the render tree: a missing speaker, a
 * muted device or a blocked autoplay policy must never break app startup.
 */

const SOUND_PATH = '/sounds/linkup-open.wav';
const NATIVE_SOUND = require('../../assets/sounds/linkup-open.wav');

let webAudio: any = null;
let webFailed = false;
let gestureArmed = false;
let nativeModule: any = null;
let nativeProbed = false;
let nativePlayer: any = null;
let played = false;

const audio = (): any => (globalThis as any)?.Audio || null;

function playWeb(): boolean {
  if (webFailed) return false;
  const Ctor = audio();
  if (!Ctor) { webFailed = true; return false; }
  try {
    if (!webAudio) {
      webAudio = new Ctor();
      webAudio.src = webAppPath(SOUND_PATH);
      webAudio.preload = 'auto';
      webAudio.volume = 0.9;
    }
    try { webAudio.currentTime = 0; } catch { /* first play, nothing to seek */ }
    const result = webAudio.play();
    if (result && typeof result.catch === 'function') result.catch(() => armFirstGesture());
    return true;
  } catch {
    webFailed = true;
    return false;
  }
}

/**
 * Browsers refuse audio until the visitor interacts. The launch screen IS the
 * first thing they see, so their first tap or keypress is the natural second
 * chance — we replay the chime there instead of silently losing it.
 */
function armFirstGesture() {
  if (gestureArmed || typeof document === 'undefined') return;
  gestureArmed = true;
  const fire = () => {
    cleanup();
    try { void webAudio?.play?.(); } catch { /* still blocked: stay quiet */ }
  };
  const cleanup = () => {
    gestureArmed = false;
    document.removeEventListener('pointerdown', fire);
    document.removeEventListener('keydown', fire);
    document.removeEventListener('touchstart', fire);
  };
  document.addEventListener('pointerdown', fire, { once: true });
  document.addEventListener('keydown', fire, { once: true });
  document.addEventListener('touchstart', fire, { once: true });
}

function playNative(): boolean {
  if (!nativeProbed) {
    nativeProbed = true;
    try {
      // Guarded on purpose: old binaries do not ship the native module.
      nativeModule = require('expo-audio');
    } catch {
      nativeModule = null;
    }
  }
  if (!nativeModule?.createAudioPlayer) return false;
  try {
    void nativeModule.setAudioModeAsync?.({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
    })?.catch?.(() => {});
    nativePlayer = nativeModule.createAudioPlayer(NATIVE_SOUND, { downloadFirst: true });
    nativePlayer.volume = 0.95;
    nativePlayer.play();
    const player = nativePlayer;
    setTimeout(() => {
      try { player.remove?.(); } catch { /* already released */ }
      if (nativePlayer === player) nativePlayer = null;
    }, 5000);
    return true;
  } catch {
    return false;
  }
}

/** Fire the opening chime. Safe to call on every launch path; it never throws. */
export function playLaunchSound(): void {
  if (played) return;
  played = true;
  if (Platform.OS === 'web') {
    if (playWeb()) return;
  } else if (playNative()) {
    return;
  }
  try { Vibration.vibrate([0, 16, 40, 24]); } catch { /* no motor */ }
}

/** Cut the chime short — used when the visitor skips the opening animation. */
export function stopLaunchSound(): void {
  try { webAudio?.pause?.(); } catch { /* noop */ }
  try { nativePlayer?.pause?.(); } catch { /* noop */ }
}

/** Tests and the launch screen share one reset path. */
export function resetLaunchSoundForTests(): void {
  played = false;
  gestureArmed = false;
  webFailed = false;
  nativeProbed = false;
  nativePlayer = null;
}

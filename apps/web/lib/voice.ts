'use client';
// Spoken workout cues on the web (Web Speech API), the same lines as the iPhone (@diet/core workoutCues).
// Browsers cannot duck other audio; the voice simply plays over it. Countdowns cut in, other lines queue.

let koVoice: SpeechSynthesisVoice | null | undefined;

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

export const voiceSupported = (): boolean => !!synth();

function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (koVoice !== undefined && koVoice !== null) return koVoice;
  const voices = s.getVoices();
  if (!voices.length) return null; // loads async on first use; the lang tag still picks a Korean voice
  koVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('ko') && v.localService) ?? voices.find((v) => v.lang?.toLowerCase().startsWith('ko')) ?? null;
  return koVoice;
}

/** Say a line. `interrupt` drops what is still queued (3-2-1 must land on the second). */
export function speak(text: string, interrupt = false): void {
  const s = synth();
  if (!s || !text) return;
  if (interrupt) s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = 1.05;
  const v = pickVoice(s);
  if (v) u.voice = v;
  s.speak(u);
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

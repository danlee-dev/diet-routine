// Spoken cues in the home workout players (lines from @diet/core workoutCues, the same the web speaks).
// Speech runs in its own system audio session (useApplicationAudioSession: false), so iOS ducks music
// while it talks and brings it back after. Countdowns cut in; other lines queue behind what is playing.
import { useState } from 'react';
import * as Speech from 'expo-speech';
import { devicePref } from '@/lib/env';

const KEY = 'workout.voice';
export const workoutVoiceOn = (): boolean => devicePref.get(KEY, true);

export function sayWorkout(text: string | null, interrupt = false): void {
  if (!text || !workoutVoiceOn()) return;
  if (interrupt) void Speech.stop();
  Speech.speak(text, { language: 'ko-KR', rate: 1.0, useApplicationAudioSession: false });
}

export const stopWorkoutVoice = (): void => { void Speech.stop(); };

/** The header toggle. */
export function useWorkoutVoice(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(workoutVoiceOn);
  return {
    on,
    toggle: () => {
      const next = !on;
      devicePref.set(KEY, next);
      setOn(next);
      if (!next) stopWorkoutVoice();
    },
  };
}

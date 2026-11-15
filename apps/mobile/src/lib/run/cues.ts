// Voice and haptic cues during a run. Speech uses its own system-managed audio session
// (useApplicationAudioSession: false), so it ducks music and still speaks with the screen locked.
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { splitCue, type Split } from '@diet/core';
import { devicePref } from '@/lib/env';

const VOICE_KEY = 'run.voice';
export const voiceEnabled = (): boolean => devicePref.get(VOICE_KEY, true);
export const setVoiceEnabled = (on: boolean): void => devicePref.set(VOICE_KEY, on);

export function say(text: string): void {
  if (!voiceEnabled()) return;
  Speech.speak(text, { language: 'ko-KR', rate: 1.0, useApplicationAudioSession: false });
}

export function cueSplit(split: Split, totalS: number, kind: 'run' | 'walk'): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  say(kind === 'walk' ? splitCue(split, totalS).replace('페이스', '걷기 페이스') : splitCue(split, totalS));
}

type StateCue = 'start' | 'pause' | 'resume' | 'autoPause' | 'autoResume';
const LINES: Record<StateCue, string> = {
  start: '기록을 시작합니다.',
  pause: '일시정지합니다.',
  resume: '다시 시작합니다.',
  autoPause: '멈춰서 자동으로 일시정지합니다.',
  autoResume: '다시 기록합니다.',
};

export function cueState(kind: StateCue, _run: 'run' | 'walk'): void {
  void Haptics.impactAsync(kind === 'start' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Medium);
  say(LINES[kind]);
}

export function cueFinish(km: string): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  say(`수고했습니다. ${km}킬로미터를 기록했습니다.`);
}

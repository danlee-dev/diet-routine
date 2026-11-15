// What the home workout player says out loud (iPhone expo-speech, web Speech API), so both speak the same lines.
// Korean, short, said at the moments a person cannot look at the screen: a new move, the last seconds of a hold
// or a rest, minute marks of a time-boxed workout, and the end.

export interface CueItem { name: string; n: number; unit: string }

const KO_COUNT = ['', '하나', '둘', '셋'];

/** "푸시업 12회", "런지 10회, 양쪽", "플랭크 30초" */
export function cueAmount(x: CueItem): string {
  const both = x.unit.includes('양쪽');
  const unit = x.unit.replace(/\s*\(양쪽\)/, '').trim();
  return `${x.name} ${x.n}${unit}${both ? ', 양쪽' : ''}`;
}

/** Said when a move comes up. `round` is announced on the first move of a round. */
export function cueMove(x: CueItem, at: { idx: number; total: number; round: number; rounds: number }): string {
  const head = at.idx === 0 ? (at.round === at.rounds && at.rounds > 1 ? '마지막 라운드. ' : `${at.round}라운드. `) : at.idx === at.total - 1 ? '마지막 동작. ' : '';
  const tail = x.unit.includes('초') ? ' 준비되면 타이머를 누르세요.' : '';
  return `${head}${cueAmount(x)}.${tail}`;
}

/** Last three seconds of a hold or a rest: "셋", "둘", "하나". Nothing for other seconds. */
export const cueCountdown = (left: number): string | null => (left >= 1 && left <= 3 ? KO_COUNT[left]! : null);

export const cueHoldStart = (x: CueItem): string => `${x.n}초 버팁니다. 시작.`;
export const cueHoldEnd = '끝.';

export function cueRest(secs: number, next: CueItem | undefined): string {
  return `${secs}초 쉽니다.${next ? ` 다음은 ${cueAmount(next)}.` : ''}`;
}

export const cueRoundGo = '시작.';

export function cueDone(rounds: number): string {
  return `수고했습니다. ${rounds}라운드를 마쳤습니다.`;
}

// ---------- time-boxed (AMRAP) ----------

export function cueAmrapStart(minutes: number, items: CueItem[]): string {
  return `${minutes}분 시작합니다. ${items.map(cueAmount).join(', ')}를 반복합니다.`;
}

/**
 * Minute marks while the clock runs, given whole seconds left: every five minutes, each of the last three
 * minutes, and 30 seconds before the end. Returns null on other seconds.
 */
export function cueAmrapMark(left: number, total: number): string | null {
  if (left <= 0 || left >= total) return null;
  if (left === 30) return '30초 남았습니다.';
  if (left % 60 !== 0) return null;
  const min = left / 60;
  if (min <= 3 || min % 5 === 0) return `${min}분 남았습니다.`;
  return null;
}

export const cueLap = (rounds: number): string => `${rounds}바퀴.`;

export function cueAmrapDone(rounds: number): string {
  return `끝. ${rounds}바퀴 했습니다. 수고했습니다.`;
}

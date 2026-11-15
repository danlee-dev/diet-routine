// One component per question. Each shows what the answer changes right under the control
// (kcal, end weight, meal times, weekly cost), computed by @diet/core.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  ACTIVITY_LABEL, addDays, ALLERGEN_LABEL, computeTargets, COOKING_LABEL, EATING_OUT_LABEL, fmt, generatePlan, hhmm, md,
  schedule, weekFor, WORKOUT_PLACE_LABEL, type Activity, type Allergen, type Cooking, type EatingOut, type WorkoutPlace,
} from '@diet/core';
import { R, squircle, useTheme } from '@/lib/theme';
import { Keypad, PickerFrame, Wheel, type WheelItem } from '@/components/ui';
import { answersOf, BODY_DEFAULT, kg1, type Draft, type StepId } from './answers';
import { Chip, Choice, Fact, Question, Stepper } from './controls';

export interface StepProps {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  /** go to the next question (single-choice questions call this right after a tap) */
  advance: () => void;
  now: Date;
}

const range = (a: number, b: number, unit = ''): WheelItem[] => Array.from({ length: b - a + 1 }, (_, i) => ({ v: a + i, t: `${a + i}${unit}` }));
const AGE = range(18, 90); // a calorie cut is not offered to minors
const HEIGHT = range(130, 210);
const KG = range(35, 180);
const DEC = range(0, 9);
const HOURS = range(4, 12);
const MINS: WheelItem[] = [0, 10, 20, 30, 40, 50].map((m) => ({ v: m, t: String(m).padStart(2, '0') }));
const AUTO_ADVANCE_MS = 260;

function Unit({ children }: { children: string }) {
  const t = useTheme();
  return <Text style={{ color: t.fg2, fontSize: 15, fontWeight: '600', marginLeft: 4 }}>{children}</Text>;
}

function Choices<T extends string>({ value, options, onPick, advance }: { value: T | null; options: { v: T; label: string; sub?: string }[]; onPick: (v: T) => void; advance?: () => void }) {
  return (
    <View style={{ gap: 10 }}>
      {options.map((o) => (
        <Choice key={o.v} label={o.label} sub={o.sub} selected={value === o.v} onPress={() => { onPick(o.v); if (advance) setTimeout(advance, AUTO_ADVANCE_MS); }} />
      ))}
    </View>
  );
}

function NameStep({ d, set, advance }: StepProps) {
  const t = useTheme();
  return (
    <Question title="부를 이름" sub="인사할 때만 씁니다. 비워 둬도 됩니다.">
      <TextInput
        value={d.name}
        onChangeText={(name) => set({ name: Array.from(name).slice(0, 12).join('') })} // by code point: never half an emoji
        placeholder="이름 또는 별명"
        placeholderTextColor={t.muted}
          selectionColor={t.fg}
        autoFocus
        returnKeyType="next"
        onSubmitEditing={advance}
        autoCorrect={false}
        textContentType="nickname"
        style={[{ height: 64, borderRadius: R.md, backgroundColor: t.surface, paddingHorizontal: 20, color: t.fg, fontSize: 24, fontWeight: '400' }, squircle]}
      />
    </Question>
  );
}

function SexStep({ d, set, advance, touched }: StepProps & { touched: Set<string> }) {
  return (
    <Question title="성별" sub="하루에 쓰는 에너지 공식이 성별마다 다릅니다.">
      <Choices
        value={d.sex}
        options={[{ v: 'male', label: '남성' }, { v: 'female', label: '여성' }]}
        onPick={(sex) => {
          // until the user sets them, height and weights follow the chosen sex's typical values
          const b = BODY_DEFAULT[sex];
          set({
            sex,
            ...(touched.has('height') ? {} : { heightCm: b.heightCm }),
            ...(touched.has('weight') ? {} : { weightKg: b.weightKg, goalWeightKg: b.goalWeightKg }),
          });
        }}
        advance={advance}
      />
    </Question>
  );
}

function AgeStep({ d, set }: StepProps) {
  return (
    <Question title="나이" sub="기초대사량은 나이, 키, 체중으로 계산합니다.">
      <PickerFrame>
        <Wheel items={AGE} value={d.age} onChange={(age) => set({ age })} label="나이" />
        <Unit>세</Unit>
      </PickerFrame>
    </Question>
  );
}

function HeightStep({ d, set }: StepProps) {
  return (
    <Question title="키">
      <PickerFrame>
        <Wheel items={HEIGHT} value={d.heightCm} onChange={(heightCm) => set({ heightCm })} label="키" width={96} />
        <Unit>cm</Unit>
      </PickerFrame>
    </Question>
  );
}

function WeightStep({ d, set }: StepProps) {
  const t = useTheme();
  const [field, setField] = useState<'now' | 'goal'>('now');
  const v = field === 'now' ? d.weightKg : d.goalWeightKg;
  const whole = Math.floor(v + 1e-6);
  const dec = Math.round((v - whole) * 10);
  const put = (n: number) => set(field === 'now' ? { weightKg: n } : { goalWeightKg: n });
  const diff = Math.round((d.weightKg - d.goalWeightKg) * 10) / 10;
  const tile = (f: 'now' | 'goal', label: string, n: number) => {
    const on = field === f;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${label} ${kg1(n)}킬로그램`}
        onPress={() => { void Haptics.selectionAsync(); setField(f); }}
        style={[{ flex: 1, paddingHorizontal: 18, paddingVertical: 14, borderRadius: R.md, backgroundColor: on ? t.fg : t.surface, gap: 2 }, squircle]}
      >
        <Text style={{ color: on ? t.onFg : t.muted, fontSize: 13, fontWeight: '600', opacity: on ? 0.75 : 1 }}>{label}</Text>
        <Text style={{ color: on ? t.onFg : t.fg, fontSize: 28, fontWeight: '300', letterSpacing: -0.8, fontVariant: ['tabular-nums'] }}>
          {kg1(n)}<Text style={{ fontSize: 15, fontWeight: '500' }}> kg</Text>
        </Text>
      </Pressable>
    );
  };
  return (
    <Question
      title="지금 체중과 목표"
      sub="목표가 너무 빠르면 몸에 무리가 없는 속도로 맞춥니다."
      result={diff > 0
        ? <Fact label="줄일 체중" value={`${kg1(diff)}kg`} strong />
        : <Text style={{ color: t.fg, fontSize: 14.5, fontWeight: '600' }}>목표는 지금 체중보다 낮아야 합니다.</Text>}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {tile('now', '지금', d.weightKg)}
        {tile('goal', '목표', d.goalWeightKg)}
      </View>
      {/* keyed by field: switching remounts the wheels at the other value instead of spinning through numbers */}
      <PickerFrame key={field}>
        <Wheel items={KG} value={whole} onChange={(n) => put(n + dec / 10)} label={`${field === 'now' ? '지금' : '목표'} 체중 킬로그램`} />
        <Text style={{ color: t.fg, fontSize: 25, marginHorizontal: -2 }}>.</Text>
        <Wheel items={DEC} value={dec} onChange={(n) => put(whole + n / 10)} width={54} label="소수점 아래" />
        <Unit>kg</Unit>
      </PickerFrame>
    </Question>
  );
}

function WeeksStep({ d, set, now }: StepProps) {
  const t = useTheme();
  const tg = d.sex ? computeTargets(answersOf(d)) : null;
  return (
    <Question
      title="기간"
      sub="이 기간에 맞춰 하루 칼로리를 정합니다."
      result={tg && (
        <View>
          <Fact label="하루 목표" value={`${fmt(tg.kcal)}kcal`} strong />
          <Fact label="줄어드는 속도" value={`주 ${tg.weeklyLossKg}kg`} />
          <Fact label={`${d.weeks}주 뒤 예상`} value={`${kg1(tg.endWeightKg)}kg`} />
          {tg.paceCapped && <Text lineBreakStrategyIOS="hangul-word" style={{ color: t.fg2, fontSize: 13.5, lineHeight: 19, marginTop: 8 }}>목표까지 {d.weeks}주는 빨라서, 몸에 무리가 없는 속도로 잡았습니다.</Text>}
        </View>
      )}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[4, 8, 12].map((w) => {
          const on = d.weeks === w;
          return (
            <Pressable
              key={w}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${w}주, ${md(addDays(now, w * 7 - 1))}까지`}
              onPress={() => { void Haptics.selectionAsync(); set({ weeks: w }); }}
              style={({ pressed }) => [{ flex: 1, height: 96, borderRadius: R.md, backgroundColor: on ? t.fg : t.surface, alignItems: 'center', justifyContent: 'center', gap: 4, transform: [{ scale: pressed ? 0.97 : 1 }] }, squircle]}
            >
              <Text style={{ color: on ? t.onFg : t.fg, fontSize: 30, fontWeight: '300', letterSpacing: -0.8 }}>{w}<Text style={{ fontSize: 16, fontWeight: '500' }}>주</Text></Text>
              <Text style={{ color: on ? t.onFg : t.muted, opacity: on ? 0.75 : 1, fontSize: 12.5, fontWeight: '500' }}>{md(addDays(now, w * 7 - 1))}까지</Text>
            </Pressable>
          );
        })}
      </View>
    </Question>
  );
}

const ACTIVITY_SUB: Record<Activity, string> = { sedentary: '사무실, 재택, 공부', light: '출퇴근 걷기, 가끔 계단', active: '매장, 현장, 배달 같은 일' };

function ActivityStep({ d, set, advance }: StepProps) {
  return (
    <Question title="평소 활동량" sub="운동은 빼고, 일하고 생활하는 정도로 고릅니다.">
      <Choices<Activity>
        value={d.activity}
        options={(Object.keys(ACTIVITY_LABEL) as Activity[]).map((v) => ({ v, label: ACTIVITY_LABEL[v], sub: ACTIVITY_SUB[v] }))}
        onPick={(activity) => set({ activity })}
        advance={advance}
      />
    </Question>
  );
}

function WakeStep({ d, set }: StepProps) {
  const t = useTheme();
  const h = Math.floor(d.wakeMin / 60);
  const m = d.wakeMin % 60 - ((d.wakeMin % 60) % 10);
  const s = schedule(d.wakeMin);
  return (
    <Question
      title="보통 일어나는 시간"
      sub="끼니 시간을 여기에 맞춥니다. 매일 아침 바꿀 수 있습니다."
      result={s && (
        <View>
          <Fact label="아침" value={hhmm(s.b)} />
          <Fact label={s.merge ? '점심 (간식 함께)' : '점심'} value={hhmm(s.l)} />
          {!s.merge && <Fact label="간식" value={hhmm(s.s)} />}
          <Fact label="저녁" value={hhmm(s.d)} />
        </View>
      )}
    >
      <PickerFrame>
        <Wheel items={HOURS} value={h} onChange={(n) => set({ wakeMin: n * 60 + m })} label="시" />
        <Text style={{ color: t.fg, fontSize: 25, marginHorizontal: 2 }}>:</Text>
        <Wheel items={MINS} value={m} onChange={(n) => set({ wakeMin: h * 60 + n })} label="분" />
      </PickerFrame>
    </Question>
  );
}

const EATING_OUT_SUB: Partial<Record<EatingOut, string>> = { lunch: '회사나 학교 근처 식당', dinner: '약속이나 회식', often: '하루 한 끼 이상' };

function EatoutStep({ d, set, advance }: StepProps) {
  return (
    <Question title="밖에서 먹는 끼니" sub="밖에서 먹는 끼니는 장보기 대신 메뉴 고르는 법으로 채웁니다.">
      <Choices<EatingOut>
        value={d.eatingOut}
        options={(Object.keys(EATING_OUT_LABEL) as EatingOut[]).map((v) => ({ v, label: EATING_OUT_LABEL[v], sub: EATING_OUT_SUB[v] }))}
        onPick={(eatingOut) => set({ eatingOut })}
        advance={advance}
      />
    </Question>
  );
}

const COOKING_SUB: Record<Cooking, string> = { none: '바로 먹는 것만', microwave: '즉석밥, 냉동 고구마, 구운란', basic: '고기 굽기, 두부 데우기' };

function CookingStep({ d, set, advance }: StepProps) {
  return (
    <Question title="직접 하는 조리" sub="할 수 있는 만큼만 식단에 넣습니다.">
      <Choices<Cooking>
        value={d.cooking}
        options={(Object.keys(COOKING_LABEL) as Cooking[]).map((v) => ({ v, label: COOKING_LABEL[v], sub: COOKING_SUB[v] }))}
        onPick={(cooking) => set({ cooking })}
        advance={advance}
      />
    </Question>
  );
}

function AvoidStep({ d, set }: StepProps) {
  const t = useTheme();
  const [word, setWord] = useState('');
  const toggle = (a: Allergen) => set({ allergies: d.allergies.includes(a) ? d.allergies.filter((x) => x !== a) : [...d.allergies, a] });
  const add = () => {
    const w = word.trim();
    if (w && !d.dislikes.includes(w)) set({ dislikes: [...d.dislikes, w].slice(0, 12) });
    setWord('');
  };
  return (
    <Question title="못 먹는 것" sub="알레르기나 싫은 음식이 들어간 메뉴는 뺍니다.">
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginBottom: 10 }}>알레르기</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(Object.keys(ALLERGEN_LABEL) as Allergen[]).map((a) => <Chip key={a} label={ALLERGEN_LABEL[a]} selected={d.allergies.includes(a)} onPress={() => toggle(a)} />)}
      </View>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', marginTop: 26, marginBottom: 10 }}>싫은 음식</Text>
      <View style={[{ flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: R.md, backgroundColor: t.surface, paddingLeft: 18, paddingRight: 6 }, squircle]}>
        <TextInput
          value={word}
          onChangeText={setWord}
          placeholder="예: 고구마, 연어"
          placeholderTextColor={t.muted}
          selectionColor={t.fg}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={add}
          autoCorrect={false}
          style={{ flex: 1, color: t.fg, fontSize: 16, height: 52 }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel="싫은 음식 추가" disabled={!word.trim()} onPress={add} style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: word.trim() ? t.fg : 'transparent', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: word.trim() ? t.onFg : t.muted, fontSize: 14.5, fontWeight: '600' }}>추가</Text>
        </Pressable>
      </View>
      {d.dislikes.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {d.dislikes.map((w) => <Chip key={w} label={w} selected trailing="xmark" onPress={() => set({ dislikes: d.dislikes.filter((x) => x !== w) })} />)}
        </View>
      )}
    </Question>
  );
}

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function WeekStrip({ week }: { week: Partial<Record<string, string>> }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {DOW_ORDER.map((dow) => {
        const w = week[String(dow)];
        const strong = w === 'A' || w === 'B';
        return (
          <View key={dow} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{DOW_KO[dow]}</Text>
            <View style={[{ alignSelf: 'stretch', height: 34, borderRadius: R.xs, backgroundColor: strong ? t.fg : t.surface, alignItems: 'center', justifyContent: 'center' }, squircle]}>
              <Text style={{ color: strong ? t.onFg : t.fg2, fontSize: strong ? 14 : 12, fontWeight: strong ? '700' : '500' }}>{strong ? w : w === 'walk' ? '걷기' : '쉼'}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const PLACE_SUB: Record<WorkoutPlace, string> = { home: '푸시업, 스쿼트 같은 20분 루틴', gym: '머신 위주 40분 루틴', walk: '근력 운동 없이 걸음 수로' };

function WorkoutStep({ d, set }: StepProps) {
  const t = useTheme();
  return (
    <Question title="운동" sub="근력 운동 날을 정하고, 나머지 날은 걷습니다.">
      <Choices<WorkoutPlace>
        value={d.workoutPlace}
        options={(Object.keys(WORKOUT_PLACE_LABEL) as WorkoutPlace[]).map((v) => ({ v, label: WORKOUT_PLACE_LABEL[v], sub: PLACE_SUB[v] }))}
        onPick={(workoutPlace) => set({ workoutPlace, workoutDays: workoutPlace === 'walk' ? d.workoutDays : Math.max(1, d.workoutDays) })}
      />
      {d.workoutPlace !== 'walk' && (
        <View style={{ marginTop: 26, gap: 18 }}>
          <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600' }}>일주일에 몇 번</Text>
          <Stepper value={d.workoutDays} min={1} max={6} unit="회" label="일주일 근력 운동 횟수" onChange={(workoutDays) => set({ workoutDays })} />
        </View>
      )}
      <View style={{ marginTop: 22 }}>
        <WeekStrip week={weekFor(d.workoutPlace, d.workoutDays)} />
      </View>
    </Question>
  );
}

const BUDGETS = [5, 8, 12];

function BudgetStep({ d, set }: StepProps) {
  const t = useTheme();
  const man = Math.round(d.budgetWeek / 10000);
  const cost = generatePlan(answersOf(d)).weeklyCost;
  const key = (k: string) => {
    if (k === 'c') return set({ budgetWeek: 0 });
    if (k === 'b') return set({ budgetWeek: Math.floor(man / 10) * 10000 });
    const next = man * 10 + Number(k);
    if (next <= 99) set({ budgetWeek: next * 10000 });
  };
  return (
    <Question
      title="일주일 장보기 예산"
      sub="예산이 빠듯하면 같은 칼로리에서 더 싼 구성을 고릅니다."
      result={<Fact label="지금 답으로 짠 식단" value={`주 약 ${fmt(Math.round(cost / 1000) * 1000)}원`} />}
    >
      <Text accessibilityLiveRegion="polite" style={{ color: man ? t.fg : t.muted, fontSize: 52, fontWeight: '200', letterSpacing: -1.5, fontVariant: ['tabular-nums'] }}>
        {man ? <>{man}<Text style={{ fontSize: 22, fontWeight: '500', letterSpacing: 0 }}>만 원</Text></> : '정하지 않음'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {BUDGETS.map((b) => <Chip key={b} label={`${b}만 원`} selected={man === b} onPress={() => set({ budgetWeek: b * 10000 })} />)}
        <Chip label="정하지 않음" selected={man === 0} onPress={() => set({ budgetWeek: 0 })} />
      </View>
      <Keypad onKey={key} />
    </Question>
  );
}

export function StepView({ id, touched, ...p }: StepProps & { id: StepId; touched: Set<string> }) {
  switch (id) {
    case 'name': return <NameStep {...p} />;
    case 'sex': return <SexStep {...p} touched={touched} />;
    case 'age': return <AgeStep {...p} />;
    case 'height': return <HeightStep {...p} />;
    case 'weight': return <WeightStep {...p} />;
    case 'weeks': return <WeeksStep {...p} />;
    case 'activity': return <ActivityStep {...p} />;
    case 'wake': return <WakeStep {...p} />;
    case 'eatout': return <EatoutStep {...p} />;
    case 'cooking': return <CookingStep {...p} />;
    case 'avoid': return <AvoidStep {...p} />;
    case 'workout': return <WorkoutStep {...p} />;
    case 'budget': return <BudgetStep {...p} />;
  }
}

/** Optional questions show 건너뛰기; it also resets the answer to "none". */
export const SKIPPABLE: Partial<Record<StepId, Partial<Draft>>> = {
  name: { name: '' },
  avoid: { allergies: [], dislikes: [] },
  budget: { budgetWeek: 0 },
};

export const canContinue = (id: StepId, d: Draft): boolean =>
  id === 'sex' ? d.sex != null : id === 'weight' ? d.goalWeightKg < d.weightKg : true;

/** The first question whose answer cannot be used (edit mode can jump straight to the plan). */
export const firstInvalid = (d: Draft, steps: StepId[]): number => steps.findIndex((id) => !canContinue(id, d));


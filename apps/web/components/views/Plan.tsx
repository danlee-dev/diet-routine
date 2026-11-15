'use client';
import type { RoutineKey } from '@diet/core';
import { PageHead } from '../ui';
import { AccountButton } from '../Settings';
import { Situations } from './Situations';
import { Workout } from './Workout';
import { Shop } from './Shop';

export type PlanTab = 'situations' | 'workout' | 'shop';
export const PLAN_TABS: [PlanTab, string][] = [['situations', '상황별'], ['workout', '홈트'], ['shop', '장보기']];

export function Plan({ tab, setTab, onStartWorkout, onGoToday }: { tab: PlanTab; setTab: (t: PlanTab) => void; onStartWorkout: (r: RoutineKey) => void; onGoToday: () => void }) {
  return (
    <>
      <PageHead eyebrow="계획" title="식단과 운동" trailing={<AccountButton className="only-phone" />} />
      <div className="seg plan-tabs" role="group" aria-label="계획 구분">
        {PLAN_TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'situations' && <Situations onGoToday={onGoToday} />}
      {tab === 'workout' && <Workout onStart={onStartWorkout} />}
      {tab === 'shop' && <Shop />}
    </>
  );
}

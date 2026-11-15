'use client';
import { KEEP, type RoutineKey } from '@diet/core';
import { useEnv } from '@/lib/hooks';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';
import { ImportSheet, SyncSheet } from '../sheets';
import { Situations } from './Situations';
import { Workout } from './Workout';
import { Shop } from './Shop';

export type PlanTab = 'situations' | 'workout' | 'shop' | 'basics';
export const PLAN_TABS: [PlanTab, string][] = [['situations', '상황별'], ['workout', '홈트'], ['shop', '장보기'], ['basics', '기본']];

function Basics() {
  const env = useEnv();
  const { open } = useOverlay();
  const synced = env.store.syncState === 'synced';
  return (
    <div className="wo-grid">
      <div className="col">
        <div className="box sq">
          <p className="eyebrow" style={{ marginBottom: 12 }}>항상 지키는 것</p>
          <div className="keep">
            {KEEP.map((k) => (
              <div key={k.title} className="keep-item"><span className="tile sq"><Icon name={k.icon} /></span><div><b>{k.title}</b><span>{k.desc}</span></div></div>
            ))}
          </div>
        </div>
      </div>
      <div className="col">
        <div className="box sq">
          <p className="eyebrow" style={{ marginBottom: 8 }}>동기화</p>
          <p className="note">로그인하면 폰 앱과 이 화면이 같은 기록을 봅니다.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="mini-btn ghost" onClick={() => open(<SyncSheet />)}><Icon name={synced ? 'cloud' : 'cloud-off'} />{synced ? '동기화됨' : '로그인'}</button>
            <button type="button" className="mini-btn ghost" onClick={() => open(<ImportSheet />)}><Icon name="clipboard-paste" />예전 백업 코드</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Plan({ tab, setTab, onStartWorkout, onGoToday }: { tab: PlanTab; setTab: (t: PlanTab) => void; onStartWorkout: (r: RoutineKey) => void; onGoToday: () => void }) {
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">계획</span>
        <h1 className="page-title">식단과 운동 계획</h1>
      </div>
      <div className="seg plan-tabs" role="group" aria-label="계획 구분">
        {PLAN_TABS.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'situations' && <Situations embedded onGoToday={onGoToday} />}
      {tab === 'workout' && <Workout embedded onStart={onStartWorkout} />}
      {tab === 'shop' && <Shop embedded />}
      {tab === 'basics' && <Basics />}
    </>
  );
}

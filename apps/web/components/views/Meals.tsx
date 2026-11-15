'use client';
// The whole day's meals at a glance: time, every item with its amount, kcal and protein, and the day total
// against today's target. Tap a meal to edit it. The coach edits the same plan, so its changes show here too.
import { fmt, hhmm, md, MEALS, parseKey, plan, type MealKey } from '@diet/core';
import { planMeta, setMealOverride, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { eul } from '@/lib/ko';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';
import { MealEditSheet } from '../PlanSheets';
import { ShareMealsSheet } from '../ShareMeals';

export function Meals() {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const v = todayView(env);
  const meta = planMeta(env, v.ctx.key);
  const who = meta?.source === 'ai' ? '코치가 바꿈' : '내가 바꿈';
  const total = v.meals.reduce((s, m) => s + m.kcal, 0);
  const protein = v.meals.reduce((s, m) => s + m.protein, 0);
  const diff = total - v.target;
  const removed = (Object.entries(v.override?.meals ?? {}) as [MealKey, { removed?: boolean } | undefined][]).filter(([, o]) => o?.removed);
  // names as today's situation has them ("프로틴" on a rest day, not "운동 후")
  const situational = plan({ scen: v.scen, eatout: v.eatout, wake: v.day.wake_min });
  const nameOf = (k: MealKey) => situational.find((m) => m.key === k)?.name ?? MEALS[k].name;

  return (
    <div className="meals-view">
      <section aria-label="하루 합계">
        <p className="day-total"><b>{fmt(total)}</b><span>/ {fmt(v.target)} kcal</span></p>
        <p className="note">
          단백질 {protein}g · 최소 {env.program.proteinFloor}g
          {diff > 0 ? ` · 목표보다 ${fmt(diff)}kcal 많습니다` : diff < -50 ? ` · 목표보다 ${fmt(-diff)}kcal 적습니다` : ''}
        </p>
        {meta && <p className="edit-meta">{md(parseKey(meta.from))} {who}{meta.note ? ` · ${meta.note}` : ''}</p>}
        <button type="button" className="btn-ghost pill share-btn" onClick={() => open(<ShareMealsSheet />)}><Icon name="share" />식단표 공유</button>
      </section>

      <ul className="meal-table">
        {v.meals.map((m) => {
          const marks = [m.edited ? who : null, m.changes?.length ? `오늘만: ${m.changes.join(', ')}` : null].filter(Boolean);
          return (
            <li key={m.key}>
              <button type="button" className="mt-row" aria-label={`${m.name} ${fmt(m.kcal)}kcal. 바꾸기`} onClick={() => open(<MealEditSheet mealKey={m.key} />)}>
                <span className="mt-time">{m.at != null ? hhmm(m.at) : ''}</span>
                <span className="mt-main">
                  <span className="mt-h">
                    <b>{m.name}</b>
                    <span className="kc">{m.est ? '약 ' : ''}{fmt(m.kcal)}<small>kcal</small></span>
                  </span>
                  <span className="mt-items">
                    {m.items.map((x, i) => (
                      <span key={`${x.name}-${i}`} className="mt-item">
                        <span className="nm">{x.name}</span>
                        <span className="am">{x.amount}{x.kcal != null ? ` · ${fmt(x.kcal)}kcal` : ''}</span>
                      </span>
                    ))}
                  </span>
                  <span className="mt-meta">단백질 {m.protein}g{marks.length ? ` · ${marks.join(' · ')}` : ''}</span>
                </span>
                <Icon name="chevron-right" size="sm" className="mt-chev" />
              </button>
            </li>
          );
        })}
      </ul>

      {removed.length > 0 && (
        <section>
          <h2 className="section-title">뺀 끼니</h2>
          <ul className="kv-list">
            {removed.map(([k]) => (
              <li key={k}>
                <span className="muted">{nameOf(k)}</span>
                <button type="button" className="link-btn" onClick={() => { const undo = setMealOverride(env, k, null, 'user', `${eul(nameOf(k))} 다시 넣었습니다`); toast(`${eul(nameOf(k))} 다시 넣었습니다`, undo); }}>다시 넣기</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="note" style={{ marginTop: 16 }}>끼니를 누르면 항목, 양, 시간을 바꿉니다. 코치에게 말로 부탁해도 같은 곳이 바뀝니다.</p>
    </div>
  );
}

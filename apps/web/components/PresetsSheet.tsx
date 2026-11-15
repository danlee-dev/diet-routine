'use client';
// The foods behind "다르게 먹었어요": add, change or remove them. Saved per user and synced, so the iPhone shows
// the same list.
import { useState } from 'react';
import { fmt, type FoodPreset } from '@diet/core';
import { foodPresets, PRESET_GROUPS, presetsCustomized, removePreset, resetPresets, savePreset, type PresetGroup } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { SheetHead, useOverlay } from './ui';

export function PresetsSheet() {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const list = foodPresets(env);
  const [armed, setArmed] = useState(false);
  return (
    <div className="presets">
      <SheetHead eyebrow="다르게 먹었어요" title="자주 먹는 음식" />
      <p className="s-lead">다르게 먹었어요에서 고르는 목록입니다. 여기서 바꾸면 아이폰에도 같은 목록이 보입니다.</p>
      <button type="button" className="btn-primary pill wide-btn" onClick={() => open(<PresetEditSheet />, { focus: '#pe-name' })}>
        <Icon name="plus" size="sm" />음식 추가
      </button>
      {PRESET_GROUPS.map(([g, label]) => {
        const rows = list.filter((p) => p.group === g);
        if (!rows.length) return null;
        return (
          <div key={g}>
            <p className="group-h">{label}</p>
            <div className="pick-list" style={{ marginTop: 0 }}>
              {rows.map((p) => (
                <button key={p.id} type="button" className="pick-row no-ic" onClick={() => open(<PresetEditSheet preset={p} />, { focus: '#pe-name' })}>
                  <span><b>{p.name}</b><span>{p.serving} · 단백질 {p.protein}g</span></span>
                  <span className="r">{fmt(p.kcal)}kcal<Icon name="pencil" size="sm" className="dim" /></span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!list.length && <p className="note" style={{ marginTop: 16 }}>목록이 비어 있습니다. 음식을 추가하거나 기본 목록으로 되돌립니다.</p>}
      {presetsCustomized(env) && (
        <button
          type="button"
          className="link-btn quiet"
          style={{ marginTop: 16 }}
          onClick={() => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3000); return; }
            const undo = resetPresets(env);
            setArmed(false);
            toast('기본 목록으로 되돌렸습니다', undo);
          }}
        >
          {armed ? '한 번 더 누르면 되돌립니다' : <><Icon name="rotate-ccw" size="sm" />기본 목록으로 되돌리기</>}
        </button>
      )}
    </div>
  );
}

const digits = (s: string) => s.replace(/[^\d]/g, '').slice(0, 5);

export function PresetEditSheet({ preset }: { preset?: FoodPreset }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const [name, setName] = useState(preset?.name ?? '');
  const [serving, setServing] = useState(preset?.serving ?? '1인분');
  const [group, setGroup] = useState<PresetGroup>(preset?.group ?? 'meal');
  const [kcal, setKcal] = useState(preset ? String(preset.kcal) : '');
  const [protein, setProtein] = useState(preset ? String(preset.protein) : '');
  const [msg, setMsg] = useState('');
  const back = () => open(<PresetsSheet />);
  const save = () => {
    if (!name.trim()) { setMsg('이름을 넣어 주세요'); return; }
    if (!Number(kcal)) { setMsg('칼로리를 넣어 주세요'); return; }
    const { undo } = savePreset(env, { id: preset?.id, name, serving, group, kcal: Number(kcal), protein: Number(protein) || 0 });
    back();
    toast(preset ? `${name.trim()} 바꿨습니다` : `${name.trim()} 추가했습니다`, undo);
  };
  return (
    <div className="preset-edit">
      <SheetHead eyebrow="자주 먹는 음식" title={preset ? '음식 고치기' : '음식 추가'} />
      <label className="pe-field"><span>이름</span><input id="pe-name" className="input sq" value={name} placeholder="예: 연어 포케" maxLength={40} onChange={(e) => { setName(e.target.value); setMsg(''); }} /></label>
      <label className="pe-field"><span>한 번에 먹는 양</span><input className="input sq" value={serving} placeholder="예: 1볼, 반 마리" maxLength={30} onChange={(e) => setServing(e.target.value)} /></label>
      <div className="ie-nums two pe-nums">
        <label className="unit-in"><input className="input sq" value={kcal} inputMode="numeric" placeholder="0" aria-label="칼로리" onChange={(e) => { setKcal(digits(e.target.value)); setMsg(''); }} /><span>kcal</span></label>
        <label className="unit-in"><input className="input sq" value={protein} inputMode="numeric" placeholder="0" aria-label="단백질" onChange={(e) => setProtein(digits(e.target.value))} /><span>g</span></label>
      </div>
      <p className="group-h">어디에 둘까요</p>
      <div className="slot-chips" role="group" aria-label="분류" style={{ marginTop: 8 }}>
        {PRESET_GROUPS.map(([g, label]) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{label}</button>)}
      </div>
      <p className="form-msg" aria-live="polite">{msg}</p>
      <div className="sheet-acts">
        <button type="button" className="btn-ghost pill" onClick={back}>목록으로</button>
        <button type="button" className="btn-primary pill" onClick={save}><Icon name="check" size="sm" />저장</button>
      </div>
      {preset && (
        <button
          type="button"
          className="link-btn quiet"
          style={{ marginTop: 12 }}
          onClick={() => { const undo = removePreset(env, preset.id); back(); toast(`${preset.name} 뺐습니다`, undo); }}
        >
          <Icon name="trash" size="sm" />목록에서 빼기
        </button>
      )}
    </div>
  );
}

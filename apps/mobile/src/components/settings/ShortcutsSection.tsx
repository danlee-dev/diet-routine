// Settings: widgets, Siri and Shortcuts, Live Activity options. The phrases match DarouShortcuts in
// apps/mobile/targets/widget/_shared/DarouIntents.swift.
import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useEnv } from '@/lib/hooks';
import { cutoffActivityEnabled, setCutoffActivityEnabled, syncCutoffActivity } from '@/lib/native/activities';
import { Row, Section } from '@/components/list';
import { Toggle } from '@/components/settings/HealthNotifySection';

const PHRASES = ['다루에 물 마셨어', '다루에 체중 기록', '다루에서 달리기 시작', '다루 오늘 뭐 먹어', '다루에 다음 끼니 먹었어'];

export function ShortcutsSection() {
  const env = useEnv();
  const [cutoff, setCutoff] = useState(cutoffActivityEnabled);
  if (Platform.OS !== 'ios') return null;
  const toggleCutoff = (on: boolean) => {
    setCutoff(on);
    setCutoffActivityEnabled(on);
    syncCutoffActivity(env);
  };
  return (
    <Section
      title="위젯과 단축어"
      footer="단축어 앱의 자동화에서 NFC를 고르면 냉장고에 붙인 스티커에 '다음 끼니 먹음'을 연결할 수 있습니다. 설정 > 손쉬운 사용 > 터치 > 뒷면 탭에 '물 한 잔 기록'을, 설정 > 동작 버튼에 '달리기 시작'을 연결할 수도 있습니다."
    >
      <Row title="Siri에게 말하기" sub={PHRASES.map((p) => `“${p}”`).join('  ')} />
      <Row title="위젯" sub="홈 화면을 길게 누르고 편집 > 위젯 추가에서 다루를 찾습니다. 잠금 화면에는 칼로리 · 걸음 원형 위젯이 있습니다." />
      <Row title="단축어 앱 열기" chevron onPress={() => void Linking.openURL('shortcuts://')} />
      <Row
        title="저녁 마감 카운트다운"
        sub="저녁을 기록하기 전이면 19:30부터 잠금 화면과 다이내믹 아일랜드에 남은 시간을 보여줍니다"
        right={<Toggle label="저녁 마감 카운트다운" on={cutoff} onChange={toggleCutoff} />}
      />
    </Section>
  );
}

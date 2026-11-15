// Common off-plan meals with rough estimates (1 serving). The AI coach replaces these with real analysis in phase 1.
export interface FoodPreset {
  id: string;
  name: string;
  serving: string;
  kcal: number;
  protein: number;
  group: 'meal' | 'delivery' | 'drink' | 'snack';
}

export const PRESETS: FoodPreset[] = [
  { id: 'chicken-half', name: '후라이드 치킨', serving: '반 마리', kcal: 1150, protein: 70, group: 'delivery' },
  { id: 'jjajang', name: '짜장면', serving: '1그릇', kcal: 800, protein: 20, group: 'delivery' },
  { id: 'jjamppong', name: '짬뽕', serving: '1그릇', kcal: 750, protein: 30, group: 'delivery' },
  { id: 'malatang', name: '마라탕', serving: '보통', kcal: 750, protein: 30, group: 'delivery' },
  { id: 'tteokbokki', name: '떡볶이', serving: '1인분', kcal: 550, protein: 12, group: 'delivery' },
  { id: 'burger-set', name: '햄버거 세트', serving: '1세트', kcal: 1100, protein: 30, group: 'delivery' },
  { id: 'samgyeop', name: '삼겹살 + 밥 반 공기', serving: '1인분 200g', kcal: 1050, protein: 40, group: 'meal' },
  { id: 'gukbap', name: '순대국밥', serving: '1그릇', kcal: 650, protein: 30, group: 'meal' },
  { id: 'kimchi-jjigae', name: '김치찌개 + 공기밥', serving: '1인분', kcal: 600, protein: 25, group: 'meal' },
  { id: 'fish-set', name: '생선구이 정식', serving: '밥 반 공기', kcal: 550, protein: 35, group: 'meal' },
  { id: 'gimbap', name: '김밥', serving: '1줄', kcal: 450, protein: 12, group: 'meal' },
  { id: 'ramen', name: '라면', serving: '1개', kcal: 520, protein: 11, group: 'meal' },
  { id: 'cvs-box', name: '편의점 도시락', serving: '1개', kcal: 750, protein: 25, group: 'meal' },
  { id: 'salad-chicken', name: '닭가슴살 샐러드', serving: '1볼', kcal: 350, protein: 30, group: 'meal' },
  { id: 'soju-half', name: '소주', serving: '반 병', kcal: 270, protein: 0, group: 'drink' },
  { id: 'beer', name: '맥주', serving: '500ml', kcal: 220, protein: 2, group: 'drink' },
  { id: 'latte', name: '카페라떼', serving: '톨', kcal: 190, protein: 10, group: 'drink' },
  { id: 'bread', name: '빵', serving: '1개', kcal: 300, protein: 7, group: 'snack' },
  { id: 'snack-bag', name: '과자', serving: '1봉', kcal: 450, protein: 5, group: 'snack' },
];

export const PORTIONS = [
  { id: 'less', label: '적게', mult: 0.7 },
  { id: 'normal', label: '보통', mult: 1 },
  { id: 'more', label: '많이', mult: 1.4 },
] as const;

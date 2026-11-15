// Plan content: meals, situations, workouts, shopping. Ported 1:1 from apps/web-legacy.
// Icons are semantic names; each app maps them to its icon set (Lucide on web, SF Symbols on iOS).

export type MealKey = 'breakfast' | 'lunch' | 'snack' | 'post' | 'dinner';
export type ScenId = 'home' | 'late' | 'out' | 'eatout' | 'lateHome' | 'rest';
export type RoutineKey = 'A' | 'B';
export type EatoutSlot = 'lunch' | 'dinner';

export interface PlanItem {
  name: string;
  amount: string;
  /** how to eat / prepare, e.g. "저지방 우유 200ml 에 타서 흔들기" */
  note?: string;
  /** per-item estimate; items of a planned meal add up to the meal's numbers */
  kcal?: number;
  protein?: number;
}

export interface MealDef {
  icon: string;
  name: string;
  /** Default timing text when no wake time is known. */
  time: string;
  items: PlanItem[];
  kcal: number;
  protein: number;
  /** kcal is an estimate (eating out). */
  est?: boolean;
  swaps: string[];
}

export interface ScenDef {
  icon: string;
  name: string;
  short: string;
  rules: string[];
  over?: Partial<Record<MealKey, Partial<MealDef>>>;
}

const it = (name: string, amount: string, kcal?: number, protein?: number): PlanItem => (kcal == null ? { name, amount } : { name, amount, kcal, protein: protein ?? 0 });

export const MEALS: Record<MealKey, MealDef> = {
  breakfast: {
    icon: 'sun', name: '아침', time: '일어나서 1시간 안',
    items: [it('달걀', '2개', 140, 12), it('무가당 그릭요거트', '100g', 95, 9), it('귤 (꼬마과)', '3개', 60, 0), it('블랙커피', '마시고 싶으면', 0, 0)],
    kcal: 295, protein: 21,
    swaps: ['닭가슴살을 먹고 싶으면 간식 닭가슴살과 바꿉니다. 달걀 2개는 간식 때 먹습니다.', '귤이 중간 크기면 2개만 먹습니다.'],
  },
  lunch: {
    icon: 'utensils', name: '점심', time: '아침 3~4시간 뒤',
    items: [it('햇반 흑미 작은공기', '1개', 210, 5), it('한끼통살 큐브', '1팩', 165, 14), it('냉동 브로콜리', '150g', 50, 3), it('김치 또는 저칼로리 드레싱', '조금 / 1큰술', 25, 0)],
    kcal: 450, protein: 22,
    swaps: ['큐브는 간이 세서 점심에 먹습니다. 저녁에 먹으면 다음 날 붓기 쉽습니다.', '김치 대신 드레싱 1큰술로 바꿔도 됩니다.'],
  },
  snack: {
    icon: 'apple', name: '간식', time: '점심 3시간 뒤',
    items: [it('헬로틴 저염 닭가슴살', '1팩', 110, 23), it('하루견과', '1봉', 140, 6)],
    kcal: 250, protein: 29,
    swaps: ['아침 달걀과 서로 바꿔도 됩니다.', '배가 안 고프면 닭가슴살을 저녁이나 아침으로 옮깁니다. 하루 3팩만 지키면 됩니다.'],
  },
  post: {
    icon: 'dumbbell', name: '운동 후', time: '홈트 끝나고 바로',
    items: [it('프로틴 (더블리치초콜릿)', '1스쿱', 120, 24), it('저지방 우유', '200ml', 90, 6)],
    kcal: 210, protein: 30,
    swaps: ['운동을 쉬는 날에는 간식 때 같이 마십니다.'],
  },
  dinner: {
    icon: 'moon', name: '저녁', time: '8시 전에 끝내기',
    items: [it('헬로틴 저염 닭가슴살', '1팩', 110, 23), it('샐러드 믹스', '1봉', 20, 2), it('방울토마토', '10개', 35, 2), it('저칼로리 드레싱', '1큰술', 20, 0)],
    kcal: 185, protein: 27,
    swaps: ['8시가 넘으면 물, 아메리카노, 제로 음료만 마십니다.'],
  },
};

export const ORDER: MealKey[] = ['breakfast', 'lunch', 'snack', 'post', 'dinner'];

export const CARRY_SNACK: MealDef = {
  icon: 'backpack', name: '간식 (밖에서)', time: '점심 3시간 뒤',
  items: [it('하루견과', '1봉 · 가방에', 140, 6), it('귤', '2개 · 가방에', 40, 0), it('편의점 닭가슴살', '1팩 (없으면 구운란 2개)', 105, 21)],
  kcal: 285, protein: 27,
  swaps: ['견과와 귤은 상온에 둬도 되니 나가기 전에 챙깁니다.'],
};

export const EATOUT = (k: EatoutSlot): MealDef => ({
  icon: 'utensils-crossed', name: `${k === 'lunch' ? '점심' : '저녁'} (외식)`, time: k === 'lunch' ? '점심때' : '8시 전에 끝내기',
  items: [it('고르는 메뉴', '생선구이·쌈밥 정식, 샤브샤브'), it('밥', '반 공기'), it('국물', '남기기'), it('튀김·전', '먹지 않기')],
  kcal: 550, protein: 30, est: true,
  swaps: ['메뉴를 못 고르겠으면 생선구이 정식이 제일 무난합니다.'],
});

export const SCEN: Record<ScenId, ScenDef> = {
  home: {
    icon: 'house', name: '집에 있는 날', short: '기본 순서 그대로 먹습니다.',
    rules: ['순서만 지키면 시간은 조금 달라도 됩니다.', '끼니 사이는 최소 2시간 둡니다.', '저녁은 8시 전에 끝냅니다.'],
  },
  late: {
    icon: 'alarm-clock', name: '늦게 일어난 날', short: '일어난 시간 기준으로 끼니 간격을 좁힙니다.',
    rules: ['일어나서 처음 먹는 끼니가 아침입니다. 아침 메뉴를 건너뛰지 않습니다.', '오늘 화면에 일어난 시간을 넣으면 끼니 시간이 자동으로 당겨집니다.', '오후 1시 넘어 일어났으면 첫 끼에 간식 닭가슴살을 같이 먹습니다.', '저녁 8시 마감은 그대로입니다.'],
  },
  out: {
    icon: 'car', name: '오후에 외출', short: '간식은 가방에 챙겨 나갑니다.',
    rules: ['나가기 전에 하루견과 1봉과 귤 2개를 챙깁니다.', '편의점에서 고르는 것: 닭가슴살, 구운란, 아메리카노, 제로 음료.', '편의점에서 피하는 것: 빵, 라떼, 삼각김밥, 컵라면, 단백질바.', '8시 전에 집에 못 오면 "늦게 들어오는 날"로 바꿉니다.'],
    over: { snack: CARRY_SNACK },
  },
  eatout: {
    icon: 'utensils-crossed', name: '밖에서 밥', short: '외식하는 한 끼만 바꾸고 나머지는 그대로입니다.',
    rules: ['고르는 메뉴: 생선구이 정식, 쌈밥 정식, 샤브샤브(칼국수·죽 빼고), 닭가슴살 샐러드.', '피하는 메뉴: 라면, 짜장·짬뽕, 돈가스, 마라탕, 국밥, 햄버거, 김밥 2줄.', '밥은 반 공기만 먹고 국물은 남깁니다. 튀김과 전은 손대지 않습니다.', '외식한 끼니 말고 나머지 끼니는 평소대로 먹습니다.'],
  },
  lateHome: {
    icon: 'moon-star', name: '늦게 들어오는 날', short: '저녁은 7시쯤 밖에서 미리 먹습니다.',
    rules: ['7시쯤 밖에서 편의점 닭가슴살 1팩과 구운란 1개로 저녁을 먹습니다.', '밖에서 못 먹었으면 집에 와서 9시 전에 프로틴 1스쿱을 물에 타서 마십니다.', '9시가 넘었으면 물만 마시고 잡니다.', '야식, 배달 음식, 라면은 먹지 않습니다.'],
    over: {
      snack: CARRY_SNACK,
      post: { icon: 'glass-water', name: '프로틴', time: '집에 와서 9시 전에', items: [it('프로틴', '1스쿱', 120, 24), it('물', '300ml', 0, 0)], kcal: 120, protein: 24, swaps: ['늦게 온 날은 홈트를 쉬고 걸음 수만 채웁니다.'] },
      dinner: { icon: 'store', name: '저녁 (밖에서)', time: '7시쯤', items: [it('편의점 닭가슴살', '1팩', 105, 21), it('구운란', '1개', 70, 6), it('샐러드가 있으면', '1개', 35, 2)], kcal: 210, protein: 29, est: true, swaps: ['집에 와서는 더 먹지 않습니다.'] },
    },
  },
  rest: {
    icon: 'bed', name: '운동 쉬는 날', short: '프로틴은 간식 때 같이 마십니다.',
    rules: ['일요일과 수요일(걷기만 하는 날)이 쉬는 날입니다.', '프로틴 + 우유는 간식 때나 저녁 먹기 전에 마십니다.', '홈트는 쉬어도 걸음 수 목표는 채웁니다.'],
    over: { post: { icon: 'glass-water', name: '프로틴', time: '간식 때 같이' } },
  },
};

export const SCEN_ORDER: ScenId[] = ['home', 'late', 'out', 'eatout', 'lateHome', 'rest'];

export interface InfoCard {
  icon: string;
  name: string;
  short: string;
  rules: string[];
}

export const EXTRA: InfoCard[] = [
  { icon: 'glass-water', name: '배고플 때', short: '순서대로 해 보고 그래도 배고프면 먹습니다.', rules: ['물 한 컵을 먼저 마십니다.', '방울토마토 5개나 귤 1개를 먹습니다.', '아메리카노나 제로 탄산을 마십니다.', '그래도 배고프면 닭가슴살 반 팩을 먹고, 다음 끼니에서 그만큼 줄입니다.'] },
  { icon: 'wine', name: '회식·술자리', short: '이번 달은 되도록 피합니다.', rules: ['피할 수 없으면 하이볼이나 소주 2~3잔까지만 마십니다.', '안주는 회, 수육 살코기, 두부 위주로 먹습니다.', '튀김, 전, 면, 마지막 볶음밥은 먹지 않습니다.', '다음 날 굶지 말고 평소 식단대로 먹습니다.'] },
  { icon: 'heart-pulse', name: '어지럽거나 머리 아플 때', short: '칼로리를 조금 올립니다.', rules: ['저녁에 햇반 반 개를 더 먹습니다.', '물을 하루 1.5~2L 마십니다.', '며칠 계속되면 감량 속도를 늦추고, 심하면 병원에 갑니다.'] },
];

export const KEEP = [
  { icon: 'clock', title: '저녁은 8시 전', desc: '8시 이후엔 물, 아메리카노, 제로 음료만' },
  { icon: 'drumstick', title: '닭가슴살 하루 3팩', desc: '점심 큐브 1 + 헬로틴 2. 시간은 옮겨도 됩니다' },
  { icon: 'ban', title: '안 먹는 것', desc: '술, 라떼·주스·탄산, 과자, 빵, 야식' },
] as const;

export const URLS = {
  hellotin: 'https://www.coupang.com/vp/products/8768983909?itemId=25504527355&vendorItemId=94985273503',
  cube: 'https://www.coupang.com/vp/products/9374076683?itemId=27824301596&vendorItemId=94783966194',
  rice: 'https://www.coupang.com/vp/products/9775759055?itemId=29263841617&vendorItemId=90891143880',
  broc: 'https://www.coupang.com/vp/products/7762667800?itemId=20937085721&vendorItemId=88003421394',
  nuts: 'https://www.coupang.com/vp/products/7783867131',
  protein: 'https://www.coupang.com/vp/products/7939328589?itemId=28906890269&vendorItemId=95838995062',
  dressing: 'https://www.coupang.com/vp/products/7109193232',
  eggs: 'https://www.coupang.com/vp/products/1271064981',
  coffee: 'https://www.coupang.com/vp/products/8245789579?itemId=24631835189&vendorItemId=4326010075',
  yogurt: 'https://www.coupang.com/vp/products/7216495213?itemId=15031818918&vendorItemId=82254446775',
  salad: 'https://www.coupang.com/vp/products/7465395509?itemId=19468130909&vendorItemId=86578457009',
  tomato: 'https://www.coupang.com/vp/products/327206043?itemId=1046983315&vendorItemId=5510129601',
  milk: 'https://www.coupang.com/vp/products/7922949204',
  tangerine: 'https://www.coupang.com/vp/products/8997225776?itemId=20497557499&vendorItemId=87575922747',
} as const;

export interface ShopItem {
  id: string;
  name: string;
  qty: string;
  price: number;
  url: string;
  optional?: boolean;
}

export const SHOP_NOW: ShopItem[] = [
  { id: 'n1', name: '헬로틴 저염 스팀 닭가슴살', qty: '30개 · 15일치', price: 34420, url: URLS.hellotin },
  { id: 'n2', name: '한끼통살 큐브 깻잎맛', qty: '30개입 · 30일치', price: 39900, url: URLS.cube },
  { id: 'n3', name: '햇반 흑미밥 작은공기 130g', qty: '36개', price: 29980, url: URLS.rice },
  { id: 'n4', name: '냉동 브로콜리 1kg', qty: '2개 옵션', price: 8590, url: URLS.broc },
  { id: 'n5', name: '하루견과 고마워요 믹스넛 20g', qty: '30개', price: 15700, url: URLS.nuts },
  { id: 'n6', name: '옵티멈 골드스탠다드 더블리치초콜릿', qty: '899g', price: 62910, url: URLS.protein },
  { id: 'n7', name: '오뚜기 라이트앤조이 오리엔탈 드레싱', qty: '320g', price: 3300, url: URLS.dressing },
  { id: 'n8', name: '곰곰 무항생제 대란', qty: '30구', price: 8390, url: URLS.eggs },
  { id: 'n9', name: '카누 미니 마일드 로스트 (선택)', qty: '90개입', price: 22050, url: URLS.coffee, optional: true },
];

export const SHOP_WEEK: ShopItem[] = [
  { id: 'w1', name: '매일바이오 그릭요거트 무가당 플레인', qty: '800g', price: 7880, url: URLS.yogurt },
  { id: 'w2', name: '피그인더가든 데일리믹스 100g', qty: '월 4개 + 목 3개', price: 10920, url: URLS.salad },
  { id: 'w3', name: '세도농협 GAP 대추방울토마토', qty: '1kg · 새콤하고 단단한 쪽', price: 8610, url: URLS.tomato },
  { id: 'w4', name: '서울우유 저지방 1L', qty: '2개', price: 5380, url: URLS.milk },
];

export interface CycleItem {
  id: string;
  name: string;
  sub: string;
  /** Program day numbers (1-based) on which to order. */
  days: number[];
  url: string;
}

export const CYCLE: CycleItem[] = [
  { id: 'tangerine', name: '탐라황감 감귤 꼬마과 3kg', sub: '작고 새콤한 쪽 · 하루 3개', days: [1, 22], url: URLS.tangerine },
  { id: 'dressing', name: '오리엔탈 드레싱 1병', sub: '하루 2큰술이면 열흘', days: [9, 19, 29], url: URLS.dressing },
  { id: 'broc', name: '냉동 브로콜리 1kg 2개', sub: '하루 150g이면 13일', days: [12, 26], url: URLS.broc },
  { id: 'eggs', name: '곰곰 무항생제 대란 30구', sub: '하루 2개면 15일', days: [13, 27], url: URLS.eggs },
  { id: 'hellotin', name: '헬로틴 저염 스팀 30개', sub: '하루 2팩이면 15일', days: [13, 28], url: URLS.hellotin },
  { id: 'cube', name: '한끼통살 큐브 30개입', sub: '다음 달 분', days: [28], url: URLS.cube },
];

export interface RoutineDef {
  name: string;
  focus: string;
  items: { name: string; n: number; unit: string }[];
}

export const ROUTINES: Record<RoutineKey, RoutineDef> = {
  A: { name: '홈트 A', focus: '상체 · 복근', items: [{ name: '푸시업', n: 12, unit: '회' }, { name: '의자 딥스', n: 10, unit: '회' }, { name: '크런치', n: 20, unit: '회' }, { name: '플랭크', n: 40, unit: '초' }, { name: '마운틴클라이머', n: 20, unit: '회' }] },
  B: { name: '홈트 B', focus: '하체 · 전신', items: [{ name: '스쿼트', n: 20, unit: '회' }, { name: '런지', n: 10, unit: '회 (양쪽)' }, { name: '글루트 브릿지', n: 20, unit: '회' }, { name: '점프 없는 버피', n: 8, unit: '회' }, { name: '레그레이즈', n: 12, unit: '회' }] },
};

export type WeekType = 'rest' | 'A' | 'B' | 'walk' | 'light';
/** Index = Date.getDay() (0 = Sunday). */
export const WEEK: { t: WeekType; label: string }[] = [
  { t: 'rest', label: '휴식' }, { t: 'A', label: 'A' }, { t: 'B', label: 'B' }, { t: 'walk', label: '걷기' },
  { t: 'A', label: 'A' }, { t: 'B', label: 'B' }, { t: 'light', label: '가볍게' },
];

/** Weekly weight targets: [label, text, upper kg, lower kg]. */
export const TARGETS: { label: string; text: string; hi: number; lo: number }[] = [
  { label: '시작', text: '76kg', hi: 76, lo: 76 },
  { label: '1주차', text: '73.5~74kg', hi: 74, lo: 73.5 },
  { label: '2주차', text: '72.5~73kg', hi: 73, lo: 72.5 },
  { label: '3주차', text: '71.5~72kg', hi: 72, lo: 71.5 },
  { label: '4주차', text: '70~71kg', hi: 71, lo: 70 },
];

/** Corridor for the weight chart: program day index -> kg. */
export const TARGET_BAND = {
  upper: [[0, 76], [7, 74], [14, 73], [21, 72], [28, 71], [29, 71]] as [number, number][],
  lower: [[0, 76], [7, 73.5], [14, 72.5], [21, 71.5], [28, 70], [29, 70]] as [number, number][],
};

/** Carb/extra items that can be trimmed from a planned meal. Protein sources are never listed. */
export interface Cut {
  id: string;
  slot: MealKey;
  label: string;
  kcal: number;
  protein: number;
  /** a stronger version of another cut; applying it replaces that one */
  replaces?: string;
}

/** Order = preference when the day runs over: smallest loss of satiety first. */
export const CUTS: Cut[] = [
  { id: 'lunch-rice-half', slot: 'lunch', label: '햇반 반 공기만', kcal: 100, protein: 2 },
  { id: 'snack-nuts', slot: 'snack', label: '하루견과 빼기', kcal: 120, protein: 4 },
  { id: 'breakfast-tangerine', slot: 'breakfast', label: '귤 3개 → 1개', kcal: 60, protein: 0 },
  { id: 'post-water', slot: 'post', label: '프로틴을 우유 대신 물에 타기', kcal: 90, protein: 6 },
  { id: 'lunch-rice-none', slot: 'lunch', label: '햇반 빼기', kcal: 200, protein: 4, replaces: 'lunch-rice-half' },
  { id: 'dinner-dressing', slot: 'dinner', label: '드레싱 대신 레몬즙', kcal: 30, protein: 0 },
  { id: 'breakfast-yogurt', slot: 'breakfast', label: '그릭요거트 빼기', kcal: 60, protein: 10 },
];

/** Protein top-ups when the day falls short of the protein floor. */
export const PROTEIN_ADDS = [
  { id: 'add-chicken-half', label: '닭가슴살 반 팩 추가', kcal: 60, protein: 12 },
  { id: 'add-shake-water', label: '프로틴 1스쿱을 물에 타서', kcal: 120, protein: 24 },
  { id: 'add-eggs', label: '구운란 2개', kcal: 140, protein: 12 },
] as const;

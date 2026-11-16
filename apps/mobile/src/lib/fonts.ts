// Noto Serif KR (Google, SIL Open Font License 1.1, assets/fonts/NotoSerifKR-OFL.txt): the Myeongjo serif of
// the 다루 wordmark (SemiBold) and the Welcome headline (Light), set against the system sans of the rest of the
// app. Subset to KS X 1001 Hangul plus ASCII, about 1.4 MB a weight. Loaded before the first screen renders,
// so the splash can draw the wordmark in its first frame. iOS: never pair these families with fontWeight, or
// the system looks for a weight variant that is not registered.
export const FONT = { mark: 'NotoSerifKR-SemiBold', display: 'NotoSerifKR-Light' } as const;

export const FONT_FILES = {
  [FONT.mark]: require('../../assets/fonts/NotoSerifKR-SemiBold.ttf'),
  [FONT.display]: require('../../assets/fonts/NotoSerifKR-Light.ttf'),
};

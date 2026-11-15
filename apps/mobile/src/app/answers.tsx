import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

// Settings > 내 정보 다시 입력: the same questions prefilled from the profile, saved with replacePlan (undo toast).
export default function AnswersScreen() {
  return <OnboardingFlow mode="edit" />;
}

import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

// New user: questions -> plan ledger -> review -> completeOnboarding. The gate then swaps in Today.
export default function OnboardingScreen() {
  return <OnboardingFlow mode="new" />;
}

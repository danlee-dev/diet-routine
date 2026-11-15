import { Stack } from 'expo-router';

// The chat draws its own header (title, steps), so no native header here.
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

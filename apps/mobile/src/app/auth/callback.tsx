import { Redirect } from 'expo-router';

// The Google sign-in sheet hands the callback URL back to signInWithGoogle(); if iOS ever opens the app
// with it instead, land on Today rather than an unmatched route.
export default function AuthCallback() {
  return <Redirect href="/" />;
}

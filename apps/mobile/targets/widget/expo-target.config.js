// Home screen and lock screen widgets, Live Activities and the App Intents they share with the app.
// Files in ./_shared are compiled into both this extension and the main app (Siri and Shortcuts run them
// from the app; widget buttons run them here). Data comes from the App Group, see _shared/Glance.swift.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'DarouWidget',
  displayName: '다루',
  bundleIdentifier: '.widget',
  // interactive widget buttons (Button(intent:)) and widget configuration intents need iOS 17
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
  // neutral R=G=B like the app (apps/mobile/src/lib/theme.ts); the orb colours are the only hue
  colors: {
    $widgetBackground: { light: '#FCFCFC', dark: '#0A0A0A' },
    $accent: { light: '#0B0B0B', dark: '#F2F2F2' },
    fg: { light: '#0B0B0B', dark: '#F2F2F2' },
    fg2: { light: '#3A3A3A', dark: '#CFCFCF' },
    muted: { light: '#6B6B6B', dark: '#9B9B9B' },
    surface: { light: '#F3F3F3', dark: '#171717' },
    surface2: { light: '#E8E8E8', dark: '#262626' },
    onFg: { light: '#FFFFFF', dark: '#0A0A0A' },
    orb1: { light: '#FF7A45', dark: '#F0743F' },
    orb2: { light: '#FF4F6D', dark: '#E24C68' },
    orb3: { light: '#FFB37A', dark: '#D88C55' },
    orb4: { light: '#FFE6D0', dark: '#5E3E2C' },
  },
});

import SwiftUI

/** Colour tokens from expo-target.config.js (same values as the app's theme.ts). */
enum Ink {
  static let fg = Color("fg")
  static let fg2 = Color("fg2")
  static let muted = Color("muted")
  static let surface = Color("surface")
  static let surface2 = Color("surface2")
  static let onFg = Color("onFg")
  static let bg = Color("$widgetBackground")
}

/** The brand orb, the app's one colour accent (components/ui.tsx Orb). Used small and once per widget. */
struct Orb: View {
  var size: CGFloat

  var body: some View {
    ZStack {
      Circle().fill(Color("orb3"))
      Circle().fill(RadialGradient(colors: [Color("orb1"), Color("orb1").opacity(0)], center: UnitPoint(x: 0.4, y: 0.76), startRadius: 0, endRadius: size * 0.7))
      Circle().fill(RadialGradient(colors: [Color("orb2"), Color("orb2").opacity(0)], center: UnitPoint(x: 0.72, y: 0.34), startRadius: 0, endRadius: size * 0.6))
      Circle().fill(RadialGradient(colors: [Color("orb4"), Color("orb4").opacity(0)], center: UnitPoint(x: 0.3, y: 0.3), startRadius: 0, endRadius: size * 0.55))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/** A plain ring: track plus a neutral arc, round caps. */
struct Ring: View {
  var progress: Double
  var lineWidth: CGFloat

  var body: some View {
    ZStack {
      Circle().stroke(Ink.surface2, lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: max(0, min(1, progress)))
        .stroke(Ink.fg, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
  }
}

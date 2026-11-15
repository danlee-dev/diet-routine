// Lock screen and Dynamic Island for a run or walk, the home-workout rest timer and the dinner cutoff.
// No blinking or "LIVE" marks: the only status mark is a static red dot while a run is recording.
// No widget URL: a tap brings the app back where it was (the run or workout screen is still open there),
// where a deep link could stack a second copy of that screen.
import ActivityKit
import SwiftUI
import WidgetKit

private let recordingRed = Color(red: 1, green: 59 / 255, blue: 48 / 255)

private extension DarouActivityAttributes {
  var icon: String {
    switch kind {
    case "walk": return "figure.walk"
    case "run": return "figure.run"
    case "rest": return "timer"
    default: return "fork.knife"
    }
  }
  var isRun: Bool { kind == "run" || kind == "walk" }
}

private extension DarouActivityAttributes.ContentState {
  var recording: Bool { phase == "moving" }
  func status(_ a: DarouActivityAttributes) -> String {
    switch phase {
    case "paused": return "일시정지"
    case "autoPaused": return "멈춤"
    case "done": return "기록 끝"
    case "moving": return a.kind == "walk" ? "걷기 기록 중" : "달리기 기록 중"
    default: return a.title
    }
  }
}

/** Counts up from clockFrom, down to endsAt, or shows the fixed text. */
private struct Clock: View {
  let state: DarouActivityAttributes.ContentState

  var body: some View {
    if let from = state.clockFrom {
      Text(timerInterval: Date(timeIntervalSince1970: from / 1000)...Date.distantFuture, countsDown: false)
    } else if let end = state.endsAt {
      let e = Date(timeIntervalSince1970: end / 1000)
      Text(timerInterval: min(Date(), e)...e, countsDown: true)
    } else {
      Text(state.clockText ?? "")
    }
  }
}

struct DarouLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DarouActivityAttributes.self) { context in
      LockScreenActivity(attrs: context.attributes, state: context.state, stale: context.isStale)
        .activityBackgroundTint(Ink.bg)
        .activitySystemActionForegroundColor(Ink.fg)
    } dynamicIsland: { context in
      let a = context.attributes
      let s = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            if s.recording { Circle().fill(recordingRed).frame(width: 7, height: 7) }
            Image(systemName: a.icon)
            Text(a.isRun ? s.status(a) : a.title).lineLimit(1)
          }
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(.white.opacity(0.75))
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Clock(state: s).font(.system(size: 20, weight: .light)).monospacedDigit().foregroundStyle(.white)
            .multilineTextAlignment(.trailing).frame(maxWidth: 96, alignment: .trailing).padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if a.isRun {
            HStack(alignment: .firstTextBaseline) {
              Text(s.primary ?? "0.00").font(.system(size: 34, weight: .light)).monospacedDigit()
              Text(s.primaryUnit ?? "km").font(.system(size: 14)).foregroundStyle(.white.opacity(0.6))
              Spacer()
              if let stat = s.stat {
                VStack(alignment: .trailing, spacing: 0) {
                  Text(s.statLabel ?? "").font(.system(size: 11)).foregroundStyle(.white.opacity(0.6))
                  Text(stat).font(.system(size: 18, weight: .light)).monospacedDigit()
                }
              }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 4)
          } else if let detail = s.detail {
            Text(detail).font(.system(size: 14)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
              .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
          }
        }
      } compactLeading: {
        HStack(spacing: 4) {
          if s.recording { Circle().fill(recordingRed).frame(width: 6, height: 6) }
          Image(systemName: a.icon).foregroundStyle(.white)
        }
      } compactTrailing: {
        if a.isRun {
          Text("\(s.primary ?? "0.00")\(s.primaryUnit ?? "km")").monospacedDigit().foregroundStyle(.white)
        } else {
          Clock(state: s).monospacedDigit().foregroundStyle(.white).frame(width: 46).multilineTextAlignment(.trailing)
        }
      } minimal: {
        Image(systemName: a.icon).foregroundStyle(.white)
      }
    }
  }
}

private struct LockScreenActivity: View {
  let attrs: DarouActivityAttributes
  let state: DarouActivityAttributes.ContentState
  /** past its stale date: the countdown reached zero while the app was not running to end it */
  let stale: Bool

  var body: some View {
    Group {
      if attrs.isRun { run } else { countdown }
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 16)
  }

  private var run: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          if state.recording { Circle().fill(recordingRed).frame(width: 8, height: 8) }
          Text(state.status(attrs)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.muted)
        }
        HStack(alignment: .firstTextBaseline, spacing: 3) {
          Text(state.primary ?? "0.00").font(.system(size: 44, weight: .light)).monospacedDigit().foregroundStyle(Ink.fg)
          Text(state.primaryUnit ?? "km").font(.system(size: 15, weight: .medium)).foregroundStyle(Ink.muted)
        }
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 8) {
        metric("시간") { Clock(state: state) }
        if let stat = state.stat { metric(state.statLabel ?? "") { Text(stat) } }
      }
    }
  }

  private var countdown: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Image(systemName: attrs.icon).font(.system(size: 12, weight: .semibold))
          Text(attrs.title).font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(Ink.muted)
        if let detail = state.detail {
          Text(detail).font(.system(size: 15, weight: .medium)).foregroundStyle(Ink.fg).lineLimit(2)
        }
      }
      Spacer(minLength: 8)
      if stale {
        Text(attrs.kind == "cutoff" ? "마감" : "끝").font(.system(size: 28, weight: .light)).foregroundStyle(Ink.muted)
      } else {
        Clock(state: state).font(.system(size: 40, weight: .light)).monospacedDigit().foregroundStyle(Ink.fg)
          .multilineTextAlignment(.trailing).frame(maxWidth: 140, alignment: .trailing)
      }
    }
  }

  private func metric<V: View>(_ label: String, @ViewBuilder value: () -> V) -> some View {
    VStack(alignment: .trailing, spacing: 0) {
      Text(label).font(.system(size: 11, weight: .medium)).foregroundStyle(Ink.muted)
      value().font(.system(size: 22, weight: .light)).monospacedDigit().foregroundStyle(Ink.fg)
        .multilineTextAlignment(.trailing).frame(maxWidth: 110, alignment: .trailing)
    }
  }
}

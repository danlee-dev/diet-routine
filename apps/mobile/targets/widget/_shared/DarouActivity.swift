// Live Activity model. The app starts and updates activities through the DarouNative module, which
// declares the same struct (apps/mobile/modules/darou-native/ios/DarouActivity.swift): ActivityKit matches
// the two by type name, so name and fields must stay identical in both files.
//
// The app sends text already formatted by @diet/core (distance, pace, clock) so nothing is computed here;
// the only live values are the clocks, which SwiftUI ticks from the epoch-ms times.
#if canImport(ActivityKit)
import ActivityKit
import Foundation

struct DarouActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /** run/walk: "moving" | "autoPaused" | "paused" | "done"; rest: "rest"; cutoff: "countdown" */
    var phase: String
    /** the big value and its unit, e.g. "3.42" + "km" */
    var primary: String?
    var primaryUnit: String?
    /** counting up from this epoch ms (a moving run) */
    var clockFrom: Double?
    /** counting down to this epoch ms (rest, dinner cutoff) */
    var endsAt: Double?
    /** shown instead of a ticking clock (paused, finished) */
    var clockText: String?
    /** one secondary value, e.g. pace */
    var stat: String?
    var statLabel: String?
    /** one line of context, e.g. "다음 라운드 · 스쿼트 15회" */
    var detail: String?
  }

  /** "run" | "walk" | "rest" | "cutoff" */
  var kind: String
  var title: String
}
#endif

// The app's side of the native extras: the App Group snapshot and action queue shared with the widget
// and App Intents, Live Activities, and the motion sensors used during a run (cadence, barometric altitude).
// File formats: apps/mobile/targets/widget/_shared/Glance.swift.
import ActivityKit
import CoreMotion
import ExpoModulesCore
import WidgetKit

private enum GroupFiles {
  static let id = "group.dev.danlee.dietroutine"
  static let queueNotification = "dev.danlee.dietroutine.queue"
  static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) }
  static var glance: URL? { container?.appendingPathComponent("glance.json") }
  static var queue: URL? { container?.appendingPathComponent("queue", isDirectory: true) }
}

private func epochMs(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
private func dateOf(_ ms: Double?) -> Date? { ms.map { Date(timeIntervalSince1970: $0 / 1000) } }

private func decodeState(_ dict: [String: Any]) throws -> DarouActivityAttributes.ContentState {
  let data = try JSONSerialization.data(withJSONObject: dict)
  return try JSONDecoder().decode(DarouActivityAttributes.ContentState.self, from: data)
}

private func activity(_ id: String) -> Activity<DarouActivityAttributes>? {
  Activity<DarouActivityAttributes>.activities.first { $0.id == id }
}

public class DarouNativeModule: Module {
  private let pedometer = CMPedometer()
  private let altimeter = CMAltimeter()

  public func definition() -> ModuleDefinition {
    Name("DarouNative")
    Events("onQueue", "onPedometer", "onAltitude")

    OnCreate {
      // a widget button or Siri wrote an action while the app runs: tell JS to apply it now
      CFNotificationCenterAddObserver(
        CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(),
        { _, observer, _, _, _ in
          guard let observer else { return }
          Unmanaged<DarouNativeModule>.fromOpaque(observer).takeUnretainedValue().sendEvent("onQueue", [:])
        },
        GroupFiles.queueNotification as CFString, nil, .deliverImmediately
      )
    }

    OnDestroy {
      CFNotificationCenterRemoveEveryObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque())
      self.pedometer.stopUpdates()
      self.altimeter.stopRelativeAltitudeUpdates()
    }

    // ---------------- App Group ----------------
    Function("appGroupAvailable") { () -> Bool in GroupFiles.container != nil }

    /** Replace glance.json; reload the widgets when what they show changed. */
    Function("writeGlance") { (json: String, reload: Bool) -> Bool in
      guard let url = GroupFiles.glance, let data = json.data(using: .utf8) else { return false }
      try data.write(to: url, options: .atomic)
      if reload { WidgetCenter.shared.reloadAllTimelines() }
      return true
    }

    Function("reloadWidgets") { WidgetCenter.shared.reloadAllTimelines() }

    /** Pending actions, oldest first. Unreadable files are skipped (and removed by ackQueue on the next pass). */
    Function("readQueue") { () -> [[String: Any]] in
      guard let dir = GroupFiles.queue,
            let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
      return names
        .filter { $0.hasSuffix(".json") && !$0.hasPrefix(".") }
        .compactMap { name -> [String: Any]? in
          guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)),
                var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return ["id": String(name.dropLast(5)), "at": 0, "kind": "invalid"]
          }
          obj["id"] = String(name.dropLast(5)) // the file name is the id the app acknowledges
          return obj
        }
        .sorted { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }
    }

    Function("ackQueue") { (ids: [String]) in
      guard let dir = GroupFiles.queue else { return }
      for id in ids where id.range(of: "^[A-Za-z0-9-]+$", options: .regularExpression) != nil {
        try? FileManager.default.removeItem(at: dir.appendingPathComponent("\(id).json"))
      }
    }

    // ---------------- Live Activities ----------------
    Function("activitiesEnabled") { () -> Bool in ActivityAuthorizationInfo().areActivitiesEnabled }

    Function("listActivities") { () -> [[String: String]] in
      Activity<DarouActivityAttributes>.activities
        .filter { $0.activityState == .active || $0.activityState == .stale }
        .map { ["id": $0.id, "kind": $0.attributes.kind] }
    }

    AsyncFunction("startActivity") { (kind: String, title: String, state: [String: Any], staleAt: Double?) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      let content = ActivityContent(state: try decodeState(state), staleDate: dateOf(staleAt))
      return try Activity.request(attributes: DarouActivityAttributes(kind: kind, title: title), content: content, pushType: nil).id
    }

    AsyncFunction("updateActivity") { (id: String, state: [String: Any], staleAt: Double?) async throws -> Bool in
      guard let a = activity(id) else { return false }
      await a.update(ActivityContent(state: try decodeState(state), staleDate: dateOf(staleAt)))
      return true
    }

    /** End with a final state (kept on the lock screen until dismissAt) or remove it at once. */
    AsyncFunction("endActivity") { (id: String, state: [String: Any]?, dismissAt: Double?) async throws in
      guard let a = activity(id) else { return }
      let content = try state.map { ActivityContent(state: try decodeState($0), staleDate: nil) }
      let policy: ActivityUIDismissalPolicy = dateOf(dismissAt).map { ActivityUIDismissalPolicy.after($0) } ?? .immediate
      await a.end(content, dismissalPolicy: policy)
    }

    // ---------------- motion during a run ----------------
    Function("pedometerAvailable") { () -> Bool in CMPedometer.isStepCountingAvailable() }

    /** Cumulative steps since fromMs and the current cadence (steps per second) as they come in. */
    Function("startPedometer") { (fromMs: Double) -> Bool in
      guard CMPedometer.isStepCountingAvailable() else { return false }
      self.pedometer.stopUpdates()
      self.pedometer.startUpdates(from: Date(timeIntervalSince1970: fromMs / 1000)) { [weak self] data, error in
        guard let self, let data, error == nil else { return }
        var body: [String: Any] = ["steps": data.numberOfSteps.intValue, "at": epochMs(data.endDate)]
        if let c = data.currentCadence { body["cadence"] = c.doubleValue }
        self.sendEvent("onPedometer", body)
      }
      return true
    }

    Function("stopPedometer") { self.pedometer.stopUpdates() }

    /** Steps between two times from the motion coprocessor (kept by iOS for 7 days), or nil. */
    AsyncFunction("pedometerSteps") { (fromMs: Double, toMs: Double) async -> Int? in
      guard CMPedometer.isStepCountingAvailable() else { return nil }
      return await withCheckedContinuation { cont in
        self.pedometer.queryPedometerData(from: Date(timeIntervalSince1970: fromMs / 1000), to: Date(timeIntervalSince1970: toMs / 1000)) { data, _ in
          cont.resume(returning: data?.numberOfSteps.intValue)
        }
      }
    }

    Function("altimeterAvailable") { () -> Bool in CMAltimeter.isRelativeAltitudeAvailable() }

    /** Barometric altitude change in metres since the call, about once a second. */
    Function("startAltimeter") { () -> Bool in
      guard CMAltimeter.isRelativeAltitudeAvailable() else { return false }
      self.altimeter.stopRelativeAltitudeUpdates()
      self.altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, error in
        guard let self, let data, error == nil else { return }
        self.sendEvent("onAltitude", ["relM": data.relativeAltitude.doubleValue, "at": epochMs(Date())])
      }
      return true
    }

    Function("stopAltimeter") { self.altimeter.stopRelativeAltitudeUpdates() }
  }
}

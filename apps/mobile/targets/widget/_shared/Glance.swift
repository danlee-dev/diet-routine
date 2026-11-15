// The data contract between the app and its extensions. Compiled into the app and the widget extension.
//
//   glance.json   written by the app (JS) on every store change: today's numbers, the next meal.
//                 TypeScript source of truth: packages/data/src/glance.ts (keep field names in sync).
//   queue/*.json  one file per action taken outside the app (widget button, Siri, Shortcuts). The app
//                 applies them through @diet/data on launch, on foreground and when notified, then deletes them.
//
// One file per action means the app and an extension never rewrite the same file, so nothing is lost
// when both write at once.
import Foundation

enum DarouGroup {
  static let id = "group.dev.danlee.dietroutine"
  /** Darwin notification the app listens to, so a running app applies a queued action at once. */
  static let queueNotification = "dev.danlee.dietroutine.queue"

  static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) }
  static var glanceURL: URL? { container?.appendingPathComponent("glance.json") }
  static var queueURL: URL? { container?.appendingPathComponent("queue", isDirectory: true) }
}

struct GlanceMeal: Codable, Hashable {
  let key: String
  let name: String
  /** minutes after midnight; nil until the wake time is known */
  let at: Int?
  let items: String
  let kcal: Int
}

struct Glance: Codable, Hashable {
  struct Kcal: Codable, Hashable { let eaten: Int; let target: Int; let planned: Int }
  struct Water: Codable, Hashable { let cups: Int; let goal: Int }
  struct Steps: Codable, Hashable { let count: Int; let goal: Int }

  let v: Int
  /** epoch ms */
  let at: Double
  /** local yyyy-MM-dd */
  let date: String
  let wake: Int?
  let kcal: Kcal
  let water: Water
  let steps: Steps
  let next: GlanceMeal?
  let cutoff: Int
  let dinnerDone: Bool

  static func load() -> Glance? {
    guard let url = DarouGroup.glanceURL, let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Glance.self, from: data)
  }

  static func dayKey(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  func isFor(_ d: Date) -> Bool { date == Glance.dayKey(d) }

  /** Cups including glasses tapped in a widget or Siri that the app has not applied yet. */
  var cupsWithPending: Int { min(water.goal, water.cups + DarouQueue.pendingWater(on: date)) }

  var kcalLeft: Int { kcal.target - kcal.eaten }
}

enum DarouQueueError: Error { case noAppGroup }

enum DarouQueue {
  /** Writes one action file and wakes the app if it is running. */
  static func enqueue(_ fields: [String: Any]) throws {
    guard let dir = DarouGroup.queueURL else { throw DarouQueueError.noAppGroup }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let id = UUID().uuidString
    var obj = fields
    obj["id"] = id
    obj["at"] = (Date().timeIntervalSince1970 * 1000).rounded()
    let data = try JSONSerialization.data(withJSONObject: obj)
    try data.write(to: dir.appendingPathComponent("\(id).json"), options: .atomic)
    notifyApp()
  }

  static func pending() -> [[String: Any]] {
    guard let dir = DarouGroup.queueURL,
          let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
    return names
      .filter { $0.hasSuffix(".json") && !$0.hasPrefix(".") }
      .compactMap { name -> [String: Any]? in
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      }
      .sorted { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }
  }

  static func pendingWater(on date: String) -> Int {
    pending().reduce(0) { sum, a in
      guard a["kind"] as? String == "water", let at = a["at"] as? Double else { return sum }
      return Glance.dayKey(Date(timeIntervalSince1970: at / 1000)) == date ? sum + ((a["delta"] as? Int) ?? 1) : sum
    }
  }

  static func notifyApp() {
    CFNotificationCenterPostNotification(
      CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(DarouGroup.queueNotification as CFString), nil, nil, true
    )
  }
}

enum DarouText {
  /** "오후 3시 30분" for spoken answers. */
  static func spokenTime(_ minutes: Int) -> String {
    let h = minutes / 60, m = minutes % 60
    let half = h < 12 ? "오전" : "오후"
    let h12 = h % 12 == 0 ? 12 : h % 12
    return m == 0 ? "\(half) \(h12)시" : "\(half) \(h12)시 \(m)분"
  }

  /** "점심을", "운동 후를": the object particle that fits the last syllable (a "(밖에서)" note is ignored). */
  static func withObject(_ word: String) -> String {
    let base = word.components(separatedBy: " (").first ?? word
    guard let last = base.unicodeScalars.last(where: { (0xAC00...0xD7A3).contains($0.value) }) else { return "\(word)를" }
    return (last.value - 0xAC00) % 28 == 0 ? "\(word)를" : "\(word)을"
  }

  /** "15:00" */
  static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

  static func number(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "ko_KR")
    return f.string(from: NSNumber(value: n)) ?? "\(n)"
  }

  /** The answer to "오늘 뭐 먹어?" from the last snapshot the app wrote. */
  static func nextMealAnswer(_ g: Glance?, now: Date = Date()) -> String {
    guard let g, g.isFor(now) else { return "앱을 한 번 열면 오늘 끼니를 알려 드립니다." }
    guard let m = g.next else {
      return g.dinnerDone ? "오늘 끼니는 모두 기록했습니다. 저녁 8시 이후에는 물, 아메리카노, 제로 음료만 드세요." : "오늘 남은 끼니가 없습니다."
    }
    let when = m.at.map { "\(spokenTime($0))에 " } ?? ""
    let items = m.items.replacingOccurrences(of: " · ", with: ", ") // read aloud as a list, not "dot"
    var s = "다음은 \(m.name)입니다. \(when)\(items), \(number(m.kcal))kcal입니다."
    if m.at == nil { s += " 기상 시간을 기록하면 끼니 시간이 정해집니다." }
    if g.kcalLeft > 0 { s += " 오늘 남은 칼로리는 \(number(g.kcalLeft))kcal입니다." }
    return s
  }
}

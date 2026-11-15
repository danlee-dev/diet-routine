// App Intents for Siri, Shortcuts and the Action button. App only: the file sits in _shared because that is
// how a file reaches the main target, and the guard below compiles it out of the widget extension (which
// has no CocoaPods modules). If these types also existed in the extension, iOS would run App Shortcuts
// there and fail to find the AppShortcutsProvider; the widget button has its own intent (WidgetIntents.swift).
// None of them touch the store: each writes a queued action that the app applies through @diet/data.
#if canImport(ExpoModulesCore)
import AppIntents
import Foundation
import SwiftUI
import WidgetKit

struct LogWaterIntent: AppIntent {
  static let title: LocalizedStringResource = "물 한 잔 기록"
  static let description = IntentDescription("다루에 물 한 잔을 더합니다. 앱을 열지 않습니다.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let before = Glance.load()
    try DarouQueue.enqueue(["kind": "water", "delta": 1])
    WidgetCenter.shared.reloadAllTimelines()
    guard let g = before, g.isFor(Date()) else { return .result(dialog: "물 한 잔을 기록했습니다.") }
    let cups = g.cupsWithPending
    return .result(dialog: cups >= g.water.goal ? "물 \(cups)잔, 오늘 목표를 채웠습니다." : "물 \(cups)잔째 기록했습니다.")
  }
}

struct LogWeightIntent: AppIntent {
  static let title: LocalizedStringResource = "체중 기록"
  static let description = IntentDescription("오늘 체중을 kg으로 기록합니다.")

  @Parameter(title: "체중 (kg)", requestValueDialog: IntentDialog("체중이 몇 kg입니까?"))
  var kg: Double

  static var parameterSummary: some ParameterSummary { Summary("체중 \(\.$kg)kg 기록") }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let v = (kg * 10).rounded() / 10
    guard v >= 30, v <= 250 else { throw $kg.needsValueError(IntentDialog("30에서 250 사이의 kg으로 말해 주세요.")) }
    try DarouQueue.enqueue(["kind": "weight", "kg": v])
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: "\(String(format: "%.1f", v))kg으로 기록했습니다.")
  }
}

struct EatNextMealIntent: AppIntent {
  static let title: LocalizedStringResource = "다음 끼니 먹음"
  static let description = IntentDescription("계획한 다음 끼니를 먹었다고 기록합니다. 냉장고의 NFC 스티커에 연결하기 좋습니다.")

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let g = Glance.load(), g.isFor(Date()), let m = g.next else {
      return .result(dialog: "기록할 끼니가 없습니다. 앱에서 오늘 계획을 확인해 주세요.")
    }
    try DarouQueue.enqueue(["kind": "eatNext"])
    WidgetCenter.shared.reloadAllTimelines()
    return .result(dialog: "\(DarouText.withObject(m.name)) 먹었다고 기록했습니다.")
  }
}

enum RunMode: String, AppEnum {
  case run, walk
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "운동"
  static let caseDisplayRepresentations: [RunMode: DisplayRepresentation] = [.run: "달리기", .walk: "걷기"]
}

struct StartRunIntent: AppIntent {
  static let title: LocalizedStringResource = "달리기 시작"
  static let description = IntentDescription("다루를 열고 GPS 기록을 바로 시작합니다.")
  static let openAppWhenRun = true

  @Parameter(title: "운동", default: .run)
  var mode: RunMode

  static var parameterSummary: some ParameterSummary { Summary("\(\.$mode) 시작") }

  func perform() async throws -> some IntentResult {
    try DarouQueue.enqueue(["kind": "startRun", "mode": mode.rawValue])
    return .result()
  }
}

struct NextMealIntent: AppIntent {
  static let title: LocalizedStringResource = "오늘 뭐 먹어"
  static let description = IntentDescription("다음 끼니와 시간, 오늘 남은 칼로리를 알려 줍니다.")

  func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
    let g = Glance.load()
    return .result(dialog: IntentDialog(stringLiteral: DarouText.nextMealAnswer(g)), view: NextMealSnippet(glance: g))
  }
}

/** The card Siri and Shortcuts show under the spoken answer. */
struct NextMealSnippet: View {
  let glance: Glance?

  var body: some View {
    if let g = glance, g.isFor(Date()), let m = g.next {
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline) {
          Text(m.name).font(.system(size: 20, weight: .semibold))
          Spacer()
          Text(m.at.map(DarouText.clock) ?? "기상 후").font(.system(size: 20, weight: .light)).monospacedDigit()
        }
        Text(m.items).font(.system(size: 14)).foregroundStyle(.secondary).lineLimit(2)
        Text("\(DarouText.number(m.kcal))kcal · 오늘 \(DarouText.number(g.kcal.eaten)) / \(DarouText.number(g.kcal.target))kcal")
          .font(.system(size: 13)).foregroundStyle(.secondary).monospacedDigit()
      }
      .padding(16)
    }
  }
}

struct DarouShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: LogWaterIntent(), phrases: [
      "\(.applicationName)에 물 마셨어", "\(.applicationName) 물 마셨어", "\(.applicationName)에 물 한 잔 기록",
    ], shortTitle: "물 +1", systemImageName: "drop")
    AppShortcut(intent: LogWeightIntent(), phrases: [
      "\(.applicationName)에 체중 기록", "\(.applicationName) 체중 기록",
    ], shortTitle: "체중 기록", systemImageName: "scalemass")
    AppShortcut(intent: StartRunIntent(), phrases: [
      "\(.applicationName)에서 \(\.$mode) 시작", "\(.applicationName) \(\.$mode) 시작", "\(.applicationName)에서 달리기 시작",
    ], shortTitle: "달리기 시작", systemImageName: "figure.run")
    AppShortcut(intent: NextMealIntent(), phrases: [
      "\(.applicationName) 오늘 뭐 먹어", "\(.applicationName)에게 오늘 뭐 먹어", "\(.applicationName) 다음 끼니",
    ], shortTitle: "오늘 뭐 먹어", systemImageName: "fork.knife")
    AppShortcut(intent: EatNextMealIntent(), phrases: [
      "\(.applicationName)에 다음 끼니 먹었어", "\(.applicationName) 밥 먹었어",
    ], shortTitle: "다음 끼니 먹음", systemImageName: "checkmark.circle")
  }
}
#endif

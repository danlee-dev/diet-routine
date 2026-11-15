// Intents that run inside the widget extension (interactive widget buttons). Kept apart from the Siri
// intents in _shared/DarouIntents.swift, which exist only in the app: a type present in both bundles makes
// iOS run App Shortcuts in the extension. Hidden from the Shortcuts app; "물 한 잔 기록" there is the app's.
import AppIntents
import WidgetKit

struct WidgetWaterIntent: AppIntent {
  static let title: LocalizedStringResource = "물 한 잔 기록"
  static let isDiscoverable = false

  func perform() async throws -> some IntentResult {
    try DarouQueue.enqueue(["kind": "water", "delta": 1])
    return .result() // WidgetKit reloads the widget after a button intent; it counts the queued glass
  }
}

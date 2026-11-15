// Home screen: small "다음 끼니", medium "오늘" (kcal ring + 물 +1). Lock screen: circular kcal or steps.
// Everything is read from glance.json; the only write is the water button, which queues an action.
import AppIntents
import SwiftUI
import WidgetKit

@main
struct DarouWidgets: WidgetBundle {
  var body: some Widget {
    NextMealWidget()
    TodayWidget()
    CircleWidget()
    DarouLiveActivity()
  }
}

// ---------------- timeline ----------------
struct GlanceEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
}

private func minutesToday(_ m: Int, from now: Date) -> Date {
  Calendar.current.startOfDay(for: now).addingTimeInterval(TimeInterval(m * 60))
}

/** Entries at the moments the widget should change by itself: meal time, 90 min late, midnight (stale). */
private func glanceTimeline(now: Date = Date()) -> Timeline<GlanceEntry> {
  let g = Glance.load()
  var dates: [Date] = [now]
  if let g, g.isFor(now), let at = g.next?.at {
    dates.append(minutesToday(at, from: now))
    dates.append(minutesToday(at + 90, from: now))
  }
  let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(86_400 + 60)
  dates.append(midnight)
  let entries = Array(Set(dates.filter { $0 >= now })).sorted().map { GlanceEntry(date: $0, glance: g) }
  return Timeline(entries: entries, policy: .after(midnight))
}

struct GlanceProvider: TimelineProvider {
  func placeholder(in context: Context) -> GlanceEntry { GlanceEntry(date: Date(), glance: .sample) }
  func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
    let g = Glance.load()
    completion(GlanceEntry(date: Date(), glance: context.isPreview && (g == nil || g?.isFor(Date()) == false) ? .sample : g))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) { completion(glanceTimeline()) }
}

extension Glance {
  /** What the widget gallery shows before the app has written anything. */
  static var sample: Glance {
    Glance(v: 1, at: Date().timeIntervalSince1970 * 1000, date: Glance.dayKey(Date()), wake: 420,
           kcal: .init(eaten: 820, target: 1500, planned: 1460), water: .init(cups: 3, goal: 8), steps: .init(count: 5400, goal: 8000),
           next: GlanceMeal(key: "lunch", name: "점심", at: 900, items: "닭가슴살 큐브 · 현미밥 반 공기", kcal: 450), cutoff: 1200, dinnerDone: false)
  }
}

/** Shown when the snapshot is missing or from another day. */
private struct OpenAppPrompt: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) { Orb(size: 11); Text("다루").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Ink.muted) }
      Spacer(minLength: 0)
      Text("앱을 열면 오늘 계획이 보입니다").font(.system(size: 15, weight: .semibold)).foregroundStyle(Ink.fg)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

// ---------------- small: next meal ----------------
struct NextMealWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DarouNextMeal", provider: GlanceProvider()) { entry in
      NextMealView(entry: entry)
        .containerBackground(for: .widget) { Ink.bg }
    }
    .configurationDisplayName("다음 끼니")
    .description("다음에 먹을 끼니와 시간을 보여줍니다.")
    .supportedFamilies([.systemSmall])
  }
}

struct NextMealView: View {
  let entry: GlanceEntry

  var body: some View {
    if let g = entry.glance, g.isFor(entry.date) {
      content(g)
    } else {
      OpenAppPrompt()
    }
  }

  @ViewBuilder private func content(_ g: Glance) -> some View {
    let now = Calendar.current.dateComponents([.hour, .minute], from: entry.date)
    let nowMin = (now.hour ?? 0) * 60 + (now.minute ?? 0)
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        Orb(size: 11)
        Text(label(g, nowMin)).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Ink.muted).lineLimit(1)
      }
      Spacer(minLength: 2)
      if let m = g.next {
        Text(m.at.map(DarouText.clock) ?? "기상 후")
          .font(.system(size: m.at == nil ? 30 : 40, weight: .light)).monospacedDigit().foregroundStyle(Ink.fg)
          .minimumScaleFactor(0.7).lineLimit(1)
        Text(m.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Ink.fg).lineLimit(1)
        Text(m.items).font(.system(size: 12)).foregroundStyle(Ink.muted).lineLimit(2).padding(.top, 2)
      } else {
        Text("끝").font(.system(size: 40, weight: .light)).foregroundStyle(Ink.fg)
        Text(g.dinnerDone ? "저녁 마감 \(DarouText.clock(g.cutoff))" : "남은 끼니가 없습니다")
          .font(.system(size: 12)).foregroundStyle(Ink.muted).lineLimit(2).padding(.top, 2)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }

  private func label(_ g: Glance, _ nowMin: Int) -> String {
    guard let m = g.next else { return "오늘 끼니" }
    guard let at = m.at else { return "다음 끼니" }
    if nowMin >= at + 90 { return "늦어진 끼니" }
    if nowMin >= at { return "지금 먹을 시간" }
    return "다음 끼니"
  }
}

// ---------------- medium: today ----------------
struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "DarouToday", provider: GlanceProvider()) { entry in
      TodayView(entry: entry)
        .containerBackground(for: .widget) { Ink.bg }
    }
    .configurationDisplayName("오늘")
    .description("오늘 먹은 칼로리와 물을 보여주고, 앱을 열지 않고 물을 기록합니다.")
    .supportedFamilies([.systemMedium])
  }
}

struct TodayView: View {
  let entry: GlanceEntry

  var body: some View {
    if let g = entry.glance, g.isFor(entry.date) {
      content(g)
    } else {
      OpenAppPrompt()
    }
  }

  private func content(_ g: Glance) -> some View {
    let cups = g.cupsWithPending
    let full = cups >= g.water.goal
    return HStack(spacing: 18) {
      ZStack {
        Ring(progress: g.kcal.target > 0 ? Double(g.kcal.eaten) / Double(g.kcal.target) : 0, lineWidth: 9)
        VStack(spacing: 0) {
          Text(DarouText.number(g.kcal.eaten)).font(.system(size: 26, weight: .light)).monospacedDigit().foregroundStyle(Ink.fg)
            .minimumScaleFactor(0.6).lineLimit(1)
          Text("/ \(DarouText.number(g.kcal.target))kcal").font(.system(size: 11)).monospacedDigit().foregroundStyle(Ink.muted)
            .minimumScaleFactor(0.7).lineLimit(1)
        }
        .padding(.horizontal, 14)
      }
      .frame(width: 112, height: 112)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("오늘 \(g.kcal.eaten)킬로칼로리, 목표 \(g.kcal.target)킬로칼로리")

      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          Orb(size: 11)
          Text("오늘").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(Ink.muted)
        }
        Text(g.kcalLeft >= 0 ? "\(DarouText.number(g.kcalLeft))kcal 남음" : "\(DarouText.number(-g.kcalLeft))kcal 넘음")
          .font(.system(size: 16, weight: .semibold)).foregroundStyle(Ink.fg).padding(.top, 4).lineLimit(1).minimumScaleFactor(0.8)
        Spacer(minLength: 6)
        Text("물 \(cups) / \(g.water.goal)잔").font(.system(size: 12.5)).monospacedDigit().foregroundStyle(Ink.muted)
        HStack(spacing: 3) {
          ForEach(0..<g.water.goal, id: \.self) { i in
            Capsule().fill(i < cups ? Ink.fg : Ink.surface2).frame(height: 5)
          }
        }
        .padding(.top, 5)
        Button(intent: WidgetWaterIntent()) {
          Text(full ? "오늘 물 채움" : "물 +1")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(full ? Ink.fg2 : Ink.onFg)
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(full ? Ink.surface : Ink.fg, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
        }
        .buttonStyle(.plain)
        .padding(.top, 10)
        .accessibilityLabel(full ? "오늘 물 목표를 채웠습니다" : "물 한 잔 기록")
      }
    }
  }
}

// ---------------- lock screen: circular ----------------
enum CircleMetric: String, AppEnum {
  case kcal, steps
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "표시할 값"
  static let caseDisplayRepresentations: [CircleMetric: DisplayRepresentation] = [.kcal: "먹은 칼로리", .steps: "걸음"]
}

struct CircleConfig: WidgetConfigurationIntent {
  static let title: LocalizedStringResource = "원형 위젯"
  static let description = IntentDescription("먹은 칼로리나 걸음을 보여줍니다.")
  @Parameter(title: "표시할 값", default: .kcal)
  var metric: CircleMetric
}

struct CircleEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
  let metric: CircleMetric
}

struct CircleProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> CircleEntry { CircleEntry(date: Date(), glance: .sample, metric: .kcal) }
  func snapshot(for configuration: CircleConfig, in context: Context) async -> CircleEntry {
    let g = Glance.load()
    return CircleEntry(date: Date(), glance: context.isPreview && g?.isFor(Date()) != true ? .sample : g, metric: configuration.metric)
  }
  func timeline(for configuration: CircleConfig, in context: Context) async -> Timeline<CircleEntry> {
    let t = glanceTimeline()
    return Timeline(entries: t.entries.map { CircleEntry(date: $0.date, glance: $0.glance, metric: configuration.metric) }, policy: t.policy)
  }
}

struct CircleWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "DarouCircle", intent: CircleConfig.self, provider: CircleProvider()) { entry in
      CircleView(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName("칼로리 · 걸음")
    .description("잠금 화면에서 먹은 칼로리나 걸음을 봅니다. 길게 눌러 바꿀 수 있습니다.")
    .supportedFamilies([.accessoryCircular])
  }
}

struct CircleView: View {
  let entry: CircleEntry

  var body: some View {
    let g = entry.glance?.isFor(entry.date) == true ? entry.glance : nil
    let isKcal = entry.metric == .kcal
    let value = Double(isKcal ? (g?.kcal.eaten ?? 0) : (g?.steps.count ?? 0))
    let goal = Double(max(1, isKcal ? (g?.kcal.target ?? 1) : (g?.steps.goal ?? 1)))
    Gauge(value: min(value, goal), in: 0...goal) {
      Image(systemName: isKcal ? "fork.knife" : "figure.walk")
    } currentValueLabel: {
      Text(g == nil ? "-" : isKcal ? "\(Int(value))" : stepsShort(Int(value)))
        .monospacedDigit().minimumScaleFactor(0.6)
    }
    .gaugeStyle(.accessoryCircular)
    .widgetAccentable()
    .accessibilityLabel(isKcal ? "먹은 칼로리 \(Int(value))" : "걸음 \(Int(value))")
  }

  /** "5.4k" so five digits fit inside the ring. */
  private func stepsShort(_ n: Int) -> String {
    n < 1000 ? "\(n)" : String(format: "%.1fk", Double(n) / 1000)
  }
}

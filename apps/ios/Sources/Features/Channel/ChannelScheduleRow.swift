import SwiftUI

// Copied from meloming-ios 18a33bb ScheduleView.swift.
struct ScheduleRow: View {
    let schedule: Schedule
    var isPast: Bool = false

    private var timeString: String {
        if schedule.allDay {
            return "하루 종일"
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        let start = formatter.string(from: schedule.startAt)
        if let endAt = schedule.endAt {
            return "\(start) - \(formatter.string(from: endAt))"
        }
        return start
    }

    var body: some View {
        HStack(spacing: 12) {
            // Type Icon
            Image(systemName: schedule.scheduleType.iconName)
                .font(.title3)
                .foregroundColor(isPast ? .secondary : .accentColor)
                .frame(width: 32)

            // Info
            VStack(alignment: .leading, spacing: 4) {
                Text(schedule.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(isPast || schedule.isCanceled ? .secondary : .primary)
                    .lineLimit(1)
                    .strikethrough(schedule.isCanceled)

                HStack(spacing: 8) {
                    Text(timeString)
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(schedule.scheduleType.displayName)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(isPast ? Color.secondary.opacity(0.1) : Color.accentColor.opacity(0.1))
                        .foregroundColor(isPast ? .secondary : .accentColor)
                        .cornerRadius(4)

                    if schedule.isCanceled {
                        Text("취소됨")
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.red.opacity(0.1))
                            .foregroundColor(.red)
                            .cornerRadius(4)
                            .strikethrough()
                    }
                }

                if let description = schedule.description, !description.isEmpty {
                    Text(description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .opacity(isPast ? 0.7 : 1.0)
    }
}

// MARK: - Schedule Group
struct ScheduleGroup {
    let date: Date
    let schedules: [Schedule]

    var dateString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 (E)"
        return formatter.string(from: date)
    }
}

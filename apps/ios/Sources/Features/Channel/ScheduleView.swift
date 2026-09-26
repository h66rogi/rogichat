import SwiftUI

struct ScheduleView: View {
    let channelId: Int
    let refreshToken: UUID
    let canEdit: Bool

    @StateObject private var viewModel: ScheduleViewModel
    @State private var showPastSchedules = false

    init(channelId: Int, refreshToken: UUID = UUID(), canEdit: Bool = false) {
        self.channelId = channelId
        self.refreshToken = refreshToken
        self.canEdit = canEdit
        self._viewModel = StateObject(wrappedValue: ScheduleViewModel(channelId: channelId))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Month Selector
            HStack {
                Button(action: { viewModel.previousMonth() }) {
                    Image(systemName: "chevron.left")
                        .font(.title3)
                        .foregroundColor(.primary)
                }

                Spacer()

                Text(viewModel.currentMonthString)
                    .font(.headline)

                Spacer()

                Button(action: { viewModel.nextMonth() }) {
                    Image(systemName: "chevron.right")
                        .font(.title3)
                        .foregroundColor(.primary)
                }
            }
            .padding()

            // Calendar or List
            if viewModel.isLoading {
                LoadingView()
            } else if viewModel.schedules.isEmpty {
                EmptyStateView(
                    icon: "calendar",
                    title: "일정이 없습니다",
                    message: "이번 달 등록된 일정이 없습니다"
                )
            } else {
                LazyVStack(alignment: .leading, spacing: 16, pinnedViews: .sectionHeaders) {
                    // Past schedules section (collapsed if there are upcoming schedules)
                    if !viewModel.pastScheduleGroups.isEmpty {
                        if viewModel.upcomingScheduleGroups.isEmpty {
                            // No upcoming schedules - show all past schedules
                            ForEach(viewModel.pastScheduleGroups, id: \.date) { group in
                                scheduleSection(for: group, isPast: true)
                            }
                        } else {
                            // Has upcoming schedules - show collapsed past schedules button
                            Button {
                                showPastSchedules = true
                            } label: {
                                HStack {
                                    Image(systemName: "clock.arrow.circlepath")
                                        .foregroundColor(.secondary)
                                    Text("지난 일정 \(viewModel.pastScheduleCount)개")
                                        .foregroundColor(.secondary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                .padding()
                                .background(Color(.systemGray6))
                                .cornerRadius(10)
                            }
                            .buttonStyle(.plain)
                            .padding(.horizontal)
                        }
                    }

                    // Upcoming schedules
                    ForEach(viewModel.upcomingScheduleGroups, id: \.date) { group in
                        scheduleSection(for: group, isPast: false)
                    }
                }
                .padding(.top, 8)
            }
        }
        .task {
            await viewModel.loadSchedules()
        }
        .onChange(of: viewModel.selectedYearMonth) { _ in
            showPastSchedules = false
            Task {
                await viewModel.loadSchedules()
            }
        }
        .onChange(of: refreshToken) { _ in
            Task {
                await viewModel.loadSchedules()
            }
        }
        .sheet(isPresented: $showPastSchedules) {
            PastSchedulesSheet(
                scheduleGroups: viewModel.pastScheduleGroups,
                onScheduleTap: { schedule in
                    showPastSchedules = false
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        viewModel.selectedSchedule = schedule
                        viewModel.showScheduleDetail = true
                    }
                }
            )
        }
        .sheet(isPresented: $viewModel.showScheduleDetail) {
            if let schedule = viewModel.selectedSchedule {
                ScheduleDetailSheet(
                    schedule: schedule,
                    canEdit: canEdit,
                    onEdit: {
                        viewModel.showScheduleDetail = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            viewModel.showEditSheet = true
                        }
                    },
                    onDelete: {
                        viewModel.showScheduleDetail = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            viewModel.showDeleteAlert = true
                        }
                    }
                )
                .presentationDetents([.medium, .large])
            }
        }
        .sheet(isPresented: $viewModel.showEditSheet) {
            if let schedule = viewModel.selectedSchedule {
                EditScheduleView(schedule: schedule) {
                    Task {
                        await viewModel.loadSchedules()
                    }
                }
            }
        }
        .alert("일정 삭제", isPresented: $viewModel.showDeleteAlert) {
            Button("삭제", role: .destructive) {
                if let schedule = viewModel.selectedSchedule {
                    Task {
                        _ = await viewModel.deleteSchedule(schedule)
                    }
                }
            }
            Button("취소", role: .cancel) {}
        } message: {
            Text("이 일정을 삭제하시겠습니까?")
        }
        .alert("오류", isPresented: $viewModel.showDeleteError) {
            Button("확인") { viewModel.deleteError = nil }
        } message: {
            if let error = viewModel.deleteError { Text(error) }
        }
    }

    @ViewBuilder
    private func scheduleSection(for group: ScheduleGroup, isPast: Bool) -> some View {
        Section {
            ForEach(group.schedules) { schedule in
                ScheduleRow(schedule: schedule, isPast: isPast)
                    .padding(.horizontal)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        viewModel.selectedSchedule = schedule
                        viewModel.showScheduleDetail = true
                    }
            }
        } header: {
            Text(group.dateString)
                .font(.subheadline.bold())
                .foregroundColor(isPast ? .secondary : .primary)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemBackground))
        }
    }
}

// MARK: - Past Schedules Sheet
struct PastSchedulesSheet: View {
    let scheduleGroups: [ScheduleGroup]
    var onScheduleTap: ((Schedule) -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16, pinnedViews: .sectionHeaders) {
                    ForEach(scheduleGroups, id: \.date) { group in
                        Section {
                            ForEach(group.schedules) { schedule in
                                ScheduleRow(schedule: schedule, isPast: true)
                                    .padding(.horizontal)
                                    .contentShape(Rectangle())
                                    .onTapGesture {
                                        onScheduleTap?(schedule)
                                    }
                            }
                        } header: {
                            Text(group.dateString)
                                .font(.subheadline.bold())
                                .foregroundColor(.secondary)
                                .padding(.horizontal)
                                .padding(.vertical, 8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color(.systemBackground))
                        }
                    }
                }
                .padding(.top, 8)
            }
            .navigationTitle("지난 일정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("닫기") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Schedule Row
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


// MARK: - Schedule Detail Sheet
struct ScheduleDetailSheet: View {
    let schedule: Schedule
    let canEdit: Bool
    var onEdit: (() -> Void)?
    var onDelete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var timeString: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        if schedule.allDay {
            formatter.dateFormat = "yyyy년 M월 d일 (E)"
        } else {
            formatter.dateFormat = "yyyy년 M월 d일 (E) HH:mm"
        }
        return formatter.string(from: schedule.startAt)
    }

    private var endTimeString: String? {
        guard let endAt = schedule.endAt else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        if schedule.allDay {
            formatter.dateFormat = "yyyy년 M월 d일 (E)"
        } else {
            formatter.dateFormat = "yyyy년 M월 d일 (E) HH:mm"
        }
        return formatter.string(from: endAt)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    // Type Icon + Badge
                    VStack(spacing: 12) {
                        Image(systemName: schedule.scheduleType.iconName)
                            .font(.system(size: 40))
                            .foregroundColor(.accentColor)

                        Text(schedule.scheduleType.displayName)
                            .font(.caption)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 4)
                            .background(Color.accentColor.opacity(0.1))
                            .foregroundColor(.accentColor)
                            .cornerRadius(8)
                    }

                    // Title
                    Text(schedule.title)
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                        .strikethrough(schedule.isCanceled)

                    // Canceled Badge
                    if schedule.isCanceled {
                        Text("취소됨")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Color.red.opacity(0.1))
                            .foregroundColor(.red)
                            .cornerRadius(8)
                    }

                    // Time Info
                    VStack(spacing: 8) {
                        HStack {
                            Image(systemName: "clock")
                                .foregroundColor(.secondary)
                                .frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(timeString)
                                    .font(.subheadline)
                                if let endTime = endTimeString {
                                    Text("~ \(endTime)")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                if schedule.allDay {
                                    Text("하루 종일")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                            Spacer()
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }

                    // Location
                    if let location = schedule.location, !location.isEmpty {
                        HStack {
                            Image(systemName: "mappin.and.ellipse")
                                .foregroundColor(.secondary)
                                .frame(width: 24)
                            Text(location)
                                .font(.subheadline)
                            Spacer()
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }

                    // External URL
                    if let urlString = schedule.externalUrl, !urlString.isEmpty, let url = URL(string: urlString) {
                        Button {
                            openURL(url)
                        } label: {
                            HStack {
                                Image(systemName: "link")
                                    .foregroundColor(.accentColor)
                                    .frame(width: 24)
                                Text(urlString)
                                    .font(.subheadline)
                                    .foregroundColor(.accentColor)
                                    .lineLimit(1)
                                Spacer()
                                Image(systemName: "arrow.up.right")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .padding()
                            .background(Color(.systemGray6))
                            .cornerRadius(12)
                        }
                        .buttonStyle(.plain)
                    }

                    // Visibility
                    HStack {
                        Image(systemName: schedule.isPublic ? "globe" : "lock.fill")
                            .foregroundColor(.secondary)
                            .frame(width: 24)
                        Text(schedule.isPublic ? "공개" : "비공개")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Spacer()
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)

                    // Description
                    if let description = schedule.description, !description.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("설명")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(description)
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)
                    }

                    // Edit/Delete Buttons
                    if canEdit {
                        VStack(spacing: 12) {
                            Divider()

                            Button {
                                onEdit?()
                            } label: {
                                HStack {
                                    Image(systemName: "pencil")
                                    Text("수정")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.accentColor)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }

                            Button {
                                onDelete?()
                            } label: {
                                HStack {
                                    Image(systemName: "trash")
                                    Text("삭제")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.red.opacity(0.1))
                                .foregroundColor(.red)
                                .cornerRadius(12)
                            }
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("일정 상세")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("닫기") {
                        dismiss()
                    }
                }
            }
        }
    }
}

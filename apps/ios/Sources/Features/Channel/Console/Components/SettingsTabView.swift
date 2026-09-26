import SwiftUI

struct SettingsTabView: View {
    @ObservedObject var viewModel: ConsoleViewModel

    var body: some View {
        Form {
            requestSettingsSection
            if !viewModel.categories.isEmpty {
                blockedCategoriesSection
            }
            playbackSettingsSection
            pricingSettingsSection
        }
    }

    // MARK: - Request Settings

    private var requestSettingsSection: some View {
        Section("신청 설정") {
            if let settings = viewModel.settings {
                Toggle("신청 받기", isOn: settingsBinding(\.requestEnabled) { value in
                    UpdateSettingsPayload(requestEnabled: value)
                })

                Toggle("일시정지", isOn: settingsBinding(\.paused) { value in
                    UpdateSettingsPayload(paused: value)
                })

                Toggle("노래책 일치 필수", isOn: settingsBinding(\.requireSongMatch) { value in
                    UpdateSettingsPayload(requireSongMatch: value)
                })

                Toggle("중복 곡 방지", isOn: settingsBinding(\.preventDuplicateSongs) { value in
                    UpdateSettingsPayload(preventDuplicateSongs: value)
                })

                Toggle("후원 우선순위", isOn: settingsBinding(\.donationPriorityEnabled) { value in
                    UpdateSettingsPayload(donationPriorityEnabled: value)
                })

                HStack {
                    Text("신청 명령어")
                    Spacer()
                    Text(settings.requestCommand)
                        .foregroundColor(.secondary)
                }

                Stepper(
                    "대기열 최대: \(settings.maxQueueSize)",
                    value: settingsIntBinding(\.maxQueueSize) { value in
                        UpdateSettingsPayload(maxQueueSize: value)
                    },
                    in: 1...200
                )

                Stepper(
                    "인당 최대: \(settings.maxRequestsPerUser == 0 ? "무제한" : "\(settings.maxRequestsPerUser)")",
                    value: settingsIntBinding(\.maxRequestsPerUser) { value in
                        UpdateSettingsPayload(maxRequestsPerUser: value)
                    },
                    in: 0...50
                )

                Stepper(
                    "총 최대: \(settings.maxTotalRequests == 0 ? "무제한" : "\(settings.maxTotalRequests)")",
                    value: settingsIntBinding(\.maxTotalRequests) { value in
                        UpdateSettingsPayload(maxTotalRequests: value)
                    },
                    in: 0...500
                )
            } else {
                Text("설정을 불러오는 중...")
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Blocked Categories

    private var blockedCategoriesSection: some View {
        Section {
            if let settings = viewModel.settings {
                let blockedIds = settings.blockedCategoryIds
                ForEach(viewModel.categories) { category in
                    let isBlocked = blockedIds.contains(category.id)
                    Button {
                        let newIds: [Int]
                        if isBlocked {
                            newIds = blockedIds.filter { $0 != category.id }
                        } else {
                            newIds = blockedIds + [category.id]
                        }
                        Task {
                            await viewModel.updateSettings(
                                UpdateSettingsPayload(blockedCategoryIds: newIds)
                            )
                        }
                    } label: {
                        HStack {
                            Text(category.name)
                                .foregroundColor(isBlocked ? .red : .primary)
                            Spacer()
                            if isBlocked {
                                Image(systemName: "nosign")
                                    .foregroundColor(.red)
                            }
                        }
                    }
                }
            }
        } header: {
            Text("신청 불가 카테고리")
        } footer: {
            Text("선택한 카테고리의 곡은 신청할 수 없습니다")
        }
    }

    // MARK: - Playback Settings

    private var playbackSettingsSection: some View {
        Section("재생 설정") {
            if let settings = viewModel.settings {
                Picker("재생 모드", selection: Binding(
                    get: { settings.karaokePlaybackMode },
                    set: { newValue in
                        Task {
                            await viewModel.updateSettings(
                                UpdateSettingsPayload(karaokePlaybackMode: newValue)
                            )
                        }
                    }
                )) {
                    Text("YouTube").tag("YOUTUBE")
                    Text("직접 재생").tag("DIRECT")
                }

                Picker("영상 타입", selection: Binding(
                    get: { settings.karaokeVideoType },
                    set: { newValue in
                        Task {
                            await viewModel.updateSettings(
                                UpdateSettingsPayload(karaokeVideoType: newValue)
                            )
                        }
                    }
                )) {
                    Text("노래방").tag("KARAOKE")
                    Text("원곡").tag("ORIGINAL")
                }
            } else {
                Text("설정을 불러오는 중...")
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Pricing Settings

    private var pricingSettingsSection: some View {
        Section("가격 설정") {
            if let pricing = viewModel.pricingSettings {
                Toggle("가격 설정 사용", isOn: Binding(
                    get: { pricing.pricingEnabled },
                    set: { newValue in
                        Task {
                            await viewModel.updatePricingSettings(
                                UpdatePricingSettingsPayload(pricingEnabled: newValue)
                            )
                        }
                    }
                ))

                if pricing.pricingEnabled {
                    if let defaultPrice = pricing.defaultPrice {
                        HStack {
                            Text("기본 가격")
                            Spacer()
                            Text("\(defaultPrice) \(pricing.currencyUnit)")
                                .foregroundColor(.secondary)
                        }
                    }

                    if !pricing.currencyConfigs.isEmpty {
                        ForEach(pricing.currencyConfigs) { config in
                            HStack {
                                Text(config.unit)
                                Spacer()
                                if let amount = config.amount {
                                    Text("\(amount)")
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("-")
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            } else {
                Text("가격 설정을 불러오는 중...")
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Binding Helpers

    private func settingsBinding(
        _ keyPath: KeyPath<ConsoleSessionSettings, Bool>,
        payload: @escaping (Bool) -> UpdateSettingsPayload
    ) -> Binding<Bool> {
        Binding(
            get: { viewModel.settings?[keyPath: keyPath] ?? false },
            set: { newValue in
                Task { await viewModel.updateSettings(payload(newValue)) }
            }
        )
    }

    private func settingsIntBinding(
        _ keyPath: KeyPath<ConsoleSessionSettings, Int>,
        payload: @escaping (Int) -> UpdateSettingsPayload
    ) -> Binding<Int> {
        Binding(
            get: { viewModel.settings?[keyPath: keyPath] ?? 0 },
            set: { newValue in
                Task { await viewModel.updateSettings(payload(newValue)) }
            }
        )
    }
}

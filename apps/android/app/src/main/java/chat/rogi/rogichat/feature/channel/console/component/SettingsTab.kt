package chat.rogi.rogichat.feature.channel.console.component

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.PricingSettings
import chat.rogi.rogichat.channelport.core.model.song.SessionSettings

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun SettingsTab(
    settings: SessionSettings?,
    pricingSettings: PricingSettings?,
    categories: List<Category>,
    onUpdateSettings: (SessionSettings) -> Unit,
    onUpdatePricingSettings: (PricingSettings) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (settings == null) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "설정을 불러오는 중...",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
    ) {
        // Section: 신청 설정
        item {
            Spacer(modifier = Modifier.height(16.dp))
            SectionHeader(title = "신청 설정")
            Spacer(modifier = Modifier.height(8.dp))
        }

        item {
            SettingsToggleRow(
                label = "신청 받기",
                description = "시청자가 노래를 신청할 수 있습니다",
                checked = settings.requestEnabled,
                onCheckedChange = {
                    onUpdateSettings(settings.copy(requestEnabled = it))
                },
            )
        }

        item {
            SettingsToggleRow(
                label = "일시정지",
                description = "신청은 받지 않지만 대기열은 유지됩니다",
                checked = settings.paused,
                onCheckedChange = {
                    onUpdateSettings(settings.copy(paused = it))
                },
            )
        }

        item {
            SettingsToggleRow(
                label = "노래책 매칭 필수",
                description = "노래책에 등록된 곡만 신청 가능합니다",
                checked = settings.requireSongMatch,
                onCheckedChange = {
                    onUpdateSettings(settings.copy(requireSongMatch = it))
                },
            )
        }

        item {
            SettingsToggleRow(
                label = "중복 곡 방지",
                description = "이미 대기열에 있는 곡의 중복 신청을 방지합니다",
                checked = settings.preventDuplicateSongs,
                onCheckedChange = {
                    onUpdateSettings(settings.copy(preventDuplicateSongs = it))
                },
            )
        }

        item {
            SettingsToggleRow(
                label = "후원 우선순위",
                description = "후원과 함께 신청된 곡을 우선 배치합니다",
                checked = settings.donationPriorityEnabled,
                onCheckedChange = {
                    onUpdateSettings(settings.copy(donationPriorityEnabled = it))
                },
            )
        }

        if (categories.isNotEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                ) {
                    Text(
                        text = "신청 불가 카테고리",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        text = "선택한 카테고리의 곡은 신청할 수 없습니다",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        categories.forEach { category ->
                            val isBlocked = settings.blockedCategoryIds.contains(category.id)
                            FilterChip(
                                selected = isBlocked,
                                onClick = {
                                    val newIds = if (isBlocked) {
                                        settings.blockedCategoryIds - category.id
                                    } else {
                                        settings.blockedCategoryIds + category.id
                                    }
                                    onUpdateSettings(settings.copy(blockedCategoryIds = newIds))
                                },
                                label = { Text(category.name) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = MaterialTheme.colorScheme.errorContainer,
                                    selectedLabelColor = MaterialTheme.colorScheme.onErrorContainer,
                                ),
                            )
                        }
                    }
                }
            }
        }

        item {
            SettingsTextFieldRow(
                label = "신청 명령어",
                value = settings.requestCommand,
                onValueChange = {
                    onUpdateSettings(settings.copy(requestCommand = it))
                },
            )
        }

        item {
            SettingsNumberRow(
                label = "최대 대기열 크기",
                value = settings.maxQueueSize,
                onValueChange = {
                    onUpdateSettings(settings.copy(maxQueueSize = it))
                },
            )
        }

        item {
            SettingsNumberRow(
                label = "인당 최대 신청 수",
                description = "0 = 무제한",
                value = settings.maxRequestsPerUser,
                onValueChange = {
                    onUpdateSettings(settings.copy(maxRequestsPerUser = it))
                },
            )
        }

        item {
            SettingsNumberRow(
                label = "총 최대 신청 수",
                description = "0 = 무제한",
                value = settings.maxTotalRequests,
                onValueChange = {
                    onUpdateSettings(settings.copy(maxTotalRequests = it))
                },
            )
        }

        // Section: 재생 설정
        item {
            Spacer(modifier = Modifier.height(24.dp))
            SectionHeader(title = "재생 설정")
            Spacer(modifier = Modifier.height(8.dp))
        }

        item {
            SettingsRadioRow(
                label = "재생 방식",
                options = listOf("YOUTUBE" to "YouTube", "DIRECT" to "직접 재생"),
                selectedValue = settings.karaokePlaybackMode,
                onValueChange = {
                    onUpdateSettings(settings.copy(karaokePlaybackMode = it))
                },
            )
        }

        item {
            SettingsRadioRow(
                label = "영상 타입",
                options = listOf("KARAOKE" to "노래방(MR)", "ORIGINAL" to "원곡"),
                selectedValue = settings.karaokeVideoType,
                onValueChange = {
                    onUpdateSettings(settings.copy(karaokeVideoType = it))
                },
            )
        }

        // Section: 가격 설정
        item {
            Spacer(modifier = Modifier.height(24.dp))
            SectionHeader(title = "가격 설정")
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (pricingSettings != null) {
            item {
                SettingsToggleRow(
                    label = "가격 기능 사용",
                    description = "곡 신청에 포인트/가격을 적용합니다",
                    checked = pricingSettings.pricingEnabled,
                    onCheckedChange = {
                        onUpdatePricingSettings(pricingSettings.copy(pricingEnabled = it))
                    },
                )
            }

            item {
                SettingsNumberRow(
                    label = "기본 가격",
                    value = pricingSettings.defaultPrice ?: 0,
                    onValueChange = {
                        onUpdatePricingSettings(pricingSettings.copy(defaultPrice = it))
                    },
                )
            }

            // Read-only display for difficulty prices
            val diffPrices = pricingSettings.difficultyPrices
            if (!diffPrices.isNullOrEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                    ) {
                        Text(
                            text = "난이도별 가격",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        diffPrices.forEach { (difficulty, price) ->
                            Text(
                                text = "난이도 $difficulty: ${price ?: "기본"}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }

            // Read-only display for currency configs
            if (pricingSettings.currencyConfigs.isNotEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                    ) {
                        Text(
                            text = "화폐 설정",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        pricingSettings.currencyConfigs.forEach { config ->
                            Text(
                                text = "${config.key}: ${config.unit} (${config.amount ?: "-"})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }
        } else {
            item {
                Text(
                    text = "가격 설정을 불러오는 중...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.primary,
        )
        HorizontalDivider(
            modifier = Modifier.padding(top = 4.dp),
            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
        )
    }
}

@Composable
private fun SettingsToggleRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
            )
            if (description != null) {
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
        )
    }
}

@Composable
private fun SettingsTextFieldRow(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by remember(value) { mutableStateOf(value) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        Spacer(modifier = Modifier.height(4.dp))
        OutlinedTextField(
            value = text,
            onValueChange = { newText ->
                text = newText
                onValueChange(newText)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun SettingsNumberRow(
    label: String,
    value: Int,
    onValueChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    var text by remember(value) { mutableStateOf(value.toString()) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        if (description != null) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        OutlinedTextField(
            value = text,
            onValueChange = { newText ->
                text = newText
                newText.toIntOrNull()?.let { onValueChange(it) }
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
    }
}

@Composable
private fun SettingsRadioRow(
    label: String,
    options: List<Pair<String, String>>,
    selectedValue: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
        )
        Spacer(modifier = Modifier.height(4.dp))
        options.forEach { (value, displayText) ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(
                    selected = selectedValue == value,
                    onClick = { onValueChange(value) },
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = displayText,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

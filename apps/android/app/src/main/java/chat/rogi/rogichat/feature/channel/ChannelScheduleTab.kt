package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.CaretLeft
import com.adamglin.phosphoricons.regular.CaretRight
import chat.rogi.rogichat.core.design.ScreenStatus
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun LazyListScope.channelScheduleTabContent(
    state: ChannelDetailUiState,
    onPreviousMonth: () -> Unit,
    onNextMonth: () -> Unit,
    onScheduleClick: (Schedule) -> Unit,
    onRetry: () -> Unit,
) {
    // Month navigation
    item(key = "schedule_nav") {
        Column {
            Spacer(modifier = Modifier.height(16.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onPreviousMonth,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.CaretLeft,
                        contentDescription = "이전 달",
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Text(
                    text = state.month.replace("-", "년 ") + "월",
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )

                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = onNextMonth,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.CaretRight,
                        contentDescription = "다음 달",
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    // Loading state
    if (state.sectionLoading && state.schedules.isEmpty()) {
        item(key = "schedule_loading") {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    } else if (state.sectionError != null && state.schedules.isEmpty()) {
        item(key = "schedule_error") {
            ScreenStatus("일정을 불러올 수 없어요", state.sectionError.orEmpty(), onRetry = onRetry)
        }
    } else {
        val visibleSchedules = state.schedules.filterNot { it.isCanceled }
        if (visibleSchedules.isEmpty()) {
            // Empty state
            item(key = "schedule_empty") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "등록된 일정이 없습니다",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            // Schedule list grouped by date
            val groupedSchedules = visibleSchedules
                .groupBy { schedule ->
                    try {
                        Instant.parse(schedule.startAt).atZone(ZoneId.of("Asia/Seoul")).toLocalDate()
                    } catch (e: Exception) {
                        null
                    }
                }.filterKeys { it != null }
                .toSortedMap(compareByDescending { it })

            groupedSchedules.forEach { (date, daySchedules) ->
                item(key = "schedule_date_${date}") {
                    Text(
                        text = date?.format(DateTimeFormatter.ofPattern("M월 d일 (E)")) ?: "",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }

                items(daySchedules, key = { "schedule_${it.id}" }) { schedule ->
                    ScheduleItem(
                        schedule = schedule,
                        onClick = { onScheduleClick(schedule) },
                    )
                }
            }

            // Bottom padding
            item(key = "schedule_bottom_padding") {
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

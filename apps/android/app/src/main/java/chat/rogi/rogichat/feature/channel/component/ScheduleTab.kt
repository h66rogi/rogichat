package chat.rogi.rogichat.feature.channel.component

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.PencilSimple
import com.adamglin.phosphoricons.fill.Trash
import com.adamglin.phosphoricons.regular.CaretLeft
import com.adamglin.phosphoricons.regular.CaretRight
import com.adamglin.phosphoricons.regular.Link
import com.adamglin.phosphoricons.regular.MapPin
import com.adamglin.phosphoricons.regular.ArrowSquareOut
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import chat.rogi.rogichat.channelport.core.common.util.DateUtils
import chat.rogi.rogichat.channelport.core.model.schedule.Schedule
import chat.rogi.rogichat.channelport.core.model.schedule.ScheduleType
import chat.rogi.rogichat.channelport.core.network.dto.UpdateScheduleRequest
import chat.rogi.rogichat.feature.channel.ChannelDetailEvent
import chat.rogi.rogichat.feature.channel.ScheduleState
import chat.rogi.rogichat.feature.channel.ScheduleVisibility
import kotlinx.coroutines.launch
import timber.log.Timber
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

fun LazyListScope.scheduleTabContent(
    state: ScheduleState,
    onEvent: (ChannelDetailEvent) -> Unit,
    canEdit: Boolean = false,
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
                            onClick = { onEvent(ChannelDetailEvent.PreviousMonth) },
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
                    text = state.displayMonth,
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
                            onClick = { onEvent(ChannelDetailEvent.NextMonth) },
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
    if (state.isLoading) {
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
                        DateUtils.parseIso(schedule.startAt)?.toLocalDate()
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
                        onClick = { onEvent(ChannelDetailEvent.ScheduleSelected(schedule)) },
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

@Composable
private fun ScheduleItem(
    schedule: Schedule,
    onClick: () -> Unit,
) {
    val typeColor = getScheduleTypeColor(schedule.scheduleType)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        // Time
        val timeText = if (schedule.allDay) {
            "종일"
        } else {
            formatScheduleTime(schedule.startAt, schedule.endAt)
        }
        Text(
            text = timeText,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(56.dp),
        )

        Spacer(modifier = Modifier.width(12.dp))

        // Type indicator bar
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(40.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(typeColor),
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = schedule.title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = schedule.scheduleType.displayName,
                    style = MaterialTheme.typography.labelSmall,
                    color = typeColor,
                )
            }

            schedule.description?.let { description ->
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun getScheduleTypeColor(type: ScheduleType): Color {
    return when (type) {
        ScheduleType.LIVE -> Color(0xFFEF4444)
        ScheduleType.COLLAB -> Color(0xFFF59E0B)
        ScheduleType.OFF -> Color(0xFF6B7280)
        ScheduleType.ETC -> Color(0xFF3B82F6)
        ScheduleType.TBD -> Color(0xFF8B5CF6)
    }
}

private fun formatScheduleTime(startAt: String, endAt: String?): String {
    return try {
        val startDateTime = DateUtils.parseIso(startAt) ?: return startAt
        val startTimeStr = DateUtils.formatTime(startDateTime)

        if (endAt != null) {
            val endDateTime = DateUtils.parseIso(endAt)
            val endTimeStr = endDateTime?.let { DateUtils.formatTime(it) } ?: endAt
            "$startTimeStr - $endTimeStr"
        } else {
            startTimeStr
        }
    } catch (e: Exception) {
        startAt
    }
}

private fun formatScheduleDateTime(startAt: String, endAt: String?, allDay: Boolean): String {
    return try {
        val startDateTime = DateUtils.parseIso(startAt) ?: return startAt
        val dateFormatter = DateTimeFormatter.ofPattern("yyyy년 M월 d일 (E)")
        val timeFormatter = DateTimeFormatter.ofPattern("a h:mm")
        val localStart = startDateTime.atZone(ZoneId.systemDefault())

        if (allDay) {
            if (endAt != null) {
                val endDateTime = DateUtils.parseIso(endAt)
                val localEnd = endDateTime?.atZone(ZoneId.systemDefault())
                "${localStart.format(dateFormatter)} ~ ${localEnd?.format(dateFormatter) ?: ""} (종일)"
            } else {
                "${localStart.format(dateFormatter)} (종일)"
            }
        } else {
            val startStr = "${localStart.format(dateFormatter)} ${localStart.format(timeFormatter)}"
            if (endAt != null) {
                val endDateTime = DateUtils.parseIso(endAt)
                val localEnd = endDateTime?.atZone(ZoneId.systemDefault())
                if (localEnd != null && localStart.toLocalDate() == localEnd.toLocalDate()) {
                    "$startStr ~ ${localEnd.format(timeFormatter)}"
                } else {
                    "$startStr ~ ${localEnd?.format(dateFormatter)} ${localEnd?.format(timeFormatter)}"
                }
            } else {
                startStr
            }
        }
    } catch (e: Exception) {
        startAt
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleDetailBottomSheet(
    schedule: Schedule,
    canEdit: Boolean,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current
    val typeColor = getScheduleTypeColor(schedule.scheduleType)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 32.dp),
        ) {
            // Edit/Delete buttons
            if (canEdit) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onEdit) {
                        Icon(
                            imageVector = PhosphorIcons.Fill.PencilSimple,
                            contentDescription = "수정",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                    IconButton(onClick = onDelete) {
                        Icon(
                            imageVector = PhosphorIcons.Fill.Trash,
                            contentDescription = "삭제",
                            tint = Color(0xFFEF4444),
                        )
                    }
                }
            }

            // Title + type badge
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = schedule.title,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Text(
                    text = schedule.scheduleType.displayName,
                    style = MaterialTheme.typography.labelMedium,
                    color = typeColor,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(typeColor.copy(alpha = 0.12f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Date/Time
            Text(
                text = formatScheduleDateTime(schedule.startAt, schedule.endAt, schedule.allDay),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Location
            schedule.location?.takeIf { it.isNotBlank() }?.let { location ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.MapPin,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = location,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            // External URL
            schedule.externalUrl?.takeIf { it.isNotBlank() }?.let { url ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .clickable {
                            val normalizedUrl = if (!url.contains("://")) "https://$url" else url
                            try {
                                val intent = Intent(Intent.ACTION_VIEW, normalizedUrl.toUri())
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                Timber.e(e, "Failed to open URL: $url")
                            }
                        }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.Link,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = url,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(
                        imageVector = PhosphorIcons.Regular.ArrowSquareOut,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Description
            schedule.description?.takeIf { it.isNotBlank() }?.let { description ->
                HorizontalDivider(
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "메모",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
fun DeleteScheduleDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("일정 삭제") },
        text = { Text("이 일정을 삭제하시겠습니까?\n삭제된 일정은 복구할 수 없습니다.") },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("삭제", color = Color(0xFFEF4444))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("취소")
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EditScheduleBottomSheet(
    schedule: Schedule,
    onDismiss: () -> Unit,
    onUpdate: (UpdateScheduleRequest) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()

    // Parse existing schedule data for pre-population
    val initialStartDateTime = try {
        DateUtils.parseIso(schedule.startAt)?.atZone(ZoneId.systemDefault())
    } catch (e: Exception) { null }
    val initialEndDateTime = try {
        schedule.endAt?.let { DateUtils.parseIso(it)?.atZone(ZoneId.systemDefault()) }
    } catch (e: Exception) { null }

    var title by remember { mutableStateOf(schedule.title) }
    var startDate by remember { mutableStateOf(initialStartDateTime?.toLocalDate() ?: LocalDate.now()) }
    var startTime by remember { mutableStateOf(initialStartDateTime?.toLocalTime() ?: LocalTime.of(20, 0)) }
    var endDate by remember { mutableStateOf<LocalDate?>(initialEndDateTime?.toLocalDate()) }
    var endTime by remember { mutableStateOf<LocalTime?>(initialEndDateTime?.toLocalTime()) }
    var allDay by remember { mutableStateOf(schedule.allDay) }
    var status by remember { mutableStateOf(schedule.scheduleType) }
    var visibility by remember {
        mutableStateOf(
            if (schedule.isPublic) ScheduleVisibility.PUBLIC else ScheduleVisibility.PRIVATE,
        )
    }
    var location by remember { mutableStateOf(schedule.location ?: "") }
    var externalUrl by remember { mutableStateOf(schedule.externalUrl ?: "") }
    var content by remember { mutableStateOf(schedule.description ?: "") }

    var showStartDatePicker by remember { mutableStateOf(false) }
    var showStartTimePicker by remember { mutableStateOf(false) }
    var showEndDatePicker by remember { mutableStateOf(false) }
    var showEndTimePicker by remember { mutableStateOf(false) }

    val dateFormatter = DateTimeFormatter.ofPattern("yyyy년 M월 d일")
    val timeFormatter = DateTimeFormatter.ofPattern("a h:mm")

    val isValid = title.isNotBlank()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            // Header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onDismiss) {
                    Text("취소", fontSize = 16.sp)
                }
                Text(
                    text = "일정 수정",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                TextButton(
                    onClick = {
                        val startDateTime = if (allDay) {
                            startDate.atStartOfDay()
                        } else {
                            java.time.LocalDateTime.of(startDate, startTime)
                        }
                        val endDateTime = if (endDate != null) {
                            if (allDay) {
                                endDate!!.atTime(23, 59, 59)
                            } else {
                                java.time.LocalDateTime.of(endDate!!, endTime ?: LocalTime.of(23, 59))
                            }
                        } else null

                        val startAtUtc = startDateTime
                            .atZone(ZoneId.systemDefault())
                            .toInstant()
                            .toString()
                        val endAtUtc = endDateTime
                            ?.atZone(ZoneId.systemDefault())
                            ?.toInstant()
                            ?.toString()

                        onUpdate(
                            UpdateScheduleRequest(
                                title = title,
                                content = content.takeIf { it.isNotBlank() },
                                startAt = startAtUtc,
                                endAt = endAtUtc,
                                allDay = allDay,
                                visibility = visibility.apiValue,
                                location = location.takeIf { it.isNotBlank() },
                                externalUrl = externalUrl.takeIf { it.isNotBlank() },
                                status = status.name,
                            ),
                        )
                    },
                    enabled = isValid,
                ) {
                    Text(
                        text = "완료",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isValid) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                        },
                    )
                }
            }

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                // Title
                EditScheduleTextField(
                    value = title,
                    onValueChange = { title = it },
                    placeholder = "제목",
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    textStyle = TextStyle(
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                )

                EditScheduleDivider()

                // All day toggle
                EditScheduleSettingRow(
                    title = "종일",
                    onClick = {
                        val shouldForceAllDay = status == ScheduleType.TBD
                        allDay = if (shouldForceAllDay) true else !allDay
                    },
                    trailing = {
                        Text(
                            text = if (allDay) "ON" else "OFF",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (allDay) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    },
                )

                EditScheduleDivider()

                // Start
                EditScheduleSettingRow(
                    title = "시작",
                    onClick = { showStartDatePicker = true },
                    trailing = {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = startDate.format(dateFormatter),
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            if (!allDay) {
                                Text(
                                    text = startTime.format(timeFormatter),
                                    fontSize = 15.sp,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable { showStartTimePicker = true },
                                )
                            }
                        }
                    },
                )

                EditScheduleDivider()

                // End
                EditScheduleSettingRow(
                    title = "종료 (선택)",
                    onClick = { showEndDatePicker = true },
                    trailing = {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = endDate?.format(dateFormatter) ?: "없음",
                                fontSize = 15.sp,
                                color = if (endDate != null) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                            if (!allDay && endDate != null) {
                                Text(
                                    text = endTime?.format(timeFormatter) ?: "",
                                    fontSize = 15.sp,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable { showEndTimePicker = true },
                                )
                            }
                        }
                    },
                )

                EditScheduleDivider()

                // Status
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                ) {
                    Text(
                        text = "상태",
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ScheduleType.entries.forEach { type ->
                            EditScheduleChip(
                                text = type.displayName,
                                isSelected = status == type,
                                onClick = {
                                    status = type
                                    if (type == ScheduleType.TBD) allDay = true
                                },
                            )
                        }
                    }
                }

                EditScheduleDivider()

                // Visibility
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                ) {
                    Text(
                        text = "공개 범위",
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ScheduleVisibility.entries.forEach { vis ->
                            EditScheduleChip(
                                text = vis.displayName,
                                isSelected = visibility == vis,
                                onClick = { visibility = vis },
                            )
                        }
                    }
                }

                EditScheduleDivider()

                // Location
                EditScheduleIconTextField(
                    value = location,
                    onValueChange = { location = it },
                    placeholder = "위치 추가 (선택)",
                    icon = PhosphorIcons.Regular.MapPin,
                )

                EditScheduleDivider()

                // URL
                EditScheduleIconTextField(
                    value = externalUrl,
                    onValueChange = { externalUrl = it },
                    placeholder = "URL 추가 (선택)",
                    icon = PhosphorIcons.Regular.Link,
                )

                EditScheduleDivider()

                // Note
                EditScheduleTextField(
                    value = content,
                    onValueChange = { content = it },
                    placeholder = "메모 (선택)",
                    modifier = Modifier
                        .padding(horizontal = 20.dp, vertical = 16.dp)
                        .height(120.dp),
                    singleLine = false,
                )

                Spacer(modifier = Modifier.height(40.dp))
            }
        }
    }

    // Date/Time pickers
    if (showStartDatePicker) {
        EditScheduleDatePickerSheet(
            initialDate = startDate,
            onDateSelected = {
                startDate = it
                showStartDatePicker = false
            },
            onDismiss = { showStartDatePicker = false },
        )
    }

    if (showStartTimePicker) {
        EditScheduleTimePickerSheet(
            initialTime = startTime,
            onTimeSelected = {
                startTime = it
                showStartTimePicker = false
            },
            onDismiss = { showStartTimePicker = false },
        )
    }

    if (showEndDatePicker) {
        EditScheduleDatePickerSheet(
            initialDate = endDate ?: startDate,
            onDateSelected = {
                endDate = it
                showEndDatePicker = false
            },
            onDismiss = { showEndDatePicker = false },
        )
    }

    if (showEndTimePicker) {
        EditScheduleTimePickerSheet(
            initialTime = endTime ?: startTime,
            onTimeSelected = {
                endTime = it
                showEndTimePicker = false
            },
            onDismiss = { showEndTimePicker = false },
        )
    }
}

// Private composable helpers for EditScheduleBottomSheet
@Composable
private fun EditScheduleDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 20.dp),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
    )
}

@Composable
private fun EditScheduleTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = TextStyle(
        fontSize = 16.sp,
        color = MaterialTheme.colorScheme.onSurface,
    ),
    singleLine: Boolean = true,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        textStyle = textStyle,
        singleLine = singleLine,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { innerTextField ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = textStyle.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        ),
                    )
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun EditScheduleIconTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(22.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
        Spacer(modifier = Modifier.width(14.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.weight(1f),
            textStyle = TextStyle(
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            singleLine = true,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            decorationBox = { innerTextField ->
                Box {
                    if (value.isEmpty()) {
                        Text(
                            text = placeholder,
                            fontSize = 16.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        )
                    }
                    innerTextField()
                }
            },
        )
    }
}

@Composable
private fun EditScheduleSettingRow(
    title: String,
    onClick: () -> Unit,
    trailing: @Composable () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            fontSize = 16.sp,
            color = MaterialTheme.colorScheme.onSurface,
        )
        trailing()
    }
}

@Composable
private fun EditScheduleChip(
    text: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val backgroundColor = if (isSelected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.surfaceContainerHigh
    }

    val textColor = if (isSelected) {
        MaterialTheme.colorScheme.onPrimary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Text(
        text = text,
        fontSize = 14.sp,
        fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
        color = textColor,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditScheduleDatePickerSheet(
    initialDate: LocalDate,
    onDateSelected: (LocalDate) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val datePickerState = rememberDatePickerState(
        initialSelectedDateMillis = initialDate
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli(),
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
                }) {
                    Text("취소", fontSize = 16.sp)
                }
                TextButton(onClick = {
                    datePickerState.selectedDateMillis?.let { millis ->
                        val date = Instant.ofEpochMilli(millis)
                            .atZone(ZoneId.systemDefault())
                            .toLocalDate()
                        onDateSelected(date)
                    }
                }) {
                    Text("완료", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            DatePicker(
                state = datePickerState,
                showModeToggle = false,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditScheduleTimePickerSheet(
    initialTime: LocalTime,
    onTimeSelected: (LocalTime) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val timePickerState = rememberTimePickerState(
        initialHour = initialTime.hour,
        initialMinute = initialTime.minute,
        is24Hour = false,
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = null,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = {
                    scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
                }) {
                    Text("취소", fontSize = 16.sp)
                }
                TextButton(onClick = {
                    onTimeSelected(LocalTime.of(timePickerState.hour, timePickerState.minute))
                }) {
                    Text("완료", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            TimePicker(state = timePickerState)
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

package chat.rogi.rogichat.feature.channel

import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.text.HtmlCompat
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.CalendarBlank
import com.adamglin.phosphoricons.fill.ChatDots
import com.adamglin.phosphoricons.fill.FilmSlate
import com.adamglin.phosphoricons.fill.Info
import com.adamglin.phosphoricons.fill.MusicNote
import com.adamglin.phosphoricons.fill.Sparkle
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.CaretRight
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Date
import java.util.Locale

/**
 * 채널 홈 탭 — 웹 section/home.tsx 대응.
 * 소개 / 최신 클립 / 최신 등록 노래 / 최신 방명록 / 방송 일정 / 기념일 미리보기.
 * 데이터는 채널 로드 시 확보되는 기존 탭 상태를 재사용한다.
 */
fun LazyListScope.channelHomeTabContent(
    uiState: ChannelDetailUiState,
    onSeeMore: (ChannelTab) -> Unit,
    onRetry: () -> Unit,
) {
    val channel = uiState.channel

    // 소개
    item(key = "home_intro") {
        HomeSectionCard(title = "소개", icon = PhosphorIcons.Fill.Info) {
            val html = uiState.profile?.homeDescription
            if (html.isNullOrBlank()) {
                Text(
                    text = "안녕하세요, ${channel?.name ?: "스트리머"}의 채널입니다 👋",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                HtmlDescription(html)
            }
        }
    }

    // 최신 등록 노래
    item(key = "home_songs") {
        val songs = uiState.songs.take(6)
        HomeSectionCard(
            title = "최신 등록 노래",
            icon = PhosphorIcons.Fill.MusicNote,
            onSeeMore = if (songs.isNotEmpty()) ({ onSeeMore(ChannelTab.SONGBOOK) }) else null,
        ) {
            if (songs.isEmpty() && uiState.homeSongsError) {
                TextButton(onClick = onRetry) { Text("노래를 불러올 수 없어요. 다시 시도") }
            } else if (songs.isEmpty()) {
                Text(
                    "아직 등록된 노래가 없어요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    songs.forEach { song ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = song.title,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f),
                            )
                            song.artist?.name?.let { artist ->
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    artist,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // 방송 일정 — 다가오는 일정 최대 3개
    item(key = "home_schedule") {
        val upcoming = uiState.schedules
            .filter { schedule -> parseInstant(schedule.startAt)?.isAfter(Instant.now().minusSeconds(60L * 60 * 12)) != false }
            .sortedBy { it.startAt }
            .take(3)
        HomeSectionCard(
            title = "방송 일정",
            icon = PhosphorIcons.Fill.CalendarBlank,
            onSeeMore = if (upcoming.isNotEmpty()) ({ onSeeMore(ChannelTab.SCHEDULE) }) else null,
        ) {
            if (upcoming.isEmpty() && uiState.homeSchedulesError) {
                TextButton(onClick = onRetry) { Text("일정을 불러올 수 없어요. 다시 시도") }
            } else if (upcoming.isEmpty()) {
                Text(
                    "등록된 일정이 없어요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    upcoming.forEach { schedule -> HomeScheduleRow(schedule) }
                }
            }
        }
    }

    // 기념일 (D-day 는 전부 서버 계산값)
    item(key = "home_anniversary") {
        val anniversaries = uiState.profile?.anniversaries
        HomeSectionCard(title = "기념일", icon = PhosphorIcons.Fill.Sparkle) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                anniversaries?.nextUpcomingEvent?.let { event ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFFFFF7ED))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("다가오는 기념일", fontSize = 11.sp, color = Color(0xFFB45309))
                            Text(
                                event.label.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF9A3412),
                            )
                        }
                        Text(
                            if (event.daysUntil == 0) "D-DAY" else "D-${event.daysUntil}",
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFEA580C),
                        )
                    }
                }
                HomeAnniversaryRow(
                    label = "방송 시작일로부터",
                    value = anniversaries?.milestones?.let { "D+${it.daysPassed}" } ?: "미등록",
                )
                HomeAnniversaryRow(
                    label = "생일",
                    value = anniversaries?.birthday?.let { birthday ->
                        val dday = if (birthday.daysUntilBirthday == 0) "D-DAY" else "D-${birthday.daysUntilBirthday}"
                        listOfNotNull(birthday.birthdayDate, dday).joinToString(" · ")
                    } ?: "미등록",
                )
            }
        }
    }

    item(key = "home_bottom_padding") {
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun HomeSectionCard(
    title: String,
    icon: ImageVector,
    onSeeMore: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(22.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .shadow(
                elevation = 12.dp,
                shape = shape,
                ambientColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.09f),
            )
            .clip(shape)
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.075f),
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
                    ),
                ),
            )
            .border(
                1.dp,
                Brush.linearGradient(
                    listOf(
                        Color.White.copy(alpha = 0.68f),
                        MaterialTheme.colorScheme.primary.copy(alpha = 0.18f),
                        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.38f),
                    ),
                ),
                shape,
            )
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            if (onSeeMore != null) {
                TextButton(onClick = onSeeMore, contentPadding = PaddingValues(horizontal = 4.dp)) {
                    Text("더보기", fontSize = 12.sp)
                    Icon(
                        PhosphorIcons.Regular.CaretRight,
                        contentDescription = null,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
        content()
    }
}

@Composable
private fun HtmlDescription(html: String) {
    val color = MaterialTheme.colorScheme.onSurface.toArgb()
    val textSize = with(LocalDensity.current) { MaterialTheme.typography.bodyMedium.fontSize.toPx() }
    AndroidView(
        modifier = Modifier.fillMaxWidth(),
        factory = { context ->
            TextView(context).apply {
                includeFontPadding = false
                setLineSpacing(0f, 1.16f)
            }
        },
        update = { textView ->
            textView.text = HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
            textView.setTextColor(color)
            textView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textSize)
        },
    )
}

@Composable
private fun HomeScheduleRow(schedule: Schedule) {
    // 웹 STATUS_LABEL/getStatusColor 대응
    val (label, badgeBg, badgeText) = when (schedule.scheduleType) {
        ScheduleType.LIVE -> Triple("방송", Color(0xFFDBEAFE), Color(0xFF1D4ED8))
        ScheduleType.COLLAB -> Triple("합방", Color(0xFFFEF9C3), Color(0xFFA16207))
        ScheduleType.OFF -> Triple("휴방", Color(0xFFFEE2E2), Color(0xFFB91C1C))
        ScheduleType.ETC -> Triple("기타", Color(0xFFE2E8F0), Color(0xFF1E293B))
        ScheduleType.TBD -> Triple("미정", Color(0xFFF3F4F6), Color(0xFF374151))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(6.dp))
                .background(badgeBg)
                .padding(horizontal = 6.dp, vertical = 2.dp),
        ) {
            Text(label, fontSize = 10.sp, color = badgeText, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            schedule.title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = buildString {
                append(formatHomeDate(schedule.startAt))
                if (schedule.allDay) append(" 종일") else append(" ${formatHomeTime(schedule.startAt)}")
            },
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun HomeAnniversaryRow(label: String, value: String) {
    Row {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
    }
}

private fun parseInstant(value: String?): Instant? {
    if (value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value) }.getOrNull()
        ?: runCatching { OffsetDateTime.parse(value).toInstant() }.getOrNull()
}

private fun formatHomeDate(value: String?): String {
    val instant = parseInstant(value) ?: return value.orEmpty()
    return SimpleDateFormat("M월 d일", Locale.KOREA).format(Date.from(instant))
}

private fun formatHomeTime(value: String?): String {
    val instant = parseInstant(value) ?: return ""
    return SimpleDateFormat("HH:mm", Locale.KOREA).format(Date.from(instant))
}

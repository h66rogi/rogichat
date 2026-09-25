package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.Star
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Copied from meloming-android ecb3dbed SongbookTab.kt and ScheduleTab.kt rows.
// Favorite/request mutations are absent until native credential scope is wired.
@Composable
internal fun SongItem(
    song: Song,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ChannelRemoteImage(song.albumArt, "♪", 56.dp, Modifier.clip(RoundedCornerShape(8.dp)))

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = song.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(2.dp))

            // Artist + Difficulty
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                song.artist?.let { artist ->
                    Text(
                        text = artist.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }

                // Difficulty stars
                song.difficulty?.takeIf { it > 0 }?.let { difficulty ->
                    Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                        repeat(difficulty.coerceAtMost(5)) {
                            Icon(
                                imageVector = PhosphorIcons.Fill.Star,
                                contentDescription = null,
                                modifier = Modifier.size(10.dp),
                                tint = Color(0xFFFBBF24),
                            )
                        }
                    }
                }
            }

            // Categories
            if (song.categories.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    song.categories.take(2).forEach { category ->
                        val categoryColor = parseHexColor(category.color)
                        Text(
                            text = category.name,
                            style = MaterialTheme.typography.labelSmall,
                            color = categoryColor,
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(categoryColor.copy(alpha = 0.15f))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }

    }
}

@Composable
internal fun ScheduleItem(
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
    val formatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("Asia/Seoul"))
    return try {
        val start = formatter.format(Instant.parse(startAt))
        if (endAt == null) start else "$start - ${formatter.format(Instant.parse(endAt))}"
    } catch (_: Exception) { startAt }
}

private fun parseHexColor(hexColor: String?): Color {
    if (hexColor == null) return Color(0xFF6B7280)
    return try {
        val colorString = hexColor.removePrefix("#")
        val colorInt = colorString.toLong(16)
        Color(
            red = ((colorInt shr 16) and 0xFF) / 255f,
            green = ((colorInt shr 8) and 0xFF) / 255f,
            blue = (colorInt and 0xFF) / 255f,
        )
    } catch (e: Exception) {
        Color(0xFF6B7280) // Default gray
    }
}

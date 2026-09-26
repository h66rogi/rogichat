package chat.rogi.rogichat.channelport.core.common.util

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

object DateUtils {
    private val isoFormatter = DateTimeFormatter.ISO_DATE_TIME
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
    private val dateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
    private val koreanDateFormatter = DateTimeFormatter.ofPattern("yyyy년 M월 d일")
    private val koreanDateTimeFormatter = DateTimeFormatter.ofPattern("yyyy년 M월 d일 HH:mm")
    private val offsetRegex = Regex("([zZ]|[+-]\\d{2}:?\\d{2})$")

    fun parseIso(dateString: String?): LocalDateTime? {
        if (dateString == null) return null
        val hasOffset = offsetRegex.containsMatchIn(dateString)
        return if (hasOffset) {
            try {
                Instant.parse(dateString)
                    .atZone(ZoneId.systemDefault())
                    .toLocalDateTime()
            } catch (e: Exception) {
                try {
                    LocalDateTime.parse(dateString, isoFormatter)
                } catch (e: Exception) {
                    null
                }
            }
        } else {
            try {
                LocalDateTime.parse(dateString, isoFormatter)
            } catch (e: Exception) {
                try {
                    Instant.parse(dateString)
                        .atZone(ZoneId.systemDefault())
                        .toLocalDateTime()
                } catch (e: Exception) {
                    null
                }
            }
        }
    }

    fun formatDate(dateTime: LocalDateTime?): String {
        return dateTime?.format(dateFormatter) ?: ""
    }

    fun formatTime(dateTime: LocalDateTime?): String {
        return dateTime?.format(timeFormatter) ?: ""
    }

    fun formatDateTime(dateTime: LocalDateTime?): String {
        return dateTime?.format(dateTimeFormatter) ?: ""
    }

    fun formatKoreanDate(dateTime: LocalDateTime?): String {
        return dateTime?.format(koreanDateFormatter) ?: ""
    }

    fun formatKoreanDateTime(dateTime: LocalDateTime?): String {
        return dateTime?.format(koreanDateTimeFormatter) ?: ""
    }

    fun getDaysUntil(dateString: String?): Long? {
        val dateTime = parseIso(dateString) ?: return null
        val now = LocalDate.now()
        return ChronoUnit.DAYS.between(now, dateTime.toLocalDate())
    }

    fun formatDDay(dateString: String?): String? {
        val days = getDaysUntil(dateString) ?: return null
        return when {
            days > 0 -> "D-$days"
            days == 0L -> "D-Day"
            else -> "마감"
        }
    }

    fun getYearMonth(dateTime: LocalDateTime = LocalDateTime.now()): String {
        return dateTime.format(DateTimeFormatter.ofPattern("yyyy-MM"))
    }

    fun formatRelativeTime(dateString: String?): String {
        val dateTime = parseIso(dateString) ?: return ""
        val now = LocalDateTime.now()
        val minutes = ChronoUnit.MINUTES.between(dateTime, now)
        val hours = ChronoUnit.HOURS.between(dateTime, now)
        val days = ChronoUnit.DAYS.between(dateTime, now)

        return when {
            minutes < 1 -> "방금 전"
            minutes < 60 -> "${minutes}분 전"
            hours < 24 -> "${hours}시간 전"
            days < 7 -> "${days}일 전"
            days < 30 -> "${days / 7}주 전"
            days < 365 -> "${days / 30}개월 전"
            else -> "${days / 365}년 전"
        }
    }
}

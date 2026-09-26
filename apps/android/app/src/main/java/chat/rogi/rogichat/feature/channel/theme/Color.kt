package chat.rogi.rogichat.feature.channel.theme

import androidx.compose.ui.graphics.Color

// Channel Brand Colors
val ChannelPrimary = Color(0xFF6366F1)
val ChannelPrimaryLight = Color(0xFF818CF8)
val ChannelPrimaryDark = Color(0xFF4F46E5)
val ChannelSecondary = Color(0xFF8B5CF6)
val ChannelTertiary = Color(0xFFEC4899)

// Neutral Colors
val Gray50 = Color(0xFFF9FAFB)
val Gray100 = Color(0xFFF3F4F6)
val Gray200 = Color(0xFFE5E7EB)
val Gray300 = Color(0xFFD1D5DB)
val Gray400 = Color(0xFF9CA3AF)
val Gray500 = Color(0xFF6B7280)
val Gray600 = Color(0xFF4B5563)
val Gray700 = Color(0xFF374151)
val Gray800 = Color(0xFF1F2937)
val Gray900 = Color(0xFF111827)

// Status Colors
val StatusRecruiting = Color(0xFF22C55E)
val StatusClosed = Color(0xFF6B7280)
val StatusUpcoming = Color(0xFF3B82F6)
val StatusAlwaysOpen = Color(0xFF8B5CF6)

// Schedule Colors
val ScheduleLive = Color(0xFFEF4444)
val ScheduleCollab = Color(0xFFF59E0B)
val ScheduleOff = Color(0xFF6B7280)
val ScheduleEtc = Color(0xFF3B82F6)
val ScheduleTbd = Color(0xFF8B5CF6)

// Difficulty Star Colors
val DifficultyEasy = Color(0xFF22C55E)
val DifficultyMedium = Color(0xFFF59E0B)
val DifficultyHard = Color(0xFFEF4444)

// Feed Category Badge Colors
val FeedCategoryRecruit = Color(0xFF22C55E)   // 구인구직 - Green
val FeedCategoryClip = Color(0xFFEF4444)      // 핫클립 - Red
val FeedCategoryNews = Color(0xFF3B82F6)      // 뉴스 - Blue
val FeedCategoryContent = Color(0xFF8B5CF6)   // 콘텐츠 - Purple

// Light Theme Colors - Toss/당근 스타일 (순백색 기반)
val LightBackground = Color(0xFFFFFFFF)  // 순백색 배경
val LightSurface = Color(0xFFFFFFFF)
val LightSurfaceVariant = Color(0xFFF7F8F9)  // 매우 subtle한 그레이
val LightOnBackground = Color(0xFF191F28)  // 진한 텍스트
val LightOnSurface = Color(0xFF191F28)
val LightOnSurfaceVariant = Color(0xFF8B95A1)  // 보조 텍스트

// Dark Theme Colors - Toss/당근 스타일
val DarkBackground = Color(0xFF17171C)  // 약간 보라빛 블랙
val DarkSurface = Color(0xFF17171C)
val DarkSurfaceVariant = Color(0xFF2C2C35)
val DarkOnBackground = Color(0xFFFFFFFF)
val DarkOnSurface = Color(0xFFF2F4F6)
val DarkOnSurfaceVariant = Color(0xFF8B95A1)

// Divider Colors
val LightDivider = Color(0xFFF2F4F6)
val DarkDivider = Color(0xFF2C2C35)

// Extension function to parse hex color
fun parseHexColor(hex: String?): Color {
    if (hex == null) return ChannelPrimary
    return try {
        val colorString = hex.removePrefix("#")
        Color(android.graphics.Color.parseColor("#$colorString"))
    } catch (e: Exception) {
        ChannelPrimary
    }
}

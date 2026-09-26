package chat.rogi.rogichat.channelport.core.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import chat.rogi.rogichat.R

// IBM Plex Sans KR - 기본 본문 폰트
val IbmPlexSansKrFontFamily = FontFamily(
    Font(R.font.ibm_plex_sans_kr_light, FontWeight.Light),
    Font(R.font.ibm_plex_sans_kr_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_sans_kr_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_sans_kr_semibold, FontWeight.SemiBold),
    Font(R.font.ibm_plex_sans_kr_bold, FontWeight.Bold),
)

// Paperlogy - 타이틀 폰트
val PaperlogyFontFamily = FontFamily(
    Font(R.font.paperlogy_regular, FontWeight.Normal),
    Font(R.font.paperlogy_medium, FontWeight.Medium),
    Font(R.font.paperlogy_semibold, FontWeight.SemiBold),
    Font(R.font.paperlogy_bold, FontWeight.Bold),
    Font(R.font.paperlogy_extrabold, FontWeight.ExtraBold),
)

// Typography 설정
// Display, Headline, Title: Paperlogy (타이틀용)
// Body, Label: IBM Plex Sans KR (본문용)
val MelomingTypography = Typography(
    // Display - 대형 타이틀 (Paperlogy)
    displayLarge = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 56.sp,
        lineHeight = 64.sp,
        letterSpacing = (-0.5).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 44.sp,
        lineHeight = 52.sp,
        letterSpacing = (-0.5).sp,
    ),
    displaySmall = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.ExtraBold,
        fontSize = 36.sp,
        lineHeight = 44.sp,
        letterSpacing = (-0.25).sp,
    ),

    // Headline - 섹션 헤더 (Paperlogy)
    headlineLarge = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 36.sp,
        letterSpacing = (-0.25).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = (-0.25).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.25).sp,
    ),

    // Title - 작은 타이틀 (Paperlogy)
    titleLarge = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
        letterSpacing = (-0.25).sp,
    ),
    titleMedium = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp,
        lineHeight = 24.sp,
        letterSpacing = (-0.15).sp,
    ),
    titleSmall = TextStyle(
        fontFamily = PaperlogyFontFamily,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        letterSpacing = (-0.1).sp,
    ),

    // Body - 본문 텍스트 (IBM Plex Sans KR)
    bodyLarge = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.sp,
    ),

    // Label - 버튼, 레이블 (IBM Plex Sans KR)
    labelLarge = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = IbmPlexSansKrFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.sp,
    ),
)

package chat.rogi.rogichat.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFA1D0BD),
    onPrimary = Color(0xFF143B2E),
    primaryContainer = Color(0xFF244C40),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFF52665B),
    onSecondary = Color.White,
    tertiary = Color(0xFF456573),
    onTertiary = Color.White,
    background = Color(0xFF181D1B),
    onBackground = Color(0xFFEEF4F0),
    surface = Color(0xFF181D1B),
    onSurface = Color(0xFFEEF4F0),
    surfaceVariant = Color(0xFF2C3530),
    onSurfaceVariant = Color(0xFFBBC8C0),
    outline = Color(0xFF36423C),
    outlineVariant = Color(0xFF36423C),
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF315C52),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD3E8DF),
    onPrimaryContainer = Color(0xFF143B2E),
    secondary = Color(0xFF52665B),
    onSecondary = Color.White,
    tertiary = Color(0xFF456573),
    onTertiary = Color.White,
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF191F28),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF191F28),
    surfaceVariant = Color(0xFFF4F7F5),
    onSurfaceVariant = Color(0xFF65736B),
    outline = Color(0xFFE7EDE9),
    outlineVariant = Color(0xFFE7EDE9),
)

// Clean & Minimal Shape System
val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun RogichatTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}

package chat.rogi.rogichat.channelport.core.designsystem.theme

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
    primary = MelomingPrimary,
    onPrimary = Color.White,
    primaryContainer = MelomingPrimaryDark,
    onPrimaryContainer = Color.White,
    secondary = MelomingSecondary,
    onSecondary = Color.White,
    tertiary = MelomingTertiary,
    onTertiary = Color.White,
    background = DarkBackground,
    onBackground = DarkOnBackground,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkDivider,
    outlineVariant = DarkDivider,
)

private val LightColorScheme = lightColorScheme(
    primary = MelomingPrimary,
    onPrimary = Color.White,
    primaryContainer = MelomingPrimaryLight,
    onPrimaryContainer = Color.White,
    secondary = MelomingSecondary,
    onSecondary = Color.White,
    tertiary = MelomingTertiary,
    onTertiary = Color.White,
    background = LightBackground,
    onBackground = LightOnBackground,
    surface = LightSurface,
    onSurface = LightOnSurface,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightDivider,
    outlineVariant = LightDivider,
)

// Clean & Minimal Shape System
val MelomingShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun MelomingTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MelomingTypography,
        shapes = MelomingShapes,
        content = content,
    )
}

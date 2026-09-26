package chat.rogi.rogichat.channelport.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Channel platform verification badge.
 *
 * Displays a small colored label for a verified streaming platform.
 * Only SOOP, CHZZK, and CIME are rendered; unknown/OTHER platforms
 * are silently skipped (returns without drawing anything).
 */
@Composable
fun ChannelPlatformBadge(
    platform: String,
    modifier: Modifier = Modifier,
) {
    val (label, bgColor) = when (platform) {
        "SOOP" -> "SOOP" to Color(0xFF0066FF)
        "CHZZK" -> "CHZZK" to Color(0xFF00C73C)
        "CIME" -> "CIME" to Color(0xFFA855F7)
        else -> return
    }

    Text(
        text = label,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        color = Color.White,
        lineHeight = 10.sp,
        modifier = modifier
            .background(
                color = bgColor,
                shape = CircleShape,
            )
            .padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

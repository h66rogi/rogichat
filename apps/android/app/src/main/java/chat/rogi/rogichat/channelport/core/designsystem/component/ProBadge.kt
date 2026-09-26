package chat.rogi.rogichat.channelport.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.Crown

/**
 * PRO 구독자 뱃지 Variant
 */
enum class ProBadgeVariant {
    /** 아이콘 + "PRO" 텍스트 (기본) */
    Default,
    /** 작은 버전 */
    Small,
    /** 아이콘만 */
    IconOnly,
}

/**
 * PRO 구독자를 나타내는 뱃지 컴포넌트
 *
 * - 배경: Indigo → Purple 그라데이션
 * - 아이콘: Crown (왕관)
 * - 텍스트: 흰색 "PRO"
 * - 스타일: pill shape (fully rounded)
 */
@Composable
fun ProBadge(
    modifier: Modifier = Modifier,
    variant: ProBadgeVariant = ProBadgeVariant.Default,
) {
    val gradientBrush = Brush.horizontalGradient(
        colors = listOf(
            Color(0xFF6366F1), // Indigo-500
            Color(0xFFA855F7), // Purple-500
        ),
    )

    val (iconSize, textSize, horizontalPadding, verticalPadding, spacing) = when (variant) {
        ProBadgeVariant.Default -> ProBadgeDimensions(
            iconSize = 10.dp,
            textSize = 11.sp,
            horizontalPadding = 6.dp,
            verticalPadding = 2.dp,
            spacing = 2.dp,
        )
        ProBadgeVariant.Small -> ProBadgeDimensions(
            iconSize = 9.dp,
            textSize = 10.sp,
            horizontalPadding = 5.dp,
            verticalPadding = 1.dp,
            spacing = 2.dp,
        )
        ProBadgeVariant.IconOnly -> ProBadgeDimensions(
            iconSize = 10.dp,
            textSize = 10.sp,
            horizontalPadding = 4.dp,
            verticalPadding = 4.dp,
            spacing = 0.dp,
        )
    }

    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(gradientBrush)
            .padding(horizontal = horizontalPadding, vertical = verticalPadding),
        horizontalArrangement = Arrangement.spacedBy(spacing),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = PhosphorIcons.Fill.Crown,
            contentDescription = "PRO",
            modifier = Modifier.size(iconSize),
            tint = Color.White,
        )

        if (variant != ProBadgeVariant.IconOnly) {
            Text(
                text = "PRO",
                fontSize = textSize,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White,
                letterSpacing = 0.3.sp,
                lineHeight = textSize,
            )
        }
    }
}

private data class ProBadgeDimensions(
    val iconSize: androidx.compose.ui.unit.Dp,
    val textSize: androidx.compose.ui.unit.TextUnit,
    val horizontalPadding: androidx.compose.ui.unit.Dp,
    val verticalPadding: androidx.compose.ui.unit.Dp,
    val spacing: androidx.compose.ui.unit.Dp,
)

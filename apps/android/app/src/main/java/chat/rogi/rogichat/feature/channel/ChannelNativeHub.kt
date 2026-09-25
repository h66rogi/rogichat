package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.text.HtmlCompat
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.ChatDots

// Copied from meloming-android ecb3dbed ChannelDetailScreen.kt profile hero,
// glass button, and section rail. Rogichat keeps its one-channel actions only.
@Composable
internal fun ChannelProfileHero(
    channel: Channel,
    profile: ChannelProfile?,
    onTalk: () -> Unit,
) {
    val themeTint = parseColor(channel.themeColor)
    val glassShape = RoundedCornerShape(26.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 12.dp)
            .shadow(18.dp, glassShape, ambientColor = themeTint.copy(alpha = 0.12f))
            .clip(glassShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                        themeTint.copy(alpha = 0.11f),
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.82f),
                    ),
                ),
            )
            .border(
                width = 1.dp,
                brush = Brush.linearGradient(
                    listOf(
                        Color.White.copy(alpha = 0.72f),
                        themeTint.copy(alpha = 0.25f),
                        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                    ),
                ),
                shape = glassShape,
            )
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant,
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                ChannelAvatar(channel)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(channel.name, modifier = Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!channel.verifications.isNullOrEmpty()) {
                        Box(
                            modifier = Modifier
                                .size(18.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("✓", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (channel.isOwnerProSubscriber) {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                        ) {
                            Text(
                                "PRO",
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
                Text(
                    "@${channel.webPath}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "즐겨찾기 ${channel.favoritesCount} · 노래 ${channel.songCount} · 아티스트 ${channel.artistCount}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val description = profile?.homeDescription
                    ?: profile?.description
                    ?: channel.channelDescription
                description?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        stripHtmlForPreview(it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        ChannelGlassActionButton(
            text = "대화 열기",
            icon = PhosphorIcons.Fill.ChatDots,
            modifier = Modifier.fillMaxWidth(),
            tint = MaterialTheme.colorScheme.primary,
            onClick = onTalk,
        )
    }
}

@Composable
private fun ChannelGlassActionButton(
    icon: ImageVector,
    modifier: Modifier,
    tint: Color,
    onClick: () -> Unit,
    text: String? = null,
    contentDescription: String? = text,
) {
    val shape = RoundedCornerShape(15.dp)
    Surface(
        onClick = onClick,
        modifier = modifier
            .height(46.dp)
            .shadow(7.dp, shape, ambientColor = tint.copy(alpha = 0.12f)),
        shape = shape,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .background(
                    Brush.linearGradient(
                        listOf(
                            MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                            tint.copy(alpha = 0.12f),
                        ),
                    ),
                )
                .border(
                    0.8.dp,
                    Brush.linearGradient(
                        listOf(Color.White.copy(alpha = 0.7f), tint.copy(alpha = 0.28f)),
                    ),
                    shape,
                )
                .padding(horizontal = if (text == null) 0.dp else 10.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(19.dp),
            )
            text?.let {
                Spacer(Modifier.width(5.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = tint,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun ChannelActionButton(
    text: String,
    modifier: Modifier,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(42.dp),
        shape = RoundedCornerShape(13.dp),
        color = container,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = content, maxLines = 1)
        }
    }
}

@Composable
internal fun ChannelSectionRail(
    tabs: List<ChannelTab>,
    selectedTab: ChannelTab,
    selectedColor: Color,
    onTabSelected: (ChannelTab) -> Unit,
    labels: Map<ChannelTab, String> = emptyMap(),
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        items(tabs, key = { it.name }) { tab ->
            val selected = tab == selectedTab
            val shape = RoundedCornerShape(999.dp)
            Surface(
                onClick = { onTabSelected(tab) },
                modifier = Modifier.shadow(
                    elevation = if (selected) 8.dp else 4.dp,
                    shape = shape,
                    ambientColor = selectedColor.copy(alpha = if (selected) 0.16f else 0.07f),
                ),
                shape = shape,
                color = Color.Transparent,
            ) {
                Text(
                    text = labels[tab] ?: tab.title,
                    modifier = Modifier
                        .background(
                            Brush.linearGradient(
                                if (selected) {
                                    listOf(selectedColor, selectedColor.copy(alpha = 0.78f))
                                } else {
                                    listOf(
                                        MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                                        selectedColor.copy(alpha = 0.08f),
                                    )
                                },
                            ),
                        )
                        .border(
                            0.8.dp,
                            if (selected) {
                                Color.White.copy(alpha = 0.46f)
                            } else {
                                MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.52f)
                            },
                            shape,
                        )
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

private fun parseColor(hexColor: String): Color {
    return try {
        val colorString = hexColor.removePrefix("#")
        val colorInt = colorString.toLong(16)
        Color(
            red = ((colorInt shr 16) and 0xFF) / 255f,
            green = ((colorInt shr 8) and 0xFF) / 255f,
            blue = (colorInt and 0xFF) / 255f,
        )
    } catch (e: Exception) {
        Color(0xFF6366F1) // Default indigo
    }
}

private fun stripHtmlForPreview(html: String): String =
    HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
        .toString()
        .trim()

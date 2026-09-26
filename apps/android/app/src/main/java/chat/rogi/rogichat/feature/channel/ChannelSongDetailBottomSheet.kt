package chat.rogi.rogichat.feature.channel

import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.Article
import com.adamglin.phosphoricons.fill.Heart
import com.adamglin.phosphoricons.fill.Lock
import com.adamglin.phosphoricons.fill.Microphone
import com.adamglin.phosphoricons.fill.MusicNote
import com.adamglin.phosphoricons.fill.PencilSimple
import com.adamglin.phosphoricons.fill.PlayCircle
import com.adamglin.phosphoricons.fill.Star
import com.adamglin.phosphoricons.regular.ArrowSquareOut
import com.adamglin.phosphoricons.regular.Heart
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.adamglin.phosphoricons.fill.Radio

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelSongDetailBottomSheet(
    song: Song,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val context = LocalContext.current

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 32.dp),
        ) {
            // Header (Album Art + Title + Artist)
            HeaderSection(song = song)

            Spacer(modifier = Modifier.height(20.dp))

            // Categories
            if (song.categories.isNotEmpty()) {
                CategoriesSection(song = song)
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Music Info (Difficulty, Key, BPM)
            MusicInfoSection(song = song)

            // Description
            song.description?.takeIf { it.isNotBlank() }?.let { description ->
                Spacer(modifier = Modifier.height(16.dp))
                DescriptionSection(description = description)
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Links
            LinksSection(
                song = song,
                onLinkClick = { url ->
                    val normalizedUrl = if (!url.contains("://")) "https://$url" else url
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, normalizedUrl.toUri())
                        context.startActivity(intent)
                    } catch (_: Exception) {
                    }
                },
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Memo
            MemoSection(
                song = song,
                canViewMemo = false,
            )

            Spacer(modifier = Modifier.height(20.dp))

        }
    }
}

@Composable
private fun HeaderSection(song: Song) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        ChannelRemoteImage(song.albumArt, song.title.take(1), 160.dp,
            Modifier.clip(RoundedCornerShape(12.dp)))

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = song.title,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )

        Spacer(modifier = Modifier.height(4.dp))

        song.artist?.let { artist ->
            Text(
                text = artist.name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoriesSection(song: Song) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "카테고리",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(8.dp))

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            song.categories.forEach { category ->
                val categoryColor = parseHexColor(category.color)
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(categoryColor.copy(alpha = 0.15f))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(categoryColor),
                    )
                    Text(
                        text = category.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}

@Composable
private fun MusicInfoSection(song: Song) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        // Difficulty
        InfoItem(
            label = "난이도",
            content = {
                val difficulty = song.difficulty?.takeIf { it > 0 }
                if (difficulty != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        repeat(5) { index ->
                            Icon(
                                imageVector = PhosphorIcons.Fill.Star,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = if (index < difficulty) {
                                    Color(0xFFFBBF24)
                                } else {
                                    MaterialTheme.colorScheme.outlineVariant
                                },
                            )
                        }
                    }
                } else {
                    Text(
                        text = "-",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
        )

        VerticalDivider()

        // Key
        InfoItem(
            label = "키",
            content = {
                Text(
                    text = song.songKey ?: "-",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            },
        )

        VerticalDivider()

        // BPM
        InfoItem(
            label = "BPM",
            content = {
                Text(
                    text = song.bpm?.toString() ?: "-",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            },
        )
    }
}

@Composable
private fun InfoItem(
    label: String,
    content: @Composable () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        content()
    }
}

@Composable
private fun VerticalDivider() {
    Box(
        modifier = Modifier
            .width(1.dp)
            .height(40.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

@Composable
private fun DescriptionSection(description: String) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "설명",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(8.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .padding(16.dp),
        ) {
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun LinksSection(
    song: Song,
    onLinkClick: (String) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "링크",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(8.dp))

        val hasLinks = listOfNotNull(
            song.lyricsLink?.takeIf { it.isNotBlank() },
            song.karaokeUrl?.takeIf { it.isNotBlank() },
            song.originalUrl?.takeIf { it.isNotBlank() },
            song.coverUrl?.takeIf { it.isNotBlank() },
        ).isNotEmpty()

        if (hasLinks) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                song.lyricsLink?.takeIf { it.isNotBlank() }?.let { url ->
                    LinkButton(
                        title = "가사 보기",
                        icon = PhosphorIcons.Fill.Article,
                        iconColor = Color(0xFF8B5CF6),
                        onClick = { onLinkClick(url) },
                    )
                }

                song.karaokeUrl?.takeIf { it.isNotBlank() }?.let { url ->
                    LinkButton(
                        title = "노래방",
                        icon = PhosphorIcons.Fill.MusicNote,
                        iconColor = Color(0xFFF59E0B),
                        onClick = { onLinkClick(url) },
                    )
                }

                song.originalUrl?.takeIf { it.isNotBlank() }?.let { url ->
                    LinkButton(
                        title = "원곡",
                        icon = PhosphorIcons.Fill.PlayCircle,
                        iconColor = Color(0xFFEF4444),
                        onClick = { onLinkClick(url) },
                    )
                }

                song.coverUrl?.takeIf { it.isNotBlank() }?.let { url ->
                    LinkButton(
                        title = "커버",
                        icon = PhosphorIcons.Fill.Microphone,
                        iconColor = Color(0xFF3B82F6),
                        onClick = { onLinkClick(url) },
                    )
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "등록된 링크가 없습니다",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun LinkButton(
    title: String,
    icon: ImageVector,
    iconColor: Color,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconColor,
            modifier = Modifier.size(20.dp),
        )

        Spacer(modifier = Modifier.width(12.dp))

        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )

        Icon(
            imageVector = PhosphorIcons.Regular.ArrowSquareOut,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun MemoSection(
    song: Song,
    canViewMemo: Boolean,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "메모",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (!canViewMemo) {
                Icon(
                    imageVector = PhosphorIcons.Fill.Lock,
                    contentDescription = null,
                    modifier = Modifier.size(12.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerLow)
                .padding(16.dp),
        ) {
            if (canViewMemo) {
                val memoText = song.lyricsText?.takeIf { it.isNotBlank() }
                Text(
                    text = memoText ?: "등록된 메모가 없습니다",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (memoText != null) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Fill.Lock,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "메모는 채널 소유자 또는 매니저만 볼 수 있어요",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
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
        Color(0xFF6B7280)
    }
}

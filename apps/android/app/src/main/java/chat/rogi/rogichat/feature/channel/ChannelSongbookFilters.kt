package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.Check
import com.adamglin.phosphoricons.fill.Funnel
import com.adamglin.phosphoricons.fill.Star

@Composable
internal fun SongbookFilterChip(
    hasActiveFilters: Boolean,
    activeFilterCount: Int,
    onClick: () -> Unit,
) {
    val backgroundColor = if (hasActiveFilters) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }
    val contentColor = if (hasActiveFilters) {
        MaterialTheme.colorScheme.onPrimary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(
        modifier = Modifier
            .height(36.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(backgroundColor)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = PhosphorIcons.Fill.Funnel,
            contentDescription = "필터",
            modifier = Modifier.size(16.dp),
            tint = contentColor,
        )
        if (hasActiveFilters) {
            Text(
                text = "$activeFilterCount",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = contentColor,
            )
        }
    }
}

@Composable
internal fun CategoryChip(
    text: String,
    selected: Boolean,
    categoryColor: String? = null,
    onClick: () -> Unit,
) {
    val chipColor = categoryColor?.let { parseHexColor(it) } ?: MaterialTheme.colorScheme.primary
    val backgroundColor = if (selected) chipColor else MaterialTheme.colorScheme.surfaceContainerHighest
    // Calculate text color based on background luminance for better visibility
    val textColor = if (selected) {
        getContrastingTextColor(chipColor)
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Box(
        modifier = Modifier
            .height(36.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(backgroundColor)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = textColor,
        )
    }
}

/**
 * Calculates the appropriate text color (black or white) based on the background color's luminance.
 * Uses WCAG relative luminance formula: 0.299 * R + 0.587 * G + 0.114 * B
 * Returns white for dark backgrounds, black for light backgrounds.
 */
private fun getContrastingTextColor(backgroundColor: Color): Color {
    val luminance = 0.299f * backgroundColor.red + 0.587f * backgroundColor.green + 0.114f * backgroundColor.blue
    return if (luminance > 0.5f) Color.Black else Color.White
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FilterBottomSheet(
    artists: List<Artist>,
    selectedArtist: Artist?,
    selectedDifficulty: Int?,
    onArtistSelected: (Artist?) -> Unit,
    onDifficultySelected: (Int?) -> Unit,
    onClearFilters: () -> Unit,
    onApply: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var artistSearchQuery by remember { mutableStateOf("") }
    var difficultyEnabled by remember(selectedDifficulty) { mutableStateOf(selectedDifficulty != null) }
    var difficultyValue by remember(selectedDifficulty) { mutableFloatStateOf((selectedDifficulty ?: 3).toFloat()) }

    val filteredArtists = remember(artists, artistSearchQuery) {
        if (artistSearchQuery.isBlank()) {
            artists
        } else {
            artists.filter { it.name.contains(artistSearchQuery, ignoreCase = true) }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            // Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = {
                    onClearFilters()
                    difficultyEnabled = false
                    difficultyValue = 3f
                }) {
                    Text("초기화")
                }
                Text(
                    text = "필터",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                TextButton(onClick = {
                    if (difficultyEnabled) {
                        onDifficultySelected(difficultyValue.toInt())
                    } else {
                        onDifficultySelected(null)
                    }
                    onApply()
                }) {
                    Text("적용")
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Difficulty Section
            Text(
                text = "난이도",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "난이도 필터 사용",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Switch(
                    checked = difficultyEnabled,
                    onCheckedChange = { difficultyEnabled = it },
                )
            }

            if (difficultyEnabled) {
                Spacer(modifier = Modifier.height(12.dp))

                // Stars display
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    repeat(5) { index ->
                        Icon(
                            imageVector = PhosphorIcons.Fill.Star,
                            contentDescription = null,
                            modifier = Modifier.size(28.dp),
                            tint = if (index < difficultyValue.toInt()) {
                                Color(0xFFFBBF24)
                            } else {
                                MaterialTheme.colorScheme.outlineVariant
                            },
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Slider(
                    value = difficultyValue,
                    onValueChange = { difficultyValue = it },
                    valueRange = 1f..5f,
                    steps = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            HorizontalDivider()

            Spacer(modifier = Modifier.height(24.dp))

            // Artist Section
            Text(
                text = "가수",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Artist search (if many artists)
            if (artists.size > 10) {
                ChannelSearchBar(
                    query = artistSearchQuery,
                    onQueryChange = { artistSearchQuery = it },
                    onSearch = { },
                    onClear = { artistSearchQuery = "" },
                    placeholder = "가수 검색",
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Artist list in a scrollable container
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
            ) {
                // "전체" option
                item {
                    ArtistItem(
                        name = "전체",
                        songCount = null,
                        isSelected = selectedArtist == null,
                        onClick = { onArtistSelected(null) },
                    )
                }

                items(filteredArtists, key = { it.id }) { artist ->
                    ArtistItem(
                        name = artist.name,
                        songCount = artist.songCount,
                        isSelected = selectedArtist?.id == artist.id,
                        onClick = { onArtistSelected(artist) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ArtistItem(
    name: String,
    songCount: Int?,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp, horizontal = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = name,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            songCount?.let {
                Text(
                    text = "${it}곡",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (isSelected) {
            Icon(
                imageVector = PhosphorIcons.Fill.Check,
                contentDescription = "선택됨",
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
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
        Color(0xFF6B7280) // Default gray
    }
}

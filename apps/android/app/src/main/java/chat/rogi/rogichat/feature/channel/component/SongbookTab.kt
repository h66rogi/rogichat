package chat.rogi.rogichat.feature.channel.component

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.Check
import com.adamglin.phosphoricons.fill.Funnel
import com.adamglin.phosphoricons.fill.Heart
import com.adamglin.phosphoricons.regular.SortAscending
import com.adamglin.phosphoricons.fill.Star
import com.adamglin.phosphoricons.regular.Heart
import com.adamglin.phosphoricons.fill.Radio
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.core.designsystem.component.AlbumArtImage
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingSearchBar
import chat.rogi.rogichat.channelport.core.model.song.Artist
import chat.rogi.rogichat.channelport.core.model.song.Category
import chat.rogi.rogichat.channelport.core.model.song.Song
import chat.rogi.rogichat.feature.channel.ChannelDetailEvent
import chat.rogi.rogichat.feature.channel.LiveSongRequestUiState
import chat.rogi.rogichat.feature.channel.SongbookState
import chat.rogi.rogichat.feature.channel.SongSortOption

fun LazyListScope.songbookTabContent(
    state: SongbookState,
    onEvent: (ChannelDetailEvent) -> Unit,
) {
    // Search bar
    item(key = "songbook_search") {
        Column {
            Spacer(modifier = Modifier.height(16.dp))

            MelomingSearchBar(
                query = state.searchQuery,
                onQueryChange = { onEvent(ChannelDetailEvent.SongSearchChanged(it)) },
                onSearch = { },
                onClear = { onEvent(ChannelDetailEvent.SongSearchChanged("")) },
                placeholder = "곡 검색",
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            Spacer(modifier = Modifier.height(12.dp))
        }
    }

    if (state.liveRequestState.showRequestUI) {
        item(key = "songbook_live_request_banner") {
            LiveSongRequestBanner(
                state = state.liveRequestState,
                onClick = { onEvent(ChannelDetailEvent.ShowLiveRequestSheet) },
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(12.dp))
        }
    }

    // Filter chips
    item(key = "songbook_filters") {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            // Favorites Only Button (Heart icon only, circular)
            FavoriteChip(
                selected = state.showFavoritesOnly,
                onClick = { onEvent(ChannelDetailEvent.ToggleFavoritesOnly) },
            )

            // Filter Button
            FilterChip(
                hasActiveFilters = state.hasActiveFilters,
                activeFilterCount = state.activeFilterCount,
                onClick = { onEvent(ChannelDetailEvent.ShowFilterSheet) },
            )

            // Sort Button
            SortChip(
                currentSort = state.selectedSortOption,
                onClick = { onEvent(ChannelDetailEvent.ShowSortSheet) },
            )

            // Category: 전체
            CategoryChip(
                text = "전체",
                selected = state.selectedCategory == null,
                onClick = { onEvent(ChannelDetailEvent.CategorySelected(null)) },
            )

            // Category chips with color
            state.categories.forEach { category ->
                CategoryChip(
                    text = category.name,
                    selected = state.selectedCategory?.id == category.id,
                    categoryColor = category.color,
                    onClick = { onEvent(ChannelDetailEvent.CategorySelected(category)) },
                )
            }
        }

        // Filter Sheet
        if (state.showFilterSheet) {
            FilterBottomSheet(
                artists = state.artists,
                selectedArtist = state.selectedArtist,
                selectedDifficulty = state.selectedDifficulty,
                onArtistSelected = { onEvent(ChannelDetailEvent.ArtistSelected(it)) },
                onDifficultySelected = { onEvent(ChannelDetailEvent.DifficultySelected(it)) },
                onClearFilters = { onEvent(ChannelDetailEvent.ClearFilters) },
                onApply = { onEvent(ChannelDetailEvent.ApplyFilters) },
                onDismiss = { onEvent(ChannelDetailEvent.DismissFilterSheet) },
            )
        }

        // Sort Sheet
        if (state.showSortSheet) {
            SortBottomSheet(
                currentSort = state.selectedSortOption,
                onSortSelected = { onEvent(ChannelDetailEvent.SortOptionSelected(it)) },
                onDismiss = { onEvent(ChannelDetailEvent.DismissSortSheet) },
            )
        }
    }

    item(key = "songbook_spacer") {
        Spacer(modifier = Modifier.height(16.dp))
    }

    // Loading state
    if (state.isLoading) {
        item(key = "songbook_loading") {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    } else if (state.songs.isEmpty()) {
        // Empty state
        item(key = "songbook_empty") {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = if (state.showFavoritesOnly) {
                        "좋아요한 곡이 없습니다"
                    } else if (state.searchQuery.isNotEmpty()) {
                        "'${state.searchQuery}'에 대한 결과가 없습니다"
                    } else {
                        "등록된 곡이 없습니다"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    } else {
        // Song list
        items(state.songs, key = { "song_${it.id}" }) { song ->
            SongItem(
                song = song,
                onClick = { onEvent(ChannelDetailEvent.SongSelected(song)) },
                onFavoriteClick = { onEvent(ChannelDetailEvent.ToggleSongFavorite(song)) },
                liveRequestState = state.liveRequestState,
                isRequestSubmitting = state.isRequestSubmitting,
                onRequestClick = { onEvent(ChannelDetailEvent.SongRequestSubmit(song)) },
            )
        }

        // Loading more indicator
        if (state.isLoadingMore) {
            item(key = "songbook_loading_more") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                }
            }
        }

        // Bottom padding
        item(key = "songbook_bottom_padding") {
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun LiveSongRequestBanner(
    state: LiveSongRequestUiState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bannerBrush = Brush.horizontalGradient(
        colors = listOf(
            Color(0xFFD946EF),
            Color(0xFFEC4899),
            Color(0xFF8B5CF6),
        ),
    )

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bannerBrush)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(Color.White.copy(alpha = 0.24f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = PhosphorIcons.Fill.Radio,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(16.dp),
                )
            }

            Column {
                Text(
                    text = if (state.paused) "신청곡 일시정지" else "신청곡 받는 중",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
                val queueSummary = if (state.maxQueueSize > 0) {
                    "대기열 ${state.queueCount}/${state.maxQueueSize}"
                } else {
                    "대기열 ${state.queueCount}"
                }
                Text(
                    text = queueSummary,
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.9f),
                )
            }
        }

        if (state.isQueueFull) {
            Text(
                text = "대기열 가득",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = Color.White,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color.White.copy(alpha = 0.22f))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LiveRequestStatusBottomSheet(
    state: LiveSongRequestUiState,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
            Text(
                text = "신청곡 현황",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Status badge
            val statusBrush = Brush.horizontalGradient(
                colors = if (state.paused) {
                    listOf(Color(0xFF9CA3AF), Color(0xFF6B7280))
                } else {
                    listOf(Color(0xFFD946EF), Color(0xFFEC4899), Color(0xFF8B5CF6))
                },
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(statusBrush)
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.24f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Fill.Radio,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                }
                Text(
                    text = if (state.paused) "신청곡 일시정지" else "신청곡 받는 중",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // Queue info
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(16.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        text = "대기열 현황",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            text = "${state.queueCount}",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        if (state.maxQueueSize > 0) {
                            Text(
                                text = "/ ${state.maxQueueSize}",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 2.dp),
                            )
                        }
                    }
                }
                if (state.isQueueFull) {
                    Text(
                        text = "대기열 가득",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color(0xFFEF4444))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Request availability info
            val infoText = when {
                state.paused -> "신청곡이 일시정지 상태입니다. 잠시 후 다시 시도해 주세요."
                state.isQueueFull -> "대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요."
                state.canRequest -> "신청곡을 받고 있습니다. 노래책에서 곡을 선택하여 신청해 주세요."
                else -> "현재 신청곡을 받을 수 없습니다."
            }
            val infoColor = when {
                state.canRequest -> Color(0xFF10B981)
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            Text(
                text = infoText,
                style = MaterialTheme.typography.bodySmall,
                color = infoColor,
            )

            Spacer(modifier = Modifier.height(20.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // Queue list
            Text(
                text = "대기열",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )

            Spacer(modifier = Modifier.height(12.dp))

            if (state.isLoadingQueue) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                }
            } else if (state.queueItems.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "대기 중인 신청곡이 없습니다",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                state.queueItems.forEachIndexed { index, item ->
                    QueueItemRow(index = index + 1, item = item)
                    if (index < state.queueItems.lastIndex) {
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun QueueItemRow(
    index: Int,
    item: chat.rogi.rogichat.channelport.core.model.song.SongRequestQueueItem,
) {
    val statusLabel = when (item.status) {
        "PENDING" -> "대기"
        "ACCEPTED" -> "수락"
        "PLAYING" -> "재생"
        else -> item.status
    }
    val statusColor = when (item.status) {
        "PLAYING" -> Color(0xFFD946EF)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Position number
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(
                    if (item.status == "PLAYING") {
                        Color(0xFFD946EF)
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHighest
                    },
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "$index",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = if (item.status == "PLAYING") Color.White else MaterialTheme.colorScheme.onSurface,
            )
        }

        // Album art
        AlbumArtImage(
            imageUrl = item.songAlbumArt,
            size = 40.dp,
        )

        // Song info
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.songTitle ?: item.rawTitle,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = item.songArtistName ?: item.rawArtist,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "by ${item.requesterNickname}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // Status badge
        Text(
            text = statusLabel,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = statusColor,
        )
    }
}

@Composable
private fun FavoriteChip(
    selected: Boolean,
    onClick: () -> Unit,
) {
    val backgroundColor = if (selected) Color(0xFFEF4444) else MaterialTheme.colorScheme.surfaceContainerHighest
    val iconColor = if (selected) Color.White else Color(0xFFEF4444)

    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(backgroundColor)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (selected) PhosphorIcons.Fill.Heart else PhosphorIcons.Regular.Heart,
            contentDescription = "좋아요만 보기",
            modifier = Modifier.size(18.dp),
            tint = iconColor,
        )
    }
}

@Composable
private fun FilterChip(
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
private fun SortChip(
    currentSort: SongSortOption,
    onClick: () -> Unit,
) {
    val isDefault = currentSort == SongSortOption.NEWEST
    val backgroundColor = if (!isDefault) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.surfaceContainerHighest
    }
    val contentColor = if (!isDefault) {
        MaterialTheme.colorScheme.onPrimary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(backgroundColor)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = PhosphorIcons.Regular.SortAscending,
            contentDescription = "정렬",
            modifier = Modifier.size(18.dp),
            tint = contentColor,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SortBottomSheet(
    currentSort: SongSortOption,
    onSortSelected: (SongSortOption) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

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
            Text(
                text = "정렬",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )

            Spacer(modifier = Modifier.height(24.dp))

            SongSortOption.entries.forEach { option ->
                SortOptionItem(
                    option = option,
                    isSelected = currentSort == option,
                    onClick = { onSortSelected(option) },
                )
            }
        }
    }
}

@Composable
private fun SortOptionItem(
    option: SongSortOption,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp, horizontal = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = option.displayName,
            style = MaterialTheme.typography.bodyMedium,
            color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
        )
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

@Composable
private fun CategoryChip(
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
private fun FilterBottomSheet(
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
                MelomingSearchBar(
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

@Composable
private fun SongItem(
    song: Song,
    onClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    liveRequestState: LiveSongRequestUiState,
    isRequestSubmitting: Boolean,
    onRequestClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AlbumArtImage(
            imageUrl = song.albumArt,
            size = 56.dp,
        )

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = song.title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface,
            )

            Spacer(modifier = Modifier.height(2.dp))

            // Artist + Difficulty
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                song.artist?.let { artist ->
                    Text(
                        text = artist.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }

                // Difficulty stars
                song.difficulty?.takeIf { it > 0 }?.let { difficulty ->
                    Row(horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                        repeat(difficulty.coerceAtMost(5)) {
                            Icon(
                                imageVector = PhosphorIcons.Fill.Star,
                                contentDescription = null,
                                modifier = Modifier.size(10.dp),
                                tint = Color(0xFFFBBF24),
                            )
                        }
                    }
                }
            }

            // Categories
            if (song.categories.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    song.categories.take(2).forEach { category ->
                        val categoryColor = parseHexColor(category.color)
                        Text(
                            text = category.name,
                            style = MaterialTheme.typography.labelSmall,
                            color = categoryColor,
                            modifier = Modifier
                                .clip(RoundedCornerShape(4.dp))
                                .background(categoryColor.copy(alpha = 0.15f))
                                .padding(horizontal = 6.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(start = 8.dp),
        ) {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClick = onFavoriteClick)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Icon(
                    imageVector = if (song.isLiked) PhosphorIcons.Fill.Heart else PhosphorIcons.Regular.Heart,
                    contentDescription = if (song.isLiked) "좋아요 취소" else "좋아요",
                    tint = if (song.isLiked) Color(0xFFEF4444) else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(20.dp),
                )
            }
            if (song.likeCount > 0) {
                Text(
                    text = "${song.likeCount}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (liveRequestState.showRequestUI) {
                Spacer(modifier = Modifier.height(6.dp))
                val isBlockedCategory = liveRequestState.blockedCategoryIds.isNotEmpty() &&
                    song.categories.any { it.id in liveRequestState.blockedCategoryIds }
                val isDuplicateRequest = liveRequestState.preventDuplicateSongs &&
                    song.id in liveRequestState.requestedSongIds
                val canSubmit = liveRequestState.canRequest && !isRequestSubmitting &&
                    !isBlockedCategory && !isDuplicateRequest
                val requestLabel = when {
                    isBlockedCategory -> "신청 불가"
                    isDuplicateRequest -> "신청됨"
                    isRequestSubmitting -> "신청중"
                    liveRequestState.paused -> "일시정지"
                    liveRequestState.isQueueFull -> "대기열 가득"
                    else -> "신청"
                }

                Button(
                    onClick = onRequestClick,
                    enabled = canSubmit,
                    shape = RoundedCornerShape(999.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD946EF),
                        contentColor = Color.White,
                        disabledContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                        disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                ) {
                    Text(
                        text = requestLabel,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
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
        Color(0xFF6B7280) // Default gray
    }
}

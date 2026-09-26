package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.Star
import com.adamglin.phosphoricons.fill.Trash
import com.adamglin.phosphoricons.regular.CaretDown
import com.adamglin.phosphoricons.regular.CaretUp
import com.adamglin.phosphoricons.regular.Image
import com.adamglin.phosphoricons.regular.Link
import com.adamglin.phosphoricons.regular.MagnifyingGlass
import com.adamglin.phosphoricons.regular.MusicNote
import com.adamglin.phosphoricons.regular.MusicNotes
import com.adamglin.phosphoricons.regular.Notepad
import com.adamglin.phosphoricons.regular.PlayCircle
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingCenterTopBar

@Composable
fun EditSongScreen(
    onNavigateBack: () -> Unit,
    onSongUpdated: () -> Unit,
    onSongDeleted: () -> Unit = onSongUpdated,
    viewModel: EditSongViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.clearError()
        }
    }

    LaunchedEffect(uiState.isSuccess) {
        if (uiState.isSuccess) {
            onSongUpdated()
        }
    }

    LaunchedEffect(uiState.isDeleteSuccess) {
        if (uiState.isDeleteSuccess) {
            onSongDeleted()
        }
    }

    Scaffold(
        topBar = {
            MelomingCenterTopBar(
                title = "노래 수정",
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "뒤로가기",
                        )
                    }
                },
                actions = {
                    TextButton(
                        onClick = { viewModel.updateSong() },
                        enabled = uiState.isValid && !uiState.isSubmitting,
                    ) {
                        if (uiState.isSubmitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                text = "저장",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (uiState.isValid) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                                },
                            )
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { paddingValues ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else {
            EditSongContent(
                uiState = uiState,
                onEvent = viewModel::onEvent,
                onDeleteClick = { viewModel.showDeleteDialog() },
                modifier = Modifier.padding(paddingValues),
            )
        }

        // Delete Confirmation Dialog
        if (uiState.showDeleteDialog) {
            AlertDialog(
                onDismissRequest = { viewModel.dismissDeleteDialog() },
                title = { Text("노래 삭제") },
                text = { Text("이 노래를 삭제하시겠습니까?\n삭제된 노래는 복구할 수 없습니다.") },
                confirmButton = {
                    TextButton(onClick = { viewModel.deleteSong() }) {
                        Text("삭제", color = Color(0xFFEF4444))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { viewModel.dismissDeleteDialog() }) {
                        Text("취소")
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EditSongContent(
    uiState: EditSongUiState,
    onEvent: (EditSongEvent) -> Unit,
    onDeleteClick: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var showAdditionalInfo by remember { mutableStateOf(false) }
    var showMemo by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        // Title Input
        CleanTextField(
            value = uiState.title,
            onValueChange = { onEvent(EditSongEvent.TitleChanged(it)) },
            placeholder = "노래 제목",
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            textStyle = TextStyle(
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            ),
        )

        Divider()

        // Artist Input
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            CleanTextField(
                value = uiState.artistName,
                onValueChange = { onEvent(EditSongEvent.ArtistNameChanged(it)) },
                placeholder = "아티스트",
            )

            // Artist suggestions
            if (uiState.filteredArtists.isNotEmpty() && uiState.artistName.isNotBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    uiState.filteredArtists.take(10).forEach { artist ->
                        SuggestionChip(
                            text = artist.name,
                            onClick = { onEvent(EditSongEvent.ArtistSelected(artist)) },
                        )
                    }
                }
            }
        }

        Divider()

        // Category Section
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Text(
                text = "카테고리",
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                uiState.categories.forEach { category ->
                    val isSelected = uiState.selectedCategories.contains(category.name)
                    SelectableChip(
                        text = category.name,
                        isSelected = isSelected,
                        onClick = { onEvent(EditSongEvent.CategoryToggled(category.name)) },
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            CleanTextField(
                value = uiState.newCategoryName,
                onValueChange = { onEvent(EditSongEvent.NewCategoryNameChanged(it)) },
                placeholder = "새 카테고리 (쉼표로 구분)",
                textStyle = TextStyle(
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
            )
        }

        Divider()

        // Difficulty Section
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Text(
                text = "난이도",
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(12.dp))
            DifficultyStars(
                difficulty = uiState.difficulty,
                onDifficultyChange = { onEvent(EditSongEvent.DifficultyChanged(it)) },
            )
        }

        Divider()

        // Album Art Section
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "앨범아트",
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                SearchButton(
                    onClick = { onEvent(EditSongEvent.SearchAlbumArt) },
                    enabled = uiState.canSearchAlbumArt && !uiState.isSearchingAlbumArt,
                    isLoading = uiState.isSearchingAlbumArt,
                )
            }

            // Search results
            if (uiState.albumArtResults.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    uiState.albumArtResults.forEach { image ->
                        AlbumArtItem(
                            imageUrl = image.thumbnailUrl ?: image.imageUrl,
                            isSelected = uiState.albumArt == image.imageUrl,
                            onClick = { onEvent(EditSongEvent.AlbumArtSelected(image.imageUrl)) },
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            IconTextField(
                value = uiState.albumArt,
                onValueChange = { onEvent(EditSongEvent.AlbumArtChanged(it)) },
                placeholder = "URL을 직접 입력",
                icon = PhosphorIcons.Regular.Image,
            )

            // Preview
            if (uiState.albumArt.isNotBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                AsyncImage(
                    model = channelImageUrl(uiState.albumArt),
                    contentDescription = "앨범아트 미리보기",
                    modifier = Modifier
                        .size(100.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerLow),
                )
            }
        }

        Divider()

        // Additional Info (Expandable)
        ExpandableSection(
            title = "추가 정보",
            expanded = showAdditionalInfo,
            onExpandChange = { showAdditionalInfo = it },
        ) {
            Column {
                IconTextField(
                    value = uiState.songKey,
                    onValueChange = { onEvent(EditSongEvent.SongKeyChanged(it)) },
                    placeholder = "키 (예: C#, D, Em)",
                    icon = PhosphorIcons.Regular.MusicNote,
                )

                Divider()

                IconTextField(
                    value = uiState.bpmString,
                    onValueChange = { onEvent(EditSongEvent.BpmChanged(it)) },
                    placeholder = "BPM (예: 120)",
                    icon = PhosphorIcons.Regular.MusicNotes,
                    keyboardType = KeyboardType.Number,
                )

                Divider()

                IconTextField(
                    value = uiState.karaokeUrl,
                    onValueChange = { onEvent(EditSongEvent.KaraokeUrlChanged(it)) },
                    placeholder = "노래방 영상 URL",
                    icon = PhosphorIcons.Regular.PlayCircle,
                )

                Divider()

                IconTextField(
                    value = uiState.originalUrl,
                    onValueChange = { onEvent(EditSongEvent.OriginalUrlChanged(it)) },
                    placeholder = "원곡 URL",
                    icon = PhosphorIcons.Regular.Link,
                )

                Divider()

                IconTextField(
                    value = uiState.coverUrl,
                    onValueChange = { onEvent(EditSongEvent.CoverUrlChanged(it)) },
                    placeholder = "커버 URL",
                    icon = PhosphorIcons.Regular.Link,
                )

                Divider()

                IconTextField(
                    value = uiState.lyricsLink,
                    onValueChange = { onEvent(EditSongEvent.LyricsLinkChanged(it)) },
                    placeholder = "가사 링크",
                    icon = PhosphorIcons.Regular.Notepad,
                )
            }
        }

        Divider()

        // Memo (Expandable)
        ExpandableSection(
            title = "메모",
            expanded = showMemo,
            onExpandChange = { showMemo = it },
        ) {
            CleanTextField(
                value = uiState.lyricsText,
                onValueChange = { onEvent(EditSongEvent.LyricsTextChanged(it)) },
                placeholder = "메모나 가사를 입력하세요 (채널 관리자만 볼 수 있음)",
                modifier = Modifier
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .height(120.dp),
                singleLine = false,
                textStyle = TextStyle(
                    fontSize = 15.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Delete button
        HorizontalDivider(
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Button(
            onClick = onDeleteClick,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFFEF4444).copy(alpha = 0.1f),
                contentColor = Color(0xFFEF4444),
            ),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(
                imageVector = PhosphorIcons.Fill.Trash,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "노래 삭제",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
            )
        }

        Spacer(modifier = Modifier.height(40.dp))
    }
}

@Composable
private fun Divider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 20.dp),
        thickness = 0.5.dp,
        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
    )
}

@Composable
private fun CleanTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    textStyle: TextStyle = TextStyle(
        fontSize = 16.sp,
        color = MaterialTheme.colorScheme.onSurface,
    ),
    singleLine: Boolean = true,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        textStyle = textStyle,
        singleLine = singleLine,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        decorationBox = { innerTextField ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = textStyle.copy(
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        ),
                    )
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun IconTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
        Spacer(modifier = Modifier.width(14.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.weight(1f),
            textStyle = TextStyle(
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            singleLine = true,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            decorationBox = { innerTextField ->
                Box {
                    if (value.isEmpty()) {
                        Text(
                            text = placeholder,
                            fontSize = 15.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        )
                    }
                    innerTextField()
                }
            },
        )
    }
}

@Composable
private fun SelectableChip(
    text: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val backgroundColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.surfaceContainerHigh
        },
        animationSpec = tween(150),
        label = "bg",
    )

    val textColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.onPrimary
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        animationSpec = tween(150),
        label = "text",
    )

    Text(
        text = text,
        fontSize = 14.sp,
        fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
        color = textColor,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun SuggestionChip(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun DifficultyStars(
    difficulty: Int,
    onDifficultyChange: (Int) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        repeat(5) { index ->
            val starIndex = index + 1
            val isActive = starIndex <= difficulty

            val color by animateColorAsState(
                targetValue = if (isActive) Color(0xFFFBBF24) else MaterialTheme.colorScheme.outlineVariant,
                animationSpec = tween(100),
                label = "star$index",
            )

            Icon(
                imageVector = PhosphorIcons.Fill.Star,
                contentDescription = "$starIndex 점",
                tint = color,
                modifier = Modifier
                    .size(32.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onDifficultyChange(starIndex) },
            )
        }
    }
}

@Composable
private fun SearchButton(
    onClick: () -> Unit,
    enabled: Boolean,
    isLoading: Boolean,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(
                if (enabled) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                } else {
                    MaterialTheme.colorScheme.surfaceContainerHigh
                },
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier.size(14.dp),
                strokeWidth = 1.5.dp,
                color = MaterialTheme.colorScheme.primary,
            )
        } else {
            Icon(
                imageVector = PhosphorIcons.Regular.MagnifyingGlass,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = if (enabled) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                },
            )
        }
        Text(
            text = "검색",
            fontSize = 13.sp,
            color = if (enabled) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            },
        )
    }
}

@Composable
private fun AlbumArtItem(
    imageUrl: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    val borderColor by animateColorAsState(
        targetValue = if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent,
        animationSpec = tween(150),
        label = "border",
    )

    Box(
        modifier = Modifier
            .size(72.dp)
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = if (isSelected) 2.dp else 0.dp,
                color = borderColor,
                shape = RoundedCornerShape(8.dp),
            )
            .clickable(onClick = onClick),
    ) {
        AsyncImage(
            model = channelImageUrl(imageUrl),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun ExpandableSection(
    title: String,
    expanded: Boolean,
    onExpandChange: (Boolean) -> Unit,
    content: @Composable () -> Unit,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onExpandChange(!expanded) }
                .padding(horizontal = 20.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = title,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Icon(
                imageVector = if (expanded) PhosphorIcons.Regular.CaretUp else PhosphorIcons.Regular.CaretDown,
                contentDescription = if (expanded) "접기" else "펼치기",
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }

        AnimatedVisibility(visible = expanded) {
            content()
        }
    }
}

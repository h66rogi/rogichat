package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.DotsSixVertical
import com.adamglin.phosphoricons.regular.MagnifyingGlass
import com.github.skydoves.colorpicker.compose.BrightnessSlider
import com.github.skydoves.colorpicker.compose.HsvColorPicker
import com.github.skydoves.colorpicker.compose.rememberColorPickerController
import chat.rogi.rogichat.channelport.core.designsystem.component.FullScreenLoading
import chat.rogi.rogichat.channelport.core.model.song.Category
import sh.calvin.reorderable.ReorderableItem
import sh.calvin.reorderable.rememberReorderableLazyListState

// 기본 색상 팔레트
private val DEFAULT_COLORS = listOf(
    "#3B82F6", // Blue
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#EF4444", // Red
    "#8B5CF6", // Violet
    "#06B6D4", // Cyan
    "#84CC16", // Lime
    "#F97316", // Orange
    "#EC4899", // Pink
    "#6B7280", // Gray
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoryManagementScreen(
    onNavigateBack: () -> Unit,
    viewModel: CategoryManagementViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val hapticFeedback = LocalHapticFeedback.current

    var showAddDialog by remember { mutableStateOf(false) }
    var editingCategory by remember { mutableStateOf<Category?>(null) }
    var deletingCategory by remember { mutableStateOf<Category?>(null) }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.onEvent(CategoryManagementEvent.ErrorDismissed)
        }
    }

    // 검색 필터링
    val filteredCategories = remember(uiState.categories, uiState.searchQuery) {
        if (uiState.searchQuery.isBlank()) {
            uiState.categories
        } else {
            uiState.categories.filter {
                it.name.contains(uiState.searchQuery, ignoreCase = true)
            }
        }
    }

    // Reorderable state
    var localCategories by remember(filteredCategories) { mutableStateOf(filteredCategories) }
    val lazyListState = rememberLazyListState()
    val reorderableLazyListState = rememberReorderableLazyListState(lazyListState) { from, to ->
        localCategories = localCategories.toMutableList().apply {
            add(to.index, removeAt(from.index))
        }
        hapticFeedback.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    // Update local categories when filtered categories change
    LaunchedEffect(filteredCategories) {
        localCategories = filteredCategories
    }

    // Save reordered categories when drag ends
    LaunchedEffect(localCategories) {
        if (uiState.searchQuery.isBlank() && localCategories != filteredCategories && localCategories.isNotEmpty()) {
            viewModel.onEvent(CategoryManagementEvent.ReorderCategories(localCategories))
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("카테고리 관리") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "뒤로가기",
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showAddDialog = true },
                containerColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = "카테고리 추가",
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            // 검색바
            SearchBar(
                query = uiState.searchQuery,
                onQueryChange = { viewModel.onEvent(CategoryManagementEvent.SearchQueryChanged(it)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            when {
                uiState.isLoading -> {
                    FullScreenLoading()
                }
                localCategories.isEmpty() -> {
                    EmptyState(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                    )
                }
                else -> {
                    LazyColumn(
                        state = lazyListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(localCategories, key = { it.id }) { category ->
                            ReorderableItem(reorderableLazyListState, key = category.id) { isDragging ->
                                CategoryItem(
                                    category = category,
                                    isDragging = isDragging,
                                    canReorder = uiState.searchQuery.isBlank(),
                                    onEdit = { editingCategory = category },
                                    onDelete = { deletingCategory = category },
                                    dragModifier = Modifier.draggableHandle(
                                        onDragStarted = {
                                            hapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)
                                        },
                                        onDragStopped = {
                                            hapticFeedback.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                        },
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // 추가 다이얼로그
    if (showAddDialog) {
        CategoryEditDialog(
            category = null,
            onDismiss = { showAddDialog = false },
            onSave = { name, color ->
                viewModel.onEvent(CategoryManagementEvent.CreateCategory(name, color))
                showAddDialog = false
            },
        )
    }

    // 수정 다이얼로그
    editingCategory?.let { category ->
        CategoryEditDialog(
            category = category,
            onDismiss = { editingCategory = null },
            onSave = { name, color ->
                viewModel.onEvent(CategoryManagementEvent.UpdateCategory(category.id, name, color))
                editingCategory = null
            },
        )
    }

    // 삭제 확인 다이얼로그
    deletingCategory?.let { category ->
        DeleteConfirmDialog(
            categoryName = category.name,
            songCount = category.songCount,
            onDismiss = { deletingCategory = null },
            onConfirm = {
                viewModel.onEvent(CategoryManagementEvent.DeleteCategory(category.id))
                deletingCategory = null
            },
        )
    }
}

@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val focusManager = LocalFocusManager.current

    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        modifier = modifier,
        placeholder = { Text("카테고리 검색") },
        leadingIcon = {
            Icon(
                imageVector = PhosphorIcons.Regular.MagnifyingGlass,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
            )
        },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
    )
}

@Composable
private fun CategoryItem(
    category: Category,
    isDragging: Boolean,
    canReorder: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    dragModifier: Modifier = Modifier,
    modifier: Modifier = Modifier,
) {
    val elevation by animateDpAsState(
        targetValue = if (isDragging) 8.dp else 1.dp,
        label = "elevation",
    )

    Card(
        modifier = modifier
            .fillMaxWidth()
            .shadow(elevation, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isDragging) {
                MaterialTheme.colorScheme.surfaceVariant
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // 드래그 핸들
            if (canReorder) {
                IconButton(
                    onClick = {},
                    modifier = dragModifier.size(32.dp),
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.DotsSixVertical,
                        contentDescription = "드래그하여 순서 변경",
                        modifier = Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.width(4.dp))
            }

            // 색상 원
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(parseHexColor(category.color)),
            )

            Spacer(modifier = Modifier.width(12.dp))

            // 카테고리 정보
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = category.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    text = "${category.songCount}곡",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // 액션 버튼
            IconButton(onClick = onEdit) {
                Icon(
                    imageVector = Icons.Default.Edit,
                    contentDescription = "수정",
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "삭제",
                    tint = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "카테고리가 없습니다",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "+ 버튼을 눌러 카테고리를 추가하세요",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
            )
        }
    }
}

@Composable
private fun CategoryEditDialog(
    category: Category?,
    onDismiss: () -> Unit,
    onSave: (name: String, color: String) -> Unit,
) {
    var name by remember { mutableStateOf(category?.name ?: "") }
    var color by remember { mutableStateOf(category?.color ?: DEFAULT_COLORS.first()) }

    val isEdit = category != null
    val isValid = name.isNotBlank() && name.length <= 20

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (isEdit) "카테고리 수정" else "카테고리 추가") },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // 이름 입력
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= 20) name = it },
                    label = { Text("카테고리 이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    supportingText = { Text("${name.length}/20") },
                    isError = name.length > 20,
                )

                // 색상 선택
                Text(
                    text = "색상",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )

                // 색상 팔레트
                ColorPalette(
                    selectedColor = color,
                    onColorSelected = { color = it },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(name.trim(), color) },
                enabled = isValid,
            ) {
                Text("저장")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("취소")
            }
        },
    )
}

@Composable
private fun ColorPalette(
    selectedColor: String,
    onColorSelected: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var hexInput by remember(selectedColor) {
        mutableStateOf(selectedColor.removePrefix("#").uppercase())
    }
    var showColorPicker by remember { mutableStateOf(false) }

    val controller = rememberColorPickerController()

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // 5개씩 2줄
        for (row in DEFAULT_COLORS.chunked(5)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { colorHex ->
                    val isSelected = colorHex.equals(selectedColor, ignoreCase = true)
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(parseHexColor(colorHex))
                            .then(
                                if (isSelected) {
                                    Modifier.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape)
                                } else {
                                    Modifier
                                },
                            )
                            .clickable { onColorSelected(colorHex) },
                    )
                }
            }
        }

        // 컬러피커 토글 버튼
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // 현재 선택된 색상 미리보기 (클릭하면 컬러피커 토글)
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(parseHexColor("#$hexInput"))
                    .border(
                        width = if (showColorPicker) 3.dp else 1.dp,
                        color = if (showColorPicker) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.outline
                        },
                        shape = CircleShape,
                    )
                    .clickable { showColorPicker = !showColorPicker },
            )

            // Hex 입력 필드
            OutlinedTextField(
                value = hexInput,
                onValueChange = { input ->
                    val filtered = input.uppercase().filter { it in "0123456789ABCDEF" }.take(6)
                    hexInput = filtered
                    if (filtered.length == 6) {
                        onColorSelected("#$filtered")
                    }
                },
                modifier = Modifier.weight(1f),
                label = { Text("HEX 색상") },
                prefix = { Text("#") },
                singleLine = true,
                supportingText = {
                    Text(if (showColorPicker) "컬러피커로 선택" else "미리보기를 탭하여 컬러피커 열기")
                },
            )
        }

        // 컬러피커
        if (showColorPicker) {
            HsvColorPicker(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                controller = controller,
                onColorChanged = { colorEnvelope ->
                    val hex = colorEnvelope.hexCode.takeLast(6).uppercase()
                    hexInput = hex
                    onColorSelected("#$hex")
                },
                initialColor = parseHexColor(selectedColor),
            )

            // 밝기 슬라이더
            BrightnessSlider(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(35.dp),
                controller = controller,
            )
        }
    }
}

@Composable
private fun DeleteConfirmDialog(
    categoryName: String,
    songCount: Int,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("카테고리 삭제") },
        text = {
            Column {
                Text("'$categoryName' 카테고리를 삭제하시겠습니까?")
                if (songCount > 0) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "이 카테고리에 속한 ${songCount}개의 곡에서 카테고리가 제거됩니다.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("삭제", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("취소")
            }
        },
    )
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

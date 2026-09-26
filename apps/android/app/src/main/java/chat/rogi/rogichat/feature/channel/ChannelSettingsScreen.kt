package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.Camera
import com.adamglin.phosphoricons.regular.Trash
import com.github.skydoves.colorpicker.compose.BrightnessSlider
import com.github.skydoves.colorpicker.compose.HsvColorPicker
import com.github.skydoves.colorpicker.compose.rememberColorPickerController
import chat.rogi.rogichat.channelport.core.designsystem.component.FullScreenLoading
import chat.rogi.rogichat.channelport.core.designsystem.component.ProfileImage

private val THEME_COLORS = listOf(
    "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
    "#06B6D4", "#84CC16", "#F97316", "#EC4899", "#6B7280",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelSettingsScreen(
    onNavigateBack: () -> Unit,
    onSettingsSaved: () -> Unit,
    viewModel: ChannelSettingsViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia(),
    ) { uri: Uri? ->
        uri?.let {
            val contentResolver = context.contentResolver
            val mimeType = contentResolver.getType(uri) ?: "image/jpeg"
            val fileName = "profile_${System.currentTimeMillis()}.${
                when {
                    mimeType.contains("png") -> "png"
                    mimeType.contains("gif") -> "gif"
                    mimeType.contains("webp") -> "webp"
                    else -> "jpg"
                }
            }"
            contentResolver.openInputStream(uri)?.use { inputStream ->
                val bytes = inputStream.readBytes()
                viewModel.onEvent(
                    ChannelSettingsEvent.ProfileImageSelected(fileName, mimeType, bytes)
                )
            }
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.onEvent(ChannelSettingsEvent.ErrorDismissed)
        }
    }

    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) {
            viewModel.onEvent(ChannelSettingsEvent.SaveSuccessConsumed)
            onSettingsSaved()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("채널 설정") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "뒤로가기")
                    }
                },
                actions = {
                    TextButton(
                        onClick = { viewModel.onEvent(ChannelSettingsEvent.Save) },
                        enabled = !uiState.isSaving && !uiState.isUploadingImage && uiState.name.isNotBlank(),
                    ) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        } else {
                            Text("저장")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { innerPadding ->
        if (uiState.isLoading) {
            FullScreenLoading()
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                ProfileImageSection(
                    profileImageUrl = uiState.profileImageUrl,
                    isUploading = uiState.isUploadingImage,
                    onPickImage = {
                        photoPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    },
                    onRemoveImage = { viewModel.onEvent(ChannelSettingsEvent.RemoveProfileImage) },
                )

                OutlinedTextField(
                    value = uiState.name,
                    onValueChange = { viewModel.onEvent(ChannelSettingsEvent.NameChanged(it)) },
                    label = { Text("채널 이름") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                )

                AdditionalLinksSection(
                    links = uiState.additionalLinks,
                    onAddLink = { name, url -> viewModel.onEvent(ChannelSettingsEvent.AddLink(name, url)) },
                    onUpdateLink = { index, name, url -> viewModel.onEvent(ChannelSettingsEvent.UpdateLink(index, name, url)) },
                    onRemoveLink = { index -> viewModel.onEvent(ChannelSettingsEvent.RemoveLink(index)) },
                )

                ThemeColorSection(
                    selectedColor = uiState.themeColor,
                    onColorChanged = { viewModel.onEvent(ChannelSettingsEvent.ThemeColorChanged(it)) },
                )

                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun ProfileImageSection(
    profileImageUrl: String?,
    isUploading: Boolean,
    onPickImage: () -> Unit,
    onRemoveImage: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "프로필 이미지",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
        )

        Box(
            modifier = Modifier
                .size(100.dp)
                .clip(CircleShape)
                .clickable(enabled = !isUploading) { onPickImage() },
            contentAlignment = Alignment.Center,
        ) {
            if (profileImageUrl != null) {
                AsyncImage(
                    model = channelImageUrl(profileImageUrl),
                    contentDescription = "프로필 이미지",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            } else {
                ProfileImage(
                    imageUrl = null,
                    size = 100.dp,
                )
            }

            if (isUploading) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.5f)),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Regular.Camera,
                        contentDescription = "이미지 변경",
                        tint = Color.White,
                        modifier = Modifier.size(28.dp),
                    )
                }
            }
        }

        if (profileImageUrl != null) {
            TextButton(onClick = onRemoveImage) {
                Icon(
                    imageVector = PhosphorIcons.Regular.Trash,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("이미지 제거", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun AdditionalLinksSection(
    links: List<chat.rogi.rogichat.channelport.core.model.channel.ChannelLink>,
    onAddLink: (String, String) -> Unit,
    onUpdateLink: (Int, String, String) -> Unit,
    onRemoveLink: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "추가 링크",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
        )

        links.forEachIndexed { index, link ->
            LinkRow(
                name = link.name,
                url = link.url,
                onNameChanged = { onUpdateLink(index, it, link.url) },
                onUrlChanged = { onUpdateLink(index, link.name, it) },
                onRemove = { onRemoveLink(index) },
            )
        }

        if (links.size < 5) {
            var newName by remember { mutableStateOf("") }
            var newUrl by remember { mutableStateOf("") }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("이름") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                )
                OutlinedTextField(
                    value = newUrl,
                    onValueChange = { newUrl = it },
                    label = { Text("URL") },
                    singleLine = true,
                    modifier = Modifier.weight(1.5f),
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                )
                IconButton(
                    onClick = {
                        if (newName.isNotBlank() && newUrl.isNotBlank()) {
                            onAddLink(newName.trim(), newUrl.trim())
                            newName = ""
                            newUrl = ""
                        }
                    },
                    enabled = newName.isNotBlank() && newUrl.isNotBlank(),
                ) {
                    Icon(Icons.Default.Add, contentDescription = "추가")
                }
            }

            Text(
                text = "최대 5개 (${links.size}/5)",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun LinkRow(
    name: String,
    url: String,
    onNameChanged: (String) -> Unit,
    onUrlChanged: (String) -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = onNameChanged,
            label = { Text("이름") },
            singleLine = true,
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(12.dp),
        )
        OutlinedTextField(
            value = url,
            onValueChange = onUrlChanged,
            label = { Text("URL") },
            singleLine = true,
            modifier = Modifier.weight(1.5f),
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        IconButton(onClick = onRemove) {
            Icon(
                Icons.Default.Close,
                contentDescription = "삭제",
                tint = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun ThemeColorSection(
    selectedColor: String,
    onColorChanged: (String) -> Unit,
) {
    var hexInput by remember(selectedColor) {
        mutableStateOf(selectedColor.removePrefix("#").uppercase())
    }
    var showColorPicker by remember { mutableStateOf(false) }
    val controller = rememberColorPickerController()

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "테마 색상",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Medium,
        )

        for (row in THEME_COLORS.chunked(5)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { colorHex ->
                    val isSelected = colorHex.equals(selectedColor, ignoreCase = true)
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(parseThemeColor(colorHex))
                            .then(
                                if (isSelected) Modifier.border(3.dp, MaterialTheme.colorScheme.primary, CircleShape)
                                else Modifier
                            )
                            .clickable { onColorChanged(colorHex) },
                    )
                }
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(parseThemeColor("#$hexInput"))
                    .border(
                        width = if (showColorPicker) 3.dp else 1.dp,
                        color = if (showColorPicker) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.outline,
                        shape = CircleShape,
                    )
                    .clickable { showColorPicker = !showColorPicker },
            )

            OutlinedTextField(
                value = hexInput,
                onValueChange = { input ->
                    val filtered = input.uppercase().filter { it in "0123456789ABCDEF" }.take(6)
                    hexInput = filtered
                    if (filtered.length == 6) {
                        onColorChanged("#$filtered")
                    }
                },
                modifier = Modifier.weight(1f),
                label = { Text("HEX 색상") },
                prefix = { Text("#") },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
            )
        }

        if (showColorPicker) {
            HsvColorPicker(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                controller = controller,
                onColorChanged = { colorEnvelope ->
                    val hex = colorEnvelope.hexCode.takeLast(6).uppercase()
                    hexInput = hex
                    onColorChanged("#$hex")
                },
                initialColor = parseThemeColor(selectedColor),
            )
            BrightnessSlider(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(35.dp),
                controller = controller,
            )
        }
    }
}

private fun parseThemeColor(hexColor: String?): Color {
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

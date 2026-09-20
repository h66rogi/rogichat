package chat.rogi.rogichat.feature.settings

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error as validationError
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.*

// ProfileSettingsScreen's top-bar save, fields, validation, busy state and server-success handling.
@Composable
fun ProfileScreen(model: ProfileViewModel, avatar: chat.rogi.rogichat.feature.media.AvatarSettingsModel? = null, onBack: () -> Unit) {
    val state: ProfileUiState = model.uiState.collectAsStateWithLifecycle().value
    val snackbars = remember { SnackbarHostState() }
    val focus = LocalFocusManager.current
    var discard by remember { mutableStateOf(false) }
    val leave: () -> Unit = { if (state.changed && !state.saved) discard = true else onBack() }
    BackHandler { if (!state.isSaving) leave() }
    LaunchedEffect(state.error) {
        if (state.original != null) state.error?.let { snackbars.showSnackbar(it); model.dismissError() }
    }
    LaunchedEffect(state.saved) { if (state.saved) onBack() }
    Scaffold(topBar = {
        AppTopBar("내 프로필", if (state.isSaving) null else leave, actions = {
            TextButton(onClick = { focus.clearFocus(); model.save() }, enabled = state.canSave) {
                if (state.isSaving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("저장")
            }
        })
    }, snackbarHost = { SnackbarHost(snackbars) }) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).imePadding().verticalScroll(rememberScrollState())) {
            when {
                state.isLoading -> ScreenStatus("프로필을 불러오는 중", "잠시만 기다려 주세요.", loading = true)
                state.original == null -> ScreenStatus("프로필을 불러오지 못했어요", "연결 상태를 확인하고 다시 시도해 주세요.", onRetry = model::load)
                else -> {
                    if (avatar != null) chat.rogi.rogichat.feature.media.AvatarSettings(avatar, state.isSaving, model::avatarApplied)
                    ProfileField(label = "표시 이름", value = state.editor.draft,
                        onValueChange = model::editNickname, enabled = !state.isSaving,
                        error = state.editor.error, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }))
                    Text(state.editor.error ?: "${state.editor.length}/40", modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = if (state.editor.error != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                    SettingsDivider()
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("생일", style = MaterialTheme.typography.titleMedium)
                        Text("선택 정보예요. 태어난 연도는 입력하지 않아요.", color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            OutlinedTextField(state.month, model::editMonth, modifier = Modifier.weight(1f), enabled = !state.isSaving,
                                label = { Text("월") }, singleLine = true, isError = state.birthdayError != null,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next))
                            OutlinedTextField(state.day, model::editDay, modifier = Modifier.weight(1f), enabled = !state.isSaving,
                                label = { Text("일") }, singleLine = true, isError = state.birthdayError != null,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { focus.clearFocus() }))
                        }
                        state.birthdayError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                        if (state.month.isNotEmpty() || state.day.isNotEmpty()) TextButton(onClick = model::clearBirthday, enabled = !state.isSaving) {
                            Text("생일 정보 지우기")
                        }
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("스트리머에게 생일 공개", style = MaterialTheme.typography.bodyLarge)
                                Text("연결된 스트리머에게 월과 일을 알려줘요.", style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Switch(checked = state.visibleToStreamers, onCheckedChange = model::setVisible,
                                enabled = !state.isSaving && state.birthday != null)
                        }
                    }
                }
            }
        }
    }
    if (discard) ConfirmationPrompt("변경 내용을 저장하지 않고 나갈까요?", "입력한 내용이 사라져요.", "나가기",
        onDismiss = { discard = false }, onConfirm = { discard = false; onBack() })
}

@Composable
private fun ProfileField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    error: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Text(
            text = label,
            fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label; if (error != null) validationError(error) },
            enabled = enabled,
            textStyle = TextStyle(
                fontSize = 16.sp,
                color = if (enabled) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            ),
            singleLine = true,
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            decorationBox = { innerTextField ->
                Box {
                    if (value.isEmpty()) {
                        Text(
                            text = label,
                            fontSize = 16.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                        )
                    }
                    innerTextField()
                }
            },
        )
    }
}

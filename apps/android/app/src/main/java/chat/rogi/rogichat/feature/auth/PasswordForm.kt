package chat.rogi.rogichat.feature.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import chat.rogi.rogichat.core.auth.*

/** Adapted Meloming LoginContent: focus/IME, masked input, visibility, busy admission. */
@Composable fun PasswordForm(busy: Boolean, changing: Boolean, rulesUrl: String? = null, onSubmit: (PasswordInput) -> Unit) {
    var expanded by remember { mutableStateOf(changing) }
    var login by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }
    var replacement by remember { mutableStateOf("") }; var confirmation by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }; var consent by remember { mutableStateOf(false) }
    var browserError by remember { mutableStateOf(false) }
    val context = LocalContext.current; val focus = LocalFocusManager.current
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { password = ""; replacement = ""; confirmation = ""; visible = false }
    val valid = PasswordInput.validPassword(password) && if (changing) PasswordInput.validPassword(replacement) && replacement == confirmation
        else login.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{2,63}")) && consent
    fun submit() { if (valid && !busy) {
        val input = PasswordInput(if (changing) null else login,password,if (changing) replacement else null)
        password = ""; replacement = ""; confirmation = ""; focus.clearFocus(); onSubmit(input)
    } }
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp),verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!changing) TextButton(onClick = { expanded = !expanded },enabled = !busy) { Text("아이디로 로그인") }
        if (expanded) {
            if (!changing) OutlinedTextField(login,{ login = it },label = { Text("아이디") },singleLine = true,enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii,imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password,{ password = it },label = { Text(if (changing) "현재 비밀번호" else "비밀번호") },singleLine = true,enabled = !busy,
                visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = { TextButton(onClick = { visible = !visible }) { Text(if (visible) "숨기기" else "보기") } },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password,imeAction = if (changing) ImeAction.Next else ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() },onNext = { focus.moveFocus(FocusDirection.Down) }),modifier = Modifier.fillMaxWidth())
            if (changing) {
                OutlinedTextField(replacement,{ replacement = it },label = { Text("새 비밀번호") },supportingText = { Text("12자 이상, 최대 256바이트") },singleLine = true,enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(),keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password,imeAction = ImeAction.Next),modifier = Modifier.fillMaxWidth())
                OutlinedTextField(confirmation,{ confirmation = it },label = { Text("새 비밀번호 확인") },singleLine = true,enabled = !busy,
                    visualTransformation = PasswordVisualTransformation(),keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password,imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),modifier = Modifier.fillMaxWidth())
                Text("변경하면 다른 기기의 로그인도 해제됩니다.",style = MaterialTheme.typography.bodySmall)
            } else {
                rulesUrl?.let { TextButton(onClick = { browserError = !ExternalBrowserHandler.openUrl(context,it) }) { Text("이용 안내 읽기") } }
                Row { Checkbox(consent,{ consent = it },enabled = !busy); Text(TERMS_CONSENT,style = MaterialTheme.typography.bodySmall) }
                if (browserError) Text("이용 안내를 열지 못했어요. 다시 시도해 주세요.",color = MaterialTheme.colorScheme.error)
            }
            Button(onClick = { submit() },enabled = valid && !busy,modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp)) else Text(if (changing) "비밀번호 변경" else "로그인")
            }
        }
    }
}

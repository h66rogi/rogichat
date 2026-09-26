package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.core.auth.*
import chat.rogi.rogichat.core.design.SettingsSection
import chat.rogi.rogichat.core.design.SettingsRow
import chat.rogi.rogichat.core.network.RoomDtos
import chat.rogi.rogichat.core.session.SessionIdentity
import chat.rogi.rogichat.feature.auth.PasswordForm
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID
import androidx.compose.ui.semantics.*

// Reuses the settings hub's server-loaded section, error/retry and grouped controls.
@Composable fun AccountAccessSettings(actions: AccountAccessActions, identity: SessionIdentity, passwordBusy: Boolean, onPassword: (PasswordInput) -> Unit) {
    var capabilities by remember(identity) { mutableStateOf<JsonObject?>(null) }
    var error by remember(identity) { mutableStateOf<String?>(null) }
    var refresh by remember { mutableIntStateOf(0) }
    var password by remember { mutableStateOf(false) }; var admin by remember { mutableStateOf(false) }
    LaunchedEffect(identity,refresh) {
        capabilities = null; error = null
        try {
            val value = Json.parseToJsonElement(actions.access(AccessRequest.me(),identity).getOrThrow()).jsonObject
            value.getValue("admin").jsonObject.getValue("enabled").jsonPrimitive.boolean
            value.getValue("password").jsonObject.getValue("enabled").jsonPrimitive.boolean
            capabilities = value
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "계정 권한을 확인하지 못했어요." }
    }
    SettingsSection("계정 보안") {
        error?.let { Text(it); TextButton(onClick = { refresh++ }) { Text("다시 확인") } }
        val caps = capabilities
        if (caps == null && error == null) { CircularProgressIndicator(Modifier.size(22.dp)); Text("계정 권한을 확인하는 중") }
        if (caps != null) {
            if (caps.getValue("password").jsonObject.getValue("enabled").jsonPrimitive.boolean) {
                SettingsRow("비밀번호 변경", "로그인 비밀번호 변경", onClick = { password = !password })
                if (password) PasswordForm(passwordBusy,true,onSubmit = onPassword)
            }
            if (caps.getValue("admin").jsonObject.getValue("enabled").jsonPrimitive.boolean) {
                SettingsRow("관리자", "기본방 임시 권한 관리", onClick = { admin = !admin })
                if (admin && caps.getValue("admin").jsonObject.getValue("manageTestAccess").jsonPrimitive.boolean)
                    RoomTestAccess(actions,identity)
                else if (admin) Text("현재 사용할 수 있는 관리 권한이 없어요.")
            }
        }
    }
    LoggedInDevices(actions, identity)
}

@Composable private fun LoggedInDevices(actions: AccountAccessActions, identity: SessionIdentity) {
    val scope = rememberCoroutineScope()
    var devices by remember(identity) { mutableStateOf<List<JsonObject>>(emptyList()) }
    var next by remember(identity) { mutableStateOf<String?>(null) }
    var loading by remember(identity) { mutableStateOf(false) }
    var error by remember(identity) { mutableStateOf<String?>(null) }
    var notice by remember(identity) { mutableStateOf<String?>(null) }
    var confirm by remember(identity) { mutableStateOf<String?>(null) }
    var revision by remember(identity) { mutableIntStateOf(0) }
    suspend fun load(after: String? = null) {
        if (loading) return
        loading = true; error = null
        try {
            val page = Json.parseToJsonElement(actions.access(AccessRequest.sessions(after), identity).getOrThrow()).jsonObject
            val rows = page.getValue("sessions").jsonArray.map { it.jsonObject }
            check(rows.size <= 50 && rows.all { row ->
                row.getValue("id").jsonPrimitive.content.let { runCatching { UUID.fromString(it) }.isSuccess } &&
                    row.getValue("kind").jsonPrimitive.content in setOf("web", "ios", "android", "other") &&
                    row.getValue("current").jsonPrimitive.booleanOrNull != null &&
                    runCatching { Instant.parse(row.getValue("createdAt").jsonPrimitive.content) }.isSuccess
            })
            val cursor = page.getValue("next").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            check(cursor == null || runCatching { UUID.fromString(cursor) }.isSuccess)
            devices = if (after == null) rows else devices + rows.filter { row -> devices.none { it.getValue("id") == row.getValue("id") } }
            next = cursor
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "로그인된 기기를 확인하지 못했어요." }
        finally { loading = false }
    }
    LaunchedEffect(identity, revision) { load() }
    SettingsSection("로그인된 기기") {
        Text("사용하지 않는 기기는 여기에서 로그아웃할 수 있어요.")
        if (loading) CircularProgressIndicator(Modifier.size(22.dp).semantics { contentDescription = "기기 확인 중" })
        notice?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error); TextButton(onClick = { revision++ }) { Text("다시 확인") } }
        devices.forEach { row ->
            val id = row.getValue("id").jsonPrimitive.content
            val name = when (row.getValue("kind").jsonPrimitive.content) { "ios" -> "iPhone 또는 iPad"; "android" -> "Android 기기"; "web" -> "웹 브라우저"; else -> "다른 기기" }
            val current = row.getValue("current").jsonPrimitive.boolean
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                Text(name + if (current) " · 현재 기기" else "", style = MaterialTheme.typography.titleSmall)
                Text("로그인: " + DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(Instant.parse(row.getValue("createdAt").jsonPrimitive.content)))
                if (!current) TextButton(onClick = { confirm = id }, enabled = !loading) { Text("$name 로그아웃") }
            }
        }
        if (next != null) TextButton(onClick = { scope.launch { load(next) } }, enabled = !loading) { Text("기기 더 보기") }
    }
    confirm?.let { target -> AlertDialog(onDismissRequest = { confirm = null }, title = { Text("이 기기에서 로그아웃할까요?") },
        text = { Text("해당 기기에서 더 이상 대화와 알림을 이용할 수 없어요.") },
        confirmButton = { TextButton(onClick = { confirm = null; scope.launch {
            loading = true; error = null
            try { actions.access(AccessRequest.revokeSession(target), identity).getOrThrow(); devices = devices.filter { it.getValue("id").jsonPrimitive.content != target }; notice = "기기에서 로그아웃했어요." }
            catch (_: Exception) { error = "로그아웃 결과를 확인하지 못했어요. 목록을 다시 확인해 주세요." }
            finally { loading = false }
        } }) { Text("로그아웃") } }, dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } }) }
}

@Composable private fun RoomTestAccess(actions: AccountAccessActions, identity: SessionIdentity) {
    val scope = rememberCoroutineScope()
    var room by remember { mutableStateOf<String?>(null) }; var name by remember { mutableStateOf("") }
    var role by remember { mutableStateOf<String?>(null) }; var expires by remember { mutableStateOf<Instant?>(null) }
    var grants by remember { mutableStateOf<List<JsonObject>>(emptyList()) }; var after by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }; var duration by remember { mutableStateOf(900) }
    var unknown by remember { mutableStateOf(false) }
    suspend fun load(more: Boolean = false) {
        busy = true; error = null
        try {
            val me = Json.parseToJsonElement(actions.access(AccessRequest.me(),identity).getOrThrow()).jsonObject
            check(me.getValue("admin").jsonObject.getValue("manageTestAccess").jsonPrimitive.boolean)
            var selected = room
            if (selected == null) {
                var cursor: String? = null; val seen = mutableSetOf<String>()
                do {
                    val page = RoomDtos.discovery(actions.access(AccessRequest.rooms(cursor),identity).getOrThrow())
                    val found = page.rooms.singleOrNull { it.isDefault }
                    if (found != null) { selected = found.roomId.value; name = found.name; break }
                    cursor = page.next?.value
                    check(cursor == null || seen.add(cursor))
                } while (cursor != null && seen.size < 100)
                room = selected
            }
            if (selected == null) { role = null; grants = emptyList(); return }
            val current = Json.parseToJsonElement(actions.access(AccessRequest.room(selected),identity).getOrThrow()).jsonObject
            role = current.getValue("effectiveRole").jsonPrimitive.content.also { check(it in setOf("FAN","MEMBER","STREAMER")) }
            expires = (current["temporaryStreamer"] as? JsonObject)?.getValue("expiresAt")?.jsonPrimitive?.content?.let(Instant::parse)
            val page = Json.parseToJsonElement(actions.access(AccessRequest.grants(selected,if (more) after else null),identity).getOrThrow()).jsonObject
            val values = page.getValue("grants").jsonArray.map { it.jsonObject.also { g ->
                check(g.getValue("roomId").jsonPrimitive.content == selected); UUID.fromString(g.getValue("grantId").jsonPrimitive.content)
                Instant.parse(g.getValue("expiresAt").jsonPrimitive.content)
            } }
            grants = if (more) (grants + values).distinctBy { it.getValue("grantId").jsonPrimitive.content } else values
            after = page["next"]?.takeIf { it != JsonNull }?.jsonPrimitive?.content
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { role = null; error = "권한을 확인하지 못했어요. 기본방 참여 여부와 관리 권한을 확인한 뒤 다시 시도해 주세요." }
        finally { busy = false }
    }
    LaunchedEffect(identity) { load() }
    LaunchedEffect(expires) { expires?.let { deadline -> delay((deadline.toEpochMilli()-System.currentTimeMillis()).coerceAtLeast(1)); load() } }
    fun command(grant: String? = null) {
        val target = room ?: return
        if (busy || reason.isBlank()) return
        val request = if (grant == null) AccessRequest.issue(target,UUID.randomUUID().toString(),duration,reason) else AccessRequest.revoke(target,grant,reason)
        busy = true
        scope.launch {
            var uncertain = false
            try { actions.access(request,identity).getOrThrow() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { uncertain = true; unknown = true }
            load()
            if (uncertain) error = "변경 결과를 확인하지 못했어요. 요청을 반복하지 않고 현재 권한을 다시 조회했습니다."
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("기본방 임시 권한",style = MaterialTheme.typography.titleMedium)
        Text("내 계정에만 최대 1시간 동안 방장 기능을 부여합니다. 실제 방장 계정은 변경하지 않습니다.",style = MaterialTheme.typography.bodySmall)
        if (busy) CircularProgressIndicator(Modifier.size(22.dp))
        error?.let { Text(it,color = MaterialTheme.colorScheme.error) }
        TextButton(onClick = { scope.launch { load() } },enabled = !busy) { Text("현재 권한 다시 확인") }
        if (room == null && !busy && error == null) Text("현재 등록된 기본방이 없어요.")
        if (room != null) {
            Text(name); role?.let { Text("현재 역할: " + when (it) { "STREAMER" -> "방장"; "FAN" -> "팬"; else -> "참여자" }) }
            expires?.let { Text("임시 권한 만료: $it") }
            OutlinedTextField(reason,{ reason = it },label = { Text("변경 사유") },enabled = !busy,modifier = Modifier.fillMaxWidth())
            Row { listOf(300,900,3600).forEach { seconds -> FilterChip(duration == seconds,{ duration = seconds },label = { Text("${seconds/60}분") },enabled = !busy) } }
            Button(onClick = { command() },enabled = !busy && !unknown && role == "FAN" && reason.isNotBlank() && reason.codePointCount(0,reason.length) <= 200 && reason.none { it.code < 32 || it.code == 127 }) { Text("내 계정에 임시 권한 부여") }
            grants.forEach { grant ->
                val expired = !Instant.parse(grant.getValue("expiresAt").jsonPrimitive.content).isAfter(Instant.now())
                val revoked = grant["revokedAt"] != JsonNull
                Text(if (revoked) "회수됨" else if (expired) "만료됨" else "임시 권한 사용 중")
                Text(grant.getValue("expiresAt").jsonPrimitive.content,style = MaterialTheme.typography.bodySmall)
                if (!expired && !revoked) OutlinedButton(onClick = { command(grant.getValue("grantId").jsonPrimitive.content) },enabled = !busy && reason.isNotBlank() && reason.codePointCount(0,reason.length) <= 200 && reason.none { it.code < 32 || it.code == 127 }) { Text("임시 권한 회수") }
            }
            if (after != null) TextButton(onClick = { scope.launch { load(true) } },enabled = !busy) { Text("이전 기록 더 보기") }
        }
    }
}

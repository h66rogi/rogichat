package chat.rogi.rogichat.core.network

import chat.rogi.rogichat.core.conversation.*
import chat.rogi.rogichat.core.identity.*
import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.messageactions.*
import chat.rogi.rogichat.core.push.*
import io.ktor.http.content.OutgoingContent
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.writeFully
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.HttpSend
import io.ktor.client.plugins.plugin
import io.ktor.util.AttributeKey
import io.ktor.client.request.prepareRequest
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.utils.io.readBuffer
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import kotlinx.io.readByteArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.CookieJar

/** Adapts Meloming ApiClient's client, verb wrappers and response boundary.
 * Native session credentials have no refresh operation or cookie transport.
 * Routes are a closed set; authentication never follows a redirect or arbitrary URL.
 */
enum class ApiRoute(val path: String) { SESSION("auth/session"), LOGOUT("auth/logout"), PROFILE("me/profile"), NOTIFICATION_PREFERENCES("me/notification-preferences"), PASSWORD_LOGIN("auth/password/login"), PASSWORD_CHANGE("auth/password/change"), SOOP_START("auth/native/soop/transactions"), SOOP_EXCHANGE("auth/native/completions/exchange") }
class ApiException(val statusCode: Int, val code: String?) : Exception("api_request_failed")
class InvalidResponse : Exception("invalid_response")
enum class ConversationRoute(val path: String, val cursorRequired: Boolean) {
    SNAPSHOT("snapshot", false), EVENTS("events", true), HISTORY("history", true), PROFILES("profile-sync", false)
}
class NativeResponse(val status: Int, val body: String) { override fun toString() = "NativeResponse(status=$status, [redacted])" }
private val nativeAdmission = AttributeKey<() -> Unit>("rogichat.native.admission")
interface NativeApi : AppleIdentityTransport, NativePushTransport {
    suspend fun nativePushAdmitted(route: NativePushRoute, bearer: String, body: String?, admission: () -> Unit): String { admission(); return performNativePush(route, bearer, body) }
    suspend fun removePushAdmitted(id: String, bearer: String, body: String, admission: () -> Unit) { admission(); removeNativePush(id, bearer, body) }
    suspend fun putAdmitted(route: ApiRoute, bearer: String, body: String, admission: () -> Unit): String { admission(); return put(route, bearer, body) }
    suspend fun postAuthAdmitted(route: ApiRoute, token: String?, body: String, admission: () -> Unit): String {
        admission(); return postAuth(route, token, body)
    }
    suspend fun performAppleAdmitted(route: AppleIdentityRoute, intent: IdentityIntent, originalBearer: String?, body: String, admission: () -> Unit): String {
        admission(); return performApple(route, intent, originalBearer, body)
    }
    suspend fun messageActionAdmitted(token: String, request: ActionRequest, admission: () -> Unit): NativeResponse {
        admission(); return messageAction(token, request)
    }
    override suspend fun performApple(route: AppleIdentityRoute, intent: IdentityIntent, originalBearer: String?, body: String): String = throw IllegalStateException("operation_unavailable")
    override suspend fun performNativePush(route: NativePushRoute, bearer: String, body: String?): String = throw IllegalStateException("operation_unavailable")
    override suspend fun removeNativePush(id: String, bearer: String, body: String): Unit = throw IllegalStateException("operation_unavailable")
    suspend fun sendTextAdmitted(token: String, room: RoomId, command: TextCommand, admission: () -> Unit): String {
        admission(); return sendText(token, room, command)
    }
    suspend fun media(token: String, request: MediaRequest, scope: MediaScope): String = throw IllegalStateException("operation_unavailable")
    suspend fun messageAction(token: String, request: ActionRequest): NativeResponse = throw IllegalStateException("operation_unavailable")
    suspend fun getConversation(token: String, room: RoomId, route: ConversationRoute, query: ManifestRequest): String = throw IllegalStateException("operation_unavailable")
    suspend fun getMessage(token: String, room: RoomId, message: RoomId): String = throw IllegalStateException("operation_unavailable")
    suspend fun getMessageReceipt(token: String, room: RoomId, command: RoomId): String = throw IllegalStateException("operation_unavailable")
    suspend fun getPrivateRecipients(token: String, room: RoomId, after: RoomId?): String = throw IllegalStateException("operation_unavailable")
    suspend fun sendText(token: String, room: RoomId, command: TextCommand): String = throw IllegalStateException("operation_unavailable")
    suspend fun deleteAccount(token: String): String = throw IllegalStateException("operation_unavailable")
    suspend fun joinRoom(token: String, room: RoomId): String = throw IllegalStateException("operation_unavailable")
    suspend fun leaveRoom(token: String, room: RoomId): Unit = throw IllegalStateException("operation_unavailable")
    suspend fun getRooms(token: String, after: RoomId?): String = throw IllegalStateException("operation_unavailable")
    suspend fun getManifest(token: String, query: ManifestRequest): String = throw IllegalStateException("operation_unavailable")
    suspend fun put(route: ApiRoute, token: String, body: String): String = throw IllegalStateException("operation_unavailable")
    suspend fun getReadState(room: ReadStateId, token: String): String = throw IllegalStateException("operation_unavailable")
    suspend fun putReadState(room: ReadStateId, token: String, body: String): String = throw IllegalStateException("operation_unavailable")
    suspend fun access(request: chat.rogi.rogichat.core.auth.AccessRequest, token: String, admission: () -> Unit): String = throw IllegalStateException("operation_unavailable")
    suspend fun postAuth(route: ApiRoute, token: String?, body: String): String = throw IllegalStateException("operation_unavailable")
    suspend fun get(route: ApiRoute, token: String): String
    suspend fun patchAdmitted(route: ApiRoute, token: String, body: String, admission: () -> Unit): String { admission(); return patch(route, token, body) }
    suspend fun patch(route: ApiRoute, token: String, body: String): String
    suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String)
}

class ApiClient(private val baseUrl: String, engine: HttpClientEngine = OkHttp.create {
    config { followRedirects(false); followSslRedirects(false); retryOnConnectionFailure(false); cookieJar(CookieJar.NO_COOKIES); cache(null) }
}) : NativeApi {
    init { require(baseUrl in setOf("https://api.qa.rogi.chat/v1/", "https://api.rogi.chat/v1/")) }
    private val client = HttpClient(engine) {
        expectSuccess = false
        followRedirects = false
        install(HttpTimeout) { requestTimeoutMillis = 20_000; connectTimeoutMillis = 10_000; socketTimeoutMillis = 20_000 }
    }
    init {
        client.plugin(HttpSend).intercept { request ->
            request.attributes.getOrNull(nativeAdmission)?.invoke()
            execute(request)
        }
    }
    override suspend fun getConversation(token: String, room: RoomId, route: ConversationRoute, query: ManifestRequest): String {
        require(route != ConversationRoute.SNAPSHOT || query.cursor == null)
        require(!route.cursorRequired || query.cursor != null)
        return call(HttpMethod.Get, "rooms/${room.value}/${route.path}", token, query = buildMap {
            put("deviceId", query.deviceId.value); put("cacheId", query.cacheId.value)
            // Full message + quote can each contain the maximum TEXT payload; stay below the bounded body reader.
            put("limit", if (route == ConversationRoute.PROFILES) "100" else "20")
            query.cursor?.let { put("cursor", it.value) }
        })
    }
    override suspend fun getMessage(token: String, room: RoomId, message: RoomId): String =
        call(HttpMethod.Get, "rooms/${room.value}/messages/${message.value}", token)
    override suspend fun getMessageReceipt(token: String, room: RoomId, command: RoomId): String =
        call(HttpMethod.Get, "rooms/${room.value}/message-commands/${command.value}", token)
    override suspend fun getPrivateRecipients(token: String, room: RoomId, after: RoomId?): String =
        call(HttpMethod.Get, "rooms/${room.value}/private-recipients", token, query = after?.let { mapOf("after" to it.value) }.orEmpty())
    override suspend fun sendText(token: String, room: RoomId, command: TextCommand): String =
        call(HttpMethod.Post, "rooms/${room.value}/messages", token, command.body())
    override suspend fun sendTextAdmitted(token: String, room: RoomId, command: TextCommand, admission: () -> Unit): String =
        call(HttpMethod.Post, "rooms/${room.value}/messages", token, command.body(), admission = admission)
    override suspend fun deleteAccount(token: String): String = call(HttpMethod.Delete, "me/account", token, "{}", strictDeletion = true)
    override suspend fun joinRoom(token: String, room: RoomId): String = call(HttpMethod.Post, "rooms/${room.value}/join", token, "{}")
    override suspend fun leaveRoom(token: String, room: RoomId) {
        val response = call(HttpMethod.Post, "rooms/${room.value}/leave", token, "{}", empty = true)
        if (response.isNotEmpty()) throw InvalidResponse()
    }
    override suspend fun getRooms(token: String, after: RoomId?): String = call(HttpMethod.Get, "rooms", token,
        query = after?.let { mapOf("after" to it.value) }.orEmpty())
    override suspend fun getManifest(token: String, query: ManifestRequest): String = call(HttpMethod.Get, "sync", token,
        query = buildMap { put("deviceId", query.deviceId.value); put("cacheId", query.cacheId.value); put("limit", "100")
            query.cursor?.let { put("cursor", it.value) } })
    override suspend fun get(route: ApiRoute, token: String): String = call(HttpMethod.Get, route.path, token)
    override suspend fun patch(route: ApiRoute, token: String, body: String): String = call(HttpMethod.Patch, route.path, token, body)
    override suspend fun patchAdmitted(route: ApiRoute, token: String, body: String, admission: () -> Unit): String {
        require(route == ApiRoute.PROFILE)
        return call(HttpMethod.Patch, route.path, token, body, admission = admission)
    }
    override suspend fun put(route: ApiRoute, token: String, body: String): String {
        require(route == ApiRoute.NOTIFICATION_PREFERENCES)
        return call(HttpMethod.Put, route.path, token, body)
    }
    override suspend fun getReadState(room: ReadStateId, token: String): String = call(HttpMethod.Get, "rooms/${room.value}/read-state", token)
    override suspend fun putReadState(room: ReadStateId, token: String, body: String): String = call(HttpMethod.Put, "rooms/${room.value}/read-state", token, body)
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) {
        call(HttpMethod.Post, route.path, token, body, empty = true)
    }
    override suspend fun postAuth(route: ApiRoute, token: String?, body: String): String {
        require(route in setOf(ApiRoute.SOOP_START, ApiRoute.SOOP_EXCHANGE, ApiRoute.PASSWORD_LOGIN, ApiRoute.PASSWORD_CHANGE))
        return call(HttpMethod.Post, route.path, token, body, authEndpoint = true)
    }
    override suspend fun postAuthAdmitted(route: ApiRoute, token: String?, body: String, admission: () -> Unit): String {
        require(route in setOf(ApiRoute.SOOP_START, ApiRoute.SOOP_EXCHANGE, ApiRoute.PASSWORD_LOGIN, ApiRoute.PASSWORD_CHANGE))
        return call(HttpMethod.Post, route.path, token, body, authEndpoint = true, admission = admission)
    }
    override suspend fun performAppleAdmitted(route: AppleIdentityRoute, intent: IdentityIntent, originalBearer: String?, body: String, admission: () -> Unit): String {
        require((intent == IdentityIntent.LINK) == (originalBearer != null))
        return call(HttpMethod.Post, route.path, originalBearer, body, authEndpoint = true, admission = admission)
    }
    override suspend fun messageActionAdmitted(token: String, request: ActionRequest, admission: () -> Unit): NativeResponse {
        FeatureRoutes.action(request)
        return rawCall(HttpMethod.parse(request.method), request.path, token, request.body, query = request.query, admission = admission)
    }
    override suspend fun performApple(route: AppleIdentityRoute, intent: IdentityIntent, originalBearer: String?, body: String): String {
        require((intent == IdentityIntent.LINK) == (originalBearer != null))
        return call(HttpMethod.Post, route.path, originalBearer, body, authEndpoint = true)
    }
    override suspend fun nativePushAdmitted(route: NativePushRoute, bearer: String, body: String?, admission: () -> Unit): String =
        call(HttpMethod.parse(route.method), route.path, bearer, body, expectedStatus = route.status, admission = admission)
    override suspend fun removePushAdmitted(id: String, bearer: String, body: String, admission: () -> Unit) {
        call(HttpMethod.Delete, "me/native-push-subscriptions/${RoomId(id).value}", bearer, body, empty = true, admission = admission)
    }
    override suspend fun putAdmitted(route: ApiRoute, bearer: String, body: String, admission: () -> Unit): String {
        require(route == ApiRoute.NOTIFICATION_PREFERENCES)
        return call(HttpMethod.Put, route.path, bearer, body, admission = admission)
    }
    override suspend fun performNativePush(route: NativePushRoute, bearer: String, body: String?): String =
        call(HttpMethod.parse(route.method), route.path, bearer, body, expectedStatus = route.status)
    override suspend fun removeNativePush(id: String, bearer: String, body: String) {
        call(HttpMethod.Delete, "me/native-push-subscriptions/${RoomId(id).value}", bearer, body, empty = true)
    }
    override suspend fun media(token: String, request: MediaRequest, scope: MediaScope): String {
        FeatureRoutes.media(request)
        scope.check()
        val path = request.path.substringBefore('?')
        val after = request.path.substringAfter("?after=", "").takeIf { it.isNotEmpty() }
        return call(HttpMethod.parse(request.method), path, token, request.jsonBody,
            query = after?.let { mapOf("after" to RoomId(it).value) }.orEmpty(), expectedStatus = request.expectedStatus,
            upload = request.upload, uploadScope = scope, admission = scope::check).also { scope.check() }
    }
    override suspend fun messageAction(token: String, request: ActionRequest): NativeResponse {
        FeatureRoutes.action(request)
        return rawCall(HttpMethod.parse(request.method), request.path, token, request.body, query = request.query).also {
            if (it.status == 401) throw ApiException(401, "UNAUTHENTICATED")
        }
    }
    override suspend fun access(request: chat.rogi.rogichat.core.auth.AccessRequest, token: String, admission: () -> Unit): String {
        val path = request.path.substringBefore('?')
        val after = request.path.substringAfter("?after=", "").takeIf { it.isNotEmpty() }
        return call(HttpMethod.parse(request.method), path, token, request.body, empty = request.status == 204,
            query = after?.let { mapOf("after" to it) } ?: emptyMap(), expectedStatus = request.status, admission = admission)
    }
    private suspend fun call(method: HttpMethod, path: String, token: String?, body: String? = null, empty: Boolean = false,
                             authEndpoint: Boolean = false, strictDeletion: Boolean = false, query: Map<String, String> = emptyMap(),
                             expectedStatus: Int = if (empty) 204 else 200, upload: MediaFile? = null, uploadScope: MediaScope? = null, admission: (() -> Unit)? = null): String {
        val response = rawCall(method, path, token, body, authEndpoint, query, upload, uploadScope, rejectUnauthenticated = !authEndpoint && !strictDeletion, admission = admission)
        if (response.status == 401 && !authEndpoint && !strictDeletion) throw ApiException(401, "UNAUTHENTICATED")
        if (response.status != expectedStatus) {
            val code = if (strictDeletion) chat.rogi.rogichat.core.deletion.AccountDeletionDto.errorCode(response.body)
                else try { chat.rogi.rogichat.core.auth.StrictAuthJson.objectValue(response.body)["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content }
                catch (_: Exception) { null }
            throw ApiException(response.status, code?.takeIf { it.matches(Regex("[A-Z_]{1,64}")) })
        }
        if (empty && response.body.isNotEmpty()) throw InvalidResponse()
        return response.body
    }
    private suspend fun rawCall(method: HttpMethod, path: String, token: String?, body: String? = null,
                                authEndpoint: Boolean = false, query: Map<String, String> = emptyMap(),
                                upload: MediaFile? = null, uploadScope: MediaScope? = null, rejectUnauthenticated: Boolean = true, admission: (() -> Unit)? = null): NativeResponse {
        require(token == null && authEndpoint || token != null && token.matches(Regex("[A-Za-z0-9_-]{43}")))
        require(path.matches(Regex("[A-Za-z0-9/_-]+")) && !path.startsWith('/') && "//" !in path)
        require(upload == null || body == null)
        return client.prepareRequest(baseUrl + path) {
            this.method = method
            admission?.let { attributes.put(nativeAdmission, it) }
            url { query.forEach { (key, value) -> parameters.append(key, value) } }
            if (token != null) headers.append(HttpHeaders.Authorization, "Bearer $token")
            headers.append("X-Rogi-Client", "android")
            headers.append(HttpHeaders.Accept, "application/json")
            if (body != null) { contentType(ContentType.Application.Json); setBody(body) }
            if (upload != null) {
                val admitted = requireNotNull(uploadScope)
                admitted.check(); upload.validate()
                setBody(object : OutgoingContent.WriteChannelContent() {
                    override val contentType = ContentType.Application.OctetStream
                    override val contentLength = upload.byteLength
                    override suspend fun writeTo(channel: ByteWriteChannel) = withContext(Dispatchers.IO) {
                        upload.file.inputStream().use { input ->
                            val buffer = ByteArray(65_536); var sent = 0L
                            while (true) {
                                ensureActive(); admitted.check()
                                val count = input.read(buffer); if (count < 0) break
                                sent += count; require(sent <= upload.byteLength); channel.writeFully(buffer, 0, count)
                            }
                            require(sent == upload.byteLength); admitted.check()
                        }
                    }
                })
            }
        }.execute { response ->
            if (response.status.value == 401 && rejectUnauthenticated) throw ApiException(401, "UNAUTHENTICATED")
            val bytes = response.bodyAsChannel().readBuffer(1_048_577L).readByteArray()
            if (bytes.size > 1_048_576) throw InvalidResponse()
            val text = try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString() }
                catch (_: Exception) { throw InvalidResponse() }
            if (response.status.value == 403 && rejectUnauthenticated) {
                val code = try { chat.rogi.rogichat.core.auth.StrictAuthJson.objectValue(text)["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content } catch (_: Exception) { null }
                if (code == "SOOP_LINK_REQUIRED") throw ApiException(403, code)
            }
            NativeResponse(response.status.value, text)
        }
    }
    fun close() = client.close()
}

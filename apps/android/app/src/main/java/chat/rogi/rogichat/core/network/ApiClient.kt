package chat.rogi.rogichat.core.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.CookieJar

/** Adapts Meloming ApiClient's client, verb wrappers and response boundary.
 * Native session credentials have no refresh operation or cookie transport.
 * Routes are a closed set; authentication never follows a redirect or arbitrary URL.
 */
enum class ApiRoute(val path: String) { SESSION("auth/session"), LOGOUT("auth/logout"), PROFILE("me/profile") }
class ApiException(val statusCode: Int, val code: String?) : Exception("api_request_failed")
class InvalidResponse : Exception("invalid_response")
interface NativeApi {
    suspend fun get(route: ApiRoute, token: String): String
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
    override suspend fun get(route: ApiRoute, token: String): String = call(HttpMethod.Get, route, token)
    override suspend fun patch(route: ApiRoute, token: String, body: String): String = call(HttpMethod.Patch, route, token, body)
    override suspend fun postWithoutResponse(route: ApiRoute, token: String, body: String) {
        call(HttpMethod.Post, route, token, body, empty = true)
    }
    private suspend fun call(method: HttpMethod, route: ApiRoute, token: String, body: String? = null, empty: Boolean = false): String {
        require(token.matches(Regex("[A-Za-z0-9_-]{43}")))
        return client.prepareRequest(baseUrl + route.path) {
            this.method = method
            headers.append(HttpHeaders.Authorization, "Bearer $token")
            headers.append("X-Rogi-Client", "android")
            headers.append(HttpHeaders.Accept, "application/json")
            if (body != null) { contentType(ContentType.Application.Json); setBody(body) }
        }.execute { response ->
            if (response.status.value == 401) throw ApiException(401, "UNAUTHENTICATED")
            val bytes = response.bodyAsChannel().readBuffer(1_048_577L).readByteArray()
            if (bytes.size > 1_048_576) throw InvalidResponse()
            val text = try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString() }
                catch (_: Exception) { throw InvalidResponse() }
            if (response.status.value != if (empty) 204 else 200) {
                val code = try { Json.parseToJsonElement(text).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content }
                    catch (_: Exception) { null }
                throw ApiException(response.status.value, code?.takeIf { it.matches(Regex("[A-Z_]{1,64}")) })
            }
            if (empty && text.isNotBlank()) throw InvalidResponse()
            text
        }
    }
    fun close() = client.close()
}

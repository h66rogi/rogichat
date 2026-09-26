package chat.rogi.rogichat.channelport.core.network.api

import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.core.session.CredentialStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.prepareRequest
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.utils.io.readBuffer
import kotlinx.io.readByteArray
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import java.time.Instant
import kotlin.coroutines.coroutineContext

interface BaseUrlProvider {
    fun getBaseUrl(): String
    fun getWebBaseUrl(): String
}

class ApiException(val statusCode: Int, message: String) : Exception(message)

// The copied APIs retain their request/response contracts. Only transport and
// authentication are replaced with Rogichat's protected native credentials.
class ApiClient(@PublishedApi internal val credentials: CredentialStore, clientOverride: HttpClient? = null) : BaseUrlProvider {
    @PublishedApi internal val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false; coerceInputValues = true }
    @PublishedApi internal val client = clientOverride ?: HttpClient(OkHttp) {
        expectSuccess = false
        followRedirects = false
        engine { config { followRedirects(false); followSslRedirects(false); retryOnConnectionFailure(false) } }
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 15_000; socketTimeoutMillis = 30_000 }
    }
    override fun getBaseUrl() = BuildConfig.API_BASE_URL.removeSuffix("/v1/")
    override fun getWebBaseUrl() = if (BuildConfig.ENVIRONMENT == "qa") "https://qa.rogi.chat" else "https://rogi.chat"
    fun buildUrl(path: String): String {
        require(path.matches(Regex("/v1/[A-Za-z0-9/_-]+")) && "//" !in path)
        return getBaseUrl() + path
    }

    suspend inline fun <reified T> get(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T = request(HttpMethod.Get, path, block)
    suspend inline fun <reified T> post(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T = request(HttpMethod.Post, path, block)
    suspend inline fun <reified T> put(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T = request(HttpMethod.Put, path, block)
    suspend inline fun <reified T> patch(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T = request(HttpMethod.Patch, path, block)
    suspend inline fun <reified T> delete(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T = request(HttpMethod.Delete, path, block)
    suspend inline fun <reified T> getNullable(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T? = request<T?>(HttpMethod.Get, path, block)
    suspend inline fun <reified T> postNullable(path: String, noinline block: HttpRequestBuilder.() -> Unit = {}): T? = request<T?>(HttpMethod.Post, path, block)
    suspend fun postWithoutResponse(path: String, block: HttpRequestBuilder.() -> Unit = {}) { request<Unit>(HttpMethod.Post, path, block) }
    suspend fun putWithoutResponse(path: String) { request<Unit>(HttpMethod.Put, path) {} }
    suspend fun deleteWithoutResponse(path: String) { request<Unit>(HttpMethod.Delete, path) {} }

    suspend inline fun <reified T> request(method: HttpMethod, path: String, noinline block: HttpRequestBuilder.() -> Unit): T = try {
        val original = credentials.read()
        val stamp = credentials.clearStamp()
        if (original != null && original.expiresAt <= Instant.now()) throw ApiException(401, "로그인 후 이용해 주세요.")
        client.prepareRequest(buildUrl(path)) {
            this.method = method
            contentType(ContentType.Application.Json)
            block()
            if (original != null) {
                headers.append(HttpHeaders.Authorization, "Bearer ${original.token}")
                headers.append("X-Rogi-Client", "android")
            }
            headers.append(HttpHeaders.Accept, "application/json")
        }.execute { response ->
            val result = handleResponse<T>(response)
            coroutineContext.ensureActive()
            check(credentials.read()?.token == original?.token && credentials.clearStamp() == stamp) { "로그인 상태가 변경되었어요." }
            result
        }
    } catch (e: CancellationException) { throw e }
    catch (e: ApiException) { throw e }
    catch (_: Exception) { throw ApiException(0, "처리하지 못했어요. 다시 시도해 주세요.") }

    suspend inline fun <reified T> handleResponse(response: HttpResponse): T {
        val bytes = response.bodyAsChannel().readBuffer(4_194_305L).readByteArray()
        check(bytes.size <= 4_194_304) { "불러올 수 없어요. 다시 시도해 주세요." }
        val code = response.status.value
        if (code !in 200..299) throw ApiException(code, when (code) {
            401 -> "로그인 후 이용해 주세요."
            403 -> "이 기능을 이용할 권한이 없어요."
            409 -> "이미 등록된 내용이에요."
            else -> "처리하지 못했어요. 다시 시도해 주세요."
        })
        @Suppress("UNCHECKED_CAST")
        if (T::class == Unit::class) return Unit as T
        return json.decodeFromString(bytes.toString(Charsets.UTF_8).ifBlank { "null" })
    }
}

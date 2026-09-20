package chat.rogi.rogichat.core.push

enum class NativePushRoute(val path: String, val method: String, val status: Int) {
    CAPABILITIES("me/native-push-capabilities", "GET", 200),
    REGISTER("me/native-push-subscriptions", "POST", 201),
    RESOLVE("me/native-push-subscriptions/resolve", "POST", 200)
}
/** OS network owner implements with existing bounded no-cookie/no-redirect transport.
 * Authorization: Bearer + X-Rogi-Client: android; no Origin/Cookie/CSRF.
 * Unknown result/409 => resolve and new scoped intent; never increment generation locally.
 */
interface NativePushTransport {
    suspend fun performNativePush(route: NativePushRoute, bearer: String, body: String?): String
    /** DELETE /v1/me/native-push-subscriptions/{id}, strict empty 204. */
    suspend fun removeNativePush(id: String, bearer: String, body: String)
}

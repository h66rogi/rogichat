package chat.rogi.rogichat.core.identity

/** Implement in the existing NativeApi owner, using its bounded/no-cookie/no-redirect client.
 * Header X-Rogi-Client: android; LINK carries original Bearer on BOTH routes,
 * LOGIN omits Authorization. Never retry a consumed/unknown exchange.
 */
interface AppleIdentityTransport {
    suspend fun performApple(route: AppleIdentityRoute, intent: IdentityIntent, originalBearer: String?, body: String): String
}

package chat.rogi.rogichat.core.network

import chat.rogi.rogichat.core.auth.StrictAuthJson
import java.util.Base64
import kotlinx.serialization.json.*

data class AccountPartition(val value: String) {
    init { canonicalScope(value) }
    override fun toString() = "AccountPartition([redacted])"
}
data class RoomScopeToken(val value: String) {
    init { canonicalScope(value) }
    override fun toString() = "RoomScopeToken([redacted])"
}
private fun canonicalScope(value: String) {
    require(value.matches(Regex("[A-Za-z0-9_-]{43}")))
    val bytes = Base64.getUrlDecoder().decode(value)
    require(bytes.size == 32 && Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) == value)
}
data class RoomId(val value: String) {
    init { require(value.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))) }
}
data class SyncCursor(val value: String) {
    init { require(value.isNotEmpty() && value.length <= 4096) }
    override fun toString() = "SyncCursor([redacted])"
}
enum class HistoryPolicy { ALL_AVAILABLE, SINCE_JOIN }
data class RoomJoinAcknowledgement(val actorId: RoomId, val historyPolicy: HistoryPolicy, val policyVersion: Long,
                                   val membershipScope: RoomScopeToken, val authorizationRevision: RoomScopeToken)
enum class RoomMode { FAN, GROUP }
enum class RoomAvailability { READY, OWNER_PENDING }
enum class RoomRole { FAN, MEMBER, STREAMER }
data class Membership(val roomId: RoomId, val name: String, val mode: RoomMode, val actorId: RoomId,
                      val role: RoomRole, val membershipScope: RoomScopeToken, val authorizationRevision: RoomScopeToken)
data class DiscoveredRoom(val roomId: RoomId, val name: String, val mode: RoomMode,
                          val actorId: RoomId?, val membershipScope: RoomScopeToken?, val authorizationRevision: RoomScopeToken?,
                          val isDefault: Boolean = false, val availability: RoomAvailability = RoomAvailability.READY)
data class DiscoveryPage(val rooms: List<DiscoveredRoom>, val next: RoomId?)
sealed interface MembershipPage {
    data object Reset : MembershipPage
    data class Success(val rooms: List<Membership>, val generation: String, val complete: Boolean,
                       val next: SyncCursor?) : MembershipPage
}
data class ManifestRequest(val deviceId: RoomId, val cacheId: RoomId, val cursor: SyncCursor? = null)

/** C06 schema 2 only. Discovery is not a membership manifest. */
object RoomDtos {
    fun join(text: String): RoomJoinAcknowledgement = decode {
        val root = StrictAuthJson.objectValue(text)
        val version = root.getValue("policyVersion").jsonPrimitive
        require(!version.isString && version.content.matches(Regex("0|[1-9][0-9]*")))
        val value = requireNotNull(version.longOrNull).also { require(it in 0..4_294_967_295L) }
        RoomJoinAcknowledgement(root.id("actorId"), HistoryPolicy.valueOf(root.string("historyPolicy")), value,
            RoomScopeToken(root.string("membershipScope")), RoomScopeToken(root.string("authorizationRevision")))
    }
    fun discovery(text: String): DiscoveryPage = decode {
        val root = StrictAuthJson.objectValue(text)
        val rooms = root.getValue("rooms").jsonArray.also { require(it.size <= 50) }.map { value ->
            val room = value.jsonObject
            val joined = room.bool("joined")
            val isDefault = if ("isDefault" in room) room.bool("isDefault") else false
            val availability = if ("availability" in room) RoomAvailability.valueOf(room.string("availability")) else RoomAvailability.READY
            require(availability != RoomAvailability.OWNER_PENDING || (isDefault && !joined))
            if (!joined) require(listOf("actorId", "membershipScope", "authorizationRevision").none { it in room })
            DiscoveredRoom(room.id("roomId"), room.name(), RoomMode.valueOf(room.string("mode")),
                if (joined) room.id("actorId") else null,
                if (joined) RoomScopeToken(room.string("membershipScope")) else null,
                if (joined) RoomScopeToken(room.string("authorizationRevision")) else null, isDefault, availability)
        }
        require(rooms.map { it.roomId }.distinct().size == rooms.size)
        DiscoveryPage(rooms, root.nullableString("next")?.let(::RoomId)).also {
            if (it.next != null) require(rooms.isNotEmpty() && rooms.last().roomId == it.next)
        }
    }
    fun manifest(text: String): MembershipPage = decode {
        val root = StrictAuthJson.objectValue(text)
        val version = root.getValue("schemaVersion").jsonPrimitive
        require(!version.isString && version.intOrNull == 2)
        val rooms = root.getValue("rooms").jsonArray.also { require(it.size <= 100) }
        val complete = root.bool("complete")
        if (root.bool("resetRequired")) {
            require(rooms.isEmpty() && !complete && root.getValue("generation") == JsonNull && root.getValue("nextCursor") == JsonNull)
            MembershipPage.Reset
        } else {
            val generation = root.string("generation").also { require(it.isNotEmpty() && it.length <= 4096) }
            val next = root.nullableString("nextCursor")?.let(::SyncCursor)
            require(complete == (next == null) && (complete || rooms.isNotEmpty()))
            val members = rooms.map { value ->
                val room = value.jsonObject
                Membership(room.id("roomId"), room.name(), RoomMode.valueOf(room.string("mode")), room.id("actorId"),
                    RoomRole.valueOf(room.string("role")), RoomScopeToken(room.string("membershipScope")),
                    RoomScopeToken(room.string("authorizationRevision")))
            }
            require(members.map { it.roomId }.distinct().size == members.size)
            MembershipPage.Success(members, generation, complete, next)
        }
    }
    private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.let { require(it.isString); it.content }
    private fun JsonObject.nullableString(key: String): String? = if (getValue(key) == JsonNull) null else string(key)
    private fun JsonObject.bool(key: String) = getValue(key).jsonPrimitive.let { require(!it.isString); requireNotNull(it.booleanOrNull) }
    private fun JsonObject.id(key: String) = RoomId(string(key))
    private fun JsonObject.name() = string("name").also { require(it.isNotBlank() && it.codePointCount(0, it.length) <= 80) }
    private inline fun <T> decode(block: () -> T): T = try { block() } catch (_: Exception) { throw InvalidResponse() }
}

/** Adapted Meloming ChannelApi constructor, typed response and query wrapper boundary. */
class RoomsApi(private val api: NativeApi) {
    suspend fun join(token: String, room: RoomId) = RoomDtos.join(api.joinRoom(token, room))
    suspend fun leave(token: String, room: RoomId) = api.leaveRoom(token, room)
    suspend fun discover(token: String, after: RoomId?) = RoomDtos.discovery(api.getRooms(token, after))
    suspend fun manifest(token: String, query: ManifestRequest) = RoomDtos.manifest(api.getManifest(token, query))
}

package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.media.*
import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.rooms.RoomsStore
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.settings.*
import java.time.Clock
import java.time.ZoneOffset
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileMutationTest {
    @Test fun heldAvatarResponseCannotOverwriteNewerNicknameSave() = serializeWrites(avatarFirst = true)
    @Test fun heldNicknameResponseCannotOverwriteNewerAvatarSave() = serializeWrites(avatarFirst = false)
    private fun serializeWrites(avatarFirst: Boolean) = runTest {
        var nickname = "로기"; var avatar: String? = null; var patches = 0
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
        fun body() = profile(nickname = nickname).replace("\"avatar\":null", "\"avatar\":" + (avatar?.let { "{\"assetId\":\"$it\"}" } ?: "null"))
        suspend fun changed(): String {
            val captured = body()
            if (++patches == 1) { entered.complete(Unit); release.await() }
            return captured
        }
        val api = object : NativeApi by TestApi() {
            override suspend fun get(route: ApiRoute, token: String): String = if (route == ApiRoute.SESSION)
                projection().replace("\"authenticated\":true", "\"authenticated\":true,\"accountPartition\":\"${"A".repeat(43)}\"") else body()
            override suspend fun patchAdmitted(route: ApiRoute, token: String, body: String, admission: () -> Unit): String {
                admission(); return patch(route, token, body)
            }
            override suspend fun patch(route: ApiRoute, token: String, body: String): String { nickname = "수정한 이름"; return changed() }
            override suspend fun media(token: String, request: MediaRequest, scope: MediaScope): String {
                scope.check(); assertEquals("me/profile", request.path); assertEquals("PATCH", request.method)
                avatar = OTHER; return changed()
            }
        }
        val db = object : RoomsStore by RoomTestStore(), AccountFeatureStore by BlockStore() {}
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC), roomsStore = db)
        gateway.restore().getOrThrow()
        val repository = AccountMediaRepository(gateway, db)
        val account = repository.open(gateway.session.value.let { SessionIdentity(it.generation, OWN) })
        suspend fun avatar() = account.client.updateAvatar(MediaReceipt(OTHER, MediaStatus.ready))
        suspend fun name() { gateway.save(OWN, ProfileChanges("수정한 이름", FieldChange.Unchanged, null)).getOrThrow() }
        val first = async { if (avatarFirst) avatar() else name() }; entered.await()
        val second = async { if (avatarFirst) name() else avatar() }; runCurrent()
        assertEquals(1, patches) // Both the HTTP operation and its response publication are serialized.
        release.complete(Unit); first.await(); second.await()
        assertEquals(2, patches)
        assertEquals("수정한 이름", gateway.session.value.account?.nickname)
        assertEquals(OTHER, gateway.session.value.account?.avatarAssetId)
    }
    @Test fun queuedProfileWriteUsesOriginalEpochAndNeverSendsAfterLogout() = runTest {
        val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>(); var patches = 0
        val api = TestApi().apply { patchBlock = {
            patches++; if (patches == 1) { entered.complete(Unit); release.await() }; profile(nickname = "변경")
        } }
        val gateway = NativeSessionCoordinator(TestStore(), api, Clock.fixed(NOW, ZoneOffset.UTC))
        gateway.restore().getOrThrow()
        val first = async { gateway.save(OWN, ProfileChanges("변경", FieldChange.Unchanged, null)) }; entered.await()
        val queued = async { gateway.save(OWN, ProfileChanges("다른 이름", FieldChange.Unchanged, null)) }; runCurrent()
        gateway.signOut().getOrThrow(); release.complete(Unit)
        assertTrue(runCatching { first.await() }.exceptionOrNull() is CancellationException)
        assertTrue(runCatching { queued.await() }.exceptionOrNull() is CancellationException)
        assertEquals(1, patches); assertNull(gateway.session.value.account)
    }
}

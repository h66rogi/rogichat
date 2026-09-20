package chat.rogi.rogichat.core

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.settings.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class SessionFeatureScopeTest {
    @Test fun sameScopeRetainsDraftModelsButAtoBtoANeverResurrectsOldStore() {
        val coordinator = SessionFeatureScope()
        val a = SessionScopeKey(1, ShellAccess.READY, "a")
        val first = coordinator.ownerFor(a)
        var cleared = 0
        first.viewModelStore.put("profile", object : ViewModel() { override fun onCleared() { cleared++ } })
        assertSame(first, coordinator.ownerFor(a))
        assertEquals(0, cleared)
        val b = coordinator.ownerFor(SessionScopeKey(2, ShellAccess.READY, "b"))
        assertNotSame(first, b)
        assertEquals(1, cleared)
        val returned = coordinator.ownerFor(a)
        assertNotSame(first, returned)
        assertNull(returned.viewModelStore.get("profile"))
        val parent = ViewModelStore()
        parent.put("scope", coordinator)
        returned.viewModelStore.put("profile", object : ViewModel() { override fun onCleared() { cleared++ } })
        parent.clear()
        assertEquals(2, cleared)
    }
    @Test fun delayedProfileSaveCannotPublishSuccessAfterAccountScopeCleared() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val original = UserProfile("a", "원래 이름", null, false)
        val repository = object : ProfileRepository {
            override suspend fun load(accountId: String) = Result.success(original)
            override suspend fun save(accountId: String, changes: ProfileChanges): Result<UserProfile> {
                withContext(NonCancellable) { gate.await() }
                return Result.success(original.copy(nickname = "서버에서 저장한 이름"))
            }
        }
        val coordinator = SessionFeatureScope()
        val owner = coordinator.ownerFor(SessionScopeKey(1, ShellAccess.READY, "a"))
        val model = ProfileViewModel(repository, "a", this)
        owner.viewModelStore.put("profile", model)
        yield()
        model.editNickname("입력한 이름")
        model.save()
        yield()
        coordinator.ownerFor(SessionScopeKey(2, ShellAccess.SIGNED_OUT, null))
        gate.complete(Unit)
        yield()
        assertFalse(model.uiState.value.saved)
        assertEquals("원래 이름", model.uiState.value.editor.baseline)
        val returned = coordinator.ownerFor(SessionScopeKey(3, ShellAccess.READY, "a"))
        assertNull(returned.viewModelStore.get("profile"))
    }
}

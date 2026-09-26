package chat.rogi.rogichat.core

import chat.rogi.rogichat.feature.settings.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.*
import org.junit.Test

class ProfileViewModelTest {
    private val original = UserProfile("account", "처음 이름", Birthday(2, 29), true)
    private class Repository(var profile: UserProfile) : ProfileRepository {
        var loadsFail = false
        var savesFail = false
        var saveGate: CompletableDeferred<Unit>? = null
        var calls = 0
        var loads = 0
        var changes: ProfileChanges? = null
        override suspend fun load(accountId: String): Result<UserProfile> {
            loads++
            return if (loadsFail) Result.failure(IllegalStateException("private_server_error")) else Result.success(profile)
        }
        override suspend fun save(accountId: String, changes: ProfileChanges): Result<UserProfile> {
            calls++
            this.changes = changes
            saveGate?.await()
            if (savesFail) return Result.failure(IllegalStateException("private_server_error"))
            profile = profile.copy(nickname = changes.nickname ?: profile.nickname,
                birthday = when (val birthday = changes.birthday) { FieldChange.Unchanged -> profile.birthday; is FieldChange.Set -> birthday.value },
                birthdayVisibleToStreamers = changes.birthdayVisibleToStreamers ?: profile.birthdayVisibleToStreamers)
            return Result.success(profile)
        }
    }
    @Test fun clearBirthdayIsExplicitNullAndDoesNotSendUnchangedName() = runBlocking {
        val repo = Repository(original)
        val model = ProfileViewModel(repo, "account", this)
        yield()
        assertFalse(model.uiState.value.changed)
        model.clearBirthday()
        model.save()
        yield()
        assertEquals(FieldChange.Set<Birthday>(null), repo.changes!!.birthday)
        assertNull(repo.changes!!.nickname)
        assertEquals(false, repo.changes!!.birthdayVisibleToStreamers)
        assertTrue(model.uiState.value.saved)
        assertFalse(model.uiState.value.changed)
    }
    @Test fun successfulSaveUsesCanonicalServerValueAndNoDuplicateConcurrentSave() = runBlocking {
        val repo = Repository(original)
        repo.saveGate = CompletableDeferred()
        val model = ProfileViewModel(repo, "account", this)
        yield()
        model.editNickname("  \u1100\u1161  ")
        model.save()
        model.save()
        yield()
        assertEquals(1, repo.calls)
        assertEquals("가", repo.changes!!.nickname)
        model.editNickname("should not change while saving")
        assertEquals("  \u1100\u1161  ", model.uiState.value.editor.draft)
        repo.saveGate!!.complete(Unit)
        yield()
        assertEquals("가", model.uiState.value.editor.baseline)
        assertTrue(model.uiState.value.saved)
    }
    @Test fun failedSavePreservesDraftAndOriginalAndDoesNotExposeRawServerError() = runBlocking {
        val repo = Repository(original).also { it.savesFail = true }
        val model = ProfileViewModel(repo, "account", this)
        yield()
        model.editNickname("바뀐 이름")
        model.save()
        yield()
        assertEquals("바뀐 이름", model.uiState.value.editor.draft)
        assertEquals(original, model.uiState.value.original)
        assertFalse(model.uiState.value.saved)
        assertTrue(model.uiState.value.canSave)
        assertFalse(model.uiState.value.error!!.contains("private_server_error"))
    }
    @Test fun validatesBirthdayAndKeepsUnchangedFieldsAbsent() = runBlocking {
        val model = ProfileViewModel(Repository(original), "account", this)
        yield()
        model.editMonth("4")
        model.editDay("31")
        assertNotNull(model.uiState.value.birthdayError)
        assertFalse(model.uiState.value.canSave)
        model.editDay("30")
        assertTrue(model.uiState.value.canSave)
        assertEquals(FieldChange.Set(Birthday(4, 30)), model.uiState.value.changes().birthday)
        assertNull(model.uiState.value.changes().nickname)
        assertNull(model.uiState.value.changes().birthdayVisibleToStreamers)
    }
    @Test fun crossAccountResponsesCannotPopulatePrivateProfile() = runBlocking {
        val repo = Repository(original.copy(id = "someone_else"))
        val model = ProfileViewModel(repo, "account", this)
        yield()
        assertNull(model.uiState.value.original)
        assertNotNull(model.uiState.value.error)
        assertFalse(model.uiState.value.canSave)
    }
    @Test fun failingLoadCanRetryWithoutInventingAProfile() = runBlocking {
        val repo = Repository(original).also { it.loadsFail = true }
        val model = ProfileViewModel(repo, "account", this)
        yield()
        assertNull(model.uiState.value.original)
        model.loadIfNeeded(original.nickname, original.avatarAssetId)
        yield()
        assertEquals(1, repo.loads)
        repo.loadsFail = false
        model.load()
        yield()
        assertEquals(original, model.uiState.value.original)
    }
    @Test fun returningToSettingsKeepsProfileAndRefreshesOnlyAfterAccountSummaryChanges() = runBlocking {
        val repo = Repository(original)
        val model = ProfileViewModel(repo, "account", this, autoLoad = false)
        model.loadIfNeeded(original.nickname, original.avatarAssetId)
        yield()
        assertEquals(1, repo.loads)
        model.loadIfNeeded(original.nickname, original.avatarAssetId)
        yield()
        assertEquals(1, repo.loads)
        repo.profile = original.copy(nickname = "새 이름")
        model.loadIfNeeded("새 이름", original.avatarAssetId)
        yield()
        assertEquals(2, repo.loads)
        assertEquals("새 이름", model.uiState.value.original?.nickname)
    }
}

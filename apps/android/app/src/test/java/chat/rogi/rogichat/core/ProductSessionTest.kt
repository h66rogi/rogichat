package chat.rogi.rogichat.core

import chat.rogi.rogichat.core.design.Appearance
import chat.rogi.rogichat.core.navigation.ShellAccess
import chat.rogi.rogichat.core.session.*
import kotlinx.coroutines.CancellationException
import chat.rogi.rogichat.feature.settings.profileMonogram
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.*
import org.junit.Test

class ProductSessionTest {
    @Test fun installedGatewayWithNoCredentialHasNoSyntheticOrUnimplementedActions() = runBlocking {
        val services = NativeSessionCoordinator(TestStore(null), TestApi()).services()
        services.actions!!.restore()
        assertEquals(ShellAccess.SIGNED_OUT, services.session.value.access)
        assertNull(services.session.value.account)
        assertTrue(services.actions.providers.isEmpty())
        assertFalse(services.actions.canLinkSoop)
        assertNull(services.deletion)
        assertNotNull(services.profiles)
        assertNull(services.rooms)
    }
    @Test fun readyRequiresLinkedSoopAccountAndSignedOutNeverContainsProfile() {
        val account = AccountSummary("id", "name", "Apple", false)
        assertThrows(IllegalArgumentException::class.java) { SessionSnapshot(ShellAccess.READY, account) }
        assertThrows(IllegalArgumentException::class.java) { SessionSnapshot(ShellAccess.SIGNED_OUT, account) }
        assertThrows(IllegalArgumentException::class.java) { SessionSnapshot(ShellAccess.RESTORING, account) }
        assertThrows(IllegalArgumentException::class.java) { SessionSnapshot(ShellAccess.RETRYABLE_FAILURE, account) }
        assertEquals(account, SessionSnapshot(ShellAccess.LINK_REQUIRED, account).account)
        assertEquals(ShellAccess.READY, SessionSnapshot(ShellAccess.READY, account.copy(soopConnected = true)).access)
    }
    @Test fun invalidPersistedAppearanceFallsBackToSystemAndKnownValuesRoundtrip() {
        assertEquals(Appearance.SYSTEM, Appearance.fromStorage(null))
        assertEquals(Appearance.SYSTEM, Appearance.fromStorage("removed_mode"))
        Appearance.entries.forEach { assertEquals(it, Appearance.fromStorage(it.name)) }
    }
    @Test fun duplicateSignInIsNotStartedAndOldSessionFailureIsDiscarded() = runBlocking {
        val gate = CompletableDeferred<Unit>()
        val session = MutableStateFlow(SessionSnapshot())
        var calls = 0
        val actions = object : SessionActions {
            override val providers = setOf(SignInProvider.APPLE)
            override suspend fun signIn(provider: SignInProvider): Result<Unit> {
                calls++; gate.await(); return Result.failure(IllegalStateException("sensitive detail"))
            }
            override suspend fun linkSoop() = Result.success(Unit)
            override suspend fun signOut(expected: SessionIdentity?) = Result.success(Unit)
            override suspend fun restore() = Result.success(Unit)
        }
        val model = SessionViewModel(ProductServices(session, actions), this)
        model.signIn(SignInProvider.SOOP)
        assertFalse(model.state.value.busy)
        model.signIn(SignInProvider.APPLE)
        model.signIn(SignInProvider.APPLE)
        yield()
        assertEquals(1, calls)
        session.value = SessionSnapshot(generation = 1)
        gate.complete(Unit)
        yield()
        assertFalse(model.state.value.busy)
        assertNull(model.state.value.error)
    }
    @Test fun cancelledProviderDoesNotLockSubsequentSignInAndCapabilitiesAreEnforced() = runBlocking {
        var calls = 0
        val actions = object : SessionActions {
            override val providers = setOf(SignInProvider.APPLE)
            override suspend fun signIn(provider: SignInProvider): Result<Unit> {
                calls++
                return Result.failure(CancellationException("user cancelled"))
            }
            override suspend fun linkSoop(): Result<Unit> = error("unsupported operation")
            override suspend fun signOut(expected: SessionIdentity?): Result<Unit> = error("unsupported operation")
            override suspend fun restore(): Result<Unit> = error("unsupported operation")
        }
        val model = SessionViewModel(ProductServices(MutableStateFlow(SessionSnapshot()), actions), this)
        model.linkSoop(); model.signOut(); model.restore()
        model.signIn(SignInProvider.APPLE)
        yield()
        assertFalse(model.state.value.busy)
        assertNull(model.state.value.error)
        model.signIn(SignInProvider.APPLE)
        yield()
        assertEquals(2, calls)
        assertFalse(model.state.value.busy)
    }
    @Test fun profileMonogramKeepsSupplementaryUnicodeScalarIntact() {
        assertEquals("😀", profileMonogram("😀 좋은 이름"))
        assertEquals("가", profileMonogram("가나다"))
        assertEquals("", profileMonogram(""))
    }

    @Test fun restoringSessionStartsOnceAndDoesNotLoopOnRecomposition() = runTest {
        var restores = 0
        val actions = object : SessionActions {
            override val providers = emptySet<SignInProvider>()
            override val canRestore = true
            override suspend fun signIn(provider: SignInProvider): Result<Unit> = error("unsupported")
            override suspend fun linkSoop(): Result<Unit> = error("unsupported")
            override suspend fun signOut(expected: SessionIdentity?): Result<Unit> = error("unsupported")
            override suspend fun restore(): Result<Unit> { restores++; return Result.success(Unit) }
        }
        val model = SessionViewModel(ProductServices(MutableStateFlow(SessionSnapshot(ShellAccess.RESTORING)), actions), backgroundScope)
        model.start(); model.start()
        runCurrent()
        assertEquals(1, restores)
        model.start()
        runCurrent()
        assertEquals(1, restores)
    }

}

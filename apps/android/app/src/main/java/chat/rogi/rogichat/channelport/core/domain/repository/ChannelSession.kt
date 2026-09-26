package chat.rogi.rogichat.channelport.core.domain.repository

import chat.rogi.rogichat.channelport.core.network.api.ApiClient
import chat.rogi.rogichat.core.session.SessionSnapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Numeric compatibility identity comes from Rogichat's authenticated /me. */
class ChannelSession(private val api: ApiClient, private val session: StateFlow<SessionSnapshot>, scope: CoroutineScope) {
    @Serializable data class User(val id: Int, val nickname: String, val isIdentityVerified: Boolean = false)
    private val loggedIn = MutableStateFlow(session.value.account != null)
    val isLoggedIn = loggedIn.asStateFlow()
    private val user = MutableStateFlow<User?>(null)
    val currentUser = user.asStateFlow()
    init {
        scope.launch {
            session.collectLatest {
                user.value = null
                loggedIn.value = it.account != null
                if (loggedIn.value) getCurrentUser()
            }
        }
    }
    suspend fun getCurrentUser(): Result<User?> {
        val identity = session.value
        if (identity.account == null) { user.value = null; return Result.success(null) }
        return try {
            val value = api.get<User>("/v1/user/me")
            if (identity.generation == session.value.generation && identity.account?.id == session.value.account?.id) user.value = value
            Result.success(user.value)
        } catch (e: CancellationException) { throw e }
        catch (e: Exception) { Result.failure(e) }
    }
}

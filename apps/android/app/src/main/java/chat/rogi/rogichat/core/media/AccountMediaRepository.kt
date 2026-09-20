package chat.rogi.rogichat.core.media

import chat.rogi.rogichat.core.network.*
import chat.rogi.rogichat.core.session.*
import chat.rogi.rogichat.feature.settings.UserProfile

class AccountMediaSession internal constructor(val client: MediaClient, val journal: MediaJournal, internal val permit: AccountFeaturePermit)
class AccountMediaRepository(private val gateway: AccountFeatureGateway, private val store: AccountFeatureStore) {
    suspend fun open(expected: SessionIdentity): AccountMediaSession {
        val permit = gateway.admitAccountFeature(expected)
        val scope = object : MediaScope {
            override val presentationID = permit.identity
            override val roomId: String? = null
            override fun check() = permit.check()
        }
        val client = MediaClient(MediaTransport { request, captured ->
            captured.check()
            val operation: suspend (NativeApi, String, () -> Unit) -> String = { api, token, gate ->
                gate(); api.media(token, request, scope)
            }
            val body = if (request.path == "me/profile" && request.method == "PATCH")
                gateway.accountProfileRequest(permit, operation)
            else gateway.accountFeatureRequest(permit, operation)
            captured.check(); body
        }, scope, chat.rogi.rogichat.BuildConfig.API_BASE_URL)
        val journal = object : MediaJournal {
            override suspend fun save(scope: MediaScope, pending: PendingMedia) {
                require(scope === client.scope); scope.check()
                gateway.accountFeatureCommit(permit) { validate -> store.accountMedia(permit.account, pending, validate) }
            }
            override suspend fun remove(scope: MediaScope, assetId: String) {
                require(scope === client.scope); scope.check()
                gateway.accountFeatureCommit(permit) { validate -> store.removeAccountMedia(permit.account, assetId, validate) }
            }
        }
        return AccountMediaSession(client, journal, permit)
    }
    suspend fun pending(session: AccountMediaSession) = gateway.accountFeatureCommit(session.permit) { validate -> store.accountMedia(session.permit.account, validate) }
    suspend fun profile(session: AccountMediaSession): UserProfile = gateway.accountFeatureRequest(session.permit) { api, token, _ ->
        NativeDtos.profile(api.get(ApiRoute.PROFILE, token)).also { require(it.id == session.permit.account.accountId) }
    }
}

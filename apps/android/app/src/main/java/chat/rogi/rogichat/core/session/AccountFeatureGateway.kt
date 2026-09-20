package chat.rogi.rogichat.core.session

import chat.rogi.rogichat.core.network.NativeApi
import chat.rogi.rogichat.core.network.NativeResponse
import chat.rogi.rogichat.core.rooms.RoomsAccountScope
import chat.rogi.rogichat.core.messageactions.*
import chat.rogi.rogichat.core.media.*

/** Original account capture for settings operations which intentionally outlive room membership. */
class AccountFeaturePermit internal constructor(val account: RoomsAccountScope, val identity: String,
    internal val handle: Any, private val validate: () -> Unit) { fun check() = validate() }
interface AccountFeatureGateway {
    suspend fun admitAccountFeature(expected: SessionIdentity): AccountFeaturePermit
    suspend fun <T> accountFeatureRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> T): T
    suspend fun <T> accountFeatureCommit(permit: AccountFeaturePermit, operation: suspend (() -> Unit) -> T): T
    suspend fun accountBlocksChanged(permit: AccountFeaturePermit)
    suspend fun accountProfileRequest(permit: AccountFeaturePermit, operation: suspend (NativeApi, String, () -> Unit) -> String): String
}
interface AccountFeatureStore {
    suspend fun prepareAccount(scope: RoomsAccountScope, binding: String, generation: String, validate: () -> Unit)
    suspend fun <T> blockTransaction(scope: RoomsAccountScope, validate: () -> Unit, operation: (BlockJournal, ActionJournal) -> T): T
    suspend fun accountMedia(scope: RoomsAccountScope, validate: () -> Unit): List<PendingMedia>
    suspend fun accountMedia(scope: RoomsAccountScope, pending: PendingMedia, validate: () -> Unit)
    suspend fun removeAccountMedia(scope: RoomsAccountScope, assetId: String, validate: () -> Unit)
}

package chat.rogi.rogichat.core.media

import kotlinx.coroutines.CancellationException

/** Existing scoped persistence supplies this journal; never persist signed URLs or credentials.
 * save/remove must commit under the same original scope, not the currently logged-in account. */
interface MediaJournal {
    suspend fun save(scope: MediaScope, pending: PendingMedia)
    suspend fun remove(scope: MediaScope, assetId: String)
}
data class PendingMedia(val assetId: String, val kind: MediaKind) { init { mediaId(assetId) } }
sealed interface MediaUploadState {
    data object Idle : MediaUploadState
    data object Reserving : MediaUploadState
    data class Uploading(val pending: PendingMedia) : MediaUploadState
    data class Processing(val pending: PendingMedia) : MediaUploadState
    data class Ready(val pending: PendingMedia, val receipt: MediaReceipt) : MediaUploadState
    data class Failed(val pending: PendingMedia?, val retryStatusOnly: Boolean) : MediaUploadState
    data object Cancelled : MediaUploadState
}
/** Serial operation owned by a lifecycle job. A lost upload response is recovered through status,
 * never a blind POST replay. Local scratch is deleted on success, error and cancellation. */
class MediaUpload(private val client: MediaClient, private val journal: MediaJournal) {
    var state: MediaUploadState = MediaUploadState.Idle; private set
    suspend fun start(file: MediaFile): MediaReceipt {
        check(state !is MediaUploadState.Reserving && state !is MediaUploadState.Uploading && state !is MediaUploadState.Processing)
        var pending: PendingMedia? = null
        try {
            client.scope.check(); state = MediaUploadState.Reserving
            val reservation = client.reserve(file)
            pending = PendingMedia(reservation.assetId, file.kind)
            journal.save(client.scope, pending); client.scope.check()
            state = MediaUploadState.Uploading(pending)
            client.upload(pending.assetId, file)
            state = MediaUploadState.Processing(pending)
            val receipt = client.awaitReady(pending.assetId)
            client.scope.check(); state = MediaUploadState.Ready(pending, receipt)
            return receipt
        } catch (error: CancellationException) { state = MediaUploadState.Cancelled; throw error }
        catch (error: Exception) { state = MediaUploadState.Failed(pending, pending != null); throw error }
        finally { file.close() }
    }
    suspend fun recover(pending: PendingMedia): MediaReceipt {
        check(state !is MediaUploadState.Reserving && state !is MediaUploadState.Uploading && state !is MediaUploadState.Processing)
        try {
            client.scope.check(); state = MediaUploadState.Processing(pending)
            val receipt = client.awaitReady(pending.assetId)
            client.scope.check(); state = MediaUploadState.Ready(pending, receipt); return receipt
        } catch (error: CancellationException) { state = MediaUploadState.Cancelled; throw error }
        catch (error: Exception) { state = MediaUploadState.Failed(pending, true); throw error }
    }
    /** Call only after server SEND/profile acknowledgement was persisted by its owning coordinator. */
    suspend fun acknowledged(assetId: String) { client.scope.check(); journal.remove(client.scope, mediaId(assetId)) }
}

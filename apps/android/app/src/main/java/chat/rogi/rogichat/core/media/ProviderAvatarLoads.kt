package chat.rogi.rogichat.core.media

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Semaphore

internal sealed interface ProviderAvatarState {
    data object Loading : ProviderAvatarState
    class Ready(val bytes: ByteArray, val lease: MediaLease) : ProviderAvatarState
    data object Failed : ProviderAvatarState
}

/** Memory-only, reference-counted work. Original scope + actor is the identity, never a URL.
 * The last subscriber cancels queued/active HTTP and drops bytes; expiry always fetches new bytes. */
internal class ProviderAvatarLoads(private val pollMillis: Long = 250) {
    companion object { val shared = ProviderAvatarLoads() }
    private data class Key(val scope: String, val actor: String?)
    private class Entry {
        val state = MutableStateFlow<ProviderAvatarState>(ProviderAvatarState.Loading)
        val retry = Channel<Unit>(Channel.CONFLATED)
        var readers = 0
        lateinit var job: Job
    }
    private val entries = mutableMapOf<Key, Entry>()
    private val transfers = Semaphore(2)
    fun observe(scope: MediaScope, actor: String?, load: suspend () -> ProviderAvatarState.Ready): Flow<ProviderAvatarState> = flow {
        scope.check()
        val key = Key(scope.presentationID, actor)
        val entry = synchronized(entries) {
            entries.getOrPut(key) {
                Entry().also { item ->
                    item.job = CoroutineScope(Dispatchers.Default).launch {
                        try {
                            while (true) {
                                try {
                                    scope.check(); item.state.value = ProviderAvatarState.Loading
                                    val deadline = System.nanoTime() + 15_000_000_000L
                                    while (true) {
                                        scope.check(); currentCoroutineContext().ensureActive()
                                        check(System.nanoTime() < deadline) { "provider_avatar_queue_timeout" }
                                        if (transfers.tryAcquire()) break
                                        delay(50)
                                    }
                                    val ready = try { scope.check(); load() } finally { transfers.release() }
                                    currentCoroutineContext().ensureActive(); ready.lease.checkedURL(scope)
                                    item.state.value = ready
                                    while (!ready.lease.needsRenewal()) { delay(pollMillis); ready.lease.checkedURL(scope) }
                                    // Do not carry an old source across a newly authorized ticket.
                                    item.state.value = ProviderAvatarState.Loading
                                } catch (error: CancellationException) { throw error }
                                catch (_: Exception) { item.state.value = ProviderAvatarState.Failed; item.retry.receive() }
                            }
                        } finally { item.state.value = ProviderAvatarState.Failed }
                    }
                }
            }.also { it.readers++ }
        }
        try { entry.state.collect { scope.check(); emit(it) } }
        finally {
            synchronized(entries) {
                if (--entry.readers == 0) {
                    entries.remove(key); entry.job.cancel(); entry.retry.close()
                    entry.state.value = ProviderAvatarState.Loading
                }
            }
        }
    }
    fun retry(scope: MediaScope, actor: String?) {
        scope.check()
        synchronized(entries) { entries[Key(scope.presentationID, actor)]?.let {
            if (it.state.value == ProviderAvatarState.Failed) it.retry.trySend(Unit)
        } }
    }
}

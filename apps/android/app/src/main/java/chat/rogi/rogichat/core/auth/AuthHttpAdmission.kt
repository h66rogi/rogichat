package chat.rogi.rogichat.core.auth

import java.time.Clock
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException

/** Linearization at the HTTP send interceptor, after dispatcher/engine preparation. */
internal class AuthHttpAdmission(private val clock: Clock, private val deadline: Instant, private val active: () -> Boolean) {
    private val used = AtomicBoolean(false)
    fun claim() {
        if (!active() || !clock.instant().isBefore(deadline) || !used.compareAndSet(false, true))
            throw CancellationException("auth_dispatch_invalidated")
    }
}

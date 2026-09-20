package chat.rogi.rogichat.core.common

import kotlinx.coroutines.CancellationException

internal suspend fun <T> request(block: suspend () -> Result<T>): Result<T> = try {
    block().also { if (it.exceptionOrNull() is CancellationException) throw it.exceptionOrNull()!! }
} catch (cancelled: CancellationException) { throw cancelled }
catch (_: Exception) { Result.failure(IllegalStateException("request_failed")) }

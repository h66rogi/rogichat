package chat.rogi.rogichat.core.identity

import java.util.UUID

object IdentityChecks {
    @JvmStatic fun main(args: Array<String>) {
        val attempt = IdentityAttempt()
        attempt.bind(IdentityScope("qa", UUID.randomUUID(), null))
        check(attempt.begin(IdentityIntent.LINK) == null)
        val cancelled = attempt.begin(IdentityIntent.LOGIN)!!
        attempt.cancel(); check(!attempt.consume(cancelled))
        val first = attempt.begin(IdentityIntent.LOGIN)!!; val second = attempt.begin(IdentityIntent.LOGIN)!!
        check(!attempt.consume(first) && attempt.consume(second) && !attempt.consume(second))
        attempt.bind(IdentityScope("qa", UUID.randomUUID(), "a"))
        check(attempt.begin(IdentityIntent.LOGIN) == null)
        val link = attempt.begin(IdentityIntent.LINK)!!
        attempt.bind(IdentityScope("qa", UUID.randomUUID(), "b"))
        attempt.bind(IdentityScope("qa", UUID.randomUUID(), "a"))
        check(!attempt.consume(link))
        println("Identity scope checks passed")
    }
}

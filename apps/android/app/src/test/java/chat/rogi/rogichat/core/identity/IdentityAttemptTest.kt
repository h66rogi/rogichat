package chat.rogi.rogichat.core.identity

import org.junit.Test

class IdentityAttemptTest {
    @Test fun cancelledAndSupersededIdentityCannotApply() { IdentityChecks.main(emptyArray()) }
}

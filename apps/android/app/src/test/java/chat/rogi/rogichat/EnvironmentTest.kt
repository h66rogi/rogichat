package chat.rogi.rogichat

import org.junit.Assert.assertEquals
import org.junit.Test

class EnvironmentTest {
    @Test
    fun compiledEnvironmentMatchesApplicationIdentity() {
        val expected = when (BuildConfig.APPLICATION_ID) {
            "chat.rogi.rogichat.qa" -> "qa" to "https://api.qa.rogi.chat/v1/"
            "chat.rogi.rogichat" -> "prod" to "https://api.rogi.chat/v1/"
            else -> error("Unrecognized application identity")
        }
        assertEquals(expected.first, BuildConfig.ENVIRONMENT)
        assertEquals(expected.second, BuildConfig.API_BASE_URL)
    }
}

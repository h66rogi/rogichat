package chat.rogi.rogichat.core.identity

import chat.rogi.rogichat.core.auth.AuthProof
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64
import kotlinx.serialization.json.*

class AppleIdentityContractTest {
    private val state = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 1 })
    private val verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 2 })
    private val contract = AppleIdentityContract("qa")
    @Test fun loginAndLinkHaveDistinctConsentBodies() {
        val proof = AuthProof(verifier, state)
        val login = Json.parseToJsonElement(contract.startBody(IdentityIntent.LOGIN, proof)).jsonObject
        val link = Json.parseToJsonElement(contract.startBody(IdentityIntent.LINK, proof)).jsonObject
        assertFalse(login.containsKey("termsVersion"))
        assertFalse(login.containsKey("codeChallengeMethod"))
        assertFalse(link.containsKey("termsVersion"))
    }
    @Test fun callbackRejectsReplayContextAndForeignRoutes() {
        val base = "https://qa.rogi.chat/mobile/auth/complete"
        assertNotNull(contract.callback("$base?code=$verifier&state=$state", state).code)
        assertTrue(contract.callback("$base?error=AUTH_FAILED&state=$state", state).failed)
        for (url in listOf("$base?code=$verifier&state=$verifier", "$base?code=$verifier&state=$state&state=$state",
            "https://rogi.chat/mobile/auth/complete?code=$verifier&state=$state", "$base?accessToken=$verifier&state=$state")) {
            assertThrows(IllegalArgumentException::class.java) { contract.callback(url, state) }
        }
    }
}

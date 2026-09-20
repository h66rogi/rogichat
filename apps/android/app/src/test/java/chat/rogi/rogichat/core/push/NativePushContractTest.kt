package chat.rogi.rogichat.core.push

import java.util.Base64
import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.*

class NativePushContractTest {
    @Test fun registrationIsNativeAndDoesNotOptIn() {
        val installation = NativePushInstallation("00000000-0000-4000-8000-000000000001",
            Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 1 }))
        val body = Json.parseToJsonElement(NativePushContract.register(installation, DevicePushToken("test-only-fcm-value"), null)).jsonObject
        assertEquals(JsonPrimitive("FCM"), body["provider"])
        assertFalse(body.containsKey("pushEnabled")); assertFalse(body.containsKey("generation"))
        assertNull(NativePushContract.binding("{\"binding\":null}"))
        assertThrows(NoSuchElementException::class.java) { NativePushContract.binding("{}") }
        assertThrows(IllegalArgumentException::class.java) { NativePushGeneration("18446744073709551616") }
        assertThrows(IllegalArgumentException::class.java) { NativePushGeneration("0") }
        assertEquals("18446744073709551615", NativePushGeneration("18446744073709551615").value)
        assertThrows(IllegalArgumentException::class.java) { NativePushContract.available("{\"provider\":\"APNS\",\"available\":true}") }
    }
}

package chat.rogi.rogichat.core.realtime

import org.junit.Test

class RealtimeManagerTest {
    @Test fun scopeBoundRealtimeCallbacks() { RealtimeChecks.main(emptyArray()) }
    @Test fun sdkAuthKeepsNumericSchema() { RealtimeSDKChecks.main(emptyArray()) }
}

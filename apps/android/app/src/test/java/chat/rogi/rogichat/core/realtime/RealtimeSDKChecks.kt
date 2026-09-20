package chat.rogi.rogichat.core.realtime

import java.util.UUID
import org.json.JSONObject

object RealtimeSDKChecks {
    @JvmStatic fun main(args: Array<String>) {
        val scope = RealtimeScope("qa", "test-account", "test-generation", UUID.randomUUID())
        val auth = JSONObject(nativeSocketAuth(RealtimeConnectionOptions(scope, "A".repeat(43))))
        check(auth.length() == 2 && auth.get("schemaVersion") is Int && auth.get("schemaVersion") == 1)
        check(auth.get("transport") == "native")
        println("Socket.IO SDK auth preserves numeric schemaVersion")
    }
}

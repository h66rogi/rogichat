package chat.rogi.rogichat

import android.os.Bundle
import android.content.Intent
import chat.rogi.rogichat.core.session.ProductServices
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf

class MainActivity : ComponentActivity() {
    private var notificationTap by mutableIntStateOf(0)
    private var notificationTarget by mutableStateOf<Pair<String, String>?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleAuthCallback(intent)
        if (intent?.getBooleanExtra("open_notifications", false) == true) {
            notificationTarget = readNotificationTarget(intent)
            notificationTap++
            intent.removeExtra("open_notifications")
        }
        setContent { AppEntry(notificationTap = notificationTap, notificationTarget = notificationTarget,
            onNotificationTapConsumed = { seen -> if (notificationTap == seen) { notificationTap = 0; notificationTarget = null } }) }
    }
    // Reuses Meloming MainActivity's cold/warm intent entry and immediate URI removal.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthCallback(intent)
        if (intent.getBooleanExtra("open_notifications", false)) {
            notificationTarget = readNotificationTarget(intent)
            notificationTap++
            intent.removeExtra("open_notifications")
        }
    }
    private fun readNotificationTarget(intent: Intent): Pair<String, String>? {
        val room = intent.getStringExtra("target_room_id")
        val message = intent.getStringExtra("target_message_id")
        intent.removeExtra("target_room_id"); intent.removeExtra("target_message_id")
        val id = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
        return if (room != null && message != null && id.matches(room) && id.matches(message)) room to message else null
    }
    private fun handleAuthCallback(intent: Intent?) {
        val uri = intent?.data ?: return
        intent.data = null
        if (intent.action == Intent.ACTION_VIEW) ProductServices.installed(applicationContext).receiveAuthCallback(uri.toString())
    }
}

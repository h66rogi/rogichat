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

class MainActivity : ComponentActivity() {
    private var notificationTap by mutableIntStateOf(0)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleAuthCallback(intent)
        if (intent?.getBooleanExtra("open_notifications", false) == true) {
            notificationTap++
            intent.removeExtra("open_notifications")
        }
        setContent { AppEntry(notificationTap = notificationTap, onNotificationTapConsumed = { notificationTap = 0 }) }
    }
    // Reuses Meloming MainActivity's cold/warm intent entry and immediate URI removal.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthCallback(intent)
        if (intent.getBooleanExtra("open_notifications", false)) {
            notificationTap++
            intent.removeExtra("open_notifications")
        }
    }
    private fun handleAuthCallback(intent: Intent?) {
        val uri = intent?.data ?: return
        intent.data = null
        if (intent.action == Intent.ACTION_VIEW) ProductServices.installed(applicationContext).receiveAuthCallback(uri.toString())
    }
}

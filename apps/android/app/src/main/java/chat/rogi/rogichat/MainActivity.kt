package chat.rogi.rogichat

import android.os.Bundle
import android.content.Intent
import chat.rogi.rogichat.core.session.ProductServices
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleAuthCallback(intent)
        setContent { AppEntry() }
    }
    // Reuses Meloming MainActivity's cold/warm intent entry and immediate URI removal.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAuthCallback(intent)
    }
    private fun handleAuthCallback(intent: Intent?) {
        val uri = intent?.data ?: return
        intent.data = null
        if (intent.action == Intent.ACTION_VIEW) ProductServices.installed(applicationContext).receiveAuthCallback(uri.toString())
    }
}

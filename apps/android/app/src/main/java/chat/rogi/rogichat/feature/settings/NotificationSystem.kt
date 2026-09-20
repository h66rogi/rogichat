package chat.rogi.rogichat.feature.settings

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.Settings

// Device adapters have no provider, account or server-preference responsibility.
internal class NotificationSystem(private val context: Context) {
    fun read(): NotificationSnapshot {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channels = manager.notificationChannels
        return NotificationSnapshot(
            if (manager.areNotificationsEnabled()) NotificationAuthorization.ALLOWED else NotificationAuthorization.DENIED,
            blockedChannels = channels.count { it.importance == NotificationManager.IMPORTANCE_NONE },
            hasChannels = channels.isNotEmpty())
    }
    fun openSettings() {
        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
    }
}

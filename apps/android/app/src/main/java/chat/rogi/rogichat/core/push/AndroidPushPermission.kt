package chat.rogi.rogichat.core.push

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/** Adapted Meloming checkPermissionStatus/onPermissionResult; app-wide disable applies on all OS versions. */
class AndroidPushPermission(context: Context) {
    private val context = context.applicationContext
    private val preferences = this.context.getSharedPreferences("notification_permission", Context.MODE_PRIVATE)
    fun current(): PushPermission {
        val notifications = context.getSystemService(NotificationManager::class.java)
            ?: return PushPermission.UNKNOWN
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return if (preferences.getBoolean("requested", false)) PushPermission.DENIED else PushPermission.NOT_DETERMINED
        }
        return if (notifications.areNotificationsEnabled()) PushPermission.AUTHORIZED else PushPermission.DENIED
    }
    // OS writer invokes immediately before ActivityResult launch; actual OS state wins over callback Boolean.
    fun willRequest() { preferences.edit().putBoolean("requested", true).apply() }
    fun onPermissionResult(): PushPermission = current()
}

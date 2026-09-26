package chat.rogi.rogichat.core.push

import android.content.Context
import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import chat.rogi.rogichat.R
import chat.rogi.rogichat.MainActivity
import chat.rogi.rogichat.core.session.ProductServices
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

interface DevicePushProvider {
    val available: Boolean
    suspend fun token(): DevicePushToken
}
/** Reuses Meloming provider-token refresh responsibilities, without automatic enrollment/logging.
 * Real per-environment Firebase SDK values are generated from a private release input. */
class FirebasePushProvider(context: Context) : DevicePushProvider {
    private val context = context.applicationContext
    override val available get() = context.getString(R.string.rogi_firebase_application_id).isNotEmpty()
    private fun messaging(): FirebaseMessaging {
        check(available) { "push_configuration_unavailable" }
        synchronized(FirebasePushProvider::class.java) {
            if (FirebaseApp.getApps(context).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
                FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
                    .setApplicationId(context.getString(R.string.rogi_firebase_application_id))
                    .setApiKey(context.getString(R.string.rogi_firebase_api_key))
                    .setProjectId(context.getString(R.string.rogi_firebase_project_id))
                    .setGcmSenderId(context.getString(R.string.rogi_firebase_sender_id)).build())
            }
        }
        return FirebaseMessaging.getInstance().also { it.isAutoInitEnabled = false; it.setDeliveryMetricsExportToBigQuery(false) }
    }
    override suspend fun token(): DevicePushToken = suspendCancellableCoroutine { continuation ->
        try { messaging().token.addOnCompleteListener { task ->
            if (!continuation.isActive) return@addOnCompleteListener
            if (task.isSuccessful) try { continuation.resume(DevicePushToken(requireNotNull(task.result))) }
                catch (_: Exception) { continuation.resumeWithException(IllegalStateException("push_token_unavailable")) }
            else continuation.resumeWithException(IllegalStateException("push_token_unavailable"))
        } } catch (_: Exception) { if (continuation.isActive) continuation.resumeWithException(IllegalStateException("push_provider_unavailable")) }
    }
}
/** Data-only wake. A tap target is reauthorized by the app before it opens. */
class RogichatMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { ProductServices.installed(applicationContext).push?.tokenChanged() }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification == null && NativePushWake.accepts(message.data)) {
            ProductServices.installed(applicationContext).receiveSyncWake()
            showNotification(NativePushWake.target(message.data))
        }
    }
    private fun showNotification(target: Pair<String, String>?) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = "rogichat_messages"
        manager.createNotificationChannel(NotificationChannel(channel, "새 메시지", NotificationManager.IMPORTANCE_DEFAULT))
        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            action = target?.second?.let { "chat.rogi.rogichat.OPEN_MESSAGE.$it" } ?: "chat.rogi.rogichat.OPEN_NOTIFICATIONS"
            putExtra("open_notifications", true)
            if (target != null) { putExtra("target_room_id", target.first); putExtra("target_message_id", target.second) }
        }
        val pending = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("로기챗")
            .setContentText("확인할 내용이 있는지 로기챗에서 확인해 주세요.")
            .setContentIntent(pending).setAutoCancel(true).build()
        manager.notify(target?.second ?: "rogichat-sync", 1, notification)
    }
}

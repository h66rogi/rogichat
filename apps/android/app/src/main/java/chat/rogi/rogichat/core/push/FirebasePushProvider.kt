package chat.rogi.rogichat.core.push

import android.content.Context
import chat.rogi.rogichat.R
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
/** Data-only wake. No payload becomes a user/message, route, read receipt or notification body. */
class RogichatMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { ProductServices.installed(applicationContext).push?.tokenChanged() }
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification == null && NativePushWake.accepts(message.data)) ProductServices.installed(applicationContext).receiveSyncWake()
    }
}

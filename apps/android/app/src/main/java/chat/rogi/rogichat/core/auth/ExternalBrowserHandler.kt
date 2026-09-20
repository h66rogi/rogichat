package chat.rogi.rogichat.core.auth

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsClient

/** Meloming ExternalBrowserHandler Custom Tabs implementation, narrowed for native authentication.
 * The caller validates the exact API launch or rules URL. Never read browser cookies or log URLs.
 */
object ExternalBrowserHandler {
    fun openUrl(context: Context, url: String): Boolean { return try {
        val browser = CustomTabsClient.getPackageName(context, null) ?: return false
        val tabs = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
            .build()
        tabs.intent.setPackage(browser)
        tabs.intent.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY)
        tabs.launchUrl(context, url.toUri())
        true
    } catch (_: Exception) {
        false // No alternate scheme, WebView, or broker URL fallback.
    } }
}

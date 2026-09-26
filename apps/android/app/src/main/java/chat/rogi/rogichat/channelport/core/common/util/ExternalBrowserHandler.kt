package chat.rogi.rogichat.channelport.core.common.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import androidx.browser.customtabs.CustomTabsIntent
import timber.log.Timber

/**
 * 스마트 외부 브라우저 핸들러
 *
 * 특정 스트리밍 플랫폼 도메인은 외부 앱/브라우저로 열고,
 * 그 외의 URL은 Chrome Custom Tabs로 앱 내에서 열기
 */
object ExternalBrowserHandler {

    /**
     * 외부 앱/브라우저로 열어야 하는 도메인 목록
     * (스트리밍 플랫폼은 네이티브 앱에서 열면 더 좋은 UX 제공)
     */
    private val EXTERNAL_DOMAINS = setOf(
        "chzzk.naver.com",      // 치지직
        "afreecatv.com",        // 아프리카TV
        "twitch.tv",            // 트위치
        "kick.com",             // 킥
        "www.twitch.tv",
        "www.afreecatv.com",
        "m.afreecatv.com",
    )

    /**
     * URL을 열기
     *
     * @param context Context
     * @param url 열 URL
     */
    fun openUrl(context: Context, url: String) {
        try {
            val uri = url.toUri()
            if (shouldOpenExternally(uri)) {
                openInExternalBrowser(context, uri)
            } else {
                openInCustomTabs(context, uri)
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to open URL: $url")
            // Fallback: 기본 브라우저로 열기
            try {
                val intent = Intent(Intent.ACTION_VIEW, url.toUri())
                context.startActivity(intent)
            } catch (e2: Exception) {
                Timber.e(e2, "Failed to open URL in fallback browser")
            }
        }
    }

    /**
     * 해당 URL이 외부 앱/브라우저로 열어야 하는지 확인
     */
    fun shouldOpenExternally(url: String): Boolean {
        return try {
            shouldOpenExternally(url.toUri())
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 해당 URI가 외부 앱/브라우저로 열어야 하는지 확인
     */
    fun shouldOpenExternally(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        return EXTERNAL_DOMAINS.any { domain ->
            host == domain || host.endsWith(".$domain")
        }
    }

    /**
     * 외부 앱/브라우저에서 열기
     */
    private fun openInExternalBrowser(context: Context, uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    /**
     * Chrome Custom Tabs에서 열기 (앱 내 브라우저)
     */
    private fun openInCustomTabs(context: Context, uri: Uri) {
        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .setShareState(CustomTabsIntent.SHARE_STATE_ON)
            .build()

        customTabsIntent.launchUrl(context, uri)
    }
}

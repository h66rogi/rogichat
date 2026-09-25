package chat.rogi.rogichat.feature.channel

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.BuildConfig
import chat.rogi.rogichat.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

// Meloming's ChannelProfileHero uses ProfileImage/Coil. The existing Rogichat app
// has no Coil dependency, so this bounded public image adapter preserves its UI.
@Composable
internal fun ChannelAvatar(channel: Channel) {
    if (channel.profileImageUrl == "/images/h66rogi-profile.png") {
        Image(painterResource(R.drawable.h66rogi_profile), contentDescription = channel.name,
            modifier = Modifier.size(76.dp).clip(CircleShape), contentScale = ContentScale.Crop)
    } else ChannelRemoteImage(channel.profileImageUrl, channel.name.take(1), 76.dp, Modifier.clip(CircleShape))
}

@Composable
internal fun ChannelRemoteImage(url: String?, fallback: String, size: Dp, modifier: Modifier = Modifier) {
    val bitmap by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, url) {
        value = withContext(Dispatchers.IO) { loadChannelBitmap(url) }
    }
    Box(modifier.size(size).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(requireNotNull(bitmap), contentDescription = fallback,
            modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(fallback, style = MaterialTheme.typography.titleMedium)
    }
}

private fun loadChannelBitmap(value: String?): androidx.compose.ui.graphics.ImageBitmap? {
    val address = when {
        value == null -> return null
        value.startsWith("/") -> (if (BuildConfig.ENVIRONMENT == "qa") "https://qa.rogi.chat" else "https://rogi.chat") + value
        else -> value
    }
    val url = runCatching { URL(address) }.getOrNull() ?: return null
    if (url.protocol != "https") return null
    return runCatching {
        val connection = (url.openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 5_000
            readTimeout = 8_000
        }
        try {
            if (connection.responseCode != 200 || connection.contentLengthLong > 3_000_000) return null
            val bytes = connection.inputStream.use { input -> input.readNBytes(3_000_001) }
            if (bytes.size > 3_000_000) return null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
            val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 512) }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
        } finally { connection.disconnect() }
    }.getOrNull()
}

package chat.rogi.rogichat.feature.channel

import chat.rogi.rogichat.BuildConfig

internal val channelWebOrigin: String get() = if (BuildConfig.ENVIRONMENT == "qa") "https://qa.rogi.chat" else "https://rogi.chat"
internal fun channelImageUrl(value: String?): String? = value?.let {
    if (it.startsWith("/") && !it.startsWith("//")) channelWebOrigin + it else it
}

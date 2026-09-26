package chat.rogi.rogichat.feature.channel.component

import chat.rogi.rogichat.feature.channel.channelImageUrl
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import chat.rogi.rogichat.channelport.core.model.channel.ChannelWardrobeItem
import chat.rogi.rogichat.feature.channel.ChannelWardrobeState

/** Native, one-page channel sections. Each entry is deliberately content-first so it can sit
 * directly below the Instagram-style section rail without another page title. */
fun LazyListScope.channelWardrobeTabContent(state: ChannelWardrobeState) {
    item(key = "wardrobe_top_space") { Spacer(Modifier.height(12.dp)) }
    if (state.isLoading) {
        item(key = "wardrobe_loading") {
            Text("옷장을 불러오는 중…", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else if (state.items.isEmpty()) {
        item(key = "wardrobe_empty") {
            Text(
                state.error ?: "아직 공개된 옷장이 없어요.",
                Modifier.padding(20.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } else {
        items(state.items.chunked(3), key = { row -> "wardrobe_${row.first().id}" }) { row ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 2.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                row.forEach { item -> WardrobeTile(item, Modifier.weight(1f)) }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f).aspectRatio(1f)) }
            }
        }
    }
    item(key = "wardrobe_bottom_space") { Spacer(Modifier.height(28.dp)) }
}

@Composable
private fun WardrobeTile(item: ChannelWardrobeItem, modifier: Modifier = Modifier) {
    Box(modifier = modifier.aspectRatio(1f).clip(RoundedCornerShape(2.dp)).background(Color(0xFFEAE8E4))) {
        AsyncImage(
            model = chat.rogi.rogichat.feature.channel.channelImageUrl(item.imageUrl),
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.matchParentSize(),
        )
        Text(
            text = item.title,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.34f))
                .padding(horizontal = 7.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

package chat.rogi.rogichat.channelport.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.MusicNote
import com.adamglin.phosphoricons.fill.User
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage

@Composable
fun MelomingAsyncImage(
    imageUrl: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    AsyncImage(
        model = chat.rogi.rogichat.feature.channel.channelImageUrl(imageUrl),
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
    )
}

@Composable
fun ProfileImage(
    imageUrl: String?,
    modifier: Modifier = Modifier,
    size: Dp = 80.dp,
    shape: Shape = CircleShape,
    borderColor: Color? = null,
    borderWidth: Dp = 2.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .then(
                if (borderColor != null) {
                    Modifier.border(borderWidth, borderColor, shape)
                } else {
                    Modifier
                }
            )
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (imageUrl.isNullOrEmpty()) {
            Icon(
                imageVector = PhosphorIcons.Fill.User,
                contentDescription = null,
                modifier = Modifier.size(size * 0.5f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            MelomingAsyncImage(
                imageUrl = imageUrl,
                contentDescription = null,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

@Composable
fun AlbumArtImage(
    imageUrl: String?,
    modifier: Modifier = Modifier,
    size: Dp = 60.dp,
    shape: Shape = MaterialTheme.shapes.small,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (imageUrl.isNullOrEmpty()) {
            Icon(
                imageVector = PhosphorIcons.Fill.MusicNote,
                contentDescription = null,
                modifier = Modifier.size(size * 0.4f),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            MelomingAsyncImage(
                imageUrl = imageUrl,
                contentDescription = null,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}


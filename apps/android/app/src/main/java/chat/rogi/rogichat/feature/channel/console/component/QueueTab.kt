package chat.rogi.rogichat.feature.channel.console.component

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.core.model.song.ConsoleSongRequest

@Composable
fun QueueTab(
    queue: List<ConsoleSongRequest>,
    onPlayNow: (Int) -> Unit,
    onMoveUp: (requestId: Int, newOrder: Int) -> Unit,
    onMoveDown: (requestId: Int, newOrder: Int) -> Unit,
    onDelete: (Int) -> Unit,
    onClearQueue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (queue.isEmpty()) {
        Box(
            modifier = modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "대기열이 비어있습니다",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    } else {
        LazyColumn(
            modifier = modifier.fillMaxSize(),
        ) {
            itemsIndexed(
                items = queue,
                key = { _, item -> item.id },
            ) { index, item ->
                QueueItemRow(
                    item = item,
                    index = index,
                    totalCount = queue.size,
                    onMoveUp = {
                        if (index > 0) {
                            onMoveUp(item.id, queue[index - 1].queueOrder)
                        }
                    },
                    onMoveDown = {
                        if (index < queue.size - 1) {
                            onMoveDown(item.id, queue[index + 1].queueOrder)
                        }
                    },
                    onPlayNow = { onPlayNow(item.id) },
                    onDelete = { onDelete(item.id) },
                )
                if (index < queue.size - 1) {
                    HorizontalDivider(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
                    )
                }
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onClearQueue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text(
                        text = "전체 초기화",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Spacer(modifier = Modifier.height(80.dp))
            }
        }
    }
}

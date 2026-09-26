package chat.rogi.rogichat.feature.channel.console.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import chat.rogi.rogichat.channelport.core.model.song.Song
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualAddSheet(
    onDismiss: () -> Unit,
    onSubmit: (rawArtist: String, rawTitle: String, rawMessage: String?) -> Unit,
    onSubmitWithSongId: (rawArtist: String, rawTitle: String, songId: Int, rawMessage: String?) -> Unit,
    onSearchSongs: suspend (query: String) -> List<Song>,
    modifier: Modifier = Modifier,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedTab by remember { mutableIntStateOf(0) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .navigationBarsPadding(),
        ) {
            Text(
                text = "곡 추가",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 16.dp),
            )

            TabRow(selectedTabIndex = selectedTab) {
                Tab(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    text = { Text("노래책 검색") },
                )
                Tab(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    text = { Text("직접 입력") },
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            when (selectedTab) {
                0 -> SongSearchContent(
                    onSearchSongs = onSearchSongs,
                    onSongSelected = { song ->
                        onSubmitWithSongId(
                            song.artist?.name ?: "",
                            song.title,
                            song.id,
                            null,
                        )
                    },
                )
                1 -> ManualInputContent(onSubmit = onSubmit)
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@OptIn(FlowPreview::class)
@Composable
private fun SongSearchContent(
    onSearchSongs: suspend (query: String) -> List<Song>,
    onSongSelected: (Song) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        var searchQuery by remember { mutableStateOf("") }
        var searchResults by remember { mutableStateOf<List<Song>>(emptyList()) }
        var isSearching by remember { mutableStateOf(false) }
        var hasSearched by remember { mutableStateOf(false) }

        LaunchedEffect(Unit) {
            snapshotFlow { searchQuery }
                .distinctUntilChanged()
                .debounce(400)
                .filter { it.isNotBlank() }
                .collectLatest { query ->
                    isSearching = true
                    searchResults = onSearchSongs(query)
                    isSearching = false
                    hasSearched = true
                }
        }

        // Clear results when query is cleared
        LaunchedEffect(searchQuery) {
            if (searchQuery.isBlank()) {
                searchResults = emptyList()
                hasSearched = false
            }
        }

        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("곡명 또는 아티스트 검색") },
            singleLine = true,
        )

        Spacer(modifier = Modifier.height(12.dp))

        when {
            isSearching -> {
                Spacer(modifier = Modifier.height(24.dp))
                CircularProgressIndicator(modifier = Modifier.size(32.dp))
                Spacer(modifier = Modifier.height(24.dp))
            }
            searchResults.isNotEmpty() -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 400.dp),
                ) {
                    items(
                        items = searchResults,
                        key = { it.id },
                    ) { song ->
                        SongSearchItem(
                            song = song,
                            onClick = { onSongSelected(song) },
                        )
                    }
                }
            }
            hasSearched && searchQuery.isNotBlank() -> {
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = "검색 결과가 없습니다",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(24.dp))
            }
            else -> {
                Spacer(modifier = Modifier.height(24.dp))
                Text(
                    text = "노래책에서 곡을 검색하세요",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun SongSearchItem(
    song: Song,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!song.albumArt.isNullOrBlank()) {
                AsyncImage(
                    model = chat.rogi.rogichat.feature.channel.channelImageUrl(song.albumArt),
                    contentDescription = null,
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(6.dp)),
                    contentScale = ContentScale.Crop,
                )
                Spacer(modifier = Modifier.width(12.dp))
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = song.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                song.artist?.name?.let { artistName ->
                    Text(
                        text = artistName,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
    }
}

@Composable
private fun ManualInputContent(
    onSubmit: (rawArtist: String, rawTitle: String, rawMessage: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var artist by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }

    Column(
        modifier = modifier.fillMaxWidth(),
    ) {
        OutlinedTextField(
            value = artist,
            onValueChange = { artist = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("아티스트") },
            singleLine = true,
        )

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("곡 제목") },
            singleLine = true,
        )

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = message,
            onValueChange = { message = it },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("메시지 (선택)") },
            singleLine = true,
        )

        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = {
                onSubmit(
                    artist,
                    title,
                    message.ifBlank { null },
                )
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = artist.isNotBlank() && title.isNotBlank(),
        ) {
            Text("추가하기")
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

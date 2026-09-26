package chat.rogi.rogichat.feature.channel

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.feature.channel.theme.ChannelTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Adapted from meloming-android ecb3dbed ChannelDetailScreen.kt tab composition.
// ProfileHero, SectionRail, SongItem and ScheduleItem are copied into sibling files.
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ChannelDetailScreen(model: ChannelDetailViewModel, onTalk: () -> Unit) {
    ChannelTheme { ChannelDetailContent(model, onTalk) }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ChannelDetailContent(model: ChannelDetailViewModel, onTalk: () -> Unit) {
    val state by model.uiState.collectAsStateWithLifecycle()
    var selectedSong by remember { mutableStateOf<Song?>(null) }
    var selectedSchedule by remember { mutableStateOf<Schedule?>(null) }
    var selectedWardrobe by remember { mutableStateOf<ChannelWardrobeItem?>(null) }
    var showSongFilters by remember { mutableStateOf(false) }
    var draftArtist by remember { mutableStateOf<Artist?>(null) }
    var draftDifficulty by remember { mutableStateOf<Int?>(null) }

    if (state.isLoading && state.channel == null) {
        ScreenStatus("채널을 불러오는 중", "잠시만 기다려 주세요.", loading = true)
        return
    }
    if (state.channel == null) {
        ScreenStatus("채널을 불러올 수 없어요", state.error ?: "잠시 후 다시 시도해 주세요.", onRetry = model::refresh)
        return
    }
    val channel = requireNotNull(state.channel)
    LazyColumn(Modifier.fillMaxSize()) {
        item("profile") { ChannelProfileHero(channel, state.profile, onTalk) }
        stickyHeader("tabs") {
            if (state.visibleTabs.isNotEmpty()) Surface(color = MaterialTheme.colorScheme.surface) {
                ChannelSectionRail(state.visibleTabs, state.selectedTab, MaterialTheme.colorScheme.primary,
                    model::selectTab, state.tabLabels)
            }
        }
        if (state.visibleTabs.isEmpty()) {
            item { ScreenStatus("표시할 채널 메뉴가 없어요", "") }
        } else {
            when (state.selectedTab) {
                ChannelTab.HOME -> {
                    if (state.sectionLoading && state.songs.isEmpty() && state.schedules.isEmpty()) item { SectionLoading() }
                    else if (state.sectionError != null && state.songs.isEmpty() && state.schedules.isEmpty()) item {
                        SectionError("채널 홈을 불러올 수 없어요", state.sectionError.orEmpty(), model::retrySection)
                    } else channelHomeTabContent(state, model::selectTab, model::retrySection)
                }
                ChannelTab.SONGBOOK -> {
                    item("song_search") {
                        Column {
                            Spacer(Modifier.height(16.dp))
                            ChannelSearchBar(query = state.songSearch, onQueryChange = model::searchSongs,
                                onSearch = {}, onClear = { model.searchSongs("") }, placeholder = "곡 검색",
                                modifier = Modifier.padding(horizontal = 16.dp))
                            Spacer(Modifier.height(12.dp))
                        }
                    }
                    item("song_filters") {
                        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            SongbookFilterChip(
                                hasActiveFilters = state.selectedArtist != null || state.selectedDifficulty != null,
                                activeFilterCount = listOfNotNull(state.selectedArtist, state.selectedDifficulty).size,
                                onClick = {
                                    draftArtist = state.selectedArtist
                                    draftDifficulty = state.selectedDifficulty
                                    showSongFilters = true
                                },
                            )
                            CategoryChip("전체", state.selectedSongCategory == null) { model.selectSongCategory(null) }
                            state.categories.forEach { category ->
                                CategoryChip(category.name, state.selectedSongCategory == category.id,
                                    category.color) { model.selectSongCategory(category.id) }
                            }
                        }
                    }
                    if (state.sectionLoading && state.songs.isEmpty()) item { SectionLoading() }
                    else if (state.sectionError != null && state.songs.isEmpty()) item {
                        SectionError("노래책을 불러올 수 없어요", state.sectionError.orEmpty(), model::retrySection)
                    }
                    else if (state.songs.isEmpty()) item("songbook_empty") {
                        Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                            Text(if (state.songSearch.isNotEmpty()) "'${state.songSearch}'에 대한 결과가 없습니다"
                                else "등록된 곡이 없습니다",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    else items(state.songs, key = { "song_${it.id}" }) { song ->
                        SongItem(song) { selectedSong = song }
                        HorizontalDivider(Modifier.padding(start = 84.dp))
                    }
                    if (state.songs.isNotEmpty() && state.songs.size < state.songTotal) item("songs_more") {
                        TextButton(onClick = model::loadMoreSongs, enabled = !state.sectionLoading,
                            modifier = Modifier.fillMaxWidth()) { Text(if (state.sectionLoading) "불러오는 중" else "노래 더 보기") }
                    }
                }
                ChannelTab.SCHEDULE -> channelScheduleTabContent(
                    state,
                    onPreviousMonth = { model.moveMonth(-1) },
                    onNextMonth = { model.moveMonth(1) },
                    onScheduleClick = { selectedSchedule = it },
                    onRetry = model::retrySection,
                )
                ChannelTab.SETLIST -> {
                    if (state.sectionLoading && state.setlists.isEmpty()) item { SectionLoading() }
                    else if (state.sectionError != null && state.setlists.isEmpty()) item {
                        SectionError("셋리스트를 불러올 수 없어요", state.sectionError.orEmpty(), model::retrySection)
                    }
                    else if (state.setlists.isEmpty()) item { ScreenStatus("공개된 셋리스트가 없어요", "") }
                    else items(state.setlists, key = { "setlist_${it.sessionId}" }) { setlist ->
                        Row(Modifier.fillMaxWidth().clickable { model.openSetlist(setlist.sessionId) }
                            .padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(setlist.startedAt.take(10), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                            Text("${setlist.completedCount}곡", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        HorizontalDivider()
                    }
                }
                ChannelTab.WARDROBE -> {
                    item("wardrobe_categories") {
                        if (state.wardrobe.categories.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(state.selectedCategory == null, onClick = { model.selectCategory(null) }, label = { Text("전체") })
                            state.wardrobe.categories.filter { it.isEnabled }.take(3).forEach { category ->
                                FilterChip(state.selectedCategory == category.id, onClick = { model.selectCategory(category.id) },
                                    label = { Text(category.name) })
                            }
                        }
                    }
                    val visible = state.wardrobe.items.filter { it.isVisible &&
                        (state.selectedCategory == null || it.categoryId == state.selectedCategory) }
                    if (state.sectionLoading && visible.isEmpty()) item { SectionLoading() }
                    else if (state.sectionError != null && visible.isEmpty()) item {
                        SectionError("옷장을 불러올 수 없어요", state.sectionError.orEmpty(), model::retrySection)
                    }
                    else if (visible.isEmpty()) item { ScreenStatus("등록된 옷장이 없어요", "") }
                    else items(visible.chunked(3), key = { "wardrobe_${it.first().id}" }) { row ->
                        Row(Modifier.fillMaxWidth().padding(2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            row.forEach { item -> WardrobeTile(item, Modifier.weight(1f)) { selectedWardrobe = item } }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f).aspectRatio(1f)) }
                        }
                    }
                }
            }
        }
        item("bottom") { Spacer(Modifier.height(28.dp)) }
    }

    if (showSongFilters) FilterBottomSheet(
        artists = state.artists,
        selectedArtist = draftArtist,
        selectedDifficulty = draftDifficulty,
        onArtistSelected = { draftArtist = it },
        onDifficultySelected = { draftDifficulty = it },
        onClearFilters = { draftArtist = null; draftDifficulty = null },
        onApply = { model.applySongFilters(draftArtist, draftDifficulty); showSongFilters = false },
        onDismiss = { showSongFilters = false },
    )

    selectedSong?.let { song ->
        ChannelSongDetailBottomSheet(song = song, onDismiss = { selectedSong = null })
    }
    selectedSchedule?.let { schedule ->
        ModalBottomSheet(onDismissRequest = { selectedSchedule = null }) {
            Text(schedule.title, Modifier.padding(horizontal = 20.dp), style = MaterialTheme.typography.titleLarge)
            Text(formatChannelDate(schedule.startAt), Modifier.padding(horizontal = 20.dp))
            schedule.description?.takeIf { it.isNotBlank() }?.let { Text(it, Modifier.padding(20.dp)) }
            Spacer(Modifier.height(28.dp))
        }
    }
    selectedWardrobe?.let { item ->
        ModalBottomSheet(onDismissRequest = { selectedWardrobe = null }) {
            ChannelRemoteImage(item.imageUrl, item.title.take(1), 260.dp, Modifier.align(Alignment.CenterHorizontally))
            Text(item.title, Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge)
            item.description?.takeIf { it.isNotBlank() }?.let { Text(it, Modifier.padding(horizontal = 20.dp)) }
            Spacer(Modifier.height(28.dp))
        }
    }
    state.setlistDetail?.let { detail ->
        ModalBottomSheet(onDismissRequest = model::closeSetlist) {
            Text(detail.summary.startedAt.take(10), Modifier.padding(20.dp), style = MaterialTheme.typography.titleLarge)
            detail.songs.forEach { song ->
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                    Text(song.title)
                    Text(song.artist, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable private fun SectionLoading() { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
@Composable private fun SectionError(title: String, message: String, retry: () -> Unit) {
    ScreenStatus(title, message, onRetry = retry)
}

// Copied from meloming-android ChannelModernSections.kt WardrobeTile; the existing
// app's bounded image adapter replaces Coil.
@Composable private fun WardrobeTile(item: ChannelWardrobeItem, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(2.dp)).background(Color(0xFFEAE8E4)).clickable(onClick = onClick)) {
        ChannelRemoteImage(item.imageUrl, item.title.take(1), 128.dp, Modifier.matchParentSize())
        Text(item.title, Modifier.align(Alignment.BottomStart).fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.34f)).padding(horizontal = 7.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelSmall, color = Color.White, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
    }
}

private fun formatChannelDate(value: String): String = try {
    DateTimeFormatter.ofPattern("yyyy년 M월 d일 HH:mm").withZone(ZoneId.of("Asia/Seoul"))
        .format(Instant.parse(value))
} catch (_: Exception) { value }

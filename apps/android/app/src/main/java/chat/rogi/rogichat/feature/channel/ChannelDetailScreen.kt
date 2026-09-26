package chat.rogi.rogichat.feature.channel

import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import chat.rogi.rogichat.core.design.ScreenStatus
import chat.rogi.rogichat.feature.channel.theme.ChannelTheme
import chat.rogi.rogichat.feature.channel.theme.IbmPlexSansKrFontFamily
import chat.rogi.rogichat.BuildConfig
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.fill.ShareNetwork
import com.adamglin.phosphoricons.regular.ArrowLeft
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

// Channel shell copied from meloming-android ecb3dbed ChannelDetailScreen.kt.
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ChannelDetailScreen(model: ChannelDetailViewModel, onTalk: () -> Unit) {
    ChannelTheme { ChannelDetailContent(model, onTalk) }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ChannelDetailContent(model: ChannelDetailViewModel, onTalk: () -> Unit) {
    val state by model.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var selectedSong by remember { mutableStateOf<Song?>(null) }
    var selectedSchedule by remember { mutableStateOf<Schedule?>(null) }
    var selectedWardrobe by remember { mutableStateOf<ChannelWardrobeItem?>(null) }
    var showSongFilters by remember { mutableStateOf(false) }
    var draftArtist by remember { mutableStateOf<Artist?>(null) }
    var draftDifficulty by remember { mutableStateOf<Int?>(null) }

    val channel = state.channel
    val channelURL = (if (BuildConfig.ENVIRONMENT == "qa") "https://qa.rogi.chat" else "https://rogi.chat") +
        "/channel/" + (channel?.webPath ?: "h66rogi")
    fun shareChannel() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, channelURL)
        }
        context.startActivity(Intent.createChooser(intent, "공유하기"))
    }
    fun visitChannel() {
        val url = channel?.platformUrl?.takeIf { it.startsWith("https://") }
            ?: "https://play.sooplive.com/h66rogi"
        if (!url.startsWith("https://")) return
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
      Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
          ChannelCenterTopBar(
              title = channel?.name ?: "",
              backgroundColor = MaterialTheme.colorScheme.background,
              contentColor = MaterialTheme.colorScheme.onBackground,
              titleFontFamily = IbmPlexSansKrFontFamily,
              navigationIcon = {
                  IconButton(onClick = onTalk) {
                      Icon(PhosphorIcons.Regular.ArrowLeft, contentDescription = "뒤로가기")
                  }
              },
              actions = {
                  IconButton(onClick = ::shareChannel) {
                      Icon(PhosphorIcons.Fill.ShareNetwork, contentDescription = "채널 공유")
                  }
              },
          )
          if (state.isLoading && channel == null) {
              ScreenStatus("채널을 불러오는 중", "잠시만 기다려 주세요.", loading = true)
          } else if (channel == null) {
              ScreenStatus("채널을 불러올 수 없어요", state.error ?: "잠시 후 다시 시도해 주세요.", onRetry = model::refresh)
          } else {
            val listState = rememberLazyListState()
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        item("profile") {
            ChannelProfileHero(
                channel = channel,
                profile = state.profile,
                onVisit = ::visitChannel,
                onShare = ::shareChannel,
                onTalk = onTalk,
                onSongbook = { model.selectTab(ChannelTab.SONGBOOK) },
            )
        }
        stickyHeader("tabs") {
            if (state.visibleTabs.isNotEmpty()) Column(modifier = Modifier.background(MaterialTheme.colorScheme.background)) {
                ChannelSectionRail(
                    tabs = state.visibleTabs,
                    labels = state.tabLabels,
                    selectedTab = state.selectedTab,
                    selectedColor = MaterialTheme.colorScheme.primary,
                    onTabSelected = model::selectTab,
                )
                if (state.selectedTab == ChannelTab.SONGBOOK) {
                    ChannelSearchBar(
                        query = state.songSearch,
                        onQueryChange = model::searchSongs,
                        onSearch = {},
                        onClear = { model.searchSongs("") },
                        placeholder = "노래 검색",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
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
                ChannelTab.WARDROBE -> {
                    item("wardrobe_top_space") { Spacer(Modifier.height(12.dp)) }
                    val visible = state.wardrobe.items.filter { it.isVisible }
                    if (state.sectionLoading) item("wardrobe_loading") {
                        Text("옷장을 불러오는 중…", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else if (visible.isEmpty()) item("wardrobe_empty") {
                        Text(state.sectionError ?: "아직 공개된 옷장이 없어요.",
                            Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else items(visible.chunked(3), key = { "wardrobe_${it.first().id}" }) { row ->
                        Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp),
                            horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            row.forEach { item -> WardrobeTile(item, Modifier.weight(1f)) { selectedWardrobe = item } }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f).aspectRatio(1f)) }
                        }
                    }
                    item("wardrobe_bottom_space") { Spacer(Modifier.height(28.dp)) }
                }
            }
        }
        item("bottom") { Spacer(Modifier.height(28.dp)) }
            }
          }
        }
      }
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

package chat.rogi.rogichat.feature.channel.console

import chat.rogi.rogichat.channelport.core.common.util.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.fill.Plus
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.core.model.song.SessionHistoryItem
import chat.rogi.rogichat.channelport.core.designsystem.component.FullScreenLoading
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingCenterTopBar
import chat.rogi.rogichat.feature.channel.console.component.HistoryTab
import chat.rogi.rogichat.feature.channel.console.component.ManualAddSheet
import chat.rogi.rogichat.feature.channel.console.component.NowPlayingCard
import chat.rogi.rogichat.feature.channel.console.component.QueueTab
import chat.rogi.rogichat.feature.channel.console.component.SettingsTab

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsoleScreen(
    onBackClick: () -> Unit,
    viewModel: ConsoleViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showEndSessionDialog by remember { mutableStateOf(false) }

    // Collect side effects
    LaunchedEffect(Unit) {
        viewModel.sideEffect.collect { effect ->
            when (effect) {
                is ConsoleSideEffect.ShowMessage -> {
                    snackbarHostState.showSnackbar(effect.message)
                }
            }
        }
    }

    // Show error via snackbar
    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.onEvent(ConsoleEvent.DismissError)
        }
    }

    // End session confirmation dialog
    if (showEndSessionDialog) {
        AlertDialog(
            onDismissRequest = { showEndSessionDialog = false },
            title = { Text("세션 종료") },
            text = { Text("세션을 종료하시겠습니까?\n대기열의 모든 곡이 삭제됩니다.") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showEndSessionDialog = false
                        viewModel.onEvent(ConsoleEvent.EndSession)
                    },
                ) {
                    Text("종료", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEndSessionDialog = false }) {
                    Text("취소")
                }
            },
        )
    }

    // Manual add bottom sheet
    if (uiState.showManualAddSheet) {
        ManualAddSheet(
            onDismiss = { viewModel.onEvent(ConsoleEvent.HideManualAdd) },
            onSubmit = { artist, title, message ->
                viewModel.onEvent(ConsoleEvent.SubmitManualRequest(artist, title, rawMessage = message))
            },
            onSubmitWithSongId = { artist, title, songId, message ->
                viewModel.onEvent(
                    ConsoleEvent.SubmitManualRequest(
                        rawArtist = artist,
                        rawTitle = title,
                        songId = songId,
                        rawMessage = message,
                    )
                )
            },
            onSearchSongs = { query -> viewModel.searchSongs(query) },
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        topBar = {
            MelomingCenterTopBar(
                title = "신청곡 콘솔",
                navigationIcon = {
                    IconButton(onClick = onBackClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "뒤로가기",
                        )
                    }
                },
                titleContent = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (uiState.isSessionActive) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF22C55E)),
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                        }
                        Text(
                            text = "신청곡 콘솔",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                    }
                },
                actions = {
                    if (uiState.isSessionActive) {
                        TextButton(onClick = { showEndSessionDialog = true }) {
                            Text(
                                text = "종료",
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (uiState.isSessionActive && uiState.activeTab == ConsoleTab.QUEUE) {
                FloatingActionButton(
                    onClick = { viewModel.onEvent(ConsoleEvent.ShowManualAdd) },
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Fill.Plus,
                        contentDescription = "곡 추가",
                    )
                }
            }
        },
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            when {
                uiState.sessionLoading -> {
                    FullScreenLoading(message = "세션 정보를 불러오는 중...")
                }

                !uiState.isSessionActive -> {
                    // Session not active: show start session UI
                    SessionStartContent(
                        sessionHistory = uiState.sessionHistory,
                        onStartSession = { viewModel.onEvent(ConsoleEvent.StartSession) },
                        onCloneSession = { viewModel.onEvent(ConsoleEvent.CloneSession(it)) },
                    )
                }

                else -> {
                    // Session active: show console UI
                    ConsoleContent(
                        uiState = uiState,
                        onEvent = viewModel::onEvent,
                    )
                }
            }

            // Loading overlay
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.3f)),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
@Composable
private fun SessionStartContent(
    sessionHistory: List<SessionHistoryItem>,
    onStartSession: () -> Unit,
    onCloneSession: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Spacer(modifier = Modifier.height(80.dp))
            Text(
                text = "신청곡 콘솔",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "세션을 시작하여 시청자의\n신청곡을 관리하세요",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onStartSession,
                modifier = Modifier.padding(horizontal = 48.dp),
            ) {
                Text(
                    text = "새 세션 시작",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            }
        }

        if (sessionHistory.isNotEmpty()) {
            item {
                Spacer(modifier = Modifier.height(40.dp))
                HorizontalDivider(modifier = Modifier.padding(horizontal = 32.dp))
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "이전 세션",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            items(sessionHistory, key = { it.id }) { session ->
                SessionHistoryCard(
                    session = session,
                    onClone = { onCloneSession(session.id) },
                )
                Spacer(modifier = Modifier.height(8.dp))
            }

            item {
                Spacer(modifier = Modifier.height(32.dp))
            }
        }
    }
}

@Composable
private fun SessionHistoryCard(
    session: SessionHistoryItem,
    onClone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ElevatedCard(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = formatSessionDate(session.startedAt),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = session.platform,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            session.duration?.let { duration ->
                Text(
                    text = formatDuration(duration),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                StatItem(label = "신청", value = session.stats.totalRequests.toString())
                StatItem(label = "완료", value = session.stats.completedCount.toString())
                StatItem(label = "거절", value = session.stats.rejectedCount.toString())
                if (session.stats.totalDonation > 0) {
                    StatItem(label = "후원", value = session.stats.totalDonation.toString())
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedButton(
                onClick = onClone,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("이 세션 복원")
            }
        }
    }
}

@Composable
private fun StatItem(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun formatSessionDate(isoDate: String): String {
    return DateUtils.formatDateTime(DateUtils.parseIso(isoDate)).ifEmpty {
        isoDate.substringBefore("T")
    }
}

private fun formatDuration(minutes: Int): String {
    val hours = minutes / 60
    val mins = minutes % 60
    return if (hours > 0) "${hours}시간 ${mins}분" else "${mins}분"
}

@Composable
private fun ConsoleContent(
    uiState: ConsoleUiState,
    onEvent: (ConsoleEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val consoleTabs = ConsoleTab.entries
    val pagerState = rememberPagerState { consoleTabs.size }

    // Sync pager swipe → viewModel
    LaunchedEffect(pagerState.settledPage) {
        val tab = consoleTabs[pagerState.settledPage]
        if (uiState.activeTab != tab) {
            onEvent(ConsoleEvent.SwitchTab(tab))
        }
    }

    // Sync tab tap → pager
    LaunchedEffect(uiState.activeTab) {
        val targetPage = consoleTabs.indexOf(uiState.activeTab)
        if (pagerState.currentPage != targetPage) {
            pagerState.animateScrollToPage(targetPage)
        }
    }

    Column(
        modifier = modifier.fillMaxSize(),
    ) {
        // Now playing card
        uiState.nowPlaying?.let { nowPlaying ->
            NowPlayingCard(
                nowPlaying = nowPlaying,
                onPlayNext = { onEvent(ConsoleEvent.PlayNext) },
                onSkip = { onEvent(ConsoleEvent.SkipCurrent()) },
            )
        }

        // Underline tab bar
        ConsoleUnderlineTabBar(
            selectedTab = uiState.activeTab,
            queueSize = uiState.queue.size,
            onTabSelected = { onEvent(ConsoleEvent.SwitchTab(it)) },
        )

        // Swipeable tab content
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
        ) { page ->
            when (consoleTabs[page]) {
                ConsoleTab.QUEUE -> {
                    QueueTab(
                        queue = uiState.queue,
                        onPlayNow = { onEvent(ConsoleEvent.PlayNow(it)) },
                        onMoveUp = { requestId, newOrder ->
                            onEvent(ConsoleEvent.ReorderRequest(requestId, newOrder))
                        },
                        onMoveDown = { requestId, newOrder ->
                            onEvent(ConsoleEvent.ReorderRequest(requestId, newOrder))
                        },
                        onDelete = { onEvent(ConsoleEvent.DeleteRequest(it)) },
                        onClearQueue = { onEvent(ConsoleEvent.ClearQueue) },
                    )
                }

                ConsoleTab.HISTORY -> {
                    HistoryTab(history = uiState.history)
                }

                ConsoleTab.SETTINGS -> {
                    SettingsTab(
                        settings = uiState.settings,
                        pricingSettings = uiState.pricingSettings,
                        categories = uiState.categories,
                        onUpdateSettings = { onEvent(ConsoleEvent.UpdateSettings(it)) },
                        onUpdatePricingSettings = { onEvent(ConsoleEvent.UpdatePricingSettings(it)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ConsoleUnderlineTabBar(
    selectedTab: ConsoleTab,
    queueSize: Int,
    onTabSelected: (ConsoleTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = ConsoleTab.entries
    val labels = mapOf(
        ConsoleTab.QUEUE to "대기열",
        ConsoleTab.HISTORY to "히스토리",
        ConsoleTab.SETTINGS to "설정",
    )

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        ) {
            tabs.forEach { tab ->
                val selected = selectedTab == tab
                val textColor by animateColorAsState(
                    targetValue = if (selected) MaterialTheme.colorScheme.onSurface
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    animationSpec = tween(150),
                    label = "consoleTabText",
                )
                val indicatorColor by animateColorAsState(
                    targetValue = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                    animationSpec = tween(150),
                    label = "consoleTabIndicator",
                )

                val label = if (tab == ConsoleTab.QUEUE && queueSize > 0) {
                    "${labels[tab]} ($queueSize)"
                } else {
                    labels[tab] ?: ""
                }

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = { onTabSelected(tab) },
                        )
                        .padding(top = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        color = textColor,
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Box(
                        modifier = Modifier
                            .width(40.dp)
                            .height(2.dp)
                            .clip(RoundedCornerShape(1.dp))
                            .background(indicatorColor),
                    )
                }
            }
        }

        HorizontalDivider(
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
            thickness = 1.dp,
        )
    }
}

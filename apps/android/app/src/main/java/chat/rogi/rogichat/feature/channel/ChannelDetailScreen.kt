package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.content.Intent
import androidx.annotation.VisibleForTesting
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.DotsThreeVertical
import com.adamglin.phosphoricons.regular.Gear
import com.adamglin.phosphoricons.fill.FolderSimple
import com.adamglin.phosphoricons.fill.MusicNote
import com.adamglin.phosphoricons.fill.Plus
import com.adamglin.phosphoricons.fill.Radio
import com.adamglin.phosphoricons.fill.ShareNetwork
import com.adamglin.phosphoricons.fill.Star
import com.adamglin.phosphoricons.regular.CaretRight
import com.adamglin.phosphoricons.regular.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import chat.rogi.rogichat.channelport.core.designsystem.theme.IbmPlexSansKrFontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import chat.rogi.rogichat.channelport.core.designsystem.component.FullScreenLoading
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingCenterTopBar
import chat.rogi.rogichat.channelport.core.designsystem.component.ChannelPlatformBadge
import chat.rogi.rogichat.channelport.core.model.channel.ChannelVerificationSummary
import chat.rogi.rogichat.channelport.core.designsystem.component.ProfileImage
import chat.rogi.rogichat.feature.channel.component.DeleteScheduleDialog
import chat.rogi.rogichat.feature.channel.component.EditScheduleBottomSheet
import chat.rogi.rogichat.feature.channel.component.LiveRequestStatusBottomSheet
import chat.rogi.rogichat.feature.channel.component.ScheduleDetailBottomSheet
import chat.rogi.rogichat.feature.channel.component.SongDetailBottomSheet
import chat.rogi.rogichat.feature.channel.component.infoTabContent
import chat.rogi.rogichat.feature.channel.component.scheduleTabContent
import chat.rogi.rogichat.feature.channel.component.channelWardrobeTabContent
import chat.rogi.rogichat.feature.channel.component.songbookTabContent
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChannelDetailScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAddSong: (Int) -> Unit = {},
    onNavigateToEditSong: (Int) -> Unit = {},
    onNavigateToAddSchedule: (Int) -> Unit = {},
    onNavigateToCategoryManagement: (Int) -> Unit = {},
    onNavigateToChannelSettings: () -> Unit = {},
    onNavigateToConsole: (channelIdentifier: String, channelId: Int) -> Unit = { _, _ -> },
    onNavigateToLogin: () -> Unit = {},
    refreshSongbook: Boolean = false,
    refreshSchedule: Boolean = false,
    refreshChannel: Boolean = false,
    onRefreshConsumed: () -> Unit = {},
    viewModel: ChannelDetailViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()
    val isLoggedIn by viewModel.isLoggedIn.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    // Handle refresh signals from navigation
    LaunchedEffect(refreshSongbook) {
        if (refreshSongbook) {
            viewModel.onEvent(ChannelDetailEvent.RefreshSongbook)
            onRefreshConsumed()
        }
    }

    LaunchedEffect(refreshSchedule) {
        if (refreshSchedule) {
            viewModel.onEvent(ChannelDetailEvent.RefreshSchedule)
            onRefreshConsumed()
        }
    }

    LaunchedEffect(refreshChannel) {
        if (refreshChannel) {
            viewModel.onEvent(ChannelDetailEvent.Refresh)
            onRefreshConsumed()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.onEvent(ChannelDetailEvent.ErrorDismissed)
        }
    }

    LaunchedEffect(Unit) {
        viewModel.shareEvent.collect { url ->
            val sendIntent = Intent().apply {
                action = Intent.ACTION_SEND
                putExtra(Intent.EXTRA_TEXT, url)
                type = "text/plain"
            }
            context.startActivity(Intent.createChooser(sendIntent, "공유하기"))
        }
    }

    LaunchedEffect(Unit) {
        viewModel.messageEvent.collect { message ->
            snackbarHostState.showSnackbar(message)
        }
    }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        viewModel.refreshCurrentUser()
    }

    val themeColor = uiState.channel?.themeColor?.let { parseColor(it) }
        ?: MaterialTheme.colorScheme.background
    val contentColor = if (themeColor.isLight()) Color.Black else Color.White

    // 더보기 메뉴 상태
    var showMoreMenu by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize()) {
                MelomingCenterTopBar(
                    title = uiState.channel?.name ?: "",
                    backgroundColor = themeColor,
                    contentColor = contentColor,
                    titleFontFamily = IbmPlexSansKrFontFamily,
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "뒤로가기",
                                tint = contentColor,
                            )
                        }
                    },
                    actions = {
                        IconButton(onClick = { viewModel.onEvent(ChannelDetailEvent.ToggleFavorite) }) {
                            Icon(
                                imageVector = if (uiState.isFavorite) {
                                    PhosphorIcons.Fill.Star
                                } else {
                                    PhosphorIcons.Regular.Star
                                },
                                contentDescription = if (uiState.isFavorite) "즐겨찾기 해제" else "즐겨찾기",
                                tint = if (uiState.isFavorite) Color(0xFFFBBF24) else contentColor.copy(alpha = 0.8f),
                            )
                        }
                        Box {
                            IconButton(onClick = { showMoreMenu = true }) {
                                Icon(
                                    imageVector = PhosphorIcons.Regular.DotsThreeVertical,
                                    contentDescription = "더보기",
                                    tint = contentColor,
                                )
                            }
                            DropdownMenu(
                                expanded = showMoreMenu,
                                onDismissRequest = { showMoreMenu = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("공유하기") },
                                    onClick = {
                                        showMoreMenu = false
                                        viewModel.onEvent(ChannelDetailEvent.Share)
                                    },
                                    leadingIcon = {
                                        Icon(
                                            imageVector = PhosphorIcons.Fill.ShareNetwork,
                                            contentDescription = null,
                                            modifier = Modifier.size(20.dp),
                                        )
                                    },
                                )
                                if (uiState.permission.manageContent || uiState.permission.isOwner) {
                                    DropdownMenuItem(
                                        text = { Text("카테고리 관리") },
                                        onClick = {
                                            showMoreMenu = false
                                            uiState.channel?.let { channel ->
                                                onNavigateToCategoryManagement(channel.id)
                                            }
                                        },
                                        leadingIcon = {
                                            Icon(
                                                imageVector = PhosphorIcons.Fill.FolderSimple,
                                                contentDescription = null,
                                                modifier = Modifier.size(20.dp),
                                            )
                                        },
                                    )
                                }
                                if (uiState.permission.manageSettings || uiState.permission.isOwner) {
                                    DropdownMenuItem(
                                        text = { Text("채널 설정") },
                                        onClick = {
                                            showMoreMenu = false
                                            onNavigateToChannelSettings()
                                        },
                                        leadingIcon = {
                                            Icon(
                                                imageVector = PhosphorIcons.Regular.Gear,
                                                contentDescription = null,
                                                modifier = Modifier.size(20.dp),
                                            )
                                        },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("신청곡 콘솔") },
                                        onClick = {
                                            showMoreMenu = false
                                            uiState.channel?.let { channel ->
                                                onNavigateToConsole(channel.webPath, channel.id)
                                            }
                                        },
                                        leadingIcon = {
                                            Icon(
                                                imageVector = PhosphorIcons.Fill.MusicNote,
                                                contentDescription = null,
                                                modifier = Modifier.size(20.dp),
                                            )
                                        },
                                    )
                                }
                            }
                        }
                    },
                )

                when {
                    uiState.isLoading -> {
                        FullScreenLoading()
                    }
                    uiState.channel != null -> {
                        val pagerState = rememberPagerState { ChannelTab.entries.size }

                        // Sync pager swipe → viewModel
                        LaunchedEffect(pagerState.settledPage) {
                            val tab = ChannelTab.entries[pagerState.settledPage]
                            if (uiState.selectedTab != tab) {
                                viewModel.onEvent(ChannelDetailEvent.TabSelected(tab))
                            }
                        }

                        // Sync tab bar tap → pager
                        LaunchedEffect(uiState.selectedTab) {
                            val targetPage = ChannelTab.entries.indexOf(uiState.selectedTab)
                            if (pagerState.currentPage != targetPage) {
                                pagerState.animateScrollToPage(targetPage)
                            }
                        }

                        Column(modifier = Modifier.fillMaxSize()) {
                            // Header (scrolls with a nested LazyColumn inside each page)
                            // For now, header is fixed at top
                            ChannelHeader(
                                bannerUrl = uiState.channel!!.topBannerUrl,
                                profileImageUrl = uiState.channel!!.profileImageUrl,
                                name = uiState.channel!!.name,
                                songCount = uiState.channel!!.songCount,
                                favoritesCount = uiState.favoritesCount,
                                themeColor = uiState.channel!!.themeColor,
                                isOwnerProSubscriber = uiState.channel!!.isOwnerProSubscriber,
                                verifications = uiState.channel!!.verifications,
                            )

                            // Console quick access (owner only)
                            if (uiState.permission.isOwner) {
                                ConsoleQuickAccessCard(
                                    onClick = {
                                        uiState.channel?.let { channel ->
                                            onNavigateToConsole(channel.webPath, channel.id)
                                        }
                                    },
                                )
                            }

                            // Tab bar
                            UnderlineTabBar(
                                tabs = ChannelTab.entries,
                                selectedTab = uiState.selectedTab,
                                onTabSelected = { viewModel.onEvent(ChannelDetailEvent.TabSelected(it)) },
                            )

                            // Swipeable tab content
                            HorizontalPager(
                                state = pagerState,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f),
                            ) { page ->
                                val tab = ChannelTab.entries[page]
                                ChannelTabPage(
                                    tab = tab,
                                    uiState = uiState,
                                    viewModel = viewModel,
                                    isLoggedIn = isLoggedIn,
                                )
                            }
                        }
                    }
                    else -> {
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text("채널을 불러올 수 없어요")
                            TextButton(onClick = { viewModel.onEvent(ChannelDetailEvent.Refresh) }) {
                                Text("다시 시도")
                            }
                        }
                    }
                }
            }

            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }

        // Floating "신청곡 현황" button (bottom center)
        if (uiState.songbookState.liveRequestState.showRequestUI &&
            uiState.selectedTab == ChannelTab.SONGBOOK
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 16.dp),
                contentAlignment = Alignment.BottomCenter,
            ) {
                val bannerBrush = Brush.horizontalGradient(
                    colors = listOf(
                        Color(0xFFD946EF),
                        Color(0xFFEC4899),
                        Color(0xFF8B5CF6),
                    ),
                )
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(bannerBrush)
                        .clickable { viewModel.onEvent(ChannelDetailEvent.ShowLiveRequestSheet) }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        imageVector = PhosphorIcons.Fill.Radio,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                    Text(
                        text = "신청곡 현황",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White,
                    )
                }
            }
        }

        // Live Request Status BottomSheet
        if (uiState.songbookState.showLiveRequestSheet) {
            LiveRequestStatusBottomSheet(
                state = uiState.songbookState.liveRequestState,
                onDismiss = { viewModel.onEvent(ChannelDetailEvent.DismissLiveRequestSheet) },
            )
        }

        // Song Detail Bottom Sheet
        uiState.songbookState.selectedSong?.let { song ->
            SongDetailBottomSheet(
                song = song,
                permission = uiState.permission,
                pricingSettings = uiState.pricingSettings,
                onDismiss = { viewModel.onEvent(ChannelDetailEvent.SongDetailDismissed) },
                onLikeToggle = { viewModel.onEvent(ChannelDetailEvent.ToggleSongFavorite(song)) },
                onEditClick = {
                    viewModel.onEvent(ChannelDetailEvent.SongDetailDismissed)
                    onNavigateToEditSong(song.id)
                },
                liveRequestState = uiState.songbookState.liveRequestState,
                isRequestSubmitting = uiState.songbookState.isRequestSubmitting,
                onRequestClick = { viewModel.onEvent(ChannelDetailEvent.SongRequestSubmit(song)) },
            )
        }

        // Schedule Detail Bottom Sheet
        if (uiState.scheduleState.showDetailSheet) {
            uiState.scheduleState.selectedSchedule?.let { schedule ->
                ScheduleDetailBottomSheet(
                    schedule = schedule,
                    canEdit = uiState.permission.isOwner || uiState.permission.manageContent,
                    onDismiss = { viewModel.onEvent(ChannelDetailEvent.DismissScheduleDetail) },
                    onEdit = { viewModel.onEvent(ChannelDetailEvent.ShowEditSchedule) },
                    onDelete = { viewModel.onEvent(ChannelDetailEvent.ShowDeleteScheduleDialog) },
                )
            }
        }

        // Schedule Edit Bottom Sheet
        if (uiState.scheduleState.showEditSheet) {
            uiState.scheduleState.selectedSchedule?.let { schedule ->
                EditScheduleBottomSheet(
                    schedule = schedule,
                    onDismiss = { viewModel.onEvent(ChannelDetailEvent.DismissEditSchedule) },
                    onUpdate = { request -> viewModel.updateSchedule(request) },
                )
            }
        }

        // Schedule Delete Dialog
        if (uiState.scheduleState.showDeleteDialog) {
            DeleteScheduleDialog(
                onConfirm = { viewModel.onEvent(ChannelDetailEvent.ConfirmDeleteSchedule) },
                onDismiss = { viewModel.onEvent(ChannelDetailEvent.DismissDeleteScheduleDialog) },
            )
        }

        // Login Required Dialog
        if (uiState.showLoginRequiredDialog) {
            AlertDialog(
                onDismissRequest = { viewModel.onEvent(ChannelDetailEvent.LoginDialogDismissed) },
                title = { Text("로그인 필요") },
                text = { Text("이 기능을 사용하려면 로그인이 필요합니다.\n로그인하시겠습니까?") },
                confirmButton = {
                    TextButton(
                        onClick = {
                            viewModel.onEvent(ChannelDetailEvent.LoginDialogDismissed)
                            onNavigateToLogin()
                        },
                    ) {
                        Text("로그인")
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = { viewModel.onEvent(ChannelDetailEvent.LoginDialogDismissed) },
                    ) {
                        Text("취소")
                    }
                },
            )
        }

        // Identity Verification Dialog


        // Guestbook Delete Confirm Dialog

    }

    // FAB for adding content (Song or Schedule based on selected tab)
    if (uiState.permission.isOwner || uiState.permission.manageContent) {
        uiState.channel?.let { channel ->
            val showFab = uiState.selectedTab == ChannelTab.SONGBOOK ||
                uiState.selectedTab == ChannelTab.SCHEDULE

            if (showFab) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    contentAlignment = Alignment.BottomEnd,
                ) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary)
                            .clickable {
                                when (uiState.selectedTab) {
                                    ChannelTab.SONGBOOK -> onNavigateToAddSong(channel.id)
                                    ChannelTab.SCHEDULE -> onNavigateToAddSchedule(channel.id)
                                    else -> {}
                                }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            imageVector = PhosphorIcons.Fill.Plus,
                            contentDescription = when (uiState.selectedTab) {
                                ChannelTab.SONGBOOK -> "노래 추가"
                                ChannelTab.SCHEDULE -> "일정 추가"
                                else -> "추가"
                            },
                            tint = MaterialTheme.colorScheme.onPrimary,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChannelTabPage(
    tab: ChannelTab,
    uiState: ChannelDetailUiState,
    viewModel: ChannelDetailViewModel,
    isLoggedIn: Boolean,
) {
    val listState = rememberLazyListState()

    // Infinite scroll detection
    val shouldLoadMore by remember {
        derivedStateOf {
            val layoutInfo = listState.layoutInfo
            val totalItems = layoutInfo.totalItemsCount
            val lastVisibleItem = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            lastVisibleItem >= totalItems - 5
        }
    }

    LaunchedEffect(shouldLoadMore) {
        snapshotFlow { shouldLoadMore }
            .distinctUntilChanged()
            .filter { it }
            .collect {
                when (tab) {
                    ChannelTab.SONGBOOK -> {
                        if (uiState.songbookState.hasMorePages && !uiState.songbookState.isLoadingMore) {
                            viewModel.onEvent(ChannelDetailEvent.LoadMoreSongs)
                        }
                    }

                    else -> {}
                }
            }
    }

    val isRefreshing = when (tab) {
        ChannelTab.SONGBOOK -> uiState.songbookState.isRefreshing
        ChannelTab.SCHEDULE -> uiState.scheduleState.isRefreshing
        ChannelTab.INFO, ChannelTab.SETLIST, ChannelTab.WARDROBE -> false
    }

    val onRefresh: () -> Unit = {
        when (tab) {
            ChannelTab.SONGBOOK -> viewModel.onEvent(ChannelDetailEvent.RefreshSongbook)
            ChannelTab.SCHEDULE -> viewModel.onEvent(ChannelDetailEvent.RefreshSchedule)
            ChannelTab.INFO, ChannelTab.SETLIST, ChannelTab.WARDROBE -> {}
        }
    }

    if (tab == ChannelTab.INFO) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize(),
        ) {
            infoTabContent(
                channel = uiState.channel!!,
                state = uiState.infoState,
                favoritesCount = uiState.favoritesCount,
            )
        }
    } else {
        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
            ) {
                when (tab) {
                    ChannelTab.SONGBOOK -> songbookTabContent(
                        state = uiState.songbookState,
                        onEvent = viewModel::onEvent,
                    )
                    ChannelTab.SCHEDULE -> scheduleTabContent(
                        state = uiState.scheduleState,
                        onEvent = viewModel::onEvent,
                        canEdit = uiState.permission.isOwner || uiState.permission.manageContent,
                    )
                    ChannelTab.SETLIST -> item { ChannelSetlistSection(viewModel.setlistRepository) }
                    ChannelTab.WARDROBE -> channelWardrobeTabContent(uiState.wardrobeState)
                    ChannelTab.INFO -> {} // handled above
                }
            }
        }
    }
}

@Composable
private fun UnderlineTabBar(
    tabs: List<ChannelTab>,
    selectedTab: ChannelTab,
    onTabSelected: (ChannelTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            tabs.forEach { tab ->
                UnderlineTab(
                    text = tab.title,
                    selected = selectedTab == tab,
                    onClick = { onTabSelected(tab) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        HorizontalDivider(
            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f),
            thickness = 1.dp,
        )
    }
}

@Composable
private fun UnderlineTab(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val textColor by animateColorAsState(
        targetValue = if (selected) {
            MaterialTheme.colorScheme.onSurface
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        animationSpec = tween(150),
        label = "tabText",
    )
    val indicatorColor by animateColorAsState(
        targetValue = if (selected) {
            MaterialTheme.colorScheme.primary
        } else {
            Color.Transparent
        },
        animationSpec = tween(150),
        label = "tabIndicator",
    )

    Column(
        modifier = modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(top = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = text,
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

@VisibleForTesting
@Composable
internal fun ChannelHeader(
    bannerUrl: String?,
    profileImageUrl: String?,
    name: String,
    songCount: Int,
    favoritesCount: Int,
    themeColor: String,
    isOwnerProSubscriber: Boolean = false,
    verifications: List<ChannelVerificationSummary>? = null,
) {
    val backgroundColor = parseColor(themeColor)
    val textColor = if (backgroundColor.isLight()) Color.Black else Color.White
    val subTextColor = textColor.copy(alpha = 0.8f)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(backgroundColor),
    ) {
        // Profile section
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            ProfileImage(
                imageUrl = profileImageUrl,
                size = 72.dp,
                borderColor = Color.White,
                borderWidth = 3.dp,
            )

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = name,
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = IbmPlexSansKrFontFamily,
                    fontWeight = FontWeight.Bold,
                    color = textColor,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (isOwnerProSubscriber || !verifications.isNullOrEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {

                        verifications?.forEach { v ->
                            ChannelPlatformBadge(platform = v.platform)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(6.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = PhosphorIcons.Fill.MusicNote,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = subTextColor,
                        )
                        Text(
                            text = "${songCount}곡",
                            style = MaterialTheme.typography.bodySmall,
                            color = subTextColor,
                        )
                    }
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = PhosphorIcons.Fill.Star,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = subTextColor,
                        )
                        Text(
                            text = "$favoritesCount",
                            style = MaterialTheme.typography.bodySmall,
                            color = subTextColor,
                        )
                    }
                }
            }
        }
    }
}

private fun parseColor(hexColor: String): Color {
    return try {
        val colorString = hexColor.removePrefix("#")
        val colorInt = colorString.toLong(16)
        Color(
            red = ((colorInt shr 16) and 0xFF) / 255f,
            green = ((colorInt shr 8) and 0xFF) / 255f,
            blue = (colorInt and 0xFF) / 255f,
        )
    } catch (e: Exception) {
        Color(0xFF6366F1) // Default indigo
    }
}

private fun Color.isLight(): Boolean {
    // WCAG luminance formula
    val luminance = 0.299f * red + 0.587f * green + 0.114f * blue
    return luminance > 0.5f
}

@Composable
private fun ConsoleQuickAccessCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                Color(0xFF9333EA),
                                Color(0xFFEC4899),
                            ),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = PhosphorIcons.Fill.MusicNote,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "신청곡 콘솔",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "라이브 신청곡을 관리하세요",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                imageVector = PhosphorIcons.Regular.CaretRight,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

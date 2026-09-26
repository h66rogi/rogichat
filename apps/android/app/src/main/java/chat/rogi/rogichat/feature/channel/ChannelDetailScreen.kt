package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.content.Intent
import androidx.annotation.VisibleForTesting
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Fill
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.DotsThreeVertical
import com.adamglin.phosphoricons.regular.Gear
import com.adamglin.phosphoricons.fill.ChatDots
import com.adamglin.phosphoricons.fill.FolderSimple
import com.adamglin.phosphoricons.fill.Microphone
import com.adamglin.phosphoricons.fill.MusicNote
import com.adamglin.phosphoricons.fill.Plus
import com.adamglin.phosphoricons.fill.Radio
import com.adamglin.phosphoricons.fill.ShareNetwork
import com.adamglin.phosphoricons.fill.Star
import com.adamglin.phosphoricons.regular.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import chat.rogi.rogichat.channelport.core.designsystem.theme.IbmPlexSansKrFontFamily
import androidx.compose.ui.unit.dp
import androidx.core.text.HtmlCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import chat.rogi.rogichat.channelport.core.designsystem.component.FullScreenLoading
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingCenterTopBar
import chat.rogi.rogichat.channelport.core.designsystem.component.MelomingSearchBar
import chat.rogi.rogichat.channelport.core.designsystem.component.ChannelPlatformBadge
import chat.rogi.rogichat.channelport.core.designsystem.component.ProBadge
import chat.rogi.rogichat.channelport.core.designsystem.component.ProBadgeVariant
import chat.rogi.rogichat.channelport.core.model.channel.ChannelVerificationSummary
import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.designsystem.component.ProfileImage
import chat.rogi.rogichat.feature.channel.component.DeleteScheduleDialog
import chat.rogi.rogichat.feature.channel.component.EditScheduleBottomSheet
import chat.rogi.rogichat.feature.channel.component.LiveRequestStatusBottomSheet
import chat.rogi.rogichat.feature.channel.component.ScheduleDetailBottomSheet
import chat.rogi.rogichat.feature.channel.component.SongDetailBottomSheet
import chat.rogi.rogichat.feature.channel.component.channelWardrobeTabContent
import chat.rogi.rogichat.feature.channel.component.infoTabContent
import chat.rogi.rogichat.feature.channel.component.scheduleTabContent
import chat.rogi.rogichat.feature.channel.component.songbookTabContent

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
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
    onChannelTalk: () -> Unit,
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

    val primaryColor = MaterialTheme.colorScheme.primary
    val contentColor = MaterialTheme.colorScheme.onBackground

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
                    backgroundColor = MaterialTheme.colorScheme.background,
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
                        val listState = rememberLazyListState()
                        LazyColumn(
                            state = listState,
                            modifier = Modifier.fillMaxSize(),
                        ) {
                            item(key = "channel_profile") {
                                ChannelProfileHero(
                                    uiState = uiState,
                                    onFavorite = { viewModel.onEvent(ChannelDetailEvent.ToggleFavorite) },
                                    onChannelTalk = onChannelTalk,
                                    onEditChannel = onNavigateToChannelSettings,
                                )
                            }
                            stickyHeader {
                                Column(modifier = Modifier.background(MaterialTheme.colorScheme.background)) {
                                    ChannelSectionRail(
                                        tabs = uiState.visibleTabs,
                                        labels = uiState.tabLabels,
                                        selectedTab = uiState.selectedTab,
                                        selectedColor = primaryColor,
                                        onTabSelected = { viewModel.onEvent(ChannelDetailEvent.TabSelected(it)) },
                                    )
                                    if (uiState.selectedTab == ChannelTab.SONGBOOK) {
                                        MelomingSearchBar(
                                            query = uiState.songbookState.searchQuery,
                                            onQueryChange = { viewModel.onEvent(ChannelDetailEvent.SongSearchChanged(it)) },
                                            onSearch = {},
                                            onClear = { viewModel.onEvent(ChannelDetailEvent.SongSearchChanged("")) },
                                            placeholder = "노래 검색",
                                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                                        )
                                    }
                                }
                            }
                            channelSelectedTabContent(
                                tab = uiState.selectedTab,
                                uiState = uiState,
                                viewModel = viewModel,
                                isLoggedIn = isLoggedIn,

                            )
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

private fun LazyListScope.channelSelectedTabContent(
    tab: ChannelTab,
    uiState: ChannelDetailUiState,
    viewModel: ChannelDetailViewModel,
    isLoggedIn: Boolean,
) {
    when (tab) {
        ChannelTab.WARDROBE -> channelWardrobeTabContent(uiState.wardrobeState)
        ChannelTab.SETLIST -> item { ChannelSetlistSection(viewModel.setlistRepository) }
        ChannelTab.SONGBOOK -> songbookTabContent(
            state = uiState.songbookState,
            onEvent = viewModel::onEvent,
            showSearch = false,
        )
        ChannelTab.SCHEDULE -> scheduleTabContent(
            state = uiState.scheduleState,
            onEvent = viewModel::onEvent,
            canEdit = uiState.permission.isOwner || uiState.permission.manageContent,
        )
        ChannelTab.INFO -> infoTabContent(
            channel = uiState.channel!!,
            state = uiState.infoState,
            favoritesCount = uiState.favoritesCount,
        )
    }
}

private fun LazyListScope.voiceCommissionTabContent(
    channel: Channel,
    onOpen: () -> Unit,
) {
    item(key = "voice_commission") {
        val accent = Color(0xFF8B5CF6)
        val shape = RoundedCornerShape(26.dp)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp)
                .shadow(
                    elevation = 14.dp,
                    shape = shape,
                    ambientColor = accent.copy(alpha = 0.14f),
                )
                .background(
                    brush = Brush.linearGradient(
                        listOf(
                            MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                            accent.copy(alpha = 0.12f),
                            MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                        ),
                    ),
                    shape = shape,
                )
                .border(
                    width = 0.8.dp,
                    brush = Brush.linearGradient(
                        listOf(
                            Color.White.copy(alpha = 0.62f),
                            accent.copy(alpha = 0.30f),
                            MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.28f),
                        ),
                    ),
                    shape = shape,
                )
                .padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Surface(
                shape = CircleShape,
                color = accent.copy(alpha = 0.14f),
            ) {
                Icon(
                    imageVector = PhosphorIcons.Fill.Microphone,
                    contentDescription = null,
                    tint = accent,
                    modifier = Modifier
                        .padding(14.dp)
                        .size(30.dp),
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "${channel.name}의 보이스커미션",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = if (channel.voiceCommissionActive) {
                    "원하는 대사와 분위기를 담아 스트리머에게 나만의 맞춤 보이스를 신청해 보세요."
                } else {
                    "아직 준비 중인 채널이에요. 다음 화면에서 개설을 요청하거나 첫 상품을 등록할 수 있어요."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(20.dp))

            Surface(
                onClick = onOpen,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                color = accent,
                shadowElevation = 6.dp,
            ) {
                Text(
                    text = if (channel.voiceCommissionActive) {
                        "보이스커미션 보기"
                    } else {
                        "보이스커미션 확인"
                    },
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 14.dp),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}





@Composable
private fun ChannelProfileHero(
    uiState: ChannelDetailUiState,
    onFavorite: () -> Unit,
    onChannelTalk: () -> Unit,
    onEditChannel: () -> Unit,
) {
    val channel = uiState.channel ?: return
    val themeTint = parseColor(channel.themeColor)
    val glassShape = RoundedCornerShape(26.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 12.dp)
            .shadow(18.dp, glassShape, ambientColor = themeTint.copy(alpha = 0.12f))
            .clip(glassShape)
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                        themeTint.copy(alpha = 0.11f),
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.82f),
                    ),
                ),
            )
            .border(
                width = 1.dp,
                brush = Brush.linearGradient(
                    listOf(
                        Color.White.copy(alpha = 0.72f),
                        themeTint.copy(alpha = 0.25f),
                        MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f),
                    ),
                ),
                shape = glassShape,
            )
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .border(
                        width = if (false) 3.dp else 1.dp,
                        color = if (false) Color(0xFFFFA000) else MaterialTheme.colorScheme.outlineVariant,
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                ProfileImage(imageUrl = channel.profileImageUrl, size = 76.dp)
                if (false) {
                    Text(
                        "LIVE",
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .clip(RoundedCornerShape(999.dp))
                            .background(Color(0xFFE65A24))
                            .padding(horizontal = 7.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(channel.name, modifier = Modifier.weight(1f, fill = false), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (!channel.verifications.isNullOrEmpty()) {
                        Box(
                            modifier = Modifier
                                .size(18.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("✓", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (channel.isOwnerProSubscriber) {
                        Surface(
                            shape = RoundedCornerShape(999.dp),
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f),
                        ) {
                            Text(
                                "PRO",
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp),
                                color = MaterialTheme.colorScheme.primary,
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
                Text(
                    "@${channel.webPath}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "즐겨찾기 ${uiState.favoritesCount} · 노래 ${channel.songCount} · 아티스트 ${channel.artistCount}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val description = uiState.infoState.profile?.homeDescription
                    ?: uiState.infoState.profile?.description
                    ?: channel.channelDescription
                description?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        stripHtmlForPreview(it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (uiState.permission.isOwner) {
                ChannelGlassActionButton(
                    text = "채널 수정",
                    icon = PhosphorIcons.Regular.Gear,
                    modifier = Modifier.weight(1f),
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = onEditChannel,
                )
                ChannelGlassActionButton(
                    icon = PhosphorIcons.Fill.ChatDots,
                    modifier = Modifier.width(48.dp),
                    tint = MaterialTheme.colorScheme.primary,
                    contentDescription = "채널톡",
                    onClick = onChannelTalk,
                )
            } else {
                ChannelGlassActionButton(
                    text = "즐겨찾기",
                    icon = if (uiState.isFavorite) PhosphorIcons.Fill.Star else PhosphorIcons.Regular.Star,
                    modifier = Modifier.weight(1f),
                    tint = MaterialTheme.colorScheme.primary,
                    onClick = onFavorite,
                )
                ChannelGlassActionButton(
                    icon = PhosphorIcons.Fill.ChatDots,
                    modifier = Modifier.width(48.dp),
                    tint = MaterialTheme.colorScheme.primary,
                    contentDescription = "채널톡",
                    onClick = onChannelTalk,
                )
            }
        }
    }
}

@Composable
private fun ChannelGlassActionButton(
    icon: ImageVector,
    modifier: Modifier,
    tint: Color,
    onClick: () -> Unit,
    text: String? = null,
    contentDescription: String? = text,
) {
    val shape = RoundedCornerShape(15.dp)
    Surface(
        onClick = onClick,
        modifier = modifier
            .height(46.dp)
            .shadow(7.dp, shape, ambientColor = tint.copy(alpha = 0.12f)),
        shape = shape,
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier
                .background(
                    Brush.linearGradient(
                        listOf(
                            MaterialTheme.colorScheme.surface.copy(alpha = 0.88f),
                            tint.copy(alpha = 0.12f),
                        ),
                    ),
                )
                .border(
                    0.8.dp,
                    Brush.linearGradient(
                        listOf(Color.White.copy(alpha = 0.7f), tint.copy(alpha = 0.28f)),
                    ),
                    shape,
                )
                .padding(horizontal = if (text == null) 0.dp else 10.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint,
                modifier = Modifier.size(19.dp),
            )
            text?.let {
                Spacer(Modifier.width(5.dp))
                Text(
                    it,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = tint,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun ChannelActionButton(
    text: String,
    modifier: Modifier,
    container: Color,
    content: Color,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(42.dp),
        shape = RoundedCornerShape(13.dp),
        color = container,
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = content, maxLines = 1)
        }
    }
}

@Composable
private fun ChannelSectionRail(
    tabs: List<ChannelTab>,
    selectedTab: ChannelTab,
    selectedColor: Color,
    onTabSelected: (ChannelTab) -> Unit,
    labels: Map<ChannelTab, String> = emptyMap(),
) {
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        items(tabs, key = { it.name }) { tab ->
            val selected = tab == selectedTab
            val shape = RoundedCornerShape(999.dp)
            Surface(
                onClick = { onTabSelected(tab) },
                modifier = Modifier.shadow(
                    elevation = if (selected) 8.dp else 4.dp,
                    shape = shape,
                    ambientColor = selectedColor.copy(alpha = if (selected) 0.16f else 0.07f),
                ),
                shape = shape,
                color = Color.Transparent,
            ) {
                Text(
                    text = labels[tab] ?: tab.title,
                    modifier = Modifier
                        .background(
                            Brush.linearGradient(
                                if (selected) {
                                    listOf(selectedColor, selectedColor.copy(alpha = 0.78f))
                                } else {
                                    listOf(
                                        MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                                        selectedColor.copy(alpha = 0.08f),
                                    )
                                },
                            ),
                        )
                        .border(
                            0.8.dp,
                            if (selected) {
                                Color.White.copy(alpha = 0.46f)
                            } else {
                                MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.52f)
                            },
                            shape,
                        )
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
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
                        if (isOwnerProSubscriber) {
                            ProBadge(variant = ProBadgeVariant.Small)
                        }
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

private fun stripHtmlForPreview(html: String): String =
    HtmlCompat.fromHtml(html, HtmlCompat.FROM_HTML_MODE_COMPACT)
        .toString()
        .trim()

private fun Color.isLight(): Boolean {
    // WCAG luminance formula
    val luminance = 0.299f * red + 0.587f * green + 0.114f * blue
    return luminance > 0.5f
}

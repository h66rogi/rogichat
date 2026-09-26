package chat.rogi.rogichat.feature.channel.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import com.adamglin.PhosphorIcons
import com.adamglin.phosphoricons.Regular
import com.adamglin.phosphoricons.regular.ArrowSquareOut
import com.adamglin.phosphoricons.regular.Article
import com.adamglin.phosphoricons.regular.ChartBar
import com.adamglin.phosphoricons.regular.Folder
import com.adamglin.phosphoricons.regular.Link
import com.adamglin.phosphoricons.regular.MusicNote
import com.adamglin.phosphoricons.regular.Scroll
import com.adamglin.phosphoricons.regular.Star
import com.adamglin.phosphoricons.regular.User
import com.adamglin.phosphoricons.regular.Users
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import chat.rogi.rogichat.channelport.core.common.util.DateUtils
import chat.rogi.rogichat.channelport.core.common.util.ExternalBrowserHandler
import chat.rogi.rogichat.channelport.core.common.util.HtmlText
import chat.rogi.rogichat.channelport.core.model.channel.Channel
import chat.rogi.rogichat.channelport.core.model.channel.ChannelProfile
import chat.rogi.rogichat.feature.channel.InfoState

fun LazyListScope.infoTabContent(
    channel: Channel,
    state: InfoState,
    favoritesCount: Int,
) {
    val themeColor = parseThemeColor(channel.themeColor)

    // Top padding
    item(key = "info_top_padding") {
        Spacer(modifier = Modifier.height(16.dp))
    }

    // Description
    channel.channelDescription?.takeIf { it.isNotBlank() }?.let { description ->
        item(key = "info_description") {
            InfoSection(
                icon = PhosphorIcons.Regular.Article,
                title = "프로필 설명",
                themeColor = themeColor,
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                HtmlText(
                    html = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }

        // Section divider
        item(key = "info_description_divider") {
            SectionDivider()
        }
    }

    // Links
    val hasLinks = channel.platformUrl != null || channel.additionalLinks.isNotEmpty()
    if (hasLinks) {
        item(key = "info_links") {
            InfoSection(
                icon = PhosphorIcons.Regular.Link,
                title = "링크",
                themeColor = themeColor,
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    channel.platformUrl?.let { platformUrl ->
                        LinkButton(
                            title = "방송 플랫폼",
                            url = platformUrl,
                        )
                    }

                    channel.additionalLinks.forEach { link ->
                        LinkButton(
                            title = link.name,
                            url = link.url,
                        )
                    }
                }
            }
        }

        // Section divider
        item(key = "info_links_divider") {
            SectionDivider()
        }
    }

    // Profile
    if (state.isLoading) {
        item(key = "info_profile_loading") {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(100.dp),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    } else if (state.profile != null) {
        val profileItems = buildProfileItems(state.profile)
        if (profileItems.isNotEmpty()) {
            item(key = "info_profile") {
                InfoSection(
                    icon = PhosphorIcons.Regular.User,
                    title = "채널 프로필",
                    themeColor = themeColor,
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    ProfileTable(
                        items = profileItems,
                        themeColor = themeColor,
                    )
                }
            }

            // Section divider
            item(key = "info_profile_divider") {
                SectionDivider()
            }
        }

        // Bio
        state.profile.bio?.takeIf { it.isNotBlank() }?.let { bio ->
            item(key = "info_bio") {
                InfoSection(
                    icon = PhosphorIcons.Regular.Scroll,
                    title = "약력",
                    themeColor = themeColor,
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    Text(
                        text = bio,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        lineHeight = MaterialTheme.typography.bodyMedium.lineHeight * 1.4f,
                    )
                }
            }

            // Section divider
            item(key = "info_bio_divider") {
                SectionDivider()
            }
        }
    }

    // Stats
    item(key = "info_stats") {
        InfoSection(
            icon = PhosphorIcons.Regular.ChartBar,
            title = "채널 통계",
            themeColor = themeColor,
            modifier = Modifier.padding(horizontal = 20.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatItemWithIcon(
                    icon = PhosphorIcons.Regular.MusicNote,
                    value = channel.songCount.toString(),
                    label = "곡",
                    modifier = Modifier.weight(1f),
                )
                StatItemWithIcon(
                    icon = PhosphorIcons.Regular.Users,
                    value = channel.artistCount.toString(),
                    label = "아티스트",
                    modifier = Modifier.weight(1f),
                )
                StatItemWithIcon(
                    icon = PhosphorIcons.Regular.Folder,
                    value = channel.categoryCount.toString(),
                    label = "카테고리",
                    modifier = Modifier.weight(1f),
                )
                StatItemWithIcon(
                    icon = PhosphorIcons.Regular.Star,
                    value = favoritesCount.toString(),
                    label = "즐겨찾기",
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }

    // Bottom padding
    item(key = "info_bottom_padding") {
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun InfoSection(
    icon: ImageVector,
    title: String,
    themeColor: Color,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val accessibleThemeColor = getAccessibleColor(themeColor)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(bottom = 20.dp),
    ) {
        // Section header with icon
        Row(
            modifier = Modifier.padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = accessibleThemeColor,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = accessibleThemeColor,
            )
        }

        // Content without card
        content()
    }
}

@Composable
private fun SectionDivider() {
    Spacer(modifier = Modifier.height(8.dp))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(8.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
    )
    Spacer(modifier = Modifier.height(16.dp))
}

@Composable
private fun LinkButton(
    title: String,
    url: String,
) {
    val context = LocalContext.current
    val isExternal = ExternalBrowserHandler.shouldOpenExternally(url)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = {
                    ExternalBrowserHandler.openUrl(context, url)
                },
            )
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = PhosphorIcons.Regular.Link,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        Icon(
            imageVector = PhosphorIcons.Regular.ArrowSquareOut,
            contentDescription = if (isExternal) "외부 앱에서 열기" else "열기",
            tint = if (isExternal) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun ProfileTable(
    items: List<Pair<String, String>>,
    themeColor: Color,
) {
    val accessibleThemeColor = getAccessibleColor(themeColor)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        items.forEachIndexed { index, (label, value) ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = accessibleThemeColor,
                    modifier = Modifier.width(90.dp),
                )
                Text(
                    text = value,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            }

            if (index < items.lastIndex) {
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 14.dp),
                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f),
                    thickness = 0.5.dp,
                )
            }
        }
    }
}

@Composable
private fun StatItemWithIcon(
    icon: ImageVector,
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(vertical = 12.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun buildProfileItems(profile: ChannelProfile): List<Pair<String, String>> {
    val items = mutableListOf<Pair<String, String>>()

    profile.nickname?.takeIf { it.isNotBlank() }?.let {
        items.add("닉네임" to it)
    }
    profile.birthday?.takeIf { it.isNotBlank() }?.let {
        items.add("생일" to formatBirthday(it))
    }
    profile.residence?.takeIf { it.isNotBlank() }?.let {
        items.add("거주지" to it)
    }
    profile.nationality?.takeIf { it.isNotBlank() }?.let {
        items.add("국적" to it)
    }
    profile.gender?.takeIf { it.isNotBlank() }?.let {
        items.add("성별" to formatGender(it))
    }
    profile.height?.takeIf { it.isNotBlank() }?.let {
        items.add("키" to it)
    }
    profile.weightKg?.takeIf { it.isNotBlank() }?.let {
        items.add("몸무게" to it)
    }
    profile.mbti?.takeIf { it.isNotBlank() }?.let {
        items.add("MBTI" to it)
    }
    profile.symbolColor?.takeIf { it.isNotBlank() }?.let {
        items.add("상징 색상" to it)
    }
    profile.agency?.takeIf { it.isNotBlank() }?.let {
        items.add("소속사" to it)
    }
    profile.fandomName?.takeIf { it.isNotBlank() }?.let {
        items.add("팬덤명" to it)
    }
    profile.religion?.takeIf { it.isNotBlank() }?.let {
        items.add("종교" to it)
    }
    profile.debutDate?.takeIf { it.isNotBlank() }?.let {
        items.add("데뷔일" to formatDate(it))
    }
    profile.alias?.takeIf { it.isNotEmpty() }?.let {
        items.add("별명" to it.joinToString(", "))
    }
    profile.affiliatedGroups?.takeIf { it.isNotEmpty() }?.let {
        items.add("소속 그룹" to it.joinToString(", "))
    }
    profile.broadcastingPlatforms?.takeIf { it.isNotEmpty() }?.let {
        items.add("방송 플랫폼" to it.joinToString(", "))
    }
    profile.education?.takeIf { it.isNotEmpty() }?.let {
        items.add("학력" to it.joinToString(", "))
    }

    return items
}

private fun formatGender(gender: String): String {
    return when (gender.uppercase()) {
        "MALE" -> "남성"
        "FEMALE" -> "여성"
        "NONBINARY" -> "논바이너리"
        "SECRET" -> "비공개"
        else -> gender
    }
}

private fun formatBirthday(dateString: String): String {
    return try {
        val date = java.time.LocalDate.parse(dateString.substringBefore("T"))
        val year = date.year

        if (year == 1900) {
            // 연도가 1900년이면 월/일만 표시
            "${date.monthValue}월 ${date.dayOfMonth}일"
        } else {
            "${year}년 ${date.monthValue}월 ${date.dayOfMonth}일"
        }
    } catch (e: Exception) {
        dateString
    }
}

private fun formatDate(dateString: String): String {
    return DateUtils.formatKoreanDate(DateUtils.parseIso(dateString)).ifEmpty {
        dateString.substringBefore("T")
    }
}

private fun parseThemeColor(hexColor: String): Color {
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

@Composable
private fun getAccessibleColor(color: Color): Color {
    val isDarkTheme = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val backgroundLuminance = if (isDarkTheme) 0.1f else 0.95f
    val colorLuminance = color.luminance()

    // Calculate contrast ratio
    val lighter = maxOf(backgroundLuminance, colorLuminance)
    val darker = minOf(backgroundLuminance, colorLuminance)
    val contrastRatio = (lighter + 0.05f) / (darker + 0.05f)

    // WCAG AA requires 4.5:1 for normal text, use 3.0 as threshold for UI elements
    return if (contrastRatio < 3.0f) {
        if (isDarkTheme) Color.White else Color.Black
    } else {
        color
    }
}

private fun Color.luminance(): Float {
    return 0.299f * red + 0.587f * green + 0.114f * blue
}

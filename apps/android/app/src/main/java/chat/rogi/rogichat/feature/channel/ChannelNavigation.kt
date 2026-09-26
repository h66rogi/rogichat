package chat.rogi.rogichat.feature.channel

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import chat.rogi.rogichat.channelport.ChannelGraph
import chat.rogi.rogichat.channelport.core.designsystem.theme.MelomingTheme
import chat.rogi.rogichat.feature.channel.console.ConsoleScreen

/** Rogichat navigation supplies the original feature's callbacks and ViewModels. */
@Composable
fun ChannelNavigation(graph: ChannelGraph, onBack: () -> Unit, onTalk: () -> Unit) {
    val nav = rememberNavController()
    var revision by remember { mutableIntStateOf(0) }
    val finish: () -> Unit = { revision++; nav.popBackStack() }
    MelomingTheme {
        NavHost(navController = nav, startDestination = "detail") {
            composable("detail") {
                ChannelDetailScreen(
                    onNavigateBack = onBack,
                    onNavigateToAddSong = { nav.navigate("add-song/$it") },
                    onNavigateToEditSong = { nav.navigate("edit-song/$it") },
                    onNavigateToAddSchedule = { nav.navigate("add-schedule/$it") },
                    onNavigateToCategoryManagement = { nav.navigate("categories/$it") },
                    onNavigateToChannelSettings = { nav.navigate("settings") },
                    onNavigateToConsole = { _, id -> nav.navigate("console/$id") },
                    onNavigateToLogin = onTalk,
                    refreshChannel = revision > 0,
                    onRefreshConsumed = { revision = 0 },
                    viewModel = viewModel { graph.detail(createSavedStateHandle()) },
                )
            }
            composable("add-song/{id}") { entry ->
                AddSongScreen({ nav.popBackStack() }, finish, viewModel { graph.addSong(createSavedStateHandle(), entry.arguments!!.getString("id")!!.toInt()) })
            }
            composable("edit-song/{id}") { entry ->
                EditSongScreen({ nav.popBackStack() }, finish, finish, viewModel { graph.editSong(createSavedStateHandle(), entry.arguments!!.getString("id")!!.toInt()) })
            }
            composable("add-schedule/{id}") { entry ->
                AddScheduleScreen({ nav.popBackStack() }, finish, viewModel { graph.addSchedule(createSavedStateHandle(), entry.arguments!!.getString("id")!!.toInt()) })
            }
            composable("settings") {
                ChannelSettingsScreen({ nav.popBackStack() }, finish, viewModel { graph.settings(createSavedStateHandle()) })
            }
            composable("categories/{id}") { entry ->
                CategoryManagementScreen(finish, viewModel { graph.categories(createSavedStateHandle(), entry.arguments!!.getString("id")!!.toInt()) })
            }
            composable("console/{id}") { entry ->
                ConsoleScreen(finish, viewModel { graph.console(createSavedStateHandle(), entry.arguments!!.getString("id")!!.toInt()) })
            }
        }
    }
}

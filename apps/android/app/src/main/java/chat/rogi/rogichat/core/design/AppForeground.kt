package chat.rogi.rogichat.core.design

import androidx.compose.runtime.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import chat.rogi.rogichat.core.navigation.ForegroundState

val LocalForegroundEpoch = staticCompositionLocalOf { 0L }

@Composable
fun AppForeground(content: @Composable () -> Unit) {
    val owner = LocalLifecycleOwner.current
    var state by remember { mutableStateOf(ForegroundState()) }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) state = state.transition(true)
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) state = state.transition(false)
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    CompositionLocalProvider(LocalForegroundEpoch provides state.epoch, content = content)
}

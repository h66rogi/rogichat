package chat.rogi.rogichat.core.navigation

// One app-shell source. Repeated active callbacks do not create duplicate refresh epochs.
data class ForegroundState(val active: Boolean = false, val epoch: Long = 0) {
    fun transition(value: Boolean) = if (value == active) this
        else copy(active = value, epoch = if (value) epoch + 1 else epoch)
}

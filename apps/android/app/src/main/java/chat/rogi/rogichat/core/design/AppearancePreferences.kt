package chat.rogi.rogichat.core.design

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class Appearance(val title: String) {
    SYSTEM("시스템 설정"), LIGHT("라이트 모드"), DARK("다크 모드");
    companion object {
        fun fromStorage(value: String?) = entries.find { it.name == value } ?: SYSTEM
    }
}

// Adapted SharedPreferences + StateFlow persistence from the reference preference store.
// Environment switching/developer toggles are deliberately not part of product preferences.
class AppearancePreferences(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("appearance", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(Appearance.fromStorage(prefs.getString("mode", null)))
    val mode: StateFlow<Appearance> = mutable.asStateFlow()
    fun select(value: Appearance) {
        prefs.edit { putString("mode", value.name) }
        mutable.value = value
    }
}

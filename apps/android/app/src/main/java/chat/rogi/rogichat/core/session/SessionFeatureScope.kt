package chat.rogi.rogichat.core.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import chat.rogi.rogichat.core.navigation.ShellAccess

data class SessionScopeKey(val generation: Long, val access: ShellAccess, val accountId: String?)

/** Retains feature ViewModels over rotation, but never across an account/access scope change. */
class SessionFeatureScope : ViewModel() {
    private var currentKey: SessionScopeKey? = null
    private var currentOwner: ViewModelStoreOwner? = null
    fun ownerFor(key: SessionScopeKey): ViewModelStoreOwner {
        if (currentKey != key || currentOwner == null) {
            currentOwner?.viewModelStore?.clear()
            currentKey = key
            currentOwner = object : ViewModelStoreOwner { override val viewModelStore = ViewModelStore() }
        }
        return requireNotNull(currentOwner)
    }
    override fun onCleared() {
        currentOwner?.viewModelStore?.clear()
        currentOwner = null
        currentKey = null
    }
}

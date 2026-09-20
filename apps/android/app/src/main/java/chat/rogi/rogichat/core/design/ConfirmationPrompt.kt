package chat.rogi.rogichat.core.design

import androidx.compose.material3.*
import androidx.compose.runtime.Composable

@Composable
fun ConfirmationPrompt(title: String, message: String, confirmLabel: String, onDismiss: () -> Unit,
                       onConfirm: () -> Unit, enabled: Boolean = true) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(message) },
        confirmButton = { TextButton(onClick = onConfirm, enabled = enabled) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("취소") } })
}

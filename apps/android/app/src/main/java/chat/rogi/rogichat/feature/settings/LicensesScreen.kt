package chat.rogi.rogichat.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Adapted license list presentation; notices match only this app's runtime dependencies.
@Composable
fun LicensesScreen() {
    val context = LocalContext.current
    var notices by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                listOf("apache-2.0.txt", "kotlin.txt", "phosphor-compose.txt", "phosphor-icons.txt", "network.txt")
                    .joinToString("\n\n") { context.assets.open("licenses/$it").bufferedReader().use { reader -> reader.readText() } }
            }
        }.onSuccess { notices = it }.onFailure { failed = true }
    }
    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("로기챗은 다음 오픈소스 소프트웨어를 사용합니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        LicenseItem("AndroidX · Jetpack Compose", "Apache License 2.0", "Copyright The Android Open Source Project")
        LicenseItem("Kotlin · Kotlinx Coroutines", "Apache License 2.0", "Copyright JetBrains s.r.o.")
        LicenseItem("Ktor · Kotlinx Serialization · Kotlinx IO", "Apache License 2.0", "Copyright JetBrains s.r.o. and contributors")
        LicenseItem("OkHttp · Okio", "Apache License 2.0", "Copyright Square, Inc. and contributors")
        LicenseItem("SLF4J", "MIT License", "Copyright (c) 2004–2022 QOS.ch Sarl")
        LicenseItem("Compose Phosphor Icons", "MIT License", "Copyright (c) 2024 Adamglin")
        LicenseItem("Phosphor Icons", "MIT License", "Copyright (c) 2023 Phosphor Icons")
        when {
            notices != null -> SelectionContainer { Text(notices!!, style = MaterialTheme.typography.bodySmall) }
            failed -> Text("라이선스를 불러오지 못했어요.", color = MaterialTheme.colorScheme.error)
            else -> CircularProgressIndicator(Modifier.size(24.dp))
        }
    }
}

@Composable
private fun LicenseItem(name: String, license: String, copyright: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(license, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        Text(copyright, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

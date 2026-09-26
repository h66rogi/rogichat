import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission

plugins {
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}

val releaseBuildNumber = providers.gradleProperty("rogichatBuildNumber").orElse("1").get().toInt()
val releaseVersion = providers.gradleProperty("rogichatVersion").orElse("0.1.0").get()
require(releaseBuildNumber in 1..2100000000) { "Invalid build number" }
require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(releaseVersion)) { "Invalid version" }
val qaSigningKeys = listOf("ROGICHAT_QA_KEYSTORE", "ROGICHAT_QA_STORE_PASSWORD", "ROGICHAT_QA_KEY_ALIAS")
val qaSigning = qaSigningKeys.map { providers.environmentVariable(it).orNull }
require(qaSigning.all { it == null } || qaSigning.all { !it.isNullOrBlank() }) {
    "QA signing requires all ROGICHAT_QA signing variables"
}

val prodSigningKeys = listOf("ROGICHAT_PROD_KEYSTORE", "ROGICHAT_PROD_STORE_PASSWORD", "ROGICHAT_PROD_KEY_ALIAS")
val prodSigning = prodSigningKeys.map { providers.environmentVariable(it).orNull }
require(prodSigning.all { it == null } || prodSigning.all { !it.isNullOrBlank() }) {
    "Prod signing requires all ROGICHAT_PROD signing variables"
}

fun firebaseConfig(environment: String): Map<String, String>? {
    val path = providers.environmentVariable("ROGICHAT_${environment.uppercase()}_FIREBASE_CONFIG_FILE").orNull ?: return null
    require(File(path).isAbsolute) { "Firebase config path must be absolute" }
    val source = file(path)
    require(source.isAbsolute && source.canonicalFile == source.absoluteFile && source.isFile && source.length() in 1..16384) { "Invalid Firebase config file" }
    require(Files.getPosixFilePermissions(source.toPath()) == setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)) { "Firebase config must be mode 600" }
    require((Files.getAttribute(source.toPath(), "unix:nlink") as Number).toInt() == 1) { "Invalid Firebase config file" }
    val text = source.readText(Charsets.UTF_8).trim()
    require(text.startsWith('{') && text.endsWith('}')) { "Invalid Firebase config" }
    // This flat identifier-only format deliberately rejects escapes and duplicate keys.
    val field = Regex("""\s*"([A-Za-z]+)"\s*:\s*"([A-Za-z0-9_.:-]+)"\s*""")
    val pairs = text.substring(1, text.length - 1).split(',').map { field.matchEntire(it)?.destructured?.let { (key, value) -> key to value } ?: error("Invalid Firebase config") }
    val keys = setOf("environment", "packageName", "applicationId", "apiKey", "projectId", "gcmSenderId")
    require(pairs.size == keys.size && pairs.map { it.first }.toSet() == keys) { "Incomplete or duplicate Firebase config" }
    val value = pairs.toMap()
    require(value.getValue("environment") == environment && value.getValue("packageName") == "chat.rogi.rogichat" + (if (environment == "qa") ".qa" else "")) { "Firebase environment mismatch" }
    require(value.getValue("applicationId").matches(Regex("1:[0-9]+:android:[a-f0-9]+")) && value.getValue("gcmSenderId").matches(Regex("[0-9]+"))) { "Invalid Firebase app identity" }
    require(value.getValue("applicationId").split(':')[1] == value.getValue("gcmSenderId")) { "Firebase sender mismatch" }
    require(value.getValue("projectId").matches(Regex("[a-z][a-z0-9-]{4,61}[a-z0-9]")) && value.getValue("apiKey").matches(Regex("[A-Za-z0-9_-]{20,256}"))) { "Invalid Firebase configuration" }
    return value
}
val firebaseByEnvironment = listOf("qa", "prod").associateWith(::firebaseConfig)

android {
    namespace = "chat.rogi.rogichat"
    compileSdk = 37
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "chat.rogi.rogichat"
        minSdk = 29
        targetSdk = 37
        versionCode = releaseBuildNumber
        versionName = releaseVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    if (qaSigning.all { it != null }) {
        signingConfigs.create("qaRelease") {
            storeFile = file(qaSigning[0]!!)
            storePassword = qaSigning[1]
            keyPassword = qaSigning[1]
            keyAlias = qaSigning[2]
        }
    }
    if (prodSigning.all { it != null }) {
        signingConfigs.create("prodRelease") {
            storeFile = file(prodSigning[0]!!)
            storePassword = prodSigning[1]
            keyPassword = prodSigning[1]
            keyAlias = prodSigning[2]
        }
    }
    flavorDimensions += "environment"
    productFlavors {
        create("qa") {
            dimension = "environment"
            applicationIdSuffix = ".qa"
            signingConfig = signingConfigs.findByName("qaRelease")
            versionNameSuffix = "-qa"
            resValue("string", "app_name", "로기챗 QA")
            buildConfigField("String", "ENVIRONMENT", "\"qa\"")
            buildConfigField("String", "API_BASE_URL", "\"https://api.qa.rogi.chat/v1/\"")
            manifestPlaceholders["environment"] = "qa"
            manifestPlaceholders["authHost"] = "qa.rogi.chat"
            manifestPlaceholders["apiBaseURL"] = "https://api.qa.rogi.chat/v1/"
        }
        create("prod") {
            dimension = "environment"
            signingConfig = signingConfigs.findByName("prodRelease")
            resValue("string", "app_name", "로기챗")
            buildConfigField("String", "ENVIRONMENT", "\"prod\"")
            buildConfigField("String", "API_BASE_URL", "\"https://api.rogi.chat/v1/\"")
            manifestPlaceholders["environment"] = "prod"
            manifestPlaceholders["authHost"] = "rogi.chat"
            manifestPlaceholders["apiBaseURL"] = "https://api.rogi.chat/v1/"
        }
    }
    productFlavors.configureEach {
        val config = firebaseByEnvironment[name]
        resValue("string", "rogi_firebase_application_id", config?.getValue("applicationId").orEmpty())
        resValue("string", "rogi_firebase_api_key", config?.getValue("apiKey").orEmpty())
        resValue("string", "rogi_firebase_project_id", config?.getValue("projectId").orEmpty())
        resValue("string", "rogi_firebase_sender_id", config?.getValue("gcmSenderId").orEmpty())
    }
    buildTypes {
        release {
            // Store signing is configured only in a separate trusted release workflow.
            signingConfig = null
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint {
        warningsAsErrors = true
        checkReleaseBuilds = true
    }
}
kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}
dependencyLocking {
    lockAllConfigurations()
    lockMode = LockMode.STRICT
}
room { schemaDirectory("$projectDir/src/androidTest/schemas") }

dependencies {
    implementation(libs.reorderable)
    implementation(libs.colorpicker)
    implementation(libs.coil.compose)
    implementation(libs.coil.network)
    implementation(libs.timber)
    implementation(libs.ktor.content)
    implementation(libs.ktor.json)
    implementation(libs.compose.icons)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.socket.io) { exclude(group = "org.json", module = "json") }
    implementation(libs.room.runtime)
    ksp(libs.room.compiler)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.phosphor)
    implementation(libs.ktor.core)
    implementation(libs.ktor.okhttp)
    implementation(libs.serialization.json)
    testImplementation(libs.json.test) // Actual JSONObject for JVM Socket.IO wire assertions; absent from app APK.
    testImplementation(libs.junit)
    testImplementation(libs.ktor.mock)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(libs.android.test.runner)
    androidTestImplementation(libs.android.test.core)
    androidTestImplementation(libs.android.test.junit)
}

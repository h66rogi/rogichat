plugins {
    alias(libs.plugins.android.application)
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
    }
    if (qaSigning.all { it != null }) {
        signingConfigs.create("qaRelease") {
            storeFile = file(qaSigning[0]!!)
            storePassword = qaSigning[1]
            keyPassword = qaSigning[1]
            keyAlias = qaSigning[2]
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
            manifestPlaceholders["apiBaseURL"] = "https://api.qa.rogi.chat/v1/"
        }
        create("prod") {
            dimension = "environment"
            resValue("string", "app_name", "로기챗")
            buildConfigField("String", "ENVIRONMENT", "\"prod\"")
            buildConfigField("String", "API_BASE_URL", "\"https://api.rogi.chat/v1/\"")
            manifestPlaceholders["environment"] = "prod"
            manifestPlaceholders["apiBaseURL"] = "https://api.rogi.chat/v1/"
        }
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
dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.phosphor)
    testImplementation(libs.junit)
}

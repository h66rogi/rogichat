plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "chat.rogi.rogichat"
    compileSdk = 37
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "chat.rogi.rogichat"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }
    flavorDimensions += "environment"
    productFlavors {
        create("qa") {
            dimension = "environment"
            applicationIdSuffix = ".qa"
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
            isMinifyEnabled = false
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
    testImplementation(libs.junit)
}

plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

apply(from = "build-report.gradle.kts")
apply(from = "voice-test.gradle.kts")

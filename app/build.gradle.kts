plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Every GitHub build gets a higher number, so a new APK installs over the old one.
val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.kaivra.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kaivra.app"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "0.1.$buildNumber"
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Hearing: Vosk, open-source offline speech recognition (Apache 2.0)
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}

/**
 * The voice's pronunciation dictionary (CMU Pronouncing Dictionary, Carnegie Mellon University, BSD licence),
 * fetched while building and packed into the app. If it can't be fetched, the voice uses its own spelling rules.
 */
abstract class FetchVoiceDictionary : DefaultTask() {
    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun fetch() {
        val f = outputDir.get().file("voice/cmudict.dict").asFile
        if (f.isFile && f.length() > 1_000_000) return
        f.parentFile.mkdirs()
        try {
            java.net.URI("https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict").toURL().openStream().use { input ->
                f.outputStream().use { input.copyTo(it) }
            }
            logger.lifecycle("Kaivra: pronunciation dictionary ready (${f.length()} bytes)")
        } catch (e: Exception) {
            f.delete()
            logger.warn("Kaivra: could not fetch the pronunciation dictionary (${e.message}); the voice will use its own spelling rules")
        }
    }
}

androidComponents {
    onVariants { variant ->
        // one task per build type, as the Android Gradle plugin expects for generated sources
        val name = "fetch" + variant.name.replaceFirstChar { it.uppercase() } + "VoiceDictionary"
        val fetch = tasks.register<FetchVoiceDictionary>(name)
        variant.sources.assets?.addGeneratedSourceDirectory(fetch, FetchVoiceDictionary::outputDir)
    }
}

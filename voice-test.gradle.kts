// Runs Kaivra's voice listening test (brain/voice/voice_check.sh) after a successful GitHub build
// whose commit message contains [voice-test]. The report goes to the voice-log branch. Never affects the app.
@Suppress("DEPRECATION")
gradle.buildFinished {
    if (this.failure != null || System.getenv("GITHUB_ACTIONS") != "true") return@buildFinished
    val root = rootDir
    try {
        val msg = ProcessBuilder("git", "-C", root.path, "log", "-1", "--format=%B").start().inputStream.bufferedReader().readText()
        if (!msg.contains("[voice-test]")) return@buildFinished
        val pb = ProcessBuilder("bash", File(root, "brain/voice/voice_check.sh").path).directory(root).redirectErrorStream(true)
        pb.environment()["KAIVRA_FROM_GRADLE"] = "1"
        val proc = pb.start()
        proc.inputStream.bufferedReader().forEachLine { println("[voice-test] $it") }
        proc.waitFor()
    } catch (e: Exception) {
        println("[voice-test] could not run: ${e.message}")
    }
}

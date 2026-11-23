// Trains Kaivra's own brain (brain/ci.sh) after a successful GitHub build whose commit message contains
// [brain-train]: builds the training data and knowledge library from Simple English Wikipedia when needed, trains the
// brain from its last checkpoint, and publishes brain, library and hearing to the kaivra-packs release, where the app
// downloads them. The log goes to the brain-log branch. Never affects the app itself.
@Suppress("DEPRECATION")
gradle.buildFinished {
    if (this.failure != null || System.getenv("GITHUB_ACTIONS") != "true") return@buildFinished
    val root = rootDir
    try {
        val msg = ProcessBuilder("git", "-C", root.path, "log", "-1", "--format=%B").start().inputStream.bufferedReader().readText()
        if (!msg.contains("[brain-train]")) return@buildFinished
        val pb = ProcessBuilder("bash", File(root, "brain/ci.sh").path).directory(root).redirectErrorStream(true)
        pb.environment()["KAIVRA_FROM_GRADLE"] = "1"
        val proc = pb.start()
        proc.inputStream.bufferedReader().forEachLine { println("[brain] $it") }
        proc.waitFor()
    } catch (e: Exception) {
        println("[brain] could not run: ${e.message}")
    }
}

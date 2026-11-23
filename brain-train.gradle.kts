// After a successful GitHub build, runs Kaivra's brain jobs named in the commit message:
//  [mind-build]  converts, tests and publishes the thinking brain, the open Qwen3.5 model (brain/mind/mind_build.sh)
//  [brain-train] builds the data and knowledge library from Simple English Wikipedia when needed, trains Kaivra's own
//                small brain from its last checkpoint, and publishes it (brain/ci.sh)
// Everything is published to the kaivra-packs release, where the app downloads it. Never affects the app itself.
@Suppress("DEPRECATION")
gradle.buildFinished {
    if (this.failure != null || System.getenv("GITHUB_ACTIONS") != "true") return@buildFinished
    val root = rootDir
    try {
        val msg = ProcessBuilder("git", "-C", root.path, "log", "-1", "--format=%B").start().inputStream.bufferedReader().readText()
        // [mind-build]: Kaivra's thinking brain (the open Qwen3.5 model) is converted, tested and published
        val jobs = listOf("[mind-build]" to "brain/mind/mind_build.sh", "[brain-train]" to "brain/ci.sh")
        for ((tag, script) in jobs) {
            if (!msg.contains(tag)) continue
            val pb = ProcessBuilder("bash", File(root, script).path).directory(root).redirectErrorStream(true)
            pb.environment()["KAIVRA_FROM_GRADLE"] = "1"
            val proc = pb.start()
            proc.inputStream.bufferedReader().forEachLine { println("[brain] $it") }
            proc.waitFor()
        }
    } catch (e: Exception) {
        println("[brain] could not run: ${e.message}")
    }
}

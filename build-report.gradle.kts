// When a build on GitHub fails, saves what went wrong to the "build-log" branch, so it can be read without signing in.
// Does nothing on a successful build or outside GitHub Actions.
val kaivraLog = java.util.Collections.synchronizedList(mutableListOf<String>())

gradle.allprojects {
    tasks.configureEach {
        val path = this.path
        logging.addStandardOutputListener { kaivraLog.add("[$path] $it") }
        logging.addStandardErrorListener { kaivraLog.add("[$path] $it") }
    }
}

@Suppress("DEPRECATION")
gradle.buildFinished {
    val failure = this.failure ?: return@buildFinished
    if (System.getenv("GITHUB_ACTIONS") != "true") return@buildFinished
    val text = StringBuilder()
    text.append("Build failed: ").append(java.time.Instant.now()).append("\n\nWhat went wrong:\n")
    var e: Throwable? = failure
    var depth = 0
    while (e != null && depth < 12) {
        text.append("  ".repeat(depth)).append(e.javaClass.simpleName).append(": ").append(e.message).append("\n")
        e = e.cause
        depth++
    }
    val lines = synchronized(kaivraLog) { kaivraLog.toList() }
    text.append("\nCompiler and task messages:\n")
    lines.filter { it.contains("e: ") || it.contains("error", ignoreCase = true) || it.contains("warning:") || it.contains("Could not") }
        .take(300).forEach { text.append(it.trimEnd()).append("\n") }
    text.append("\nLast task output:\n")
    lines.takeLast(200).forEach { text.append(it.trimEnd()).append("\n") }

    val root = rootDir
    val file = java.io.File(root, "build/kaivra-build-log.txt")
    file.parentFile.mkdirs()
    file.writeText(text.toString())
    fun git(vararg args: String, input: String? = null): String {
        val p = ProcessBuilder(listOf("git", "-C", root.path) + args).redirectErrorStream(true).start()
        if (input != null) p.outputStream.use { it.write(input.toByteArray()) } else p.outputStream.close()
        val out = p.inputStream.bufferedReader().readText().trim()
        p.waitFor()
        return out
    }
    try {
        val blob = git("hash-object", "-w", file.path)
        val tree = git("mktree", input = "100644 blob $blob\tbuild-log.txt\n")
        val commit = git("-c", "user.name=kaivra-builder", "-c", "user.email=kaivra-builder@users.noreply.github.com",
            "commit-tree", tree, "-m", "Build log " + (System.getenv("GITHUB_RUN_NUMBER") ?: ""))
        println(git("push", "-f", "origin", "$commit:refs/heads/build-log"))
    } catch (ex: Exception) {
        println("Could not publish the build log: ${ex.message}")
    }
}

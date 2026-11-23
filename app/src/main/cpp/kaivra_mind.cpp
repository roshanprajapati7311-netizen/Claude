// Kaivra's thinking brain on the phone: the bridge between KaivraMind.java and the llama.cpp engine (MIT licence),
// which runs an open language model stored as a GGUF file. Written for llama.cpp v1.0.0.
//
// The conversation is kept in the engine's memory between replies: when the next prompt starts with everything the
// memory already holds (the usual case in a conversation), only the new part is read.
#include <jni.h>

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

#include "llama.h"

#ifdef __ANDROID__
#include <android/log.h>
#define KLOG(...) __android_log_print(ANDROID_LOG_WARN, "KaivraMind", __VA_ARGS__)
#else
#define KLOG(...) do { fprintf(stderr, __VA_ARGS__); fputc('\n', stderr); } while (0)
#endif

namespace {

struct Mind {
    llama_model * model = nullptr;
    llama_context * ctx = nullptr;
    const llama_vocab * vocab = nullptr;
    llama_batch_ext * batch = nullptr;
    std::vector<llama_token> held;  // the tokens whose state the engine's memory holds, in order
    std::vector<llama_token> base;  // the start every conversation shares (Kaivra's instructions)...
    std::vector<uint8_t> base_state; // ...and the engine's memory right after reading it
    int n_batch = 512;
};

bool g_started = false;

void log_errors(enum ggml_log_level level, const char * text, void *) {
    if (level >= GGML_LOG_LEVEL_ERROR) KLOG("%s", text);
}

// bytes at the end of s that are the start of a character not yet complete (UTF-8)
size_t incomplete_tail(const std::string & s) {
    const size_t n = s.size();
    for (size_t k = 1; k <= 4 && k <= n; k++) {
        const unsigned char c = (unsigned char) s[n - k];
        if ((c & 0xC0) == 0x80) continue;  // a continuation byte: look further back
        size_t need = 1;
        if ((c & 0xE0) == 0xC0) need = 2;
        else if ((c & 0xF0) == 0xE0) need = 3;
        else if ((c & 0xF8) == 0xF0) need = 4;
        return need > k ? k : 0;
    }
    return 0;
}

// runs tokens [from, to) of toks through the model at their positions; logits only for the very last one
bool feed(Mind * m, const std::vector<llama_token> & toks, size_t from, size_t to) {
    for (size_t i = from; i < to; i += (size_t) m->n_batch) {
        const size_t cnt = std::min((size_t) m->n_batch, to - i);
        llama_batch_ext_clear(m->batch);
        int32_t last = -1;
        for (size_t j = 0; j < cnt; j++) {
            last = llama_batch_ext_add_token(m->batch, 0, toks[i + j]);
            if (last < 0) return false;
            const llama_pos pos = (llama_pos) (i + j);
            llama_batch_ext_set_pos(m->batch, last, &pos);
        }
        if (i + cnt == to) llama_batch_ext_set_output_logits(m->batch, last, true);
        if (llama_process(m->ctx, LLAMA_PROCESS_TYPE_DECODE, m->batch) != 0) return false;
    }
    return true;
}

bool send(JNIEnv * env, jobject sink, jmethodID on_bytes, const std::string & bytes) {
    if (!sink || !on_bytes || bytes.empty()) return true;
    jbyteArray arr = env->NewByteArray((jsize) bytes.size());
    env->SetByteArrayRegion(arr, 0, (jsize) bytes.size(), (const jbyte *) bytes.data());
    const jboolean go = env->CallBooleanMethod(sink, on_bytes, arr);
    env->DeleteLocalRef(arr);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
        return false;
    }
    return go == JNI_TRUE;
}

}  // namespace

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_kaivra_app_KaivraMind_nativeLoad(JNIEnv * env, jclass, jstring jpath, jint threads, jint n_ctx) {
    if (!g_started) {
        llama_log_set(log_errors, nullptr);
        llama_backend_init();
        g_started = true;
    }
    const char * path = env->GetStringUTFChars(jpath, nullptr);
    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    mp.progress_callback = [](float, void *) { return true; };  // no loading dots in the log
    llama_model * model = llama_model_load_from_file(path, mp);
    env->ReleaseStringUTFChars(jpath, path);
    if (!model) return 0;

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) n_ctx;
    cp.n_batch = 512;
    cp.n_ubatch = 512;
    cp.n_seq_max = 1;
    cp.n_threads = threads;
    cp.n_threads_batch = threads;
    cp.no_perf = true;
    llama_context * ctx = llama_init_from_model(model, cp);
    if (!ctx) {
        llama_model_free(model);
        return 0;
    }
    Mind * m = new Mind();
    m->model = model;
    m->ctx = ctx;
    m->vocab = llama_model_get_vocab(model);
    m->batch = llama_batch_ext_init(ctx);
    m->n_batch = (int) llama_n_batch(ctx);
    return (jlong) m;
}

// Returns the number of tokens written, or: -1 not loaded, -2 could not read the prompt, -3 prompt too long for
// the context, -4 the engine failed.
JNIEXPORT jint JNICALL
Java_com_kaivra_app_KaivraMind_nativeGenerate(JNIEnv * env, jclass, jlong handle, jbyteArray jprompt, jint max_tokens,
                                              jfloat temp, jint top_k, jfloat top_p, jfloat presence, jint seed,
                                              jobject sink) {
    Mind * m = (Mind *) handle;
    if (!m) return -1;
    const jsize plen = env->GetArrayLength(jprompt);
    std::string prompt((size_t) plen, '\0');
    env->GetByteArrayRegion(jprompt, 0, plen, (jbyte *) prompt.data());

    const int n = -llama_tokenize(m->vocab, prompt.data(), (int32_t) prompt.size(), nullptr, 0, true, true);
    if (n <= 0) return -2;
    std::vector<llama_token> toks((size_t) n);
    if (llama_tokenize(m->vocab, prompt.data(), (int32_t) prompt.size(), toks.data(), n, true, true) < 0) return -2;
    const int n_ctx = (int) llama_n_ctx(m->ctx);
    if (n + 16 > n_ctx) return -3;

    // keep what the memory already holds of this prompt; the last prompt token is always read again (for its logits)
    llama_memory_t mem = llama_get_memory(m->ctx);
    size_t keep = 0;
    while (keep < m->held.size() && keep < toks.size() && m->held[keep] == toks[keep]) keep++;
    if (keep == toks.size()) keep--;
    if (keep < m->held.size()) {
        if (!llama_memory_seq_rm(mem, 0, (llama_pos) keep, -1)) {
            // recurrent layers cannot go back part of the way: start again from the saved start, or from nothing
            llama_memory_clear(mem, true);
            keep = 0;
            if (!m->base.empty() && m->base.size() < toks.size() &&
                std::equal(m->base.begin(), m->base.end(), toks.begin()) &&
                llama_state_seq_set_data(m->ctx, m->base_state.data(), m->base_state.size(), 0) > 0) {
                keep = m->base.size();
            } else {
                llama_memory_clear(mem, true);
            }
        }
    }
    m->held.assign(toks.begin(), toks.begin() + (long) keep);
    if (!feed(m, toks, keep, toks.size())) {
        llama_memory_clear(mem, true);
        m->held.clear();
        return -4;
    }
    m->held = toks;

    llama_sampler * smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (top_k > 0) llama_sampler_chain_add(smpl, llama_sampler_init_top_k(top_k));
    if (presence != 0.0f) llama_sampler_chain_add(smpl, llama_sampler_init_penalties(llama_vocab_n_tokens(m->vocab), 256, 1.0f, 0.0f, presence));
    if (top_p < 1.0f) llama_sampler_chain_add(smpl, llama_sampler_init_top_p(top_p, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed < 0 ? LLAMA_DEFAULT_SEED : (uint32_t) seed));

    jmethodID on_bytes = nullptr;
    if (sink) {
        jclass cls = env->GetObjectClass(sink);
        on_bytes = env->GetMethodID(cls, "onBytes", "([B)Z");
        env->DeleteLocalRef(cls);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            on_bytes = nullptr;
        }
    }

    std::string pending;
    int produced = 0;
    bool go = true;
    while (go && produced < max_tokens) {
        const llama_token t = llama_sampler_sample(smpl, m->ctx, -1);
        if (llama_vocab_is_eog(m->vocab, t)) break;
        char buf[256];
        const int nb = llama_token_to_piece(m->vocab, t, buf, sizeof(buf), 0, true);
        if (nb > 0) pending.append(buf, (size_t) nb);
        produced++;

        // read the new token so the next one can be chosen
        const llama_pos pos = (llama_pos) m->held.size();
        if (pos + 1 >= n_ctx) {
            go = false;
        } else {
            llama_batch_ext_clear(m->batch);
            const int32_t idx = llama_batch_ext_add_token(m->batch, 0, t);
            llama_batch_ext_set_pos(m->batch, idx, &pos);
            llama_batch_ext_set_output_logits(m->batch, idx, true);
            if (llama_process(m->ctx, LLAMA_PROCESS_TYPE_DECODE, m->batch) != 0) go = false;
            else m->held.push_back(t);
        }

        const size_t tail = incomplete_tail(pending);
        if (pending.size() > tail) {
            const std::string ready = pending.substr(0, pending.size() - tail);
            pending.erase(0, ready.size());
            if (!send(env, sink, on_bytes, ready)) go = false;
        }
    }
    send(env, sink, on_bytes, pending);
    llama_sampler_free(smpl);
    return produced;
}

// Reads the start every conversation shares and remembers the engine's state after it, so a new conversation (or
// any reply that cannot continue the old one) only reads what comes after it.
JNIEXPORT jboolean JNICALL
Java_com_kaivra_app_KaivraMind_nativePrime(JNIEnv * env, jclass, jlong handle, jbyteArray jprefix) {
    Mind * m = (Mind *) handle;
    if (!m) return JNI_FALSE;
    const jsize plen = env->GetArrayLength(jprefix);
    std::string prefix((size_t) plen, '\0');
    env->GetByteArrayRegion(jprefix, 0, plen, (jbyte *) prefix.data());
    const int n = -llama_tokenize(m->vocab, prefix.data(), (int32_t) prefix.size(), nullptr, 0, true, true);
    if (n <= 0) return JNI_FALSE;
    std::vector<llama_token> toks((size_t) n);
    if (llama_tokenize(m->vocab, prefix.data(), (int32_t) prefix.size(), toks.data(), n, true, true) < 0) return JNI_FALSE;
    llama_memory_t mem = llama_get_memory(m->ctx);
    llama_memory_clear(mem, true);
    m->held.clear();
    m->base.clear();
    if (!feed(m, toks, 0, toks.size())) {
        llama_memory_clear(mem, true);
        return JNI_FALSE;
    }
    m->held = toks;
    const size_t size = llama_state_seq_get_size(m->ctx, 0);
    m->base_state.resize(size);
    if (size == 0 || llama_state_seq_get_data(m->ctx, m->base_state.data(), size, 0) != size) {
        m->base_state.clear();
        return JNI_FALSE;
    }
    m->base = toks;
    return JNI_TRUE;
}

JNIEXPORT void JNICALL
Java_com_kaivra_app_KaivraMind_nativeReset(JNIEnv *, jclass, jlong handle) {
    Mind * m = (Mind *) handle;
    if (!m) return;
    llama_memory_clear(llama_get_memory(m->ctx), true);
    m->held.clear();
}

JNIEXPORT jstring JNICALL
Java_com_kaivra_app_KaivraMind_nativeInfo(JNIEnv * env, jclass, jlong handle) {
    Mind * m = (Mind *) handle;
    if (!m) return env->NewStringUTF("");
    char desc[256];
    llama_model_desc(m->model, desc, sizeof(desc));
    std::string s = std::string(desc) + ", " + std::to_string(llama_model_size(m->model) / 1048576) + " MB, context " +
                    std::to_string(llama_n_ctx(m->ctx)) + ", " + std::to_string(llama_vocab_n_tokens(m->vocab)) + " tokens";
    // keep it plain ASCII for NewStringUTF
    for (char & c : s) if ((unsigned char) c >= 0x80) c = '?';
    return env->NewStringUTF(s.c_str());
}

JNIEXPORT void JNICALL
Java_com_kaivra_app_KaivraMind_nativeFree(JNIEnv *, jclass, jlong handle) {
    Mind * m = (Mind *) handle;
    if (!m) return;
    if (m->batch) llama_batch_ext_free(m->batch);
    if (m->ctx) llama_free(m->ctx);
    if (m->model) llama_model_free(m->model);
    delete m;
}

}  // extern "C"

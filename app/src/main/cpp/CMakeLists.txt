# Kaivra's thinking brain: the bridge (kaivra_mind.cpp) between the app and the llama.cpp engine (MIT licence),
# which runs an open language model (GGUF) on the phone's CPU. The same file builds the bridge for Linux, where
# GitHub tests it from Java before the model is published (brain/mind/mind_build.sh).
cmake_minimum_required(VERSION 3.22.1)
project(kaivra_mind C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# the engine, built into the bridge (no extra libraries to load)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
foreach(opt LLAMA_BUILD_COMMON LLAMA_BUILD_TESTS LLAMA_BUILD_TOOLS LLAMA_BUILD_EXAMPLES LLAMA_BUILD_SERVER
            LLAMA_BUILD_APP LLAMA_OPENSSL LLAMA_SUBPROCESS GGML_OPENMP GGML_NATIVE GGML_LLAMAFILE GGML_BACKEND_DL)
    set(${opt} OFF CACHE BOOL "" FORCE)
endforeach()
if(ANDROID)
    # every core of the phone (Cortex-A78 and A55) has dot-product and half-float instructions
    set(GGML_CPU_ARM_ARCH "armv8.2-a+dotprod+fp16" CACHE STRING "" FORCE)
endif()

if(KAIVRA_LLAMA_DIR)
    add_subdirectory(${KAIVRA_LLAMA_DIR} llama-build EXCLUDE_FROM_ALL)
else()
    include(FetchContent)
    # llama.cpp v1.0.0 (build b12359), pinned to its commit
    FetchContent_Declare(llama
        URL https://github.com/ggml-org/llama.cpp/archive/b1b770d90d94cad9e9ea5b993bdbc383a522fb28.tar.gz)
    FetchContent_GetProperties(llama)
    if(NOT llama_POPULATED)
        FetchContent_Populate(llama)
        add_subdirectory(${llama_SOURCE_DIR} ${llama_BINARY_DIR} EXCLUDE_FROM_ALL)
    endif()
endif()

add_library(kaivra_mind SHARED kaivra_mind.cpp)
target_link_libraries(kaivra_mind PRIVATE llama)
if(ANDROID)
    target_link_libraries(kaivra_mind PRIVATE log)
    target_link_options(kaivra_mind PRIVATE "-Wl,-z,max-page-size=16384")
else()
    find_package(JNI REQUIRED)
    target_include_directories(kaivra_mind PRIVATE ${JNI_INCLUDE_DIRS})
endif()

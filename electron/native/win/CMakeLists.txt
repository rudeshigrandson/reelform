# Reelform Windows native helpers (ENGINEERING_SPEC §5.4).
#
#   reelform-wgc.exe             Windows.Graphics.Capture + Media Foundation + WASAPI
#   reelform-dxgi.exe            same pipeline, DXGI Desktop Duplication source (builds < 19041)
#   reelform-cursor-monitor.exe  cursor position 120 Hz, clicks, keys (codes only), scroll
#   reelform-hw-probe.exe        MF encoder + D3D adapter enumeration -> JSON
#   reelform-native-tests        portable tests for the header-only core (any OS)
#
# See README.md for build, output layout and signing.
cmake_minimum_required(VERSION 3.24)
project(reelform_native_win VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(REELFORM_BUILD_TESTS "Build the portable header-only tests" ON)
option(REELFORM_BUILD_HELPERS "Build the Windows helper executables" ${WIN32})

# ---- header-only core (no platform deps) ---------------------------------
add_library(reelform_core INTERFACE)
target_include_directories(reelform_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/common/include)
target_compile_definitions(reelform_core INTERFACE REELFORM_HELPER_VERSION="${PROJECT_VERSION}")

if(REELFORM_BUILD_TESTS)
  enable_testing()
  add_executable(reelform-native-tests tests/test_main.cpp)
  target_link_libraries(reelform-native-tests PRIVATE reelform_core)
  if(MSVC)
    target_compile_options(reelform-native-tests PRIVATE /W4 /permissive- /utf-8 /EHsc)
  else()
    target_compile_options(reelform-native-tests PRIVATE -Wall -Wextra -Wpedantic)
    find_package(Threads REQUIRED)
    target_link_libraries(reelform-native-tests PRIVATE Threads::Threads)
  endif()
  add_test(NAME reelform-native-tests COMMAND reelform-native-tests)
endif()

if(NOT REELFORM_BUILD_HELPERS)
  return()
endif()

if(NOT WIN32)
  message(FATAL_ERROR "REELFORM_BUILD_HELPERS requires Windows (MSVC + Windows SDK >= 10.0.22621)")
endif()

# ---- Windows helpers ---------------------------------------------------------
# C++/WinRT headers ship with the Windows SDK (include/<ver>/cppwinrt).
if(CMAKE_SYSTEM_VERSION VERSION_LESS 10.0.22621)
  message(WARNING "Windows SDK ${CMAKE_SYSTEM_VERSION} detected; >= 10.0.22621 is required for "
                  "GraphicsCaptureSession::IsBorderRequired. Pass -DCMAKE_SYSTEM_VERSION=10.0.22621.0")
endif()

# Static CRT so the helpers run without the VC++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

if(NOT DEFINED REELFORM_ARCH)
  if(CMAKE_GENERATOR_PLATFORM)
    string(TOLOWER "${CMAKE_GENERATOR_PLATFORM}" REELFORM_ARCH)
  else()
    string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" REELFORM_ARCH)
  endif()
endif()
if(REELFORM_ARCH STREQUAL "amd64")
  set(REELFORM_ARCH "x64")
endif()

set(REELFORM_WIN_DEFS WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE _WIN32_WINNT=0x0A00 WINVER=0x0A00)
set(REELFORM_WIN_OPTS /W4 /permissive- /utf-8 /EHsc /Zc:__cplusplus /bigobj /guard:cf /Qspectre)
set(REELFORM_WIN_LINK_OPTS /guard:cf /DYNAMICBASE /NXCOMPAT /CETCOMPAT)
set(REELFORM_MANIFEST ${CMAKE_CURRENT_SOURCE_DIR}/common/reelform-helper.manifest)

function(reelform_helper target)
  target_link_libraries(${target} PRIVATE reelform_core)
  target_compile_definitions(${target} PRIVATE ${REELFORM_WIN_DEFS})
  target_compile_options(${target} PRIVATE ${REELFORM_WIN_OPTS})
  if(NOT REELFORM_ARCH STREQUAL "arm64")
    # CET shadow stack is x64-only.
    target_link_options(${target} PRIVATE ${REELFORM_WIN_LINK_OPTS})
  else()
    target_link_options(${target} PRIVATE /guard:cf /DYNAMICBASE /NXCOMPAT)
  endif()
  # Console subsystem: stdio pipes are the protocol. Spawned with windowsHide.
  set_target_properties(${target} PROPERTIES WIN32_EXECUTABLE OFF)
endfunction()

set(REELFORM_CAPTURE_COMMON
  wgc-capture/main.cpp
  wgc-capture/recorder.cpp
  wgc-capture/recorder.hpp
  wgc-capture/frame_source.hpp
  wgc-capture/d3d_util.cpp
  wgc-capture/d3d_util.hpp
  wgc-capture/mf_writers.cpp
  wgc-capture/mf_writers.hpp
  wgc-capture/wasapi_capture.cpp
  wgc-capture/wasapi_capture.hpp
  common/win_util.hpp
  ${REELFORM_MANIFEST}
)
set(REELFORM_CAPTURE_LIBS d3d11 dxgi mfplat mfreadwrite mfuuid ole32 oleaut32 propsys advapi32 shcore windowsapp)

add_executable(reelform-wgc ${REELFORM_CAPTURE_COMMON} wgc-capture/wgc_source.cpp wgc-capture/wgc_source.hpp)
reelform_helper(reelform-wgc)
target_compile_definitions(reelform-wgc PRIVATE REELFORM_BACKEND_WGC)
target_link_libraries(reelform-wgc PRIVATE ${REELFORM_CAPTURE_LIBS})

add_executable(reelform-dxgi ${REELFORM_CAPTURE_COMMON} wgc-capture/dxgi_source.cpp wgc-capture/dxgi_source.hpp)
reelform_helper(reelform-dxgi)
target_compile_definitions(reelform-dxgi PRIVATE REELFORM_BACKEND_DXGI)
target_link_libraries(reelform-dxgi PRIVATE ${REELFORM_CAPTURE_LIBS})

add_executable(reelform-cursor-monitor cursor-monitor/main.cpp common/win_util.hpp ${REELFORM_MANIFEST})
reelform_helper(reelform-cursor-monitor)
target_link_libraries(reelform-cursor-monitor PRIVATE user32 winmm)

add_executable(reelform-hw-probe hw-probe/main.cpp common/win_util.hpp ${REELFORM_MANIFEST})
reelform_helper(reelform-hw-probe)
target_link_libraries(reelform-hw-probe PRIVATE d3d11 dxgi mfplat mfuuid ole32)

# Output layout consumed by electron-builder: electron/native/bin/win32-<arch>/
install(TARGETS reelform-wgc reelform-dxgi reelform-cursor-monitor reelform-hw-probe
        RUNTIME DESTINATION win32-${REELFORM_ARCH})

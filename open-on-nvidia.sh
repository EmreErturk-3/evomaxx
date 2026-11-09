#!/usr/bin/env bash
# Open an ALife world in Firefox on the NVIDIA GPU (PRIME render offload) instead of the
# integrated Intel GPU: WebGL and WebGPU (Vulkan) both run there, about 17 times faster.
# A running Firefox keeps the GPU it started on, so it has to be quit first; this script
# asks before closing it (your tabs come back with session restore).
#   ./open-on-nvidia.sh                 # EvoMaxx (index.html)
here="$(cd "$(dirname "$0")" && pwd)"
page="${1:-index.html}"
if pgrep -x firefox >/dev/null || pgrep -f "/usr/lib/firefox/firefox" >/dev/null; then
  read -r -p "Firefox is running on the integrated GPU. Close it and reopen on the NVIDIA GPU? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || exit 0
  pkill -TERM -x firefox 2>/dev/null; pkill -TERM -f "/usr/lib/firefox/firefox$" 2>/dev/null
  for _ in $(seq 50); do pgrep -f "/usr/lib/firefox/firefox" >/dev/null || break; sleep 0.2; done
fi
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia __VK_LAYER_NV_optimus=NVIDIA_only \
  nohup firefox "file://${here// /%20}/$page" >/dev/null 2>&1 &

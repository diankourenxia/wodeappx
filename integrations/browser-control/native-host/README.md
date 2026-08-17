# WodeAppX Browser Native Host

This is the local Chrome Native Messaging host for WodeAppX Browser Control.
Chrome starts it through the `com.wodeappx.browser_control` native-host
manifest. It accepts only the fixed WodeAppX browser operations, proxies them
to the loopback bridge owned by the running WodeAppX/OpenCode process, and
returns length-prefixed JSON over stdin/stdout.

The Chrome extension prefers this transport and falls back to the legacy
loopback HTTP transport only when the desktop app or native-host registration
has not been updated yet.

Builds are copied into the Electron desktop resources by
`wodeappx/scripts/build-browser-native-host.mjs`.

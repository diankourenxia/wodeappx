# WodeAppX Browser Control Privacy Policy

Last updated: 2026-08-03

WodeAppX Browser Control is a local companion extension for the WodeAppX desktop application. It does not sell personal data, use browser data for advertising or credit decisions, or perform cross-site tracking.

The extension processes a page only when the user starts a browser task or authorizes WodeAppX to continue that task. Depending on the requested operation, processed data can include the active page URL and title, visible text, element descriptions, screenshots, and operation results. Password field values, cookies, authentication headers, browser history, and browser storage are excluded from the normal tool contract.

The extension sends commands and results to the cooperating `com.wodeappx.browser_control` native host over Chrome Native Messaging. A token-authenticated loopback connection can be enabled explicitly for development. When a task requires AI inference, WodeAppX may send the user prompt and the minimum necessary page context to the model provider selected and configured by the user. That provider's privacy terms then apply.

Connection settings and recent side-panel messages are stored locally in `chrome.storage.local`. Users can delete them by clearing the extension's data or uninstalling the extension. WodeAppX does not add a separate analytics or advertising endpoint to the extension.

Security issues should be reported privately through the repository's [GitHub security advisory form](https://github.com/diankourenxia/wodeappx/security/advisories/new).

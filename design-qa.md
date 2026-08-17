# Design QA — 经典蓝色可插拔皮肤

- source visual truth path: `/Users/macpassword0000/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/diankourenxia_7da4/temp/RWTemp/2026-07/36c7c3ec8f165d39fc5681608dc2231f.png`
- implementation screenshot path: `/Users/macpassword0000/Desktop/wodeapp/wodeappx/design-qa-classic-blue.png`
- normalized comparison path: `/Users/macpassword0000/Desktop/wodeapp/wodeappx/design-qa-comparison.png`
- viewport: 1680 × 1024 CSS px, desktop DPR 2
- state: existing WodeAppX conversation, `classic-blue` skin active, composer visible

## Full-view comparison evidence

The normalized comparison places the reference and implementation side by side at the same height. The implementation preserves the reference's dominant composition: blue title strip, large-icon toolbar, narrow grouped navigation, flexible central work area, right assistant rail, dense blue-gray borders, and a persistent bottom composer.

## Focused region evidence

A separate crop was not needed. The implementation capture is 3360 × 2048 and the normalized full-view comparison keeps the toolbar labels, navigation groups, assistant card, and composer legible. The source's decorative friend panel is intentionally represented by WodeAppX's real assistant/status rail and existing Live2D assistant instead of a non-functional replica.

## Required fidelity surfaces

- Fonts and typography: Tahoma-first classic desktop stack is applied to the skin; Chinese falls back to Microsoft YaHei/PingFang SC. Toolbar and sidebar use compact 12–15 px hierarchy with truncation guards.
- Spacing and layout rhythm: three-column proportions, 34 px title row, 60 px tool row, thin blue separators, compact navigation rows, and fixed composer visibility match the reference's desktop density.
- Colors and visual tokens: classic blue, pale blue-gray panels, white content surfaces, blue selection states, and green online status are consistently scoped under `.wapp-skin-classic-blue`.
- Image quality and asset fidelity: the assistant rail uses the shipped WodeApp brand raster asset and the existing Live2D assistant. The packaged `file://` path was verified after switching the asset source to `import.meta.env.BASE_URL`.
- Copy and content: classic toolbar labels map to real WodeAppX surfaces; no fake window controls or dead primary actions were added.

## Interaction and responsive evidence

- Default → classic switch: passed.
- Classic → default switch: passed.
- Skin persistence in `localStorage`: passed.
- 1680 × 1024: toolbar and assistant rail visible; no horizontal overflow.
- 1024 × 720: assistant rail hides, toolbar and composer remain visible; no horizontal overflow.
- Typecheck: passed.
- Production build: passed.
- Packaged desktop resource sync and reload: passed; loaded script `./assets/app-CePcaki3.js`.

## Comparison history

1. First capture found one P2 issue: the right assistant brand image used `/wodeapp-mark.png`, which broke under the packaged desktop `file://` base. Fixed by deriving the asset URL from `import.meta.env.BASE_URL`.
2. Rebuilt, synced into `/Applications/我的AppX.app`, reloaded, and captured again. The title mark and assistant portrait render correctly; no actionable P0/P1/P2 mismatch remains.

## Follow-up polish

- P3: a future optional asset pack could add more period-specific pixel illustrations. The current version deliberately reuses WodeAppX's real brand and Live2D assistant so the rail remains functional and product-specific.

final result: passed

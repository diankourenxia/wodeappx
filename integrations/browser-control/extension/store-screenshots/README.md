# Chrome Web Store screenshots

Generate the five 1280×800 PNG screenshots used by the existing Chrome Web Store item:

```bash
node wodeappx/integrations/browser-control/extension/store-screenshots/capture.mjs
```

Output is written to `../store-assets/screenshots/`. The images cover the initial conversation, page summary, assisted form completion, completed export, and local connection settings.

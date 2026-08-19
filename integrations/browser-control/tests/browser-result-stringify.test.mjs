import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";

const runtimeUrl = pathToFileURL(path.resolve(
  "integrations/browser-control/opencode-plugin/wodeappx-browser-control-runtime.mjs",
)).href;

const { stringifyBrowserResult } = await import(runtimeUrl);

function fatPage(elementCount = 80, textChars = 4000) {
  return {
    clientId: "client-1",
    tab: { id: 7, title: "Orders", url: "https://admin.shopify.com/store/demo/orders" },
    page: {
      title: "WynneCurtains · Orders · Shopify",
      url: "https://admin.shopify.com/store/demo/orders",
      selectedText: "",
      headings: ["Orders"],
      text: "Order ".repeat(Math.ceil(textChars / 6)).slice(0, textChars),
      textLength: textChars,
      textTruncated: false,
      snapshotId: "wxa-test",
      interactiveElements: Array.from({ length: elementCount }, (_, index) => ({
        nodeId: `wxa-test-${index + 1}`,
        tag: "button",
        role: "button",
        type: "button",
        name: `Search item ${index + 1} with a longer visible label`,
        text: `Search item ${index + 1} with a longer visible label`,
        value: "",
        placeholder: "",
        href: undefined,
        selector: `#search-${index + 1}`,
        checked: false,
        disabled: false,
        rect: { x: 12, y: 40 + index, width: 180, height: 28 },
      })),
      interactiveElementCount: elementCount,
      interactiveElementsTruncated: false,
      viewportOnly: false,
      activeElementNodeId: null,
    },
  };
}

describe("stringifyBrowserResult", () => {
  it("keeps the full snapshot fields under the default 200k budget", () => {
    const text = stringifyBrowserResult(fatPage());
    const parsed = JSON.parse(text);
    assert.equal(parsed.page.interactiveElements.length, 80);
    assert.deepEqual(parsed.page.interactiveElements[0].rect, { x: 12, y: 40, width: 180, height: 28 });
    assert.equal(parsed.page.interactiveElements[0].role, "button");
    assert.equal(parsed.page.interactiveElements[0].text, parsed.page.interactiveElements[0].name);
    assert.equal(parsed.page.resultTruncated, undefined);
  });

  it("never mid-slice JSON when an explicit tiny budget is forced", () => {
    const text = stringifyBrowserResult(fatPage(), 8_000);
    assert.ok(text.length <= 8_000, `length ${text.length}`);
    const parsed = JSON.parse(text);
    const first = parsed.page?.interactiveElements?.[0];
    if (first) {
      assert.ok(first.rect);
      assert.equal(first.role, "button");
    } else {
      assert.equal(parsed.truncated, true);
    }
  });

  it("repairs an already-sliced pretty JSON string into valid JSON", () => {
    const pretty = JSON.stringify(fatPage(48, 2500), null, 2);
    const sliced = `${pretty.slice(0, 12_000)}\n...`;
    assert.throws(() => JSON.parse(sliced));
    const text = stringifyBrowserResult(sliced, 12_000);
    const parsed = JSON.parse(text);
    assert.ok(parsed.page || parsed.truncated);
  });
});

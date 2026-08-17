import assert from "node:assert/strict";
import test from "node:test";

import { formatWodeAppToolErrorReason } from "../wodeapp/wodeapp-tool-activity";

test("tool error reasons stay readable in the collapsed summary", () => {
  assert.equal(
    formatWodeAppToolErrorReason(
      "[wodeappxFailure recoverable=false errorKind=execution] UI bridge request failed: 商品图片最多保存 12 张，当前解析到 25 张；未执行静默截断，商品未保存。",
    ),
    "商品图片最多保存 12 张，当前解析到 25 张；未执行静默截断，商品未保存。",
  );
  assert.equal(formatWodeAppToolErrorReason("Tool execution aborted"), "参数未完成被中断");
  assert.equal(
    formatWodeAppToolErrorReason(
      '[{"origin":"number","code":"too_big","maximum":24000,"inclusive":true,"path":["maxChars"],"message":"Too big: expected number to be <=24000"}]',
    ),
    "maxChars: Too big: expected number to be <=24000",
  );
  assert.equal(
    formatWodeAppToolErrorReason('[{"origin":"array","code":"too_big","maximum":12,"path":["images"]}]'),
    "images: too_big (max 12)",
  );
});

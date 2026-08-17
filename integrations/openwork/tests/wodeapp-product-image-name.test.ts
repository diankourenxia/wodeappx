import { describe, expect, test } from "vitest";

import {
  isGenericProductImageName,
  sanitizeProductImageName,
} from "../wodeapp/digital-assets-image-name";

describe("sanitizeProductImageName", () => {
  test("keeps short Chinese labels", () => {
    expect(sanitizeProductImageName("蓝锅正面")).toBe("蓝锅正面");
    expect(sanitizeProductImageName("全套配件")).toBe("全套配件");
    expect(sanitizeProductImageName("主机带盖")).toBe("主机带盖");
    expect(sanitizeProductImageName("平烤盘")).toBe("平烤盘");
  });

  test("strips punctuation and marketing filler", () => {
    expect(sanitizeProductImageName("「蓝锅正面」")).toBe("蓝锅正面");
    expect(sanitizeProductImageName("这是一张蓝锅正面展示图")).toBe("蓝锅正面");
  });

  test("rejects English-only and overlong noise", () => {
    expect(sanitizeProductImageName("Blue pot front")).toBeUndefined();
    expect(sanitizeProductImageName("a")).toBeUndefined();
  });

  test("rejects ordinal placeholder names like 图1/图2", () => {
    expect(isGenericProductImageName("图1")).toBe(true);
    expect(isGenericProductImageName("图 2")).toBe(true);
    expect(isGenericProductImageName("图片3")).toBe(true);
    expect(isGenericProductImageName("参考图2")).toBe(true);
    expect(isGenericProductImageName("商品图1")).toBe(true);
    expect(isGenericProductImageName("第2张")).toBe(true);
    expect(sanitizeProductImageName("图1")).toBeUndefined();
    expect(sanitizeProductImageName("图2")).toBeUndefined();
    expect(sanitizeProductImageName("参考图N")).toBeUndefined();
    expect(sanitizeProductImageName("附件1")).toBeUndefined();
    expect(sanitizeProductImageName("image1")).toBeUndefined();
  });

  test("truncates to 16 chars", () => {
    expect(sanitizeProductImageName("蓝绿红黄紫锅具正面特写开盖俯视配件盘")).toBe("蓝绿红黄紫锅具正面特写开盖俯视配");
  });
});

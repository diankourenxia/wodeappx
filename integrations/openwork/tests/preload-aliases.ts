import { mock } from "bun:test";

mock.module("@/components/ui/sonner", () => ({
  toast: {
    error() {},
    success() {},
    info() {},
    warning() {},
    message() {},
  },
}));

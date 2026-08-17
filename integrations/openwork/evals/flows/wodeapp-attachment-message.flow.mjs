const MESSAGE = "请只回复：附件占位测试完成";
const FILE_NAME = "attachment-proof.png";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAYAAADl5PURAAACUklEQVR42u3UMQ0AIAxE0apjxb8AVgYMFBcNDW94Bu6SH/tkAvwojAAIIIAAAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACtAvgHAughAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoFMAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBFEBAAJ0CCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggggAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAggggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCAAggIoAACAiiAgAAKICCATgEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEBFEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBFEBAAAUQEEABBARQAAEBdAoggAACCCCAAAIIIIAAAggggAACCCCAAAIIIIAALwYQoBsBBAQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAHKXO+PfSoiWaqfAAAAAElFTkSuQmCC";
let previousSessionRoute = "";
let testSessionRoute = "";

async function pasteComposer(ctx, text) {
  return ctx.eval(
    `(() => {
      const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!editor) return { ok: false, reason: "composer not found" };
      editor.focus();
      const data = new DataTransfer();
      data.setData("text/plain", ${JSON.stringify(text)});
      editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return { ok: true };
    })()`,
  );
}

async function attachImage(ctx) {
  return ctx.eval(
    `(() => {
      const input = document.querySelector('input[type="file"][multiple]');
      if (!(input instanceof HTMLInputElement)) return { ok: false, reason: "file input not found" };
      const binary = atob(${JSON.stringify(PNG_BASE64)});
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const file = new File([bytes], ${JSON.stringify(FILE_NAME)}, {
        type: "image/png",
        lastModified: Date.now(),
      });
      const data = new DataTransfer();
      data.items.add(file);
      input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, count: data.files.length };
    })()`,
  );
}

function sentMessageStateExpression() {
  return `(() => {
    const composer = window.__openwork?.slice("composer");
    const route = window.__openworkControl?.snapshot().route || "";
    if (route !== ${JSON.stringify(testSessionRoute)}) {
      window.location.hash = "#" + ${JSON.stringify(testSessionRoute)};
      return null;
    }
    const userMessage = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((element) => (element.textContent || "").includes(${JSON.stringify(MESSAGE)}));
    const attachment = userMessage?.querySelector('img[alt=${JSON.stringify(FILE_NAME)}]')
      || (userMessage && (userMessage.textContent || "").includes(${JSON.stringify(FILE_NAME)}));
    const state = {
      ready: Boolean(userMessage && attachment && composer?.draftLength === 0 && composer?.attachments?.length === 0),
      hasUserMessage: Boolean(userMessage),
      hasAttachment: Boolean(attachment),
      draftLength: composer?.draftLength,
      composerAttachmentCount: composer?.attachments?.length,
    };
    return state.ready ? state : null;
  })()`;
}

function completedMessageStateExpression() {
  return `(() => {
    const route = window.__openworkControl?.snapshot().route || "";
    if (route !== ${JSON.stringify(testSessionRoute)}) {
      window.location.hash = "#" + ${JSON.stringify(testSessionRoute)};
      return null;
    }
    const composer = window.__openwork?.slice("composer");
    const userMessage = Array.from(document.querySelectorAll('[data-message-role="user"]'))
      .find((element) => (element.textContent || "").includes(${JSON.stringify(MESSAGE)}));
    const assistantMessages = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
    const assistantText = assistantMessages.map((element) => element.textContent || "").join("\\n");
    const failure = /(Cannot read|does not support image input|ERROR:|附件未能解析出可用内容)/i.test(assistantText);
    if (failure) {
      return { ready: false, failed: true, assistantText };
    }
    const hasPlaceholder = Boolean(
      userMessage && (userMessage.textContent || "").includes(${JSON.stringify(FILE_NAME)}),
    );
    const hasReply = assistantText.includes("附件占位测试完成");
    const ready = Boolean(hasPlaceholder && hasReply && composer?.sending === false);
    return ready
      ? { ready: true, failed: false, hasPlaceholder, hasReply, assistantText }
      : null;
  })()`;
}

export default {
  id: "wodeapp-attachment-message",
  title: "Sent text and attachments move into the conversation immediately",
  spec: "WodeAppX attachment-message regression reported from the production chat composer",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__openworkControl)", {
      timeoutMs: 60_000,
      label: "control API",
    });
    const state = await ctx.waitFor(
      `(() => {
        const control = window.__openworkControl;
        const route = control.snapshot().route;
        if (route.startsWith("/welcome") || route.startsWith("/signin")) return "blocked";
        const action = control.listActions().find((item) => item.id === "session.create_task");
        if (action && !action.disabled) return "ready";
        return null;
      })()`,
      { timeoutMs: 30_000, label: "session.create_task enabled" },
    );
    return state === "blocked" ? "Profile is not onboarded; this flow requires a workspace." : null;
  },
  steps: [
    {
      name: "The user prepares a message with an image attachment",
      run: async (ctx) => {
        await ctx.prove("The composer visibly contains both the text and selected image", {
          action: async () => {
            previousSessionRoute = await ctx.eval("window.__openworkControl.snapshot().route");
            await ctx.control("session.create_task");
            testSessionRoute = await ctx.waitFor(
              `(() => {
                const route = window.__openworkControl.snapshot().route || "";
                const composer = window.__openwork?.slice("composer");
                return route !== ${JSON.stringify(previousSessionRoute)}
                  && /\\/session\\/ses_[A-Za-z0-9]+$/.test(route)
                  && composer?.sessionId === route.split("/").at(-1)
                  && composer?.draftLength === 0
                  && composer?.attachments?.length === 0
                  && document.querySelectorAll('[data-message-role]').length === 0
                  && Boolean(document.querySelector('input[type="file"][multiple]'))
                  ? route
                  : null;
              })()`,
              { timeoutMs: 30_000, label: "new empty session composer" },
            );
            await ctx.waitFor(
              "Boolean(document.querySelector('input[type=\"file\"][multiple]'))",
              { timeoutMs: 30_000, label: "attachment input" },
            );
            const pasted = await pasteComposer(ctx, MESSAGE);
            ctx.assert(pasted?.ok, `Could not type message: ${pasted?.reason ?? "unknown"}`);
            const attached = await attachImage(ctx);
            ctx.assert(attached?.ok, `Could not attach image: ${attached?.reason ?? "unknown"}`);
            await ctx.waitFor(
              `(() => {
                const composer = window.__openwork?.slice("composer");
                return composer?.attachments?.some((item) => item.name === ${JSON.stringify(FILE_NAME)})
                  && composer?.draft?.includes(${JSON.stringify(MESSAGE)});
              })()`,
              { timeoutMs: 15_000, label: "text and attachment committed" },
            );
          },
          assert: async () => {
            await ctx.waitFor(
              `(() => {
                const composer = window.__openwork?.slice("composer");
                return composer?.draft?.includes(${JSON.stringify(MESSAGE)})
                  && composer?.attachments?.some((item) => item.name === ${JSON.stringify(FILE_NAME)});
              })()`,
              { timeoutMs: 15_000, label: "composer text and attachment" },
            );
          },
          screenshot: {
            name: "attachment-ready-to-send",
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "Sending moves the complete turn above the composer",
      run: async (ctx) => {
        await ctx.prove("After Send, the composer clears and the user message keeps its attachment", {
          action: async () => {
            const clicked = await ctx.eval(`(() => {
              const buttons = Array.from(document.querySelectorAll("button"));
              const button = buttons.filter((candidate) => {
                const rect = candidate.getBoundingClientRect();
                return !candidate.disabled
                  && rect.width > 0
                  && rect.height > 0
                  && (candidate.textContent || "").includes("发送");
              }).at(-1);
              if (!button) return false;
              button.click();
              return true;
            })()`);
            ctx.assert(clicked === true, "Visible Send button was not available");
            await ctx.navigateHash(testSessionRoute);
          },
          assert: async () => {
            const state = await ctx.waitFor(sentMessageStateExpression(), {
              timeoutMs: 20_000,
              label: "sent user message with attachment and empty composer",
            });
            ctx.assert(state.ready === true, `Sent state was incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "sent-message-above-composer",
            requireText: [MESSAGE],
            rejectText: ["Something went wrong"],
          },
        });
      },
    },
    {
      name: "The model completes without receiving the display-only image",
      run: async (ctx) => {
        await ctx.prove("The final reply succeeds and the server-backed user message keeps a filename placeholder", {
          action: async () => {},
          assert: async () => {
            const state = await ctx.waitFor(completedMessageStateExpression(), {
              timeoutMs: 90_000,
              label: "successful assistant reply and persisted attachment placeholder",
            });
            ctx.assert(state.failed !== true, `Attachment reached an unsupported model: ${state.assistantText}`);
            ctx.assert(state.ready === true, `Completed state was incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "completed-message-with-placeholder",
            requireText: [MESSAGE, FILE_NAME, "附件占位测试完成"],
            rejectText: ["Cannot read", "does not support image input", "ERROR:", "Something went wrong"],
          },
        });
      },
    },
    {
      name: "Reloading preserves the attachment placeholder",
      run: async (ctx) => {
        await ctx.prove("The filename placeholder remains after reopening the conversation", {
          action: async () => {
            await ctx.eval("(() => { window.location.reload(); return true; })()");
            await ctx.waitFor("Boolean(window.__openworkControl && window.__openwork)", {
              timeoutMs: 60_000,
              label: "app after reload",
            });
            await ctx.navigateHash(testSessionRoute);
          },
          assert: async () => {
            const state = await ctx.waitFor(completedMessageStateExpression(), {
              timeoutMs: 60_000,
              label: "reloaded attachment placeholder",
            });
            ctx.assert(state.failed !== true, `Reloaded conversation contains an attachment error: ${state.assistantText}`);
            ctx.assert(state.ready === true, `Reloaded state was incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: {
            name: "reloaded-message-with-placeholder",
            requireText: [MESSAGE, FILE_NAME, "附件占位测试完成"],
            rejectText: ["Cannot read", "does not support image input", "ERROR:", "Something went wrong"],
          },
        });
      },
    },
  ],
};

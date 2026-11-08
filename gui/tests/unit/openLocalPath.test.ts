// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
const dialog = vi.fn();
vi.mock("../../src/ui/consentDialog", () => ({ openConsentDialog: (...args: unknown[]) => dialog(...args) }));
const notice = vi.fn();
vi.mock("../../src/appApi", () => ({
  api: vi.fn(),
  invokeSafe: vi.fn(),
  errorMessage: (e: { message?: string }) => e?.message ?? "error",
  showErrorNotice: (m: string) => notice(m),
}));

import { openLocalPath } from "../../src/links";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openLocalPath", () => {
  beforeEach(() => {
    invoke.mockReset();
    dialog.mockReset();
    notice.mockReset();
  });

  it("opens an allowed file without a prompt", async () => {
    invoke.mockResolvedValue(null);
    openLocalPath("C:\\a\\b.pdf");
    await flush();
    expect(invoke).toHaveBeenCalledWith("open_local_path", { path: "C:\\a\\b.pdf", confirmed: false });
    expect(dialog).not.toHaveBeenCalled();
  });

  it("asks first for a web page and opens it again only after Open", async () => {
    invoke.mockRejectedValueOnce({ code: "needs_consent", message: "stages.html" }).mockResolvedValue(null);
    openLocalPath("C:\\a\\stages.html");
    await flush();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][0]).toBe("stages.html");
    expect(invoke).toHaveBeenCalledTimes(1); // nothing opened yet
    (dialog.mock.calls[0][1] as () => void)(); // the user presses Open
    await flush();
    expect(invoke).toHaveBeenLastCalledWith("open_local_path", { path: "C:\\a\\stages.html", confirmed: true });
  });

  it("shows other refusals as a notice, with no dialog", async () => {
    invoke.mockRejectedValue({ code: "unsafe_path", message: "refusing to open: x (this file type is not allowed)" });
    openLocalPath("C:\\a\\x.bat");
    await flush();
    expect(dialog).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith("refusing to open: x (this file type is not allowed)");
  });

  it("does not ask twice when the confirmed call is still refused", async () => {
    invoke.mockRejectedValue({ code: "needs_consent", message: "stages.html" });
    openLocalPath("C:\\a\\stages.html", true);
    await flush();
    expect(dialog).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalled();
  });
});

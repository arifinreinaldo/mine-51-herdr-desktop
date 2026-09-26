// Every Tauri `invoke` call goes through `invokeSafe`/`api` (finding #16
// extraction): a transient error notice on failure, never a thrown
// rejection the caller has to remember to catch.

import { invoke } from "@tauri-apps/api/core";
import { errorNoticesEl } from "./appDom";

const ERROR_NOTICE_DURATION_MS = 4000;

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(err);
}

export function showErrorNotice(message: string): void {
  const notice = document.createElement("div");
  notice.className = "error-notice";
  notice.textContent = message;
  errorNoticesEl.appendChild(notice);
  window.setTimeout(() => notice.remove(), ERROR_NOTICE_DURATION_MS);
}

export function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  return invoke<T>(cmd, args).catch((err: unknown) => {
    showErrorNotice(errorMessage(err));
    return undefined;
  });
}

export async function api<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
  const result = await invokeSafe<unknown>("api", { method, params });
  return result as T | undefined;
}

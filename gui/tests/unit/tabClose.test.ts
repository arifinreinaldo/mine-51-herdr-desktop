import { describe, expect, it } from "vitest";
import { workspaceClosedByTabClose } from "../../src/workspace/lastTab";

const tabs = [
  { tab_id: "w1:t1", workspace_id: "w1" },
  { tab_id: "w1:t2", workspace_id: "w1" },
  { tab_id: "w2:t1", workspace_id: "w2" },
];

describe("workspaceClosedByTabClose", () => {
  it("returns the workspace when the tab is its last tab", () => {
    expect(workspaceClosedByTabClose(tabs, "w2:t1")).toBe("w2");
  });
  it("returns null when the workspace has other tabs", () => {
    expect(workspaceClosedByTabClose(tabs, "w1:t1")).toBeNull();
    expect(workspaceClosedByTabClose(tabs, "w1:t2")).toBeNull();
  });
  it("returns null for an unknown tab", () => {
    expect(workspaceClosedByTabClose(tabs, "w9:t1")).toBeNull();
  });
});

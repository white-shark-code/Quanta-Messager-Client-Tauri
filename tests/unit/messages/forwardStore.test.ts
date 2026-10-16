import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useForwardStore } from "@/features/messages/forwardStore";

describe("messages/forwardStore", () => {
  beforeEach(() => {
    useForwardStore.setState({ selection: {}, target: null });
  });

  afterEach(() => {
    useForwardStore.setState({ selection: {}, target: null });
  });

  it("starts empty", () => {
    expect(useForwardStore.getState().selection).toEqual({});
    expect(useForwardStore.getState().target).toBeNull();
  });

  it("toggles selection for a source chat", () => {
    useForwardStore.getState().toggleSelect("chat-1", "m1");
    expect(useForwardStore.getState().selection["chat-1"]).toEqual(["m1"]);

    useForwardStore.getState().toggleSelect("chat-1", "m1");
    expect(useForwardStore.getState().selection["chat-1"]).toBeUndefined();
  });

  it("dedupes and keeps insertion order", () => {
    const s = useForwardStore.getState();
    s.toggleSelect("chat-1", "m1");
    s.toggleSelect("chat-1", "m2");
    s.toggleSelect("chat-1", "m1");

    // Toggled off m1 -> only m2 remains; re-add keeps insertion order.
    expect(useForwardStore.getState().selection["chat-1"]).toEqual(["m2"]);

    useForwardStore.getState().toggleSelect("chat-1", "m1");
    expect(useForwardStore.getState().selection["chat-1"]).toEqual(["m2", "m1"]);
  });

  it("isolates selection per source chat", () => {
    useForwardStore.getState().toggleSelect("chat-1", "m1");
    useForwardStore.getState().toggleSelect("chat-2", "m2");

    useForwardStore.getState().clearSelection("chat-1");

    expect(useForwardStore.getState().selection["chat-1"]).toBeUndefined();
    expect(useForwardStore.getState().selection["chat-2"]).toEqual(["m2"]);
  });

  it("clearAll wipes every source chat but keeps target", () => {
    useForwardStore.getState().toggleSelect("chat-1", "m1");
    useForwardStore.getState().toggleSelect("chat-2", "m2");
    useForwardStore.getState().setTarget({ chatId: "chat-9", kind: "group" });

    useForwardStore.getState().clearAll();

    expect(useForwardStore.getState().selection).toEqual({});
    expect(useForwardStore.getState().target).toEqual({ chatId: "chat-9", kind: "group" });
  });

  it("sets and clears the forward target", () => {
    useForwardStore.getState().setTarget({ chatId: "chat-9", kind: "private" });
    expect(useForwardStore.getState().target).toEqual({ chatId: "chat-9", kind: "private" });

    useForwardStore.getState().clearTarget();
    expect(useForwardStore.getState().target).toBeNull();
  });
});

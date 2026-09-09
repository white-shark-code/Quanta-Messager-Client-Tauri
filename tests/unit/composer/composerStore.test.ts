import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useComposerStore } from "@/features/messages/composerStore";
import type { MediaDraft } from "@/features/messages/composerStore";

function mediaDraft(overrides: Partial<MediaDraft> = {}): MediaDraft {
  return {
    id: "media-1",
    name: "photo.png",
    size: 1234,
    mimeType: "image/png",
    status: "pending",
    ...overrides,
  };
}

describe("messages/composerStore", () => {
  beforeEach(() => {
    useComposerStore.setState({ drafts: {} });
  });

  afterEach(() => {
    useComposerStore.setState({ drafts: {} });
  });

  describe("initial state", () => {
    it("starts with an empty drafts map", () => {
      expect(useComposerStore.getState().drafts).toEqual({});
    });
  });

  describe("setText", () => {
    it("adds a draft for the given chatId", () => {
      useComposerStore.getState().setText("chat-1", "hello");

      const drafts = useComposerStore.getState().drafts;
      expect(drafts["chat-1"]).toBeDefined();
      expect(drafts["chat-1"]?.text).toBe("hello");
      expect(drafts["chat-1"]?.mediaFiles).toEqual([]);
      expect(typeof drafts["chat-1"]?.updatedAt).toBe("number");
    });

    it("keeps an empty-string entry rather than deleting the chatId", () => {
      useComposerStore.getState().setText("chat-1", "hello");
      useComposerStore.getState().setText("chat-1", "");

      const drafts = useComposerStore.getState().drafts;
      expect(drafts["chat-1"]).toBeDefined();
      expect(drafts["chat-1"]?.text).toBe("");
    });

    it("overwrites the previous value for the same chatId", () => {
      useComposerStore.getState().setText("chat-1", "first");
      useComposerStore.getState().setText("chat-1", "second");

      expect(useComposerStore.getState().drafts["chat-1"]?.text).toBe("second");
    });

    it("does not clobber drafts for other chatIds", () => {
      useComposerStore.getState().setText("chat-1", "alpha");
      useComposerStore.getState().setText("chat-2", "beta");

      const drafts = useComposerStore.getState().drafts;
      expect(drafts["chat-1"]?.text).toBe("alpha");
      expect(drafts["chat-2"]?.text).toBe("beta");
      expect(Object.keys(drafts)).toHaveLength(2);
    });

    it("preserves previously attached media files when updating text", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "media-1" }));
      useComposerStore.getState().setText("chat-1", "with media");

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.text).toBe("with media");
      expect(draft?.mediaFiles).toHaveLength(1);
      expect(draft?.mediaFiles[0]?.id).toBe("media-1");
    });
  });

  describe("clearDraft", () => {
    it("removes the draft for the given chatId and leaves others intact", () => {
      useComposerStore.getState().setText("chat-1", "alpha");
      useComposerStore.getState().setText("chat-2", "beta");

      useComposerStore.getState().clearDraft("chat-1");

      const drafts = useComposerStore.getState().drafts;
      expect(drafts["chat-1"]).toBeUndefined();
      expect(drafts["chat-2"]?.text).toBe("beta");
    });

    it("is a no-op when called for an unknown chatId", () => {
      useComposerStore.getState().setText("chat-1", "alpha");

      useComposerStore.getState().clearDraft("chat-unknown");

      const drafts = useComposerStore.getState().drafts;
      expect(drafts["chat-1"]?.text).toBe("alpha");
      expect(Object.keys(drafts)).toEqual(["chat-1"]);
    });
  });

  describe("addMedia", () => {
    it("appends a media draft to a chat without an existing draft", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1", name: "a.png" }));

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft).toBeDefined();
      expect(draft?.mediaFiles).toHaveLength(1);
      expect(draft?.mediaFiles[0]?.id).toBe("m1");
      expect(draft?.text).toBe("");
    });

    it("appends multiple media entries for the same chat", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1", name: "a.png" }));
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m2", name: "b.png" }));

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.mediaFiles.map((m) => m.id)).toEqual(["m1", "m2"]);
    });

    it("preserves the existing text when adding media", () => {
      useComposerStore.getState().setText("chat-1", "already typed");
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1" }));

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.text).toBe("already typed");
      expect(draft?.mediaFiles).toHaveLength(1);
    });
  });

  describe("updateMediaStatus", () => {
    it("updates the matching media entry's status and progress", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1", status: "pending" }));

      useComposerStore.getState().updateMediaStatus("chat-1", "m1", "uploaded", 100);

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.mediaFiles[0]?.status).toBe("uploaded");
      expect(draft?.mediaFiles[0]?.progress).toBe(100);
    });

    it("leaves the entry untouched when no progress is provided", () => {
      useComposerStore
        .getState()
        .addMedia("chat-1", mediaDraft({ id: "m1", status: "pending", progress: 50 }));

      useComposerStore.getState().updateMediaStatus("chat-1", "m1", "encrypted");

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.mediaFiles[0]?.status).toBe("encrypted");
      expect(draft?.mediaFiles[0]?.progress).toBe(50);
    });

    it("does not modify other media entries", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1", status: "pending" }));
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m2", status: "pending" }));

      useComposerStore.getState().updateMediaStatus("chat-1", "m1", "uploaded");

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.mediaFiles[0]?.status).toBe("uploaded");
      expect(draft?.mediaFiles[1]?.status).toBe("pending");
    });
  });

  describe("removeMedia", () => {
    it("removes the matching media entry from the draft", () => {
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m1" }));
      useComposerStore.getState().addMedia("chat-1", mediaDraft({ id: "m2" }));

      useComposerStore.getState().removeMedia("chat-1", "m1");

      const draft = useComposerStore.getState().drafts["chat-1"];
      expect(draft?.mediaFiles.map((m) => m.id)).toEqual(["m2"]);
    });
  });

  describe("getDraft", () => {
    it("returns the draft for a given chatId", () => {
      useComposerStore.getState().setText("chat-1", "hello");

      const draft = useComposerStore.getState().getDraft("chat-1");
      expect(draft?.text).toBe("hello");
    });

    it("returns undefined for an unknown chatId", () => {
      expect(useComposerStore.getState().getDraft("chat-unknown")).toBeUndefined();
    });
  });
});

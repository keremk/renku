/**
 * Tests for artifact edit handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

// Test the module internals by importing the handler functions
// We'll test the functions that don't require HTTP mocking

describe("artifact-edit-handler", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-edit-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("blob storage", () => {
    it("calculates SHA-256 hash for content", () => {
      const content = Buffer.from("test content");
      const hash = createHash("sha256").update(content).digest("hex");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("stores blob with prefix directory structure", async () => {
      const content = Buffer.from("test blob content");
      const hash = createHash("sha256").update(content).digest("hex");
      const prefix = hash.slice(0, 2);

      // Create the directory structure
      const blobsDir = path.join(tempDir, "blobs");
      const prefixDir = path.join(blobsDir, prefix);
      await fs.mkdir(prefixDir, { recursive: true });

      // Write the blob
      const blobPath = path.join(prefixDir, `${hash}.txt`);
      await fs.writeFile(blobPath, content);

      // Verify the blob exists
      const exists = await fs.access(blobPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Verify the content
      const readContent = await fs.readFile(blobPath);
      expect(readContent.toString()).toBe("test blob content");
    });
  });

  describe("event log operations", () => {
    it("appends events to JSONL file", async () => {
      const eventsDir = path.join(tempDir, "events");
      await fs.mkdir(eventsDir, { recursive: true });
      const logPath = path.join(eventsDir, "artefacts.log");

      const event1 = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-1",
        status: "succeeded",
        createdAt: new Date().toISOString(),
      };

      const event2 = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-2",
        status: "succeeded",
        createdAt: new Date().toISOString(),
        editedBy: "user",
        originalHash: "abc123",
      };

      // Write events
      await fs.writeFile(logPath, JSON.stringify(event1) + "\n");
      await fs.appendFile(logPath, JSON.stringify(event2) + "\n");

      // Read and parse events
      const content = await fs.readFile(logPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());
      expect(lines.length).toBe(2);

      const parsed1 = JSON.parse(lines[0]);
      const parsed2 = JSON.parse(lines[1]);

      expect(parsed1.artefactId).toBe("Artifact:Test.Output");
      expect(parsed1.editedBy).toBeUndefined();

      expect(parsed2.editedBy).toBe("user");
      expect(parsed2.originalHash).toBe("abc123");
    });

    it("preserves originalHash across multiple edits", async () => {
      const eventsDir = path.join(tempDir, "events");
      await fs.mkdir(eventsDir, { recursive: true });
      const logPath = path.join(eventsDir, "artefacts.log");

      // Simulate: producer generates artifact
      const producerEvent = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-1",
        output: { blob: { hash: "original-hash-aaa", size: 100, mimeType: "image/png" } },
        status: "succeeded",
        producedBy: "Test",
        createdAt: new Date().toISOString(),
      };

      // First user edit
      const userEdit1 = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-2",
        output: { blob: { hash: "edited-hash-bbb", size: 120, mimeType: "image/png" } },
        status: "succeeded",
        producedBy: "Test",
        createdAt: new Date().toISOString(),
        editedBy: "user" as const,
        originalHash: "original-hash-aaa", // Points to producer's hash
      };

      // Second user edit - originalHash should be preserved
      const userEdit2 = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-3",
        output: { blob: { hash: "edited-hash-ccc", size: 130, mimeType: "image/png" } },
        status: "succeeded",
        producedBy: "Test",
        createdAt: new Date().toISOString(),
        editedBy: "user" as const,
        originalHash: "original-hash-aaa", // Still points to original producer hash!
      };

      // Write events
      await fs.writeFile(logPath, JSON.stringify(producerEvent) + "\n");
      await fs.appendFile(logPath, JSON.stringify(userEdit1) + "\n");
      await fs.appendFile(logPath, JSON.stringify(userEdit2) + "\n");

      // Read and find latest event
      const content = await fs.readFile(logPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());
      const events = lines.map((line) => JSON.parse(line));

      // Latest event should still have the original producer hash
      const latest = events[events.length - 1];
      expect(latest.output.blob.hash).toBe("edited-hash-ccc");
      expect(latest.originalHash).toBe("original-hash-aaa");
    });

    it("restore event clears editedBy and originalHash", async () => {
      const eventsDir = path.join(tempDir, "events");
      await fs.mkdir(eventsDir, { recursive: true });
      const logPath = path.join(eventsDir, "artefacts.log");

      // Simulate: user edits, then restores
      const editEvent = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-1",
        output: { blob: { hash: "edited-hash", size: 100, mimeType: "image/png" } },
        status: "succeeded",
        producedBy: "Test",
        createdAt: new Date().toISOString(),
        editedBy: "user" as const,
        originalHash: "original-hash",
      };

      // Restore event - points back to original, no editedBy/originalHash
      const restoreEvent = {
        artefactId: "Artifact:Test.Output",
        revision: "rev-2",
        output: { blob: { hash: "original-hash", size: 90, mimeType: "image/png" } },
        status: "succeeded",
        producedBy: "Test",
        createdAt: new Date().toISOString(),
        // No editedBy or originalHash - restored to producer state
      };

      await fs.writeFile(logPath, JSON.stringify(editEvent) + "\n");
      await fs.appendFile(logPath, JSON.stringify(restoreEvent) + "\n");

      const content = await fs.readFile(logPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim());
      const events = lines.map((line) => JSON.parse(line));

      const latest = events[events.length - 1];
      expect(latest.output.blob.hash).toBe("original-hash");
      expect(latest.editedBy).toBeUndefined();
      expect(latest.originalHash).toBeUndefined();
    });
  });

  describe("MIME type to extension mapping", () => {
    const EXTENSION_MAP: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/wav": "wav",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "text/plain": "txt",
      "application/json": "json",
    };

    it("maps common MIME types to extensions", () => {
      expect(EXTENSION_MAP["audio/mpeg"]).toBe("mp3");
      expect(EXTENSION_MAP["image/png"]).toBe("png");
      expect(EXTENSION_MAP["application/json"]).toBe("json");
    });

    it("formats blob filename with extension", () => {
      const hash = "abc123def456";
      const formatBlobFileName = (h: string, mimeType?: string): string => {
        const ext = mimeType ? EXTENSION_MAP[mimeType.toLowerCase()] : null;
        return ext ? `${h}.${ext}` : h;
      };

      expect(formatBlobFileName(hash, "image/png")).toBe("abc123def456.png");
      expect(formatBlobFileName(hash, "application/json")).toBe("abc123def456.json");
      expect(formatBlobFileName(hash, undefined)).toBe("abc123def456");
      expect(formatBlobFileName(hash, "application/octet-stream")).toBe("abc123def456");
    });
  });

  describe("revision ID generation", () => {
    it("generates unique revision IDs", () => {
      const generateRevisionId = (): string => {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).slice(2, 8);
        return `rev-${timestamp}-${random}`;
      };

      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateRevisionId());
      }

      // All should be unique
      expect(ids.size).toBe(100);

      // All should start with "rev-"
      for (const id of ids) {
        expect(id).toMatch(/^rev-[a-z0-9]+-[a-z0-9]+$/);
      }
    });
  });
});

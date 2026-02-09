/**
 * Tests for build manifest handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getBuildManifest } from "./manifest-handler.js";

describe("getBuildManifest", () => {
  let tempDir: string;
  let blueprintFolder: string;
  let movieId: string;
  let movieDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-handler-test-"));
    blueprintFolder = tempDir;
    movieId = "movie-test123";
    movieDir = path.join(blueprintFolder, "builds", movieId);

    // Create directory structure
    await fs.mkdir(path.join(movieDir, "events"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("returns empty response when no current.json exists", async () => {
    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBeNull();
    expect(result.artefacts).toEqual([]);
  });

  it("returns artifacts from manifest file", async () => {
    // Create current.json pointing to manifest
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    // Create manifest with artifact
    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({
        artefacts: {
          "Artifact:TestProducer.Output": {
            blob: { hash: "abc123", size: 100, mimeType: "image/png" },
            status: "succeeded",
            createdAt: "2024-01-01T00:00:00Z",
          },
        },
        createdAt: "2024-01-01T00:00:00Z",
      })
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.artefacts.length).toBe(1);
    expect(result.artefacts[0].id).toBe("Artifact:TestProducer.Output");
    expect(result.artefacts[0].name).toBe("TestProducer.Output");
    expect(result.artefacts[0].hash).toBe("abc123");
    expect(result.artefacts[0].status).toBe("succeeded");
  });

  it("includes event-log-only artifacts not in manifest", async () => {
    // Create current.json with a manifest that has NO artifacts
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({
        artefacts: {},
        createdAt: "2024-01-01T00:00:00Z",
      })
    );

    // Create event log with a succeeded artifact (simulating mid-execution state)
    const eventLogEntry = {
      artefactId: "Artifact:NewProducer.Result",
      output: {
        blob: { hash: "newHash456", size: 200, mimeType: "application/json" },
      },
      status: "succeeded",
      createdAt: "2024-01-02T00:00:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.artefacts.length).toBe(1);
    expect(result.artefacts[0].id).toBe("Artifact:NewProducer.Result");
    expect(result.artefacts[0].name).toBe("NewProducer.Result");
    expect(result.artefacts[0].hash).toBe("newHash456");
    expect(result.artefacts[0].size).toBe(200);
    expect(result.artefacts[0].mimeType).toBe("application/json");
    expect(result.artefacts[0].status).toBe("succeeded");
  });

  it("combines manifest artifacts with event-log-only artifacts", async () => {
    // Create current.json
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    // Create manifest with one artifact
    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({
        artefacts: {
          "Artifact:ExistingProducer.Output": {
            blob: { hash: "existingHash", size: 50, mimeType: "text/plain" },
            status: "succeeded",
            createdAt: "2024-01-01T00:00:00Z",
          },
        },
        createdAt: "2024-01-01T00:00:00Z",
      })
    );

    // Create event log with different artifact (mid-execution)
    const eventLogEntry = {
      artefactId: "Artifact:NewProducer.Result",
      output: {
        blob: { hash: "newHash789", size: 300, mimeType: "audio/mpeg" },
      },
      status: "succeeded",
      createdAt: "2024-01-02T00:00:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    // Should have both artifacts
    expect(result.artefacts.length).toBe(2);

    const existingArtifact = result.artefacts.find(
      (a) => a.id === "Artifact:ExistingProducer.Output"
    );
    const newArtifact = result.artefacts.find(
      (a) => a.id === "Artifact:NewProducer.Result"
    );

    expect(existingArtifact).toBeDefined();
    expect(existingArtifact!.hash).toBe("existingHash");

    expect(newArtifact).toBeDefined();
    expect(newArtifact!.hash).toBe("newHash789");
  });

  it("prefers event log data over manifest for same artifact", async () => {
    // Create current.json
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    // Create manifest with artifact
    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({
        artefacts: {
          "Artifact:TestProducer.Output": {
            blob: { hash: "oldHash", size: 100, mimeType: "image/png" },
            status: "succeeded",
            createdAt: "2024-01-01T00:00:00Z",
          },
        },
        createdAt: "2024-01-01T00:00:00Z",
      })
    );

    // Create event log with updated version of same artifact (user edit)
    const eventLogEntry = {
      artefactId: "Artifact:TestProducer.Output",
      output: {
        blob: { hash: "newEditedHash", size: 150, mimeType: "image/png" },
      },
      status: "succeeded",
      createdAt: "2024-01-02T00:00:00Z",
      editedBy: "user",
      originalHash: "oldHash",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.artefacts.length).toBe(1);
    expect(result.artefacts[0].hash).toBe("newEditedHash");
    expect(result.artefacts[0].size).toBe(150);
    expect(result.artefacts[0].editedBy).toBe("user");
    expect(result.artefacts[0].originalHash).toBe("oldHash");
  });

  it("preserves edit tracking fields from event log", async () => {
    // Create current.json
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    // Create manifest with artifact
    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({
        artefacts: {
          "Artifact:TestProducer.Output": {
            blob: { hash: "originalHash", size: 100, mimeType: "image/png" },
            status: "succeeded",
          },
        },
        createdAt: "2024-01-01T00:00:00Z",
      })
    );

    // Event log shows user edit
    const eventLogEntry = {
      artefactId: "Artifact:TestProducer.Output",
      output: {
        blob: { hash: "editedHash", size: 120, mimeType: "image/png" },
      },
      status: "succeeded",
      createdAt: "2024-01-02T00:00:00Z",
      editedBy: "user",
      originalHash: "originalHash",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.artefacts[0].editedBy).toBe("user");
    expect(result.artefacts[0].originalHash).toBe("originalHash");
  });

  it("ignores failed events in event log", async () => {
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({ artefacts: {}, createdAt: "2024-01-01T00:00:00Z" })
    );

    // Event log has a failed event
    const failedEvent = {
      artefactId: "Artifact:FailedProducer.Output",
      output: {},
      status: "failed",
      createdAt: "2024-01-02T00:00:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(failedEvent) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    // Failed events should not appear as artifacts
    expect(result.artefacts.length).toBe(0);
  });

  it("returns event log artifacts when current.json has null manifestPath (mid-execution)", async () => {
    // Simulate mid-execution: current.json exists with manifestPath: null
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: null })
    );

    // Event log has artifacts from completed producers
    const event1 = {
      artefactId: "Artifact:ImageGen.Output",
      output: {
        blob: { hash: "imgHash123", size: 500, mimeType: "image/png" },
      },
      status: "succeeded",
      createdAt: "2024-01-01T12:00:00Z",
    };
    const event2 = {
      artefactId: "Artifact:AudioGen.Output",
      output: {
        blob: { hash: "audioHash456", size: 1000, mimeType: "audio/mpeg" },
      },
      status: "succeeded",
      createdAt: "2024-01-01T12:01:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBe("rev-001");
    expect(result.artefacts.length).toBe(2);

    const imgArtifact = result.artefacts.find(a => a.id === "Artifact:ImageGen.Output");
    expect(imgArtifact).toBeDefined();
    expect(imgArtifact!.hash).toBe("imgHash123");
    expect(imgArtifact!.mimeType).toBe("image/png");

    const audioArtifact = result.artefacts.find(a => a.id === "Artifact:AudioGen.Output");
    expect(audioArtifact).toBeDefined();
    expect(audioArtifact!.hash).toBe("audioHash456");
    expect(audioArtifact!.mimeType).toBe("audio/mpeg");
  });

  it("returns event log artifacts when no current.json exists", async () => {
    // No current.json, but event log exists (edge case)
    const eventLogEntry = {
      artefactId: "Artifact:Producer.Output",
      output: {
        blob: { hash: "hash789", size: 250, mimeType: "text/plain" },
      },
      status: "succeeded",
      createdAt: "2024-01-01T12:00:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBeNull();
    expect(result.artefacts.length).toBe(1);
    expect(result.artefacts[0].hash).toBe("hash789");
  });

  it("defaults mimeType to application/octet-stream for event-log artifacts", async () => {
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, "current.json"),
      JSON.stringify({ revision: "rev-001", manifestPath: "manifests/rev-001.json" })
    );

    await fs.mkdir(path.join(movieDir, "manifests"), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, "manifests", "rev-001.json"),
      JSON.stringify({ artefacts: {}, createdAt: "2024-01-01T00:00:00Z" })
    );

    // Event log entry without mimeType
    const eventLogEntry = {
      artefactId: "Artifact:Producer.Output",
      output: {
        blob: { hash: "someHash", size: 100 },
      },
      status: "succeeded",
      createdAt: "2024-01-02T00:00:00Z",
    };
    await fs.writeFile(
      path.join(movieDir, "events", "artefacts.log"),
      JSON.stringify(eventLogEntry) + "\n"
    );

    const result = await getBuildManifest(blueprintFolder, movieId);

    expect(result.artefacts.length).toBe(1);
    expect(result.artefacts[0].mimeType).toBe("application/octet-stream");
  });
});

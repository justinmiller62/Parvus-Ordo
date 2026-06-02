import { describe, expect, it } from "vitest";
import { MAX_RECORDING_BYTES, validateRecordingUpload } from "./index";

describe("validateRecordingUpload", () => {
  it("caps the limit at ~120MB (under the proxy's 128MB buffer)", () => {
    expect(MAX_RECORDING_BYTES).toBe(120 * 1024 * 1024);
  });

  it("accepts a recording under the limit", () => {
    expect(validateRecordingUpload(50 * 1024 * 1024)).toBeNull();
  });

  it("accepts a recording exactly at the limit (route rejects only when over)", () => {
    expect(validateRecordingUpload(MAX_RECORDING_BYTES)).toBeNull();
  });

  it("rejects an over-limit recording with a 413 and a human-readable size message", () => {
    const rejection = validateRecordingUpload(200 * 1024 * 1024);
    expect(rejection).not.toBeNull();
    expect(rejection?.status).toBe(413);
    expect(rejection?.message).toBe("recording too large (200 MB). Max 120 MB.");
  });
});

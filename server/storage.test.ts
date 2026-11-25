import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStore } from "./storage";

let root: string;
let store: LocalFileStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "aspire-store-"));
  store = new LocalFileStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalFileStore keys", () => {
  it("stores, reads and removes a file under a generated key", async () => {
    const key = "private-applications/abc123/k7HqWm3zRt9XpB4n";
    const bytes = Buffer.from("%PDF-1.4 sample document");
    await store.put(key, bytes);
    expect(await store.get(key)).toEqual(bytes);
    expect(
      await stat(
        path.join(root, "private-applications", "abc123", "k7HqWm3zRt9XpB4n")
      )
    ).toBeDefined();
    await store.remove(key);
    await expect(store.get(key)).rejects.toThrow();
  });

  it("does not leave temporary files behind and can overwrite a key", async () => {
    await store.put("folder/doc-1", Buffer.from("first"));
    await store.put("folder/doc-1", Buffer.from("second"));
    expect(await store.get("folder/doc-1")).toEqual(Buffer.from("second"));
    expect(await readdir(path.join(root, "folder"))).toEqual(["doc-1"]);
  });

  it("writes files privately on platforms that enforce Unix modes", async () => {
    await store.put("doc", Buffer.from("secret"));
    const info = await stat(path.join(root, "doc"));
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
  });

  it.each([
    "",
    ".hidden",
    "../escape",
    "folder/../../escape",
    "folder/../escape",
    "/absolute",
    "//absolute",
    "folder//doc",
    "folder/",
    "has space",
    "has?query",
    "back\\slash",
    "a".repeat(201),
  ])("rejects the unsafe key %j on every operation", async key => {
    await expect(store.put(key, Buffer.from("x"))).rejects.toThrow(
      "Invalid storage key."
    );
    expect(() => store.get(key)).toThrow("Invalid storage key.");
    await expect(store.remove(key)).rejects.toThrow("Invalid storage key.");
  });

  it("never writes outside the store root", async () => {
    const outside = path.join(path.dirname(root), "aspire-should-not-exist");
    await expect(
      store.put(`../${path.basename(outside)}`, Buffer.from("x"))
    ).rejects.toThrow();
    await expect(stat(outside)).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  });
});

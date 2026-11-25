import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
const dockerignore = readFileSync(path.join(root, ".dockerignore"), "utf8");
const envExample = readFileSync(path.join(root, ".env.example"), "utf8");

describe("deployment configuration", () => {
  it("installs the local document-reading tools in the image", () => {
    expect(dockerfile).toMatch(
      /apt-get install[^\n]*poppler-utils[^\n]*tesseract-ocr/
    );
  });

  it("keeps uploads on a mounted private folder", () => {
    expect(dockerfile).toMatch(/ENV STORAGE_DIR=\/app\/storage/);
    expect(dockerfile).toMatch(/VOLUME \["\/app\/storage"\]/);
    expect(dockerfile).toMatch(/mkdir -p \/app\/storage/);
  });

  it("does not commit secrets or uploaded documents", () => {
    expect(gitignore).toMatch(/^storage\/$/m);
    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).not.toMatch(/manus/i);
    expect(dockerignore).toMatch(/^storage$/m);
    expect(dockerignore).not.toMatch(/manus/i);
  });

  it("documents the database, session secret and storage folder", () => {
    for (const key of ["DATABASE_URL", "SESSION_SECRET", "STORAGE_DIR"])
      expect(envExample).toMatch(new RegExp(`^${key}=`, "m"));
  });
});

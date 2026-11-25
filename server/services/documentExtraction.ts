import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BUFFER = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const UCE_GRADES = new Set(["D1", "D2", "C3", "C4", "C5", "C6", "P7", "P8", "F9"]);
const UACE_GRADES = new Set(["A", "B", "C", "D", "E", "F", "O"]);

export type DocumentCandidate = { subject: string; grade: string; line: number };
export type DocumentExtractionResult = {
  status: "extracted" | "low_confidence" | "unreadable";
  confidence: number | null;
  candidates: DocumentCandidate[];
  warning?: string;
};

/** Conservatively recognize subject/grade pairs while retaining source line numbers. */
export function parseCandidateGrades(text: string): DocumentCandidate[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const candidates: DocumentCandidate[] = [];
  const gradePattern = /(?:^|[\s|,;:])((?:D[12]|C[3-6]|P[78]|F9|[A-F]|O))(?=$|[\s|,;:.])/gi;
  const ignored = /^(?:subject|subjects|grade|grades|candidate|candidate\s*no\.?|index\s*no\.?|result|results|uganda|national|examination|school|name|code)$/i;
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || line.length > 240 || /^(?:subject|grade|candidate|index|name)\b/i.test(line)) return;
    gradePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = gradePattern.exec(line))) {
      const grade = match[1]!.toUpperCase();
      if (!UCE_GRADES.has(grade) && !UACE_GRADES.has(grade)) continue;
      const gradeStart = match.index + match[0].lastIndexOf(match[1]!);
      const before = line.slice(0, gradeStart).replace(/[|,:;\-]+$/g, "").trim();
      const subject = before
        .replace(/^(?:\d{1,4}\s+)?(?:[A-Z]{0,3}\d{2,}[-/]?\s+)?/i, "")
        .replace(/[|,:;\-]+$/g, "")
        .trim();
      if (!subject || subject.length > 80 || ignored.test(subject) || !/[a-z]/i.test(subject)) continue;
      // A plausible subject label is short and textual; avoid treating prose around a grade as a result.
      if (subject.split(/\s+/).length > 8 || /[.!?]/.test(subject) || /\b(?:obtained|scored|achieved|earned|grade|candidate|result)\b/i.test(subject)) continue;
      candidates.push({ subject, grade, line: index + 1 });
      break;
    }
  });
  return candidates;
}

/** Pure policy for deciding whether extracted text is sufficiently useful. */
export function decideExtractionStatus(
  text: string,
  candidates: DocumentCandidate[],
  confidence: number | null,
): Pick<DocumentExtractionResult, "status" | "warning"> {
  const usefulText = text.replace(/\s/g, "").length >= 20;
  if (!usefulText || candidates.length === 0) {
    return { status: "low_confidence", warning: "Little or no plausible result data was found; human review is required." };
  }
  if (confidence !== null && confidence < 60) {
    return { status: "low_confidence", warning: "OCR confidence is low; verify all extracted values by human review." };
  }
  return { status: "extracted" };
}

function unreadable(warning: string): DocumentExtractionResult {
  return { status: "unreadable", confidence: null, candidates: [], warning };
}

function getTsvConfidence(tsv: string): number | null {
  const values = tsv.split(/\r?\n/).slice(1).flatMap((row) => {
    const columns = row.split("\t");
    if (columns.length < 12 || !columns[11]?.trim()) return [];
    const confidence = Number(columns[10]);
    return Number.isFinite(confidence) && confidence >= 0 ? [confidence] : [];
  });
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function run(command: string, args: string[]) {
  return execFileAsync(command, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true });
}

/** Extracts local text/OCR only. Raw extracted text is held transiently and never returned or persisted. */
export async function extractDocument(bytes: Uint8Array, contentType: string): Promise<DocumentExtractionResult> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    throw new TypeError("Document bytes must be a non-empty Uint8Array no larger than 4 MiB");
  }
  const type = contentType.trim().toLowerCase().split(";")[0];
  if (!new Set(["application/pdf", "image/png", "image/jpeg"]).has(type)) {
    throw new TypeError("contentType must be application/pdf, image/png, or image/jpeg");
  }

  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "aspire-document-"));
    const input = path.join(directory, type === "application/pdf" ? "upload.pdf" : type === "image/png" ? "upload.png" : "upload.jpg");
    await writeFile(input, bytes, { flag: "wx", mode: 0o600 });
    let text = "";
    let confidence: number | null = null;

    if (type === "application/pdf") {
      try {
        const result = await run("pdftotext", ["-layout", "-enc", "UTF-8", input, "-"]);
        text = result.stdout;
      } catch (error) {
        if (isTimeout(error)) return unreadable("PDF text extraction timed out; human review is required.");
        if (isMissingTool(error)) return unreadable("The local PDF extraction tool is unavailable; human review is required.");
        // Scanned PDFs commonly yield empty or nearly empty selectable text.
      }
      if (text.replace(/\s/g, "").length < 20) {
        try {
          const prefix = path.join(directory, "page");
          await run("pdftoppm", ["-f", "1", "-l", "3", "-r", "200", "-png", input, prefix]);
          const pages = (await import("node:fs/promises")).readdir(directory);
          for (const name of (await pages).filter((entry) => /^page-\d+\.png$/.test(entry)).sort().slice(0, 3)) {
            const image = path.join(directory, name);
            const { stdout } = await run("tesseract", [image, "stdout", "tsv"]);
            const tsv = stdout;
            const { stdout: pageText } = await run("tesseract", [image, "stdout", "txt"]);
            text += `${pageText}\n`;
            const pageConfidence = getTsvConfidence(tsv);
            if (pageConfidence !== null) confidence = confidence === null ? pageConfidence : (confidence + pageConfidence) / 2;
          }
        } catch (error) {
          if (isTimeout(error)) return unreadable("Scanned PDF OCR timed out; human review is required.");
          if (isMissingTool(error)) return unreadable("A local PDF rendering/OCR tool is unavailable; human review is required.");
          return unreadable("The PDF could not be rendered or read; human review is required.");
        }
      } else {
        const candidates = parseCandidateGrades(text);
        const decision = decideExtractionStatus(text, candidates, null);
        return { ...decision, confidence: null, candidates };
      }
    } else {
      try {
        const { stdout: tsv } = await run("tesseract", [input, "stdout", "tsv"]);
        confidence = getTsvConfidence(tsv);
        const { stdout } = await run("tesseract", [input, "stdout", "txt"]);
        text = stdout;
      } catch (error) {
        if (isTimeout(error)) return unreadable("Image OCR timed out; human review is required.");
        if (isMissingTool(error)) return unreadable("The local OCR tool is unavailable; human review is required.");
        return unreadable("The image could not be read; human review is required.");
      }
    }

    const candidates = parseCandidateGrades(text);
    const decision = decideExtractionStatus(text, candidates, confidence);
    return { ...decision, confidence, candidates };
  } catch (error) {
    if (isTimeout(error)) return unreadable("Document processing timed out; human review is required.");
    if (isMissingTool(error)) return unreadable("A required local document tool is unavailable; human review is required.");
    return unreadable("The document is malformed or could not be processed; human review is required.");
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function isTimeout(error: unknown): boolean {
  return !!error && typeof error === "object" && "killed" in error && (error as { killed?: boolean }).killed === true;
}
function isMissingTool(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT";
}

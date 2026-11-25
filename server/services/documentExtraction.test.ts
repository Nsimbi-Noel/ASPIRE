import { describe, expect, it } from "vitest";
import { decideExtractionStatus, parseCandidateGrades } from "./documentExtraction";

describe("parseCandidateGrades", () => {
  it("extracts plausible UCE and UACE subject grades with one-based source lines", () => {
    expect(parseCandidateGrades("Candidate results\nEnglish Language D1\nMathematics C4\nHistory A\nEconomics O")).toEqual([
      { subject: "English Language", grade: "D1", line: 2 },
      { subject: "Mathematics", grade: "C4", line: 3 },
      { subject: "History", grade: "A", line: 4 },
      { subject: "Economics", grade: "O", line: 5 },
    ]);
  });

  it("handles separators and ignores headings, unsupported grades, and grade-like prose", () => {
    expect(parseCandidateGrades("Subject | Grade\nBiology: P8\nAgriculture F9\nEnglish Z\nThe candidate obtained grade C in general")).toEqual([
      { subject: "Biology", grade: "P8", line: 2 },
      { subject: "Agriculture", grade: "F9", line: 3 },
    ]);
  });
});

describe("decideExtractionStatus", () => {
  const candidates = [{ subject: "English", grade: "C4", line: 1 }];

  it("marks empty, short, or candidate-free text for human review", () => {
    expect(decideExtractionStatus("", [], null).status).toBe("low_confidence");
    expect(decideExtractionStatus("English C4", candidates, null).status).toBe("low_confidence");
    expect(decideExtractionStatus("A sufficiently long result document without recognized rows.", [], null).status).toBe("low_confidence");
  });

  it("uses the confidence threshold for OCR and permits searchable text with null confidence", () => {
    const text = "Candidate results include English language and mathematics.";
    expect(decideExtractionStatus(text, candidates, 59.9)).toMatchObject({ status: "low_confidence", warning: expect.any(String) });
    expect(decideExtractionStatus(text, candidates, 60).status).toBe("extracted");
    expect(decideExtractionStatus(text, candidates, null).status).toBe("extracted");
  });
});

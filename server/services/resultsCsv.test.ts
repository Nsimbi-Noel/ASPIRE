import { describe, expect, it } from "vitest";
import { parseResultsCsv, ResultsCsvError } from "./resultsCsv";

const header = "reference,exam,subject,grade,sitting,subjectLevel";
const uce = (row = "APP-1,uce,English,c4,2025,") => `${header}\n${row}`;

function expectCsvError(csv: string, fragment: string) {
  expect(() => parseResultsCsv(csv)).toThrowError(new RegExp(fragment));
}

describe("parseResultsCsv", () => {
  it("normalizes case and whitespace and retains the exact reference", () => {
    expect(parseResultsCsv(`${header}\n APP-001 , uCe , English Language , c4 , 2025 , `)).toEqual([
      { reference: "APP-001", exam: "UCE", subject: "English Language", grade: "C4", sitting: "2025" },
    ]);
  });

  it("supports reordered headers, quoted commas, escaped quotes, and embedded newlines", () => {
    const csv = 'subjectLevel,subject,reference,sitting,grade,exam\nPRINCIPAL,"History, ""Modern""\nAfrica",R-9,2024,b,uace';
    expect(parseResultsCsv(csv)).toEqual([{
      reference: "R-9", exam: "UACE", subject: 'History, "Modern" Africa', grade: "B", sitting: "2024", subjectLevel: "PRINCIPAL",
    }]);
  });

  it("validates exact unique supported header names", () => {
    expectCsvError("reference,exam,subject,grade,sitting,level", "unsupported header");
    expectCsvError("reference,exam,subject,grade,sitting,sitting", "duplicate header");
    expectCsvError("reference,exam,subject,grade,sitting", "missing required header");
    expectCsvError(`${header},other\n`, "unsupported header");
  });

  it("reports required fields and malformed quoting", () => {
    expectCsvError(`${header}\nAPP-1,UCE,,C4,2025,`, "row 2, subject: value is required");
    expectCsvError(`${header}\nAPP-1,UCE,"English,C4,2025,`, "unterminated quoted field");
    expectCsvError(`${header}\nAPP-1,UCE,Eng"lish,C4,2025,`, "quote must begin a field");
  });

  it("enforces exam-specific grades and subject levels", () => {
    expectCsvError(uce("APP-1,UCE,English,A,2025,"), "row 2, grade");
    expectCsvError(uce("APP-1,UCE,English,C4,2025,PRINCIPAL"), "row 2, subjectLevel");
    expectCsvError(`${header}\nAPP-1,UACE,History,O,2025,SUBSIDIARY`, "row 2, grade");
    expectCsvError(`${header}\nAPP-1,UACE,History,A,2025,`, "row 2, subjectLevel");
    expect(parseResultsCsv(`${header}\nAPP-1,UACE,History,a,2025,principal`)[0]).toMatchObject({ grade: "A", subjectLevel: "PRINCIPAL" });
  });

  it("validates sitting and reference and enforces row and byte limits", () => {
    expectCsvError(uce("bad ref!,UCE,English,C4,2025,"), "row 2, reference");
    expectCsvError(uce("APP-1,UCE,English,C4,25,"), "row 2, sitting");
    expect(() => parseResultsCsv(`${header}\n${Array.from({ length: 2001 }, () => "APP-1,UCE,English,C4,2025,").join("\n")}`)).toThrow(/more than 2000/);
    expect(() => parseResultsCsv(" ".repeat(1024 * 1024 + 1))).toThrow(ResultsCsvError);
  });
});

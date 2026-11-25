export type ResultsCsvRow = {
  reference: string;
  exam: "UCE" | "UACE";
  subject: string;
  grade: string;
  sitting: string;
  subjectLevel?: "PRINCIPAL" | "SUBSIDIARY";
};

export class ResultsCsvError extends Error {
  readonly row?: number;
  readonly column?: string;

  constructor(message: string, row?: number, column?: string) {
    const location = [row === undefined ? undefined : `row ${row}`, column].filter(Boolean).join(", ");
    super(location ? `${location}: ${message}` : message);
    this.name = "ResultsCsvError";
    this.row = row;
    this.column = column;
  }
}

const requiredHeaders = ["reference", "exam", "subject", "grade", "sitting", "subjectLevel"] as const;
type Header = (typeof requiredHeaders)[number];
const headerSet = new Set<string>(requiredHeaders);
const uceGrades = new Set(["D1", "D2", "C3", "C4", "C5", "C6", "P7", "P8", "F9"]);
const uacePrincipalGrades = new Set(["A", "B", "C", "D", "E", "O", "F"]);
const uaceSubsidiaryGrades = uceGrades;

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let recordHasContent = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n" && !/[\t ]/.test(char)) {
      throw new ResultsCsvError("unexpected character after closing quote");
    }
    if (char === '"') {
      if (field.trim() !== "" || (!closedQuote && field !== "")) throw new ResultsCsvError("quote must begin a field");
      field = "";
      quoted = true;
      recordHasContent = true;
    } else if (char === ",") {
      row.push(field.trim()); field = ""; closedQuote = false; recordHasContent = true;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (recordHasContent || row.some((value) => value !== "")) records.push(row);
      row = []; field = ""; closedQuote = false; recordHasContent = false;
    } else {
      if (closedQuote) continue;
      field += char;
      if (!/[\t ]/.test(char)) recordHasContent = true;
    }
  }
  if (quoted) throw new ResultsCsvError("unterminated quoted field");
  if (recordHasContent || row.length > 0 || field !== "") {
    row.push(field.trim());
    records.push(row);
  }
  return records;
}

/** Parse a results CSV using the exact six-field schema; errors include CSV row and column where applicable. */
export function parseResultsCsv(text: string): ResultsCsvRow[] {
  if (typeof text !== "string") throw new ResultsCsvError("CSV input must be text");
  if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new ResultsCsvError("CSV exceeds the 1 MiB size limit");
  let records: string[][];
  try { records = parseRecords(text); }
  catch (error) {
    if (error instanceof ResultsCsvError) throw error;
    throw new ResultsCsvError("malformed CSV quoting");
  }
  if (records.length === 0) throw new ResultsCsvError("CSV is empty; include the required header");
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const headers = records[0]!.map(normalize);
  for (const header of headers) {
    if (!headerSet.has(header)) throw new ResultsCsvError(`unsupported header '${header || "(blank)"}'`, 1, header || "header");
  }
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new ResultsCsvError(`duplicate header '${header}'`, 1, header);
    seen.add(header);
  }
  const missingHeaders = requiredHeaders.filter((header) => !seen.has(header));
  if (missingHeaders.length) throw new ResultsCsvError(`missing required header${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.join(", ")}`, 1);
  if (headers.length !== requiredHeaders.length) throw new ResultsCsvError("header must contain exactly the six supported columns", 1);

  const columnIndex = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<Header, number>;
  const data = records.slice(1);
  if (data.length > 2000) throw new ResultsCsvError("CSV contains more than 2000 data rows");
  const parsed: ResultsCsvRow[] = [];
  data.forEach((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) throw new ResultsCsvError(`expected ${headers.length} fields but found ${values.length}`, rowNumber);
    const get = (column: Header) => normalize(values[columnIndex[column]]!);
    for (const column of requiredHeaders) {
      if (!get(column) && !(column === "subjectLevel")) throw new ResultsCsvError("value is required", rowNumber, column);
    }
    const reference = get("reference");
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(reference)) throw new ResultsCsvError("invalid reference; use letters, digits, dot, underscore, slash, or hyphen", rowNumber, "reference");
    const exam = get("exam").toUpperCase();
    if (exam !== "UCE" && exam !== "UACE") throw new ResultsCsvError("must be UCE or UACE", rowNumber, "exam");
    const subject = get("subject");
    if (!subject || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(subject)) throw new ResultsCsvError("invalid subject", rowNumber, "subject");
    const grade = get("grade").toUpperCase();
    if (exam === "UCE" && !uceGrades.has(grade)) throw new ResultsCsvError("must be one of D1, D2, C3, C4, C5, C6, P7, P8, F9 for UCE", rowNumber, "grade");
    const rawLevel = get("subjectLevel").toUpperCase();
    const subjectLevel = rawLevel === "" ? undefined : rawLevel;
    if (exam === "UCE") {
      if (!uceGrades.has(grade)) throw new ResultsCsvError("must be one of D1, D2, C3, C4, C5, C6, P7, P8, F9 for UCE", rowNumber, "grade");
      if (subjectLevel !== undefined) throw new ResultsCsvError("must be blank for UCE", rowNumber, "subjectLevel");
    } else {
      if (subjectLevel !== "PRINCIPAL" && subjectLevel !== "SUBSIDIARY") throw new ResultsCsvError("must be PRINCIPAL or SUBSIDIARY for UACE", rowNumber, "subjectLevel");
      const allowed = subjectLevel === "PRINCIPAL" ? uacePrincipalGrades : uaceSubsidiaryGrades;
      if (!allowed.has(grade)) throw new ResultsCsvError(`invalid ${subjectLevel.toLowerCase()} UACE grade`, rowNumber, "grade");
    }
    const sitting = get("sitting");
    if (!/^\d{4}$/.test(sitting)) throw new ResultsCsvError("must be a four-digit year", rowNumber, "sitting");
    parsed.push({ reference, exam, subject, grade, sitting, ...(subjectLevel ? { subjectLevel } : {}) });
  });
  return parsed;
}

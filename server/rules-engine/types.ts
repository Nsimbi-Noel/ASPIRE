import { type UaceLevel, UCE_GRADE_OPTIONS, UACE_PRINCIPAL_GRADES, UACE_SUBSIDIARY_GRADES } from "@shared/const";

// ---------- Outcomes ----------
export type Outcome = "ELIGIBLE" | "NOT_ELIGIBLE" | "ON_HOLD";
export type CheckStatus = "PASS" | "FAIL" | "REVIEW";
export type HoldReason = "MISSING_DOCUMENTS" | "MANUAL_REVIEW";

// ---------- Applicant ----------
export type Level = "bachelors" | "diploma" | "certificate" | "higher_education_certificate";

/** UCE (O-level) grades: legacy D1–F9 or numeric 1–9. */
export type OLevelGrade = (typeof UCE_GRADE_OPTIONS)[number];
/** UACE principal grades. "O" is a subsidiary-level pass in a principal subject. */
export type PrincipalGrade = (typeof UACE_PRINCIPAL_GRADES)[number];
/** UACE subsidiary grades: numeric 1–9, O/F, and legacy D1–F9 labels. */
export type UaceSubsidiaryGrade = (typeof UACE_SUBSIDIARY_GRADES)[number];

export interface UceResult {
  subject: string;
  grade: OLevelGrade;
  sitting: string; // exam year, for example "2023"
}

export interface UaceResult {
  subject: string;
  level: UaceLevel;
  grade: PrincipalGrade | UaceSubsidiaryGrade;
  sitting: string;
}

export type Classification =
  | "DISTINCTION" | "CREDIT" | "PASS"
  | "FIRST_CLASS" | "SECOND_CLASS" | "PASS_CLASS";

export interface Qualification {
  type: "DIPLOMA" | "CERTIFICATE" | "HEAC";
  classification: Classification;
  /** Set by an officer. Leave undefined when not yet judged. */
  relatedToProgramme?: boolean;
}

export interface Applicant {
  id: string;
  uce: UceResult[];
  /** Overall UCE grade, for example "1", "2", "9", "X". */
  uceOverallGrade?: string;
  uace: UaceResult[];
  qualifications: Qualification[];
  /** Document types the applicant has submitted. */
  documents: string[];
}

// ---------- Rules ----------
interface RuleBase { id: string }

export type Rule =
  | (RuleBase & { type: "MIN_PRINCIPAL_PASSES"; count: number; sameSitting: boolean })
  | (RuleBase & { type: "MIN_SUBSIDIARY_PASSES"; count: number })
  | (RuleBase & { type: "MIN_UCE_PASSES"; count: number; sameSitting: boolean })
  | (RuleBase & { type: "HAS_UCE_RESULTS" })
  | (RuleBase & {
      type: "QUALIFICATION_CLASS_AT_LEAST";
      qualification: Qualification["type"];
      accepted: Classification[];
      label: string;
      requireRelated: boolean;
    })
  | (RuleBase & { type: "SUBJECTS_RELEVANT_TO_PROGRAMME" })
  | (RuleBase & { type: "MATHS_CREDIT_REQUIREMENT" })
  | (RuleBase & { type: "OLEVEL_OVERALL_GRADE_NOT_IN"; grades: string[] });

export interface Route { id: string; rules: Rule[] }

export interface RuleSetMeta {
  id: string;
  status: "official" | "adopted-proxy" | "assumed";
  source: string;
  edition?: string;
  approval: string;
}

// ---------- Weighting (adopted system) ----------
export type EntryBasis = "UACE" | "UCE" | "UACE_DIRECT" | "DIPLOMA" | "CERTIFICATE_HOLDER" | "HIGHER_EDUCATION_ACCESS";
export type SubjectList = string[] | "ALL" | "REMAINING" | "REMAINING_EXCLUDING_FINE_ART" | "ALL_ARTS_SUBJECTS" | "Language subjects";

export type Selector =
  | { type: "REQUIRED"; subjects: string[] }
  | { type: "BEST_OF"; n?: number; n_min?: number; n_max?: number; from: SubjectList }
  | { type: "ANY_OR_BOTH"; n?: number; subjects: string[] };

export interface WeightVariant {
  id: string;
  essential: Selector[];
  relevant: Selector[];
  desirable: string[];
  entry_basis?: EntryBasis;
}

export interface SubDegreeWeighting {
  diploma_and_heac_uace: {
    essential_count: number;
    essential_weight: number;
    essential_grades: string[];
    relevant_count: number;
    relevant_weight: number;
    relevant_grades: string[];
    desirable_weight: number;
  };
  certificate_and_diploma_holder_standing: Record<string, number>;
  uce_subject_points: Record<string, number>;
}

export interface WeightingSystem {
  category_weights: { essential: number; relevant: number; desirable: number };
  alevel_points: Record<string, number>;
  sub_degree_weighting?: SubDegreeWeighting;
}

export interface Weighting {
  ruleId: string;
  system: WeightingSystem;
  variants: WeightVariant[];
}

export interface RuleSet {
  programmeId: string;
  programmeName: string;
  level: Level;
  meta: RuleSetMeta;
  routes: Route[];
  documents: { common: string[]; byRoute: Record<string, string[]> };
  weighting?: Weighting;
  notes: string[];
}

// ---------- Results ----------
export interface Check {
  ruleId: string;
  type: Rule["type"];
  status: CheckStatus;
  expected: string;
  actual: string;
  /** How far short the applicant is, where it can be measured. Positive means short. */
  gap?: number;
}

export interface RouteResult {
  routeId: string;
  status: CheckStatus;
  checks: Check[];
}

export interface ScoreLine {
  subject: string;
  grade: string;
  category: "essential" | "relevant" | "desirable" | "standing";
  points: number;
  weight: number;
  contribution: number;
}

export interface WeightedScore {
  total: number;
  alevel: number;
  desirable: number;
  olevel: number;
  uce?: number;
  standing?: number;
  variant?: string;
  lines: ScoreLine[];
  warnings: string[];
}

export interface ScreeningResult {
  programmeId: string;
  programmeName: string;
  ruleSet: RuleSetMeta;
  outcome: Outcome;
  academic: {
    status: CheckStatus;
    routes: RouteResult[];
    passedRoute?: string;
    nearestRoute?: string;
  };
  documents: { required: string[]; missing: string[] };
  holdReasons: HoldReason[];
  /** Advisory only. Never used to decide the outcome. */
  score?: WeightedScore;
}

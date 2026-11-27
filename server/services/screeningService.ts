import entryRequirements from "../../data/rules/entry-requirements.umu-2026-27.json";
import baselineMapping from "../../data/rules/programme-mapping.umu.json";
import mappingProposal from "../../data/rules/programme-mapping-proposal.umu.json";
import programmeWeights from "../../data/rules/programme-weights.2026-27.json";
import weightingSystem from "../../data/rules/weighting-system.public-universities-2026-27.json";
import programmeFaculties from "../../data/catalogue/programme-faculties.umu-2026-27.json";
import programmeOfferings from "../../data/catalogue/programme-offerings.umu-2026-27.json";
import { buildRuleSet, screen, type Applicant, type Level, type RuleSet, type RulesData, type ScreeningResult } from "../rules-engine";
import {
  createProgrammeMappingRegistry,
  type ProgrammeMappingDataset,
  type ProgrammeWeightDataset,
} from "./programmeMappings";
import { rankProgrammes } from "./programmeRanking";

export type MappingStatus = "adopted-proxy" | "needs-review" | "unsupported";

export interface ProgrammeOffering {
  campusId: string;
  modes: string[];
  duration?: string;
}

export interface CatalogueProgramme {
  id: string;
  name: string;
  level: string;
  mappingStatus: MappingStatus;
  match?: string;
  ruleIds: string[];
  note?: string;
  approval: string;
  ruleApprovalStatus: "pending" | "approved" | "rejected" | "none";
  screenable: boolean;
  issues: string[];
  /** The programme's faculty. Null for the postgraduate umbrella entry, which only the registrar can see. */
  facultyId: string | null;
  campusIds: string[];
  studyModes: string[];
  offerings: ProgrammeOffering[];
}

/** A rule set read from the database, with its approval state. */
export interface StoredRuleSet {
  recordId: string;
  ruleSet: RuleSet;
  approvalStatus: "pending" | "approved" | "rejected";
}

export interface OperationalScreeningResult {
  result: ScreeningResult;
  /** The stored rule set row used, or null when screening used the rules in the data files. */
  ruleSetRecordId: string | null;
  ruleApproval: "approved" | "pending" | "rejected" | "none";
  outcome: ScreeningResult["outcome"];
  mapping: CatalogueProgramme;
  mappingReviewRequired: boolean;
  explanation: string;
  recommendation?: {
    rank?: number;
    closenessCoefficient?: number;
    version: string;
    method: string;
    methodNote: string;
    criterionValues?: Record<string, number>;
    criterionWeights: Record<string, number>;
  };
}

const rawBaseline = baselineMapping as unknown as ProgrammeMappingDataset;
const rawProposal = mappingProposal as unknown as ProgrammeMappingDataset;
const weightsData = programmeWeights as unknown as ProgrammeWeightDataset;
const baselineRegistry = createProgrammeMappingRegistry(rawBaseline, weightsData);
const proposalRegistry = createProgrammeMappingRegistry(rawProposal, weightsData);
const baselineMapped = new Map(rawBaseline.mapped.map((row) => [row.id, row]));
const baselineNoEquivalent = new Set(
  (rawBaseline.no_equivalent ?? []).map((row) => String((row as { umu_programme?: string }).umu_programme ?? "")),
);
const proposalEntries = mappingProposal.mapped as Array<{
  id: string;
  umu_programme: string;
  level: string;
  rules: Array<{ rule: string; role: string; match: string }>;
  note?: string;
}>;
const proposalById = new Map(proposalEntries.map((row) => [row.id, row]));
const offeringsByProgramme = programmeOfferings.programmes as Record<string, ProgrammeOffering[]>;

function offeringsFor(id: string): ProgrammeOffering[] {
  return (offeringsByProgramme[id] ?? []).map((offering) => ({ ...offering, modes: [...offering.modes] }));
}

function issuesFor(id: string, proposalRow: (typeof proposalEntries)[number], baseRow: ProgrammeMappingDataset["mapped"][number] | undefined): string[] {
  const issues = new Set<string>();
  for (const issue of proposalRegistry.getIssuesById(id)) issues.add(issue.message);
  for (const issue of baselineRegistry.getIssuesById(id)) issues.add(issue.message);
  if (!baseRow) {
    issues.add("No active source-rule mapping exists in the feature-1 baseline; use UMU general requirements only after staff review.");
  }
  if (baseRow?.rules.some((item) => item.match === "partial")) {
    issues.add("Partial programme match: keep on manual review until UMU confirms the mapping.");
  }
  if (baselineNoEquivalent.has(proposalRow.umu_programme)) {
    issues.add("Feature-1 classifies this programme as having no equivalent source rule; the proposal does not make it approved.");
  }
  if (proposalRow.level === "sub-bachelors") {
    issues.add("Umbrella category is not a supported screening level; select an individual diploma or certificate programme.");
  }
  if (proposalRow.level === "postgraduate") {
    issues.add("Postgraduate screening is outside v1 scope.");
  }
  return [...issues];
}

/** Catalogue merges the feature-1 active mappings with the later user proposal without activating unresolved IDs. */
export const programmeCatalogue: CatalogueProgramme[] = proposalEntries.map((proposalRow) => {
  const baselineRow = baselineMapped.get(proposalRow.id);
  const safeBaseline = baselineRegistry.getById(proposalRow.id);
  const unresolved = !safeBaseline;
  const unsupported = proposalRow.level === "sub-bachelors" || proposalRow.level === "postgraduate";
  const isUmbrella = proposalRow.id === "umu-postgraduates";
  const level = proposalRow.level;
  const note = proposalRow.note ?? (baselineRow as { note?: string } | undefined)?.note;
  const ruleIds = safeBaseline?.rules.map((rule) => rule.rule) ?? [];
  const offerings = offeringsFor(proposalRow.id);
  const studyModes = [...new Set(offerings.flatMap((offering) => offering.modes))];
  return {
    id: proposalRow.id,
    name: proposalRow.umu_programme,
    level,
    mappingStatus: unsupported || unresolved ? "needs-review" : "adopted-proxy",
    match: baselineRow?.rules.find((rule) => rule.role === "primary")?.match ?? proposalRow.rules.find((rule) => rule.role === "primary")?.match,
    ruleIds,
    note,
    approval: String((mappingProposal.meta as { approval?: string }).approval ?? "pending UMU approval"),
    ruleApprovalStatus: "none",
    screenable: !unsupported && !isUmbrella && ["bachelors", "diploma", "certificate", "higher_education_certificate"].includes(level),
    issues: issuesFor(proposalRow.id, proposalRow, baselineRow),
    facultyId: (programmeFaculties.programmes as Record<string, string>)[proposalRow.id] ?? null,
    campusIds: offerings.map((offering) => offering.campusId),
    studyModes,
    offerings,
  };
});

const rulesData = {
  entry: entryRequirements,
  mapping: { mapped: baselineRegistry.listUsable() },
  programmeWeights,
  weightingSystem,
} as unknown as RulesData;

export function listProgrammes(): CatalogueProgramme[] {
  return programmeCatalogue.map((programme) => ({
    ...programme,
    ruleIds: [...programme.ruleIds],
    issues: [...programme.issues],
    campusIds: [...programme.campusIds],
    studyModes: [...programme.studyModes],
    offerings: programme.offerings.map((offering) => ({ ...offering, modes: [...offering.modes] })),
  }));
}

export function listFaculties(): Array<{ id: string; name: string }> {
  return programmeFaculties.faculties.map((faculty) => ({ ...faculty }));
}

export function listCampuses(): Array<{ id: string; name: string }> {
  return programmeOfferings.campuses.map((campus) => ({ ...campus }));
}

export function listStudyModes(): Array<{ id: string; label: string }> {
  return programmeOfferings.studyModes.map((mode) => ({ ...mode }));
}

export function facultyOfProgramme(programmeId: string): string | null {
  return getProgrammeById(programmeId)?.facultyId ?? null;
}

/** Compiles the rule set for a programme from the data files (UMU general rules plus adopted rules). */
export function compileFileRuleSet(programmeId: string): RuleSet {
  const mapping = getProgrammeById(programmeId);
  if (!mapping) throw new Error(`Unknown programme: ${programmeId}`);
  return buildRuleSet(rulesData, { programmeId, programmeName: mapping.name, level: mapping.level as Level });
}

export function getProgrammeById(programmeId: string): CatalogueProgramme | undefined {
  return programmeCatalogue.find((programme) => programme.id === programmeId);
}

export function screenProgramme(applicant: Applicant, programmeId: string, stored?: StoredRuleSet): OperationalScreeningResult {
  const mapping = getProgrammeById(programmeId);
  if (!mapping) throw new Error(`Unknown programme: ${programmeId}`);
  if (!mapping.screenable) throw new Error(`${mapping.name} is not supported for automated screening in v1.`);
  const level = mapping.level as Level;
  const result = screen(applicant, stored ? stored.ruleSet : buildRuleSet(rulesData, {
    programmeId,
    programmeName: mapping.name,
    level,
  }));
  const mappingReviewRequired = mapping.mappingStatus === "needs-review";
  const outcome = mappingReviewRequired && result.outcome !== "NOT_ELIGIBLE" ? "ON_HOLD" : result.outcome;
  const explanation = mappingReviewRequired
    ? "The general entry route was checked, but the programme mapping is unconfirmed or unresolved. Staff review is required before this programme can be treated as eligible."
    : result.outcome === "NOT_ELIGIBLE"
      ? "At least one required academic route failed. Missing documents do not override this result."
      : result.outcome === "ON_HOLD"
        ? "The academic route needs review or required documents are missing. See the trace for details."
        : "The published general route and available adopted proxy checks passed; the final decision remains with the admissions committee.";
  return { result, outcome, mapping, mappingReviewRequired, explanation, ruleSetRecordId: stored?.recordId ?? null, ruleApproval: stored?.approvalStatus ?? "none" };
}

export function screenAllProgrammes(applicant: Applicant, storedFor?: (programmeId: string) => StoredRuleSet | undefined): OperationalScreeningResult[] {
  const results = programmeCatalogue
    .filter((programme) => programme.screenable)
    .map((programme) => screenProgramme(applicant, programme.id, storedFor?.(programme.id)));
  const ranking = rankProgrammes(results.map((item) => ({ ...item.result, outcome: item.outcome })));
  const byId = new Map(ranking.results.map((item) => [item.programme.programmeId, item]));
  return results.map((item) => {
    const ranked = byId.get(item.mapping.id);
    return {
      ...item,
      ...(ranked ? { recommendation: {
        rank: ranked.rank,
        closenessCoefficient: ranked.closenessCoefficient,
        version: ranked.version,
        method: ranked.method,
        methodNote: ranked.methodNote,
        criterionValues: ranked.criterionValues,
        criterionWeights: ranked.criterionWeights,
      } } : {}),
    };
  });
}

export function buildEngineApplicant(input: {
  id: string;
  results: Array<{ exam: "UCE" | "UACE"; subject: string; grade: string; subjectLevel: "PRINCIPAL" | "SUBSIDIARY" | null; sitting: string }>;
  qualifications: Array<{ qualificationType: "DIPLOMA" | "CERTIFICATE" | "HEAC"; classification: string; relatedToProgramme: boolean | null }>;
  documentTypes: string[];
}): Applicant {
  return {
    id: input.id,
    uce: input.results.filter((row) => row.exam === "UCE").map((row) => ({ subject: row.subject, grade: row.grade as Applicant["uce"][number]["grade"], sitting: row.sitting })),
    uace: input.results.filter((row) => row.exam === "UACE").map((row) => ({ subject: row.subject, grade: row.grade as Applicant["uace"][number]["grade"], level: row.subjectLevel ?? "PRINCIPAL", sitting: row.sitting })),
    qualifications: input.qualifications.map((row) => ({
      type: row.qualificationType,
      classification: row.classification as Applicant["qualifications"][number]["classification"],
      ...(row.relatedToProgramme === null ? {} : { relatedToProgramme: row.relatedToProgramme }),
    })),
    documents: input.documentTypes,
  };
}

export function mappingProposalSummary() {
  return {
    approval: (mappingProposal.meta as { approval?: string }).approval ?? "pending UMU approval",
    status: (mappingProposal.meta as { status?: string }).status ?? "adopted-proxy",
    totalEntries: proposalEntries.length,
    proposalIssues: proposalRegistry.issues,
    baselineUsableCount: baselineRegistry.listUsable().length,
  };
}

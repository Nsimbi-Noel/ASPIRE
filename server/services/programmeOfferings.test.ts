import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getProgrammeById, listCampuses, listStudyModes } from "./screeningService";

const here = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(`${here}/${relativePath}`, "utf8")) as unknown;

const proposal = readJson("data/rules/programme-mapping-proposal.umu.json") as {
  mapped: Array<{ id: string }>;
};
const offerings = readJson("data/catalogue/programme-offerings.umu-2026-27.json") as {
  campuses: Array<{ id: string }>;
  studyModes: Array<{ id: string }>;
  programmes: Record<string, Array<{ campusId: string; modes: string[]; duration?: string }>>;
};

const campusIds = new Set(offerings.campuses.map((campus) => campus.id));
const modeIds = new Set(offerings.studyModes.map((mode) => mode.id));

describe("programme offerings catalogue", () => {
  it("covers every mapped programme and only offers it at Nkozi", () => {
    expect(offerings.campuses.map((campus) => campus.id)).toEqual(["nkozi"]);
    expect(Object.keys(offerings.programmes).sort()).toEqual(proposal.mapped.map((row) => row.id).sort());
    for (const [programmeId, rows] of Object.entries(offerings.programmes)) {
      for (const row of rows) {
        expect(row.campusId, programmeId).toBe("nkozi");
        expect(campusIds.has(row.campusId), `${programmeId}: ${row.campusId}`).toBe(true);
        expect(row.modes.length, programmeId).toBeGreaterThan(0);
        for (const mode of row.modes) expect(modeIds.has(mode), `${programmeId}: ${mode}`).toBe(true);
      }
    }
  });

  it("exposes campus and study mode details on catalogue programmes", () => {
    expect(listCampuses().map((campus) => campus.name)).toEqual(["Main Campus, Nkozi"]);
    expect(listStudyModes().map((mode) => mode.label)).toContain("Full-time / day");
    expect(getProgrammeById("umu-bbam")).toMatchObject({
      campusIds: ["nkozi"],
      studyModes: ["full-time"],
    });
    expect(getProgrammeById("umu-bsc-agric")).toMatchObject({
      campusIds: ["nkozi"],
      studyModes: ["distance-learning"],
    });
    expect(getProgrammeById("umu-llb")).toMatchObject({
      campusIds: ["nkozi"],
      studyModes: ["full-time"],
    });
  });

  it("omits programmes that were offered only at other campuses", () => {
    for (const id of [
      "umu-real-estate", "umu-civil-eng", "umu-elec-eng", "umu-mech-eng", "umu-counselling-psych",
      "umu-social-dev-counselling", "umu-bsc-public-health", "umu-bsc-health-promotion", "umu-acct-fin-cpa",
    ]) {
      expect(offerings.programmes[id], id).toBeUndefined();
      expect(getProgrammeById(id), id).toBeUndefined();
    }
  });

  it("keeps the postgraduate umbrella flexible without pretending it is selectable", () => {
    const postgraduates = getProgrammeById("umu-postgraduates");
    expect(postgraduates).toMatchObject({ campusIds: [], studyModes: [], offerings: [], screenable: false });
  });
});

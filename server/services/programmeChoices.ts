export const MAX_PROGRAMME_CHOICES = 5;

export interface ExistingChoice { programmeId: string; status: "submitted" | "withdrawn"; choiceRank: number }

export interface ChoicePlan {
  /** Choices to create or update, in rank order starting at 1. */
  upserts: Array<{ programmeId: string; choiceRank: number }>;
  /** Existing submitted choices that are no longer wanted. */
  withdraw: string[];
}

/** Turns an ordered list of wanted programmes into the changes needed. Duplicates are ignored. */
export function planProgrammeChoices(existing: ExistingChoice[], desired: string[]): ChoicePlan {
  const wanted: string[] = [];
  for (const id of desired) if (!wanted.includes(id)) wanted.push(id);
  if (wanted.length > MAX_PROGRAMME_CHOICES) throw new Error(`Choose at most ${MAX_PROGRAMME_CHOICES} programmes.`);
  return {
    upserts: wanted.map((programmeId, index) => ({ programmeId, choiceRank: index + 1 })),
    withdraw: existing.filter((row) => row.status === "submitted" && !wanted.includes(row.programmeId)).map((row) => row.programmeId),
  };
}

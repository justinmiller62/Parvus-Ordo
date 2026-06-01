import { describe, expect, it } from "vitest";
import { buildDictIndex, findDictionaryTerms, normalizeSacredText, normalizeWord } from "./normalize";

describe("normalizeWord", () => {
  it("lowercases and strips surrounding punctuation incl. smart quotes", () => {
    expect(normalizeWord("Eucharist,")).toBe("eucharist");
    expect(normalizeWord("“Believe”")).toBe("believe");
    expect(normalizeWord("(Mary)!")).toBe("mary");
  });
});

describe("normalizeSacredText", () => {
  it("capitalizes divine names; multi-word phrases before singles", () => {
    expect(normalizeSacredText("the holy spirit and the spirit")).toBe("the Holy Spirit and the Spirit");
    expect(normalizeSacredText("god, jesus, the eucharist")).toBe("God, Jesus, the Eucharist");
  });
});

describe("findDictionaryTerms", () => {
  const index = buildDictIndex([
    { headword: "Holy Spirit" },
    { headword: "Spirit" },
    { headword: "believe", variants: ["believes", "belief"] },
  ]);

  it("matches the longest phrase, not a word inside it", () => {
    const m = findDictionaryTerms("We trust the Holy Spirit today", index);
    expect(m.map((x) => x.headword)).toEqual(["holy spirit"]);
  });

  it("matches a variant and only the first occurrence of a headword", () => {
    const m = findDictionaryTerms("I believe, you believes, we believe again", index);
    expect(m.map((x) => x.headword)).toEqual(["believe"]);
    expect(m[0]!.at).toBe(1); // first occurrence
  });

  it("matches standalone Spirit when not part of Holy Spirit", () => {
    const m = findDictionaryTerms("the Spirit moves", index);
    expect(m.map((x) => x.headword)).toEqual(["spirit"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildDictIndex,
  findDictionaryTerms,
  highlightHtml,
  normalizeSacredText,
  normalizeWord,
  segmentText,
} from "./normalize";

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

describe("segmentText", () => {
  const index = buildDictIndex([{ headword: "Holy Spirit" }, { headword: "grace" }, { headword: "Eucharist" }]);

  it("preserves the original text exactly and marks the phrase", () => {
    const segs = segmentText("We trust the Holy Spirit today", index);
    expect(segs).toEqual([
      { text: "We trust the " },
      { text: "Holy Spirit", headword: "holy spirit" },
      { text: " today" },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("We trust the Holy Spirit today");
  });

  it("keeps surrounding punctuation OUTSIDE the highlighted span", () => {
    const segs = segmentText("The (Eucharist).", index);
    expect(segs).toEqual([{ text: "The (" }, { text: "Eucharist", headword: "eucharist" }, { text: ")." }]);
  });

  it("highlights only the first occurrence of a headword", () => {
    const segs = segmentText("grace and more grace", index);
    expect(segs.filter((s) => s.headword)).toEqual([{ text: "grace", headword: "grace" }]);
    expect(segs.map((s) => s.text).join("")).toBe("grace and more grace");
  });

  it("dedupes across calls when a `seen` set is shared", () => {
    const seen = new Set<string>();
    segmentText("grace abounds", index, seen);
    const second = segmentText("grace again", index, seen);
    expect(second.some((s) => s.headword)).toBe(false); // already seen in the first chunk
  });

  it("leaves text with no terms untouched (single plain segment)", () => {
    expect(segmentText("nothing to see here", index)).toEqual([{ text: "nothing to see here" }]);
  });
});

describe("highlightHtml", () => {
  const index = buildDictIndex([{ headword: "Holy Spirit" }, { headword: "grace" }]);

  it("wraps terms inside text but never touches tags/attributes", () => {
    const out = highlightHtml('<p class="x">The Holy Spirit gives grace.</p>', index);
    expect(out).toBe(
      '<p class="x">The <span class="dict-term" role="button" tabindex="0" data-dict-term="holy spirit">Holy Spirit</span> gives <span class="dict-term" role="button" tabindex="0" data-dict-term="grace">grace</span>.</p>',
    );
  });

  it("does not match a phrase split across a tag boundary", () => {
    const out = highlightHtml("<p>Holy <em>Spirit</em></p>", index);
    expect(out).not.toContain("dict-term"); // "Holy" and "Spirit" are in separate runs
  });

  it("escapes the headword in the data attribute (headwords are lowercased by the index)", () => {
    const quirky = buildDictIndex([{ headword: 'A"B' }]);
    expect(highlightHtml("<p>x</p>", quirky)).toBe("<p>x</p>"); // no match, sanity
    const out = highlightHtml('<p>A"B here</p>', quirky);
    expect(out).toContain('data-dict-term="a&quot;b"');
  });
});

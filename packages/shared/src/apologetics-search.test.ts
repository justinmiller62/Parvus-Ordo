import { describe, expect, it } from "vitest";
import { apologeticsCitationText, foldForSearch, matchesApologeticsQuery, type ApologeticsSearchable } from "./index";

// A topic in the corpus's real typographic style (smart quotes, en-dash verse ranges).
const john6: ApologeticsSearchable = {
  label: "John 6",
  objection: "“The Eucharist is only a symbol.”",
  reply: "The crowd took him literally and he doubled down instead of correcting them.",
  lead: null,
  ask: "If he meant it as a symbol, why did he let them walk away?",
  citations: [
    {
      ref: "John 6:53–54",
      sourceKind: null,
      altRef: "DR 6:54–55",
      quote: "except you eat the flesh of the Son of man and drink his blood, you shall not have life in you",
      why: null,
    },
    {
      ref: "St. Ignatius of Antioch, To the Smyrnaeans 7",
      sourceKind: "Father · c. 107",
      altRef: null,
      quote: "They abstain from the Eucharist because they do not confess that it is the flesh of our Saviour.",
      why: "Written while people who had heard the apostles were still alive.",
    },
  ],
};

const wholeChapter: ApologeticsSearchable = {
  label: "Who's in heaven",
  objection: "“The Church shouldn’t decide who’s in heaven.”",
  reply: "Canonization recognizes what God has already done.",
  lead: null,
  ask: null,
  citations: [
    { ref: "Hebrews 11", sourceKind: null, altRef: null, quote: null, why: "Scripture's own list of faith heroes." },
  ],
};

describe("foldForSearch", () => {
  it("folds smart quotes, dashes, and NBSP to ASCII", () => {
    expect(foldForSearch("“don’t”")).toBe('"don\'t"');
    expect(foldForSearch("6:53–54")).toBe("6:53-54");
    expect(foldForSearch("a b")).toBe("a b");
  });

  it("lowercases and collapses whitespace", () => {
    expect(foldForSearch("  John   6:53  ")).toBe("john 6:53");
  });
});

describe("matchesApologeticsQuery", () => {
  it("matches everything on an empty or whitespace query", () => {
    expect(matchesApologeticsQuery(john6, "")).toBe(true);
    expect(matchesApologeticsQuery(john6, "   ")).toBe(true);
  });

  it("finds a topic by a word in its quoted scripture", () => {
    expect(matchesApologeticsQuery(john6, "flesh")).toBe(true);
  });

  it("finds a topic by verse reference, typed with an ASCII hyphen", () => {
    expect(matchesApologeticsQuery(john6, "6:53-54")).toBe(true);
  });

  it("finds a topic by its Douay-Rheims alternate numbering", () => {
    expect(matchesApologeticsQuery(john6, "DR 6:54")).toBe(true);
  });

  it("finds a topic by the source badge (a Father's era)", () => {
    expect(matchesApologeticsQuery(john6, "father")).toBe(true);
  });

  it("finds a topic by words in the objection, typed with a straight apostrophe", () => {
    expect(matchesApologeticsQuery(wholeChapter, "shouldn't decide")).toBe(true);
  });

  it("ANDs the terms — every term must appear somewhere in the topic", () => {
    expect(matchesApologeticsQuery(john6, "eucharist ignatius")).toBe(true);
    expect(matchesApologeticsQuery(john6, "eucharist relics")).toBe(false);
  });

  it("searches the ask prompt and the citation gloss", () => {
    expect(matchesApologeticsQuery(john6, "walk away")).toBe(true);
    expect(matchesApologeticsQuery(john6, "apostles")).toBe(true);
  });

  it("does not match an unrelated query", () => {
    expect(matchesApologeticsQuery(john6, "rosary")).toBe(false);
  });
});

describe("apologeticsCitationText", () => {
  it("renders ref + alternate numbering + quote", () => {
    expect(apologeticsCitationText(john6.citations[0]!)).toBe(
      "John 6:53–54 (DR 6:54–55) — except you eat the flesh of the Son of man and drink his blood, you shall not have life in you",
    );
  });

  it("omits the parenthetical when there is no alternate numbering", () => {
    expect(apologeticsCitationText(john6.citations[1]!)).toBe(
      "St. Ignatius of Antioch, To the Smyrnaeans 7 — They abstain from the Eucharist because they do not confess that it is the flesh of our Saviour.",
    );
  });

  it("falls back to the gloss for a whole-chapter pointer with no quote", () => {
    expect(apologeticsCitationText(wholeChapter.citations[0]!)).toBe(
      "Hebrews 11 — Scripture's own list of faith heroes.",
    );
  });
});

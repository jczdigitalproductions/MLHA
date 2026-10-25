import test from "node:test";
import assert from "node:assert/strict";
import {
  extractHtml,
  parseCritique,
  parseRunOptions,
  SF_SCENARIOS,
} from "../scripts/argon-3d-loop.mjs";

test("extractHtml returns the contents of a fenced HTML response", () => {
  assert.equal(extractHtml("```html\n<!doctype html><p>scene</p>\n```"), "<!doctype html><p>scene</p>");
});

test("extractHtml rejects missing or empty HTML output", () => {
  assert.throws(() => extractHtml("No HTML returned"), /did not contain/);
  assert.throws(() => extractHtml("```html\n  \n```"), /non-empty/);
});

test("parseCritique validates and returns a well-formed critique", () => {
  const expected = {
    passed: false,
    score: 72,
    visualBugs: ["00:02 - Ramp mesh clips."],
    physicsFixes: ["Reduce ramp angle."],
  };
  assert.deepEqual(parseCritique(`Result:\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``), expected);
});

test("parseCritique rejects invalid JSON and out-of-range scores", () => {
  assert.throws(() => parseCritique("```json\n{invalid}\n```"), /invalid JSON/);
  assert.throws(
    () => parseCritique('{"passed":true,"score":101,"visualBugs":[],"physicsFixes":[]}'),
    /required schema/
  );
});

test("parseRunOptions defaults to the Mission ramp with two verified iterations", () => {
  assert.deepEqual(parseRunOptions([]), { scenarioKey: "mission_ramp", maxIterations: 2 });
});

test("parseRunOptions accepts known scenarios and bounded iteration options", () => {
  assert.deepEqual(parseRunOptions(["soma_mattress", "--iterations", "4"]), {
    scenarioKey: "soma_mattress",
    maxIterations: 4,
  });
  assert.equal(Object.keys(SF_SCENARIOS).length, 3);
});

test("parseRunOptions rejects unknown scenarios and malformed iteration options", () => {
  assert.throws(() => parseRunOptions(["unknown"]), /Unknown scenario/);
  assert.throws(() => parseRunOptions(["mission_ramp", "--iterations", "0"]), /between 1 and 4/);
  assert.throws(() => parseRunOptions(["mission_ramp", "4"]), /Usage:/);
});

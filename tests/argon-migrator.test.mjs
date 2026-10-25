import test from "node:test";
import assert from "node:assert/strict";
import { parseCandidateFiles } from "../scripts/argon-1m-migrator.mjs";

test("parseCandidateFiles extracts complete candidate files", () => {
  const candidates = parseCandidateFiles(
    "=== FILE: src/example.ts ===\nexport const value = 1;\n=== END_FILE ==="
  );
  assert.deepEqual(candidates, [
    { relativePath: "src/example.ts", content: "export const value = 1;\n" },
  ]);
});

test("parseCandidateFiles rejects traversal, duplicate paths, and incomplete output", () => {
  assert.throws(
    () => parseCandidateFiles("=== FILE: ../outside.txt ===\nnope\n=== END_FILE ==="),
    /unsafe candidate path/
  );
  assert.throws(
    () =>
      parseCandidateFiles(
        "=== FILE: a.ts ===\none\n=== END_FILE ===\n=== FILE: a.ts ===\ntwo\n=== END_FILE ==="
      ),
    /duplicate candidate paths/
  );
  assert.throws(() => parseCandidateFiles("truncated response"), /no complete candidate files/);
});

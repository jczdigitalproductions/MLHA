import { GoogleGenAI } from "@google/genai";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MODEL_ID = "gemini-4-argon";
const DEFAULT_MAX_OUTPUT_TOKENS = 262144;
const IGNORED_DIRS = new Set([
  ".agents",
  ".git",
  ".next",
  ".vite",
  "artifacts",
  "coverage",
  "dist",
  "node_modules",
  "public",
]);
const SOURCE_EXTENSIONS = /\.(js|jsx|ts|tsx|json|css|md|html)$/i;

function getClient() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY is missing. Set it in the project .env file.");
  }
  return new GoogleGenAI({});
}

function getMaxOutputTokens() {
  const value = Number(process.env.ARGON_MAX_OUTPUT_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS);
  if (!Number.isInteger(value) || value <= 65536 || value > 1048576) {
    throw new Error("ARGON_MAX_OUTPUT_TOKENS must be an integer from 65537 to 1048576.");
  }
  return value;
}

export async function packRepository(rootDir) {
  const files = [];

  async function walkRecursively(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walkRecursively(path.join(dir, entry.name));
        }
      } else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) {
        const fullPath = path.join(dir, entry.name);
        const content = await fs.readFile(fullPath, "utf-8");
        files.push(`=== EXISTING_FILE: ${path.relative(rootDir, fullPath)} ===\n${content}`);
      }
    }
  }

  await walkRecursively(rootDir);
  return files.join("\n\n");
}

export function measureRepoMetrics(dir) {
  let fileCount = 0;
  let totalLoc = 0;
  let tsStrictFiles = 0;
  let testFiles = 0;

  function scan(current) {
    for (const item of fsSync.readdirSync(current, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (!IGNORED_DIRS.has(item.name)) scan(path.join(current, item.name));
        continue;
      }
      if (!item.isFile() || !/\.(js|jsx|ts|tsx|sql)$/i.test(item.name)) continue;

      const fullPath = path.join(current, item.name);
      const relativePath = path.relative(dir, fullPath);
      if (relativePath.startsWith(`artifacts${path.sep}`)) continue;
      const lines = fsSync.readFileSync(fullPath, "utf-8").split("\n").length;
      fileCount += 1;
      totalLoc += lines;
      if (/\.(ts|tsx)$/i.test(item.name)) tsStrictFiles += 1;
      if (/\.test\.(ts|tsx|js|jsx)$/i.test(item.name)) testFiles += 1;
    }
  }

  scan(dir);
  return { fileCount, totalLoc, tsStrictFiles, testFiles };
}

export function parseCandidateFiles(rawText) {
  const files = [];
  const fileRegex = /=== FILE:\s*([^\n=]+?)\s*===\s*\r?\n([\s\S]*?)=== END_FILE ===/g;
  let match;

  while ((match = fileRegex.exec(rawText)) !== null) {
    const relativePath = match[1].trim();
    if (
      !relativePath ||
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === ".." || part === "")
    ) {
      throw new Error(`Gemini returned an unsafe candidate path: "${relativePath}".`);
    }
    files.push({ relativePath, content: match[2] });
  }

  if (files.length === 0) {
    throw new Error("Gemini response contained no complete candidate files.");
  }
  if (new Set(files.map((file) => file.relativePath)).size !== files.length) {
    throw new Error("Gemini response contained duplicate candidate paths.");
  }
  return files;
}

function collectInteractionText(interaction) {
  return (interaction.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

async function runMillionTokenMigration() {
  const rootDir = process.cwd();
  const client = getClient();
  const maxOutputTokens = getMaxOutputTokens();
  const baselineMetrics = measureRepoMetrics(rootDir);
  console.log("[Baseline metrics]", baselineMetrics);

  const packedRepo = await packRepository(rootDir);
  if (!packedRepo) {
    throw new Error("No supported source or documentation files were found to migrate.");
  }

  const migrationPrompt = `
You are executing a carefully staged software engineering migration on the "SF Civic Lens" repository.
Propose a strongly-typed municipal dispatch and 3D twin platform by generating complete candidate files:
1. Improve frontend components with strict TypeScript and accessible controls.
2. Add Open311 API schemas and PostGIS migration candidates where appropriate.
3. Integrate the 2D incident report and the 3D self-healing simulation viewer.
4. Include tests for the code you generate.

Do not claim features are implemented unless you provide the files. Do not overwrite the current project directly; all output will be staged for review.
Emit each file using this exact delimiter format:
=== FILE: path/to/file.ext ===
<complete file code>
=== END_FILE ===
`;

  console.log(`[Gemini 4 Argon] Starting background migration (output cap: ${maxOutputTokens} tokens)...`);
  let interaction = await client.interactions.create({
    model: MODEL_ID,
    input: `${migrationPrompt}\n\nREPOSITORY SNAPSHOT:\n${packedRepo}`,
    background: true,
    generation_config: {
      max_output_tokens: maxOutputTokens,
      thinking_level: "high",
    },
  });

  while (interaction.status === "in_progress" || interaction.status === "queued") {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    interaction = await client.interactions.get({ id: interaction.id });
  }
  if (interaction.status !== "completed") {
    throw new Error(`Gemini migration ended with status "${interaction.status}".`);
  }

  const candidateFiles = parseCandidateFiles(collectInteractionText(interaction));
  const candidateRoot = path.resolve(rootDir, "artifacts/migration-candidate");
  for (const candidate of candidateFiles) {
    const targetPath = path.resolve(candidateRoot, candidate.relativePath);
    const relativeTarget = path.relative(candidateRoot, targetPath);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      throw new Error(`Candidate path escaped the staging directory: "${candidate.relativePath}".`);
    }
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, candidate.content, "utf-8");
    console.log(`  Staged: ${candidate.relativePath}`);
  }

  const postMetrics = measureRepoMetrics(rootDir);
  console.log("[Current repository metrics; staged candidates are not applied]", postMetrics);
  console.log(`Review ${candidateFiles.length} candidate files under artifacts/migration-candidate before applying any changes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMillionTokenMigration().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

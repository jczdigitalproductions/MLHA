import { GoogleGenAI } from "@google/genai";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MODEL_ID = "gemini-4-argon";

export const SF_SCENARIOS = {
  mission_ramp: {
    title: "Photo-referenced standing water at wheelchair curb access",
    goal: "Use attached img-2.png as the visual reference: wheelchair user seen from behind, reddish sidewalk, yellow tactile warning panel, large reflective puddle along the curb to the right, green public bin, metal fence and dense vegetation to the left, road and cars to the right. Treat standing water as a no-go region; do not invent rubble or barricades. Create a physics-driven wheelchair demonstration avoiding the puddle via a clearly labeled proposed temporary bypass. Preserve the automated goal x > 4.0m, y > 0.25m, tilt < 8 degrees within 6 seconds. These are synthetic test coordinates. Explicitly label dimensions, slope, and water depth as illustrative assumptions, not measurements from the photo; do not claim ADA certification.",
  },
  folsom_pothole: {
    title: "Deep Pothole on 5th & Folsom",
    goal: "Create a Three.js + Cannon-es physics simulation of 5th & Folsom with a 0.35m deep pothole in the bike/vehicle lane, steel road-plate remediation mesh, and a 4-wheeled autonomous delivery cart traversing at 5m/s. Vertical suspension impulse must stay under 1.5G and the cart must reach z > 10m smoothly.",
  },
  soma_mattress: {
    title: "Dumped Mattress Blocking SOMA Bike Lane",
    goal: "Create a Three.js + Cannon-es 3D street scene in SOMA with an illegally dumped mattress obstructing the protected green bike lane, automated traffic cone detour placement, and a cyclist physics agent navigating around the obstruction safely without colliding with curb bollards or street traffic.",
  },
};

const SYSTEM_PROMPT_3D_GENERATOR = `
You are an expert WebGL, Three.js, and Cannon-es physics simulation engineer powered by Gemini 4 Argon.
Output a SINGLE, self-contained HTML5 file (including CDN imports for Three.js and cannon-es) that renders a 3D urban simulation at 1280x720.

CRITICAL TELEMETRY REQUIREMENTS FOR AUTOMATED VERIFICATION:
1. Expose \`window.simState = { frame: 0, agentPos: {x:0, y:0, z:0}, maxTiltDeg: 0, collisions: 0, goalReached: false, errorLog: [] }\`.
2. Render a visible HUD overlay in the top-left corner showing live coordinates, slope angle, collision count, and elapsed time.
3. Return ONLY valid HTML inside a \`\`\`html ... \`\`\` codeblock.
`;

const POLL_INTERVAL_MS = 5000;
const VIDEO_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ITERATIONS = 4;

function getClient() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY is missing. Set it in the project .env file.");
  }
  return new GoogleGenAI({});
}

function getInteractionText(interaction) {
  if (typeof interaction.output_text === "string" && interaction.output_text.length > 0) {
    return interaction.output_text;
  }

  return (interaction.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

export function extractHtml(rawText) {
  const match = rawText?.match(/```html\s*([\s\S]*?)```/i);
  if (!match?.[1]?.trim()) {
    throw new Error("Gemini response did not contain a non-empty ```html code block.");
  }
  return match[1].trim();
}

export function parseCritique(rawText) {
  const fencedJson = rawText.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const jsonText = fencedJson ?? rawText.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) {
    throw new Error("Gemini critique did not contain a JSON object.");
  }

  let critique;
  try {
    critique = JSON.parse(jsonText);
  } catch (error) {
    throw new Error("Gemini critique contained invalid JSON.", { cause: error });
  }

  if (
    typeof critique.passed !== "boolean" ||
    typeof critique.score !== "number" ||
    !Number.isFinite(critique.score) ||
    critique.score < 0 ||
    critique.score > 100 ||
    !Array.isArray(critique.visualBugs) ||
    !critique.visualBugs.every((item) => typeof item === "string") ||
    !Array.isArray(critique.physicsFixes) ||
    !critique.physicsFixes.every((item) => typeof item === "string")
  ) {
    throw new Error("Gemini critique JSON did not match the required schema.");
  }

  return critique;
}

export function parseRunOptions(args) {
  const scenarioKey = args[0] ?? "mission_ramp";
  if (!Object.hasOwn(SF_SCENARIOS, scenarioKey)) {
    throw new Error(`Unknown scenario "${scenarioKey}". Choose one of: ${Object.keys(SF_SCENARIOS).join(", ")}.`);
  }

  let maxIterations = 2;
  if (args.length > 1) {
    if (args[1] !== "--iterations" || !/^\d+$/.test(args[2] ?? "")) {
      throw new Error("Usage: npm run simulate -- [scenario] [--iterations 1-4]");
    }
    maxIterations = Number(args[2]);
  }
  if (maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    throw new Error(`Iteration count must be between 1 and ${MAX_ITERATIONS}.`);
  }

  return { scenarioKey, maxIterations };
}

async function createTextInteraction(input, { maxOutputTokens = 65536, longDecode = false } = {}) {
  const client = getClient();
  let interaction = await client.interactions.create({
    model: MODEL_ID,
    input,
    ...(longDecode ? { background: true } : {}),
    generation_config: {
      thinking_level: "high",
      max_output_tokens: maxOutputTokens,
    },
  });

  if (longDecode) {
    while (interaction.status === "in_progress" || interaction.status === "queued") {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      interaction = await client.interactions.get({ id: interaction.id });
    }
  }

  if (interaction.status !== "completed") {
    throw new Error(`Gemini interaction ended with status "${interaction.status}".`);
  }

  const text = getInteractionText(interaction);
  if (!text) {
    throw new Error("Gemini interaction completed without a text response.");
  }
  return text;
}

async function getReferenceImage(scenarioKey) {
  if (scenarioKey !== "mission_ramp") return [];
  const bytes = await fs.readFile(path.resolve("img-2.png"));
  return [{ type: "image", data: bytes.toString("base64"), mime_type: "image/png" }];
}

async function generateInitial3DScene(scenarioKey) {
  const scenario = SF_SCENARIOS[scenarioKey];
  console.log(`\n[Pass 1] Generating 3D simulation for: ${scenario.title}...`);

  const response = await createTextInteraction([
    ...await getReferenceImage(scenarioKey),
    { type: "text", text: `${SYSTEM_PROMPT_3D_GENERATOR}\n\nSCENARIO: ${scenario.title}\nGOAL: ${scenario.goal}` },
  ]);
  return extractHtml(response);
}

async function renderAndRecordVideo(htmlPath, iteration, scenarioKey) {
  const videoDir = path.resolve("artifacts/videos");
  await fs.mkdir(videoDir, { recursive: true });

  console.log(`[Iteration ${iteration}] Recording an 8-second browser rollout...`);
  const browser = await chromium.launch({ headless: true });
  let context;
  let video;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, {
      waitUntil: "load",
      timeout: 60_000,
    });
    video = page.video();

    const runtime = await page.evaluate(async () => {
      const start = performance.now();
      let frames = 0;
      await new Promise((resolve) => {
        const countFrame = () => {
          frames += 1;
          if (performance.now() - start >= 8000) {
            resolve();
          } else {
            requestAnimationFrame(countFrame);
          }
        };
        requestAnimationFrame(countFrame);
      });

      return {
        simState: window.simState ?? null,
        measuredFps: Math.round((frames / ((performance.now() - start) / 1000)) * 10) / 10,
      };
    });
    const telemetry = { ...runtime.simState, measuredFps: runtime.measuredFps, consoleErrors };

    await context.close();
    context = undefined;

    const sourceVideoPath = await video.path();
    const finalVideoPath = path.join(videoDir, `${scenarioKey}_rollout_iter_${iteration}.webm`);
    await fs.rename(sourceVideoPath, finalVideoPath);

    console.log(`[Iteration ${iteration}] Browser-measured FPS: ${telemetry.measuredFps}`);
    console.log(`[Iteration ${iteration}] Telemetry: ${JSON.stringify(telemetry)}`);
    return { videoPath: finalVideoPath, telemetry };
  } finally {
    if (context) await context.close();
    await browser.close();
  }
}

async function waitForVideoProcessing(client, uploadedFile) {
  if (!uploadedFile.name || !uploadedFile.uri) {
    throw new Error("Gemini Files API did not return a video name and URI.");
  }

  const deadline = Date.now() + VIDEO_PROCESSING_TIMEOUT_MS;
  let file = uploadedFile;
  while (file.state !== "ACTIVE") {
    if (file.state === "FAILED") {
      throw new Error(`Gemini video processing failed for ${uploadedFile.name}.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Gemini to process ${uploadedFile.name}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    file = await client.files.get({ name: uploadedFile.name });
  }
  return file;
}

async function critiqueAndFixScene(scenarioKey, currentHtml, videoPath, telemetry, iteration) {
  const scenario = SF_SCENARIOS[scenarioKey];
  const client = getClient();
  console.log(`[Iteration ${iteration}] Uploading rollout video to Gemini for multimodal critique...`);

  const uploadedFile = await client.files.upload({
    file: videoPath,
    config: { mimeType: "video/webm" },
  });
  if (!uploadedFile.name) {
    throw new Error("Gemini Files API did not return an uploaded file name.");
  }

  try {
    const videoFile = await waitForVideoProcessing(client, uploadedFile);
    const criticPrompt = `
You are a multimodal 3D physics and spatial QA critic powered by Gemini 4 Argon.
Inspect the attached browser recording, the runtime telemetry, and the current source.

SCENARIO GOAL: ${scenario.goal}
RUNTIME TELEMETRY: ${JSON.stringify(telemetry, null, 2)}

Return a JSON code block with exactly these keys:
- "passed": boolean; true only when the goal is reached, there are no visible clipping/flicker bugs, and physics remain within the stated safety bounds.
- "score": integer from 0 to 100.
- "visualBugs": array of timestamped observations.
- "physicsFixes": array of concrete changes (empty if no fixes are needed).
If passed is false, follow the JSON block with the COMPLETE corrected HTML in a \`\`\`html code block.
If passed is true, do not return another HTML block.
`;

    const response = await createTextInteraction(
      [
        ...await getReferenceImage(scenarioKey),
        {
          type: "video",
          uri: videoFile.uri,
          mime_type: videoFile.mimeType ?? "video/webm",
        },
        { type: "text", text: criticPrompt },
        { type: "text", text: `CURRENT SOURCE CODE:\n\`\`\`html\n${currentHtml}\n\`\`\`` },
      ],
      { maxOutputTokens: 131072, longDecode: true }
    );

    const critique = parseCritique(response);
    const updatedHtml = critique.passed ? currentHtml : extractHtml(response);
    return { critique, updatedHtml };
  } finally {
    await client.files.delete({ name: uploadedFile.name });
  }
}

export async function runSelfHealingLoop(scenarioKey = "mission_ramp", maxIterations = 2) {
  if (!Object.hasOwn(SF_SCENARIOS, scenarioKey)) {
    throw new Error(`Unknown scenario "${scenarioKey}". Choose one of: ${Object.keys(SF_SCENARIOS).join(", ")}.`);
  }
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    throw new Error(`Iteration count must be an integer between 1 and ${MAX_ITERATIONS}.`);
  }

  const outputDir = path.resolve("public/simulations");
  await fs.mkdir(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, `${scenarioKey}.html`);
  const reportPath = path.join(outputDir, `${scenarioKey}_audit.json`);
  const reportLog = [];

  let currentHtml = await generateInitial3DScene(scenarioKey);
  await fs.writeFile(htmlPath, currentHtml, "utf-8");

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const { videoPath, telemetry } = await renderAndRecordVideo(htmlPath, iteration, scenarioKey);
    const { critique, updatedHtml } = await critiqueAndFixScene(
      scenarioKey,
      currentHtml,
      videoPath,
      telemetry,
      iteration
    );

    reportLog.push({
      iteration,
      telemetry,
      critique,
      videoPath: path.relative(process.cwd(), videoPath),
    });
    console.log(`[Iteration ${iteration}] Score: ${critique.score}/100 | Passed: ${critique.passed}`);
    console.log("[Visual observations]", critique.visualBugs);

    if (critique.passed && critique.score >= 90) {
      console.log(`[Success] Scene passed the rubric on iteration ${iteration}.`);
      break;
    }

    if (iteration < maxIterations && updatedHtml !== currentHtml) {
      currentHtml = updatedHtml;
      await fs.writeFile(htmlPath, currentHtml, "utf-8");
    } else if (iteration === maxIterations) {
      console.log("The final critique's proposed patch was not applied because it has not been re-tested.");
    }
  }

  await fs.writeFile(reportPath, JSON.stringify(reportLog, null, 2), "utf-8");
  console.log(`Simulation: ${path.relative(process.cwd(), htmlPath)}`);
  console.log(`Audit: ${path.relative(process.cwd(), reportPath)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { scenarioKey, maxIterations } = parseRunOptions(process.argv.slice(2));
    await runSelfHealingLoop(scenarioKey, maxIterations);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

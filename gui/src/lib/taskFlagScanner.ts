import type { TaskState } from "../state/taskStore";
import { detectFlags, type FlagHit } from "./flagDetector";
import type { FlagSettings } from "./flagSettingsPreference";

export const MAX_FLAG_SCAN_TAIL_CHARS = 8192;
export const MAX_TASK_FLAG_HITS = 256;

type FlagDetector = (
  text: string,
  prefixes: readonly string[],
  caseSensitive: boolean,
) => FlagHit[];

interface RunScanCache {
  received: number;
  retainedLength: number;
  tail: string;
  hits: FlagHit[];
}

interface TaskScanCache {
  signature: string;
  runs: Map<string, RunScanCache>;
  findingCount: number;
  structuredHits: FlagHit[];
  parameterOutput: string;
  parameterHits: FlagHit[];
}

function hitKey(hit: FlagHit) {
  return JSON.stringify([hit.text, hit.source, hit.encoded ?? null]);
}

function uniqueHits(hits: FlagHit[]) {
  const seen = new Set<string>();
  const unique: FlagHit[] = [];
  for (let index = hits.length - 1; index >= 0 && unique.length < MAX_TASK_FLAG_HITS; index -= 1) {
    const hit = hits[index];
    const key = hitKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique.reverse();
}

function scannerSignature(settings: FlagSettings, prefixes: readonly string[]) {
  return JSON.stringify([
    settings.enabled,
    settings.scanOutput,
    settings.scanStructured,
    settings.caseSensitive,
    prefixes,
  ]);
}

export class TaskFlagScanner {
  private readonly tasks = new Map<string, TaskScanCache>();

  constructor(private readonly detector: FlagDetector = detectFlags) {}

  scan(taskKey: string, task: TaskState, settings: FlagSettings, prefixes: readonly string[]) {
    const signature = scannerSignature(settings, prefixes);
    let cache = this.tasks.get(taskKey);
    if (!cache || cache.signature !== signature) {
      cache = {
        signature,
        runs: new Map(),
        findingCount: 0,
        structuredHits: [],
        parameterOutput: "",
        parameterHits: [],
      };
      this.tasks.set(taskKey, cache);
    }

    if (!settings.enabled) return [];

    if (settings.scanOutput) this.scanRuns(cache, task, prefixes, settings.caseSensitive);
    else cache.runs.clear();
    if (settings.scanStructured) this.scanFindings(cache, task, prefixes, settings.caseSensitive);
    else {
      cache.findingCount = 0;
      cache.structuredHits = [];
    }
    this.scanParameterOutput(cache, task, prefixes, settings.caseSensitive);

    const hits = uniqueHits([
      ...Array.from(cache.runs.values()).flatMap((run) => run.hits),
      ...cache.structuredHits,
      ...cache.parameterHits,
    ]);
    return settings.scanBase64 ? hits : hits.filter((hit) => hit.source !== "base64");
  }

  private scanRuns(
    cache: TaskScanCache,
    task: TaskState,
    prefixes: readonly string[],
    caseSensitive: boolean,
  ) {
    const currentIds = new Set(task.runs.map((run) => run.id));
    for (const cachedId of cache.runs.keys()) {
      if (!currentIds.has(cachedId)) cache.runs.delete(cachedId);
    }

    for (const run of task.runs) {
      const received = run.outputCharsReceived ?? run.output.length;
      const previous = cache.runs.get(run.id);
      if (!previous || received < previous.received) {
        cache.runs.set(run.id, this.scanWholeOutput(run.output, received, prefixes, caseSensitive));
        continue;
      }
      const appendedLength = received - previous.received;
      if (appendedLength === 0) {
        if (run.output.length !== previous.retainedLength) {
          cache.runs.set(run.id, this.scanWholeOutput(run.output, received, prefixes, caseSensitive));
        }
        continue;
      }
      if (appendedLength > run.output.length) {
        cache.runs.set(run.id, this.scanWholeOutput(run.output, received, prefixes, caseSensitive));
        continue;
      }
      const appended = run.output.slice(-appendedLength);
      const scanText = previous.tail + appended;
      cache.runs.set(run.id, {
        received,
        retainedLength: run.output.length,
        tail: scanText.slice(-MAX_FLAG_SCAN_TAIL_CHARS),
        hits: uniqueHits([
          ...previous.hits,
          ...this.detector(scanText, prefixes, caseSensitive),
        ]),
      });
    }
  }

  private scanWholeOutput(
    output: string,
    received: number,
    prefixes: readonly string[],
    caseSensitive: boolean,
  ): RunScanCache {
    return {
      received,
      retainedLength: output.length,
      tail: output.slice(-MAX_FLAG_SCAN_TAIL_CHARS),
      hits: this.detector(output, prefixes, caseSensitive),
    };
  }

  private scanFindings(
    cache: TaskScanCache,
    task: TaskState,
    prefixes: readonly string[],
    caseSensitive: boolean,
  ) {
    if (task.findings.length < cache.findingCount) {
      cache.findingCount = 0;
      cache.structuredHits = [];
    }
    const additions = task.findings.slice(cache.findingCount);
    for (const finding of additions) {
      cache.structuredHits = uniqueHits([
        ...cache.structuredHits,
        ...this.detector(finding.value, prefixes, caseSensitive),
      ]);
    }
    cache.findingCount = task.findings.length;
  }

  private scanParameterOutput(
    cache: TaskScanCache,
    task: TaskState,
    prefixes: readonly string[],
    caseSensitive: boolean,
  ) {
    const output = String(task.parameters.output ?? "");
    if (output === cache.parameterOutput) return;
    cache.parameterOutput = output;
    cache.parameterHits = this.detector(output, prefixes, caseSensitive);
  }
}

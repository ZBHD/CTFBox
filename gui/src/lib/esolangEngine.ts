// Esolang 引擎：Brainfuck/Ook 解释器与识别
export interface EsolangMatch {
  type: "brainfuck" | "ook" | "whitespace";
  confidence: "high" | "candidate";
}

export function identifyEsolang(text: string): EsolangMatch[] {
  const matches: EsolangMatch[] = [];
  if (!text.trim()) return matches;

  const nonWs = text.replace(/\s/g, "");
  if (!nonWs) return matches;

  // Brainfuck detection: 8 specific characters
  const bfChars = nonWs.replace(/[><+\-.,[\]]/g, "");
  const bfRatio = 1 - bfChars.length / nonWs.length;
  if (bfRatio > 0.7 && nonWs.length >= 4) {
    matches.push({ type: "brainfuck", confidence: bfRatio > 0.9 ? "high" : "candidate" });
  }

  // Ook detection: keyword "Ook" present
  if (/Ook[.?!]/.test(text)) {
    matches.push({ type: "ook", confidence: "high" });
  }

  // Whitespace detection: only spaces, tabs, newlines
  if (/^[ \t\n\r]+$/.test(text) && text.length > 4) {
    matches.push({ type: "whitespace", confidence: "candidate" });
  }

  return matches;
}

export function executeBrainfuck(code: string, _input = "", maxSteps = 100_000): string {
  // Strip non-BF characters
  const program = code.replace(/[^><+\-.,[\]]/g, "");
  if (!program) return "";

  const tape = new Uint8Array(30_000);
  let ptr = 0;
  let pc = 0;
  const output: number[] = [];
  const jumpMap = buildJumpMap(program);
  let steps = 0;

  while (pc < program.length && steps < maxSteps) {
    steps += 1;
    const cmd = program[pc];
    switch (cmd) {
      case ">": ptr += 1; if (ptr >= tape.length) ptr = 0; break;
      case "<": ptr -= 1; if (ptr < 0) ptr = tape.length - 1; break;
      case "+": tape[ptr] += 1; break;
      case "-": tape[ptr] -= 1; break;
      case ".": output.push(tape[ptr]); break;
      case ",": break; // input not implemented
      case "[": if (tape[ptr] === 0) pc = jumpMap[pc]; break;
      case "]": if (tape[ptr] !== 0) pc = jumpMap[pc]; break;
    }
    pc += 1;
  }

  if (steps >= maxSteps && output.length === 0) {
    throw new Error("Brainfuck 执行超过最大指令数");
  }

  return String.fromCharCode(...output);
}

function buildJumpMap(program: string): Record<number, number> {
  const map: Record<number, number> = {};
  const stack: number[] = [];
  for (let i = 0; i < program.length; i += 1) {
    if (program[i] === "[") stack.push(i);
    else if (program[i] === "]") {
      const open = stack.pop();
      if (open !== undefined) {
        map[open] = i;
        map[i] = open;
      }
    }
  }
  return map;
}

const OOK_TO_BF: Record<string, string> = {
  "Ook. Ook.": ">",
  "Ook? Ook.": "<",
  "Ook. Ook?": "+",
  "Ook! Ook!": "-",
  "Ook! Ook.": ".",
  "Ook. Ook!": ",",
  "Ook! Ook?": "[",
  "Ook? Ook!": "]",
};

export function decodeOok(code: string): string {
  const tokens = code.match(/Ook[.?!] Ook[.?!]/g);
  if (!tokens) return "";
  return tokens.map((t) => OOK_TO_BF[t] ?? "").join("");
}

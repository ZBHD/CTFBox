// @ts-expect-error vitest runs in Node
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error vitest runs in Node
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCrypto } from "./cryptaPipeline";
import { DEFAULT_CRYPTA_OPTIONS } from "./cryptaTypes";
import { commonModulusAttack, fermatFactor, parseRsaPem } from "./cryptaRsa";

const corpus = "D:\\Projects\\CTFBox\\artifacts\\test-corpus\\cryptanalysis";
const corpusIt = existsSync(corpus) ? it : it.skip;

describe("密码分析 — 真实题型验证", () => {
  corpusIt("RSA 01: 共模攻击恢复明文", () => {
    const input = readFileSync(join(corpus, "rsa/challenge-01-common-modulus.txt"), "utf-8");
    const params = parseRsaPem(input);
    expect(params).not.toBeNull();
    const lines = input.split("\n").map((l: string) => l.split(":")[1]).filter(Boolean).map(Number);
    const [n, e1, c1, e2, c2] = lines.map(BigInt);
    const result = commonModulusAttack(n, e1, c1, e2, c2);
    expect(result.recovered).toBe(true);
    expect(result.plaintext).toBe(42n);
  });

  corpusIt("RSA 02: Fermat 分解", () => {
    const input = readFileSync(join(corpus, "rsa/challenge-02-fermat.txt"), "utf-8");
    const params = parseRsaPem(input);
    expect(params).not.toBeNull();
    const result = fermatFactor(params!.n);
    expect(result.recovered).toBe(true);
    expect(result.factors).toBeDefined();
    if (result.factors) expect(result.factors[0] * result.factors[1]).toBe(params!.n);
  });

  corpusIt("Hash 01: MD5 彩虹表命中", async () => {
    const input = readFileSync(join(corpus, "hash/challenge-01-md5.txt"), "utf-8").trim();
    const report = await analyzeCrypto(input, ["flag"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.plaintextCandidates).toContain("hello");
  });

  corpusIt("Hash 02: SHA-256 识别", async () => {
    const input = readFileSync(join(corpus, "hash/challenge-02-sha256.txt"), "utf-8").trim();
    const report = await analyzeCrypto(input, ["flag"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.inputType).toBe("hash");
  });

  corpusIt("Classical 01: Caesar 自动破解", async () => {
    const input = readFileSync(join(corpus, "classical/challenge-01-caesar.txt"), "utf-8");
    const report = await analyzeCrypto(input, ["FLAG"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.plaintextCandidates.some((c) => c.includes("FLAG"))).toBe(true);
  });

  corpusIt("Classical 02: Atbash 自动破解", async () => {
    const input = readFileSync(join(corpus, "classical/challenge-02-atbash.txt"), "utf-8");
    const report = await analyzeCrypto(input, ["FLAG"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.plaintextCandidates.some((c) => c.includes("FLAG"))).toBe(true);
  });

  corpusIt("PRNG 01: 数字序列识别", async () => {
    const input = readFileSync(join(corpus, "prng/challenge-01-lcg.txt"), "utf-8");
    const report = await analyzeCrypto(input, ["flag"], false, DEFAULT_CRYPTA_OPTIONS, new AbortController().signal);
    expect(report.inputType).toBe("numbers");
  });
});

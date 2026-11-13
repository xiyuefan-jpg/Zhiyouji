/**
 * Run bot seasons from the command line:
 *   npm run sim -- [seeds=20] [firstSeed=1]
 * Prints one season in detail and a summary over all seeds.
 */

import { simulateSeason, summary } from "./season.js";

const seeds = Number(process.argv[2] ?? 20);
const first = Number(process.argv[3] ?? 1);

const counts = new Map<string, number>();
let problems = 0;
const t0 = Date.now();
for (let seed = first; seed < first + seeds; seed++) {
  const r = simulateSeason({ seed });
  for (const x of r.refusals) counts.set(`${x.type}:${x.refusal}`, (counts.get(`${x.type}:${x.refusal}`) ?? 0) + 1);
  problems += r.ledgerProblems.length;
  if (seed === first) {
    console.log(`赛季 seed=${seed}`);
    console.table(summary(r));
    console.log("统计", r.stats);
  }
}
console.log(`${seeds} 个赛季，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；账本问题 ${problems} 个`);
console.log("被拒绝的操作（机器人乱试的，正常会有一些）：");
console.table([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ 操作: k, 次数: n })));

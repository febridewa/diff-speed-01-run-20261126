# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/febridewa/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/febridewa/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's makefun-diff 1.0.0, built for the [make.fun "Diff two texts faster" bounty](https://make.fun/bounty/diff-speed-01-run-20261126). It returns exactly makefun-diff's patch for every pair of texts, and does it in about a third of the CPU time on the practice set (~2.9x faster than the house baseline). Referral: `6etrfz79`.

## How it is faster

The reference spends its time allocating one path object (with a linked list of components) per cell of Myers's greedy search — millions of allocations for a 30,000-line case. This entry instead:

- interns every distinct line to a small integer once, so the search compares integers instead of strings;
- runs Myers's greedy search over typed arrays with no allocation in the hot loop, storing one integer per cell (the furthest old position reached on that diagonal);
- rebuilds the edit script afterwards by walking those rows backwards, re-deriving each move with makefun-diff's own rule: the deletion wins when a deletion and an insertion reach the same point, no edge diagonal is pruned, and no move passes either text's end.

The patch itself is built from the same rule the reference states: common prefix, then common suffix, Myers between them, hunks of up to 3 kept lines around each change run, runs at most 6 kept lines apart sharing a hunk. The entry was checked byte-for-byte against makefun-diff on the practice set, on 675 fuzz cases, and on 200 cases drawn by the kit's own generator at fresh seeds.

## Run it

The harness runs `node /bot/main.ts` (Node 22+), reading cases from `/input/cases.json` and writing `/output/answers.json`. Outside the container the two directories are overridable:

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=6etrfz79&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>

import { useEffect, useMemo, useRef, useState } from "react";

type Position = { row: number; col: number };
type Turn = "player" | "enemy";

type RoundConfig = {
  roundNumber: number;
  difficulty: number;
  rows: number;
  cols: number;
  exit: Position;
  obstacles: Position[];
  playerStart: Position;
  enemyStart: Position;
  keys: Position[];
  background: string;
  musicTheme: number;
};

type AudioState = {
  ctx: AudioContext;
  masterGain: GainNode;
  musicGain: GainNode;
  sfxGain: GainNode;
  musicTimer: number | null;
};

const MIN_PLAYER_EXIT_DISTANCE = 3;
const MIN_KEY_EXIT_DISTANCE = 2;

type DifficultyProfile = {
  rows: [number, number];
  cols: [number, number];
  obstacles: [number, number];
  keys: [number, number];
  minSteps: number;
  maxSteps: number;
};

const DIFFICULTY_PROFILES: DifficultyProfile[] = [
  { rows: [6, 6], cols: [6, 6], obstacles: [2, 4], keys: [1, 1], minSteps: 6, maxSteps: 16 },
  { rows: [6, 7], cols: [6, 7], obstacles: [4, 6], keys: [1, 2], minSteps: 10, maxSteps: 22 },
  { rows: [7, 8], cols: [7, 8], obstacles: [6, 9], keys: [2, 3], minSteps: 14, maxSteps: 30 },
  { rows: [7, 8], cols: [7, 8], obstacles: [8, 11], keys: [2, 3], minSteps: 18, maxSteps: 36 },
  { rows: [8, 9], cols: [8, 9], obstacles: [10, 14], keys: [3, 4], minSteps: 22, maxSteps: 44 },
];

const getDifficultyProfile = (difficulty: number) => DIFFICULTY_PROFILES[Math.max(1, Math.min(5, difficulty)) - 1];

const BACKGROUNDS = [
  "linear-gradient(135deg, #0f172a 0%, #0b1024 40%, #022c22 100%)",
  "linear-gradient(135deg, #1f2937 0%, #0f172a 38%, #312e81 100%)",
  "linear-gradient(135deg, #111827 0%, #1e1b4b 42%, #3f1d2e 100%)",
  "linear-gradient(135deg, #111827 0%, #1e293b 44%, #7c2d12 100%)",
  "linear-gradient(135deg, #020617 0%, #1f2937 40%, #581c87 100%)",
];

const MUSIC_THEMES: number[][] = [
  [261.63, 329.63, 392.0, 523.25, 392.0, 329.63],
  [220.0, 277.18, 329.63, 440.0, 329.63, 277.18],
  [196.0, 246.94, 311.13, 392.0, 311.13, 246.94],
  [174.61, 233.08, 293.66, 369.99, 293.66, 233.08],
  [164.81, 220.0, 277.18, 349.23, 277.18, 220.0],
];

const SKELETON_MUSIC_THEMES: number[][] = [
  [220.0, 246.94, 261.63, 246.94, 220.0, 196.0],
  [207.65, 233.08, 246.94, 233.08, 207.65, 185.0],
  [196.0, 220.0, 233.08, 220.0, 196.0, 174.61],
  [185.0, 207.65, 220.0, 207.65, 185.0, 164.81],
  [174.61, 196.0, 207.65, 196.0, 174.61, 155.56],
];

type SpriteKey =
  | "redSkeleton"
  | "greenKnight"
  | "key"
  | "portalClosed"
  | "portalOpen"
  | "wallCross"
  | "wallHorizontal"
  | "wallVertical";

const SPRITE_PATH_CANDIDATES: Record<SpriteKey, string[]> = {
  redSkeleton: ["/sprites/red-skeleton.png", "./assets/red-skeleton.png", "/assets/red-skeleton.png", "./assets/red.png", "/assets/red.png"],
  greenKnight: ["/sprites/green-knight.png", "./assets/green-knight.png", "/assets/green-knight.png", "./assets/green.png", "/assets/green.png"],
  key: ["/sprites/key.png", "./assets/key.png", "/assets/key.png"],
  portalClosed: ["/sprites/portal-closed.png", "./assets/gate_closed.png", "/assets/gate_closed.png", "./assets/portal-closed.png", "/assets/portal-closed.png"],
  portalOpen: ["/sprites/portal-open.png", "./assets/gate_open.png", "/assets/gate_open.png", "./assets/portal-open.png", "/assets/portal-open.png"],
  wallCross: ["/sprites/wall-cross.png", "./assets/wall-cross.png", "/assets/wall-cross.png", "./assets/wall.png", "/assets/wall.png"],
  wallHorizontal: ["/sprites/wall-horizontal.png", "./assets/wall-horizontal.png", "/assets/wall-horizontal.png", "./assets/wall.png", "/assets/wall.png"],
  wallVertical: ["/sprites/wall-vertical.png", "./assets/wall-vertical.png", "/assets/wall-vertical.png", "./assets/wall.png", "/assets/wall.png"],
};

const EMPTY_SPRITES: Record<SpriteKey, string | null> = {
  redSkeleton: null,
  greenKnight: null,
  key: null,
  portalClosed: null,
  portalOpen: null,
  wallCross: null,
  wallHorizontal: null,
  wallVertical: null,
};

const preloadSprite = (sprite: SpriteKey, candidates: string[]) =>
  new Promise<string | null>((resolve) => {
    let index = 0;

    const attempt = () => {
      if (index >= candidates.length) {
        console.error(`[assets] No working asset found for ${sprite}. Checked: ${candidates.join(", ")}`);
        resolve(null);
        return;
      }

      const src = candidates[index];
      index += 1;
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => {
        console.error(`[assets] Failed to load ${sprite} from: ${src}`);
        attempt();
      };
      img.src = src;
    };

    attempt();
  });

const formatProceedingCountdown = (countdown: number) => {
  return `Proceeding in (${countdown})`;
};

const formatCongratulationsCountdown = (countdown: number) => {
  return `Congratulations! Let's move on to the next round (${countdown})`;
};

const DIRECTIONS: Record<string, { dr: number; dc: number; label: string }> = {
  ArrowUp: { dr: -1, dc: 0, label: "Up" },
  ArrowDown: { dr: 1, dc: 0, label: "Down" },
  ArrowLeft: { dr: 0, dc: -1, label: "Left" },
  ArrowRight: { dr: 0, dc: 1, label: "Right" },
  w: { dr: -1, dc: 0, label: "Up" },
  s: { dr: 1, dc: 0, label: "Down" },
  a: { dr: 0, dc: -1, label: "Left" },
  d: { dr: 0, dc: 1, label: "Right" },
};

const STEP_MOVES = [
  { dr: -1, dc: 0, label: "Up" },
  { dr: 1, dc: 0, label: "Down" },
  { dr: 0, dc: -1, label: "Left" },
  { dr: 0, dc: 1, label: "Right" },
];

const GREEN_STEPS_PER_TURN = 1;
const RED_STEPS_PER_TURN = 2;

const keyFor = (p: Position) => `${p.row},${p.col}`;

const samePos = (a: Position, b: Position) => a.row === b.row && a.col === b.col;

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const neighbors = (p: Position, rows: number, cols: number) => {
  const all = [
    { row: p.row - 1, col: p.col },
    { row: p.row + 1, col: p.col },
    { row: p.row, col: p.col - 1 },
    { row: p.row, col: p.col + 1 },
  ];
  return all.filter((n) => n.row >= 0 && n.row < rows && n.col >= 0 && n.col < cols);
};

const shortestPath = (
  start: Position,
  target: Position,
  rows: number,
  cols: number,
  blocked: Set<string>,
) => {
  if (samePos(start, target)) return [start];

  const queue: Position[] = [start];
  const visited = new Set([keyFor(start)]);
  const parent = new Map<string, string>();

  while (queue.length) {
    const current = queue.shift()!;
    const currentKey = keyFor(current);

    for (const next of neighbors(current, rows, cols)) {
      const nextKey = keyFor(next);
      if (blocked.has(nextKey) || visited.has(nextKey)) continue;
      visited.add(nextKey);
      parent.set(nextKey, currentKey);
      if (samePos(next, target)) {
        const path = [target];
        let trace = currentKey;
        while (trace !== keyFor(start)) {
          const [r, c] = trace.split(",").map(Number);
          path.push({ row: r, col: c });
          trace = parent.get(trace)!;
        }
        path.push(start);
        return path.reverse();
      }
      queue.push(next);
    }
  }

  return null;
};

const pathTurnCount = (path: Position[]) => {
  if (path.length < 3) return 0;
  let turns = 0;
  let prevDr = path[1].row - path[0].row;
  let prevDc = path[1].col - path[0].col;

  for (let i = 2; i < path.length; i += 1) {
    const dr = path[i].row - path[i - 1].row;
    const dc = path[i].col - path[i - 1].col;
    if (dr !== prevDr || dc !== prevDc) {
      turns += 1;
      prevDr = dr;
      prevDc = dc;
    }
  }

  return turns;
};

const isGateRouteBlockedByObstacle = (
  start: Position,
  exit: Position,
  rows: number,
  cols: number,
  blocked: Set<string>,
) => {
  const routeWithObstacles = shortestPath(start, exit, rows, cols, blocked);
  if (!routeWithObstacles) return false;

  const routeWithoutObstacles = shortestPath(start, exit, rows, cols, new Set<string>());
  if (!routeWithoutObstacles) return false;

  const turnsWithObstacles = pathTurnCount(routeWithObstacles);
  const turnsWithoutObstacles = pathTurnCount(routeWithoutObstacles);

  // Player must not have a fully straight gate approach.
  if (turnsWithObstacles === 0) return false;

  // Obstacles should force a less direct gate route.
  if (samePos(start, exit)) return false;
  if (start.row === exit.row || start.col === exit.col) {
    return routeWithObstacles.length > routeWithoutObstacles.length;
  }

  return routeWithObstacles.length > routeWithoutObstacles.length || turnsWithObstacles > turnsWithoutObstacles;
};

const hasFreeNeighbor = (pos: Position, rows: number, cols: number, blocked: Set<string>) => {
  return neighbors(pos, rows, cols).some((n) => !blocked.has(keyFor(n)));
};

const keysRespectGateDistance = (keys: Position[], exit: Position, minDistance: number) => {
  return keys.every((k) => Math.abs(k.row - exit.row) + Math.abs(k.col - exit.col) >= minDistance);
};

const samePositionSet = (a: Position[], b: Position[]) => {
  if (a.length !== b.length) return false;
  const aSet = new Set(a.map(keyFor));
  return b.every((p) => aSet.has(keyFor(p)));
};

const differentMainComponentPositions = (prev: RoundConfig, next: RoundConfig) => {
  const gateChanged = !samePos(prev.exit, next.exit);
  const playerChanged = !samePos(prev.playerStart, next.playerStart);
  const enemyChanged = !samePos(prev.enemyStart, next.enemyStart);
  const keysChanged = !samePositionSet(prev.keys, next.keys);
  const obstaclesChanged = !samePositionSet(prev.obstacles, next.obstacles);
  return gateChanged && playerChanged && enemyChanged && keysChanged && obstaclesChanged;
};

const isCoreWinnableLayout = (candidate: RoundConfig, previousRound?: RoundConfig) => {
  const blocked = new Set(candidate.obstacles.map(keyFor));
  const enemyDistance =
    Math.abs(candidate.enemyStart.row - candidate.playerStart.row) +
    Math.abs(candidate.enemyStart.col - candidate.playerStart.col);
  const playerExitDistance =
    Math.abs(candidate.playerStart.row - candidate.exit.row) + Math.abs(candidate.playerStart.col - candidate.exit.col);

  if (enemyDistance < 2 || playerExitDistance < MIN_PLAYER_EXIT_DISTANCE) return false;
  if (!keysRespectGateDistance(candidate.keys, candidate.exit, MIN_KEY_EXIT_DISTANCE)) return false;
  if (!hasFreeNeighbor(candidate.playerStart, candidate.rows, candidate.cols, blocked)) return false;
  if (!hasFreeNeighbor(candidate.enemyStart, candidate.rows, candidate.cols, blocked)) return false;
  if (!shortestPath(candidate.enemyStart, candidate.playerStart, candidate.rows, candidate.cols, blocked)) return false;
  if (!isGateRouteBlockedByObstacle(candidate.playerStart, candidate.exit, candidate.rows, candidate.cols, blocked)) return false;
  if (
    !canSolveRound({
      rows: candidate.rows,
      cols: candidate.cols,
      start: candidate.playerStart,
      exit: candidate.exit,
      keys: candidate.keys,
      blocked,
    })
  ) {
    return false;
  }
  if (
    !canWinAgainstEnemy({
      rows: candidate.rows,
      cols: candidate.cols,
      playerStart: candidate.playerStart,
      enemyStart: candidate.enemyStart,
      exit: candidate.exit,
      keys: candidate.keys,
      blocked,
    })
  ) {
    return false;
  }
  if (previousRound && !differentMainComponentPositions(previousRound, candidate)) return false;
  return true;
};

const isValidRoundLayout = (candidate: RoundConfig, previousRound?: RoundConfig) => {
  const blocked = new Set(candidate.obstacles.map(keyFor));
  const profile = getDifficultyProfile(candidate.difficulty);

  if (candidate.keys.length < profile.keys[0] || candidate.keys.length > profile.keys[1]) return false;
  if (candidate.obstacles.length < profile.obstacles[0] || candidate.obstacles.length > profile.obstacles[1]) return false;
  if (!isCoreWinnableLayout(candidate, previousRound)) return false;

  const minSteps = getMinimumPlayerStepsToWin({
    rows: candidate.rows,
    cols: candidate.cols,
    start: candidate.playerStart,
    exit: candidate.exit,
    keys: candidate.keys,
    blocked,
  });
  if (minSteps === null || minSteps < profile.minSteps || minSteps > profile.maxSteps) return false;

  return true;
};

const canSolveRound = (config: {
  rows: number;
  cols: number;
  start: Position;
  exit: Position;
  keys: Position[];
  blocked: Set<string>;
}) => {
  const { rows, cols, start, exit, keys, blocked } = config;
  const keyToIndex = new Map<string, number>();
  keys.forEach((k, i) => keyToIndex.set(keyFor(k), i));

  const totalMask = (1 << keys.length) - 1;
  const initialMask = keyToIndex.has(keyFor(start)) ? 1 << keyToIndex.get(keyFor(start))! : 0;

  const queue: Array<{ pos: Position; mask: number }> = [{ pos: start, mask: initialMask }];
  const visited = new Set([`${keyFor(start)}|${initialMask}`]);

  while (queue.length) {
    const current = queue.shift()!;
    if (samePos(current.pos, exit) && current.mask === totalMask) return true;

    for (const next of neighbors(current.pos, rows, cols)) {
      const nextKey = keyFor(next);
      if (blocked.has(nextKey)) continue;

      let nextMask = current.mask;
      const idx = keyToIndex.get(nextKey);
      if (idx !== undefined) nextMask |= 1 << idx;

      const stateKey = `${nextKey}|${nextMask}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push({ pos: next, mask: nextMask });
    }
  }

  return false;
};

const getMinimumPlayerStepsToWin = (config: {
  rows: number;
  cols: number;
  start: Position;
  exit: Position;
  keys: Position[];
  blocked: Set<string>;
}) => {
  const { rows, cols, start, exit, keys, blocked } = config;
  const keyToIndex = new Map<string, number>();
  keys.forEach((k, i) => keyToIndex.set(keyFor(k), i));

  const totalMask = (1 << keys.length) - 1;
  const initialMask = keyToIndex.has(keyFor(start)) ? 1 << keyToIndex.get(keyFor(start))! : 0;
  const queue: Array<{ pos: Position; mask: number; steps: number }> = [{ pos: start, mask: initialMask, steps: 0 }];
  const visited = new Set([`${keyFor(start)}|${initialMask}`]);

  while (queue.length) {
    const current = queue.shift()!;
    if (samePos(current.pos, exit) && current.mask === totalMask) return current.steps;

    for (const next of neighbors(current.pos, rows, cols)) {
      const nextKey = keyFor(next);
      if (blocked.has(nextKey)) continue;

      let nextMask = current.mask;
      const idx = keyToIndex.get(nextKey);
      if (idx !== undefined) nextMask |= 1 << idx;

      const stateKey = `${nextKey}|${nextMask}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      queue.push({ pos: next, mask: nextMask, steps: current.steps + 1 });
    }
  }

  return null;
};

const canWinAgainstEnemy = (config: {
  rows: number;
  cols: number;
  playerStart: Position;
  enemyStart: Position;
  exit: Position;
  keys: Position[];
  blocked: Set<string>;
}) => {
  const { rows, cols, playerStart, enemyStart, exit, keys, blocked } = config;
  const keyToIndex = new Map<string, number>();
  keys.forEach((k, i) => keyToIndex.set(keyFor(k), i));

  const totalMask = (1 << keys.length) - 1;
  const initialMask = keyToIndex.has(keyFor(playerStart)) ? 1 << keyToIndex.get(keyFor(playerStart))! : 0;
  const queue: Array<{ player: Position; enemy: Position; mask: number }> = [
    { player: playerStart, enemy: enemyStart, mask: initialMask },
  ];
  const visited = new Set([`${keyFor(playerStart)}|${keyFor(enemyStart)}|${initialMask}`]);

  while (queue.length) {
    const state = queue.shift()!;

    for (const move of STEP_MOVES) {
      const nextPlayer = { row: state.player.row + move.dr, col: state.player.col + move.dc };
      if (nextPlayer.row < 0 || nextPlayer.row >= rows || nextPlayer.col < 0 || nextPlayer.col >= cols) continue;
      if (blocked.has(keyFor(nextPlayer))) continue;
      if (samePos(nextPlayer, state.enemy)) continue;

      let nextMask = state.mask;
      const keyIdx = keyToIndex.get(keyFor(nextPlayer));
      if (keyIdx !== undefined) nextMask |= 1 << keyIdx;

      if (samePos(nextPlayer, exit) && nextMask === totalMask) {
        return true;
      }

      let nextEnemy = state.enemy;
      let captured = false;

      for (let step = 0; step < 2; step += 1) {
        const path = shortestPath(nextEnemy, nextPlayer, rows, cols, blocked);
        if (!path || path.length < 2) break;
        nextEnemy = path[1];
        if (samePos(nextEnemy, nextPlayer)) {
          captured = true;
          break;
        }
      }

      if (captured) continue;

      const nextStateKey = `${keyFor(nextPlayer)}|${keyFor(nextEnemy)}|${nextMask}`;
      if (visited.has(nextStateKey)) continue;
      visited.add(nextStateKey);
      queue.push({ player: nextPlayer, enemy: nextEnemy, mask: nextMask });
    }
  }

  return false;
};

const createSafeFallbackRound = (roundNumber: number, previousRound?: RoundConfig): RoundConfig => {
  const difficulty = Math.min(5, roundNumber);
  const profile = getDifficultyProfile(difficulty);

  const corners = (rows: number, cols: number) => [
    { row: 0, col: 0 },
    { row: 0, col: cols - 1 },
    { row: rows - 1, col: 0 },
    { row: rows - 1, col: cols - 1 },
  ];

  for (let attempt = 0; attempt < 240; attempt += 1) {
    const rows = randomInt(profile.rows[0], profile.rows[1]);
    const cols = randomInt(profile.cols[0], profile.cols[1]);
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = randomInt(profile.obstacles[0], profile.obstacles[1]);
    const keyCount = randomInt(profile.keys[0], profile.keys[1]);

    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys: Position[] = [];
    for (let i = 0; i < keyCount; i += 1) {
      keys.push(pickAndRemove(pool));
    }

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (isValidRoundLayout(candidateRound, previousRound)) return candidateRound;
  }

  // Final attempt uses the same difficulty profile with minimum key/obstacle counts.
  const emergencyProfile = profile;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const rows = emergencyProfile.rows[0];
    const cols = emergencyProfile.cols[0];
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = emergencyProfile.obstacles[0];
    const keyCount = emergencyProfile.keys[0];
    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys = [pickAndRemove(pool)];

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (isValidRoundLayout(candidateRound, previousRound)) return candidateRound;
  }

  // Last-resort relaxed fallback: still guarantees solvable and escapable layouts.
  for (let attempt = 0; attempt < 420; attempt += 1) {
    const rows = randomInt(profile.rows[0], profile.rows[1]);
    const cols = randomInt(profile.cols[0], profile.cols[1]);
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = Math.max(2, profile.obstacles[0] - 2);
    const keyCount = Math.max(1, profile.keys[0]);
    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys: Position[] = [];
    for (let i = 0; i < keyCount; i += 1) {
      keys.push(pickAndRemove(pool));
    }

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    const playerExitDistance =
      Math.abs(candidateRound.playerStart.row - candidateRound.exit.row) +
      Math.abs(candidateRound.playerStart.col - candidateRound.exit.col);
    if (playerExitDistance < MIN_PLAYER_EXIT_DISTANCE) continue;
    if (!keysRespectGateDistance(candidateRound.keys, candidateRound.exit, MIN_KEY_EXIT_DISTANCE)) continue;
    if (!hasFreeNeighbor(candidateRound.playerStart, candidateRound.rows, candidateRound.cols, blocked)) continue;
    if (!hasFreeNeighbor(candidateRound.enemyStart, candidateRound.rows, candidateRound.cols, blocked)) continue;
    if (!shortestPath(candidateRound.enemyStart, candidateRound.playerStart, candidateRound.rows, candidateRound.cols, blocked)) {
      continue;
    }
    if (
      !canSolveRound({
        rows: candidateRound.rows,
        cols: candidateRound.cols,
        start: candidateRound.playerStart,
        exit: candidateRound.exit,
        keys: candidateRound.keys,
        blocked,
      })
    ) {
      continue;
    }
    if (
      !canWinAgainstEnemy({
        rows: candidateRound.rows,
        cols: candidateRound.cols,
        playerStart: candidateRound.playerStart,
        enemyStart: candidateRound.enemyStart,
        exit: candidateRound.exit,
        keys: candidateRound.keys,
        blocked,
      })
    ) {
      continue;
    }
    if (previousRound && !differentMainComponentPositions(previousRound, candidateRound)) continue;

    return candidateRound;
  }

  // Final validated fallback: still random and still guaranteed solvable/escapable.
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const rows = 6;
    const cols = 6;
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = randomInt(2, 3);
    const keyCount = 1;
    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys = [pickAndRemove(pool)];

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (isValidRoundLayout(candidateRound, previousRound)) return candidateRound;
  }

  // Emergency fallback: no hardcoded patterns. Keep randomizing until a winnable layout appears.
  for (let attempt = 0; attempt < 9000; attempt += 1) {
    const rows = Math.max(6, profile.rows[0]);
    const cols = Math.max(6, profile.cols[0]);
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = Math.max(1, Math.min(5, profile.obstacles[0]));
    const keyCount = Math.max(1, Math.min(2, profile.keys[0]));
    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys: Position[] = [];
    for (let i = 0; i < keyCount; i += 1) {
      keys.push(pickAndRemove(pool));
    }

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (isCoreWinnableLayout(candidateRound, previousRound)) return candidateRound;
  }

  // If cross-round difference is too restrictive, still return only a guaranteed winnable round.
  for (let attempt = 0; attempt < 12000; attempt += 1) {
    const rows = 6;
    const cols = 6;
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < 2 && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < 3) continue;

    const pool = [...freeCells];
    const pickAndRemove = (list: Position[]) => list.splice(randomInt(0, list.length - 1), 1)[0];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys = [pickAndRemove(pool)];

    const candidateRound: RoundConfig = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (isCoreWinnableLayout(candidateRound)) return candidateRound;
  }

  throw new Error("Unable to generate a winnable round.");
};

const generateRound = (roundNumber: number, previousRound?: RoundConfig): RoundConfig => {
  const difficulty = Math.min(5, roundNumber);
  const settings = getDifficultyProfile(difficulty);

  const corners = (rows: number, cols: number) => [
    { row: 0, col: 0 },
    { row: 0, col: cols - 1 },
    { row: rows - 1, col: 0 },
    { row: rows - 1, col: cols - 1 },
  ];

  for (let attempt = 0; attempt < 260; attempt += 1) {
    const rows = randomInt(settings.rows[0], settings.rows[1]);
    const cols = randomInt(settings.cols[0], settings.cols[1]);
    const allCells: Position[] = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        allCells.push({ row, col });
      }
    }

    const exit = corners(rows, cols)[randomInt(0, 3)];
    const obstacleCount = randomInt(settings.obstacles[0], settings.obstacles[1]);
    const keyCount = randomInt(settings.keys[0], settings.keys[1]);

    const obstacleCandidates = allCells.filter((p) => !samePos(p, exit));
    const obstacles: Position[] = [];
    const blocked = new Set<string>();

    while (obstacles.length < obstacleCount && obstacleCandidates.length) {
      const idx = randomInt(0, obstacleCandidates.length - 1);
      const picked = obstacleCandidates.splice(idx, 1)[0];
      obstacles.push(picked);
      blocked.add(keyFor(picked));
    }

    const freeCells = allCells.filter((p) => !blocked.has(keyFor(p)) && !samePos(p, exit));
    if (freeCells.length < keyCount + 2) continue;

    const pickAndRemove = (list: Position[]) => {
      const idx = randomInt(0, list.length - 1);
      return list.splice(idx, 1)[0];
    };

    const pool = [...freeCells];
    const playerStart = pickAndRemove(pool);
    const enemyStart = pickAndRemove(pool);
    const keys: Position[] = [];

    for (let i = 0; i < keyCount; i += 1) {
      keys.push(pickAndRemove(pool));
    }

    const enemyDistance = Math.abs(enemyStart.row - playerStart.row) + Math.abs(enemyStart.col - playerStart.col);
    const playerExitDistance = Math.abs(playerStart.row - exit.row) + Math.abs(playerStart.col - exit.col);
    if (enemyDistance < 2) continue;
    if (playerExitDistance < MIN_PLAYER_EXIT_DISTANCE) continue;
    if (!keysRespectGateDistance(keys, exit, MIN_KEY_EXIT_DISTANCE)) continue;

    // Prevent fully trapping either starting unit by obstacles.
    if (!hasFreeNeighbor(playerStart, rows, cols, blocked)) continue;
    if (!hasFreeNeighbor(enemyStart, rows, cols, blocked)) continue;
    if (!shortestPath(enemyStart, playerStart, rows, cols, blocked)) continue;
    if (!isGateRouteBlockedByObstacle(playerStart, exit, rows, cols, blocked)) continue;

    if (
      !canSolveRound({
        rows,
        cols,
        start: playerStart,
        exit,
        keys,
        blocked,
      })
    ) {
      continue;
    }

    if (
      !canWinAgainstEnemy({
        rows,
        cols,
        playerStart,
        enemyStart,
        exit,
        keys,
        blocked,
      })
    ) {
      continue;
    }

    const candidateRound = {
      roundNumber,
      difficulty,
      rows,
      cols,
      exit,
      obstacles,
      playerStart,
      enemyStart,
      keys,
      background: BACKGROUNDS[randomInt(0, BACKGROUNDS.length - 1)],
      musicTheme: randomInt(0, MUSIC_THEMES.length - 1),
    };

    if (previousRound && !differentMainComponentPositions(previousRound, candidateRound)) {
      continue;
    }

    return candidateRound;
  }

  return createSafeFallbackRound(roundNumber, previousRound);
};

export default function App() {
  const [round, setRound] = useState<RoundConfig>(() => generateRound(1));
  const [playerPos, setPlayerPos] = useState<Position>(round.playerStart);
  const [enemyPos, setEnemyPos] = useState<Position>(round.enemyStart);
  const [remainingKeys, setRemainingKeys] = useState<Position[]>(round.keys);
  const [turn, setTurn] = useState<Turn>("player");
  const [gameOver, setGameOver] = useState(false);
  const [won, setWon] = useState(false);
  const [winCountdownValue, setWinCountdownValue] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [eventPrompt, setEventPrompt] = useState("Player turn.");
  const [showInstructions, setShowInstructions] = useState(false);
  const [volume, setVolume] = useState(45);
  const [isMuted, setIsMuted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [controlledColor, setControlledColor] = useState<"green" | "red">("green");
  const [resolvedSprites, setResolvedSprites] = useState<Record<SpriteKey, string | null>>(EMPTY_SPRITES);
  const [mobileControlsOnLeft, setMobileControlsOnLeft] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 720 : window.innerHeight,
  }));

  const audioRef = useRef<AudioState | null>(null);
  const moveCounterRef = useRef(0);
  const turnLockRef = useRef(false);
  const winCountdownTimerRef = useRef<number | null>(null);
  const prepareRoundTimerRef = useRef<number | null>(null);
  const controlledRedStepTimersRef = useRef<number[]>([]);
  const roundTimerTokenRef = useRef(0);
  const pendingRoundRef = useRef<RoundConfig | null>(null);
  const lastGreenAutoFirstStepRef = useRef<Position | null>(null);
  const forceDifferentGreenFirstStepRef = useRef(false);
  const boardBlocked = useMemo(() => new Set(round.obstacles.map(keyFor)), [round.obstacles]);
  const totalKeys = round.keys.length;
  const capturedKeys = totalKeys - remainingKeys.length;
  const gateOpen = remainingKeys.length === 0;
  const playerAtClosedGate = samePos(playerPos, round.exit) && !gateOpen;

  const isDesktopLayout = viewport.width >= 1024;
  const boardFooterHeight = isDesktopLayout ? 24 : 92;
  const mobileHeaderReserve = 350;
  const boardMaxWidth = isDesktopLayout
    ? Math.max(180, viewport.width - 320 - 44)
    : Math.max(180, viewport.width - 22);
  const boardMaxHeight = isDesktopLayout
    ? Math.max(180, viewport.height - boardFooterHeight - 44)
    : Math.max(180, viewport.height - mobileHeaderReserve - boardFooterHeight);
  const boardMaxSize = Math.max(180, Math.min(560, boardMaxWidth, boardMaxHeight));
  const cellSize = Math.max(22, Math.floor(boardMaxSize / Math.max(round.rows, round.cols)));
  const activePrompt = eventPrompt;

  const consumePreparedNextRound = (currentRound: RoundConfig) => {
    const preparedRound = pendingRoundRef.current;
    pendingRoundRef.current = null;
    if (preparedRound && preparedRound.roundNumber === currentRound.roundNumber + 1) {
      return preparedRound;
    }
    return generateRound(currentRound.roundNumber + 1, currentRound);
  };

  const clearWinCountdown = () => {
    if (winCountdownTimerRef.current) {
      window.clearInterval(winCountdownTimerRef.current);
      winCountdownTimerRef.current = null;
    }
    setWinCountdownValue(null);
  };

  const clearControlledRedStepTimers = () => {
    if (controlledRedStepTimersRef.current.length === 0) return;
    controlledRedStepTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    controlledRedStepTimersRef.current = [];
  };

  const schedulePrepareNextRound = (baseRound: RoundConfig, timerToken: number) => {
    if (prepareRoundTimerRef.current) {
      window.clearTimeout(prepareRoundTimerRef.current);
      prepareRoundTimerRef.current = null;
    }

    // Defer heavy round generation so move/turn interactions do not freeze on mobile.
    prepareRoundTimerRef.current = window.setTimeout(() => {
      if (timerToken !== roundTimerTokenRef.current) return;
      pendingRoundRef.current = generateRound(baseRound.roundNumber + 1, baseRound);
    }, 0);
  };

  const ensureAudio = () => {
    if (!audioRef.current) {
      const ctx = new AudioContext();
      const masterGain = ctx.createGain();
      const musicGain = ctx.createGain();
      const sfxGain = ctx.createGain();
      masterGain.gain.value = 0.6;
      musicGain.gain.value = volume / 100;
      sfxGain.gain.value = Math.max(0.15, volume / 180);
      musicGain.connect(masterGain);
      sfxGain.connect(masterGain);
      masterGain.connect(ctx.destination);
      audioRef.current = { ctx, masterGain, musicGain, sfxGain, musicTimer: null };
    }

    if (audioRef.current.ctx.state === "suspended") {
      void audioRef.current.ctx.resume();
    }
    setAudioReady(true);
  };

  const playTone = (frequency: number, duration: number, type: OscillatorType, gain: GainNode) => {
    const audio = audioRef.current;
    if (!audio) return;
    const osc = audio.ctx.createOscillator();
    const toneGain = audio.ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    toneGain.gain.setValueAtTime(0, audio.ctx.currentTime);
    toneGain.gain.linearRampToValueAtTime(0.25, audio.ctx.currentTime + 0.02);
    toneGain.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + duration);
    osc.connect(toneGain);
    toneGain.connect(gain);
    osc.start();
    osc.stop(audio.ctx.currentTime + duration);
  };

  const startRoundMusic = (themeIndex: number, controlMode: "green" | "red") => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.musicTimer) {
      window.clearInterval(audio.musicTimer);
    }

    const palette = controlMode === "red" ? SKELETON_MUSIC_THEMES : MUSIC_THEMES;
    const melody = palette[themeIndex % palette.length];
    let pointer = 0;

    audio.musicTimer = window.setInterval(() => {
      const freq = melody[pointer % melody.length];
      const toneType: OscillatorType = controlMode === "red" ? (pointer % 2 === 0 ? "sine" : "triangle") : pointer % 2 === 0 ? "triangle" : "sine";
      playTone(freq, controlMode === "red" ? 0.42 : 0.35, toneType, audio.musicGain);
      pointer += 1;
    }, controlMode === "red" ? 420 : 360);
  };

  const playKeySfx = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playTone(740, 0.18, "square", audio.sfxGain);
    window.setTimeout(() => playTone(980, 0.22, "triangle", audio.sfxGain), 70);
  };

  const playGameOverSfx = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playTone(180, 0.45, "sawtooth", audio.sfxGain);
    window.setTimeout(() => playTone(120, 0.6, "sawtooth", audio.sfxGain), 120);
  };

  const playWinSfx = () => {
    const audio = audioRef.current;
    if (!audio) return;
    playTone(523.25, 0.2, "triangle", audio.sfxGain);
    window.setTimeout(() => playTone(659.25, 0.22, "triangle", audio.sfxGain), 120);
    window.setTimeout(() => playTone(783.99, 0.26, "triangle", audio.sfxGain), 260);
    window.setTimeout(() => playTone(1046.5, 0.36, "sine", audio.sfxGain), 430);
  };

  const applyRoundState = (nextRound: RoundConfig) => {
    clearControlledRedStepTimers();
    setRound(nextRound);
    setPlayerPos(nextRound.playerStart);
    setEnemyPos(nextRound.enemyStart);
    setRemainingKeys(nextRound.keys);
    setTurn("player");
    setGameOver(false);
    setWon(false);
    setEventPrompt("Player turn.");
    moveCounterRef.current = 0;
    turnLockRef.current = false;
    setLogs([`Round ${nextRound.roundNumber} loaded. Player starts.`]);
    lastGreenAutoFirstStepRef.current = null;
    forceDifferentGreenFirstStepRef.current = false;
    pendingRoundRef.current = null;
    schedulePrepareNextRound(nextRound, roundTimerTokenRef.current);
  };

  const goToNextRound = () => {
    roundTimerTokenRef.current += 1;
    clearWinCountdown();
    clearControlledRedStepTimers();
    if (prepareRoundTimerRef.current) {
      window.clearTimeout(prepareRoundTimerRef.current);
      prepareRoundTimerRef.current = null;
    }
    setWon(false);
    setRound((currentRound) => {
      const nextRound = consumePreparedNextRound(currentRound);
      // Apply all major component positions in the same update cycle.
      setPlayerPos(nextRound.playerStart);
      setEnemyPos(nextRound.enemyStart);
      setRemainingKeys(nextRound.keys);
      setTurn("player");
      setGameOver(false);
      setEventPrompt("Player turn.");
      moveCounterRef.current = 0;
      turnLockRef.current = false;
      setLogs([`Round ${nextRound.roundNumber} loaded. Player starts.`]);
      lastGreenAutoFirstStepRef.current = null;
      forceDifferentGreenFirstStepRef.current = false;
      schedulePrepareNextRound(nextRound, roundTimerTokenRef.current);
      return nextRound;
    });
  };

  useEffect(() => {
    const onFirstGesture = () => ensureAudio();
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const preloadAssets = async () => {
      const spriteKeys = Object.keys(SPRITE_PATH_CANDIDATES) as SpriteKey[];
      const loadedPairs = await Promise.all(
        spriteKeys.map(async (sprite) => [sprite, await preloadSprite(sprite, SPRITE_PATH_CANDIDATES[sprite])] as const),
      );

      if (cancelled) return;
      const loaded = Object.fromEntries(loadedPairs) as Record<SpriteKey, string | null>;
      setResolvedSprites(loaded);
    };

    void preloadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;
    const activeVolume = isMuted ? 0 : volume;
    audioRef.current.musicGain.gain.value = activeVolume / 100;
    audioRef.current.sfxGain.gain.value = activeVolume === 0 ? 0 : Math.max(0.12, activeVolume / 180);
  }, [volume, isMuted]);

  useEffect(() => {
    if (audioReady) {
      startRoundMusic(round.musicTheme, controlledColor);
    }
  }, [round.musicTheme, audioReady, controlledColor]);

  useEffect(() => {
    return () => {
      clearWinCountdown();
      clearControlledRedStepTimers();
      if (audioRef.current?.musicTimer) {
        window.clearInterval(audioRef.current.musicTimer);
      }
      if (prepareRoundTimerRef.current) {
        window.clearTimeout(prepareRoundTimerRef.current);
      }
      void audioRef.current?.ctx.close();
    };
  }, []);

  const resetRound = (targetRound: RoundConfig, modeOverride?: "green" | "red") => {
    const activeMode = modeOverride ?? controlledColor;
    roundTimerTokenRef.current += 1;
    clearWinCountdown();
    clearControlledRedStepTimers();
    if (prepareRoundTimerRef.current) {
      window.clearTimeout(prepareRoundTimerRef.current);
      prepareRoundTimerRef.current = null;
    }
    setPlayerPos(targetRound.playerStart);
    setEnemyPos(targetRound.enemyStart);
    setRemainingKeys(targetRound.keys);
    setTurn("player");
    setGameOver(false);
    setWon(false);
    pendingRoundRef.current = null;
    setEventPrompt("Player turn.");
    moveCounterRef.current = 0;
    turnLockRef.current = false;
    setLogs([`Round ${targetRound.roundNumber} loaded. Player starts.`]);
    forceDifferentGreenFirstStepRef.current = activeMode === "red";
    schedulePrepareNextRound(targetRound, roundTimerTokenRef.current);
  };

  useEffect(() => {
    // Initial preload for the first generated round.
    schedulePrepareNextRound(round, roundTimerTokenRef.current);
  }, []);

  const appendLog = (text: string) => {
    setLogs((current) => [text, ...current].slice(0, 12));
  };

  const appendMoveLog = (actor: "Player" | "Enemy", text: string) => {
    moveCounterRef.current += 1;
    appendLog(`T${moveCounterRef.current} ${actor}: ${text}`);
  };

  const startWinCountdown = (victoryMessage: string) => {
  const timerToken = roundTimerTokenRef.current;

  clearWinCountdown();
  setWon(true);
  playWinSfx();

  appendLog(victoryMessage);

  let countdown = 3;
  setWinCountdownValue(countdown);
  setEventPrompt(formatProceedingCountdown(countdown));

  winCountdownTimerRef.current = window.setInterval(() => {
    if (timerToken !== roundTimerTokenRef.current) {
      clearWinCountdown();
      return;
    }

    countdown--;

    if (countdown > 0) {
      setWinCountdownValue(countdown);
      setEventPrompt(formatProceedingCountdown(countdown));
      return;
    }

    clearWinCountdown();
    goToNextRound();
  }, 1000);
};

  const triggerRedCaptureOutcome = () => {
    if (controlledColor === "red") {
      setEventPrompt("Red captured green.");
      appendLog("Red captured green.");
      startWinCountdown();
      turnLockRef.current = false;
      return;
    }

    setGameOver(true);
    setEventPrompt("Game over. Enemy captured the player.");
    playGameOverSfx();
    appendLog("Enemy captured player.");
    turnLockRef.current = false;
  };

  const finishPlayerMove = (nextPos: Position, direction: string) => {
    appendMoveLog("Player", `${direction} to (${nextPos.row + 1}, ${nextPos.col + 1})`);

    if (samePos(nextPos, enemyPos)) {
      setGameOver(true);
      setEventPrompt("Game over. Enemy captured the player.");
      playGameOverSfx();
      appendLog("Enemy captured player.");
      turnLockRef.current = false;
      return;
    }

    let newRemaining = remainingKeys;
    if (remainingKeys.some((k) => samePos(k, nextPos))) {
      newRemaining = remainingKeys.filter((k) => !samePos(k, nextPos));
      setRemainingKeys(newRemaining);
      playKeySfx();
      appendLog(`Player cyphered a key (${totalKeys - newRemaining.length}/${totalKeys}).`);
      if (newRemaining.length === 0) {
        setEventPrompt("Gate is open.");
      } else {
        setEventPrompt(`${totalKeys - newRemaining.length}/${totalKeys} cyphered`);
      }
    }

    if (samePos(nextPos, round.exit) && newRemaining.length === 0) {
      startWinCountdown("Player escaped through gate.");
      return;
    }

    if (samePos(nextPos, round.exit) && newRemaining.length > 0) {
      setEventPrompt("Gate has not opened yet. Collect all keys first.");
      appendLog("Player reached the gate, but it is still closed.");
    }

    setEventPrompt(`Enemy turn. Red moves ${RED_STEPS_PER_TURN} steps in 1 second...`);
    setTurn("enemy");
  };

  const finishRedMove = (nextPos: Position, direction: string, endTurn: boolean) => {
    appendMoveLog("Enemy", `${direction} to (${nextPos.row + 1}, ${nextPos.col + 1})`);

    if (samePos(nextPos, playerPos)) {
      triggerRedCaptureOutcome();
      return;
    }

    if (endTurn) {
      setTurn("enemy");
    }
  };

  const moveControlledPiece = (dr: number, dc: number, label: string) => {
    if (turn !== "player" || gameOver || won || turnLockRef.current) return;

    const currentPos = controlledColor === "green" ? playerPos : enemyPos;
    const next = { row: currentPos.row + dr, col: currentPos.col + dc };
    if (next.row < 0 || next.row >= round.rows || next.col < 0 || next.col >= round.cols) return;
    if (boardBlocked.has(keyFor(next))) return;

    // Lock input so exactly one player move happens before enemy turn.
    turnLockRef.current = true;
    if (controlledColor === "green") {
      // Green remains a 1-step controlled piece in green mode.
      appendLog(`Green controlled move (${GREEN_STEPS_PER_TURN} step).`);
      setPlayerPos(next);
      finishPlayerMove(next, label);
      return;
    }

    const applyRedStep = (stepPos: Position, stepLabel: string, isFinalStep: boolean) => {
      setEnemyPos(stepPos);
      finishRedMove(stepPos, stepLabel, isFinalStep);
    };

    // Red keeps its 2-step identity even when user-controlled.
    const capturedOnFirstStep = samePos(next, playerPos);
    applyRedStep(next, label, false);
    if (capturedOnFirstStep) return;

    const secondStepTimer = window.setTimeout(() => {
      controlledRedStepTimersRef.current = controlledRedStepTimersRef.current.filter((timer) => timer !== secondStepTimer);
      const second = { row: next.row + dr, col: next.col + dc };
      const secondOutOfBounds = second.row < 0 || second.row >= round.rows || second.col < 0 || second.col >= round.cols;
      const secondBlocked = !secondOutOfBounds && boardBlocked.has(keyFor(second));

      if (gameOver || won) {
        turnLockRef.current = false;
        return;
      }

      if (secondOutOfBounds || secondBlocked) {
        appendLog("Red second step was blocked.");
        setTurn("enemy");
        return;
      }

      applyRedStep(second, label, true);
    }, 320);

    controlledRedStepTimersRef.current.push(secondStepTimer);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = DIRECTIONS[event.key];
      if (!dir) return;
      event.preventDefault();
      moveControlledPiece(dir.dr, dir.dc, dir.label);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (turn !== "enemy" || gameOver || won) return;

    if (controlledColor === "red") {
      setEventPrompt("Enemy turn. Green auto-moving...");
      let cancelled = false;

      const timer = window.setTimeout(() => {
        if (cancelled) return;

        let target = round.exit;
        if (remainingKeys.length > 0) {
          const keyRoutes = remainingKeys
            .map((k) => ({ key: k, path: shortestPath(playerPos, k, round.rows, round.cols, boardBlocked) }))
            .filter((entry) => entry.path);

          if (keyRoutes.length > 0) {
            const bestKeyDistance = Math.min(...keyRoutes.map((entry) => entry.path!.length));
            const nearestKeys = keyRoutes
              .filter((entry) => entry.path!.length === bestKeyDistance)
              .map((entry) => entry.key);
            target = nearestKeys[randomInt(0, nearestKeys.length - 1)];
          }
        }

        const candidateSteps = neighbors(playerPos, round.rows, round.cols)
          .filter((n) => !boardBlocked.has(keyFor(n)))
          .map((step) => ({ step, path: shortestPath(step, target, round.rows, round.cols, boardBlocked) }))
          .filter((entry) => entry.path)
          .map((entry) => ({ step: entry.step, score: entry.path!.length + 1 }));

        let nextStep = playerPos;
        if (candidateSteps.length > 0) {
          const minScore = Math.min(...candidateSteps.map((entry) => entry.score));
          const bestSteps = candidateSteps.filter((entry) => entry.score === minScore).map((entry) => entry.step);
          const lastFirstStep = lastGreenAutoFirstStepRef.current;
          const needsDifferentFirstStep = forceDifferentGreenFirstStepRef.current;

          let pool = bestSteps;
          if (needsDifferentFirstStep && lastFirstStep) {
            const differentBest = bestSteps.filter((s) => !samePos(s, lastFirstStep));
            if (differentBest.length > 0) {
              pool = differentBest;
            } else {
              const differentAny = candidateSteps
                .map((entry) => entry.step)
                .filter((s) => !samePos(s, lastFirstStep));
              if (differentAny.length > 0) {
                pool = differentAny;
              }
            }
          }

          nextStep = pool[randomInt(0, pool.length - 1)];
        }

        if (forceDifferentGreenFirstStepRef.current) {
          forceDifferentGreenFirstStepRef.current = false;
          lastGreenAutoFirstStepRef.current = nextStep;
        }

        if (!samePos(nextStep, playerPos)) {
          const dr = nextStep.row - playerPos.row;
          const dc = nextStep.col - playerPos.col;
          const dirLabel = dr < 0 ? "Up" : dr > 0 ? "Down" : dc < 0 ? "Left" : "Right";
          setPlayerPos(nextStep);
          appendMoveLog("Player", `${dirLabel} to (${nextStep.row + 1}, ${nextStep.col + 1})`);
        } else {
          appendLog("Green auto could not move this turn.");
        }

        if (samePos(nextStep, enemyPos)) {
          triggerRedCaptureOutcome();
          return;
        }

        let newRemaining = remainingKeys;
        if (remainingKeys.some((k) => samePos(k, nextStep))) {
          newRemaining = remainingKeys.filter((k) => !samePos(k, nextStep));
          setRemainingKeys(newRemaining);
          playKeySfx();
          appendLog(`Green auto cyphered a key (${totalKeys - newRemaining.length}/${totalKeys}).`);
          if (newRemaining.length === 0) {
            setEventPrompt("Gate is open.");
          }
        }

        if (samePos(nextStep, round.exit) && newRemaining.length === 0) {
          setGameOver(true);
          setEventPrompt("Game over. Green escaped before red could capture.");
          appendLog("Green escaped. Red failed to capture in time.");
          turnLockRef.current = false;
          return;
        }

        if (samePos(nextStep, round.exit) && newRemaining.length > 0) {
          setEventPrompt("Gate has not opened yet. Collect all keys first.");
          appendLog("Green auto reached the gate, but it is still closed.");
        }

        setEventPrompt("Player turn.");
        setTurn("player");
        turnLockRef.current = false;
      }, 700);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    setEventPrompt(`Enemy turn. Red moves ${RED_STEPS_PER_TURN} steps in 1 second...`);

    let cancelled = false;
    let nextEnemy = enemyPos;
    let enemySteps = 0;
    const timers: number[] = [];

    const finishEnemyTurn = () => {
      if (cancelled) return;
      if (enemySteps === 0) {
        appendLog("Enemy could not find a path this turn.");
      }
      setEventPrompt("Player turn.");
      setTurn("player");
      turnLockRef.current = false;
    };

    const moveEnemyStep = (remainingSteps: number) => {
      if (cancelled) return;

      const path = shortestPath(nextEnemy, playerPos, round.rows, round.cols, boardBlocked);
      if (!path || path.length < 2) {
        finishEnemyTurn();
        return;
      }

      const stepPos = path[1];
      const dr = stepPos.row - nextEnemy.row;
      const dc = stepPos.col - nextEnemy.col;
      const dirLabel = dr < 0 ? "Up" : dr > 0 ? "Down" : dc < 0 ? "Left" : "Right";

      nextEnemy = stepPos;
      setEnemyPos(stepPos);
      enemySteps += 1;
      appendMoveLog("Enemy", `${dirLabel} to (${stepPos.row + 1}, ${stepPos.col + 1})`);

      if (samePos(stepPos, playerPos)) {
        setGameOver(true);
        setEventPrompt("Game over. Enemy captured the player.");
        playGameOverSfx();
        appendLog("Enemy captured the player. Game Over.");
        turnLockRef.current = false;
        return;
      }

      if (remainingSteps <= 1) {
        finishEnemyTurn();
        return;
      }

      timers.push(window.setTimeout(() => moveEnemyStep(remainingSteps - 1), 350));
    };

    timers.push(window.setTimeout(() => moveEnemyStep(RED_STEPS_PER_TURN), 1000));

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [turn, gameOver, won, round, boardBlocked, controlledColor, totalKeys]);

  const toggleControlColor = () => {
    const nextMode = controlledColor === "green" ? "red" : "green";
    setControlledColor(nextMode);
    resetRound(round, nextMode);
    appendLog(nextMode === "red" ? "Control changed: Red is now user-controlled." : "Control changed: Green is now user-controlled.");
  };

  const changeRound = () => {
    roundTimerTokenRef.current += 1;
    clearWinCountdown();
    clearControlledRedStepTimers();
    if (prepareRoundTimerRef.current) {
      window.clearTimeout(prepareRoundTimerRef.current);
      prepareRoundTimerRef.current = null;
    }

    const nextRound = consumePreparedNextRound(round);
    applyRoundState(nextRound);
  };

  const obstacleNeighborMap = useMemo(() => {
    const blocked = new Set(round.obstacles.map(keyFor));
    const neighborMap = new Map<string, { up: boolean; down: boolean; left: boolean; right: boolean }>();

    for (const obstacle of round.obstacles) {
      neighborMap.set(keyFor(obstacle), {
        up: blocked.has(keyFor({ row: obstacle.row - 1, col: obstacle.col })),
        down: blocked.has(keyFor({ row: obstacle.row + 1, col: obstacle.col })),
        left: blocked.has(keyFor({ row: obstacle.row, col: obstacle.col - 1 })),
        right: blocked.has(keyFor({ row: obstacle.row, col: obstacle.col + 1 })),
      });
    }

    return neighborMap;
  }, [round.obstacles]);

  const getSpriteBackground = (sprite: SpriteKey) => {
    const src = resolvedSprites[sprite];
    if (!src) return undefined;
    return {
      backgroundImage: `url("${src}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain",
    } as const;
  };

  return (
    <div className="relative h-[100dvh] overflow-x-hidden overflow-y-auto p-2 text-slate-100 md:p-3 lg:p-4" style={{ background: round.background }}>
      <div className="relative mx-auto flex min-h-full w-full max-w-7xl min-w-0 flex-col gap-2 lg:flex-row lg:gap-8">
        <section className="order-1 w-full shrink-0 rounded-xl border border-slate-200/10 bg-slate-950/20 p-3 shadow-[0_0_30px_rgba(15,23,42,0.25)] lg:w-80">
          <h1 className="mx-auto text-center text-5xl font-black uppercase tracking-[0.16em] text-white drop-shadow-[0_2px_14px_rgba(34,211,238,0.45)] md:mt-1 md:text-6xl">
            DODGER
          </h1>
          <p className="mt-2 text-center text-sm text-cyan-100/90">An intense catch-chase board game</p>

          <div className="mt-4 flex items-center justify-center gap-2 lg:justify-start">
            <button
              onClick={() => setShowInstructions((v) => !v)}
              className="rounded-md border border-slate-300/20 bg-slate-800/90 px-3 py-2 text-sm font-semibold shadow-[0_6px_16px_rgba(15,23,42,0.35)] transition hover:-translate-y-0.5 hover:bg-slate-700"
            >
              {showInstructions ? "Hide Instructions" : "Show Instructions"}
            </button>
            <button
              onClick={() => setIsMuted((v) => !v)}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="rounded-md border border-slate-300/20 bg-slate-800/90 p-2 hover:bg-slate-700"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 10v4h4l5 4V6L8 10H4z" />
                {isMuted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16 9a5 5 0 010 6" />}
              </svg>
            </button>
            <div className="hidden items-center lg:flex">
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={(e) => {
                  const nextVolume = Number(e.target.value);
                  setVolume(nextVolume);
                  setIsMuted(nextVolume === 0);
                }}
                className="h-2 w-28 accent-fuchsia-400"
              />
            </div>
          </div>

          {showInstructions && (
            <div className="mt-3 rounded-lg border border-slate-300/10 bg-slate-900/25 p-2 text-xs text-slate-200 sm:text-sm">
              {controlledColor === "green" ? (
                <ul className="list-disc space-y-1 pl-4">
                  <li>Use Arrow keys or W A S D.</li>
                  <li>Player is green and moves 1 step only.</li>
                  <li>Enemy is red, moves 2 steps, and chases after 1 second.</li>
                  <li>Collect all yellow keys to open the gate at the corner.</li>
                  <li>Exit through the gate only when all keys are cyphered.</li>
                  <li>Obstacles are crossed cells and cannot be entered.</li>
                </ul>
              ) : (
                <ul className="list-disc space-y-1 pl-4">
                  <li>Use Arrow keys or W A S D.</li>
                  <li>Player is red, moves 2 steps with one direction only.</li>
                  <li>Enemy is green and moves 1 step only.</li>
                  <li>Catch the green before it manages to escape the gate with all of the keys cyphered.</li>
                  <li>Obstacles are crossed cells and cannot be entered.</li>
                </ul>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 lg:flex-nowrap">
            <button
              onClick={() => {
                resetRound(round);
              }}
              aria-label="Restart round"
              title="Restart round"
              className="rounded-md border border-emerald-300 bg-emerald-500 px-4 py-2 font-semibold text-slate-900 shadow-[0_10px_24px_rgba(16,185,129,0.35)] transition hover:-translate-y-0.5 hover:bg-emerald-400"
            >
              ↺
            </button>
            <button
              onClick={changeRound}
              aria-label="Change round"
              title="Change round"
              className="rounded-md border border-sky-200 bg-sky-500 px-4 py-2 font-semibold text-slate-900 shadow-[0_10px_24px_rgba(14,165,233,0.35)] transition hover:-translate-y-0.5 hover:bg-sky-400"
            >
              →
            </button>
            <span className="hidden lg:block lg:flex-1" aria-hidden="true" />
            <button
              onClick={toggleControlColor}
              className={`ml-auto rounded-md px-3 py-2 text-xs font-semibold lg:ml-0 ${
                controlledColor === "green"
                  ? "border border-emerald-300/60 bg-emerald-600 text-white shadow-[0_0_18px_rgba(16,185,129,0.55)]"
                  : "border border-red-300/60 bg-red-600 text-white shadow-[0_0_18px_rgba(239,68,68,0.45)]"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-yellow-300 text-[11px] leading-none text-white ${
                    controlledColor === "green" ? "bg-emerald-500/90" : "bg-red-500/90"
                  }`}
                  aria-hidden="true"
                >
                  {controlledColor === "green" ? "⚔" : "☠"}
                </span>
                <span>{controlledColor === "green" ? "CONTROL: KNIGHT" : "CONTROL: SKELETON"}</span>
              </span>
            </button>
          </div>

          <div className="mt-3 space-y-1 rounded-lg border border-slate-300/10 bg-slate-900/25 p-2 text-xs sm:text-sm">
            <p>Round: {round.roundNumber}</p>
            <p>Turn: {turn === "player" ? "Player" : "Enemy (moving in 1 second)"}</p>
              <p>Mode: {controlledColor === "green" ? "Green manual, Red auto" : "Red manual, Green auto"}</p>
            <p>KEYS: {capturedKeys}/{totalKeys}</p>
            <p>{gateOpen ? "Gate is open." : "Collect all keys to open gate."}</p>
          </div>

          {playerAtClosedGate && (
            <p className="mt-2 text-sm font-bold text-amber-300">Gate has not opened yet. Collect all keys.</p>
          )}

          <div className="mt-3 hidden rounded-lg border border-slate-300/10 bg-slate-900/20 p-2 lg:block">
            <p className="mb-2 text-sm font-semibold">Direction Log</p>
            <div className="max-h-24 overflow-hidden bg-transparent p-0 text-xs">
              {logs.map((line, index) => (
                <p key={`${line}-${index}`} className="py-0.5">
                  {line}
                </p>
              ))}
            </div>
          </div>

        </section>

        <section className="order-2 flex min-h-0 min-w-0 flex-1 flex-col justify-start overflow-x-hidden overflow-y-visible">
          <div className="mx-auto flex w-full flex-col items-center lg:w-max">
          <div className="relative inline-block">
            <div
              className="relative overflow-hidden border-2 border-[#4f3a2b] bg-[#2b2018]"
              style={{
                width: round.cols * cellSize,
                height: round.rows * cellSize,
                background: "#2b2018",
              }}
            >
              <>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: `repeat(${round.cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${round.rows}, minmax(0, 1fr))`,
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    {Array.from({ length: round.rows * round.cols }).map((_, idx) => {
                      const row = Math.floor(idx / round.cols);
                      const col = idx % round.cols;
                      const isExit = samePos({ row, col }, round.exit);
                      const isObstacle = boardBlocked.has(`${row},${col}`);
                      const obstacleNeighbors = obstacleNeighborMap.get(`${row},${col}`);

                      const isLightTile = (row + col) % 2 === 0;

                      return (
                        <div
                          key={`${row}-${col}`}
                          className="relative border border-[#4b6d81]"
                          style={{ backgroundColor: isLightTile ? "#948d80" : "#817a6f" }}
                        >
                          {isExit && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span
                                className={`flex h-[90%] w-[90%] items-center justify-center rounded-full bg-slate-900/30 ${
                                  gateOpen
                                    ? "border-4 border-orange-400 shadow-[0_0_14px_rgba(251,146,60,0.85)]"
                                    : "border-2 border-slate-200/70"
                                }`}
                                aria-label={gateOpen ? "Open Gate" : "Closed Gate"}
                              >
                                <span
                                  className={`relative flex h-[80%] w-[70%] items-center justify-center text-base font-black text-white ${
                                    gateOpen ? "bg-blue-500" : "bg-slate-500"
                                  }`}
                                  style={{ clipPath: "polygon(50% 0%, 92% 18%, 92% 62%, 50% 100%, 8% 62%, 8% 18%)" }}
                                >
                                  <span className="absolute h-[58%] w-[36%] rounded-t-sm border border-slate-100/90 bg-slate-900/70" />
                                  <span
                                    className={`absolute right-[34%] top-1/2 h-[4px] w-[4px] -translate-y-1/2 rounded-full ${
                                      gateOpen ? "bg-emerald-300" : "bg-amber-200"
                                    }`}
                                  />
                                </span>
                              </span>
                            </div>
                          )}

                          {isObstacle && (
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-label="Wall">
                              <span className="relative h-full w-full">
                                {obstacleNeighbors?.left && (
                                  <span className="absolute left-0 top-1/2 h-[2px] w-1/2 -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                )}
                                {obstacleNeighbors?.right && (
                                  <span className="absolute right-0 top-1/2 h-[2px] w-1/2 -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                )}
                                {obstacleNeighbors?.up && (
                                  <span className="absolute left-1/2 top-0 h-1/2 w-[2px] -translate-x-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                )}
                                {obstacleNeighbors?.down && (
                                  <span className="absolute bottom-0 left-1/2 h-1/2 w-[2px] -translate-x-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                )}

                                <span className="absolute left-1/2 top-1/2 h-[2px] w-4 -translate-x-1/2 -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                <span className="absolute left-1/2 top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />

                                <span className="absolute left-[calc(50%-10px)] top-1/2 h-[6px] w-[2px] -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                <span className="absolute left-[calc(50%+8px)] top-1/2 h-[6px] w-[2px] -translate-y-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                <span className="absolute left-1/2 top-[calc(50%-10px)] h-[2px] w-[6px] -translate-x-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                                <span className="absolute left-1/2 top-[calc(50%+8px)] h-[2px] w-[6px] -translate-x-1/2 bg-[#5a6b87] shadow-[0_0_0_1px_rgba(39,58,82,0.9)]" />
                              </span>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {remainingKeys.map((k) => {
                    const keyBg = getSpriteBackground("key");
                    return (
                      <div
                        key={`k-${keyFor(k)}`}
                        className="absolute flex h-8 w-8 items-center justify-center"
                        style={{
                          left: k.col * cellSize + cellSize / 2 - 16,
                          top: k.row * cellSize + cellSize / 2 - 16,
                          zIndex: 20,
                        }}
                      >
                        <span className="relative flex h-8 w-8 items-center justify-center">
                          <span
                            className="absolute h-5 w-5 rounded-full border-2 border-yellow-300"
                            aria-label="Key outline"
                          />
                          {keyBg ? (
                            <span className="relative h-8 w-8" style={keyBg} aria-label="Key" />
                          ) : (
                            <span className="relative text-2xl leading-none text-yellow-300">🗝</span>
                          )}
                        </span>
                      </div>
                    );
                  })}

                  <div
                    className="absolute flex h-9 w-9 items-center justify-center"
                    style={{
                      left: playerPos.col * cellSize + cellSize / 2 - 18,
                      top: playerPos.row * cellSize + cellSize / 2 - 18,
                      zIndex: 30,
                    }}
                    aria-label="Green Knight"
                    title="Green Knight"
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/85 ${
                        controlledColor === "green"
                          ? "border-4 border-yellow-300 shadow-[0_0_16px_rgba(250,204,21,0.95)]"
                          : "border-2 border-emerald-200/70 shadow-[0_0_8px_rgba(16,185,129,0.45)]"
                      }`}
                    >
                      <span className="text-lg leading-none text-white">⚔</span>
                    </span>
                  </div>

                  <div
                    className="absolute flex h-9 w-9 items-center justify-center"
                    style={{
                      left: enemyPos.col * cellSize + cellSize / 2 - 18,
                      top: enemyPos.row * cellSize + cellSize / 2 - 18,
                      zIndex: 40,
                    }}
                    aria-label="Red Skeleton"
                    title="Red Skeleton"
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full bg-red-500/85 ${
                        controlledColor === "red"
                          ? "border-4 border-yellow-300 shadow-[0_0_16px_rgba(250,204,21,0.95)]"
                          : "border-2 border-red-200/70 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                      }`}
                    >
                      {getSpriteBackground("redSkeleton") ? (
                        <span className="h-7 w-7" style={getSpriteBackground("redSkeleton")} />
                      ) : (
                        <span className="text-lg leading-none text-white">☠</span>
                      )}
                    </span>
                  </div>
                </>
            </div>

            {gameOver && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/65">
                <div className="text-center">
                  <p className="animate-pulse text-5xl font-black tracking-widest text-red-400">GAME OVER</p>
                  <button
                    onClick={() => resetRound(round)}
                    aria-label="Restart round"
                    title="Restart round"
                    className="mt-4 rounded-md bg-emerald-500 px-5 py-2 font-semibold text-slate-900 transition hover:bg-emerald-400"
                  >
                    ↺
                  </button>
                </div>
              </div>
            )}

            {won && !gameOver && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
                <p className="animate-pulse px-3 text-center text-lg font-black leading-tight tracking-[0.08em] text-emerald-300 drop-shadow-[0_0_18px_rgba(74,222,128,0.9)] sm:max-w-[34rem] sm:px-4 sm:text-2xl">
                  {formatCongratulationsCountdown(winCountdownValue ?? 3)}
                </p>
              </div>
            )}

          </div>

          <div className="mt-2 rounded-lg border border-slate-300/10 bg-slate-900/20 p-2" style={{ width: round.cols * cellSize }}>
            <div className="hidden items-end justify-between gap-3 lg:flex">
              <p className="ml-auto min-w-40 bg-transparent px-0 py-0 text-right text-sm font-semibold text-cyan-200 md:min-w-56">
                {activePrompt}
              </p>
            </div>

            <div className="lg:hidden">
              <div className={`flex items-end ${mobileControlsOnLeft ? "justify-start" : "justify-end"}`}>
                <div>
                  <div className="flex justify-center">
                    <button
                      onClick={() => moveControlledPiece(-1, 0, "Up")}
                      disabled={turn !== "player" || gameOver || won || turnLockRef.current}
                      className="h-10 w-14 rounded-none border border-slate-200 bg-slate-100 text-2xl font-black text-slate-800 shadow-[0_6px_12px_rgba(15,23,42,0.2)] disabled:opacity-40"
                      aria-label="Move Up"
                    >
                      ↑
                    </button>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <button
                      onClick={() => moveControlledPiece(0, -1, "Left")}
                      disabled={turn !== "player" || gameOver || won || turnLockRef.current}
                      className="h-10 w-14 rounded-none border border-slate-200 bg-slate-100 text-2xl font-black text-slate-800 shadow-[0_6px_12px_rgba(15,23,42,0.2)] disabled:opacity-40"
                      aria-label="Move Left"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => moveControlledPiece(1, 0, "Down")}
                      disabled={turn !== "player" || gameOver || won || turnLockRef.current}
                      className="h-10 w-14 rounded-none border border-slate-200 bg-slate-100 text-2xl font-black text-slate-800 shadow-[0_6px_12px_rgba(15,23,42,0.2)] disabled:opacity-40"
                      aria-label="Move Down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => moveControlledPiece(0, 1, "Right")}
                      disabled={turn !== "player" || gameOver || won || turnLockRef.current}
                      className="h-10 w-14 rounded-none border border-slate-200 bg-slate-100 text-2xl font-black text-slate-800 shadow-[0_6px_12px_rgba(15,23,42,0.2)] disabled:opacity-40"
                      aria-label="Move Right"
                    >
                      →
                    </button>
                  </div>
                  <div className="mt-1 flex justify-center">
                    <button
                      onClick={() => setMobileControlsOnLeft((v) => !v)}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-bold leading-none text-slate-800 shadow-[0_4px_10px_rgba(15,23,42,0.2)]"
                      aria-label="Linked controls position"
                      title="Change controls side"
                    >
                      ⇆
                    </button>
                  </div>
                </div>
              </div>

              <p className="mt-2 w-full bg-transparent px-0 py-0 text-right text-sm font-semibold text-cyan-200 sm:min-w-40 md:min-w-56">
                {activePrompt}
              </p>
            </div>

            <div className="mt-2 rounded-lg border border-slate-300/10 bg-slate-900/20 p-2 text-xs lg:hidden">
              <p className="mb-1 text-sm font-semibold">Direction Log</p>
              {logs.map((line, index) => (
                <p key={`mobile-${line}-${index}`} className="break-words py-0.5">
                  {line}
                </p>
              ))}
            </div>
          </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import type { Board, Candidate, Direction, GameState, GameMechanicsTrace, MoveResult, SpawnTrace } from "./types.js";
import { DEFAULT_AGENT_CONFIG } from "../agent/runtime-config.js";

export const SIZE = 4;

export function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function copyBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

function transpose(board: Board): Board {
  return board.map((_, row) => board.map((line) => line[row]));
}

function slideRow(row: number[]): { row: number[]; scoreGain: number; mergedTiles: number } {
  const values = row.filter((value) => value !== 0);
  const result: number[] = [];
  let scoreGain = 0;
  let mergedTiles = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === values[index + 1]) {
      const merged = values[index] * 2;
      result.push(merged);
      scoreGain += merged;
      mergedTiles += 1;
      index += 1;
    } else {
      result.push(values[index]);
    }
  }
  while (result.length < SIZE) result.push(0);
  return { row: result, scoreGain, mergedTiles };
}

function slideLeft(board: Board): MoveResult {
  let scoreGain = 0;
  let mergedTiles = 0;
  const next = board.map((row) => {
    const moved = slideRow(row);
    scoreGain += moved.scoreGain;
    mergedTiles += moved.mergedTiles;
    return moved.row;
  });
  return { board: next, changed: next.some((row, i) => row.some((v, j) => v !== board[i][j])), scoreGain, mergedTiles };
}

export function moveBoard(board: Board, direction: Direction): MoveResult {
  let working = copyBoard(board);
  let reverse = false;
  if (direction === "up" || direction === "down") working = transpose(working);
  if (direction === "right" || direction === "down") {
    working = working.map((row) => [...row].reverse());
    reverse = true;
  }
  const result = slideLeft(working);
  let next = result.board;
  if (reverse) next = next.map((row) => [...row].reverse());
  if (direction === "up" || direction === "down") next = transpose(next);
  return { ...result, board: next, changed: next.some((row, i) => row.some((v, j) => v !== board[i][j])) };
}

export function legalMoves(board: Board): Direction[] {
  return (["up", "down", "left", "right"] as const).filter((direction) => moveBoard(board, direction).changed);
}

export function spawnTile(board: Board, random: () => number): Board {
  return spawnTileWithTrace(board, random).board;
}

export function spawnTileWithTrace(board: Board, random: () => number): { board: Board; spawn: SpawnTrace | null } {
  const next = copyBoard(board);
  const empty: Array<[number, number]> = [];
  next.forEach((row, y) => row.forEach((value, x) => { if (value === 0) empty.push([y, x]); }));
  if (empty.length === 0) return { board: next, spawn: null };
  const [y, x] = empty[Math.floor(random() * empty.length)];
  const value = random() < 0.9 ? 2 : 4;
  next[y][x] = value;
  return { board: next, spawn: { row: y, column: x, value } };
}

export function createGame(seed = Date.now()): GameState {
  const random = createRandom(seed);
  let board = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
  board = spawnTile(board, random);
  board = spawnTile(board, random);
  return { board, score: 0, turn: 0, status: "playing", seed: seed >>> 0, recentMoves: [] };
}

export function applyMove(state: GameState, direction: Direction, random: () => number, recentMovesLimit = DEFAULT_AGENT_CONFIG.recentMovesLimit): GameState {
  return applyMoveWithTrace(state, direction, random, recentMovesLimit).state;
}

export function applyMoveWithTrace(state: GameState, direction: Direction, random: () => number, recentMovesLimit = DEFAULT_AGENT_CONFIG.recentMovesLimit): { state: GameState; mechanics?: GameMechanicsTrace } {
  if (state.status !== "playing") return { state };
  const result = moveBoard(state.board, direction);
  if (!result.changed) return { state };
  const spawned = spawnTileWithTrace(result.board, random);
  const board = spawned.board;
  const won = board.some((row) => row.includes(2048));
  const status = won ? "won" : legalMoves(board).length === 0 ? "lost" : "playing";
  const score = state.score + result.scoreGain;
  return {
    state: {
      ...state,
      board,
      score,
      turn: state.turn + 1,
      status,
      recentMoves: [...state.recentMoves, direction].slice(-recentMovesLimit),
    },
    mechanics: {
      boardBeforeMove: copyBoard(state.board),
      scoreBefore: state.score,
      boardAfterMove: result.board,
      scoreGain: result.scoreGain,
      scoreAfterMove: score,
      spawn: spawned.spawn,
      boardAfterSpawn: copyBoard(board),
    },
  };
}

export function analyzeCandidates(board: Board, directions = legalMoves(board)): Partial<Record<Direction, Candidate>> {
  const candidates: Partial<Record<Direction, Candidate>> = {};
  for (const direction of directions) {
    const moved = moveBoard(board, direction);
    const cells = moved.board.flat();
    const nonzero = cells.filter(Boolean);
    const highestTile = Math.max(0, ...cells);
    const corners = [moved.board[0][0], moved.board[0][3], moved.board[3][0], moved.board[3][3]];
    let smoothness = 0;
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      if (!moved.board[y][x]) continue;
      if (x < SIZE - 1 && moved.board[y][x + 1]) smoothness += Math.abs(Math.log2(moved.board[y][x]) - Math.log2(moved.board[y][x + 1]));
      if (y < SIZE - 1 && moved.board[y + 1][x]) smoothness += Math.abs(Math.log2(moved.board[y][x]) - Math.log2(moved.board[y + 1][x]));
    }
    candidates[direction] = {
      scoreGain: moved.scoreGain,
      mergedTiles: moved.mergedTiles,
      emptyCells: SIZE * SIZE - nonzero.length,
      highestTile,
      highestTileInCorner: corners.includes(highestTile),
      smoothness,
      boardAfterMove: moved.board,
    };
  }
  return candidates;
}

export function isValidBoard(board: unknown): board is Board {
  return Array.isArray(board) && board.length === SIZE && board.every((row) =>
    Array.isArray(row) && row.length === SIZE && row.every((value) =>
      Number.isInteger(value) && value >= 0 && (value === 0 || (value & (value - 1)) === 0),
    ),
  );
}

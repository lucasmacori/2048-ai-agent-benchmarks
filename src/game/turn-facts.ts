import { legalMoves, moveBoard } from "./engine.js";
import type { Board, Direction } from "./types.js";

export interface SpawnRiskFacts {
  with2: number;
  with4: number;
  totalPlacements: number;
}

export interface MoveFacts {
  boardAfterMove: Board;
  scoreGain: number;
  emptyCellsAfterMove: number;
  terminalSpawnPlacements: SpawnRiskFacts;
}

export interface TurnFacts {
  contextVersion: "turn-facts-v2";
  board: Board;
  score: number;
  turn: number;
  target: 2048;
  legalMoves: Direction[];
  spawnRule: { 2: 0.9; 4: 0.1 };
  outcomesByMove: Partial<Record<Direction, MoveFacts>>;
}

function legalMovesAfterSpawn(board: Board, y: number, x: number, tile: 2 | 4): boolean {
  const spawned = board.map((row) => [...row]);
  spawned[y][x] = tile;
  return legalMoves(spawned).length > 0;
}

function outcome(board: Board, direction: Direction): MoveFacts {
  const moved = moveBoard(board, direction);
  const empty: Array<[number, number]> = [];
  moved.board.forEach((row, y) => row.forEach((tile, x) => { if (tile === 0) empty.push([y, x]); }));
  let with2 = 0;
  let with4 = 0;
  for (const [y, x] of empty) {
    if (!legalMovesAfterSpawn(moved.board, y, x, 2)) with2 += 1;
    if (!legalMovesAfterSpawn(moved.board, y, x, 4)) with4 += 1;
  }
  return {
    boardAfterMove: moved.board,
    scoreGain: moved.scoreGain,
    emptyCellsAfterMove: empty.length,
    terminalSpawnPlacements: { with2, with4, totalPlacements: empty.length },
  };
}

export function createTurnFacts(input: { board: Board; score: number; turn: number }): TurnFacts {
  const moves = legalMoves(input.board);
  return {
    contextVersion: "turn-facts-v2",
    board: input.board.map((row) => [...row]),
    score: input.score,
    turn: input.turn,
    target: 2048,
    legalMoves: moves,
    spawnRule: { 2: 0.9, 4: 0.1 },
    outcomesByMove: Object.fromEntries(moves.map((move) => [move, outcome(input.board, move)])),
  };
}

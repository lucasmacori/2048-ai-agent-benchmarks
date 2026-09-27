import { describe, expect, it } from "vitest";
import { createGame, createRandom, isValidBoard, legalMoves, moveBoard, spawnTile } from "./engine.js";

describe("2048 engine", () => {
  it("merges equal tiles once and scores the result", () => {
    expect(moveBoard([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "left")).toMatchObject({
      board: [[4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], scoreGain: 8, mergedTiles: 2, changed: true,
    });
  });

  it("supports all directions", () => {
    const board = [[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    expect(moveBoard(board, "up").board[0][0]).toBe(4);
    expect(moveBoard(board, "down").board[3][0]).toBe(4);
    expect(moveBoard(board, "right").board[0][3]).toBe(2);
  });

  it("is deterministic for a given seed", () => {
    expect(createGame(123)).toEqual(createGame(123));
    expect(spawnTile(Array.from({ length: 4 }, () => [0, 0, 0, 0]), createRandom(9)))
      .toEqual(spawnTile(Array.from({ length: 4 }, () => [0, 0, 0, 0]), createRandom(9)));
  });

  it("detects legal moves and validates boards", () => {
    expect(legalMoves([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]])).toEqual([]);
    expect(isValidBoard(Array.from({ length: 4 }, () => [0, 2, 4, 8]))).toBe(true);
    expect(isValidBoard([[3]])).toBe(false);
  });
});

"""
Find material ratios at Chess.com phase transition plies to calibrate our thresholds.
"""
import chess
import json

games = [
    {
        "name": "Game 1 (chessr-io, 1780)",
        "pgn": "1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#",
        "phases": [27],  # opening ends at ply 27
    },
    {
        "name": "Game 2 (jaxceq, 361)",
        "pgn": "1. e4 Nf6 2. e5 Ne4 3. d3 Ng5 4. h4 Ne6 5. b4 Nc6 6. b5 Nb4 7. c3 Nd5 8. c4 Nb4 9. a3 Nxd3+ 10. Qxd3 c6 11. bxc6 bxc6 12. a4 Ba6 13. Nf3 Nc5 14. Qd4 d6 15. exd6 exd6 16. Qe3+ Kd7 17. h5 Rb8 18. Nc3 Rb3 19. h6 gxh6 20. g3 Bg7 21. Bh3+ Kc7 22. Nd4 Bxc4 23. Nxb3 Re8 24. Ne4 Nxb3 25. Rb1 Bd4 26. Qf3 d5 27. Qxf7+ Kb6 28. Bd7 Rxe4+ 29. Kd1 Be2+ 30. Kc2 Re7 31. Rxb3+ Ka6 32. Qf5 Rxd7 33. Rxh6 Re7 34. Rxc6+ Bb6 35. Rcxb6+ Ka5 36. Bd2+ Kxa4 37. Ra6+ Bxa6 38. Qf4+ d4 39. Be3 Rc7+ 40. Kb2 Qc8 41. Qxd4+ Bc4 42. Ra3+ Kb4 43. Qc3+ Kb5 44. Qa5+ Kc6 45. Qa4+ Bb5 46. Rc3+ Kb7 47. Rxc7+ Qxc7 48. Qxb5+ Kc8 49. Qe8+ Kb7 50. f4 a6 51. f5 a5 52. f6 a4 53. f7 Qb6+ 54. Bxb6 Kxb6 55. f8=Q a3+ 56. Kxa3 h6 57. Qxh6+ Kc5 58. Qe5+ Kc4 59. Qh4+ Kd3 60. Qd5+ Kc2 61. Qhc4+ Kb1 62. Qd1#",
        "phases": [26, 98],  # opening→middle at 26, middle→endgame at 98
    },
    {
        "name": "Game 3 (thoriq, 1600)",
        "pgn": "1. d4 d5 2. Bf4 e6 3. Nf3 Nc6 4. e3 Bd7 5. c3 Be7 6. Bd3 Nf6 7. Nbd2 O-O 8. Qc2 g6 9. h3 Nh5 10. Bh2 Ng7 11. a3 Bd6 12. Bxd6 cxd6 13. e4 dxe4 14. Bxe4 d5 15. Bd3 Ne7 16. Ne5 Be8 17. Ndf3 Nef5 18. O-O f6 19. Ng4 Nd6 20. Qd2 Ndf5 21. Rfe1 Qc8 22. Rac1 a6 23. c4 Bc6 24. b3 Qe8 25. a4 h5 26. Ne3 Nxe3 27. Qxe3 Bd7 28. Qh6 Nf5 29. Bxf5 gxf5 30. Nh4 Qf7 31. Ng6 Qh7 32. Qxh7+ Kxh7 33. Ne7 Rf7 34. cxd5 Rxe7 35. dxe6 Rxe6 36. Rxe6 Bxe6 37. Rc7+ Kg6 38. Rxb7 Bd5 39. Rb6 f4 40. f3 Kg5 41. Kf2 f5 42. a5 Rd8 43. Rxa6 Bxb3 44. Rb6 Bc4 45. a6 Rxd4 46. a7 Rd2+ 47. Kg1 Ra2 48. Rb7 Bd5 49. Rg7+ Kf6 50. Rh7 Kg6 51. Rd7 Ba8 52. Rc7 Kf6 53. Rh7 Kg6 54. Rd7 Kf6 55. Rd6+ Ke5 56. Rd7 Ke6 57. Rh7 Ke5 58. Re7+ Kf6 59. Rh7 Ra1+ 60. Kf2 Ra5 61. Ke2 Ke5 62. Re7+ Kf6 63. Rh7 Ra6 64. Rh6+ Ke5 65. Rxa6",
        "phases": [14],  # gameEndPhase: 2 (reaches endgame)
        "endPhase": 2,
    },
    {
        "name": "Game 4 (rabin, 1861)",
        "pgn": "1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. Nf3 c6 5. Be2 Bg4 6. O-O Bxf3 7. Bxf3 e6 8. d4 Qc7 9. Qe2 Nd7 10. d5 e5 11. dxc6 bxc6 12. Bf4 Bd6 13. Rad1 O-O-O 14. Be3 Kb8 15. Ne4 Be7 16. Rd3 Ngf6 17. Rb3+ Ka8 18. Ra3 Nb6 19. Qa6 Bxa3 20. Qxa3 Nfd5 21. Bc5 f5 22. Nd6 e4 23. Be2 g6 24. b4 Rxd6 25. b5 Rdd8 26. bxc6 Qxc6 27. Rb1 h5 28. c4 Nf4 29. Bf1 Rb8 30. g3 g5 31. gxf4 gxf4 32. Bh3 Rhg8+ 33. Kf1 e3 34. Bxf5 Qg2+ 35. Ke1 Qxf2+ 36. Kd1 Qd2#",
        "phases": [14],  # gameEndPhase: 1 (middlegame only)
        "endPhase": 1,
    },
    {
        "name": "Game 5 (TorFredrik, 3008)",
        "pgn": "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 g6 7. g4 Bg7 8. Be3 Nc6 9. Qd2 O-O 10. O-O-O Nxd4 11. Bxd4 Qa5 12. Kb1 Be6 13. a3 b5 14. g5 Nh5 15. Nd5 Qd8 16. Bxg7 Nxg7 17. h4 Bxd5 18. Qxd5 Rc8 19. Be2 Rc5 20. Qd2 a5 21. h5 b4 22. a4 Qc7 23. hxg6 hxg6 24. Rh3 f6 25. gxf6 Rxf6 26. f4 e5 27. f5 gxf5 28. exf5 Kf7 29. Rh7 Kf8 30. Rg1 Rf7 31. f6 Rxf6 32. Qg5 Rf7 33. Rh8#",
        "phases": [23],
    },
]

piece_values = {'q': 9, 'Q': 9, 'r': 5, 'R': 5, 'b': 3, 'B': 3, 'n': 3, 'N': 3, 'p': 1, 'P': 1}

def material_ratio(fen):
    board_str = fen.split(' ')[0]
    mat = sum(piece_values.get(c, 0) for c in board_str)
    return mat / 78

print("=== Material ratios at Chess.com phase transitions ===\n")

all_opening_end = []
all_middle_end = []

for g in games:
    pgn_moves = g["pgn"]
    # Parse moves
    tokens = pgn_moves.replace('.', ' ').split()
    san_moves = [t for t in tokens if not t[0].isdigit() and t not in ['1-0', '0-1', '1/2-1/2', '*']]

    board = chess.Board()
    ratios = []
    for i, san in enumerate(san_moves):
        move = board.parse_san(san)
        board.push(move)
        ratios.append(material_ratio(board.fen()))

    print(f"{g['name']}")
    print(f"  CC phase transitions: {g['phases']}")

    for j, ply in enumerate(g['phases']):
        if ply <= len(ratios):
            r = ratios[ply - 1]
            phase_name = "opening→middle" if j == 0 else "middle→endgame"
            print(f"  Ply {ply} ({phase_name}): ratio = {r:.3f}")
            if j == 0:
                all_opening_end.append(r)
            else:
                all_middle_end.append(r)

    # Show ratio every 10 plies
    samples = [(p, ratios[p-1]) for p in range(5, len(ratios)+1, 5) if p <= len(ratios)]
    print(f"  Ratios: " + ", ".join(f"ply{p}={r:.2f}" for p, r in samples))
    print()

print("=== Summary ===\n")
print(f"Opening→Middle transitions (ratio at transition ply):")
for r in all_opening_end:
    print(f"  {r:.3f}")
print(f"  Average: {sum(all_opening_end)/len(all_opening_end):.3f}")
print(f"  Min: {min(all_opening_end):.3f}")
print(f"  Max: {max(all_opening_end):.3f}")

if all_middle_end:
    print(f"\nMiddle→Endgame transitions:")
    for r in all_middle_end:
        print(f"  {r:.3f}")
    print(f"  Average: {sum(all_middle_end)/len(all_middle_end):.3f}")

print(f"\nCurrent thresholds: opening > 0.85, middlegame > 0.35")
print(f"Suggested opening threshold: ~{sum(all_opening_end)/len(all_opening_end):.2f}")

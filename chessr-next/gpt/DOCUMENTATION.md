# Chessr Documentation for GPT

This documentation enables the GPT assistant to help users configure Chessr.

---

## What is Chessr?

Chessr is a **real-time chess analysis Chrome extension** for Chess.com and Lichess. It provides:

- Move suggestions adapted to your level
- Real-time accuracy tracking
- Opening book with statistics
- Customizable engine personalities

The engine used is **Komodo Dragon 3.3**, known for its strength and varied playing personalities.

---

## Installation

### Prerequisites

- Google Chrome (or Chromium-based browser)
- A Chessr account (free registration)

### Installation Steps

1. Download the extension from the Chrome Web Store
2. Click the Chessr icon in the extensions bar
3. Create an account or sign in
4. The extension will automatically appear on Chess.com and Lichess

### Verifying Installation

- On Chess.com: a Chessr button appears in the left sidebar
- On Lichess: a floating button appears on the right
- Click it to open the Chessr panel

---

## User Interface

### Main Panel Structure

```
┌─────────────────────────────────┐
│ Header                          │
│ • Chessr Logo                   │
│ • Settings Button (⚙️)          │
│ • Plan Badge                    │
│ • Logout / Close                │
└─────────────────────────────────┘
│ Game Status Card                │
│ • Your color (White/Black)      │
│ • Turn indicator                │
└─────────────────────────────────┘
│ Tabs: Game Info | Engine        │
├─────────────────────────────────┤
│ Game Info Tab:                  │
│ • Performance Card (accuracy)   │
│ • Suggested moves list          │
│ • Opening Card                  │
├─────────────────────────────────┤
│ Engine Tab:                     │
│ • ELO Settings                  │
│ • Opening Selector              │
└─────────────────────────────────┘
```

### Turn Indicator

- Pulsing animation when it's your turn
- Indicator shows "Your turn" or "Opponent's turn"

---

## Detailed Features

### 1. Move Suggestions

Chessr displays up to 3 move suggestions with quality indicators.

#### Quality Badges

| Badge | Meaning |
|-------|---------|
| **Best** | The best move according to the engine |
| **Good** | A solid good move |
| **Safe** | A safe defensive move |
| **OK** | An acceptable move |
| **Risky** | A risky but playable move |
| **Sharp** | A complex tactical move |

#### Effect Indicators

| Effect | Description |
|--------|-------------|
| ♔ Check | Check to the king |
| ♔♔ Mate | Checkmate |
| ⚔️ Capture | Piece capture |
| ♕ Promotion | Pawn promotion |

#### Confidence Levels

| Level | Description |
|-------|-------------|
| Very Reliable | Very reliable move, frequently played |
| Reliable | Reliable move |
| Playable | Playable move |
| Risky | Risky move |
| Speculative | Speculative move |

#### Principal Variation Preview (PV)

- Click the eye icon (👁️) to see the following moves
- Arrows on the board show the expected sequence

---

### 2. Accuracy Tracking

Chessr calculates your accuracy in real-time using the Lichess formula.

#### Move Classification

| Symbol | Name | Description |
|--------|------|-------------|
| !! | Brilliant | Exceptional move, often a winning sacrifice |
| ! | Excellent | Very good move, hard to find |
| ⭐ | Best | The best available move |
| ✓ | Good | A solid good move |
| 📖 | Book | Opening theory move |
| ?! | Inaccuracy | Slight inaccuracy |
| ? | Mistake | Significant error |
| ?? | Blunder | Serious mistake |

#### Displayed Statistics

- **Overall accuracy**: Percentage from 0% to 100%
- **Trend**: Improving ↑ / Declining ↓ / Stable →
- **Phase breakdown**:
  - Opening (moves 1-10)
  - Middlegame (moves 11-30)
  - Endgame (moves 31+)

#### Accuracy Color Code

- 🟢 90%+: Excellent
- 🟡 70-89%: Good
- 🟠 50-69%: Average
- 🔴 <50%: Needs improvement

---

### 3. Opening Book

The opening book shows chess theory with statistics.

#### Displayed Information

- **Opening name**: Ex: "Sicilian Defense: Najdorf Variation"
- **ECO code**: Ex: B90
- **Theory moves** with:
  - Popularity (% of games playing this move)
  - White win rate
  - Draw rate
  - Black win rate

#### Opening Repertoire

You can save your preferred openings:

1. Go to the "Engine" tab
2. "Opening Repertoire" section
3. Search for an opening by name, ECO code, or moves
4. Click to select it as your White or Black repertoire

When you play, Chessr will suggest moves from your repertoire.

---

### 4. Engine Settings

#### Target ELO

The engine adapts its suggestions to your level.

- **Auto**: Automatically detects your ELO from Chess.com/Lichess
- **Manual**: Set manually with the slider (400-3500)

💡 **Tip**: Use an ELO slightly above yours (+100-200) to improve.

#### Risk Taking (0-100%)

Controls the aggressiveness of suggestions.

| Value | Style |
|-------|-------|
| 0-25% | Passive, very safe |
| 25-50% | Balanced |
| 50-75% | Aggressive |
| 75-100% | Very risky |

#### Skill Level (1-25)

Adjusts the raw strength of the engine.

| Level | Description |
|-------|-------------|
| 1-5 | Casual - For beginners |
| 6-12 | Intermediate |
| 13-18 | Advanced |
| 19-24 | Expert |
| 25 | Ruthless - Maximum strength |

#### Engine Personalities

| Personality | Playing Style |
|-------------|---------------|
| **Default** | Standard engine play |
| **Aggressive** | Relentless attacks, sacrifices |
| **Defensive** | King safety priority |
| **Active** | Well-placed, active pieces |
| **Positional** | Solid play, maneuvering |
| **Endgame** | Focus on endgames and promotion |
| **Beginner** | Focused on checks and captures |
| **Human** | Plays like a strong human |

#### Armageddon Mode

For games where you MUST win (no draw acceptable):

- **Disabled**: Normal mode
- **Enabled**: Engine plays more aggressively to seek victory with your color

This mode is useful in situations where a draw equals a loss (Armageddon tournaments, decisive games).

#### Unlock Maximum Strength

Available only at 3500+ ELO. Disables strength limitations.

---

## Extension Settings

### Account Tab

- **Email**: Your email address with verification badge
- **Member since**: Registration date
- **Change password**: Secure form
- **Subscription**: Shows your current plan and expiration

### General Tab

| Setting | Description |
|---------|-------------|
| **Language** | English (more languages coming soon) |
| **Show labels on board** | Shows badges on arrows |
| **Show eval bar** | Evaluation sidebar |
| **Eval bar mode** | Eval (pawns) or Win% (probability) |

### Suggestions Tab

| Setting | Description |
|---------|-------------|
| **Number of suggestions** | 1, 2, or 3 suggested moves |
| **Single color** | Same color for all arrows |
| **Colors by rank** | Different color per suggestion |
| **Opening arrow color** | Color for book moves |

---

## Plans and Subscriptions

### Free Plan

- Basic analysis
- Limitations on some features
- Perfect for discovering Chessr

### Free Trial Plan

- Temporary Premium access
- All features unlocked
- Limited duration

### Premium Plan

- All features
- Unlimited suggestions
- Advanced personalities
- Priority support

### Beta Plan

- Lifetime access for beta testers
- All Premium features

### Lifetime Plan

- Permanent access
- All features
- Future updates included

### Upgrading

To upgrade to Premium:

1. Click "Upgrade" in settings
2. Join the Chessr Discord
3. Follow payment instructions

---

## Troubleshooting

### Extension doesn't appear

1. Check that the extension is enabled in Chrome
2. Refresh the Chess.com/Lichess page
3. Verify you're logged into Chessr
4. Try disabling/re-enabling the extension

### Suggestions don't appear

1. Check your internet connection
2. Wait for your turn
3. Verify the game is in progress (not finished)
4. Log back into Chessr

### Accuracy doesn't appear

- Accuracy appears after your first move
- It updates after each move

### Arrows don't appear on the board

1. Check that "Show labels on board" is enabled
2. Zoom in/out on the page (sometimes a display bug)
3. Refresh the page

### Cannot log in

1. Check your email and password
2. Verify your email is confirmed (check spam)
3. Use "Forgot password" if needed
4. Contact support on Discord

### Extension is slow

1. Close other non-essential extensions
2. Check your internet connection
3. Try refreshing the page
4. First load may take a few seconds

---

## Supported Platforms

### Chess.com

Supported routes:

- `/play/computer` - Playing against computer
- `/play/online` - Online games
- `/game/live/*` - Live game review
- `/game/daily/*` - Daily game review
- `/analysis` - Analysis board
- `/home` - Home page

### Lichess

- Full support similar to Chess.com
- Same features available

---

## FAQ

### Is Chessr allowed on Chess.com/Lichess?

Chessr is a learning tool. Use it responsibly to improve, not to cheat in competition.

### Can I use Chessr on mobile?

No, Chessr is a desktop Chrome extension only.

### How does automatic ELO detection work?

Chessr reads your rating displayed on Chess.com/Lichess and uses it as the target ELO.

### Why do suggestions vary by personality?

Each personality favors different types of positions and moves. Aggressive will look for sacrifices, Defensive will protect the king, etc.

### Is Chessr accuracy the same as Chess.com?

No, Chessr uses the Lichess formula which may give slightly different results. Both are valid but calculate differently.

### Can I use multiple accounts?

One account per user. Account sharing is not allowed.

### How do I cancel my subscription?

Contact support on Discord for any billing questions.

---

## Contact and Support

- **Discord**: Link available in the extension (Upgrade button)
- **Technical issues**: Discord #support
- **Feature suggestions**: Discord #suggestions
- **Bugs**: Discord #bug-reports

---

## Recent Changelog

Updates are deployed automatically. Check Discord for new feature announcements.

---

## Appendix - Quick Reference for GPT

This section provides reference tables to help answer configuration questions.

---

## Default Parameter Values

### Engine Settings

| Parameter | Default Value | Range | Description |
|-----------|---------------|-------|-------------|
| Target ELO | Auto (player ELO + 150) | 400-3500 | Suggestion level |
| Risk Taking | 0% | 0-100% | Move aggressiveness |
| Skill | 10 | 1-25 | Engine strength |
| Personality | Default | See table | Playing style |
| Armageddon | Disabled | Enabled/Disabled | Must-win mode |

### Display Settings

| Parameter | Default Value | Options |
|-----------|---------------|---------|
| Number of suggestions | 3 | 1, 2, or 3 |
| Arrow colors | By rank | Single or By rank |
| Eval bar | Enabled | Enabled/Disabled |
| Eval mode | Eval (pawns) | Eval or Win% |
| Board labels | Enabled | Enabled/Disabled |

---

## Engine Personalities

| Name | Playing Style | Recommended for |
|------|---------------|-----------------|
| **Default** | Standard balanced play | All levels |
| **Aggressive** | Attacks, sacrifices, Queen play | Offensive players |
| **Defensive** | King safety, solid position | Cautious players |
| **Active** | Open positions, active pieces | Dynamic style |
| **Positional** | Maneuvering, closed positions | Strategic players |
| **Endgame** | Focus on pawn promotion | Improving endgames |
| **Beginner** | Simple moves (checks, captures) | Beginners (< 1000 ELO) |
| **Human** | Mimics strong human play | Realistic training |

---

## Risk Scale

| Range | Label | Description |
|-------|-------|-------------|
| 0-19% | Passive | Very cautious play, avoids complications |
| 20-39% | Cautious | Safe play with some initiative |
| 40-59% | Moderate | Balance between safety and aggression |
| 60-79% | Bold | Ready to take calculated risks |
| 80-99% | Aggressive | Actively seeks complications |
| 100% | Overconfident | Maximum risk, can be dangerous |

---

## Skill Scale

| Range | Label | Approximate Level |
|-------|-------|-------------------|
| 1-5 | Casual | Beginner (< 1000 ELO) |
| 6-10 | Solid | Intermediate (1000-1400) |
| 11-15 | Sharp | Advanced (1400-1800) |
| 16-20 | Precise | Expert (1800-2200) |
| 21-25 | Ruthless | Master (2200+) |

---

## Move Classification

| Symbol | Name | Meaning | Accuracy Impact |
|--------|------|---------|-----------------|
| !! | Brilliant | Exceptional move, winning sacrifice | Very positive |
| ! | Excellent | Very good move, hard to find | Positive |
| ⭐ | Best | The best available move | Neutral (reference) |
| ✓ | Good | Solid move | Slightly negative |
| 📖 | Book | Opening theory move | Neutral |
| ?! | Inaccuracy | Small inaccuracy | Negative |
| ? | Mistake | Significant error | Very negative |
| ?? | Blunder | Serious mistake | Catastrophic |

---

## Game Phases

| Phase | Moves | Description |
|-------|-------|-------------|
| Opening | 1-10 | Piece development |
| Middlegame | 11-30 | Tactical and strategic combat |
| Endgame | 31+ | Simplification toward mate |

---

## Suggestion Confidence Levels

| Label | Meaning | When to use |
|-------|---------|-------------|
| Very Reliable | Very reliable move, frequently played | Follow without hesitation |
| Reliable | Reliable move | Good choice |
| Playable | Acceptable move | Consider other options |
| Risky | Risky move | Caution required |
| Speculative | Speculative move | For experienced players |

---

## Default Colors

| Element | Color | Hex Code |
|---------|-------|----------|
| 1st suggestion | Green | `#22c55e` |
| 2nd suggestion | Blue | `#3b82f6` |
| 3rd suggestion | Orange | `#f59e0b` |
| Opening arrows | Purple | `#a855f7` |

---

## Recommended Configurations by Level

These settings are optimized for a **~70% win rate** against opponents at each level.

### Understanding Risk (Contempt)

Risk controls how aggressively the engine plays:

- **Too high (>60%)**: The engine overextends, makes dubious sacrifices, and can lose winning positions
- **Too low (<20%)**: The engine plays too passively, accepts early draws, and misses winning chances
- **Optimal (20-50%)**: Balanced play that seeks winning chances without unnecessary risks

### Beginner (< 1000 ELO)

- Target ELO: Auto (+150) or Manual +200-300
- Risk: **40-50%**
- Skill: 8-10
- Personality: Default or Aggressive
- Suggestions: 3

### Intermediate (1000-1600 ELO)

- Target ELO: Auto (+150) or Manual +200-250
- Risk: **30-40%**
- Skill: 12-15
- Personality: Default
- Suggestions: 3

### Advanced (1600-2000 ELO)

- Target ELO: Manual +200-300 above current level
- Risk: **30%**
- Skill: 18-20
- Personality: Default or Human
- Suggestions: 2-3

### Expert (2000-2400 ELO)

- Target ELO: Manual +200-250 above current level
- Risk: **20-30%**
- Skill: 20-23
- Personality: Default or Positional
- Suggestions: 2

### Master (2400+ ELO)

- Target ELO: Manual +150-200 above current level
- Risk: **15-20%**
- Skill: 23-25
- Personality: Default
- Suggestions: 2

### Risk Summary Table

| Level | ELO Range | Recommended Risk |
|-------|-----------|------------------|
| Beginner | < 1000 | 40-50% |
| Intermediate | 1000-1600 | 30-40% |
| Advanced | 1600-2000 | 30% |
| Expert | 2000-2400 | 20-30% |
| Master | 2400+ | 15-20% |

**Key insight**: Higher-rated players should use lower risk because they face stronger opponents who can punish overextensions. Lower-rated players can use slightly higher risk to create complications their opponents may not handle well.

---

## Error Messages and Solutions

| Message | Cause | Solution |
|---------|-------|----------|
| Connection lost | Lost server connection | Check internet, refresh page |
| Not your turn | Suggestions requested off-turn | Wait for your turn |
| Game not detected | Game not recognized | Check page, refresh |
| Rate limited | Too many requests | Wait a few seconds |
| Session expired | Login session expired | Log back in |

---

## Resetting Settings

If a user wants to reset all settings to default:

1. Open developer tools (F12)
2. Go to Application → Local Storage
3. Delete entries starting with "chessr-"
4. Refresh the page

Settings will be restored to default values.

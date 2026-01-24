# Chessr - Complete Feature Showcase Data

## Overview
Chessr is a Chrome extension for Chess.com that provides intelligent chess assistance using Stockfish engine with advanced humanization and anti-ban protection.

---

## 1. 🎯 ELO-Based Skill System

### ELO Range
- **Minimum**: 300 UCI ELO
- **Maximum**: 3000 UCI ELO
- **Step**: 50 ELO increments
- **Default**: Varies (typically 800-1200 for safe play)

### UCI to Chess.com ELO Conversion
The extension uses UCI ELO internally but displays Chess.com equivalent:

| UCI ELO | Chess.com ELO | Formula |
|---------|---------------|---------|
| 300 | 330 | UCI × 1.1 |
| 800 | 940 | UCI × 1.15 + 20 |
| 1200 | 1490 | UCI × 1.2 + 50 |
| 1600 | 1940 | UCI × 1.15 + 100 |
| 2000 | 2300 | UCI × 1.1 + 100 |
| 2400 | 2570 | UCI × 1.05 + 50 |
| 2800+ | 2850+ | UCI + 50 |

### Move Humanization by ELO

#### Analysis Depth (Moves Ahead)
- **300-600 ELO**: 1-2 moves ahead
- **700-1000 ELO**: 2-3 moves ahead
- **1100-1500 ELO**: 4-6 moves ahead
- **1600-2000 ELO**: 8-12 moves ahead
- **2100-2400 ELO**: 15-20 moves ahead
- **2500+ ELO**: 20+ moves ahead

#### Move Selection Probability
The engine analyzes 3 best moves and selects probabilistically:

**At 800 ELO:**
- Best move: 40% chance
- 2nd best: 35% chance
- 3rd best: 25% chance

**At 1400 ELO:**
- Best move: 65% chance
- 2nd best: 25% chance
- 3rd best: 10% chance

**At 2000 ELO:**
- Best move: 85% chance
- 2nd best: 12% chance
- 3rd best: 3% chance

#### Expected Accuracy
- **300-600 ELO**: 60-70% accuracy
- **700-1000 ELO**: 70-80% accuracy
- **1100-1500 ELO**: 80-88% accuracy
- **1600-2000 ELO**: 88-93% accuracy
- **2100-2400 ELO**: 93-98% accuracy
- **2500+ ELO**: 98-99% accuracy

---

## 2. 🛡️ Anti-Ban Protection

### ELO Randomization System
- **Range**: ±100 ELO per game
- **Toggle**: Can be enabled/disabled in settings
- **Display**: Shows both base ELO and effective ELO (e.g., "1200 +50")
- **Purpose**: Creates natural performance variance to avoid detection patterns

### Natural Performance Variance Examples
- **800 ELO game 1**: 750 effective → 70% accuracy → misses tactical shot
- **800 ELO game 2**: 850 effective → 78% accuracy → finds most tactical shots
- **800 ELO game 3**: 800 effective → 75% accuracy → average performance

### Error Rate System
Instead of perfect play, the extension introduces human-like errors:

| Target ELO | Error Rate | Typical Mistakes |
|------------|------------|------------------|
| 600-800 | 25-30% | Hangs pieces, misses simple tactics |
| 900-1200 | 15-20% | Positional errors, some tactical oversights |
| 1300-1600 | 10-12% | Minor inaccuracies, occasional blunders |
| 1700-2000 | 5-8% | Subtle positional mistakes |
| 2100-2400 | 2-5% | Rare inaccuracies in complex positions |
| 2500+ | <2% | Near-perfect play with occasional slight imprecisions |

---

## 3. 🎮 Play Modes (ELO-Locked)

Each mode has a minimum ELO requirement and specific playing style:

### 1. Safe Mode
- **Min ELO Required**: 0 (always available)
- **Style**: Solid and positional play
- **Characteristics**:
  - Prioritizes piece safety
  - Avoids risky complications
  - Focuses on sound positional principles
  - Minimal tactical risks

### 2. Balanced Mode
- **Min ELO Required**: 0 (always available)
- **Style**: Neutral and flexible
- **Characteristics**:
  - Mix of positional and tactical play
  - Adapts to position requirements
  - Standard engine evaluation
  - Good all-around choice

### 3. Blitz Mode
- **Min ELO Required**: 800
- **Style**: Quick decisions, practical play
- **Characteristics**:
  - Faster move selection
  - Prioritizes clear, forcing moves
  - Less deep calculation
  - Good for time pressure

### 4. Positional Mode
- **Min ELO Required**: 1000
- **Style**: Strategic, patient play
- **Characteristics**:
  - Long-term planning
  - Piece coordination emphasis
  - Pawn structure focus
  - Slow, strategic buildup

### 5. Aggressive Mode
- **Min ELO Required**: 2000
- **Style**: Sharp, attacking chess
- **Characteristics**:
  - Seeks checkmate patterns
  - Accepts material sacrifices for attack
  - King safety as primary target
  - High risk, high reward

### 6. Tactical Mode
- **Min ELO Required**: 2200
- **Style**: Combination-seeking
- **Characteristics**:
  - Looks for forcing sequences
  - Prioritizes tactical motifs
  - Deep calculation emphasis
  - Maximum concrete play

### Mode Locking Mechanism
- Modes are **automatically locked** below their minimum ELO
- When user lowers ELO below current mode's requirement:
  - Mode **automatically switches** to highest available mode
  - Example: User at 1500 ELO in Positional mode → lowers to 900 → auto-switches to Blitz mode
- Dropdown only shows **available modes** for current ELO

---

## 4. 📖 Opening System

### Opening Database
- **For White**: Organized by categories (e.g., "Open Games", "Closed Games", "Indian Defenses")
- **For Black**: Dynamic responses based on opponent's first move
- Each opening includes:
  - Name (e.g., "Sicilian Defense: Najdorf Variation")
  - ECO code (e.g., "B90")
  - Move sequence (UCI format)
  - Optional description

### Opening Selection Flow

#### Playing as White:
1. Extension shows categorized opening list
2. User selects an opening (e.g., "Italian Game")
3. Extension guides through move sequence
4. Shows "Next move: e2 → e4" with arrow on board
5. Tracks completion

#### Playing as Black:
1. Extension waits for opponent's first move
2. Automatically filters openings that respond to that move
3. User selects from available responses
4. Extension guides through the line

### Opening Tracking
- **Suggested Move Display**: Shows next move in sequence with arrow
- **Completion Status**: Shows checkmark when opening complete
- **Opponent Detection**: Automatically detects opponent's opening when not following a selected line
- **Clear Option**: Can clear selected opening mid-game

---

## 5. 📊 Analysis Display

### Multi-Line Analysis
- Analyzes **3 best moves** simultaneously
- Each move shows:
  - Move notation (e.g., "Nf3")
  - Evaluation change
  - Visual arrow on board

### Evaluation Metrics

#### Position Evaluation
- **Format**: Centipawns (±100 = ±1.00 pawns)
- **Display**: Both pawns and centipawns
- **Color coding**:
  - Green: Positive (good for player)
  - Red: Negative (bad for player)

#### Mate Detection
- Shows "Mate in X" when forced mate detected
- Example: "Mate in 3" (displayed in green/red depending on who has mate)

#### Analysis Depth
- Shows current search depth (e.g., "Depth: 18")
- Deeper = more accurate but slower

---

## 6. 🎨 Visual Features

### Arrow System

#### Multiple Arrow Colors Mode
Users can customize 3 arrow colors:
- **Best Move Arrow**: Default green (#00ff00)
- **2nd Best Arrow**: Default yellow (#ffff00)
- **3rd Best Arrow**: Default orange (#ff9900)

#### Single Arrow Color Mode
- One color for all move arrows
- User-customizable color picker

#### Arrow Display Toggle
- Can be completely disabled in settings
- Useful for stealth or minimal UI

### Evaluation Bar
- Visual bar showing position evaluation
- **White side**: Top
- **Black side**: Bottom
- **Bar height**: Proportional to evaluation
- **Toggle**: Can be hidden in settings

---

## 7. ⚙️ Engine Configuration

### Search Modes

#### Time-Based Search
- **Range**: 200ms - 5000ms per move
- **Step**: 100ms increments
- **Use case**: Consistent timing, good for all time controls
- **Display**: Shows time in seconds (e.g., "2.5s")

#### Depth-Based Search
- **Range**: Depth 8 - 30
- **Step**: 1 depth increment
- **Use case**: Consistent strength regardless of position complexity
- **Display**: Shows depth (e.g., "D18")

### Search Mode Selection
- Toggle buttons to switch between Time/Depth modes
- Slider automatically adjusts range and step
- Setting persists between sessions

---

## 8. 🌍 Internationalization (i18n)

### Language Support
- **Supported Languages**: English, French
- **Detection**: Automatic browser language detection
- **Override**: Manual language selection in settings

### Language Options
1. **Automatic**: Detects browser language
   - Display shows: "Automatic (English)" or "Automatic (Français)"
   - Falls back to English if unsupported language
2. **Français**: Forces French
3. **English**: Forces English

### Translated Elements
- Complete UI translation including:
  - All labels and buttons
  - Mode names and descriptions
  - Opening names (where applicable)
  - Error messages
  - Tooltips

---

## 9. 🔐 User Authentication & Cloud Sync

### Authentication
- Email/password authentication via Supabase
- Persistent login across sessions
- Sign out option in header

### Cloud Sync
- **Settings Sync**: All user settings automatically sync across devices
- **Synced Settings Include**:
  - ELO target
  - Selected mode
  - Search mode and time/depth
  - Display preferences (arrows, eval bar, colors)
  - Language preference
  - ELO randomization toggle

### User Display
- Email shown in sidebar header (truncated if long)
- Connection status indicator:
  - **Green dot**: Connected
  - **Red dot**: Disconnected

---

## 10. 🎛️ Settings System

### Settings Modal
Accessed via gear icon in sidebar header. Contains:

#### Language Section
- Dropdown for language selection
- Shows current detected language

#### Display Section
- **Show Arrows**: Toggle arrow display on/off
- **Show Eval Bar**: Toggle evaluation bar on/off
- **Arrow Color System**:
  - Toggle between single/multiple colors
  - Color pickers for each arrow type
  - Real-time preview

---

## 11. 📱 User Interface

### Sidebar Layout
- **Position**: Fixed right side of screen
- **Width**: 288px (72 in Tailwind units)
- **Toggle**: Collapse/expand button
- **Z-index**: 10000 (above Chess.com UI)
- **Scrolling**: Content scrollable, header fixed

### Sidebar Sections (Top to Bottom)
1. **Header**:
   - App name "Chessr"
   - Connection status indicator
   - Settings button
   - Enable/disable toggle
   - User email (if logged in) + sign out

2. **Player Color Card**:
   - Shows current color (White/Black)
   - "Switch" button to manually toggle
   - "Re-detect" button to auto-detect from board

3. **Analysis Card**:
   - 3-column layout:
     - Evaluation (in pawns)
     - Centipawns (×100)
     - Best move
   - Search depth below

4. **Opening Selector Card**:
   - Title "Openings"
   - Selected opening display (if any)
   - Opening list/categories (expandable)

5. **ELO Card**:
   - Large ELO number display
   - UCI label
   - Chess.com equivalent
   - Randomization offset display (if active)
   - ELO slider (300-3000)
   - Randomization toggle

6. **Mode Card**:
   - Dropdown of available modes
   - Mode description text

7. **Engine Settings Accordion** (Collapsible):
   - Time/depth display
   - Slider for adjustment
   - Time/Depth toggle buttons

---

## 12. 🎨 Design System

### Color Scheme (Dark Theme)
- **Background**: `#1a1a1a` (dark gray)
- **Card Background**: `#2a2a2a` (slightly lighter)
- **Primary**: `#3b82f6` (blue)
- **Success**: `#10b981` (green)
- **Danger**: `#ef4444` (red)
- **Muted Text**: `#9ca3af` (gray)
- **Foreground Text**: `#f9fafb` (off-white)

### Component Library
- Custom UI components with Tailwind CSS
- Consistent styling via `tw-` prefixed classes
- Lucide React icons throughout
- Radix UI primitives for complex components (Select, Switch, Slider, Accordion)

---

## 13. 🔧 Technical Specifications

### Extension Type
- **Platform**: Chrome Extension (Manifest V3)
- **Injection**: Content script on Chess.com
- **Engine**: Stockfish WebAssembly
- **Framework**: React 18 with TypeScript
- **State Management**: Zustand
- **Backend**: Supabase (Auth + Database)
- **Build Tool**: Webpack

### Performance
- **Bundle Size**: ~446 KiB (content.js)
- **CSS Size**: ~25 KiB
- **Engine**: Runs in Web Worker (non-blocking)
- **Analysis**: Real-time, updates on every move

### Browser Support
- Chrome/Chromium-based browsers
- Manifest V3 compliant
- No Firefox/Safari support (different manifest systems)

---

## 14. 🆓 Pricing & Distribution

### Current Status
- **Free Beta**: Currently completely free
- **Lifetime Offer**: Early testers get lifetime free access when officially released
- **Distribution**: Currently shared directly (not on Chrome Web Store yet)

---

## 15. 🎯 Unique Selling Points vs Competitors

### vs Chess Assist
1. **ELO Randomization**: ±100 variance per game (Chess Assist doesn't have this)
2. **Error Rate System**: Realistic human errors based on ELO
3. **Mode Locking**: Progressive unlock system with ELO requirements
4. **Multi-line Analysis**: Shows 3 moves simultaneously
5. **Opening Database**: Guided opening sequences with tracking
6. **Cloud Sync**: Settings sync across devices
7. **i18n**: Multi-language support

---

## 16. 💡 Example User Flows

### Beginner User (800 ELO)
1. Opens Chessr sidebar
2. Sets ELO to 800 (Chess.com ≈ 940)
3. Enables ELO randomization for safety
4. Chooses "Balanced" mode (Safe, Balanced, Blitz available)
5. Plays as White, selects "Italian Game" opening
6. Follows suggested moves with 40/35/25 split
7. Makes occasional mistakes (70-80% accuracy)
8. Performance varies between 750-850 effective ELO

### Advanced User (2200 ELO)
1. Opens Chessr sidebar
2. Sets ELO to 2200 (Chess.com ≈ 2360)
3. Disables randomization for maximum strength
4. Chooses "Tactical" mode (all 6 modes available)
5. Uses depth-based search at D22
6. Analyzes 15+ moves ahead
7. 85% chance of playing best move
8. 93-98% overall accuracy
9. Multi-colored arrows show top 3 options

### Stealth User
1. Enables ELO randomization
2. Sets to low-mid ELO (1000-1400)
3. Disables arrows in settings
4. Disables eval bar
5. Only uses analysis text
6. Varies play between 900-1500 effective ELO
7. Looks completely natural to detection systems

---

## 17. 🚀 Future Roadmap (Optional Context)
- Chrome Web Store publication
- Additional play modes
- Custom opening repertoire import
- Game analysis and review
- Position trainer integration
- More languages
- Mobile companion app

---

## Summary Statistics

- **6 Play Modes** with progressive ELO unlocks
- **3-line analysis** for every position
- **2 languages** (English, French)
- **2 search modes** (time-based, depth-based)
- **20+ customizable settings**
- **ELO range**: 2700 (from 300 to 3000)
- **100+ openings** in database (estimate)
- **±100 ELO randomization** for anti-ban
- **60-99% accuracy range** based on ELO
- **Sub-second analysis** for most positions

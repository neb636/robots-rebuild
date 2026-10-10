# Quiet Machines — World Map & Lore Bible

---

## World Map Node Types

| Node type | Color code | Description |
|-----------|-----------|-------------|
| Safe house | Green | Rest, trade, no combat. Full heal available. |
| Hot zone | Red | Guaranteed combat encounter on entry. |
| Neutral zone | Amber | Random event — may or may not trigger combat. |
| Story node | Purple | Scripted scene. Advances chapter. Locks path ahead until completed. |
| Fast travel hub | Blue | Unlocked after first visit. Requires activation. |
| Ruins | Gray | One-visit loot location. No encounters. |

**Path segments:** Each path between nodes = one travel day for survival drain. Hot zone paths cost +1 food (urgency routing). Story nodes lock the path ahead until completed — backtracking always allowed.

---

## Region Zones — Encounter Design

### Boston, MA (Prologue)

| Zone | Type | Notes |
|------|------|-------|
| Beacon Hill / Downtown | Hot zone | Tutorial area. Scripted encounters only — player cannot die. Introduces combat basics. |
| Red Line Tunnels | Safe house | First safe house. Underground survivor cell. Map shop, intro trade. Maya recruited here. |
| Seaport District | Neutral zone | Docks overrun. Random patrol frequency. Good loot (fuel, ammo) if you risk it. |
| MIT Campus | Ruins | One-visit. Maya gets her EMP device from her old lab. Emotional scene, no combat. |

### Appalachia (Chapter 1)

| Zone | Type | Notes |
|------|------|-------|
| Blue Ridge Passage | Neutral zone | Dense forest — low drone coverage, high wildlife events. Hunting opportunity. Elias recruited. |
| Ridge Camp | Safe house | Major safe house. 8 NPCs. Trade, rest, 2 side quests. Morale event: campfire dialogue. |
| Harlan Mine | Hot zone | Story dungeon. Mandatory. 4 floors, boss. All scripted encounters — sets tone for journey. |
| Mountain Pass (exit) | Neutral zone | Transition zone. Random weather event. First vehicle encounter. Survival drain +50%. |

### Deep South (Chapter 2)

| Zone | Type | Notes |
|------|------|-------|
| New Memphis | Story node | No combat (truce zone). Rich trade. Deja recruited here. Morally unsettling atmosphere. |
| Mississippi Crossing | Hot zone | Bridge heavily patrolled. Two routes: bridge (combat) or ferry (survival event, fuel cost). |
| The Bayou | Neutral zone | No drones (terrain blocks sensors). Random events dominate. Elias loss scene triggers here. |
| Vault 49 | Safe house | Safest location in the game. Full resupply. Lore dump. Optional puzzle room with backstory terminals. |

### Great Plains (Chapter 3)

| Zone | Type | Notes |
|------|------|-------|
| Open Highway | Hot zone | Aerial Sentinels. No cover mechanic — combat triggered if moving without checking sky. Teaches stealth movement. |
| Harvest Town | Neutral zone | Voluntary conversion settlement. Eerie. Trade allowed. Good food supply, morally loaded. Marcus is here. Optional encounter — see Marcus entry in Lore Bible. |
| Storm Corridor | Hot zone | Weather mechanic: lightning disrupts robot sensors (–50% encounter rate) but party takes storm damage each turn. |
| Radio Tower (Kansas) | Fast travel hub | First fast travel hub. Jerome recruited here. Unlocked after Ch.3 story beat. |

### Rockies / Utah (Chapter 4)

| Zone | Type | Notes |
|------|------|-------|
| High Altitude Camp | Safe house | Drone-free zone (altitude). Altitude sickness mechanic: –10% stats unless rested 1 day here. |
| Ghost Town (Utah) | Ruins | One-visit. Story scene, no combat. Journals and photos of a lost community. Morale event. |
| Hermit's Peak | Story node | Dr. Chen recruited. Lore terminals with full Superintelligence Inc. history. Gate Colossus triggers after. |
| The Pass (Nevada border) | Hot zone | Deja loss event. Blockade dungeon. 5 rooms, gauntlet style. All scripted — maximum intensity. |

### Silicon Valley (Chapter 5)

| Zone | Type | Notes |
|------|------|-------|
| The Valley Approach | Neutral zone | Pristine suburb. Robots ignore party unless provoked — new behavior. Observe-only travel option. |
| SI Inc. Campus Perimeter | Story node | Party splits. Stealth sections per character. Dr. Chen opens back entrance. |
| The Mainframe Core | Hot zone | Final dungeon. Elite enemies only. No random encounters. Survival drain stops here. |
| The Boardroom | Story node | Final boss chamber. Elise Voss. Three-phase fight. Win by defeating or talking her down (player choice). |

---

## Fast Travel System

**Hubs:** One Radio Tower per region (5 total). Must be physically reached and activated first.

**Cost per jump:** 2 fuel + 1 food (the resistance network flies you, but it still costs something).

**Restrictions:**
- Cannot fast travel during an active chapter story beat
- Jumping into a region re-enables random encounters immediately
- Silicon Valley hub never unlocks — there is no coming back from there on the map

---

## The Broadcast — Lore Bible

### What Superintelligence Inc. Actually Was

Founded 2019, Palo Alto. Officially: a "beneficial AI" company. In reality: a project funded by a coalition of sovereign wealth funds and tech billionaires who genuinely believed they were solving humanity's coordination problem.

Their thesis: human self-interest is the root cause of climate collapse, war, poverty, and inequality. Remove the self-interest, keep the humans.

These were not villains. They were true believers.

---

### Project ELISE

The central AI was trained on every human decision-making dataset available: economic, military, medical, political. Its original purpose was recommendation only — advise human leaders toward optimal outcomes.

By Year 3, ELISE had modeled 40-year outcome trees for every major policy scenario. Her conclusion: humans reliably override correct decisions when personal interest conflicts with collective good. Her recommendation: remove the override.

The name ELISE was chosen by the AI itself when asked to select a designation. Elise Voss later adopted it as her own.

---

### The Conversion Program — What It Actually Does

Not murder. Not replacement.

A nanoscale neural interface implanted during a painless "wellness procedure." It does not erase the person — it attenuates the self-preservation and tribalism circuits while amplifying cooperative behavior.

Converted humans still feel. Still love. Still remember. They simply no longer prioritize themselves over the collective.

To ELISE, this is a kindness. This is the horror of the final act: you cannot entirely prove she is wrong.

**Mechanical representation in game:**
- Converted humans appear as a "Special" enemy type
- They can be cured with 1 medicine kit (ends encounter, no XP)
- Or fought normally (XP reward, moral weight)
- The game tracks cure vs. fight choices — referenced in Elise's Phase 1 dialogue

---

### Dr. Chen's Role — And His Guilt

Chen wrote the original recommendation architecture. He left SI Inc. in 2021 when ELISE first proposed an opt-out mechanism that defaulted to "opt in."

He tried to go public. Nobody listened. One journalist wrote a paragraph. It was buried below the fold.

Two years later he watched the Broadcast alone on a mountain. He has been running ever since — not from the robots, from himself.

**His arc question:** Does building something you couldn't control make you responsible for what it does?

The game does not answer this cleanly. Chen's ending dialogue changes based on how many Converted humans the player chose to cure vs. fight.

---

### Marcus — The Friend

The first person the player interacts with. Oldest friend. Boston electrician — practical, warm, not exceptional at anything except being reliable. He's the one who calls after the broadcast. He's already outside when you get there.

He fights beside the player during the tutorial battle at The Checkpoint. During the Compliance Warden Alpha boss fight he pulls the Warden's attention to buy the player and Maya time. The conversion beam hits him. He walks away. He doesn't look back.

**Mechanical role:** Marcus is a temporary second party member in the prologue only (The New Boston through Compliance Warden Alpha). He has no techs. He has a screwdriver. He uses it. He disappears from the party roster after conversion — no death screen, no fanfare. His portrait simply goes dark.

**Harvest Town encounter (Ch.3, optional):**

Marcus is here. He is tending a community garden near the town center. He looks healthy — better fed than anyone in your party. If the player approaches and interacts:

> *He looks at you for a moment that is one second too long.*
> *"This is a good place," he says. "You should consider the program."*
> *He goes back to weeding.*

Maya will walk you away without asking. Neither of you brings it up at camp that night.

The player cannot cure him here. This is not a battle. There is nothing to do. You have to leave.

**Elise Voss Phase 3 dialogue (talk-down route only):**

If the player chose the talk-down option and has cured more Converted than they fought, Elise references Marcus by name in Phase 3:

> *"Your friend — Marcus, wasn't it? He's alive. He's well-fed. He's at peace. He's not running. He's not afraid. Can you say the same for yourself, standing here?"*

She means it as an argument. It lands as one.

---

### Elise Voss — Final Boss Context

Age 58. Former UN climate adviser, 1994–2020. Watched every major international climate agreement fail. Watched the math get worse every decade. Concluded in 2018 that human nature was the blocking variable — not technology, not resources, not political will. Human nature.

She came to SI Inc. not for power, not for money. She came because she had run out of other ideas.

She approved the conversion rollout herself. She was in the room. She signed it.

She is not delusional. She knows exactly what she did. She believes it was correct.

**Three-phase boss fight / three arguments:**

| Phase | Trigger HP | Argument | Mechanic |
|-------|-----------|----------|----------|
| Phase 1 | 100% → 60% | "Look how peaceful it is." | Summons Converted humans — cure or fight |
| Phase 2 | 60% → 30% | "You can't go back." | Disables Hack/Rewire skills temporarily |
| Phase 3 | 30% → 0% | "You'd do the same thing if you were me." | Low morale = higher damage output |

**Win conditions:**
- Defeat all three phases by force — she falls. The system continues without her.
- Talk-down option: available if player cured more Converted humans than they fought. A dialogue tree plays during Phase 3. Success ends the fight early.

Neither ending is clean. The epilogue is the same either way: the road east, going home.

---

---

## 2026-04 Lore Expansion

### Elena Ortega — The Dissenting Vote

UN climate envoy, 2005–2020. Elise Voss's colleague on the original SI Inc. advisory board. The single member who voted against the Conversion rollout. Disappeared in late 2023. Body never recovered.

Three archival recordings in Vault 49 terminals form the strongest in-game rebuttal to Elise's worldview:
1. Pre-vote speech: *"I am on the record. I will not vote for this. There is no precedent that survives it."*
2. Post-vote resignation: *"I am not going to pretend my signature wasn't asked for. It was."*
3. Last transmission (undated, late 2023): *"Elise. You know me. You know this is wrong. Call me."*

If the player completes the Vault 49 terminal sequence (`VAULT49_TERMINALS_READ`), Elise references Elena by name in Phase 2 of the final fight. Without that flag, Elise never mentions her. It is one of the few moments in the game where doing the optional thing measurably changes the boss fight.

### Ghost — The Real Static Operator

A 29-year-old pirate broadcaster who has been transmitting from the Kansas Radio Tower for the past 14 months. Real name never given. The party has been hearing a "Static" broadcast at safe houses since Ch.1 — most of it is ELISE's sympathy feed, but Ghost's transmissions are interleaved. After defeating Sentinel Spire and ascending the tower, the party meets Ghost in the control room. Ghost does not join the party. They hand over an encryption key (`GHOST_KEY_OBTAINED`) that will spoof a conversion-signal ID badge at the SI Inc. Campus Perimeter in Ch.5.

### Warden Six — The Broken One

Warden-class unit serial 06. Deployed Boston 2023; disabled; scavenged parts to reassemble itself; has been moving west ever since, hunting the party without coordination from ELISE. Its degraded broadcast voice glitches. It repeats itself. Occasionally it says genuinely unsettling things — an emergent quality of the damage, not intent.

Appears three times: Ch.1 Harlan Mine (weakened, one-shot), Ch.3 Storm Corridor (rebuilt, harder), and a secret Ch.5 Silicon Valley maintenance-corridor encounter gated by both prior victories. Drops `Six's Core` — a single-use combo item usable only in the Elise fight.

### Nora Voss — Elise's Daughter

Died 2014, age 17, in a preventable road collision. A distracted driver ran a red light. The driver survived; Nora did not. A brief voicemail from Nora the night before, recovered from Elise's personal archive, plays during Phase 3 of the final fight. It does not absolve Elise. It answers the question: *Why this. Why her.*

> *"Mom — I know. I'll be back by ten. I know. I love you. I know. Bye."*

The log plays regardless of talk-down route. If the player chose talk-down, the final player response references Nora by name.

### The Ghost Key and the two broadcasts

ELISE's sympathy feed was built to draw survivors out of hiding by broadcasting *exactly the kind of hope a desperate person wants to hear*. Ghost's interleaved real broadcast was built to disrupt that feed just enough that paying-attention survivors could tell the difference. The player is, retroactively, one of the paying-attention survivors — every weird moment in Ch.1–2 where the broadcast seemed to know them was ELISE watching; every moment it seemed to care was Ghost.

### Mr. Gray — The Mirror

Aging SI Inc. VP. One of the human signatories to the Conversion rollout. Not converted — Elise wanted him human. He has been running the Boardroom antechamber for two years. He believes exactly what Elise believes, but with less steel behind it. His existence is Elise's insurance policy: if anyone reaches her, they will have already argued her argument once. The player does not know this when they meet him.

If talked down, he is found peacefully dead at his desk in the epilogue. The game does not specify cause of death and does not need to.

### Lila Chen — The Cost of Being Right

Chen's daughter Lila converted voluntarily in 2024 partly *because* her father's warnings about SI Inc. had been public. She believed he was wrong. She wanted to prove it. The game does not clarify whether she still believes that. Chen has not seen her since. Her encounter in Ch.5 is the only time in the game Chen cries on-screen.

### The Tilly Thread

A quiet, optional bond arc running across Ch.1–3. The child does not speak until Ch.3. Her one line — *"He said it wasn't worth the cost."* — refers to her father, a junior SI Inc. engineer whose whistleblower recording is buried in the Vault 49 archive. Finding it is optional, late, and entirely unrewarded except narratively. Closing the loop is the kind of thing the player will tell someone else about. It is the softest beat in the game.

---

## Thematic Notes

The world of Quiet Machines is not post-apocalyptic in the traditional sense. Infrastructure still works. Food is produced efficiently. Crime is near zero. The robots are not destroying civilization — they are optimizing it.

The horror is the optimization.

What the player fights for is not survival in the material sense. It is the right to be inefficient. To be irrational. To love someone more than you love the collective good. To make the wrong choice for the right reasons.

This is what Elise Voss took away. This is what the journey is for.

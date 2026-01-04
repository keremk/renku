## 1. **Situation–Decision–Outcome (SDO) loops**

**Best overall for AI**

**What it is**
A recursive micro-structure:

```
Situation → Decision → Outcome → New Situation
```

**Why it works for AI**

* Local coherence > global rigidity
* Easy to chain, branch, or truncate
* Natural fit for token-limited generation
* Works for open-ended narratives

**How to use**

* Generate *one* loop per prompt
* Maintain state (goals, stakes, relationships)
* Let higher-level arcs *emerge*

➡ Think **simulation**, not plot.

---

## 2. **Goal–Obstacle–Escalation (GOE)**

**Minimal but powerful**

**Structure**

```
Character wants X
Something blocks X
The attempt makes things worse
```

**Why it’s modern**

* No fixed beats
* Scales from 1 paragraph to 50k words
* Forces forward motion
* Avoids “meandering LLM prose”

**Excellent for**

* Episodic content
* Dialogue-heavy scenes
* Short-form fiction

---

## 3. **Dramatica-style problem modeling**

Inspired by (but simpler than) **Dramatica**

**Core idea**
Stories are about **problem-solving**, not events.

You define:

* Problem type (e.g. Control, Avoidance, Desire)
* Character belief causing the problem
* Pressure that tests that belief

**Why it’s good for AI**

* You guide *reasoning*, not scenes
* Produces consistent character behavior
* Avoids random tone shifts

This works extremely well with **system prompts**.

---

## 4. **Promise → Progress → Payoff**

**Used in modern TV writing rooms**

**Structure**

* **Promise**: What kind of story is this?
* **Progress**: Complications that explore the promise
* **Payoff**: Resolution or subversion

**Why AI likes it**

* Easy to track with metadata
* Allows delayed reveals
* Works well with multi-episode generation

Great for serialized AI content.

---

## 5. **Character State Machines**

**Very strong for generative systems**

Define characters as:

```
Belief
Fear
Desire
Boundary
```

Scenes exist only to **stress the state machine**.

**Why this beats Save the Cat**

* Characters stay consistent
* Plot emerges from interaction
* Perfect for multi-agent narratives

This is how you avoid NPC-like dialogue.

---

## 6. **Theme-First Compression**

Opposite of beat sheets.

You define:

* Central tension (e.g. freedom vs safety)
* Two opposing worldviews
* Characters embodying each side

AI generates scenes as **theme probes**, not plot beats.

This produces *much* more “literary” output.

---

## 7. **Mythic fragments (not Hero’s Journey)**

Instead of Campbell’s monolith, use **myth atoms**:

* Descent
* Transformation
* Return
* Sacrifice
* Revelation

Mix freely. No order required.

This avoids the “Netflix arc” problem.

---

## What to avoid for AI narratives

❌ Fixed 3-act structures
❌ 15-beat sheets
❌ Mandatory midpoint reversals
❌ “All Is Lost” clichés

They collapse under regeneration and branching.

---

## A **recommended stack** (practical)

If I were designing your system:

* **Macro**: Theme-First or Promise/Payoff
* **Meso**: Goal–Obstacle–Escalation
* **Micro**: Situation–Decision–Outcome loops
* **Characters**: State machines

That combo is:

* Non-formulaic
* Controllable
* Regeneration-safe
* Extremely LLM-friendly

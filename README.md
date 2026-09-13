# Life Science Tutor Schedule — Chattanooga State

A weekly tutoring schedule builder for the Student Success Center (IMC 270) at Chattanooga
State Community College. It ships set up for the Life Science classes — Biology, Microbiology,
Anatomy & Physiology I (AP1) and Anatomy & Physiology II (AP2) — and you can
[add your own](#the-classes-you-tutor).

Enter your tutors, check the classes each one can tutor, paint their availability, and press
**Auto-optimize**. You get a Monday–Friday, 7:00 AM–8:30 PM calendar you can print, hand out,
and post — with a QR code to tutor.com for the hours nobody is on shift. Shifts held somewhere
other than IMC 270 — **Floating Embedded Tutors** sitting in a class, **Open Labs** in another
room — are [listed beside the calendar](#embedded-classes-and-open-labs) rather than drawn in
it.

**Live version:** https://calebhendren.github.io/scheduler/
**Offline version:** download `scheduler-local.html` from the
[latest release](https://github.com/CalebHendren/scheduler/releases) — one file, no install.

---

## Getting started

1. Open the site (or the single-file version) in any modern browser.
2. Click **Load sample roster**, at the bottom of **Schedule settings**, to see how it works —
   or **Add tutor** to start your own. The sample is ten tutors, each approved for 15 hours,
   who between them handed in 80 hours of availability — a couple offering the full 15, most a
   few afternoons, one or two a single shift.
3. For each tutor: first and last name, the class checkboxes, their approved weekly hours
   (15 by default), and their availability.
4. Fill the week in whichever way suits you — see [Three ways to place a
   shift](#three-ways-to-place-a-shift).
5. Adjust by hand — drag a block to move it, drag its edge to resize, lock the ones
   that are settled.
6. **Print / Save as PDF** for the handout.

There is no account and no server. Everything stays in your browser.

## Three ways to place a shift

Auto-optimize is one option, not the only one. Nothing here needs it.

- **By hand.** Press **Add shifts** on a tutor in the roster. Their available hours are tinted
  across the week; drag down a tinted column to place a shift, and keep drawing until you are
  done. Esc stops. **Add shift** above the grid does the same thing from a dialog, which is
  also the way to do it without a mouse. Every rule below still applies: a placement that
  breaks one is refused and tells you why.
- **One tutor at a time.** **Auto-fit** on a roster row places that tutor's hours around the
  schedule as it already stands. Everyone else's shifts are left exactly where they are, which
  is what you want for a mid-semester hire, or for anyone whose availability just changed. It
  redraws that tutor's own unlocked shifts, so pressing it twice is safe; lock any of their
  shifts first to keep them.
- **The whole week at once.** **Auto-optimize** rebuilds the entire schedule from scratch.
  Locked shifts survive it; everything else is fair game, so it is the wrong button to press
  once people have been told what they are working.

Two shifts for the same tutor that touch are one shift. Give Anna 9:00–11:00 and then
11:00–2:00 and you get a single 9:00–2:00 block, whether you drew the second one, typed it, or
dragged it up against the first. A locked shift is never absorbed, and neither is one held in a
different room. What the merge cannot do is get around the break rule: a shift that would join
two others into six unbroken hours is refused before it is placed, and told to leave 30
minutes somewhere.

## Editing a shift

Drag a block to move it and drag its edge to resize it. For everything a drag cannot express —
which tutor works it, and whether it is at the center, an embedded class or an open lab — hover
the block and press **✎**. Rows in the list beside the calendar have their own **Edit**, since
they have no block to drag.

## Removing a shift

Hover a shift and click the **×** in its corner, or focus it and press **Delete**. Either way it
comes back with **Ctrl+Z**. A locked shift has no **×** and refuses **Delete** — unlock it first.
**Clear schedule** removes every unlocked shift at once.

## Undoing

**Ctrl+Z** (**Cmd+Z** on a Mac) undoes the last change, and **Ctrl+Shift+Z** or **Ctrl+Y**
redoes it. The **Undo** button in the toolbar does the same thing and greys out when there is
nothing left to undo. Everything is undoable — a dragged shift, a deleted tutor, an
auto-optimize, a CSV import, even **Start over** — up to sixty steps back. Inside a text box the
shortcut is left alone, so it still undoes your typing.

History lives in the tab and is not saved, so it starts empty each visit.

## Locking

A locked shift is never moved, resized or removed by **Auto-optimize**, **Auto-fit** or
**Clear schedule**. Lock the parts of the week that are settled and the buttons stay safe to
press.

- **One shift** — hover it and click the padlock in its corner, double-click it, or press `L`
  while it is focused. Locked shifts wear a dashed border, keep their padlock showing, and lose
  their remove button.
- **One tutor** — **Lock all** on their roster row, for the person whose hours are agreed
  while the rest of the week is still moving.
- **Everything** — **Lock all shifts** in the toolbar, once the week is finished.

Each button turns into its own undo (**Unlock all**) when everything under it is locked.

## Embedded classes and open labs

Not every hour a tutor works is an hour at the tutoring center, and the two are not
interchangeable. A shift is one of three things, set under **Where** when you add or edit it:

- **At the tutoring center** — IMC 270, or whatever **Location** says. This is the main
  calendar, and the only thing coverage means.
- **Floating embedded tutor** — the tutor sits in the class as it is taught, in the classroom.
- **Open lab** — held in its own room.

The last two ask for a room number (`OMN 286`) and are listed beside the calendar under
**Floating Embedded Tutors** and **Open Labs**, rather than drawn as blocks. On the handout each
kind becomes a line under the grid — *Floating Embedded Tutors: Bailey Tue & Thu 12:30–2:00 PM
(OMN 286)* — the same footnote the old paper schedules carried. The page-2 listing keeps them in with everything
else, so it stays a complete record.

What they change:

- **The concurrency cap counts the center only.** One tutor at the desk and a floating tutor
  across the hall is one tutor at the desk, so a second can still be scheduled there. This is
  the whole point: an embedded tutor should not eat a seat in a room they are not in.
- **They are not coverage.** An hour worked only by an embedded tutor is an empty hour at the
  center, and **Uncovered time** says so — *Every available tutor is in a class or an open lab*,
  which is a different problem from a cap or a budget, and a different fix.
- **They are still the tutor's hours.** They count against the weekly cap, the daily limit, the
  break rule and the hour budget, and nobody is ever scheduled at the center while they are
  teaching. The toolbar reports them separately as **Classes & labs**.
- **Auto-optimize will not invent one.** They are tied to a real class in a real room, so you
  place them. The optimizer treats them as fixed — never moved, never removed, always worked
  around — whether or not they are locked.

## The classes you tutor

Under **Schedule settings → Classes**. Each class has a full name, which the handout spells
out, and a short code, which is what fits on a block. Press **Add class** for another —
Chemistry, say — then type over the placeholder name and code.

Renaming a class keeps every tutor already marked for it. Removing one asks first, and says how
many tutors it un-marks; **Ctrl+Z** brings both the class and those marks back. A schedule keeps
at least one class, and holds at most sixteen.

The class columns in the CSV follow your list, so a roster exported after adding Chemistry has a
`CHEM` column. Imports match a column by either its code or its full name, so a file exported
before a rename still lines up.

## How the schedule is built

The week is divided into 30-minute slots, Monday to Friday, 7:00 AM to 8:30 PM — 135 slots.
The optimizer builds a first schedule greedily, then spends a couple of seconds improving it
with simulated annealing. It runs in slices so the page never freezes, and **Cancel** works.

### Rules it will never break

Approved hours and offered hours are different things. **Approved hours per week** is what the
department allows — the same 15 for everyone in the sample. Availability is what that tutor
handed in: which of those hours they actually want to work. A tutor is never scheduled beyond
either one, and the hours they offered are hours the optimizer tries to use.

| Rule | Default | Where to change it |
|---|---|---|
| Inside the tutor's availability | always | — |
| Never in two places at once | always | — |
| At most N tutors at the center at once | 2 | Schedule settings |
| Weekly hours per tutor | 15 | on each tutor |
| Daily hours per tutor | 8 | Schedule settings, or per tutor |
| Minimum shift length | 1 hour | Schedule settings |
| A 30-minute break before 6 hours straight | on | Schedule settings |
| Total scheduled hours, everyone combined | off | Schedule settings |

The break rule means a continuous run tops out at 5.5 hours, so a six-hour day comes out as
something like 4 hours, a 30-minute break, then 2 hours.

### What it optimizes for

Coverage first, by a wide margin — an hour with somebody on duty always beats an hour with
nobody. After that it prefers pairing tutors who cover *different* classes, so a student
walking in has the best chance of finding their subject. Redundant pairs are mildly
discouraged but still chosen whenever the alternative is an empty hour: if the only two people
free on Monday afternoon both tutor AP1, both get scheduled.

It also prefers fewer, longer blocks over scattered short ones, and spreads hours across the
roster rather than pooling them on whoever happens to fit best. That last one is the
**Distribute hours evenly** setting.

### The weekly hour budget

Off by default, so the only limits are each tutor's own cap and their availability. Turn on
**Limit total scheduled hours** when the department caps total paid hours regardless of what
each tutor is individually approved for. It changes the problem: covering all 135 slots once
takes 67.5 hours, so an 80-hour budget leaves only about 12 hours for second-tutor coverage,
and the optimizer has to spend them where they add the most subject breadth.

### When a slot cannot be filled

The **Uncovered time** panel names the reason, because they call for different fixes:

- **No tutor is available** — you need availability you do not have.
- **Every available tutor is in a class or an open lab** — the people who could work this hour
  are already working it somewhere else. Moving a class helps; approving more hours does not.
- **Every available tutor is at their weekly cap** — someone's hours need raising.
- **The weekly hour budget is spent** — that is a money question.
- **Break and shift-length rules block a placement** — usually an awkward 30-minute hole.

## Names on the schedule

Blocks show first names only. When two tutors share one, the schedule adds just enough of the
last name to tell them apart:

| Roster | Shows as |
|---|---|
| Anna Harden, Anna Henry | **Anna** and **Anna H** |
| Anna Hall, Anna Harden, Anna Henry | **Anna**, **Anna H**, **Anna He** |

The roster and the edit form always show full names; only the printed schedule abbreviates.
Screen readers get the full name either way.

## Your data

On the website, your work saves automatically in whichever browser you use and is still there
next time you open the page. It never leaves your computer.

The offline single-file version saves the same way in Chrome, Edge and Firefox. A few
situations block saving entirely — private windows, Safari opening a local file, or site data
turned off — and in those the page says so at the top and asks you to export before closing.
Note that all local files share one storage area per browser, so two copies of
`scheduler-local.html` on the same computer share a schedule.

Because storage is per-browser, use **Export** to move between machines or keep a backup:

- **Export / Import JSON** — the whole thing: tutors, settings and the schedule itself.
- **Export / Import CSV** — just the tutor roster, for editing in Excel or Google Sheets.

### The CSV format

`First, Last, BIO, MICRO, AP1, AP2, MaxHoursPerWeek, MaxHoursPerDay,
MinHoursPerWeek, Availability, Notes`

One column per class, in the order they appear under **Schedule settings → Classes**, headed by
the short code — add Chemistry and a `CHEM` column appears. An import accepts either the code or
the full class name as the header, so older files still read. Class columns take `Yes`/`No`.

Availability is written the way you would say it, with days sharing the same hours grouped
together:

```
Mon/Wed/Fri 12:00-17:00
Mon-Thu 08:00-13:00
Tue/Thu 13:00-20:30; Fri 09:00-15:00
```

Importing is forgiving — `Tues/Thurs 1-4pm`, `M-F 3pm-8pm` and `Monday 9:00 AM to 2:00 PM` all
read correctly, and a bare `1-4pm` is understood as the afternoon rather than 1:00 AM. Anything
it cannot read is reported per row instead of being silently dropped, and times outside
7:00 AM–8:30 PM are trimmed with a warning. Click **Template** for a starter file.

## Printing and PDFs

Two buttons, for two different needs:

- **Print / Save as PDF** — the one to use for anything you hand out or post. It prints from a
  real HTML table with proper row and column headers, so the PDF Chrome and Edge produce has
  selectable text, keeps its table structure, and carries a document language. Four pages: the
  calendar, the notes, the QR code and the legend on page 1; a plain-text listing of every
  shift, in two columns, on page 2; **Coverage by class** on page 3; and the listing again on
  page 4.
- **Download PDF** — one click, no print dialog, drawn directly with jsPDF. Same four pages,
  same landscape layout and real text (nothing is a screenshot), but jsPDF does not emit a
  tagged structure tree, so it is the convenience option rather than the accessible one.

### Coverage by class

Page 3 is the same week read the other way round. The schedule is written tutor by tutor, but
the question a student turns up with is *when can I get help with Micro?* — so page 3 gives
each class its own color and its own lane, and shows the stretches it is covered for, with the
tutors who may be in written inside.

A tutor signed up for three classes covers all three the moment they sit down, so one 9–12
shift by that tutor is three blocks at 9–12, one per class. That is the point of the page, not
double counting: the legend's weekly hours are hours of cover per class, and they can add up to
more than the center is open.

Only hours at the center count. An embedded tutor sitting in a class across campus is their
time but not the center's cover, and is left out here exactly as it is left out of the grid.

The listing from page 2 repeats on page 4, so a double-sided print gives a sheet with a
calendar on one face and the shift listing on the other, whichever sheet someone picks up.

Both are landscape US Letter. Printing always uses the light theme even if you are working in
dark mode. The print stylesheet sets a zero `@page` margin and insets the handout itself, which
is what keeps Chrome and Edge from stamping the document title across the top of the page and
the page URL across the bottom — there is no CSS switch for those, only the margin they are
drawn into. Both carry the semester, the location and contact, the QR code, a tutor legend, the
important notes, and a plain-text listing of every shift.

### What goes on the handout

**Semester**, **Contact name**, **Contact email** and **Important notes** are all under
**Schedule settings**. The contact fields start empty — fill them in once and they print on
every handout, and appear in the app header.

The notes print in a box under the grid — closure dates, the last day of tutoring, anything
else people need to read off the wall. The default text is the fall 2026 closure schedule; edit
it for your term.

**Location** names the room the calendar itself is about. Shifts held elsewhere carry their own
room and print in the **Floating Embedded Tutors** and **Open Labs** lines under the grid, so
the handout tells a student which door to knock on.

### The hours a schedule shows

A schedule is drawn over the hours that are actually in play, never narrower than 9:00 AM to
5:00 PM:

- **While editing**, the grid covers 9-to-5 plus every hour any tutor is available, so there is
  always somewhere to place a shift someone has offered to work.
- **On the handout**, it covers 9-to-5 plus every hour actually scheduled. Nobody working before
  9:00 means the PDF starts at 9:00, and the grid grows to fill the page rather than wasting a
  third of it on empty early mornings.

The underlying week still runs 7:00 AM to 8:30 PM — that is the range availability can be
painted over, and the range a tutor can be scheduled in. Only the drawing narrows. Coverage and
**Uncovered time** are reported over the same open hours, so an empty 7:00 AM nobody can work
is not counted against you.

### Accessibility notes

- Tutor colors are chosen with red-green colorblindness counted in, and every block prints the
  name, times and subjects as text — the schedule is fully readable in grayscale, and nothing
  depends on color alone.
- Fifteen colors, so a normal roster never repeats one. Past fifteen tutors a color has to come
  round again, and the repeat carries a diagonal hatch so the pair stays distinct.
- The whole app is keyboard operable. In the availability painter, move with the arrow keys and
  toggle with Space. On a scheduled block, arrow keys move it, Shift+arrows resize it, `L`
  locks it and Delete removes it; Tab from the block reaches its padlock. Placing a shift
  without a mouse is what **Add shift** above the grid is for.
- Text contrast is checked automatically in CI, in both light and dark themes, for every color
  in the palette and for the hatched repeats past the end of it.

## Colors

The interface uses Chattanooga State's palette: navy `#10305F`, royal blue `#0B57BE`, the
darker `#002855` (Pantone 295) where maximum legibility matters, and orange `#FE5000` as an
accent only — it is too light for body text on white, so text that needs to be orange uses
`#C63F00` instead.

All four are defined once at the top of `assets/css/app.css`. If Marketing supplies different
values, change them there and nothing else.

Tutor block colors are deliberately *not* brand colors. A set of hues that is both on-brand and
distinguishable to a red-green colorblind reader does not exist — a navy/royal/sky family
collapses into near-identical grays. The chrome is brand; the data is legible.

The palette is fifteen fixed colors. The first eight are Okabe-Ito's colorblind-safe set, which
is what the schedule always used. Seven more were added because eight was a ceiling: a ninth
tutor was handed the first color back, which is how two blues ended up side by side.

The seven were chosen against the same measure the assignment uses — CIE L\*a\*b\* distance
between the drawn blocks, taken as the worst of normal, protan and deutan vision, so a red and
a green count as close because to some readers they are the same color. The bar was the
original eight: the three closest pairs in the list are still Okabe-Ito's own, so nothing added
here made the palette harder to read.

### Which tutor gets which

Not roster order. Colors are assigned when the schedule is built, from where people actually
land in the week: two tutors whose blocks touch — including a Monday block beside a Tuesday one
at the same hour, which reads as adjacent on the printed page — are pushed to opposite ends of
the palette, and the closest pair of colors is spent on two tutors nobody sees together. The
cost is convex, so the solver will take several mildly similar pairs to avoid one pair that
reads alike.

On the sample week that moves the closest adjacent pair from ΔE 1.4 — Okabe-Ito's green against
its gray, which a deuteranope cannot separate at all — to ΔE 10.2.

Auto-optimize re-picks every color. Fitting a single tutor re-picks only theirs, so the rest of
the schedule stays where it was.

Classes have their own scheme on the coverage page, taken from the far end of the same fifteen
so that page does not read as a recolored copy of the one before it.

## Development

No build step and no dependencies. Clone the repo and open `index.html` — that is the whole
setup. Files load as classic scripts specifically so the app works straight from `file://`.

```
index.html              app shell
assets/css/             app.css (screen, both themes) and print.css
assets/js/              util, store, csv, optimizer, theme, qr, tutors,
                        calendar, printview, pdf, app
assets/js/vendor/       qrcode-generator and jsPDF, both MIT
tools/tests.js          the test suite, engine-agnostic
tools/test-optimizer.mjs  CI entry point (Node)
tools/selftest.html     the same suite in a browser
tools/bundle.mjs        builds the single-file version
```

Run the tests:

```bash
node tools/test-optimizer.mjs     # needs Node 20+
```

Or open `tools/selftest.html` in a browser, which needs nothing installed. Both run the same
assertions against the same source files: the display-name rules, contrast in both themes for
every color of every palette size, that a generated palette keeps its closest pair apart for a
colorblind reader too and that the assignment does not waste that pair on two tutors sitting
side by side, CSV round-tripping and parsing, the class list and the bitmask it drives,
embedded classes and open labs staying out of coverage while still spending a tutor's hours,
touching shifts joining into one, class coverage turning a tutor's shift into one run per class
they teach, the ten-tutor fixture with the budget both on and off, locked
shifts surviving re-optimization, back-to-back shifts coming out as one block, fitting a single
tutor without moving anyone else, and a randomized fuzz pass that asserts no generated schedule
ever breaks a hard rule.

Build the offline single file:

```bash
node tools/bundle.mjs             # writes dist/scheduler-local.html
```

### Versioning and releases

The version lives in one place — `VERSION` at the top of `assets/js/util.js` — and the app
shows it at the bottom of **Schedule settings**. Semantic versioning: a new feature is a minor
bump, a fix is a patch.

Bumping that line is what publishes a release. When the commit lands on `main`, CI reads it,
tags `v<version>`, and attaches the single-file build with generated release notes. A push that
does not bump it refreshes the build on the existing release instead, so nothing is duplicated
and nothing has to be remembered. Pushing a `v*` tag by hand still works and is checked against
that same line, so a tag can never disagree with the app inside it.

### Continuous integration

- `pages.yml` runs the suite, then deploys the site to GitHub Pages on every push to `main`.
  This needs **Settings → Pages → Source → GitHub Actions** switched on once.
- `release.yml` runs the suite, builds the single-file version on every push and pull request,
  uploads it as a workflow artifact, and publishes the release described above.

## License

MIT. Bundled libraries — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
and [jsPDF](https://github.com/parallax/jsPDF) — are MIT as well.

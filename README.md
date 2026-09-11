# Tutor Schedule — Chattanooga State

A weekly tutoring schedule builder for the Student Success Center (IMC 270) at Chattanooga
State Community College, covering Biology, Microbiology, Anatomy & Physiology I (AP1) and
Anatomy & Physiology II (AP2).

Enter your tutors, check the classes each one can tutor, paint their availability, and press
**Auto-optimize**. You get a Monday–Friday, 7:00 AM–8:30 PM calendar you can print, hand out,
and post — with a QR code to tutor.com for the hours nobody is on shift.

**Live version:** https://calebhendren.github.io/scheduler/
**Offline version:** download `scheduler-local.html` from the
[latest release](https://github.com/CalebHendren/scheduler/releases) — one file, no install.

---

## Getting started

1. Open the site (or the single-file version) in any modern browser.
2. Click **Load sample roster** to see how it works, or **Add tutor** to start your own.
   The sample is ten tutors approved for 80 hours between them.
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

## Locking

A locked shift is never moved, resized or removed by **Auto-optimize**, **Auto-fit** or
**Clear schedule**. Lock the parts of the week that are settled and the buttons stay safe to
press.

- **One shift** — hover it and click the padlock in its corner, double-click it, or press `L`
  while it is focused. Locked shifts wear a dashed border and keep their padlock showing.
- **One tutor** — **Lock all** on their roster row, for the person whose hours are agreed
  while the rest of the week is still moving.
- **Everything** — **Lock all shifts** in the toolbar, once the week is finished.

Each button turns into its own undo (**Unlock all**) when everything under it is locked.

## How the schedule is built

The week is divided into 30-minute slots, Monday to Friday, 7:00 AM to 8:30 PM — 135 slots.
The optimizer builds a first schedule greedily, then spends a couple of seconds improving it
with simulated annealing. It runs in slices so the page never freezes, and **Cancel** works.

### Rules it will never break

| Rule | Default | Where to change it |
|---|---|---|
| Inside the tutor's availability | always | — |
| At most N tutors at once | 2 | Schedule settings |
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

`First, Last, Biology, Microbiology, AP1, AP2, MaxHoursPerWeek, MaxHoursPerDay,
MinHoursPerWeek, Availability, Notes`

Subject columns take `Yes`/`No`. Availability is written the way you would say it, with days
sharing the same hours grouped together:

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
  selectable text, keeps its table structure, and carries a document language. One landscape
  page for the grid, plus a plain-text listing of every shift.
- **Download PDF** — one click, no print dialog, drawn directly with jsPDF. Same landscape
  layout and real text (nothing is a screenshot), but jsPDF does not emit a tagged structure
  tree, so it is the convenience option rather than the accessible one.

Both are landscape US Letter. Printing always uses the light theme even if you are working in
dark mode. Both carry the semester, the location and contact, the QR code, a tutor legend, the
important notes, and a plain-text listing of every shift.

### What goes on the handout

**Semester** and **Important notes** are both under **Schedule settings**. The notes print in a
box under the grid — closure dates, the last day of tutoring, anything else people need to read
off the wall. The default text is the fall 2026 closure schedule; edit it for your term.

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

- Tutor colors come from the Okabe-Ito colorblind-safe palette, and every block prints the
  name, times and subjects as text — the schedule is fully readable in grayscale, and nothing
  depends on color alone.
- Beyond eight tutors, colors repeat with a diagonal hatch so the repeated pair stays distinct.
- The whole app is keyboard operable. In the availability painter, move with the arrow keys and
  toggle with Space. On a scheduled block, arrow keys move it, Shift+arrows resize it, `L`
  locks it and Delete removes it; Tab from the block reaches its padlock. Placing a shift
  without a mouse is what **Add shift** above the grid is for.
- Text contrast is checked automatically in CI, in both light and dark themes, for every color
  in the palette.

## Colors

The interface uses Chattanooga State's palette: navy `#10305F`, royal blue `#0B57BE`, the
darker `#002855` (Pantone 295) where maximum legibility matters, and orange `#FE5000` as an
accent only — it is too light for body text on white, so text that needs to be orange uses
`#C63F00` instead.

All four are defined once at the top of `assets/css/app.css`. If Marketing supplies different
values, change them there and nothing else.

Tutor block colors are deliberately *not* brand colors. Eight hues that are both on-brand and
distinguishable to a red-green colorblind reader do not exist — a navy/royal/sky family
collapses into near-identical grays. The chrome is brand; the data is colorblind-safe.

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
every palette slot, CSV round-tripping and parsing, the ten-tutor fixture with the budget both
on and off, locked shifts surviving re-optimization, back-to-back shifts coming out as one
block, fitting a single tutor without moving anyone else, and a randomized fuzz pass that
asserts no generated schedule ever breaks a hard rule.

Build the offline single file:

```bash
node tools/bundle.mjs             # writes dist/scheduler-local.html
```

### Continuous integration

- `pages.yml` runs the suite, then deploys the site to GitHub Pages on every push to `main`.
  This needs **Settings → Pages → Source → GitHub Actions** switched on once.
- `release.yml` runs the suite and builds the single-file version on every push, uploading it
  as a workflow artifact. Pushing a `v*` tag also attaches it to a GitHub release.

## License

MIT. Bundled libraries — [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
and [jsPDF](https://github.com/parallax/jsPDF) — are MIT as well.

# Analysis scheduling

Analysis is the slow part of a page view. On a long page most of it is spent on content the
reader may never reach, which is why the first Nutrient Label used to be minutes away on a
feed. Three rules, all implemented for both the local and API modes:

## Priority order

- Bigger and higher up the page first: the main article, or the top of a feed.
- Score is `log(text length) / (1 + depth in viewports)` — `content/chunk-scheduler.ts`.
  A long story beats a teaser; between two posts of the same size the higher one wins.
- The content script sends chunks in this order and the background keeps it, so the
  chunk overlay, the popup's chunk list and the console all agree on the order.

## Viewport gating

- Chunks more than 600px outside the viewport wait until they scroll into view; an
  IntersectionObserver releases them, debounced into one message per burst of scrolling.
- Off screen is deferred; unobservable is not. A chunk whose xpath resolves to nothing, or
  to a box of zero size (`display: none`, a collapsed wrapper, a canned demo chunk with no
  xpath), can never trigger an IntersectionObserver, so deferring it would drop it for
  good. Those go through immediately. Measured on a saved BBC front page: 50 chunks, 15
  analysed at once, 35 deferred, none unobservable.
- At least one chunk is always analysed, even when nothing is on screen.
- In Developer Mode the content script logs the split ("50 chunk(s) — 15 now, 35 waiting
  for a scroll"), which is the first thing to check when a label is missing.
- Off switch: Settings -> AI Model -> "Analyze what is on screen first"
  (`analyzeOnScreenFirst`). Off analyses the whole page at once, still in priority order.
- Demo pages are exempt: canned results are matched against the whole chunk list, so the
  background replies `releaseAll` and the page drops its observer.

## Passes

- One pass per batch of chunks the page hands over: it analyses what it was given plus
  anything released while it runs, then publishes a cumulative result.
- Nothing is held open between passes — an MV3 worker can be recycled while the reader
  scrolls, and the next batch rebuilds what it needs (`background.ts` addChunks).
- A superseded page (SPA navigation, reload) stops publishing: its pass finishes its trace
  but does not overwrite the page the reader is now looking at.

## Popup status

- Live counts, updated per chunk: chunks found, analysed, in progress, and waiting until
  you scroll to them.
- Progress bar covers chunk analysis (10-95%) and stays visible while chunks are waiting:
  the page is not finished, it is paused on the reader.
- Results are published per pass and re-rendered only when a newer one arrives, so the
  chunk list does not collapse under a reader who just opened it.

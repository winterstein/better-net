# Content Analysis Modal

- Open by clicking on a Nutrient Label
- Pops up to display detailed analysis of a content chunk (e.g. article section, post).
- Shows analysis results per module (fact-check, bias, risk, etc) with score, explanation, and visual indicators.
- Flags and fact-checks are surfaced where relevant.
- The Fact Checker card lists **every claim it extracted and looked up**, each with
  its outcome: the published ratings where there are any, "Not fact-checked" where
  nobody has rated the claim, "Check failed" where the lookup itself failed. Listing
  only the claims that matched left the card saying it found nothing without ever
  saying what it looked for. See specs/fact-checker.md.
- The footer's **This page** section shows the page's `page-type:…` tag
  (`specs/content-classification.md`) and lets the user correct it from a select.
  Developer Mode adds which classifier decided it, and how sure it was.
- Allows user to submit feedback on accuracy (thumbs up/down, optional note).
- Closes via 'X' button, click outside, or Esc.
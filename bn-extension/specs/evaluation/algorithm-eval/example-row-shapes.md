# Example row shapes

Illustrative only. The runner can be looser than this; the point is “one step, one file of rows”.

## `click-unbait.tag-headline`

Already close to `test-data/clickbait-headlines.json`:

```json
{
  "id": "upworthy-post-it-2026",
  "split": "ci",
  "input": {
    "headline": "Harvard psychiatrist reveals 'the fastest way to change your life' using just one Post-it note"
  },
  "expected": { "label": "bait" },
  "source": "https://www.upworthy.com/"
}
```

`label`: `bait` | `plain` | `quiz` | `unclear`.

Scores: recall on `bait`, false-positive rate on `plain`. `quiz` / `unclear` out of the floor.

## `click-unbait.extract-summary`

```json
{
  "id": "post-it-awareness",
  "split": "slow",
  "input": {
    "headline": "Harvard psychiatrist reveals 'the fastest way to change your life' using just one Post-it note",
    "articleText": "(destination body, or a fixture excerpt — not the bait title)"
  },
  "expected": {
    "mustMention": ["awareness"],
    "mustNotEchoHeadline": true,
    "maxWords": 12
  }
}
```

A setup that returns “the note says awareness” passes; one that repeats the headline fails. No single gold string required.

## `click-unbait.rewrite-or-leave`

```json
{
  "id": "leave-plain-bbc",
  "split": "ci",
  "input": {
    "headline": "Storm Eowyn: Thousands without power",
    "tag": "plain",
    "summary": null
  },
  "expected": { "rewrite": false }
}
```

## `chunking.pages`

Keep the current `*.expected.json` next to saved HTML — that *is* the dataset. Do not duplicate it into a second format unless the runner needs a thin wrapper.

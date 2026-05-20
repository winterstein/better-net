
Specifications for the ad-blocker feature:

User can override per domain in Off-List.

Video Adverts in YouTube:
 - Allows YouTube videos to play
 - Stops adverts in YouTube

Adverts in web-pages:
 - Detects advert blocks on pages
 - Removes the advert blocks

Facebook feed (`facebook.com`):
 - Detects Comet ads via `data-ad-rendering-role`, `data-ad-preview`, `data-ad-video`, plus `aria-label` / plain or letter-split "Sponsored" labels
 - Hides the enclosing feed unit (`[role="article"]`, `FeedUnit_*`, or ad post shell)
 - Hides the right-hand Sponsored sidebar (`[role="complementary"]` or panel with Sponsored heading + ad links)
 - Re-scans on DOM mutations

Generic web-pages (and platforms without a dedicated DOM scanner):
1. Chunker extracts blocks with `includeAds: true` when ad-blocker + “page ads” is on
2. `detect-chunk.js` partitions chunks (class/id/data attrs, “sponsored” text, Facebook DOM checks)
3. `hide-chunks.js` hides ad roots by xpath; non-ad chunks go to analysis
4. Facebook also keeps a mutation observer for newly loaded feed/sidebar ads

Popup (By feature list): **Show blocked** temporarily reveals hidden ads (dashed outline + label) so the user can see what was blocked; **Hide again** restores hiding. Ad blocking stays on; new ads are still hidden while previewing.

Settings is multi-page, with a left-hand nav (or hamburger menu)

Accessed via links:
 - The Browser Navbar > page menu, as the last option
 - The built-in browser extensions system

Pages:

- AI Model: bring-your-own API key, or use a local model
    - Auto-analyze pages, and whether to show Nutrient Labels at all
    - Label content rated: lowest risk band that earns a Nutrient Label
      (Everything incl. Safe / Caution and High Risk / High Risk only).
      Default is Caution, so safe chunks are left unlabelled.
- Modules: switch features on/off, and adjust their settings
    - Ad Blocker
    - Cookie Cutter
    - Privacy Shield
    - Click Unbait
    - Fact Checker
    - Bias Detector
    - Anti-manipulation
    - Ad Revenue
    - Defuse Ragebait
- Off-List: see and manage the domains where features are switched off
- Account: 
    - Your account with better:net (if you have one).
    - The better:net server endpoint for update-manager and cached anslysis
    - Use server cache: on/off toggle for reusing the server's cached analysis
- Data Sharing
    - Anonymous analysis data, usage statistics, shared fact-check cache
    - Anonymous analysis data also covers Content Analysis feedback (specs/feedback.md),
      which needs this on and a server endpoint set.
    - Send AIQA traces: on/off, plus AIQA API key, server URL, organisation and trace
      sampling (0-1). Traces page analysis, chunking and AI calls to AIQA. Off unless
      both the toggle and an API key are set.
- Advanced
    - Developer Mode: console logging, plus AIQA trace links on feedback. For developers
      and bug reports. Off by default. Was called Console logging before v0.5.
      The trace link needs the AIQA organisation below — the AIQA trace page lives under
      one, so without it the feedback confirmation shows the trace id and no link.
    - Show chunk overlay: outline every chunk the page was split into.
    - Server endpoint, and the AIQA API key / server / organisation / sampling.
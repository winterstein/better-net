
The better:net extension should have the following screens and top-level UI:

- Settings
  
- Browser Navbar: toolbar icon badge (`chrome.action`). Opens the page menu on click. Updates in realtime:
  - **Analyzing**: `…` badge (blue); full stage text in popup
  - **Done**: count of chunks neutralised (labelled below safe, or ads hidden); badge colour reflects overall risk
  - **Off**: empty badge, grey (excluded domain or extension disabled for site)

- Page menu (Popup): offer switch on/off of all/some featires for this domain, link to Settings.
  Shows the latest state live: progress bar, stage, and chunk counts — found, analysed, in
  progress, and waiting until the reader scrolls to them (`specs/analysis-scheduling.md`)

- In Page UX: the extension inserts elements into the web page that the user is viewing:
  - Nutrient Labels: icons, which can show popups with more info

# Applyra

Manifest V3 Chrome extension that reads the current page, detects form questions/fields, and drafts tailored answers using a personal data vault. Never auto-submits forms. No backend — bring your own provider API key.

## Tech Stack

- TypeScript, React, Vite with @crxjs/vite-plugin, Tailwind CSS
- IndexedDB via `idb` for vault and answer history
- chrome.storage.local for settings and API key
- LLM API via **OpenRouter** (default), **Anthropic**, **OpenAI**, **Grok (xAI)**, or **Groq**, called from the service worker only, streamed over ports

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Build the extension
npm run build

# 3. Development mode (with hot reload)
npm run dev
```

## Loading Unpacked in Chrome

1. Run `npm run build` — output goes to `dist/`
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `dist/` directory
6. Pin the extension from the toolbar

## First Use

1. Right-click the extension icon → **Options** (or navigate to the extension's options page)
2. Go to **Settings** tab
3. Choose a **Provider** — OpenRouter (default), Anthropic, OpenAI, Grok (xAI), or Groq — and enter the matching API key:
   - OpenRouter: https://openrouter.ai/keys
   - Anthropic: https://console.anthropic.com
   - OpenAI: https://platform.openai.com/api-keys
   - Grok (xAI): https://console.x.ai
   - Groq: https://console.groq.com/keys
4. Set the **Model**. The field loads the provider's catalog and filters as you type; you can also paste any model id manually.
5. Click **Test API Key** to verify it works
6. Go to **Vault** tab and add your resume, portfolio, notes, and tone samples. The add/edit form can paste text or import a PDF, DOCX, TXT, or Markdown file locally.
7. Open an application form page, click the extension icon to open the side panel, then click **Enable on this site** and grant permission. This uses a runtime per-site host permission; the extension does not run on sites you have not enabled.
8. Click **Scan Page** in the side panel (or the floating **SR** toolbar on the page), then click a highlighted field to draft an answer.

## Review, errors, and accessibility

- Drafts are never inserted by the bulk action until you approve them. The side panel shows an `Insert approved (n)` confirmation, and `Undo last insert` restores the batch.
- Failed drafts show the cause plus Retry or a deep link to Settings/Vault. The panel distinguishes bad keys, rate limits, missing vault content, timeouts, network failures, and API errors.
- Native `alert`/`confirm`/`prompt` dialogs are not used. Profile creation and deletion are inline, deleted vault items can be undone, and unsaved Settings changes trigger a discard guard before switching tabs.
- The side panel starts with a setup checklist for API key, vault contents, and site access instead of a dead-end empty state.
- Side panel and options use 12px minimum text, higher-contrast metadata, visible focus styles, 44px primary targets, `aria-live` status updates, dialog focus trapping/Escape handling, and keyboard-operable option tabs.

## Token controls

- Settings exposes a vault context budget (1,000-12,000 tokens, default 6,000) and a past-answer limit (0-10, default 3, hard-capped at 1,200 tokens of history).
- Output length is derived from the configured word limit instead of a fixed 4,096-token cap.
- The toolbar's `Draft Open-Ended…` action opens a selection dialog showing the estimated input tokens per question before any request is made.
- Retrieval is cached per page and question, and existing drafts are reused when opening a card instead of calling the model again.
- The answer card and side panel expose Stop; cancelled drafts are marked and can be redrafted.
- The side panel shows input/output token usage per answer and a session total. Provider usage is used when available, otherwise the UI marks the numbers as estimates.

## Tests

```bash
npm test        # Node test runner (retrieval, history similarity, document import)
npm run typecheck
npm run build
```

## Project Structure

```
src/
  background/     # Service worker: LLM calls to the configured provider, commands
  content/        # Frame scanner, field detector, shadow-DOM UI, panel state
  sidepanel/      # Side panel (per-question drafts, statuses, bulk insert)
  options/        # Vault manager, site profiles, and settings page
  lib/            # Shared modules
    vault.ts          # IndexedDB vault CRUD
    vaultProfile.ts   # Multiple vault profiles (active profile in chrome.storage)
    pdfText.ts      # pdfjs-dist PDF text extraction with a bundled worker
    history.ts        # IndexedDB accepted-answer history + similarity scoring
    retrieval.ts      # Local keyword/TF-IDF/feature-hashed embedding retrieval
    documentImport.ts # Local DOCX/TXT/Markdown extraction; PDF delegated to pdfText.ts
    profile.ts        # Per-site profiles (match by URL/company/job title)
    fieldDetector.ts  # Pure field detection (unit-testable)
    filler.ts         # Pure field filling (unit-testable)
    promptBuilder.ts  # System/user prompt building, documents, NEEDS INPUT helpers
    messaging.ts      # Message contracts between components (incl. streaming protocol)
test-pages/       # Sample forms for manual testing
```

## Answer Generation (Phase 3)

- **Streaming**: answers stream into the card live over a `sr_stream` runtime port
- **Tone controls**: Shorter / Longer / Casual / Formal revise the current draft
- **Sources**: vault items used for each answer are listed under the card
- **NEEDS INPUT flagging**: any missing fact the model cannot source is flagged in red and stripped from the text on Insert. Paragraph breaks and line formatting are preserved in drafts, cover letters, video scripts, and inserted text
- **Answer history**: accepted answers are saved to IndexedDB; similar past questions feed future generations as context, and near-identical ones are reused directly ("From history" badge)
- **Vault-first drafts**: a vault note whose title matches the question is offered directly ("From vault" badge) without an LLM call

## Side Panel & Shortcuts (Phase 4)

- **Side panel** (`chrome.sidePanel`): opens when you click the toolbar icon. Lists every detected question with a lifecycle status (No draft / Drafting / Draft / Inserted / Skipped / Cancelled / Error) and a separate provenance chip (Vault / History / LLM). Each card supports inline draft editing, sources, NEEDS INPUT flags, **Copy**, **Draft / Insert this answer / Regenerate / Shorter / Longer / Casual / Formal / Skip / Undo / Locate**, field details, and token/cost usage. Drafts must be explicitly approved before **Insert approved (n)** will write them to the page; bulk inserts show a confirmation count and support **Undo last insert**. Failed drafts show the cause and a recovery action (open Settings, open Vault, or Retry) while preserving the previous draft. The header shows the matched site profile and session token/cost totals.
- **Keyboard shortcuts** (`chrome.commands`):
  - `Alt+Shift+S` — scan page
  - `Alt+Shift+A` — answer the focused field
  - `Alt+Shift+I` — insert the last draft into its field
  - `Alt+Shift+O` — open the side panel
- **Per-site profiles**: Options → Profiles lets you override tone, max length, language, emphasis, and the vault profile to use. Profiles match by URL, company name, or job title; the first match wins and is applied every time a draft is generated on that page.

## Nice-to-haves (Phase 5)

- **Vault profiles**: Options → Vault has a profile bar. Create profiles such as "Product roles" and "Ops roles", switch the active one, and add/import items into it. Default is always available and cannot be deleted.
- **Profile selection on the page**: the floating **SR** menu and the side panel header both have a vault-profile selector. A selection is stored per site, so one site can use Operations while another uses Customer Success. Choose **Auto** to fall back to a matching site profile's vault mapping, then the globally active profile.
- **Automatic mapping**: Options → Profiles can bind a site profile to a vault profile. When the site profile matches the page, that vault profile is used automatically until you explicitly override it from the toolbar or side panel.
- **Cover letter & video script**: from the page toolbar menu or the side panel, generate a tailored cover letter or a short self-introduction video script from the page's job description plus the active vault. The result streams into a modal with Copy, Download `.txt`, and Save to Vault. Company, job title, and job description are taken from the page's JSON-LD `JobPosting` data when available, then from job-specific DOM selectors, so job boards do not substitute the board name for the hiring company.
- **History management**: Options → History lists saved answers with search, company and date-range filters, copy, full-answer expansion, inline-confirmed delete, pagination, and CSV export of `company,question,answer,date`.
- **Usage cost**: each answer and the session header show provider/reported tokens plus an approximate USD estimate from a local model-pricing table.
- **Local retrieval modes**: Settings → Vault retrieval selects Keyword (default), TF-IDF, or Experimental local embeddings. All run locally with no model downloads or network calls; embeddings use a dependency-free 512-dimension feature-hashed vector.

## Hardening & remaining spec gaps

- **Runtime per-site permissions**: the content script is not injected until you enable a site. Enabling registers a content script for that origin at runtime and requests its host permission; the background waits for the injected script to answer a ping, and the panel retries its first refresh, so a single click is enough. Disabling unregisters the script and tears the UI down. The manifest keeps `<all_urls>` as an optional host permission only.
- **Inline draft editing**: the answer card draft is an editable textarea. Edits are used by Insert and Copy.
- **Undo**: Insert actions can be undone from the answer card or the side panel. `filler.ts` keeps the previous value per field.
- **Iframe aggregation**: the side panel scans and lists fields from every frame it is injected into, showing the frame id when it is not the top frame. Cross-origin iframes still need their own host permission.
- **Per-answer source attribution**: history records the sources used for that field's draft, including bulk inserts.
- **Local file import**: vault items can be populated from PDF, DOCX, TXT, or Markdown. DOCX uses native ZIP/deflate parsing; PDF uses `pdfjs-dist` locally (bundled worker), so compressed streams, object streams, and font-encoded text are handled. Scanned image-only PDFs still need OCR and show a clear message. No file leaves the browser.
- **Automated tests**: `npm test` runs pure-module tests with Node's built-in test runner.
- **Shared option constants and URL-backed tabs**: tone/language lists live in `src/lib/options.ts`; options tabs reflect `#vault`, `#profiles`, `#history`, and `#settings`.
- **Dark mode**: toggle from the options or side-panel header. The choice is stored in `sr-theme` and the injected page UI (toolbar, answer card, document modal, triage dialog) listens for the same setting, so all surfaces switch together. `system` mode follows the OS preference.
- **Floating toolbar**: drag the SR button to move it anywhere in the viewport. Position is persisted and clamped on drag/resize. The container is anchored by the button corner, so the menu always expands into free space: above the button near the bottom, below it near the top, and left/right according to the nearest viewport edge.
- **Interface language**: Settings → **Interface language** selects the extension UI locale separately from the answer **Language**. The options tabs, side-panel chrome, and Settings labels use `src/lib/i18n.ts` (English + Spanish); other UI locales fall back to English while generated answers still use the selected answer language.
- **Model autocomplete**: the Model field is a combobox that loads the selected provider's model catalog (OpenRouter's public list, or the provider's `/v1/models` endpoint with your key) and filters by substring as you type, matching both model IDs and display names. Results are cached for 10 minutes; if the background worker cannot reach the catalog, the options page retries directly and falls back to built-in suggestions. The field displays the number of models loaded so a failed fetch is visible.

## Testing on Real Forms

1. Add vault items (resume, notes, tone samples) in the options page
2. Open a job application page (e.g., Greenhouse, Lever, Workday)
3. Click the extension icon, then **Enable on this site** and grant the permission
4. Click **Scan Page**; detected fields are highlighted
5. Click a field (or use the side panel) to generate a draft answer

For quick testing, serve the test pages over HTTP so runtime permissions behave normally:
```bash
python3 -m http.server 8080
# then open http://localhost:8080/test-pages/forms.html
```

## Permissions

- `storage`, `unlimitedStorage` — extension settings, vault profiles, and IndexedDB storage
- `activeTab` — read the current tab after you invoke the extension
- `tabs` — read the active tab URL so the side panel can request the right site permission (including shortcut-opened panels)
- `scripting` — register/inject the content script only for enabled sites
- `webNavigation` — enumerate frames so the side panel can aggregate iframe fields
- `sidePanel` — side panel UI
- `clipboardWrite` — copy answers
- `optional_host_permissions: <all_urls>` — requested per site when you click **Enable on this site**
- `https://api.anthropic.com/*`, `https://openrouter.ai/*`, `https://api.openai.com/*`, `https://api.x.ai/*`, `https://api.groq.com/*` — LLM API calls

## License

MIT. See [LICENSE](LICENSE).
# Pageside

A Manifest V3 Chrome extension that reads the current page, detects form questions and fields, and drafts tailored answers from a personal data vault. Every draft is reviewed before insertion, and forms are never submitted automatically. There is no backend: you bring your own provider API key.

## Features

- Detects questions and fields across frames, including shadow DOM and contenteditable elements
- Reads visible question containers instead of opaque machine field names (for example Lever's `cards[...]` names)
- Grounds drafts in your resume, portfolio, notes, and tone samples, with source attribution
- Includes a vault-backed chat for ad-hoc questions and drafts from the side panel
- Streams answers with tone revisions, inline editing, history reuse, and NEEDS INPUT flagging
- Requires explicit approval before writing to the page, with batch confirmation and undo
- Supports OpenRouter, Anthropic, OpenAI, Grok (xAI), and Groq
- Localizes the complete options experience in English and Spanish; unsupported interface locales fall back to English
- Keeps all vault, history, and settings data in the browser

## Tech Stack

- TypeScript, React, Vite with `@crxjs/vite-plugin`, Tailwind CSS
- IndexedDB via `idb` for the vault and answer history
- `chrome.storage.local` for settings and the API key
- Local document parsing with `pdfjs-dist` and native ZIP/deflate for DOCX
- Provider APIs called only from the service worker and streamed to the UI over ports

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm 10+
- Google Chrome with extensions enabled

## Setup

```bash
# Install dependencies
npm ci

# Build the extension
npm run build

# Development mode with hot reload
npm run dev
```

## Loading Unpacked in Chrome

1. Run `npm run build`; the output goes to `dist/`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist/` directory
6. Pin the extension from the toolbar

## First Use

1. Right-click the extension icon and choose **Options**, or open the extension's options page
2. Go to the **Settings** tab
3. Choose a **Provider** — OpenRouter (default), Anthropic, OpenAI, Grok (xAI), or Groq — and enter the matching API key:
   - OpenRouter: https://openrouter.ai/keys
   - Anthropic: https://console.anthropic.com
   - OpenAI: https://platform.openai.com/api-keys
   - Grok (xAI): https://console.x.ai
   - Groq: https://console.groq.com/keys
4. Set the **Model**. The field loads the provider's catalog and filters as you type; you can also paste any model ID manually.
5. Click **Test API Key** to verify the configuration
6. Go to the **Vault** tab and add your resume, portfolio, notes, and tone samples. The add/edit form accepts pasted text or a locally imported PDF, DOCX, TXT, or Markdown file.
7. Open an application form, click the extension icon to open the side panel, then click **Enable on this site** and grant permission. Access is requested per site at runtime; the extension does not run on sites you have not enabled.
8. Click **Scan Page** in the side panel (or the floating **PS** toolbar on the page), then click a highlighted field to draft an answer.

## Answer Generation

- **Question detection**: labels resolve from `label[for]`, `aria-label`/`aria-labelledby`, wrapping labels, and the visible question container used by boards such as Lever. Machine field names (`cards[...]`, UUIDs, `field0`) are never shown or sent as the question; a field whose question cannot be read shows an error instead of generating a random answer
- **Streaming**: answers stream into the card live over a `sr_stream` runtime port
- **Tone controls**: Shorter, Longer, Casual, and Formal revise the current draft
- **Sources**: vault items used for each answer are listed under the card, with expandable excerpts of the supporting passages in the page card, side panel, and chat
- **NEEDS INPUT flagging**: missing specific facts are flagged individually in red and stripped from the text on insert. Paragraph breaks and line formatting are preserved in drafts, cover letters, video scripts, and inserted text
- **Answer history**: accepted answers are saved to IndexedDB; similar past questions feed future generations as context, and near-identical ones are reused directly with a "From history" badge
- **Vault-first drafts**: a vault note whose title matches the question is offered directly with a "From vault" badge, without an LLM call

## Chat

- The side panel switches between **Questions** and **Chat**
- Chat answers free-form questions with the same local vault retrieval and provider streaming as drafts
- Replies use the current page context (company, role, job description) when site access is enabled, and fall back to the active tab's title and URL otherwise, so chat works on sites you have not enabled
- Each reply lists the vault sources it used and shows token/cost usage; replies can be stopped and the conversation can be cleared
- By default, chat stays in the side panel session and is not saved. Optional session recovery stores drafts and chat in local extension storage and restores them for the same page. Recovered answers are never approved automatically; drafts whose field identity, selector, or current value changed must be explicitly reviewed before insertion. Disabling recovery clears saved sessions.

## Local Data & Privacy

- Options → Settings shows counts for locally stored vault items, accepted-answer history, saved page sessions, and provider/answer settings.
- Clear vault, history, saved sessions, and provider/answer settings independently. Each destructive action requires an inline confirmation; clearing settings also removes the API key. Clearing saved sessions turns recovery off.
- Vault and history live in extension IndexedDB. Settings, API keys, and opt-in recovery live in `chrome.storage.local`. They are kept in the current browser profile, but Pageside does not encrypt local data.
- The standard Vault JSON export remains plaintext; use **Export encrypted** for a password-protected backup. Passwords are not stored or recoverable, and imports merge items into the active vault profile.

## Review, Errors, and Accessibility

- Drafts are never inserted by the bulk action until you approve them. The side panel shows an **Insert approved (n)** confirmation, and **Undo last insert** restores the batch.
- Failed drafts show the cause plus Retry or a deep link to Settings or Vault. The panel distinguishes bad keys, rate limits, missing vault content, timeouts, network failures, and API errors.
- Native `alert`, `confirm`, and `prompt` dialogs are not used. Profile creation and deletion are inline, deleted vault items can be undone, and unsaved Settings changes trigger a discard guard before switching tabs.
- The side panel starts with a setup checklist for the API key, vault contents, and site access instead of a dead-end empty state.
- The side panel and options page use 12px minimum text, higher-contrast metadata, visible focus styles, 44px primary targets, `aria-live` status updates, dialog focus trapping and Escape handling, and keyboard-operable option tabs.

## Side Panel & Shortcuts

- **Side panel** (`chrome.sidePanel`): opens when you click the toolbar icon. It lists every detected question with a lifecycle status (No draft, Drafting, Draft, Inserted, Skipped, Cancelled, Error) and a separate provenance chip (Vault, History, LLM). Each card supports inline draft editing, sources, NEEDS INPUT flags, **Copy**, **Draft**, **Insert this answer**, **Regenerate**, tone revisions, **Skip**, **Undo**, **Locate**, field details, and token/cost usage. Drafts must be explicitly approved before **Insert approved (n)** writes them to the page; bulk inserts show a confirmation count and support **Undo last insert**. Failed drafts preserve the previous draft and show a recovery action. The header shows the matched site profile and session token/cost totals.
- **Keyboard shortcuts** (`chrome.commands`):
  - `Alt+Shift+S` — scan page
  - `Alt+Shift+A` — answer the focused field
  - `Alt+Shift+I` — insert the last draft into its field
  - `Alt+Shift+O` — open the side panel
- **Per-site profiles**: Options → Profiles overrides tone, max length, language, emphasis, and the vault profile for a site. Profiles match by URL, company name, or job title; the first match wins and is applied whenever a draft is generated on that page.

## Vault Profiles & Documents

- **Vault profiles**: Options → Vault has a profile bar. Create profiles such as "Product roles" and "Ops roles", switch the active one, and add or import items into it. The default profile is always available and cannot be deleted.
- **Vault backups**: Export either the existing plaintext JSON or a password-encrypted JSON backup of the active profile. Encrypted backups use PBKDF2-SHA-256 and AES-256-GCM in the browser; use a passphrase of at least 12 characters. The passphrase is never stored, and losing it makes the backup unrecoverable. Importing adds items to the active profile and does not replace existing items. Encrypted backups support up to 50 MB of vault data; backup import files are capped at 70 MB.
- **Profile selection on the page**: the floating **PS** menu and the side panel header both include a vault-profile selector. The selection is stored per site, so one site can use Operations while another uses Customer Success. Choose **Auto** to fall back to a matching site profile's vault mapping, then to the globally active profile.
- **Automatic mapping**: Options → Profiles can bind a site profile to a vault profile. When the site profile matches the page, that vault profile is used automatically until you override it from the toolbar or side panel.
- **Cover letters and video scripts**: from the page toolbar menu or the side panel, generate a tailored cover letter or a short self-introduction video script from the page's job description plus the active vault. The result streams into a modal with Copy, Download `.txt`, and Save to Vault. Company, job title, and job description come from JSON-LD `JobPosting` data when available, then from job-specific DOM selectors, so job boards do not substitute the board name for the hiring company.

## History, Cost & Retrieval

- **History management**: Options → History lists saved answers with search, company and date-range filters, copy, full-answer expansion, inline-confirmed delete, pagination, and CSV export of `company,question,answer,date`.
- **Usage cost**: each answer and the session header show provider-reported or estimated tokens plus an approximate USD estimate from a local model-pricing table.
- **Local retrieval modes**: Settings → Vault retrieval selects Keyword (default), TF-IDF, or Experimental local embeddings. All modes run locally with no model downloads or network calls; embeddings use a dependency-free 512-dimension feature-hashed vector.

## Cost & Context Controls

- Settings exposes a vault context budget (1,000–12,000 tokens, default 6,000) and a past-answer limit (0–10, default 3, hard-capped at 1,200 tokens of history).
- Output length is derived from the configured word limit instead of a fixed 4,096-token cap.
- The toolbar's **Draft Open-Ended…** action opens a selection dialog showing the estimated input tokens per question before any request is made.
- Retrieval is cached per page and question, and existing drafts are reused when opening a card instead of calling the model again.
- The answer card and side panel expose Stop; cancelled drafts are marked and can be redrafted.
- The side panel shows input and output token usage per answer and a session total. Provider usage is used when available; otherwise the UI marks the values as estimates.

## Customization

- **Dark mode**: toggle from the options or side-panel header. The choice is stored in `sr-theme`, and the injected page UI (toolbar, answer card, document modal, triage dialog) listens for the same setting so all surfaces switch together. `system` follows the OS preference.
- **Interface language**: Settings → **Interface language** selects the extension UI locale separately from the answer **Language**. The options tabs, side-panel chrome, and Settings labels use `src/lib/i18n.ts` (English and Spanish); other UI locales fall back to English while generated answers still use the selected answer language.
- **Floating toolbar**: drag the **PS** button to move it anywhere in the viewport. The position is persisted and clamped on drag or resize. The menu is anchored to the button corner, so it always expands into free space.
- **Model autocomplete**: the Model field is a combobox that loads the selected provider's model catalog (OpenRouter's public list, or the provider's `/v1/models` endpoint with your key) and filters by substring as you type, matching both model IDs and display names. Results are cached for 10 minutes; if the background worker cannot reach the catalog, the options page retries directly and falls back to built-in suggestions. The field displays the number of models loaded so a failed fetch is visible.

## Reliability & Data Handling

- **Runtime per-site permissions**: the content script is not injected until you enable a site. Enabling registers a content script for that origin at runtime and requests its host permission; the background waits for the injected script to answer a ping, and the panel retries its first refresh, so a single click is enough. Enabled origins are stored locally and re-registered when the service worker starts. Disabling unregisters the script, forgets the origin, and tears down the UI. The manifest keeps `<all_urls>` as an optional host permission only. Reloading an unpacked extension or installing an update can make Chrome drop runtime-granted optional host permissions, so a re-prompt after a developer reload is expected; the extension still remembers enabled origins and restores their content scripts once permission is available.
- **Iframe aggregation**: the side panel scans and lists fields from every frame it is injected into, showing the frame ID when it is not the top frame. Cross-origin iframes still need their own host permission.
- **Local file import**: vault items can be populated from PDF, DOCX, TXT, or Markdown. DOCX uses native ZIP/deflate parsing; PDF uses `pdfjs-dist` locally with a bundled worker, so compressed streams, object streams, and font-encoded text are handled. Scanned image-only PDFs still need OCR and show a clear message. No file leaves the browser.
- **Data boundaries**: the API key is available only to the service worker and options page, never to content scripts or page context. Vault data is sent only to the configured provider, and there is no analytics, remote code, or third-party server.

## Project Structure

```
src/
  background/     # Service worker: provider calls, commands, streaming
  content/        # Frame scanner, field detector, shadow-DOM UI, page state
  sidepanel/      # Side panel with per-question drafts, statuses, and bulk insert
  options/        # Vault manager, site profiles, history, and settings
  components/     # Shared React components
  lib/            # Shared modules
    answerText.ts     # NEEDS INPUT cleanup with whitespace preservation
    chatPrompt.ts     # Vault-grounded chat system and user prompts
    documentImport.ts # Local DOCX/TXT/Markdown extraction
    errors.ts         # Error taxonomy and recovery actions
    fieldDetector.ts  # Pure field detection (unit-testable)
    filler.ts         # Pure field filling (unit-testable)
    history.ts        # IndexedDB answer history and similarity scoring
    i18n.ts           # UI locale strings
    messaging.ts      # Typed message contracts, including the streaming protocol
    options.ts        # Shared tone and language constants
    pdfText.ts        # Local PDF text extraction with a bundled worker
    profile.ts        # Per-site profiles matched by URL, company, or job title
    promptBuilder.ts  # Prompt construction, documents, and NEEDS INPUT helpers
    provider.ts       # Provider request and streaming adapters
    retrieval.ts      # Local keyword, TF-IDF, and feature-hashed embedding retrieval
    theme.ts          # Shared theme setting
    usage.ts          # Token budgets, estimates, and usage normalization
    vault.ts          # IndexedDB vault CRUD
    vaultProfile.ts   # Multiple vault profiles and the active profile
test-pages/       # Sample forms for manual testing
tests/            # Node test runner suites
```

## Development

```bash
npm test        # Node test runner
npm run quality-check # deterministic prompt/retrieval/provider regression scenarios
npm run typecheck
npm run build
```

`npm test` covers retrieval, history similarity, document import, field detection, prompt building, error mapping, provider handling, usage budgets, and recovery bounds. `npm run quality-check` runs synthetic grounding, missing-fact, field-classification, output-budget, and request-shape scenarios across all configured providers. It uses no real vault data and makes no network requests.

## Testing on Real Forms

1. Add vault items (resume, notes, tone samples) in the options page
2. Open a job application page (for example Greenhouse, Lever, or Workday)
3. Click the extension icon, then **Enable on this site** and grant the permission
4. Click **Scan Page**; detected fields are highlighted
5. Click a field, or use the side panel, to generate a draft answer
6. On Lever-style forms, confirm the side panel shows the visible question (for example "Why do you want to work at Acme?") instead of the `cards[...]` field name. `test-pages/forms.html` section 9 reproduces this layout
7. Switch the side panel to **Chat** and ask a question; chat works with or without site access because it uses the vault plus the active tab's title/URL
8. Enable **Save drafts and chat on this device** in the side panel, draft an answer on test page section 10, change or move the question, then rescan. The draft must be marked stale and cannot be inserted until reviewed. Remove the field and verify the draft is not restored into another field.
9. In Options → Vault, create an encrypted backup with a test passphrase of 12+ characters. Confirm the downloaded JSON does not contain the sample vault text, then import it into a temporary profile. Verify a wrong passphrase is rejected and a correct passphrase merges the item into the active profile.

For quick testing, serve the test pages over HTTP so runtime permissions behave normally:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/test-pages/forms.html
```

## Permissions

- `storage`, `unlimitedStorage` — extension settings, vault profiles, and IndexedDB storage
- `activeTab` — read the current tab after you invoke the extension
- `tabs` — read the active tab URL so the side panel can request the right site permission, including for shortcut-opened panels
- `scripting` — register or inject the content script only for enabled sites
- `webNavigation` — enumerate frames so the side panel can aggregate iframe fields
- `sidePanel` — side panel UI
- `clipboardWrite` — copy answers
- `optional_host_permissions: <all_urls>` — requested per site when you click **Enable on this site**
- `https://api.anthropic.com/*`, `https://openrouter.ai/*`, `https://api.openai.com/*`, `https://api.x.ai/*`, `https://api.groq.com/*` — provider API calls

## License

MIT. See [LICENSE](LICENSE).

# Apps and connectors

[Back to the README](../README.md)

Hearth can read your apps when you ask, for example "what's my next meeting?" or "anything new in Linear?". It can never write to them.

## Signing in

- **Hosted MCP servers** (Notion, Linear, Atlassian, Todoist, Sentry, Vercel): on the Apps page, click **Sign in** and finish in your browser.
- **Servers that use a key** (GitHub, Linkup, your own): paste the key on the Apps page. For GitHub, use a read-only token.
- **Your own servers:** add any HTTP MCP server on the Apps page, or list stdio and HTTP servers in `mcp.json`: in the project folder when you run from source, or in Hearth's user data folder for an installed build (see [Installed builds](setup.md#installed-builds)). See `mcp.example.json` for the format.

Tokens and keys are stored encrypted with Electron `safeStorage`, which uses DPAPI on Windows, the Keychain on macOS and your keyring on Linux.

Servers you start from `mcp.json` (stdio servers) don't inherit Hearth's environment, so they never see the API keys in your `.env`. They get only the basics, such as `PATH` and your home and temp folders. Put anything else a server needs under its `env` in `mcp.json`.

## The read-only gate

Every tool is blocked unless Hearth can tell it only reads ([`src/main/mcp.ts`](../src/main/mcp.ts)). A tool is allowed when:

1. `mcp.json` lists it in the server's `allowTools`, or
2. the server marks it read-only (`readOnlyHint`) and not destructive, or
3. the server doesn't say either way, and its name has a read word (get, list, search, find, fetch, read, query, describe, lookup, view, show, count, retrieve or whoami) and no write word (such as send, create, update, delete, save, complete, mark, move, copy, clear, share or resolve).

Everything else is blocked, including any tool the server marks destructive or not read-only. Names are split on `_`, `-`, camelCase and capital runs, so `SENDMessage` reads as send and message. Words are matched whole, so a name like `sendmail` has no read word and is blocked. `download` doesn't count as a read word, because some servers save the file to disk.

The Apps page lists each tool, with the reason it was allowed or blocked. In `mcp.json`, `allowTools` allows a tool that the gate blocks, and `requireReadOnlyHint: true` makes the gate stricter: only tools the server marks read-only get through.

Tool calls time out after 30 seconds and stop when you interrupt Hearth. If a request fails before it reaches the server, Hearth tries once more. It never repeats a tool call that may have reached the server.

## Gmail, Calendar and Drive through Composio

Composio holds the Google sign-in, so you don't need a Google Cloud project ([`src/main/composio.ts`](../src/main/composio.ts)).

1. In the [Composio dashboard](https://dashboard.composio.dev), choose **Platform**, open your project, then **Settings > API Keys > Create API Key**. Give it these permissions and nothing else:
   - **Session management:** Read and write
   - **Session tool execution:** Write only
   - **Connected accounts:** Read and write

   The For You key (`ck_...`) doesn't work here.
2. Put the key (`ak_...`) in `COMPOSIO_API_KEY` and restart Hearth.
3. On the Apps page, click **Sign in** next to Gmail, Google Calendar or Google Drive.

The Composio session covers only Gmail, Google Calendar and Google Drive, and only tools that Composio tags read-only and not create, update or destructive. Composio sets those tags on a best-effort basis, so Hearth also runs every Composio tool name through the same read-word and write-word check as MCP tools, both the tools it gives the model and each tool the model asks Composio to run. For example, `GOOGLECALENDAR_EVENTS_LIST` is allowed, and `GOOGLECALENDAR_CLEAR_CALENDAR` and `GOOGLEDRIVE_COPY_FILE` are blocked.

Google's sign-in screen asks for more access than Hearth uses, such as full Gmail. Hearth can still only use the read tools.

Hearth runs only Gmail, Calendar and Drive tools, so Composio's paid **Instant Toolkits** stay unused. If Composio ever charges for a call, the charge shows in the Timeline.

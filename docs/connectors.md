# Apps and connectors

[Back to the README](../README.md)

Hearth can read your apps when you ask, for example "what's my next meeting?" or "anything new in Linear?". It can never write to them.

## Signing in

- **Hosted MCP servers** (Notion, Linear, Atlassian, Todoist, Sentry, Vercel): on the Apps page, click **Sign in** and finish in your browser.
- **Servers that use a key** (GitHub, Linkup, your own): paste the key on the Apps page. For GitHub, use a read-only token.
- **Your own servers:** add any HTTP MCP server on the Apps page, or list stdio and HTTP servers in `mcp.json` in the project folder. See `mcp.example.json`.

Tokens and keys are stored encrypted with Electron `safeStorage`, which uses DPAPI on Windows, the Keychain on macOS and your keyring on Linux.

## The read-only gate

Every tool is blocked unless it looks read-only. Hearth blocks a tool when:

- the server marks it destructive or not read-only, or
- its name contains a write verb such as send, create, update or delete.

The Apps page lists each tool, with the reason it was allowed or blocked. In `mcp.json`, `allowTools` allows a tool explicitly, and `requireReadOnlyHint` makes the gate stricter.

## Gmail, Calendar and Drive through Composio

Composio holds the Google sign-in, so you don't need a Google Cloud project ([`src/main/composio.ts`](../src/main/composio.ts)).

1. In the [Composio dashboard](https://dashboard.composio.dev), choose **Platform**, open your project, then **Settings > API Keys > Create API Key**. Give it these permissions and nothing else:
   - **Session management:** Read and write
   - **Session tool execution:** Write only
   - **Connected accounts:** Read and write

   The For You key (`ck_...`) doesn't work here.
2. Put the key (`ak_...`) in `COMPOSIO_API_KEY` and restart Hearth.
3. On the Apps page, click **Sign in** next to Gmail, Google Calendar or Google Drive.

The Composio session turns off every tool tagged create, update or destructive. Hearth also checks each tool it runs against the same write-verb list.

Google's sign-in screen asks for more access than Hearth uses, such as full Gmail. Hearth can still only use the read tools.

If you turn on **Instant Toolkits** in Composio, its paid web tools use your Composio credits. Each charge shows in the Timeline.

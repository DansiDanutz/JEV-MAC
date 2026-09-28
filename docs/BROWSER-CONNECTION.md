# Connect Chrome, Codex or another local browser

1. Double-click `Start JEV-MAC.command` to unlock the default browser.
2. In that dashboard, open **Settings → Create connection code**.
3. In the other browser, open the same loopback URL and enter the code under
   **Connect this browser**. Do not paste codes into chats or share them.

The 16-character random code expires in two minutes, works once and is invalidated
after five failed attempts. Creating a new code replaces the old one. Codes remain
in memory only; restart invalidates codes and browser sessions. Authentication
failure returns the UI to the connection screen.

Only an authenticated dashboard browser can issue codes. Agent tokens cannot.
Redemption requires the exact loopback Host, matching Origin, POST and bounded
JSON. It grants the same dashboard session access, not new file-operation powers;
immutable plans and explicit approvals are still enforced. No API key is exposed.
This is not persistent sign-in or a remote sharing service.

# SubnetPoll.xyz

Public static dashboard for the Discord prompt:

> Miners, thumbs up 👍 if this subnet is legit and 👎 if this subnet is bunk.

Open `index.html` in a browser to see the dashboard. It reads `data.js`, so it also works from `file://` without a build step.

## Public Release

The site is packaged for `https://subnetpoll.xyz/` with:

- `CNAME` for GitHub Pages custom-domain hosting.
- `robots.txt` and `sitemap.xml` for indexing.
- `site.webmanifest`, `favicon.svg`, and `og-card.svg` for public link previews and install metadata.
- `_headers` for static host security headers and no-cache reaction data.

The dashboard itself is intentionally build-free. Deploy the repository root to any static host and point `subnetpoll.xyz` at that host. Keep `data.js` uncached or cache-busted so refreshed Discord counts appear quickly.

Before publishing, run:

```sh
npm run check
```

That validates the frontend scripts and scans the repo for Discord-token-like secrets.

## Secret Safety

The public site must never contain a Discord token. Keep tokens in a local `.env` file or host secret manager only. This repo includes `.env.example` for the expected variable names, and `.gitignore` blocks real `.env`, `.token`, `.secret`, and `secrets/` files.

If a token is pasted into chat, terminal output, Git history, or any public page, rotate it in the Discord Developer Portal before using it again.

## Current Export

I harvested the Discord search results from Chrome into:

- `exports/subnet-message-links.json`
- `exports/subnet-message-links.csv`
- `exports/subnet-message-links-unique.json`
- `exports/subnet-message-links-unique.csv`

The raw export has 132 exact message links. Four subnet channels had the exact prompt twice, so the unique export keeps the newest message per channel and has 128 subnet rows.

Because this user is not an admin in the Bittensor server, the bot could not be added to the private subnet channels. Reaction counts were scraped read-only through the logged-in Chrome Discord UI instead:

- `exports/subnet-reactions-scraped.json`
- `exports/subnet-reactions-scraped.csv`

The dashboard is currently loaded from this scraped reaction export.

Reliquary (`ᚠ・reliquary・81`) was rechecked directly in Chrome on 2026-05-25 and corrected to 16 👍 / 0 👎. Its first pass had the link but missed the visible reaction badge.

The remaining 36 apparent `0/0` rows were then rechecked through the exact Discord message links in Chrome. That second pass found 21 scrape misses and 15 messages with no visible 👍/👎 reactions. The audit export is `exports/zero-reaction-rescrape.json`.

A stricter target-scoped pass was run on those 15 rows using the exact Discord DOM id for each message. That found 14 more missed rows and left only `ђ・minoτaur・112` at `0/0` on the target prompt. The final audit export is `exports/zero-reaction-targeted-final.json`.

## Best Refresh Workflow

Use `exports/subnet-message-links-unique.json` as the stable manifest. Do not search all channels on every refresh; that is slower and creates duplicate-message risk. Only rerun Discord search when new subnet channels are added or the original prompt changes.

Best case: use a bot that can view the target channels and fetch exact message IDs from the manifest. That is the cleanest and most reliable path because each refresh is just 128 direct message reads.

Current practical path without admin access: refresh from logged-in Chrome by opening each known message URL, waiting for the target message, and parsing visible reaction button `aria-label` values like `thumbsup, 16 reactions`. Save `scrapeStatus` per row, checkpoint results every few links, and keep the previous count when a page load fails. For any `0/0` row, do a second focused pass before trusting it as real zero volume.

## Load Real Discord Counts

Create a Discord bot that can view the server channels and read message history. If the script needs to discover matching messages by text, enable Message Content Intent for the bot too.

Fast path, using the harvested message links:

```sh
DISCORD_TOKEN="Bot <token>" \
LINKS="exports/subnet-message-links-unique.json" \
node scripts/fetch-reactions.mjs
```

Fallback path, scanning channels by text:

```sh
DISCORD_TOKEN="Bot <token>" \
DISCORD_MESSAGE_URL="https://discord.com/channels/799672011265015819/1371902705605546075/1508073660659929219" \
node scripts/fetch-reactions.mjs
```

That overwrites `data.js` with the current 👍 and 👎 counts for matching messages across text channels in the guild.

Useful options:

```sh
SCAN_LIMIT=300                      # messages scanned per channel
CHANNEL_IDS="123,456,789"           # restrict to known subnet channels
MATCH_TEXT="Miners, thumbs up..."   # use when the bot cannot read the source content
MATCH_AUTHOR=false                  # match by text only
OUT="data.js"                       # output path
```

The frontend updates automatically the next time you refresh `index.html`.

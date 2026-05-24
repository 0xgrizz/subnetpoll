# ThumbsFlow.io

Public static dashboard for the Discord prompt:

> Miners, thumbs up 👍 if this subnet is legit and 👎 if this subnet is bunk.

Open `index.html` in a browser to see the dashboard. It reads `data.js`, so it also works from `file://` without a build step.
The page also reads `market-data.js` for current Finney metagraph metrics: TAO flow and owner/burn-coldkey emission share.

## Public Release

The site is packaged for `https://thumbsflow.io/` with:

- `CNAME` for GitHub Pages custom-domain hosting.
- `robots.txt` and `sitemap.xml` for indexing.
- `site.webmanifest`, `favicon.svg`, and `og-card.svg` for public link previews and install metadata.
- `_headers` for static host security headers and no-cache reaction data.

The dashboard itself is intentionally build-free. Deploy the repository root to any static host and point `thumbsflow.io` at that host. Keep `data.js` and `market-data.js` uncached or cache-busted so refreshed Discord counts and metagraph metrics appear quickly.

Live release:

- GitHub: <https://github.com/0xgrizz/subnetpoll>
- Vercel production: <https://subnetpoll.vercel.app>
- Primary domain: <https://thumbsflow.io>

Custom domain status:

- `thumbsflow.io` is attached to the Vercel project.
- `www.thumbsflow.io` is attached to the Vercel project.
- DNS is still controlled by Cloudflare nameservers. Add the Vercel-recommended DNS records in Cloudflare:
  - `A thumbsflow.io 76.76.21.21`
  - `A www.thumbsflow.io 76.76.21.21`

Before publishing, run:

```sh
npm run check
```

That validates the frontend scripts and scans the repo for Discord-token-like secrets.

Refresh market data with:

```sh
npm run refresh:market
```

That pulls TAO flow with `Subtensor.get_all_ema_tao_inflow()` and metagraph rows with `Subtensor.get_all_metagraphs_info()`. If the bulk metagraph RPC times out, the script falls back to `Subtensor.get_metagraph_info(netuid)` for every subnet and writes:

- `market-data.js`
- `exports/subnet-market-data-latest.json`
- `exports/subnet-market-data-latest.csv`

`burnEmissionPct` is computed as the subnet owner coldkey's share of total metagraph emission for that subnet.

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

Because this user is not an admin in the Bittensor server, the bot could not be added to the private subnet channels. Reaction counts are scraped read-only through the logged-in Chrome Discord UI instead.

Current live dashboard data was refreshed on 2026-05-24 at 18:41 UTC with exact target-message DOM scoping:

- `exports/subnet-reactions-latest.json`
- `exports/subnet-reactions-latest.csv`
- `exports/subnet-reactions-refreshed-2026-05-24T18-41-37-656Z.json`
- `exports/subnet-reactions-refreshed-2026-05-24T18-41-37-656Z.csv`

Latest totals: 128 exact links verified, 1,089 👍, 586 👎, 1,675 total thumbs, 67 legit-leading subnets, 41 bunk-leading subnets, 2 flat subnets, and 18 target messages with no visible thumbs.

Historical scrape/audit exports are kept for traceability:

- `exports/subnet-reactions-scraped.json`
- `exports/subnet-reactions-scraped.csv`

Reliquary (`ᚠ・reliquary・81`) was rechecked directly in Chrome on 2026-05-25 and corrected to 16 👍 / 0 👎. Its first pass had the link but missed the visible reaction badge.

The remaining 36 apparent `0/0` rows were then rechecked through the exact Discord message links in Chrome. That second pass found 21 scrape misses and 15 messages with no visible 👍/👎 reactions. The audit export is `exports/zero-reaction-rescrape.json`.

A stricter target-scoped pass was run on those 15 rows using the exact Discord DOM id for each message. That found 14 more missed rows and left only `ђ・minoτaur・112` at `0/0` in that audit export. The historical audit export is `exports/zero-reaction-targeted-final.json`.

## Best Refresh Workflow

Use `exports/subnet-message-links-unique.json` as the stable manifest. Do not search all channels on every refresh; that is slower and creates duplicate-message risk. Only rerun Discord search when new subnet channels are added or the original prompt changes.

Best case: use a bot that can view the target channels and fetch exact message IDs from the manifest. That is the cleanest and most reliable path because each refresh is just 128 direct message reads.

Current practical path without admin access: refresh from logged-in Chrome by opening each known message URL, waiting for `#chat-messages-{channelId}-{messageId}`, and parsing visible reaction button `aria-label` values like `thumbsup, 16 reactions` only inside that exact message container. Save `scrapeStatus` per row, checkpoint results every few links, and never treat a missing target container as `0/0`.

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

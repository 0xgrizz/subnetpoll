#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const API_BASE = "https://discord.com/api/v10";
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const DEFAULT_URL = "https://discord.com/channels/799672011265015819/1371902705605546075/1508073660659929219";

const options = parseArgs(process.argv.slice(2));
const token = process.env.DISCORD_TOKEN;
const sourceUrl = options.messageUrl || process.env.DISCORD_MESSAGE_URL || DEFAULT_URL;
const outputPath = options.out || process.env.OUT || "data.js";
const linksPath = options.links || process.env.LINKS;
const scanLimit = Number(options.scanLimit || process.env.SCAN_LIMIT || 150);
const explicitChannelIds = splitCsv(options.channelIds || process.env.CHANNEL_IDS);
const matchAuthor = String(options.matchAuthor || process.env.MATCH_AUTHOR || "true") !== "false";
const manualMatchText = options.matchText || process.env.MATCH_TEXT;

if (!token) {
  exitWithHelp("Missing DISCORD_TOKEN.");
}

const sourceIds = parseDiscordMessageUrl(sourceUrl);
if (!sourceIds) {
  exitWithHelp("DISCORD_MESSAGE_URL must be a Discord message URL.");
}

const authHeader = token.startsWith("Bot ") || token.startsWith("Bearer ")
  ? token
  : `Bot ${token}`;

const linkExport = linksPath ? await readLinkExport(linksPath) : null;
const sourceMessage = linkExport ? null : await discordFetch(`/channels/${sourceIds.channelId}/messages/${sourceIds.messageId}`);
const targetContent = manualMatchText ||
  linkExport?.sourceMessage?.content ||
  sourceMessage?.content ||
  "Miners, thumbs up 👍 if this subnet is legit and 👎 if this subnet is bunk.";

if (!targetContent && !linkExport) {
  exitWithHelp("Could not read message content. Enable Message Content Intent for the bot or pass MATCH_TEXT.");
}

const matches = [];

if (linkExport) {
  for (const row of linkExport.rows) {
    const message = await discordFetch(`/channels/${row.channelId}/messages/${row.messageId}`);
    matches.push(toReactionRow(sourceIds.guildId, {
      id: row.channelId,
      name: row.channelName || row.subnet || row.channelId
    }, message));
  }
} else {
  const channels = explicitChannelIds.length > 0
    ? explicitChannelIds.map((id) => ({ id, name: id, type: 0 }))
    : await getGuildTextChannels(sourceIds.guildId);

  for (const channel of channels) {
    const match = await findMatchingMessage(channel, sourceMessage, targetContent);
    if (match) {
      matches.push(toReactionRow(sourceIds.guildId, channel, match));
    }
  }
}

const payload = {
  isDemo: false,
  updatedAt: new Date().toISOString(),
  sourceMessage: {
    authorName: sourceMessage?.author?.global_name ||
      sourceMessage?.author?.username ||
      linkExport?.sourceMessage?.authorName ||
      "consτ",
    authorId: sourceMessage?.author?.id || linkExport?.sourceMessage?.authorId,
    guildId: sourceIds.guildId,
    channelId: linkExport?.sourceMessage?.channelId || sourceIds.channelId,
    messageId: linkExport?.sourceMessage?.messageId || sourceIds.messageId,
    url: linkExport?.sourceMessage?.url || sourceUrl,
    content: targetContent
  },
  items: matches
};

await writeFile(outputPath, `window.REACTION_DATA = ${JSON.stringify(payload, null, 2)};\n`);

console.log(`Wrote ${matches.length} subnet reaction rows to ${outputPath}`);

function parseArgs(args) {
  const parsed = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--message-url") {
      parsed.messageUrl = next;
      i += 1;
    } else if (arg === "--out") {
      parsed.out = next;
      i += 1;
    } else if (arg === "--links") {
      parsed.links = next;
      i += 1;
    } else if (arg === "--scan-limit") {
      parsed.scanLimit = next;
      i += 1;
    } else if (arg === "--channel-ids") {
      parsed.channelIds = next;
      i += 1;
    } else if (arg === "--match-author") {
      parsed.matchAuthor = next;
      i += 1;
    } else if (arg === "--match-text") {
      parsed.matchText = next;
      i += 1;
    }
  }

  return parsed;
}

async function readLinkExport(path) {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.results || parsed.items || [];

  return {
    sourceMessage: parsed.sourceMessage,
    rows: rows.map((row) => {
      const parsedUrl = parseDiscordMessageUrl(row.messageUrl || row.url || "");
      return {
        channelName: row.channelName || row.subnet || "",
        channelId: row.channelId || parsedUrl?.channelId,
        messageId: row.messageId || parsedUrl?.messageId
      };
    }).filter((row) => row.channelId && row.messageId)
  };
}

function splitCsv(value) {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseDiscordMessageUrl(url) {
  const match = String(url).match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;

  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3]
  };
}

async function getGuildTextChannels(guildId) {
  const channels = await discordFetch(`/guilds/${guildId}/channels`);
  return channels
    .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

async function findMatchingMessage(channel, sourceMessage, targetContent) {
  if (channel.id === sourceIds.channelId) {
    return sourceMessage;
  }

  let before;
  let scanned = 0;

  while (scanned < scanLimit) {
    const limit = Math.min(100, scanLimit - scanned);
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);

    let messages;
    try {
      messages = await discordFetch(`/channels/${channel.id}/messages?${params.toString()}`);
    } catch (error) {
      console.warn(`Skipping #${channel.name || channel.id}: ${error.message}`);
      return null;
    }

    if (!messages.length) return null;

    const match = messages.find((message) => {
      const sameAuthor = !matchAuthor || message.author?.id === sourceMessage.author?.id;
      return sameAuthor && normalizeText(message.content) === normalizeText(targetContent);
    });

    if (match) return match;

    scanned += messages.length;
    before = messages[messages.length - 1].id;

    if (messages.length < limit) return null;
  }

  return null;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toReactionRow(guildId, channel, message) {
  const up = countEmoji(message.reactions, new Set(["👍", "thumbsup", "+1"]));
  const down = countEmoji(message.reactions, new Set(["👎", "thumbsdown", "-1"]));

  return {
    subnet: prettifyChannelName(channel.name || channel.id),
    channelName: channel.name || channel.id,
    channelId: channel.id,
    messageId: message.id,
    messageUrl: `https://discord.com/channels/${guildId}/${channel.id}/${message.id}`,
    up,
    down,
    reactions: (message.reactions || []).map((reaction) => ({
      emoji: reaction.emoji?.name || reaction.emoji?.id || "unknown",
      count: reaction.count || 0
    }))
  };
}

function countEmoji(reactions, names) {
  if (!Array.isArray(reactions)) return 0;

  return reactions.reduce((sum, reaction) => {
    const name = reaction.emoji?.name;
    return names.has(name) ? sum + Number(reaction.count || 0) : sum;
  }, 0);
}

function prettifyChannelName(name) {
  return String(name)
    .replace(/^#/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function discordFetch(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: authHeader,
      "User-Agent": "subnet-reaction-board/1.0"
    }
  });

  if (response.status === 429) {
    const rateLimit = await response.json();
    const waitMs = Math.ceil(Number(rateLimit.retry_after || 1) * 1000);
    await sleep(waitMs);
    return discordFetch(path);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 240)}`);
  }

  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exitWithHelp(message) {
  console.error(message);
  console.error("");
  console.error("Usage:");
  console.error("  DISCORD_TOKEN='Bot <token>' DISCORD_MESSAGE_URL='<message-url>' node scripts/fetch-reactions.mjs");
  console.error("  DISCORD_TOKEN='Bot <token>' LINKS='exports/subnet-message-links.json' node scripts/fetch-reactions.mjs");
  console.error("");
  console.error("Optional env:");
  console.error("  LINKS='exports/subnet-message-links.json' Fetch exact message links harvested from Discord search");
  console.error("  CHANNEL_IDS='123,456'    Restrict scan to known subnet channels");
  console.error("  SCAN_LIMIT=300           Messages scanned per channel");
  console.error("  MATCH_TEXT='Miners...'   Use when bot cannot read message content");
  console.error("  MATCH_AUTHOR=false       Match text regardless of author");
  process.exit(1);
}

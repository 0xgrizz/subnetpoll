const data = window.REACTION_DATA || {};
const marketData = window.SUBNET_MARKET_DATA || {};
const state = {
  filter: "all",
  marketFilter: "all",
  search: "",
  sort: "legit-ratio",
  sizeBy: "votes",
  selectedKey: null
};

const rowsEl = document.querySelector("#rows");
const emptyStateEl = document.querySelector("#emptyState");
const bubbleMapEl = document.querySelector("#bubbleMap");
const mapShellEl = document.querySelector("#mapShell");
const mapDetailEl = document.querySelector("#mapDetail");
const verdictCardEl = document.querySelector("#verdictCard");
const distributionCardEl = document.querySelector("#distributionCard");
const auditCardEl = document.querySelector("#auditCard");
const topLegitListEl = document.querySelector("#topLegitList");
const topBunkListEl = document.querySelector("#topBunkList");
const contestedListEl = document.querySelector("#contestedList");
const searchInput = document.querySelector("#searchInput");
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));
const marketFilterButtons = Array.from(document.querySelectorAll("[data-market-filter]"));
const sortButtons = Array.from(document.querySelectorAll("[data-sort]"));
const sizeButtons = Array.from(document.querySelectorAll("[data-size-by]"));
let bubblePhysicsFrame = 0;
let bubblePhysicsGeneration = 0;
let lastBubbleLayoutSignature = "";

const thumbsUpNames = new Set(["👍", "thumbsup", "+1"]);
const thumbsDownNames = new Set(["👎", "thumbsdown", "-1"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value, digits = 0) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value)}%`;
}

function formatDecimal(value, digits = 2) {
  if (!Number.isFinite(value)) return "n/a";

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function formatSignedTao(value, digits = 4) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatDecimal(Math.abs(value), digits)} TAO`;
}

function formatTao(value, digits = 4) {
  if (!Number.isFinite(value)) return "n/a";
  return `${formatDecimal(value, digits)} TAO`;
}

function formatCompactTao(value) {
  if (!Number.isFinite(value)) return "n/a";
  const absolute = Math.abs(value);
  const digits = absolute >= 10 ? 1 : absolute >= 1 ? 2 : 3;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatDecimal(absolute, digits)}`;
}

function formatDate(value) {
  if (!value) return "Not updated yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated yet";
  return `Updated ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)}`;
}

function isThumbsUp(value) {
  const name = String(value ?? "").toLowerCase();
  return thumbsUpNames.has(value) || name.startsWith("thumbsup") || name.startsWith("👍");
}

function isThumbsDown(value) {
  const name = String(value ?? "").toLowerCase();
  return thumbsDownNames.has(value) || name.startsWith("thumbsdown") || name.startsWith("👎");
}

function getReactionCount(reactions, names) {
  if (!Array.isArray(reactions)) return 0;

  return reactions.reduce((total, reaction) => {
    const name = reaction?.emoji?.name ?? reaction?.name ?? reaction?.emoji;
    const matchesUp = names === thumbsUpNames && isThumbsUp(name);
    const matchesDown = names === thumbsDownNames && isThumbsDown(name);
    return matchesUp || matchesDown ? total + Number(reaction.count || 0) : total;
  }, 0);
}

function getSubnetNumber(name) {
  const match = String(name ?? "").match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function getSectorName(subnetNumber) {
  if (!subnetNumber) return "Other";
  if (subnetNumber <= 46) return "Subnets";
  if (subnetNumber <= 96) return "Subnets 2";
  return "Subnets 3";
}

function normalizeMarketRow(row) {
  if (!row) return null;
  const netuid = Number(row.netuid);
  if (!Number.isFinite(netuid)) return null;
  const taoFlow = Number(row.taoFlow);
  const burnEmissionPct = Number(row.burnEmissionPct);

  return {
    ...row,
    netuid,
    taoFlow: Number.isFinite(taoFlow) ? taoFlow : 0,
    burnEmissionPct: Number.isFinite(burnEmissionPct) ? burnEmissionPct : null,
    subnetEmission: Number(row.subnetEmission),
    burnCost: Number(row.burnCost),
    taoIn: Number(row.taoIn),
    alphaIn: Number(row.alphaIn),
    alphaOut: Number(row.alphaOut),
    movingPrice: Number(row.movingPrice),
    subnetVolume: Number(row.subnetVolume)
  };
}

const marketByNetuid = new Map(
  (Array.isArray(marketData.items) ? marketData.items : [])
    .map(normalizeMarketRow)
    .filter(Boolean)
    .map((row) => [row.netuid, row])
);

function normalizeItem(item, index) {
  const reactions = Array.isArray(item.reactions) ? item.reactions : [];
  const countsKnown = item.up != null ||
    item.thumbsUp != null ||
    item.down != null ||
    item.thumbsDown != null ||
    reactions.length > 0;
  const up = countsKnown ? Number(item.up ?? item.thumbsUp ?? getReactionCount(reactions, thumbsUpNames) ?? 0) : 0;
  const down = countsKnown ? Number(item.down ?? item.thumbsDown ?? getReactionCount(reactions, thumbsDownNames) ?? 0) : 0;
  const total = up + down;
  const net = up - down;
  const support = total > 0 ? Math.round((up / total) * 100) : 0;
  const status = !countsKnown ? "pending" : total === 0 ? "no-votes" : up > down ? "legit" : down > up ? "bunk" : "tie";
  const extraReactions = reactions
    .map((reaction) => ({
      emoji: reaction?.emoji?.name ?? reaction?.name ?? reaction?.emoji,
      count: Number(reaction?.count || 0)
    }))
    .filter((reaction) => {
      return reaction.emoji &&
        reaction.count > 0 &&
        !isThumbsUp(reaction.emoji) &&
        !isThumbsDown(reaction.emoji);
    });
  const key = item.messageId || item.messageUrl || item.channelId || `${index}`;
  const subnetNumber = getSubnetNumber(item.subnet || item.channelName);
  const market = marketByNetuid.get(subnetNumber) || null;

  return {
    index,
    key,
    subnetNumber,
    sector: item.category || item.sector || getSectorName(subnetNumber),
    subnet: item.subnet || item.channelName || `Subnet ${index + 1}`,
    channelName: item.channelName || item.channelId || "unknown-channel",
    messageUrl: item.messageUrl || item.url || data.sourceMessage?.url || "#",
    up,
    down,
    total,
    net,
    support,
    status,
    countsKnown,
    extraReactions,
    market,
    hasMarket: Boolean(market),
    taoFlow: market?.taoFlow ?? 0,
    burnEmissionPct: market?.burnEmissionPct ?? null
  };
}

const items = Array.isArray(data.items) ? data.items.map(normalizeItem) : [];

function getDownShare(item) {
  return item.total > 0 ? getBunkRatio(item) * 100 : 0;
}

function getLegitRatio(item) {
  return item.total > 0 ? item.up / item.total : 0;
}

function getBunkRatio(item) {
  return item.total > 0 ? item.down / item.total : 0;
}

function formatRatio(value, digits = 1) {
  return formatPercent(value * 100, digits);
}

function getWilsonLowerBound(successes, total) {
  if (total <= 0) return 0;

  const z = 1.96;
  const ratio = successes / total;
  const z2 = z * z;
  const center = ratio + z2 / (2 * total);
  const margin = z * Math.sqrt((ratio * (1 - ratio) + z2 / (4 * total)) / total);
  return Math.max(0, (center - margin) / (1 + z2 / total));
}

function getLegitScore(item) {
  return getWilsonLowerBound(item.up, item.total);
}

function getBunkScore(item) {
  return getWilsonLowerBound(item.down, item.total);
}

function getDominantRatio(item) {
  if (item.status === "bunk") return getBunkRatio(item);
  return getLegitRatio(item);
}

function getDominantScore(item) {
  if (item.status === "bunk") return getBunkScore(item);
  return getLegitScore(item);
}

function getSignalPercent(item) {
  if (!item.countsKnown || item.total === 0) return 0;
  return Math.round((item.net / item.total) * 100);
}

function getCoVeScore(item) {
  if (!item.total) return 0;
  const conviction = Math.abs(item.net) / item.total;
  return Math.round(conviction * Math.log2(item.total + 1) * 100);
}

function formatSignal(item) {
  const signal = getSignalPercent(item);
  if (!item.countsKnown || item.total === 0) return "0%";
  if (signal > 0) return `+${signal}%`;
  return `${signal}%`;
}

function formatBurnEmission(item, digits = 1) {
  if (!Number.isFinite(item.burnEmissionPct)) return "n/a";
  return formatPercent(item.burnEmissionPct, digits);
}

function getBurnEmissionValue(item) {
  return Number.isFinite(item.burnEmissionPct) ? item.burnEmissionPct : -Infinity;
}

function getMarketSummary() {
  const marketItems = items.filter((item) => item.hasMarket);
  const burnValues = marketItems
    .map((item) => item.burnEmissionPct)
    .filter(Number.isFinite);
  const netFlow = marketItems.reduce((sum, item) => sum + item.taoFlow, 0);
  const positiveFlow = marketItems.filter((item) => item.taoFlow > 0).length;
  const negativeFlow = marketItems.filter((item) => item.taoFlow < 0).length;

  return {
    marketItems,
    netFlow,
    positiveFlow,
    negativeFlow,
    burnValues,
    averageBurnEmissionPct: burnValues.length
      ? burnValues.reduce((sum, value) => sum + value, 0) / burnValues.length
      : 0
  };
}

function getTone(item) {
  if (item.status === "legit") return "legit";
  if (item.status === "bunk") return "bunk";
  if (item.status === "tie") return "tie";
  return "quiet";
}

function getStatusLabel(status) {
  if (status === "no-votes") return "Empty";
  if (status === "pending") return "Pending";
  if (status === "tie") return "Flat";
  return status[0].toUpperCase() + status.slice(1);
}

function getBubbleLabel(item) {
  return item.subnetNumber ? `SN${item.subnetNumber}` : item.subnet.slice(0, 4).toUpperCase();
}

function getTickerName(item) {
  const parts = item.subnet.split("・").filter(Boolean);
  const raw = parts.length >= 2 ? parts[1] : item.subnet;
  return raw
    .replace(/\s+/g, "")
    .replace(/-\d+$/, "")
    .slice(0, 9)
    .toUpperCase();
}

function getSizeMetric(item) {
  if (state.sizeBy === "signal") return Math.abs(item.net);
  if (state.sizeBy === "tao-flow") return Math.abs(item.taoFlow);
  return item.total;
}

function getBubbleSize(item, maxMetric, width) {
  const compact = width < 700;
  const emptySize = compact ? 27 : 38;
  const min = compact ? 34 : 50;
  const max = compact ? 78 : 118;
  const metric = getSizeMetric(item);

  if ((state.sizeBy !== "tao-flow" && !item.countsKnown) || metric === 0) return emptySize;

  const scaled = Math.pow(metric / Math.max(maxMetric, 1), 0.48);
  return Math.round(min + scaled * (max - min));
}

function hashUnit(value, salt = 0) {
  const text = `${value}:${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getTargetX(item, width, radius) {
  const margin = radius + 18;
  if (!item.countsKnown || item.total === 0) return width * (0.5 + (hashUnit(item.key, 4) - 0.5) * 0.18);
  return margin + getLegitRatio(item) * (width - margin * 2);
}

function getTargetY(item, height) {
  const noise = (hashUnit(item.key, 7) - 0.5) * 0.34;
  if (!item.countsKnown || item.total === 0) return height * (0.72 + noise * 0.45);
  if (item.status === "tie") return height * (0.5 + noise * 0.55);
  if (item.status === "bunk") return height * (0.48 + noise * 0.7);
  return height * (0.44 + noise * 0.7);
}

function placeBubbles(bubbleItems, width, height) {
  const compact = width < 700;
  const gap = compact ? 2 : 5;
  const padding = compact ? 8 : 14;
  const iterations = compact ? 280 : 240;
  const placed = bubbleItems.map(({ item, size }, index) => {
    const radius = size / 2;
    const targetX = getTargetX(item, width, radius);
    const targetY = getTargetY(item, height);
    const angle = hashUnit(item.key, 11) * Math.PI * 2;
    const spread = 36 + hashUnit(item.key, 13) * 80;

    return {
      item,
      size,
      radius,
      targetX,
      targetY,
      x: Math.min(Math.max(targetX + Math.cos(angle) * spread, radius + padding), width - radius - padding),
      y: Math.min(Math.max(targetY + Math.sin(angle) * spread, radius + padding), height - radius - padding),
      weight: 1 + index / Math.max(bubbleItems.length, 1)
    };
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const pull = 0.026 + iteration / iterations * 0.016;

    placed.forEach((bubble) => {
      bubble.x += (bubble.targetX - bubble.x) * pull;
      bubble.y += (bubble.targetY - bubble.y) * pull;
    });

    for (let i = 0; i < placed.length; i += 1) {
      const a = placed[i];
      for (let j = i + 1; j < placed.length; j += 1) {
        const b = placed[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);

        if (distance === 0) {
          dx = hashUnit(`${a.item.key}:${b.item.key}`, 17) - 0.5;
          dy = hashUnit(`${a.item.key}:${b.item.key}`, 19) - 0.5;
          distance = Math.hypot(dx, dy) || 1;
        }

        const minDistance = a.radius + b.radius + gap;
        if (distance >= minDistance) continue;

        const overlap = (minDistance - distance) / distance;
        const pushX = dx * overlap * 0.52;
        const pushY = dy * overlap * 0.52;
        a.x -= pushX / a.weight;
        a.y -= pushY / a.weight;
        b.x += pushX / b.weight;
        b.y += pushY / b.weight;
      }
    }

    placed.forEach((bubble) => {
      bubble.x = Math.min(Math.max(bubble.x, bubble.radius + padding), width - bubble.radius - padding);
      bubble.y = Math.min(Math.max(bubble.y, bubble.radius + padding), height - bubble.radius - padding);
    });
  }

  return placed;
}

function summarize() {
  const totalUp = items.reduce((sum, item) => sum + item.up, 0);
  const totalDown = items.reduce((sum, item) => sum + item.down, 0);
  const net = totalUp - totalDown;
  const statusCounts = items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, { all: items.length });

  document.querySelector("#statSubnets").textContent = formatNumber(items.length);
  document.querySelector("#statUp").textContent = formatNumber(totalUp);
  document.querySelector("#statDown").textContent = formatNumber(totalDown);
  document.querySelector("#statNet").textContent = net > 0 ? `+${formatNumber(net)}` : formatNumber(net);

  document.querySelectorAll("[data-filter-count]").forEach((countEl) => {
    const key = countEl.dataset.filterCount;
    countEl.textContent = formatNumber(statusCounts[key] || 0);
  });

  renderIntelligence();
}

function getStatusCounts(sourceItems = items) {
  return sourceItems.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    counts.all = (counts.all || 0) + 1;
    return counts;
  }, { all: 0, legit: 0, bunk: 0, tie: 0, "no-votes": 0, pending: 0 });
}

function getMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function getQuantile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function getGlobalSummary() {
  const totalUp = items.reduce((sum, item) => sum + item.up, 0);
  const totalDown = items.reduce((sum, item) => sum + item.down, 0);
  const totalVotes = totalUp + totalDown;
  const net = totalUp - totalDown;
  const support = totalVotes ? totalUp / totalVotes * 100 : 0;
  const votedItems = items.filter((item) => item.total > 0);
  const statusCounts = getStatusCounts();
  const medianVotes = getMedian(votedItems.map((item) => item.total));
  const averageVotes = votedItems.length ? totalVotes / votedItems.length : 0;
  const highConfidenceLegit = items.filter((item) => item.total >= 10 && getLegitRatio(item) >= 0.75).length;
  const highConfidenceBunk = items.filter((item) => item.total >= 10 && getBunkRatio(item) >= 0.75).length;
  const contested = items.filter((item) => item.total >= 10 && getLegitRatio(item) >= 0.35 && getLegitRatio(item) <= 0.65).length;

  let verdict = "Split poll";
  let verdictTone = "tie";
  if (support >= 66) {
    verdict = "Legit majority";
    verdictTone = "legit";
  } else if (support <= 40) {
    verdict = "Bunk majority";
    verdictTone = "bunk";
  } else if (support >= 55) {
    verdict = "Legit leaning";
    verdictTone = "legit";
  } else if (support <= 45) {
    verdict = "Bunk leaning";
    verdictTone = "bunk";
  }

  return {
    totalUp,
    totalDown,
    totalVotes,
    net,
    support,
    downShare: 100 - support,
    votedItems,
    statusCounts,
    medianVotes,
    averageVotes,
    highConfidenceLegit,
    highConfidenceBunk,
    contested,
    verdict,
    verdictTone
  };
}

function renderMiniList(target, list, mode) {
  if (!target) return;

  target.innerHTML = list.map((item) => {
    const value = mode === "bunk"
      ? `${formatRatio(getBunkRatio(item))} bunk`
      : mode === "contested"
        ? `${formatRatio(getLegitRatio(item))} / ${formatNumber(item.total)}`
        : `${formatRatio(getLegitRatio(item))} legit`;
    const secondary = mode === "contested"
      ? `${formatNumber(item.up)} up · ${formatNumber(item.down)} down`
      : `${formatNumber(item.total)} thumbs · score ${formatRatio(mode === "bunk" ? getBunkScore(item) : getLegitScore(item))}`;

    return `
      <button class="mini-row ${getTone(item)}" type="button" data-key="${escapeHtml(item.key)}">
        <span>${escapeHtml(getBubbleLabel(item))}</span>
        <strong>${escapeHtml(getTickerName(item))}</strong>
        <em>${escapeHtml(value)}</em>
        <small>${escapeHtml(secondary)}</small>
      </button>
    `;
  }).join("");
}

function renderIntelligence() {
  const summary = getGlobalSummary();
  const marketSummary = getMarketSummary();
  const coverage = items.length ? summary.votedItems.length / items.length * 100 : 0;
  const statusTotal = Math.max(items.length, 1);
  const marketCoverage = items.length ? marketSummary.marketItems.length / items.length * 100 : 0;
  const burnHighThreshold = getQuantile(marketSummary.burnValues, 0.75);
  const highBurnCount = marketSummary.marketItems
    .filter((item) => Number.isFinite(item.burnEmissionPct) && item.burnEmissionPct >= burnHighThreshold)
    .length;
  const flowBlock = marketData.summary?.flowBlock || marketSummary.marketItems[0]?.market?.taoFlowBlock || "n/a";
  const topLegit = [...items]
    .filter((item) => item.total > 0)
    .sort((a, b) => getLegitScore(b) - getLegitScore(a) || getLegitRatio(b) - getLegitRatio(a) || b.total - a.total)
    .slice(0, 5);
  const topBunk = [...items]
    .filter((item) => item.total > 0)
    .sort((a, b) => getBunkScore(b) - getBunkScore(a) || getBunkRatio(b) - getBunkRatio(a) || b.total - a.total)
    .slice(0, 5);
  const contested = [...items]
    .filter((item) => item.total >= 10)
    .sort((a, b) => Math.abs(getLegitRatio(a) - 0.5) - Math.abs(getLegitRatio(b) - 0.5) || b.total - a.total)
    .slice(0, 5);
  const topCoVe = [...items]
    .filter((item) => item.total > 0)
    .sort((a, b) => getCoVeScore(b) - getCoVeScore(a) || b.total - a.total)[0];

  if (verdictCardEl) {
    const netLabel = summary.net > 0 ? `+${formatNumber(summary.net)}` : formatNumber(summary.net);

    verdictCardEl.innerHTML = `
      <div class="verdict-top ${summary.verdictTone}">
        <span>Global read</span>
        <strong>${summary.verdict}</strong>
        <em>${formatPercent(summary.support, 1)} legit</em>
      </div>
      <div class="global-split" aria-hidden="true">
        <span class="global-up" style="width: ${summary.support}%"></span>
        <span class="global-down" style="width: ${summary.downShare}%"></span>
      </div>
      <div class="verdict-metrics">
        <span><strong>${formatNumber(summary.totalVotes)}</strong> total thumbs</span>
        <span><strong>${netLabel}</strong> net</span>
        <span><strong>${formatNumber(summary.votedItems.length)}</strong> active subnets</span>
      </div>
    `;
  }

  if (distributionCardEl) {
    distributionCardEl.innerHTML = `
      <div class="card-headline">
        <span>Poll shape</span>
        <strong>${summary.highConfidenceLegit} strong legit · ${summary.highConfidenceBunk} strong bunk</strong>
      </div>
      <div class="status-stack" aria-hidden="true">
        <span class="stack-legit" style="width: ${summary.statusCounts.legit / statusTotal * 100}%"></span>
        <span class="stack-bunk" style="width: ${summary.statusCounts.bunk / statusTotal * 100}%"></span>
        <span class="stack-tie" style="width: ${summary.statusCounts.tie / statusTotal * 100}%"></span>
        <span class="stack-empty" style="width: ${summary.statusCounts["no-votes"] / statusTotal * 100}%"></span>
      </div>
      <div class="shape-grid">
        <span><b>${summary.statusCounts.legit}</b> legit</span>
        <span><b>${summary.statusCounts.bunk}</b> bunk</span>
        <span><b>${summary.statusCounts.tie}</b> flat</span>
        <span><b>${summary.statusCounts["no-votes"]}</b> empty</span>
      </div>
      <div class="shape-grid compact">
        <span><b>${formatNumber(summary.averageVotes.toFixed(1))}</b> avg thumbs</span>
        <span><b>${formatNumber(summary.medianVotes)}</b> median thumbs</span>
        <span><b>${summary.contested}</b> contested</span>
        <span><b>${formatPercent(marketSummary.averageBurnEmissionPct, 1)}</b> avg burn share</span>
      </div>
    `;
  }

  if (auditCardEl) {
    auditCardEl.innerHTML = `
      <div class="card-headline">
        <span>CoVe audit</span>
        <strong>${formatPercent(coverage, 1)} coverage</strong>
      </div>
      <div class="audit-grid">
        <span><b>${formatNumber(items.length)}</b> exact message links</span>
        <span><b>${formatNumber(summary.votedItems.length)}</b> with thumbs</span>
        <span><b>${formatPercent(marketCoverage, 0)}</b> metagraph match</span>
        <span><b>${flowBlock}</b> TAO flow block</span>
        <span><b>${formatSignedTao(marketSummary.netFlow, 3)}</b> net flow</span>
        <span><b>${highBurnCount}</b> high burn-share</span>
      </div>
      ${topCoVe ? `
        <button class="audit-focus ${getTone(topCoVe)}" type="button" data-key="${escapeHtml(topCoVe.key)}">
          <span>${escapeHtml(getBubbleLabel(topCoVe))}</span>
          <strong>${escapeHtml(getTickerName(topCoVe))}</strong>
          <em>${formatSignal(topCoVe)} · ${formatNumber(topCoVe.total)} thumbs</em>
        </button>
      ` : ""}
    `;
  }

  renderMiniList(topLegitListEl, topLegit, "legit");
  renderMiniList(topBunkListEl, topBunk, "bunk");
  renderMiniList(contestedListEl, contested, "contested");
}

function applySort(list) {
  const sorted = [...list];

  sorted.sort((a, b) => {
    if (state.sort === "legit-ratio") return getLegitScore(b) - getLegitScore(a) || getLegitRatio(b) - getLegitRatio(a) || b.total - a.total;
    if (state.sort === "bunk-ratio") return getBunkScore(b) - getBunkScore(a) || getBunkRatio(b) - getBunkRatio(a) || b.total - a.total;
    if (state.sort === "votes") return b.total - a.total || Math.abs(b.net) - Math.abs(a.net);
    if (state.sort === "conviction") return getCoVeScore(b) - getCoVeScore(a) || b.total - a.total;
    if (state.sort === "tao-flow") return b.taoFlow - a.taoFlow || b.total - a.total;
    if (state.sort === "burn-emission") return getBurnEmissionValue(b) - getBurnEmissionValue(a) || b.total - a.total;
    if (state.sort === "name") return a.subnet.localeCompare(b.subnet, undefined, { numeric: true });
    return getLegitScore(b) - getLegitScore(a) || b.total - a.total;
  });

  return sorted;
}

function matchesMarketFilter(item) {
  if (state.marketFilter === "all") return true;
  if (state.marketFilter === "flow-positive") return item.hasMarket && item.taoFlow > 0;
  if (state.marketFilter === "flow-negative") return item.hasMarket && item.taoFlow < 0;
  if (state.marketFilter === "burn-high") {
    const burnValues = items.map((current) => current.burnEmissionPct).filter(Number.isFinite);
    return item.hasMarket &&
      Number.isFinite(item.burnEmissionPct) &&
      item.burnEmissionPct >= getQuantile(burnValues, 0.75);
  }
  return item.hasMarket;
}

function getVisibleItems() {
  const query = state.search.trim().toLowerCase();

  const filtered = items.filter((item) => {
    const matchesSearch = !query ||
      item.subnet.toLowerCase().includes(query) ||
      item.channelName.toLowerCase().includes(query);
    const matchesFilter = state.filter === "all" || item.status === state.filter;
    return matchesSearch && matchesFilter && matchesMarketFilter(item);
  });

  return applySort(filtered);
}

function getSelectedItem(visibleItems) {
  const selected = visibleItems.find((item) => item.key === state.selectedKey);
  if (selected) return selected;

  state.selectedKey = visibleItems[0]?.key || null;
  return visibleItems[0] || null;
}

function renderStatus(status) {
  return `<span class="status ${status}">${getStatusLabel(status)}</span>`;
}

function renderVoteBalance(item, variant = "row") {
  const empty = item.total === 0 || !item.countsKnown;
  const upShare = empty ? 0 : getLegitRatio(item) * 100;
  const downShare = empty ? 0 : getDownShare(item);
  const className = `vote-balance vote-balance-${variant}${empty ? " is-empty" : ""}`;

  return `
    <div class="${className}">
      <div class="balance-numbers">
        <span class="vote-up">👍 ${formatNumber(item.up)}</span>
        <span class="vote-down">👎 ${formatNumber(item.down)}</span>
      </div>
      <div class="balance-track" aria-hidden="true">
        <span class="balance-up" style="width: ${upShare}%"></span>
        <span class="balance-down" style="width: ${downShare}%"></span>
      </div>
      <div class="balance-labels">
        <span>${empty ? "No legit thumbs" : `${formatPercent(upShare, 1)} legit`}</span>
        <span>${empty ? "No bunk thumbs" : `${formatPercent(downShare, 1)} bunk`}</span>
      </div>
    </div>
  `;
}

function getFlowTone(item) {
  if (!item.hasMarket || item.taoFlow === 0) return "flat";
  return item.taoFlow > 0 ? "positive" : "negative";
}

function renderMarketTags(item, variant = "row") {
  if (!item.hasMarket) {
    return `<div class="market-tags market-tags-${variant}"><span class="market-tag muted">No metagraph row</span></div>`;
  }

  return `
    <div class="market-tags market-tags-${variant}">
      <span class="market-tag flow-${getFlowTone(item)}">${formatSignedTao(item.taoFlow, 4)}</span>
      <span class="market-tag burn">${formatBurnEmission(item)} burn share</span>
    </div>
  `;
}

function renderMarketDetail(item) {
  if (!item.hasMarket) {
    return `
      <div class="detail-market">
        <span><strong>n/a</strong><em>TAO flow</em></span>
        <span><strong>n/a</strong><em>Burn share</em></span>
        <span><strong>n/a</strong><em>Emission</em></span>
      </div>
    `;
  }

  return `
    <div class="detail-market">
      <span><strong>${formatSignedTao(item.taoFlow, 4)}</strong><em>TAO flow</em></span>
      <span><strong>${formatBurnEmission(item)}</strong><em>Burn share</em></span>
      <span><strong>${formatTao(item.market.burnCost, 4)}</strong><em>Burn cost</em></span>
    </div>
  `;
}

function renderMapDetail(item) {
  if (!item) {
    mapDetailEl.innerHTML = `<p class="empty-detail">No subnets match.</p>`;
    return;
  }

  const extra = item.extraReactions.length ? `
    <div class="detail-extra">
      ${item.extraReactions.map((reaction) => `
        <span>${escapeHtml(reaction.emoji)} ${formatNumber(reaction.count)}</span>
      `).join("")}
    </div>
  ` : "";

  mapDetailEl.innerHTML = `
    <div class="detail-top ${getTone(item)}">
      <span class="detail-number">${escapeHtml(getBubbleLabel(item))}</span>
      <div>
        <h3>${escapeHtml(item.subnet)}</h3>
        <span>${escapeHtml(item.sector)} · #${escapeHtml(item.channelName)}</span>
      </div>
    </div>

    <div class="detail-signal ${getTone(item)}">
      <strong>${formatSignal(item)}</strong>
      <span>${getStatusLabel(item.status)} · ${formatNumber(item.total)} thumbs</span>
    </div>

    ${renderVoteBalance(item, "detail")}
    ${renderMarketDetail(item)}

    <div class="detail-stats">
      <span><strong>${formatNumber(item.up)}</strong> legit</span>
      <span><strong>${formatNumber(item.down)}</strong> bunk</span>
      <span><strong>${formatNumber(item.net)}</strong> net</span>
    </div>
    ${extra}
    <a class="detail-link" href="${escapeHtml(item.messageUrl)}" target="_blank" rel="noreferrer">Open message</a>
  `;
}

function getBubbleBackgroundSupport(item) {
  if (!item.countsKnown || item.total === 0) return 50;
  return getLegitRatio(item) * 100;
}

function getBubbleGlow(item) {
  if (!item.countsKnown || item.total === 0) return "rgba(130, 142, 160, 0.42)";
  if (item.status === "tie") return "rgba(96, 165, 250, 0.56)";
  if (item.net > 0) return "rgba(56, 255, 118, 0.72)";
  return "rgba(255, 64, 84, 0.72)";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setBubblePosition(element, x, y, opacity = 1) {
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.style.setProperty("--bubble-opacity", opacity.toFixed(3));
}

function settleBubblePlacements(placements) {
  placements.forEach((placement) => {
    const element = bubbleMapEl.querySelector(`[data-key="${CSS.escape(placement.item.key)}"]`);
    if (!element) return;
    setBubblePosition(element, placement.x, placement.y, 1);
    element.classList.remove("is-falling");
    element.classList.add("is-settled");
  });
}

function animateBubblePhysics(placements, width, height, shouldAnimate) {
  cancelAnimationFrame(bubblePhysicsFrame);
  bubblePhysicsGeneration += 1;
  const generation = bubblePhysicsGeneration;

  if (!shouldAnimate || prefersReducedMotion()) {
    bubbleMapEl.classList.remove("is-physics-active");
    settleBubblePlacements(placements);
    return;
  }

  bubbleMapEl.classList.add("is-physics-active");
  const compact = width < 700;
  const padding = compact ? 8 : 14;
  const gap = compact ? 2 : 5;
  const bodies = placements.map((placement, index) => {
    const element = bubbleMapEl.querySelector(`[data-key="${CSS.escape(placement.item.key)}"]`);
    const radius = placement.radius;
    const startX = clamp(
      placement.x + (hashUnit(placement.item.key, 31) - 0.5) * Math.min(width * 0.28, 220),
      radius + padding,
      width - radius - padding
    );

    if (element) {
      element.classList.add("is-falling");
      element.classList.remove("is-settled");
      setBubblePosition(element, startX, -radius - 46 - hashUnit(placement.item.key, 33) * 180, 0);
    }

    return {
      element,
      x: startX,
      y: -radius - 46 - hashUnit(placement.item.key, 33) * 180 - index * 1.2,
      vx: (hashUnit(placement.item.key, 35) - 0.5) * 3.6,
      vy: 0,
      targetX: placement.x,
      targetY: placement.y,
      radius,
      mass: Math.max(0.72, Math.pow(radius / 34, 1.38)),
      delay: Math.min(index * 6, 520),
      active: false
    };
  });

  const startedAt = performance.now();
  let previous = startedAt;

  function finish() {
    if (generation !== bubblePhysicsGeneration) return;
    bubbleMapEl.classList.remove("is-physics-active");
    settleBubblePlacements(placements);
  }

  function step(now) {
    if (generation !== bubblePhysicsGeneration) return;

    const elapsed = now - startedAt;
    const delta = Math.min((now - previous) / 16.67, 2.2);
    previous = now;
    let distanceTotal = 0;
    let velocityTotal = 0;
    let activeCount = 0;

    bodies.forEach((body) => {
      const localElapsed = elapsed - body.delay;
      if (localElapsed <= 0) return;

      body.active = true;
      activeCount += 1;
      const pull = 0.022 / body.mass;
      const gravity = 0.34 + body.radius / 230;
      const nearTarget = Math.hypot(body.targetX - body.x, body.targetY - body.y) < body.radius * 0.45;
      const damping = Math.pow(nearTarget ? 0.74 : 0.87, delta);

      body.vx += (body.targetX - body.x) * pull * delta;
      body.vy += (gravity + (body.targetY - body.y) * pull * 0.72) * delta;
      body.vx *= damping;
      body.vy *= damping;
      body.x += body.vx * delta;
      body.y += body.vy * delta;

      if (body.x < body.radius + padding) {
        body.x = body.radius + padding;
        body.vx = Math.abs(body.vx) * 0.44;
      } else if (body.x > width - body.radius - padding) {
        body.x = width - body.radius - padding;
        body.vx = -Math.abs(body.vx) * 0.44;
      }

      if (body.y > height - body.radius - padding) {
        body.y = height - body.radius - padding;
        body.vy = -Math.abs(body.vy) * 0.38;
        body.vx *= 0.92;
      }
    });

    for (let index = 0; index < bodies.length; index += 1) {
      const a = bodies[index];
      if (!a.active) continue;

      for (let nextIndex = index + 1; nextIndex < bodies.length; nextIndex += 1) {
        const b = bodies[nextIndex];
        if (!b.active) continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          dx = hashUnit(`${a.targetX}:${b.targetX}`, 41) - 0.5;
          dy = hashUnit(`${a.targetY}:${b.targetY}`, 43) - 0.5;
          distance = Math.hypot(dx, dy) || 1;
        }

        const minDistance = a.radius + b.radius + gap;
        if (distance >= minDistance) continue;

        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = minDistance - distance;
        const inverseA = 1 / a.mass;
        const inverseB = 1 / b.mass;
        const inverseTotal = inverseA + inverseB;
        const push = overlap / inverseTotal;

        a.x -= nx * push * inverseA;
        a.y -= ny * push * inverseA;
        b.x += nx * push * inverseB;
        b.y += ny * push * inverseB;

        const relativeVelocity = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relativeVelocity < 0) {
          const impulse = -relativeVelocity * 0.24;
          a.vx -= nx * impulse * inverseA;
          a.vy -= ny * impulse * inverseA;
          b.vx += nx * impulse * inverseB;
          b.vy += ny * impulse * inverseB;
        }
      }
    }

    bodies.forEach((body) => {
      if (!body.active || !body.element) return;
      body.x = clamp(body.x, body.radius + padding, width - body.radius - padding);
      body.y = clamp(body.y, -body.radius * 2, height - body.radius - padding);
      const opacity = Math.min(1, Math.max(0, (elapsed - body.delay) / 210));
      setBubblePosition(body.element, body.x, body.y, opacity);
      distanceTotal += Math.hypot(body.targetX - body.x, body.targetY - body.y);
      velocityTotal += Math.hypot(body.vx, body.vy);
    });

    const averageDistance = activeCount ? distanceTotal / activeCount : Infinity;
    const averageVelocity = activeCount ? velocityTotal / activeCount : Infinity;
    const settled = elapsed > 1080 && averageDistance < 1.4 && averageVelocity < 0.18;

    if (settled || elapsed > 2450) {
      finish();
      return;
    }

    bubblePhysicsFrame = requestAnimationFrame(step);
  }

  bubblePhysicsFrame = requestAnimationFrame(step);
}

function renderBubbleMap(visibleItems) {
  if (!bubbleMapEl) return;

  if (visibleItems.length === 0) {
    cancelAnimationFrame(bubblePhysicsFrame);
    lastBubbleLayoutSignature = "";
    bubbleMapEl.innerHTML = "";
    bubbleMapEl.style.height = "";
    return;
  }

  const width = Math.max(320, Math.round((mapShellEl || bubbleMapEl).clientWidth || 960));
  const maxMetric = Math.max(...visibleItems.map(getSizeMetric), 1);
  const bubbleItems = visibleItems
    .map((item) => ({ item, size: getBubbleSize(item, maxMetric, width) }))
    .sort((a, b) => b.size - a.size || b.item.total - a.item.total);
  const bubbleArea = bubbleItems.reduce((sum, bubble) => {
    const radius = bubble.size / 2 + 6;
    return sum + Math.PI * radius * radius;
  }, 0);
  const compact = width < 700;
  const baseHeight = visibleItems.length <= 3 ? 460 : compact ? 1040 : 660;
  const maxHeight = compact ? 3000 : 1380;
  const density = compact ? 0.28 : 0.58;
  const height = Math.round(Math.min(maxHeight, Math.max(baseHeight, bubbleArea / (width * density))));
  const placements = placeBubbles(bubbleItems, width, height);
  const layoutSignature = [
    width,
    height,
    state.filter,
    state.marketFilter,
    state.search.trim(),
    state.sort,
    state.sizeBy,
    visibleItems.map((item) => `${item.key}:${getSizeMetric(item)}`).join("|")
  ].join("::");
  const shouldAnimate = layoutSignature !== lastBubbleLayoutSignature;
  lastBubbleLayoutSignature = layoutSignature;

  bubbleMapEl.style.height = `${height}px`;
  bubbleMapEl.innerHTML = placements.map(({ item, size, x, y }, index) => {
    const selected = item.key === state.selectedKey ? " is-selected" : "";
    const label = `${item.subnet}: ${item.up} legit, ${item.down} bunk`;
    const nameSize = Math.max(10, Math.min(20, size / 5.8));
    const changeSize = Math.max(10, Math.min(17, size / 6.8));
    const codeSize = Math.max(17, Math.min(34, size / 3.3));
    const volumeSize = Math.max(8, Math.min(12, size / 10));
    const support = getBubbleBackgroundSupport(item);
    const volumeLabel = state.sizeBy === "tao-flow"
      ? formatCompactTao(item.taoFlow)
      : item.total > 0 ? `${formatNumber(item.total)}t` : "empty";
    const zIndex = item.key === state.selectedKey ? 20 : Math.max(1, 14 - Math.round(index / 10));

    const sizeClass = size < 54 ? " is-tiny" : size < 72 ? " is-small" : "";

    return `
      <button
        class="bubble ${getTone(item)}${selected}${sizeClass}"
        type="button"
        data-key="${escapeHtml(item.key)}"
        title="${escapeHtml(label)}"
        aria-label="${escapeHtml(label)}"
        style="--size: ${size}px; --support: ${support}%; --glow-color: ${getBubbleGlow(item)}; --name-size: ${nameSize}px; --change-size: ${changeSize}px; --code-size: ${codeSize}px; --volume-size: ${volumeSize}px; left: ${x}px; top: ${y}px; z-index: ${zIndex};"
      >
        <span class="bubble-code">${escapeHtml(getBubbleLabel(item))}</span>
        <span class="bubble-name">${escapeHtml(getTickerName(item))}</span>
        <span class="bubble-change">${escapeHtml(formatSignal(item))}</span>
        <span class="bubble-volume">${escapeHtml(volumeLabel)}</span>
      </button>
    `;
  }).join("");
  animateBubblePhysics(placements, width, height, shouldAnimate);
}

function renderRows(visibleItems) {
  rowsEl.innerHTML = visibleItems.map((item, visibleIndex) => {
    const scoreLabel = item.total > 0
      ? item.status === "bunk"
        ? `${formatRatio(getBunkRatio(item))} bunk`
        : item.status === "tie"
          ? "50.0% flat"
          : `${formatRatio(getLegitRatio(item))} legit`
      : "No ratio";
    const confidenceLabel = item.total > 0
      ? `score ${formatRatio(getDominantScore(item))}`
      : "score 0.0%";

    return `
    <article class="row ${getTone(item)} ${item.key === state.selectedKey ? "is-selected" : ""}" data-key="${escapeHtml(item.key)}">
      <div class="subnet-cell">
        <span class="rank">${visibleIndex + 1}</span>
        <div class="name-text">
          <strong>${escapeHtml(item.subnet)}</strong>
          <span>#${escapeHtml(item.channelName)}</span>
        </div>
        ${renderStatus(item.status)}
      </div>

      <div class="split">
        ${renderVoteBalance(item, "row")}
        ${renderMarketTags(item, "row")}
        ${item.extraReactions.length ? `
          <div class="extra-reactions">
            ${item.extraReactions.map((reaction) => `
              <span>${escapeHtml(reaction.emoji)} ${formatNumber(reaction.count)}</span>
            `).join("")}
          </div>
        ` : ""}
      </div>

      <div class="votes">
        <strong>${formatNumber(item.total)}</strong>
        <span>${scoreLabel}</span>
        <small>${confidenceLabel}</small>
        <a href="${escapeHtml(item.messageUrl)}" target="_blank" rel="noreferrer">Open</a>
      </div>
    </article>
  `;
  }).join("");

  emptyStateEl.hidden = visibleItems.length !== 0;
}

function renderViews() {
  const visibleItems = getVisibleItems();
  const selected = getSelectedItem(visibleItems);

  renderMapDetail(selected);
  renderBubbleMap(visibleItems);
  renderRows(visibleItems);
}

function renderSource() {
  const source = data.sourceMessage || {};
  const sourceLink = document.querySelector("#sourceLink");
  const dataBadge = document.querySelector("#dataBadge");
  const marketUpdatedAt = marketData.updatedAt ? new Date(marketData.updatedAt) : null;
  const hasMarketDate = marketUpdatedAt && !Number.isNaN(marketUpdatedAt.getTime());
  const updatedAtText = hasMarketDate
    ? `${formatDate(data.updatedAt)} · Market ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(marketUpdatedAt)}`
    : formatDate(data.updatedAt);

  document.querySelector("#messageText").textContent = source.content || "Reaction overview";
  document.querySelector("#updatedAt").textContent = updatedAtText;

  sourceLink.href = source.url || "#";
  sourceLink.hidden = !source.url;

  dataBadge.textContent = data.countsPending ? "Links only" : data.isDemo ? "Demo data" : "Verified export";
  dataBadge.classList.toggle("demo", Boolean(data.isDemo || data.countsPending));
}

searchInput.addEventListener("input", (event) => {
  state.search = event.currentTarget.value;
  renderViews();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;

    filterButtons.forEach((current) => {
      const isActive = current === button;
      current.classList.toggle("is-active", isActive);
      current.setAttribute("aria-pressed", String(isActive));
    });

    renderViews();
  });
});

marketFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.marketFilter = button.dataset.marketFilter;

    marketFilterButtons.forEach((current) => {
      const isActive = current === button;
      current.classList.toggle("is-active", isActive);
      current.setAttribute("aria-pressed", String(isActive));
    });

    renderViews();
  });
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.sort = button.dataset.sort;

    sortButtons.forEach((current) => {
      const isActive = current === button;
      current.classList.toggle("is-active", isActive);
      current.setAttribute("aria-pressed", String(isActive));
    });

    renderViews();
  });
});

sizeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.sizeBy = button.dataset.sizeBy;

    sizeButtons.forEach((current) => {
      const isActive = current === button;
      current.classList.toggle("is-active", isActive);
      current.setAttribute("aria-pressed", String(isActive));
    });

    renderViews();
  });
});

bubbleMapEl.addEventListener("click", (event) => {
  const bubble = event.target.closest(".bubble");
  if (!bubble) return;

  state.selectedKey = bubble.dataset.key;
  renderViews();
});

rowsEl.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;

  const row = event.target.closest(".row");
  if (!row) return;

  state.selectedKey = row.dataset.key;
  renderViews();
});

document.addEventListener("click", (event) => {
  const quickTarget = event.target.closest(".mini-row, .audit-focus");
  if (!quickTarget) return;

  state.selectedKey = quickTarget.dataset.key;
  renderViews();
  document.querySelector(".market-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

let lastMapWidth = 0;
new ResizeObserver((entries) => {
  const width = Math.round(entries[0].contentRect.width);
  if (Math.abs(width - lastMapWidth) < 4) return;
  lastMapWidth = width;
  renderViews();
}).observe(mapShellEl || bubbleMapEl);

renderSource();
summarize();
renderViews();

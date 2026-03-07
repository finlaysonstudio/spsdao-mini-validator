// State
let currentBlock = null;
let hashRawVisible = false;
let stepping = false;

// DOM refs
const content = document.getElementById("content");
const blockInput = document.getElementById("block-input");
const statusEl = document.getElementById("status");
const navInfo = document.getElementById("nav-info");
const btnNext = document.getElementById("btn-next");

// Poll status until first block is ready
async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (data.latestBlock) {
      statusEl.textContent = `Block ${data.latestBlock} | Next: ${data.nextBlockNum}`;
      navInfo.textContent = `${data.blockRange.count} blocks in store`;
      btnNext.disabled = false;

      // Auto-load first block
      if (currentBlock === null) {
        loadBlock(data.latestBlock);
        return; // stop polling
      }
    } else {
      statusEl.textContent = "Bootstrapping...";
    }
  } catch {
    statusEl.textContent = "Connection error";
  }
  setTimeout(pollStatus, 1000);
}

async function loadBlock(num) {
  try {
    const res = await fetch(`/api/blocks/${num}`);
    if (!res.ok) {
      const err = await res.json();
      content.innerHTML = `<div class="loading">${err.error || "Block not found"}</div>`;
      return;
    }
    const block = await res.json();
    currentBlock = block.blockNum;
    blockInput.value = currentBlock;
    renderBlock(block);
  } catch (e) {
    content.innerHTML = `<div class="loading">Error loading block: ${e.message}</div>`;
  }
}

async function nextBlock() {
  if (stepping) return;
  stepping = true;
  btnNext.disabled = true;
  btnNext.textContent = "Processing...";

  try {
    const res = await fetch("/api/blocks/next", { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      content.innerHTML = `<div class="loading">${err.error || "Error"}</div>`;
      return;
    }
    const block = await res.json();
    currentBlock = block.blockNum;
    blockInput.value = currentBlock;
    renderBlock(block);

    // Update status
    const statusRes = await fetch("/api/status");
    const data = await statusRes.json();
    statusEl.textContent = `Block ${data.latestBlock} | Next: ${data.nextBlockNum}`;
    navInfo.textContent = `${data.blockRange.count} blocks in store`;
  } catch (e) {
    content.innerHTML = `<div class="loading">Error: ${e.message}</div>`;
  } finally {
    stepping = false;
    btnNext.disabled = false;
    btnNext.textContent = "Next";
  }
}

function renderBlock(b) {
  const time = new Date(b.blockTime).toISOString();

  content.innerHTML = `
    <!-- Block Metadata -->
    <div class="panel">
      <div class="panel-header">Block Metadata</div>
      <div class="panel-body">
        <div class="meta-grid">
          <div class="meta-label">Block Number</div>
          <div class="meta-value">${b.blockNum}</div>
          <div class="meta-label">Block Time</div>
          <div class="meta-value">${time}</div>
          <div class="meta-label">Block ID</div>
          <div class="meta-value">${b.blockId}</div>
          <div class="meta-label">Prev Block ID</div>
          <div class="meta-value">${b.prevBlockId}</div>
          <div class="meta-label">L2 Hash</div>
          <div class="meta-value hash-result">${b.l2Hash}</div>
        </div>
      </div>
    </div>

    <!-- Hash Computation -->
    <div class="panel">
      <div class="panel-header">Hash Computation</div>
      <div class="panel-body">
        <div class="hash-formula">
          <span class="fn">SHA256</span>(<span class="hash-prev">${b.prevL2Hash}</span> <span class="op">+</span> "." <span class="op">+</span> JSON.stringify(${b.allTransactions.length} txns))
          <br>= <span class="hash-result">${b.l2Hash}</span>
        </div>
        <div class="hash-raw-toggle" id="hash-toggle" onclick="toggleHashRaw()">Show raw hash input</div>
        <div class="hash-raw" id="hash-raw" style="display:none"></div>
      </div>
    </div>

    <!-- Validator Selection -->
    <div class="panel">
      <div class="panel-header">Validator Selection</div>
      <div class="panel-body">
        <div class="validator-info">
          <div>
            ${b.selectedValidator
              ? `<span class="validator-selected">${b.selectedValidator}</span>`
              : `<span class="validator-none">No validator selected</span>`
            }
          </div>
          <div class="meta-label">Active Validators: <span class="validator-count-toggle" onclick="toggleValidatorList()">${b.activeValidatorCount}</span></div>
        </div>
        <div class="validator-list" id="validator-list">
          ${renderValidatorTable(b.activeValidators, b.selectedValidator)}
        </div>
      </div>
    </div>

    <!-- Transactions -->
    <div class="panel">
      <div class="tabs" id="tx-tabs">
        <div class="tab active" data-tab="virtual" onclick="switchTab('virtual')">
          Virtual Ops <span class="count">${b.virtualTransactions.length}</span>
        </div>
        <div class="tab" data-tab="blockchain" onclick="switchTab('blockchain')">
          Blockchain Ops <span class="count">${b.blockchainTransactions.length}</span>
        </div>
        <div class="tab" data-tab="all" onclick="switchTab('all')">
          All <span class="count">${b.allTransactions.length}</span>
        </div>
      </div>
      ${b.virtualOpBreakdown.length > 0 ? `
        <div class="panel-body" id="breakdown-panel">
          <div class="breakdown-list">
            ${b.virtualOpBreakdown.map(vb =>
              `<div class="breakdown-item"><span class="name">${vb.source}</span><span class="num">${vb.count}</span></div>`
            ).join("")}
          </div>
        </div>
      ` : ""}
      <div class="tx-list" id="tx-virtual">${renderTxList(b.virtualTransactions, b.virtualOpBreakdown)}</div>
      <div class="tx-list" id="tx-blockchain" style="display:none">${renderTxList(b.blockchainTransactions)}</div>
      <div class="tx-list" id="tx-all" style="display:none">${renderTxList(b.allTransactions)}</div>
    </div>
  `;

  // Store hash input for lazy rendering
  content._hashInput = b.hashInput;
  hashRawVisible = false;
}

function renderTxList(txns, breakdown) {
  if (txns.length === 0) {
    return `<div class="loading">No transactions</div>`;
  }

  const sourceMap = new Map();
  if (breakdown) {
    for (const vb of breakdown) {
      for (const tx of vb.transactions) {
        sourceMap.set(tx.id, vb.source);
      }
    }
  }

  return txns.map((tx) => {
    const status = tx.success ? "success" : "error";
    const statusText = tx.success ? "OK" : `ERR ${tx.error || ""}`;
    const source = sourceMap.get(tx.id);

    return `
      <div class="tx-item" onclick="toggleTxDetail(this)">
        <div class="tx-summary">
          <span class="tx-index">#${tx.index}</span>
          <span class="tx-type">${tx.type}</span>
          <span class="tx-player">${tx.player || "-"}</span>
          <span class="tx-status ${status}">${statusText}</span>
          ${source ? `<span class="tx-source">${source}</span>` : ""}
        </div>
        <div class="tx-detail">
          <div class="tx-detail-section">
            <div class="tx-detail-label">Transaction ID</div>
            <div class="tx-detail-value">${tx.id}</div>
          </div>
          ${tx.data ? `
            <div class="tx-detail-section">
              <div class="tx-detail-label">Data</div>
              <div class="tx-detail-value">${formatJson(tx.data)}</div>
            </div>
          ` : ""}
          ${tx.result ? `
            <div class="tx-detail-section">
              <div class="tx-detail-label">Result</div>
              <div class="tx-detail-value">${formatJson(tx.result)}</div>
            </div>
          ` : ""}
          ${tx.error ? `
            <div class="tx-detail-section">
              <div class="tx-detail-label">Error</div>
              <div class="tx-detail-value">${tx.error}</div>
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function formatJson(str) {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function renderValidatorTable(validators, selectedAccount) {
  if (!validators || validators.length === 0) return "";
  const maxPct = validators[0]?.votePercent ?? 1;
  return `
    <table>
      <thead><tr><th>#</th><th>Account</th><th>Vote %</th><th></th></tr></thead>
      <tbody>
        ${validators.map((v, i) => {
          const isSelected = v.account === selectedAccount;
          const barWidth = Math.max(1, Math.round((v.votePercent / maxPct) * 120));
          return `<tr class="${isSelected ? "selected" : ""}">
            <td>${i + 1}</td>
            <td>${v.account}${isSelected ? " *" : ""}</td>
            <td class="pct">${v.votePercent.toFixed(3)}%</td>
            <td><span class="vote-bar" style="width:${barWidth}px"></span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function toggleValidatorList() {
  document.getElementById("validator-list").classList.toggle("open");
}

// Keyboard: right arrow = next
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") nextBlock();
});

// Tab switching
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.getElementById("tx-virtual").style.display = tab === "virtual" ? "" : "none";
  document.getElementById("tx-blockchain").style.display = tab === "blockchain" ? "" : "none";
  document.getElementById("tx-all").style.display = tab === "all" ? "" : "none";

  const breakdownPanel = document.getElementById("breakdown-panel");
  if (breakdownPanel) {
    breakdownPanel.style.display = tab === "virtual" ? "" : "none";
  }
}

// Transaction detail toggle
function toggleTxDetail(item) {
  const detail = item.querySelector(".tx-detail");
  detail.classList.toggle("open");
}

// Hash raw input toggle
function toggleHashRaw() {
  hashRawVisible = !hashRawVisible;
  const rawEl = document.getElementById("hash-raw");
  const toggleEl = document.getElementById("hash-toggle");
  if (hashRawVisible) {
    rawEl.style.display = "";
    rawEl.textContent = content._hashInput || "";
    toggleEl.textContent = "Hide raw hash input";
  } else {
    rawEl.style.display = "none";
    toggleEl.textContent = "Show raw hash input";
  }
}

// Start polling for bootstrap completion
pollStatus();

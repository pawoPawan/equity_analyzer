# Tax Analyzer

A single-file, client-side web app for computing Indian capital gains tax from equity tradebooks exported by major brokers and platforms. No server, no data upload — everything runs in your browser.

## Supported Platforms

| Platform | Market | What to upload |
|---|---|---|
| **Charles Schwab** | US Stocks (RSU/ESPP) | Gain/Loss CSV + RBI XLS rate file |
| **IndMoney** | US Stocks + India Equity/F&O/MF | CG Statement XLS + FA Schedule XLS (US); Tradebook XLSX (India) |
| **Zerodha** | India Equity / F&O / MF | Tradebook XLSX (EQ, FO, MF separately) |
| **Groww** | India Equity / F&O / MF | Tradebook XLSX (EQ, FO, MF separately) |

## Features

- **FIFO matching** for realized gains across multiple files
- **STCG / LTCG** split with ₹1,25,000 LTCG exemption
- **Intraday detection** (same-day buy + sell → speculative business income)
- **F&O P&L** per contract with correct slab-rate tax
- **Open positions** with live sell simulator and per-lot LTCG conversion schedule
- **MF** treated separately from equity
- **Tax regime toggle** — New vs Old regime
- **Multi-platform** — analyze Schwab + Zerodha + Groww together in one session
- **IndMoney dual-market** — US and India in the same upload block
- **Collapsible** upload blocks, result sections, and per-symbol trade lots

## How to Use

1. Open `equity-analyzer.html` directly in any modern browser (no server needed)
2. Select your market(s): **US**, **India**, or both
3. Select your platform(s)
4. Upload the relevant export files for each platform
5. Click **Analyze All Selected**

### Where to get export files

- **Schwab** → Accounts → History → Export (CSV) + [RBI Reference Rate Archive](https://www.rbi.org.in/scripts/referenceratearchive.aspx) (XLS)
- **IndMoney** → Reports → Capital Gains Statement / FA Schedule
- **Zerodha** → Console → Reports → Tradebook → (EQ / FO / MF) → Export XLSX
- **Groww** → Reports → Tradebook → Export XLSX

## Build System

The app is assembled from modular source files using a Node.js build script.

```
src/
├── template.html          # HTML shell
├── css/main.css           # All styles
├── html/
│   ├── header.html        # Top bar
│   ├── landing.html       # Market & platform selection, upload blocks
│   ├── inputs.html        # Hidden <input type="file"> elements
│   └── results.html       # Results panel (all platform accordions)
└── js/
    ├── 01_globals.js      # Tax slabs, constants
    ├── 02_utils.js        # Formatters
    ├── 03_tax.js          # slabTax(), STCG/LTCG rates
    ├── 04_fifo.js         # FIFO matching, intraday, F&O P&L
    ├── 05_card_builders.js# Realized/open/F&O/intraday card HTML
    ├── 06_schwab.js       # Schwab parser & renderer
    ├── 07_indmoney.js     # IndMoney parser & renderer
    ├── 08_zerodha.js      # Zerodha parser & renderer
    ├── 09_groww.js        # Groww parser & renderer
    └── 10_landing.js      # Market/platform selection logic
```

To rebuild after editing source files:

```bash
node build.js
```

## Notes

- All computation is done client-side — no data leaves your browser
- Designed for **FY 2025-26** tax filing (India)
- Groww parser uses flexible column detection to handle export format variations
- F&O and intraday income is taxed at the correct incremental slab rate (not a flat rate)

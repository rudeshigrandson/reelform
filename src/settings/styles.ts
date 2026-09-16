/**
 * S24 Settings window styles (design: "Settings, shortcuts, extensions",
 * S24/01 Recording · S24/04 Shortcuts · S24/05–08 panels). Scoped under
 * `.rf-set`; semantic tokens only. Rendered once by `Settings`.
 *
 * Grammar: 200px pill nav on panel · Caprasimo 20px page title · 16px-radius
 * panel cards stacking rows of "label + helper line, control on the right".
 */
export const SETTINGS_CSS = `
.rf-set {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-app);
  color: var(--text-1);
  font-family: var(--font-body);
}
.rf-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* — nav — */
.rf-set-nav {
  width: 200px;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 12px;
  overflow-y: auto;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  font-size: 13px;
}
.rf-set-nav-item {
  text-align: left;
  padding: 8px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  cursor: pointer;
}
.rf-set-nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.rf-set-nav-item[aria-current="page"] {
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
}
.rf-set-nav-item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* — page — */
.rf-set-page {
  flex: 1;
  min-width: 0;
  padding: 12px 24px 24px;
  overflow-y: auto;
  font-size: 12px;
}
.rf-set-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rf-set-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rf-set-title {
  flex: 1;
  margin: 0;
  font-family: var(--font-heading);
  font-weight: var(--font-heading-weight);
  font-size: 20px;
  line-height: 1.35;
}
.rf-set-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rf-set .rf-set-btn-sm {
  padding: 7px 14px;
  font-size: 12px;
}
.rf-set .rf-set-btn-panel {
  background: var(--bg-panel);
  border-color: var(--border-strong);
}

/* — row cards (S24/01) — */
.rf-set-card {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  overflow: hidden;
  border-radius: 16px;
  background: var(--bg-panel);
}
.rf-set-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
}
.rf-set-card-dense .rf-set-row + .rf-set-row {
  padding-block: 9px;
}
.rf-set-row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rf-set-label {
  font-weight: 600;
  color: var(--text-1);
}
label.rf-set-label {
  cursor: pointer;
}
.rf-set-row[data-disabled="true"] .rf-set-label {
  color: var(--text-3);
  cursor: default;
}
.rf-set-help {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}
.rf-set-control {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 60%;
}
.rf-set-status {
  margin: 0;
  font-size: 11px;
}
.rf-set-card > .rf-set-status {
  padding: 10px 16px;
}
.rf-set-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}
.rf-set-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-hover);
  font: inherit;
  cursor: pointer;
}
.rf-set-link:hover:not(:disabled) {
  text-decoration: underline;
}
.rf-set-link:disabled {
  opacity: 0.45;
  cursor: default;
}
.rf-set-link:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 4px;
}
.rf-set-link-danger {
  color: color-mix(in srgb, var(--danger) 55%, var(--text-1));
}

/* — compact panels (S24/05 Appearance · S24/06 Updates · S24/08 Advanced) — */
.rf-set-panel {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--bg-panel);
}
.rf-set-panel-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
}
.rf-set-panel-title > :first-child {
  flex: 1;
}
.rf-set-line {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
}
.rf-set-line-label {
  flex: 1;
  min-width: 0;
  color: var(--text-2);
}
label.rf-set-line-label {
  cursor: pointer;
}
.rf-set-fit {
  align-self: flex-start;
}
.rf-set-restart {
  width: 100%;
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 400;
  background: color-mix(in srgb, var(--success) 18%, transparent);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
  color: color-mix(in srgb, var(--success) 55%, var(--text-1));
}
.rf-set-restart:hover:not(:disabled) {
  background: color-mix(in srgb, var(--success) 26%, transparent);
}
.rf-set-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rf-set-chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--bg-panel-raised);
  color: var(--text-3);
}

/* — segmented: sunken pill track, accent thumb — */
.rf-set .seg {
  padding: 3px;
  border: 0;
  border-radius: 999px;
  background: var(--bg-sunken);
  overflow: visible;
}
.rf-set .seg-opt {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-2);
}
.rf-set .seg-opt + .seg-opt {
  border-left: 0;
}
.rf-set .seg-opt:has(input:checked) {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.rf-set .seg-opt:not(:has(input:checked)):hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.rf-set .seg-opt:has(input:focus-visible) {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
.rf-set .rf-seg-wide .seg-opt {
  padding: 5px 16px;
}
.rf-set .rf-seg-fit .seg-opt {
  padding: 5px 14px;
  font-size: 11px;
}
.rf-set .rf-seg-compact .seg-opt {
  padding: 4px 12px;
  font-size: 11px;
}
.rf-set .rf-seg-fill {
  display: flex;
  align-self: stretch;
}
.rf-set .rf-seg-fill .seg-opt {
  flex: 1;
  justify-content: center;
  padding: 5px;
  font-size: 11px;
}

/* — pill select — */
.rf-set-select {
  position: relative;
  display: inline-flex;
  width: 250px;
  max-width: 100%;
}
.rf-set-select select {
  appearance: none;
  width: 100%;
  padding: 7px 30px 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-1);
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.rf-set-select select:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--text-1) 35%, transparent);
}
.rf-set select:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.rf-set select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.rf-set option {
  background: var(--bg-panel-raised);
  color: var(--text-1);
}
.rf-set-chevron {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-60%);
  color: var(--text-3);
  pointer-events: none;
}
/* Inline "Comfortable ⌄" select in compact panels. */
.rf-set-mini-select {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.rf-set-mini-select select {
  appearance: none;
  padding: 0 14px 0 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-1);
  font: inherit;
  font-size: 11px;
  text-align: right;
  cursor: pointer;
}
.rf-set-mini-select .rf-set-chevron {
  right: 0;
}

/* — read-only path pill — */
.rf-set-path {
  width: 250px;
  min-width: 0;
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
}
.rf-set-path:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* — toggle: 34×19 (rows), 32×18 (compact panels) — */
.rf-set-switch {
  position: relative;
  flex: none;
  display: inline-flex;
  width: 34px;
  height: 19px;
}
.rf-set-switch input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.rf-set-switch input:disabled {
  cursor: not-allowed;
}
.rf-set-switch-track {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--bg-panel-raised);
  transition: background 0.15s ease;
}
.rf-set-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 999px;
  background: var(--text-3);
  transition: left 0.15s ease, background 0.15s ease;
}
.rf-set-switch input:checked ~ .rf-set-switch-track {
  background: var(--accent);
}
.rf-set-switch input:checked ~ .rf-set-switch-thumb {
  left: 17px;
  background: var(--bg-app);
}
.rf-set-switch-sm {
  width: 32px;
  height: 18px;
}
.rf-set-switch-sm .rf-set-switch-thumb {
  width: 14px;
  height: 14px;
}
.rf-set-switch-sm input:checked ~ .rf-set-switch-thumb {
  left: 16px;
}
.rf-set-switch input:focus-visible ~ .rf-set-switch-track {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.rf-set-switch:has(input:disabled) {
  opacity: 0.45;
}

/* — number value: reads as mono text, edits in place — */
.rf-set-number {
  width: 64px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-family: var(--font-mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.rf-set-number::-webkit-inner-spin-button,
.rf-set-number::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}
.rf-set-number:hover:not(:disabled),
.rf-set-number:focus {
  border-color: var(--border-strong);
  background: var(--bg-sunken);
  color: var(--text-1);
}
.rf-set-number:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.rf-set-number[aria-invalid="true"] {
  border-color: var(--danger);
}
.rf-set-number:disabled {
  opacity: 0.45;
}
.rf-set-suffix {
  margin-left: -4px;
  font-family: var(--font-mono);
  color: var(--text-2);
}

/* — slider: 4px raised track, accent fill (inline gradient), light knob — */
.rf-set-range {
  appearance: none;
  width: 180px;
  height: 4px;
  margin: 0;
  border-radius: 999px;
  cursor: pointer;
}
.rf-set-range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--text-1);
  box-shadow: var(--shadow-sm);
}
.rf-set-range:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 6px;
}
.rf-set-range:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* — progress — */
.rf-set-progress {
  appearance: none;
  width: 100%;
  height: 4px;
  border: 0;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bg-sunken);
}
.rf-set-progress::-webkit-progress-bar {
  background: var(--bg-sunken);
  border-radius: 999px;
}
.rf-set-progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: 999px;
}

/* — accent swatches (22px dots, selected ring) — */
.rf-set-swatches {
  display: flex;
  align-items: center;
  gap: 7px;
}
.rf-set-swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}
.rf-set-swatch[aria-checked="true"] {
  outline: 2px solid var(--text-1);
  outline-offset: 2px;
}
.rf-set-swatch:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* — release notes — */
.rf-set-details > summary {
  list-style: none;
  cursor: pointer;
  font-weight: 600;
}
.rf-set-details > summary::-webkit-details-marker {
  display: none;
}
.rf-set-details > summary::after {
  content: "⌄";
  margin-left: auto;
  color: var(--text-3);
}
.rf-set-details[open] > summary::after {
  transform: rotate(180deg);
}
.rf-set-details > summary:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
  border-radius: 16px;
}
.rf-set-notes {
  margin: 0 16px 14px;
  padding: 12px 14px;
  max-height: 220px;
  overflow-y: auto;
  border-radius: 8px;
  background: var(--bg-sunken);
  color: var(--text-2);
}
.rf-set-notes p {
  margin: 0 0 4px;
}

/* — about (extrapolated) — */
.rf-set-mark {
  width: 38px;
  height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--accent);
  color: var(--on-accent);
  font-family: var(--font-heading);
  font-size: 20px;
}
.rf-set-appname {
  font-family: var(--font-heading);
  font-weight: var(--font-heading-weight);
  font-size: 16px;
}

/* — extensions list card (S24/07) — */
.rf-set-ext {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--bg-panel);
}
.rf-set-ext-icon {
  width: 38px;
  height: 38px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-size: 18px;
}
.rf-set-ext-name {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

/* — shortcuts (S24/04): search, group labels, cards of action · keycap · reset — */
.rf-sc-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 180px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: 11px;
}
.rf-sc-search:focus-within {
  border-color: var(--accent);
}
.rf-sc-search input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-1);
  font: inherit;
}
.rf-sc-search input::placeholder {
  color: var(--text-3);
}
.rf-kbd {
  display: inline-block;
  padding: 4px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}
.rf-kbd-live {
  padding-inline: 12px;
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-hover);
}
.rf-sc-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
.rf-sc-group th {
  padding: 10px 0;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}
.rf-sc-table tbody:first-of-type .rf-sc-group th {
  padding-top: 0;
}
.rf-sc-row td {
  padding: 10px 0;
  vertical-align: middle;
  background: var(--bg-panel);
}
.rf-sc-row td:first-child { padding-left: 16px; }
.rf-sc-row td:last-child { padding-right: 16px; }
.rf-sc-row td + td { padding-left: 12px; }
.rf-sc-row[data-recording="true"] td {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-panel));
}
.rf-sc-row:nth-child(2) td:first-child { border-top-left-radius: 16px; }
.rf-sc-row:nth-child(2) td:last-child { border-top-right-radius: 16px; }
.rf-sc-row:last-child td:first-child { border-bottom-left-radius: 16px; }
.rf-sc-row:last-child td:last-child { border-bottom-right-radius: 16px; }
.rf-sc-action .rf-set-status {
  margin-top: 8px;
}
.rf-sc-keys {
  white-space: nowrap;
  text-align: right;
}
.rf-sc-keys > * + * {
  margin-left: 6px;
}
.rf-sc-reset {
  width: 52px;
  text-align: right;
  white-space: nowrap;
}
.rf-sc-key {
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-1);
  font: inherit;
  cursor: pointer;
}
.rf-sc-key:hover .rf-kbd {
  border-color: color-mix(in srgb, var(--text-1) 35%, transparent);
}
.rf-sc-key:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.rf-sc-muted {
  color: var(--text-3);
}
.rf-sc-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-3);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.rf-sc-link:hover:not(:disabled) {
  color: var(--accent-hover);
}
.rf-sc-link:disabled {
  opacity: 0.45;
  cursor: default;
}
.rf-sc-link:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: 4px;
}
`;

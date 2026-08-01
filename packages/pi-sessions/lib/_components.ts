/**
 * pi-sessions — sidebar UI components (private module)
 *
 * Session and folder overlays with keyboard navigation and live filtering.
 */

import { homedir } from "node:os";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { SIDEBAR_OVERHEAD } from "./_constants.ts";
import type { SessionSummary, FolderSummary } from "./_types.ts";
import { formatDate } from "./_sessions.ts";

const ITEM_ROWS = 4;

function visibleItemCount(terminalRows: number): number {
  const availableRows = Math.max(ITEM_ROWS, terminalRows - SIDEBAR_OVERHEAD - 2);
  return Math.min(10, Math.max(1, Math.floor((availableRows + 1) / ITEM_ROWS)));
}

function modalRow(theme: Theme, content: string, innerWidth: number): string {
  const clipped = truncateToWidth(content, innerWidth, "", true);
  return theme.fg("border", "│")
    + clipped
    + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))
    + theme.fg("border", "│");
}

// ── Async catalogue modal ─────────────────────────────────────────

type CatalogModalResult = SessionSummary | FolderSummary | undefined;
type CatalogModalState = "loading" | "empty" | "error" | "ready" | "disposed";

export class SessionCatalogModalComponent implements Focusable {
  private _focused = false;
  private state: CatalogModalState = "loading";
  private child: SessionSidebarComponent | FolderSidebarComponent | undefined;
  private loaded = 0;
  private total = 0;
  private errorMessage = "";

  constructor(
    private readonly theme: Theme,
    private readonly done: (result: CatalogModalResult) => void,
    private readonly terminalRows: number,
    private readonly title: string,
    private readonly loadingMessage: string,
  ) {}

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (this.child) this.child.focused = value;
  }

  setProgress(loaded: number, total: number): void {
    if (this.state !== "loading") return;
    this.loaded = loaded;
    this.total = total;
  }

  showSessions(sessions: SessionSummary[], title = "📋 Sessions"): void {
    if (this.state === "disposed") return;
    if (sessions.length === 0) {
      this.state = "empty";
      return;
    }
    this.child = new SessionSidebarComponent(
      this.theme,
      sessions,
      (result) => this.done(result),
      this.terminalRows,
      title,
    );
    this.child.focused = this._focused;
    this.state = "ready";
  }

  showFolders(folders: FolderSummary[]): void {
    if (this.state === "disposed") return;
    if (folders.length === 0) {
      this.state = "empty";
      return;
    }
    this.child = new FolderSidebarComponent(
      this.theme,
      folders,
      (result) => this.done(result),
      this.terminalRows,
    );
    this.child.focused = this._focused;
    this.state = "ready";
  }

  showError(error: unknown): void {
    if (this.state === "disposed") return;
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.state = "error";
  }

  handleInput(data: string): void {
    if (this.child) {
      this.child.handleInput(data);
      return;
    }
    if (
      matchesKey(data, Key.escape)
      || matchesKey(data, Key.ctrl("c"))
      || (this.state !== "loading" && matchesKey(data, Key.enter))
    ) {
      this.done(undefined);
    }
  }

  render(width: number): string[] {
    if (this.child) return this.child.render(width);
    if (width < 2) return [""];

    const innerWidth = width - 2;
    const border = (value: string) => this.theme.fg("border", value);
    const progress = this.total > 0 ? ` ${this.loaded}/${this.total}` : "";
    const message = this.state === "loading"
      ? `${this.loadingMessage}${progress}`
      : this.state === "error"
        ? `Error loading sessions: ${this.errorMessage}`
        : "No sessions found.";

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      modalRow(this.theme, ` ${this.theme.fg("accent", this.theme.bold(this.title))}`, innerWidth),
      border(`├${"─".repeat(innerWidth)}┤`),
      modalRow(this.theme, "", innerWidth),
      modalRow(this.theme, ` ${this.theme.fg(this.state === "error" ? "error" : "muted", message)}`, innerWidth),
      modalRow(this.theme, "", innerWidth),
      modalRow(this.theme, ` ${this.theme.fg("dim", "Esc close")}`, innerWidth),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  invalidate(): void {
    this.child?.invalidate();
  }

  dispose(): void {
    this.child?.dispose();
    this.child = undefined;
    this.state = "disposed";
  }
}

// ── Session Sidebar Component ─────────────────────────────────────

export class SessionSidebarComponent implements Focusable {
  /** Focusable interface - set by TUI when focus changes */
  focused = false;

  private sessions: SessionSummary[] = [];
  private filtered: SessionSummary[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private query = "";
  private theme: Theme;
  private done: (result: SessionSummary | undefined) => void;
  /** Number of session items that fit in the overlay */
  private visibleItems: number;

  private title: string;

  constructor(
    theme: Theme,
    sessions: SessionSummary[],
    done: (result: SessionSummary | undefined) => void,
    terminalRows: number,
    title = "📋 Sessions",
  ) {
    this.theme = theme;
    this.sessions = sessions;
    this.filtered = [...sessions];
    this.done = done;
    this.title = title;
    this.visibleItems = visibleItemCount(terminalRows);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
        this.done(selected);
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        // Scroll when cursor goes above the visible window
        if (this.selectedIndex < this.scrollOffset) {
          this.scrollOffset = this.selectedIndex;
        }
      }
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.filtered.length - 1) {
        this.selectedIndex++;
        // Scroll when cursor goes below the visible window
        if (this.selectedIndex >= this.scrollOffset + this.visibleItems) {
          this.scrollOffset = this.selectedIndex - this.visibleItems + 1;
        }
      }
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = this.filtered.length - 1;
      this.scrollOffset = Math.max(0, this.selectedIndex - this.visibleItems + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleItems);
      this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleItems);
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(
        this.filtered.length - 1,
        this.selectedIndex + this.visibleItems,
      );
      this.scrollOffset = Math.min(
        this.filtered.length - this.visibleItems,
        this.scrollOffset + this.visibleItems,
      );
    } else if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.selectedIndex = 0;
        this.scrollOffset = 0;
      }
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      // Printable character - filter
      this.query += data;
      this.applyFilter();
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.ctrl("c"))) {
      this.done(undefined);
    }
  }

  private applyFilter(): void {
    if (!this.query) {
      this.filtered = [...this.sessions];
      return;
    }

    const q = this.query.toLowerCase();
    this.filtered = this.sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.lastUserMessage && s.lastUserMessage.toLowerCase().includes(q)) ||
        (s.model && s.model.toLowerCase().includes(q)) ||
        (s.cwd && s.cwd.toLowerCase().includes(q)),
    );
  }

  render(width: number): string[] {
    if (width < 2) return [""];
    const w = width;
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const row = (content: string) => modalRow(th, content, innerW);
    const selectedStyle = (s: string) => th.bg("selectedBg", th.fg("accent", s));
    const normalStyle = (s: string) => th.fg("text", s);

    // ── Header ──
    // Overlay: rounded top, compact popup style
    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(
      row(
        ` ${th.fg("accent", th.bold(this.title))} ${th.fg("dim", `(${this.sessions.length})`)}`,
      ),
    );
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Search bar ──
    const searchLabel = th.fg("dim", "🔍 ");
    const searchPrefix = this.focused ? "" : "";
    const cursorMark = this.focused ? "" : "";
    const searchText = this.query || th.fg("dim", "Filter...");
    const searchLine = `${searchLabel}${searchPrefix}${searchText}${cursorMark}`;
    lines.push(row(searchLine));
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Sessions list ──
    const displayItems = this.filtered.slice(
      this.scrollOffset,
      this.scrollOffset + this.visibleItems,
    );

    if (displayItems.length === 0) {
      lines.push(row(` ${th.fg("dim", "No sessions found")}`));
    } else {
      for (let i = 0; i < displayItems.length; i++) {
        const session = displayItems[i]!;
        const idx = this.scrollOffset + i;
        const isSelected = idx === this.selectedIndex;

        // Folder / project path (prominent)
        const folderDisplay = session.cwd
          ? session.cwd.replace(homedir(), "~")
          : "unknown";
        const folderStr = truncateToWidth(folderDisplay, innerW - 8);
        const folderLine = isSelected
          ? selectedStyle(` ▶ 📁 ${folderStr}`)
          : normalStyle(`   📁 ${folderStr}`);
        lines.push(row(folderLine));

        // Last user message
        if (session.lastUserMessage) {
          const msgStr = truncateToWidth(session.lastUserMessage, innerW - 6);
          const msgLine = `  ${th.fg("text", `"${msgStr}"`)}`;
          lines.push(row(isSelected ? selectedStyle(msgLine) : msgLine));
        }

        // Session meta: date + messages + model
        const dateStr = formatDate(session.date);
        const metaParts: string[] = [];
        if (dateStr) metaParts.push(dateStr);
        metaParts.push(`${session.messageCount} msgs`);
        if (session.model) {
          const shortModel = session.model.includes("/")
            ? session.model.split("/").pop() ?? session.model
            : session.model;
          metaParts.push(shortModel);
        }
        if (session.provider) {
          metaParts.push(session.provider);
        }
        const metaStr = truncateToWidth(
          `  ${th.fg("dim", metaParts.join(" · "))}`,
          innerW - 2,
        );
        lines.push(row(isSelected ? selectedStyle(metaStr) : metaStr));

        // Spacer between sessions
        if (i < displayItems.length - 1) {
          lines.push(row(""));
        }
      }
    }

    // ── Footer ──
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // Scroll indicators
    const aboveCount = this.scrollOffset;
    const belowCount = Math.max(0, this.filtered.length - (this.scrollOffset + this.visibleItems));
    let scrollHint = "";
    if (aboveCount > 0) scrollHint += `↑${aboveCount} `;
    if (belowCount > 0) scrollHint += `↓${belowCount} `;

    const footerHint =
      this.filtered.length > 0
        ? `${scrollHint}↑↓ navigate • Enter load • ${this.filtered.length} total`
        : "Esc close";
    lines.push(row(` ${th.fg("dim", truncateToWidth(footerHint, innerW - 2))}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

// ── Folder Sidebar Component ───────────────────────────────────────

export class FolderSidebarComponent implements Focusable {
  focused = false;

  private folders: FolderSummary[] = [];
  private filtered: FolderSummary[] = [];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private query = "";
  private theme: Theme;
  private done: (result: FolderSummary | undefined) => void;
  private visibleItems: number;

  constructor(
    theme: Theme,
    folders: FolderSummary[],
    done: (result: FolderSummary | undefined) => void,
    terminalRows: number,
  ) {
    this.theme = theme;
    this.folders = folders;
    this.filtered = [...folders];
    this.done = done;
    this.visibleItems = visibleItemCount(terminalRows);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      const selected = this.filtered[this.selectedIndex];
      if (selected) {
        this.done(selected);
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        if (this.selectedIndex < this.scrollOffset) {
          this.scrollOffset = this.selectedIndex;
        }
      }
    } else if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < this.filtered.length - 1) {
        this.selectedIndex++;
        if (this.selectedIndex >= this.scrollOffset + this.visibleItems) {
          this.scrollOffset = this.selectedIndex - this.visibleItems + 1;
        }
      }
    } else if (matchesKey(data, Key.home)) {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    } else if (matchesKey(data, Key.end)) {
      this.selectedIndex = this.filtered.length - 1;
      this.scrollOffset = Math.max(0, this.selectedIndex - this.visibleItems + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleItems);
      this.scrollOffset = Math.max(0, this.scrollOffset - this.visibleItems);
    } else if (matchesKey(data, Key.pageDown)) {
      this.selectedIndex = Math.min(this.filtered.length - 1, this.selectedIndex + this.visibleItems);
      this.scrollOffset = Math.min(this.filtered.length - this.visibleItems, this.scrollOffset + this.visibleItems);
    } else if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.applyFilter();
        this.selectedIndex = 0;
        this.scrollOffset = 0;
      }
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.query += data;
      this.applyFilter();
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    }
  }

  private applyFilter(): void {
    if (!this.query) {
      this.filtered = [...this.folders];
      return;
    }

    const q = this.query.toLowerCase();
    this.filtered = this.folders.filter(
      (f) =>
        f.folder.toLowerCase().includes(q) ||
        (f.lastUserMessage && f.lastUserMessage.toLowerCase().includes(q)) ||
        (f.latestModel && f.latestModel.toLowerCase().includes(q)),
    );
  }

  render(width: number): string[] {
    if (width < 2) return [""];
    const w = width;
    const th = this.theme;
    const innerW = w - 2;
    const lines: string[] = [];

    const row = (content: string) => modalRow(th, content, innerW);
    const selectedStyle = (s: string) => th.bg("selectedBg", th.fg("accent", s));
    const normalStyle = (s: string) => th.fg("text", s);

    // ── Header ──
    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
    lines.push(
      row(
        ` ${th.fg("accent", th.bold("📁 Projects"))} ${th.fg("dim", `(${this.folders.length})`)}`,
      ),
    );
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Search bar ──
    const searchLabel = th.fg("dim", "🔍 ");
    const searchText = this.query || th.fg("dim", "Filter...");
    const searchLine = `${searchLabel}${searchText}`;
    lines.push(row(searchLine));
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    // ── Folder list ──
    const displayItems = this.filtered.slice(this.scrollOffset, this.scrollOffset + this.visibleItems);

    if (displayItems.length === 0) {
      lines.push(row(` ${th.fg("dim", "No projects found")}`));
    } else {
      for (let i = 0; i < displayItems.length; i++) {
        const folder = displayItems[i]!;
        const idx = this.scrollOffset + i;
        const isSelected = idx === this.selectedIndex;

        // Folder path
        const displayPath = folder.folder.replace(homedir(), "~");
        const folderStr = truncateToWidth(displayPath, innerW - 8);
        const folderLine = isSelected
          ? selectedStyle(` ▶ 📁 ${folderStr}`)
          : normalStyle(`   📁 ${folderStr}`);
        lines.push(row(folderLine));

        // Last user message from latest session
        if (folder.lastUserMessage) {
          const msgStr = truncateToWidth(folder.lastUserMessage, innerW - 6);
          const msgLine = `  ${th.fg("text", `"${msgStr}"`)}`;
          lines.push(row(isSelected ? selectedStyle(msgLine) : msgLine));
        }

        // Aggregated metadata
        const dateStr = formatDate(folder.latestDate);
        const metaParts: string[] = [];
        if (dateStr) metaParts.push(dateStr);
        metaParts.push(`${folder.sessionCount} sessions`);
        metaParts.push(`${folder.totalMessages} msgs`);
        if (folder.latestModel) {
          const shortModel = folder.latestModel.includes("/")
            ? folder.latestModel.split("/").pop() ?? folder.latestModel
            : folder.latestModel;
          metaParts.push(shortModel);
        }
        const metaStr = truncateToWidth(
          `  ${th.fg("dim", metaParts.join(" · "))}`,
          innerW - 2,
        );
        lines.push(row(isSelected ? selectedStyle(metaStr) : metaStr));

        // Spacer
        if (i < displayItems.length - 1) {
          lines.push(row(""));
        }
      }
    }

    // ── Footer ──
    lines.push(th.fg("border", `├${"─".repeat(innerW)}┤`));

    const aboveCount = this.scrollOffset;
    const belowCount = Math.max(0, this.filtered.length - (this.scrollOffset + this.visibleItems));
    let scrollHint = "";
    if (aboveCount > 0) scrollHint += `↑${aboveCount} `;
    if (belowCount > 0) scrollHint += `↓${belowCount} `;

    const footerHint = this.filtered.length > 0
      ? `${scrollHint}↑↓ navigate • Enter drill-down • ${this.filtered.length} total`
      : "Esc close";
    lines.push(row(` ${th.fg("dim", truncateToWidth(footerHint, innerW - 2))}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

/**
 * pi-statusline - session name on the editor's top border
 *
 * pi draws the streaming spinner, compaction and retry status on the top border
 * of the editor, left aligned (`── ⠋ Thinking… ──────────`). This module mirrors
 * that block on the right edge with the current session name, so a renamed chat
 * stays readable while typing and disappears again when the session has none.
 */

import { CustomEditor } from '@earendil-works/pi-coding-agent';
import type { KeybindingsManager } from '@earendil-works/pi-coding-agent';
import type { EditorTheme, TUI } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

/** Closing glyphs of the mirrored block: one space, then the two dashes that end the border. */
const TRAILING_GLYPHS = ' ──';

/** Columns of the block that are not the name (leading space plus {@link TRAILING_GLYPHS}). */
const BLOCK_OVERHEAD = 1 + visibleWidth(TRAILING_GLYPHS);

/** Columns kept free for the status block pi draws on the left (`── ⠋ `). */
const MIN_STATUS_WIDTH = 12;

/** The name never takes more than this share of the border, so the status stays readable. */
const MAX_NAME_SHARE = 0.5;

/** Shortest useful abbreviation of a long name, ellipsis included. */
const MIN_NAME_WIDTH = 4;

/** Appended to a name that does not fit. */
const ELLIPSIS = '…';

/** Colours for the mirrored block. */
export interface TopBorderOptions {
  /** Colours the added glyphs, so they match the editor's own border. */
  color: (text: string) => string;
}

/**
 * Mirror the session name on the right edge of the editor's top border.
 *
 * The line is returned untouched when the session has no name, when `width` is
 * not positive, or when the border is too narrow to keep the left status block
 * readable without shrinking the name below {@link MIN_NAME_WIDTH}.
 *
 * @param borderLine - The border line pi rendered, ANSI coloured and exactly `width` columns wide.
 * @param sessionName - Current session display name, if any.
 * @param width - Terminal columns available to the editor.
 * @param options - Colour function applied to the added glyphs.
 * @returns A line of exactly `width` columns when a name is shown, otherwise `borderLine`.
 */
export function decorateTopBorder(
  borderLine: string,
  sessionName: string | undefined,
  width: number,
  options: TopBorderOptions
): string {
  const name = sessionName?.trim();
  const nameBudget = Math.min(width - MIN_STATUS_WIDTH - BLOCK_OVERHEAD, Math.floor(width * MAX_NAME_SHARE));

  if (!name || width <= 0 || nameBudget < MIN_NAME_WIDTH) {
    return borderLine;
  }

  const shown = visibleWidth(name) > nameBudget ? truncateToWidth(name, nameBudget, ELLIPSIS) : name;
  const blockWidth = visibleWidth(shown) + BLOCK_OVERHEAD;
  const head = truncateToWidth(borderLine, width - blockWidth, '');

  return `${head}${options.color(` ${shown}${TRAILING_GLYPHS}`)}`;
}

/** Options for {@link createSessionNameEditor}. */
export interface SessionNameEditorOptions {
  /** Current session display name, read on every render so a rename shows immediately. */
  getSessionName: () => string | undefined;
  /** Receives the TUI the editor was built for, so the caller can request renders. */
  onTui?: (tui: TUI) => void;
}

/**
 * Build the editor component class that stamps the session name on the border.
 *
 * Extends pi's `CustomEditor` so application keybindings, the embedded working
 * status and autocomplete keep working: only the top border line is decorated,
 * through pi's own `renderTopBorder` hook. The name is painted with the
 * editor's `borderColor`, which is the colour of the border glyphs itself and
 * the colour pi uses for the status indicator embedded in that same border, so
 * it follows the thinking level and the bash-mode border.
 *
 * @param options - Session name source and TUI callback.
 * @returns An editor component class ready for `ctx.ui.setEditorComponent`.
 */
export function createSessionNameEditor(
  options: SessionNameEditorOptions
): new (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => CustomEditor {
  return class SessionNameEditor extends CustomEditor {
    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
      // embedWorkingStatus keeps pi's spinner, compaction and retry status on
      // the border this class decorates. Without it pi renders those indicators
      // in a separate row and the label would sit on a bare line. pi copies
      // padding, border colour and autocomplete width onto the instance itself.
      super(tui, theme, keybindings, { embedWorkingStatus: true });
      options.onTui?.(tui);
    }

    protected renderTopBorder(width: number, hiddenLineCount: number): string {
      const line = super.renderTopBorder(width, hiddenLineCount);

      return decorateTopBorder(line, options.getSessionName(), width, {
        color: (text) => this.borderColor(text),
      });
    }
  };
}

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
import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

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
 * Clip a session title to a column budget without leaving an escape inside it.
 *
 * A reset inside the coloured block ends the border colour early, which paints
 * the ellipsis and the closing dashes in the default colour. The title is also
 * stripped of terminal sequences: a session name comes from `/name` and must not
 * be able to style the border.
 *
 * @param title - Raw session name.
 * @param budget - Columns available, ellipsis included.
 * @returns A plain string no wider than `budget`.
 */
export function clipTitle(title: string, budget: number): string {
  const plain = stripTerminalSequences(title).trim();

  if (budget <= 0) {
    return '';
  }

  if (visibleWidth(plain) <= budget) {
    return plain;
  }

  const ellipsisWidth = visibleWidth(ELLIPSIS);

  if (budget <= ellipsisWidth) {
    return ELLIPSIS;
  }

  // A wide glyph in the last column is dropped rather than split, so shrink
  // until the slice plus the ellipsis really fits the budget.
  let room = budget - ellipsisWidth;
  let text = sliceByColumn(plain, 0, room);

  while (room > 0 && visibleWidth(text) + ellipsisWidth > budget) {
    room -= ellipsisWidth;
    text = sliceByColumn(plain, 0, room);
  }

  return `${text}${ELLIPSIS}`;
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

  const shown = clipTitle(name, nameBudget);
  const blockWidth = visibleWidth(shown) + BLOCK_OVERHEAD;
  const head = truncateToWidth(borderLine, width - blockWidth, '');
  const decorated = `${head}${options.color(` ${shown}${TRAILING_GLYPHS}`)}`;

  // Never hand the editor a line wider than the frame it asked for.
  return visibleWidth(decorated) <= width ? decorated : borderLine;
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

      try {
        return decorateTopBorder(line, options.getSessionName(), width, {
          color: (text) => this.borderColor(text),
        });
      } catch {
        // A decoration must never break the editor frame: an exception here
        // stops the TUI render loop, and the screen stays stale until a key.
        return line;
      }
    }
  };
}

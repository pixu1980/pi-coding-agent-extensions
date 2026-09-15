/**
 * pi-ask - chat-language detection for interview UI labels
 *
 * The `interview` tool renders its progress header (`Interview 1/2`) and the
 * review-tab hint (`next interview`) in the language of the chat, so a user
 * writing in Italian sees `Intervista 1/2` and `prossima intervista`.
 *
 * Language is detected from recent user messages: the `context` event fires
 * before every LLM call with the full conversation, and the `input` event
 * carries each interactive message. Both feed a small stopword-based
 * heuristic; English is the default when nothing matches. Source code,
 * comments and docs stay in English - only these two UI strings are
 * localized.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Stopwords per language, matched as lowercase substrings. Keep the lists
 * short: they only need to tip the score, not classify exhaustively.
 */
const STOPWORDS: Record<string, string[]> = {
  it: [
    'fammi',
    'fai',
    'vorrei',
    'puoi',
    'devi',
    'devo',
    'grazie',
    'perché',
    "perche'",
    'dammi',
    'anche',
    'questo',
    'questa',
    'qualche',
    'intervistami',
  ],
  en: [
    'the',
    'please',
    'could',
    'would',
    'want',
    'need',
    'help',
    'thanks',
    'because',
    'maybe',
    'what',
    'when',
    'where',
    'who',
    'should',
    'this',
  ],
  es: ['por favor', 'quiero', 'puedes', 'gracias', 'qué', 'cómo', 'cuándo', 'dónde', 'necesito', 'debería', 'hazme'],
  fr: ['svp', "s'il vous plaît", 'voudrais', 'peux', 'merci', 'quoi', 'comment', 'quand', 'où', 'besoin', 'fais-moi'],
  de: ['bitte', 'möchte', 'kannst', 'danke', 'was', 'wie', 'wann', 'wo', 'brauche', 'sollte', 'mach'],
};

/**
 * Localized word for the interview progress header (e.g. `Intervista 1/2`)
 * and the review-tab next-chunk hint (`Press Enter to submit next
 * interview`). The hint suffix already includes the language's word for
 * "next", so it reads naturally: `next interview`, `prossima intervista`.
 */
const INTERVIEW_WORDS: Record<string, { label: string; next: string }> = {
  en: { label: 'Interview', next: 'next interview' },
  it: { label: 'Intervista', next: 'prossima intervista' },
  es: { label: 'Entrevista', next: 'siguiente entrevista' },
  fr: { label: 'Entretien', next: 'prochain entretien' },
  de: { label: 'Interview', next: 'nächstes Interview' },
};

/** Last language detected from the chat. */
let detectedLanguage = 'en';

/**
 * Score recent user texts against the stopword lists and return the best
 * language. Ties and empty input keep the incumbent detection; the very
 * first call falls back to English.
 */
export function detectChatLanguage(texts: Iterable<string>): string {
  const scores: Record<string, number> = {};

  for (const [lang, words] of Object.entries(STOPWORDS)) {
    let score = 0;

    for (const text of texts) {
      const lower = text.toLowerCase();

      for (const word of words) {
        if (lower.includes(word)) {
          score++;
        }
      }
    }

    scores[lang] = score;
  }

  let best: string = detectedLanguage;
  let bestScore = -1;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }

  return bestScore <= 0 ? 'en' : best;
}

/**
 * Re-detect the chat language from recent user texts and cache it for the
 * interview UI. Returns the detected language.
 */
export function trackChatLanguage(texts: Iterable<string>): string {
  detectedLanguage = detectChatLanguage(texts);

  return detectedLanguage;
}

/** Localized word used in the interview progress header. */
export function chatInterviewLabel(): string {
  return INTERVIEW_WORDS[detectedLanguage]?.label ?? 'Interview';
}

/** Localized suffix for "Press Enter to submit <next chunk>". */
export function chatInterviewNextSuffix(): string {
  return INTERVIEW_WORDS[detectedLanguage]?.next ?? 'next interview';
}

/** Reset the cached language to English (test isolation). */
export function resetChatLanguageForTests(): void {
  detectedLanguage = 'en';
}

/** Extract the text of an agent message, whatever the content shape. */
function messageText(message: { role?: string; content?: unknown }): string {
  if (message.role !== 'user') {
    return '';
  }

  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text ?? '') : ''
      )
      .join(' ');
  }

  return '';
}

/**
 * Watch the conversation for the chat language: `context` fires before every
 * LLM call with the recent messages, `input` carries each interactive user
 * message. Register once from the extension factory.
 */
export function registerChatLanguageTracking(pi: ExtensionAPI) {
  pi.on('context', (event) => {
    const recentUserTexts: string[] = [];

    for (const message of event.messages.slice(-4)) {
      const text = messageText(message);

      if (text.trim()) {
        recentUserTexts.push(text);
      }
    }

    if (recentUserTexts.length > 0) {
      trackChatLanguage(recentUserTexts);
    }
  });
  pi.on('input', (event) => {
    if (event.source !== 'interactive') {
      return { action: 'continue' };
    }

    const text = (event.text ?? '').trim();

    if (text) {
      trackChatLanguage([text]);
    }

    return { action: 'continue' };
  });
}

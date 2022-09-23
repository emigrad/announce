import escapeStringRegexp from 'escape-string-regexp'

export function getTopicSelectorRegExp(topicSelector: string): RegExp {
  const regExpStr = topicSelector
    .split('.')
    .map((word) => `${getWordRegExpString(word)}`)
    .join('')

  return new RegExp(`^${regExpStr}$`)
}

function getWordRegExpString(word: string): string {
  switch (word) {
    case '*':
      return '(^|\\.)[^.]+'
    case '**':
      return '((^|\\.)[^.]+)*'
    default:
      return `(^|\\.)${escapeStringRegexp(word)}`
  }
}

export function convertBindingWildcards(topic: string): string {
  return topic.replace(/\*\*/g, '#')
}

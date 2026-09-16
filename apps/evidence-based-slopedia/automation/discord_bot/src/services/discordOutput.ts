export const DISCORD_MAX_CONTENT = 2000;

export function safeListOutput(header: string, lines: string[], limit = DISCORD_MAX_CONTENT): string {
  const source = lines.length ? lines : ["No entries."];
  const output = [header];
  for (let index = 0; index < source.length; index += 1) {
    const remaining = source.length - index - 1;
    const suffix = remaining ? `\n... and ${remaining} more` : "";
    const candidate = [...output, source[index] + suffix].join("\n");
    if (candidate.length > limit) {
      const more = `... and ${source.length - index} more`;
      return [...output, more].join("\n").slice(0, limit);
    }
    output.push(source[index]);
  }
  return output.join("\n");
}

export function safeSections(header: string, sections: Array<{ label: string; items: string[] }>, limit = DISCORD_MAX_CONTENT): string {
  const lines = [header];
  for (const section of sections) {
    lines.push(`${section.label} (${section.items.length}):`);
    for (const item of section.items) {
      const candidate = [...lines, item].join("\n");
      if (candidate.length + 24 > limit) return `${[...lines, `... output truncated; see counts above`].join("\n")}`.slice(0, limit);
      lines.push(item);
    }
  }
  return lines.join("\n").slice(0, limit);
}

// Shared helpers for hook scripts. The hook scripts themselves execute on
// import, so any logic worth unit-testing lives here instead.

// POSIX single-quote escaping: the only character that needs handling
// inside single quotes is the single quote itself. Unlike double quotes,
// this neutralizes backticks, $(...), and variable expansion.
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expanded = escaped
    .replace(/\\\{([^}]+)\\\}/g, (_, group) => `(${group.split(',').join('|')})`)
    .replace(/\*\*\//g, '.{0,}')
    .replace(/\*\*/g, '.{0,}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${expanded}$`);
}

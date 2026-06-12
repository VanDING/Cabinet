/** Format a human-readable task name from a tool call. */
export function formatToolTaskName(toolName: string, args: Record<string, unknown>): string {
  const preview = (val: unknown) => {
    const s = String(val ?? '');
    return s.length > 40 ? s.slice(0, 40) + '…' : s;
  };
  switch (toolName) {
    case 'read_file':
      return args.filePath ? `Read ${preview(args.filePath)}` : 'Read file';
    case 'writeFile':
      return args.filePath ? `Write ${preview(args.filePath)}` : 'Write file';
    case 'editFile':
      return args.filePath ? `Edit ${preview(args.filePath)}` : 'Edit file';
    case 'execCommand':
      return args.command ? `Run ${preview(args.command)}` : 'Run command';
    case 'searchFiles':
      return args.pattern ? `Search ${preview(args.pattern)}` : 'Search files';
    case 'searchContent':
      return args.pattern ? `Search content ${preview(args.pattern)}` : 'Search content';
    case 'listDirectory':
      return args.dirPath ? `List ${preview(args.dirPath)}` : 'List directory';
    case 'webFetch':
      return args.url ? `Fetch ${preview(args.url)}` : 'Fetch URL';
    case 'httpRequest':
      return args.url ? `HTTP ${preview(args.url)}` : 'HTTP request';
    case 'runWorkflow':
      return 'Run workflow';
    default:
      return toolName;
  }
}

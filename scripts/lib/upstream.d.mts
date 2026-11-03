export function listFiles(root: string): string[];
export function fileHashes(root: string): Record<string, string>;
export function hashOfFiles(files: Record<string, string>): string;
export function hashTree(root: string): string;
export function readJson(path: string): unknown;

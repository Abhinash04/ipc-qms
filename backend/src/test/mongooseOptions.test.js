import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'test' ? [] : sourceFiles(full);
    return /\.m?js$/.test(name) ? [full] : [];
  });
}

describe('Mongoose query options', () => {
  it('never uses the deprecated `new` or `returnOriginal` options', () => {
    const files = [...sourceFiles(path.join(BACKEND, 'src')), ...sourceFiles(path.join(BACKEND, 'scripts'))];

    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          /\b(new|returnOriginal)\s*:\s*(true|false)\b/.test(line)
            ? [`${path.relative(BACKEND, file)}:${index + 1}`]
            : [],
        ),
    );

    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});

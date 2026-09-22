import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * No query in the backend passes Mongoose's deprecated `new` or `returnOriginal`.
 *
 * Mongoose 9 deprecates both for findOneAndUpdate() and findOneAndReplace() in
 * favour of `returnDocument`, and warns on every execution rather than once per
 * process — so one stray option put a warning in the backend log for every
 * request that reached it, two per final approval. The unit tests run against
 * stand-in models that never reach Mongoose and so cannot see the warning; this
 * reads the source instead.
 */
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

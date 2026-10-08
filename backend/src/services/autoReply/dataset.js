import { createRequire } from 'node:module';

/**
 * The supported general questions and their answers (src/data/autoReplyQuestions.json). A
 * demo stand-in for a trained classifier: a mail is offered an automatic reply only when it
 * asks one of these questions.
 */
const require = createRequire(import.meta.url);
const dataset = require('../../data/autoReplyQuestions.json');

const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateDataset(data = dataset) {
  const errors = [];
  if (!Array.isArray(data?.entries) || !data.entries.length) return ['the auto-reply dataset has no entries'];

  const seen = new Set();
  data.entries.forEach((entry, index) => {
    const where = `auto-reply entry ${entry?.id || `#${index + 1}`}`;
    if (!isText(entry?.id)) errors.push(`${where}: id is required`);
    else if (seen.has(entry.id)) errors.push(`${where}: id is used twice`);
    seen.add(entry?.id);
    if (!isText(entry?.question)) errors.push(`${where}: question is required`);
    if (!isText(entry?.answer)) errors.push(`${where}: answer is required`);
    if (entry?.variants !== undefined && !(Array.isArray(entry.variants) && entry.variants.every(isText))) {
      errors.push(`${where}: variants must be a list of questions`);
    }
  });
  return errors;
}

export const AUTO_REPLY_DATASET_VERSION = dataset.version ?? 1;
export const AUTO_REPLY_ENTRIES = dataset.entries ?? [];

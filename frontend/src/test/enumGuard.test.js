import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORKFLOW_STATE, AUDIT_EVENT } from '@/constants/statusEnums';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_DIR = path.resolve(__dirname, '../');

function getSourceFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
        getSourceFiles(filePath, fileList);
      }
    } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('Enum Reference Guard', () => {
  const sourceFiles = getSourceFiles(SRC_DIR);
  const knownWorkflowStates = new Set(Object.keys(WORKFLOW_STATE));
  const knownAuditEvents = new Set(Object.keys(AUDIT_EVENT));

  it('ensures all WORKFLOW_STATE references in source code match existing enum members', () => {
    const invalidRefs = [];
    const pattern = /WORKFLOW_STATE\.([A-Za-z0-9_]+)/g;

    for (const filePath of sourceFiles) {
      // Don't scan statusEnums.js definition itself
      if (filePath.endsWith('statusEnums.js')) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const member = match[1];
        if (!knownWorkflowStates.has(member)) {
          const relativePath = path.relative(SRC_DIR, filePath);
          invalidRefs.push(`${relativePath}: WORKFLOW_STATE.${member}`);
        }
      }
    }

    expect(invalidRefs).toEqual([]);
  });

  it('ensures all AUDIT_EVENT references in source code match existing enum members', () => {
    const invalidRefs = [];
    const pattern = /AUDIT_EVENT\.([A-Za-z0-9_]+)/g;

    for (const filePath of sourceFiles) {
      if (filePath.endsWith('statusEnums.js')) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const member = match[1];
        if (!knownAuditEvents.has(member)) {
          const relativePath = path.relative(SRC_DIR, filePath);
          invalidRefs.push(`${relativePath}: AUDIT_EVENT.${member}`);
        }
      }
    }

    expect(invalidRefs).toEqual([]);
  });
});

const read = (doc, path) => path.split('.').reduce((node, key) => node?.[key], doc);

function write(doc, path, value) {
  const keys = path.split('.');
  const leaf = keys.pop();
  keys.reduce((node, key) => (node[key] ??= {}), doc)[leaf] = value;
}

function unset(doc, path) {
  const keys = path.split('.');
  const leaf = keys.pop();
  const parent = keys.reduce((node, key) => node?.[key], doc);
  if (parent) delete parent[leaf];
}

const clone = (doc) => (doc === undefined || doc === null ? null : JSON.parse(JSON.stringify(doc)));

const isOperatorObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((k) => k.startsWith('$'));

function typeMatches(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number';
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  return false;
}

function matchesCondition(actual, condition) {
  if (!isOperatorObject(condition)) {
    if (Array.isArray(actual) && !Array.isArray(condition)) return actual.includes(condition);
    if (condition === null) return actual === null || actual === undefined;
    return JSON.stringify(actual) === JSON.stringify(condition);
  }

  return Object.entries(condition).every(([op, operand]) => {
    switch (op) {
      case '$in':
        return operand.some((candidate) => matchesCondition(actual, candidate));
      case '$nin':
        return !operand.some((candidate) => matchesCondition(actual, candidate));
      case '$ne':
        return !matchesCondition(actual, operand);
      case '$lt':
        return actual !== undefined && actual !== null && actual < operand;
      case '$lte':
        return actual !== undefined && actual !== null && actual <= operand;
      case '$gt':
        return actual !== undefined && actual !== null && actual > operand;
      case '$gte':
        return actual !== undefined && actual !== null && actual >= operand;
      case '$exists':
        return operand ? actual !== undefined : actual === undefined;
      case '$type':
        return typeMatches(actual, operand);
      case '$regex':
        return new RegExp(operand, condition.$options || '').test(String(actual ?? ''));
      case '$options':
        return true;
      default:
        throw new Error(`memoryDb: unsupported query operator ${op}`);
    }
  });
}

const matches = (row, filter = {}) =>
  Object.entries(filter).every(([path, condition]) =>
    path === '$or' ? condition.some((branch) => matches(row, branch)) : matchesCondition(read(row, path), condition),
  );

function applyUpdate(doc, update, inserted) {
  const ops = isOperatorObject(update) ? update : { $set: update };

  const named = new Set();
  for (const fields of Object.values(ops)) {
    for (const path of Object.keys(fields ?? {})) {
      if (named.has(path)) {
        throw Object.assign(new Error(`Updating the path '${path}' would create a conflict at '${path}'`), { code: 40 });
      }
      named.add(path);
    }
  }

  for (const [path, by] of Object.entries(ops.$inc ?? {})) write(doc, path, (read(doc, path) ?? 0) + by);
  for (const [path, value] of Object.entries(ops.$set ?? {})) write(doc, path, clone(value));
  for (const [path, value] of Object.entries(ops.$max ?? {})) {
    const current = read(doc, path);
    if (current === undefined || current === null || value > current) write(doc, path, value);
  }
  for (const path of Object.keys(ops.$unset ?? {})) unset(doc, path);
  for (const [path, value] of Object.entries(ops.$push ?? {})) {
    const list = Array.isArray(read(doc, path)) ? [...read(doc, path)] : [];
    const items = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
    list.push(...clone(items));
    const sliced = value && typeof value === 'object' && '$slice' in value ? list.slice(value.$slice) : list;
    write(doc, path, sliced);
  }
  if (inserted) {
    for (const [path, value] of Object.entries(ops.$setOnInsert ?? {})) write(doc, path, clone(value));
  }
}

function sortRows(rows, spec) {
  if (!spec) return rows;
  const keys = Object.entries(spec);
  return [...rows].sort((a, b) => {
    for (const [path, direction] of keys) {
      const x = read(a, path);
      const y = read(b, path);
      if (x === y) continue;
      if (x === undefined || x === null) return -direction;
      if (y === undefined || y === null) return direction;
      return (x < y ? -1 : 1) * direction;
    }
    return 0;
  });
}

function project(doc, projection) {
  if (!doc || !projection || typeof projection !== 'object') return doc;
  const included = Object.entries(projection).filter(([, on]) => on);
  if (!included.length) {
    const out = clone(doc);
    for (const path of Object.keys(projection)) unset(out, path);
    return out;
  }
  const out = {};
  for (const [path] of included) {
    const value = read(doc, path);
    if (value !== undefined) write(out, path, value);
  }
  return out;
}

function query(run) {
  const state = { sort: null, projection: null, limit: null, skip: 0 };
  const self = {
    sort(spec) {
      state.sort = spec;
      return self;
    },
    skip(count) {
      state.skip = count;
      return self;
    },
    limit(count) {
      state.limit = count;
      return self;
    },
    select(spec) {
      if (typeof spec === 'string') {
        state.projection = Object.fromEntries(
          spec
            .split(/\s+/)
            .filter(Boolean)
            .map((key) => (key.startsWith('-') ? [key.slice(1), 0] : [key, 1])),
        );
      } else {
        state.projection = spec;
      }
      return self;
    },
    lean() {
      return self.exec();
    },
    exec() {
      return Promise.resolve().then(() => run(state));
    },
    then(resolve, reject) {
      return self.exec().then(resolve, reject);
    },
  };
  return self;
}

function duplicateKeyError(model, field, value) {
  return Object.assign(
    new Error(`E11000 duplicate key error collection: ${model} index: ${field}_1 dup key: { ${field}: ${JSON.stringify(value)} }`),
    { code: 11000, keyPattern: { [field]: 1 }, keyValue: { [field]: value } },
  );
}

export function createMemoryDb() {
  const collections = new Map();

  function model(name, { unique = [], uniqueWhenString = [] } = {}) {
    if (collections.has(name)) return collections.get(name).api;

    const rows = [];

    const assertUnique = (candidate, except = null) => {
      for (const field of unique) {
        const value = read(candidate, field);
        if (value === undefined) continue;
        if (rows.some((row) => row !== except && JSON.stringify(read(row, field)) === JSON.stringify(value))) {
          throw duplicateKeyError(name, field, value);
        }
      }
      for (const field of uniqueWhenString) {
        const value = read(candidate, field);
        if (typeof value !== 'string') continue;
        if (rows.some((row) => row !== except && read(row, field) === value)) {
          throw duplicateKeyError(name, field, value);
        }
      }
    };

    const insert = (doc) => {
      const row = clone(doc);
      assertUnique(row);
      rows.push(row);
      return row;
    };

    const find = (filter, sort) => sortRows(rows.filter((row) => matches(row, filter)), sort);

    function updateFirst(filter, update, options = {}) {
      let row = find(filter, options.sort)[0];
      const before = clone(row);

      if (!row) {
        if (!options.upsert) return { row: null, before: null, inserted: false };
        const seed = {};
        for (const [path, condition] of Object.entries(filter)) {
          if (!isOperatorObject(condition)) write(seed, path, clone(condition));
        }
        applyUpdate(seed, update, true);
        row = insert(seed);
        return { row, before: null, inserted: true };
      }

      const next = clone(row);
      applyUpdate(next, update, false);
      assertUnique(next, row);
      Object.keys(row).forEach((key) => delete row[key]);
      Object.assign(row, next);
      return { row, before, inserted: false };
    }

    const api = {
      async create(docOrDocs) {
        if (Array.isArray(docOrDocs)) return docOrDocs.map((doc) => clone(insert(doc)));
        return clone(insert(docOrDocs));
      },
      async insertMany(docs) {
        return docs.map((doc) => clone(insert(doc)));
      },
      find(filter = {}, projection = null) {
        return query((state) =>
          find(filter, state.sort)
            .slice(state.skip, state.limit ? state.skip + state.limit : undefined)
            .map((row) => clone(project(row, state.projection || projection))),
        );
      },
      async exists(filter = {}) {
        return find(filter).length ? { _id: 'memory' } : null;
      },
      findOne(filter = {}, projection = null) {
        return query((state) => clone(project(find(filter, state.sort)[0], state.projection || projection)) ?? null);
      },
      findOneAndUpdate(filter, update, options = {}) {
        return query(() => {
          const { row, before } = updateFirst(filter, update, options);
          if (!row) return null;
          return options.returnDocument === 'after' || options.new ? clone(row) : clone(before);
        });
      },
      findOneAndDelete(filter = {}) {
        return query(() => {
          const row = find(filter)[0];
          if (!row) return null;
          rows.splice(rows.indexOf(row), 1);
          return clone(row);
        });
      },
      async updateOne(filter, update, options = {}) {
        const { row, inserted } = updateFirst(filter, update, options);
        return {
          acknowledged: true,
          matchedCount: row && !inserted ? 1 : 0,
          modifiedCount: row && !inserted ? 1 : 0,
          upsertedCount: inserted ? 1 : 0,
        };
      },
      async updateMany(filter, update) {
        const targets = find(filter);
        for (const row of targets) {
          const next = clone(row);
          applyUpdate(next, update, false);
          Object.keys(row).forEach((key) => delete row[key]);
          Object.assign(row, next);
        }
        return { acknowledged: true, matchedCount: targets.length, modifiedCount: targets.length };
      },
      async deleteOne(filter = {}) {
        const row = find(filter)[0];
        if (row) rows.splice(rows.indexOf(row), 1);
        return { acknowledged: true, deletedCount: row ? 1 : 0 };
      },
      async deleteMany(filter = {}) {
        const targets = find(filter);
        for (const row of targets) rows.splice(rows.indexOf(row), 1);
        return { acknowledged: true, deletedCount: targets.length };
      },
      async countDocuments(filter = {}) {
        return find(filter).length;
      },
      async distinct(path, filter = {}) {
        return [...new Set(find(filter).map((row) => read(row, path)))];
      },
      async createCollection() {},
      async syncIndexes() {},
      all() {
        return rows.map(clone);
      },
    };

    collections.set(name, { rows, api });
    return api;
  }

  return {
    model,
    reset() {
      collections.forEach(({ rows }) => rows.splice(0));
    },
    rows(name) {
      return (collections.get(name)?.rows || []).map(clone);
    },
  };
}

export const memoryDb = createMemoryDb();

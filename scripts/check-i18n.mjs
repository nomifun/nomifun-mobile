#!/usr/bin/env node
/**
 * i18n consistency gate — zero dependencies, `node scripts/check-i18n.mjs`.
 *
 * Four checks over `src/i18n/locales/{zh-CN,en-US}/<ns>.json`:
 *
 *   A. FAIL — the two locales must carry the exact same namespaces and, inside
 *      each namespace, the exact same flattened keys. zh-CN is the source of
 *      truth; a key only present there is an untranslated string, a key only
 *      present in en-US is dead weight.
 *   B. FAIL — the `{{placeholder}}` set of a key must match across locales. A
 *      dropped placeholder is a silently blank name/count at runtime.
 *   C. FAIL — every *statically resolvable* `t('...')` call site in `src/` must
 *      resolve to an existing key. This is the check that catches a typo'd key
 *      shipping as visible mojibake.
 *   D. WARN — keys no call site references. Only a warning: keys built at
 *      runtime (`t(`weekday.${day}`)`) cannot be proven used.
 *
 * How namespaces are resolved for check C (mirrors how this app actually calls
 * i18next — see docs/FOUNDATION.md §i18n):
 *   - `const { t } = useTranslation('sessions')` → alias `t` → ns `sessions`
 *   - `const { t: tc } = useTranslation('common')` → alias `tc` → ns `common`
 *   - `const tr = (key) => i18n.t(key, { ns: 'fs' })` → alias `tr` → ns `fs`
 *   - an inline `{ ns: 'common' }` in the call overrides the alias
 *   - a non-literal first argument is counted as dynamic and skipped
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const LOCALES_DIR = join(ROOT, 'src/i18n/locales');
const SRC_DIR = join(ROOT, 'src');
const PRIMARY = 'zh-CN';
const SECONDARY = 'en-US';

/** i18next plural suffixes: `count_one` satisfies a `t('count', {count})` call. */
const PLURAL_SUFFIXES = ['one', 'other', 'zero', 'two', 'few', 'many'];

const problems = [];
const warnings = [];

const fail = (message) => problems.push(message);
const warn = (message) => warnings.push(message);

// ── Locale loading ─────────────────────────────────────────────────

function flatten(value, prefix, out) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child, path, out);
    } else {
      out.set(path, child);
    }
  }
  return out;
}

function namespaceFiles(locale) {
  const dir = join(LOCALES_DIR, locale);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function loadLocale(locale) {
  const out = new Map();
  for (const ns of namespaceFiles(locale)) {
    const file = join(LOCALES_DIR, locale, `${ns}.json`);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      fail(`[${locale}/${ns}.json] is not valid JSON: ${error.message}`);
      continue;
    }
    out.set(ns, flatten(parsed, '', new Map()));
  }
  return out;
}

// ── A/B: parity ────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{\s*-?\s*([\w.]+)[^}]*\}\}/g;

function placeholderSet(value) {
  if (typeof value !== 'string') return new Set();
  return new Set([...value.matchAll(PLACEHOLDER)].map((match) => match[1]));
}

/**
 * Placeholder signature of one string. Singular/zero plural forms may inline
 * the number ("1 session" vs "{{count}} 个会话"), which is correct i18n rather
 * than a dropped variable, so `count` is exempt on `_one` / `_zero` keys — and
 * only there.
 */
function placeholders(value, key) {
  const set = placeholderSet(value);
  if (/_(one|zero)$/.test(key)) set.delete('count');
  return [...set].sort().join(',');
}

function checkParity(primary, secondary) {
  const namespaces = [...new Set([...primary.keys(), ...secondary.keys()])].sort();
  for (const ns of namespaces) {
    const a = primary.get(ns);
    const b = secondary.get(ns);
    if (!a) {
      fail(`namespace "${ns}" exists in ${SECONDARY} but not in ${PRIMARY}`);
      continue;
    }
    if (!b) {
      fail(`namespace "${ns}" exists in ${PRIMARY} but not in ${SECONDARY}`);
      continue;
    }
    for (const key of a.keys()) {
      if (!b.has(key)) fail(`[${ns}] missing in ${SECONDARY}: ${key}`);
    }
    for (const key of b.keys()) {
      if (!a.has(key)) fail(`[${ns}] missing in ${PRIMARY}: ${key}`);
    }
    for (const [key, value] of a) {
      if (!b.has(key)) continue;
      const here = placeholders(value, key);
      const there = placeholders(b.get(key), key);
      if (here !== there) {
        fail(
          `[${ns}] placeholder mismatch for ${key}: ${PRIMARY}=[${here}] ${SECONDARY}=[${there}]`,
        );
      }
      if (typeof value === 'string' && value.trim() === '') {
        fail(`[${ns}] empty ${PRIMARY} string: ${key}`);
      }
      if (typeof b.get(key) === 'string' && b.get(key).trim() === '') {
        fail(`[${ns}] empty ${SECONDARY} string: ${key}`);
      }
    }
  }
}

// ── Source scanning ────────────────────────────────────────────────

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** `const { t } = useTranslation('ns')` / `const { t: tc } = useTranslation('ns')`. */
const USE_TRANSLATION = /\{\s*t(?:\s*:\s*(\w+))?\s*\}\s*=\s*useTranslation\(\s*['"]([\w-]+)['"]/g;
/** `const tr = (key, …) => i18n.t(key, { ns: 'fs', … })` — a local wrapper. */
const WRAPPER =
  /(?:const|let)\s+(\w+)\s*=\s*(?:\([^)]*\)|\w+)\s*(?::\s*[^=]+?)?=>\s*\(?[\s\S]{0,200}?i18n\.t\(\s*\w+\s*,\s*\{[^}]*?\bns:\s*['"]([\w-]+)['"]/g;

function aliasMap(source) {
  /** alias → Set<ns>; a file may bind the same alias twice (rare but legal). */
  const aliases = new Map();
  const add = (alias, ns) => {
    const set = aliases.get(alias) ?? new Set();
    set.add(ns);
    aliases.set(alias, set);
  };
  for (const match of source.matchAll(USE_TRANSLATION)) add(match[1] ?? 't', match[2]);
  for (const match of source.matchAll(WRAPPER)) add(match[1], match[2]);
  return aliases;
}

/**
 * Every `<alias>(…)` / `i18n.t(…)` call, with the literal key when there is one.
 * The trailing group grabs enough of the call to spot an inline `ns:` option.
 */
const CALL = /(?:\bi18n\.t|\b(\w+))\(\s*(['"`])((?:[^\\]|\\.)*?)\2([\s\S]{0,120}?)\)/g;
const INLINE_NS = /\bns:\s*['"]([\w-]+)['"]/;
/** Anything that is not a plain dotted key (template hole, whitespace, …). */
const STATIC_KEY = /^[\w.\-:]+$/;
/**
 * Static prefix of any dotted template literal, e.g. `weekday.` out of
 * `` `weekday.${day}` `` — including the ones assembled outside a `t()` call
 * (`levelNameKey` returns `` `levels.l${n}` ``). Scanned in its own pass: a
 * nested `t()` inside another `t()` call is swallowed by the outer match.
 */
const DYNAMIC_KEY_PREFIX = /`([\w-]+(?:\.[\w-]+)*\.[\w-]*)\$\{/g;

function scanCalls(files) {
  /** ns → Set<key> referenced with a static literal. */
  const referenced = new Map();
  /** Static prefixes of template-literal keys, e.g. `weekday.` from `` `weekday.${d}` ``. */
  const dynamicPrefixes = new Set();
  const unresolved = [];
  let dynamic = 0;

  const note = (ns, key) => {
    const set = referenced.get(ns) ?? new Set();
    set.add(key);
    referenced.set(ns, set);
  };

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(DYNAMIC_KEY_PREFIX)) dynamicPrefixes.add(match[1]);
    if (!source.includes('t(')) continue;
    const aliases = aliasMap(source);
    const where = relative(ROOT, file);

    for (const match of source.matchAll(CALL)) {
      const [, alias, quote, raw, tail] = match;
      const isI18n = alias === undefined;

      if (quote === '`' && raw.includes('${')) {
        dynamic += 1;
        continue;
      }

      if (!isI18n && !aliases.has(alias)) continue; // not a translation call

      if (!STATIC_KEY.test(raw)) {
        dynamic += 1;
        continue;
      }

      const inline = INLINE_NS.exec(tail ?? '');
      const namespaces = inline ? [inline[1]] : [...(aliases.get(alias) ?? [])];
      if (namespaces.length === 0) {
        unresolved.push(`${where}: could not resolve a namespace for ${alias}('${raw}')`);
        continue;
      }
      for (const ns of namespaces) note(ns, raw);
      referenced.set('__sites__', referenced.get('__sites__') ?? new Set());
      referenced.get('__sites__').add(`${namespaces.join('|')} ${raw} ${where}`);
    }
  }

  return { referenced, dynamicPrefixes, unresolved, dynamic };
}

/** True when `key` (or one of its plural variants) exists in `table`. */
function hasKey(table, key) {
  if (!table) return false;
  if (table.has(key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => table.has(`${key}_${suffix}`));
}

/** True when `key` names an interior node, i.e. `t('a.b')` with `returnObjects`. */
function hasSubtree(table, key) {
  if (!table) return false;
  for (const candidate of table.keys()) {
    if (candidate.startsWith(`${key}.`)) return true;
  }
  return false;
}

// ── C: referenced-but-missing ──────────────────────────────────────

function checkReferences(sites, primary, secondary) {
  for (const site of sites) {
    const [namespaces, key, where] = site.split(' ');
    const candidates = namespaces.split('|');
    const found = candidates.some(
      (ns) => hasKey(primary.get(ns), key) || hasSubtree(primary.get(ns), key),
    );
    if (!found) {
      fail(`${where}: key "${key}" is missing from ${PRIMARY}/${candidates.join('|')}.json`);
      continue;
    }
    const translated = candidates.some(
      (ns) => hasKey(secondary.get(ns), key) || hasSubtree(secondary.get(ns), key),
    );
    // Parity (check A) reports the pair; this only adds the call site.
    if (!translated) {
      fail(`${where}: key "${key}" is missing from ${SECONDARY}/${candidates.join('|')}.json`);
    }
  }
}

// ── D: unused keys (warning only) ──────────────────────────────────

function reportUnused(primary, referenced, dynamicPrefixes, blob) {
  const unused = [];
  for (const [ns, table] of primary) {
    const used = referenced.get(ns) ?? new Set();
    for (const key of table.keys()) {
      const base = key.replace(new RegExp(`_(${PLURAL_SUFFIXES.join('|')})$`), '');
      if (used.has(key) || used.has(base)) continue;
      // A parent key may be referenced with `returnObjects`.
      if ([...used].some((candidate) => key.startsWith(`${candidate}.`))) continue;
      // Built at runtime from a template literal we saw.
      if ([...dynamicPrefixes].some((prefix) => key.startsWith(prefix))) continue;
      // Last resort: the literal appears somewhere we did not parse (a
      // constant table, an options object, a test).
      if (blob.includes(`'${key}'`) || blob.includes(`"${key}"`) || blob.includes(`\`${key}\``)) {
        continue;
      }
      unused.push(`${ns}:${key}`);
    }
  }
  if (unused.length > 0) {
    warn(
      `${unused.length} key(s) have no statically visible reference (dynamic keys are expected here):`,
    );
    for (const key of unused) warn(`    ${key}`);
  }
}

// ── Run ────────────────────────────────────────────────────────────

const primary = loadLocale(PRIMARY);
const secondary = loadLocale(SECONDARY);

checkParity(primary, secondary);

const files = sourceFiles(SRC_DIR);
const scan = scanCalls(files);
const sites = scan.referenced.get('__sites__') ?? new Set();
scan.referenced.delete('__sites__');
checkReferences(sites, primary, secondary);
reportUnused(
  primary,
  scan.referenced,
  scan.dynamicPrefixes,
  files.map((file) => readFileSync(file, 'utf8')).join('\n'),
);

for (const line of scan.unresolved) warn(line);

const namespaceCount = primary.size;
const keyCount = [...primary.values()].reduce((total, table) => total + table.size, 0);

console.log(
  `i18n: ${namespaceCount} namespaces, ${keyCount} keys per locale, ` +
    `${sites.size} static call sites, ${scan.dynamic} dynamic call sites skipped`,
);

if (warnings.length > 0) {
  console.log(`\n${warnings.length} warning line(s):`);
  for (const line of warnings) console.log(`  ${line}`);
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

console.log('\ni18n check passed.');

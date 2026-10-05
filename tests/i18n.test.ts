import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, resolveLocale, setLocale, t } from '../src/i18n';
import { formatLocalDateTime } from '../src/utils/dateTime';

test('explicit locale wins; Chinese browsers keep Chinese and other browsers get English', () => {
  assert.equal(resolveLocale('en', ['zh-CN']), 'en');
  assert.equal(resolveLocale('zh-CN', ['en-US']), 'zh-CN');
  assert.equal(resolveLocale(null, ['zh-TW']), 'zh-CN');
  assert.equal(resolveLocale('invalid', ['en-US', 'zh-CN']), 'en');
  assert.equal(resolveLocale(null, ['fr-FR']), 'en');
  assert.equal(resolveLocale(), 'en');
});

test('navigator.language is a fallback only when the primary languages entry is unavailable', () => {
  assert.equal(resolveLocale(null, undefined, 'zh-TW'), 'zh-CN');
  assert.equal(resolveLocale(null, [], 'zh-HK'), 'zh-CN');
  assert.equal(resolveLocale(null, [''], 'ZH-cn'), 'zh-CN');
  assert.equal(resolveLocale(null, ['fr-FR', 'zh-CN'], 'zh-CN'), 'en');
  assert.equal(resolveLocale('en', [], 'zh-CN'), 'en');
  assert.equal(resolveLocale('zh-CN', undefined, 'en-US'), 'zh-CN');
  assert.equal(resolveLocale(null, [], ''), 'en');
});

test('session language switches copy and date formatting without changing invalid/user text', () => {
  const value = '2026-08-16T12:34:56Z';
  setLocale('zh-CN');
  assert.equal(t('项目', 'Projects'), '项目');
  const chineseDate = formatLocalDateTime(value);
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t('项目', 'Projects'), 'Projects');
  assert.notEqual(formatLocalDateTime(value), chineseDate);
  assert.equal(formatLocalDateTime('研究者原文'), '研究者原文');
  assert.equal(formatLocalDateTime(null), '—');
  assert.equal(formatLocalDateTime(undefined, 'Unknown'), 'Unknown');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from './csv.ts';

test('parseCsv handles BOM, CRLF, quotes, escaped quotes and newlines in cells', () => {
  const text = '﻿title,url,tags\r\n"Tubi, free","https://tubitv.com","a;b"\r\n"Say ""hi""\nthere",x,\r\n\r\n';
  assert.deepEqual(parseCsv(text), [
    ['title', 'url', 'tags'],
    ['Tubi, free', 'https://tubitv.com', 'a;b'],
    ['Say "hi"\nthere', 'x', ''],
  ]);
});

test('toCsv round-trips through parseCsv and neutralises formulas', () => {
  const rows = [['a,b', 'q"uote', 'line\nbreak'], ['=HYPERLINK("x")', 3, null]];
  assert.deepEqual(parseCsv(toCsv(rows)), [['a,b', 'q"uote', 'line\nbreak'], ['\'=HYPERLINK("x")', '3', '']]);
});

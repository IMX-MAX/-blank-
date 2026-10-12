import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupCandidates } from './titles';

const best = (title: string, artist = '') => lookupCandidates(title, artist)[0]!;

test('an apostrophe inside a word is not a quote', () => {
  assert.deepEqual(best("ILLIT (아일릿) 'It's Me' Official MV", 'ILLIT'), { title: "It's Me", artist: 'ILLIT' });
  assert.deepEqual(best('ILLIT (아일릿) ‘It’s Me’ Official MV', 'ILLIT'), { title: 'It’s Me', artist: 'ILLIT' });
  assert.deepEqual(best("ILLIT (아일릿) 'Cherish (My Love)' Official MV", 'ILLIT'), { title: 'Cherish (My Love)', artist: 'ILLIT' });
  assert.equal(best("Don't Stop Believin'", 'Journey').title, "Don't Stop Believin'");
  assert.equal(best("It's me, It", 'It').title, "It's me, It");
});

test('quoted song names still come out', () => {
  assert.equal(best('BLACKPINK "How You Like That" M/V', 'BLACKPINK').title, 'How You Like That');
  assert.equal(best("aespa 'Supernova' MV", 'aespa').title, 'Supernova');
  assert.equal(best('The Weeknd - Blinding Lights (Official Video)', 'The Weeknd').title, 'Blinding Lights');
});

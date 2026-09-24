import assert from 'node:assert/strict';
import { hostIsDomain, hostListed, hostnameOf, hostsEqual, normalizeHost } from '../src/utils/host.js';

assert.equal(hostnameOf('https://www.bbc.co.uk/news'), 'www.bbc.co.uk');
assert.equal(normalizeHost('https://www.bbc.co.uk/news'), 'bbc.co.uk');
assert.equal(normalizeHost('www.bbc.co.uk'), 'bbc.co.uk');
assert.equal(hostsEqual('www.bbc.co.uk', 'bbc.co.uk'), true);
assert.equal(hostListed('www.bbc.co.uk', ['bbc.co.uk']), true);
assert.equal(hostListed('bbc.co.uk', ['www.bbc.co.uk']), true);
assert.equal(hostListed('news.bbc.co.uk', ['bbc.co.uk']), false);

assert.equal(hostIsDomain('x.com', 'x.com'), true);
assert.equal(hostIsDomain('www.x.com', 'x.com'), true);
assert.equal(hostIsDomain('mobile.twitter.com', 'twitter.com'), true);
assert.equal(hostIsDomain('netflix.com', 'x.com'), false);
assert.equal(hostIsDomain('dropbox.com', 'x.com'), false);
assert.equal(hostIsDomain('fedex.com', 'x.com'), false);

console.log('host tests OK');

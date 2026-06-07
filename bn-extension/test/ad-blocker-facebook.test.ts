/**
 * Facebook sponsored feed detection tests
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  isFacebookSponsoredPost,
  findSponsoredFacebookFeedPosts,
  findSponsoredSidebarRoots,
  blockSponsoredFacebookFeedPosts,
  BN_BLOCKED_ATTR,
} from '../src/ad-blocker/facebook-sponsored.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function setupDom(html) {
  return import('happy-dom').then(({ Window }) => {
    const window = new Window();
    const document = window.document;
    document.write(html);
    global.window = window;
    global.document = document;
    return document;
  });
}

async function run() {
  const fixture = readFileSync(
    join(__dirname, 'fixtures', 'facebook-feed-sponsored.html'),
    'utf-8'
  );
  const doc = await setupDom(fixture);

  const feed = doc.querySelector('[role="feed"]');
  const posts = findSponsoredFacebookFeedPosts(feed);
  if (posts.length !== 3) {
    console.error(`Expected 3 sponsored posts, got ${posts.length}`);
    process.exit(1);
  }

  if (!posts.every((p) => isFacebookSponsoredPost(p))) {
    console.error('findSponsoredFacebookFeedPosts returned non-sponsored roots');
    process.exit(1);
  }

  const organic = doc.getElementById('organic-post');
  if (isFacebookSponsoredPost(organic)) {
    console.error('Organic post incorrectly flagged as sponsored');
    process.exit(1);
  }

  const sidebars = findSponsoredSidebarRoots(doc);
  if (sidebars.length !== 1 || sidebars[0].id !== 'right-rail-sponsored') {
    console.error('Expected 1 sponsored sidebar panel');
    process.exit(1);
  }

  const blocked = blockSponsoredFacebookFeedPosts(doc);
  if (blocked !== 4) {
    console.error(`Expected to block 4 units (3 feed + 1 sidebar), blocked ${blocked}`);
    process.exit(1);
  }

  for (const post of posts) {
    if (post.getAttribute(BN_BLOCKED_ATTR) !== '1') {
      console.error('Blocked post missing marker attribute');
      process.exit(1);
    }
    if (post.style.display !== 'none') {
      console.error('Blocked post not hidden');
      process.exit(1);
    }
  }

  console.log('✅ Facebook sponsored feed ad-blocker tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

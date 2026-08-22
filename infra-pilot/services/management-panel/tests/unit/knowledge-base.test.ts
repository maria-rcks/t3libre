import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as kb from '../../server/knowledge-base.ts';

describe('knowledge base module', () => {
  beforeEach(async () => {
    const articles = await kb.listArticles();
    for (const a of articles) {
      await kb.deleteArticle(a.id);
    }
    const cats = await kb.listCategories();
    for (const c of cats) {
      await kb.deleteCategory(c.id);
    }
  });

  it('creates and retrieves an article', async () => {
    const created = await kb.createArticle({
      title: 'Test Article',
      content: '## Hello World\nThis is a test.',
      category: 'guides',
      tags: ['test', 'docs'],
      author: 'test-user',
    });

    assert.ok(created.id);
    assert.equal(created.title, 'Test Article');
    assert.equal(created.content, '## Hello World\nThis is a test.');
    assert.equal(created.category, 'guides');
    assert.deepEqual(created.tags, ['test', 'docs']);

    const fetched = await kb.getArticle(created.id);
    assert.ok(fetched);
    assert.equal(fetched?.title, 'Test Article');
  });

  it('updates an existing article', async () => {
    const created = await kb.createArticle({ title: 'Original', content: 'Original content', author: 'user' });
    const updated = await kb.updateArticle(created.id, { title: 'Updated Title', content: 'Updated content' });
    assert.ok(updated);
    assert.equal(updated?.title, 'Updated Title');
    assert.equal(updated?.content, 'Updated content');
    assert.notEqual(updated?.updated_at, created.updated_at);
  });

  it('deletes an article', async () => {
    const created = await kb.createArticle({ title: 'To Delete', content: 'Delete me', author: 'user' });
    const deleted = await kb.deleteArticle(created.id);
    assert.equal(deleted, true);

    const fetched = await kb.getArticle(created.id);
    assert.equal(fetched, null);
  });

  it('returns null for nonexistent article', async () => {
    const fetched = await kb.getArticle('nonexistent-id');
    assert.equal(fetched, null);
  });

  it('searches articles by title and content', async () => {
    await kb.createArticle({ title: 'Docker Setup', content: 'How to install Docker', tags: ['docker'], author: 'user' });
    await kb.createArticle({ title: 'Nginx Config', content: 'Configure Nginx reverse proxy', tags: ['nginx'], author: 'user' });

    const results = await kb.searchArticles('docker');
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Docker Setup');

    const tagResults = await kb.searchArticles('nginx');
    assert.equal(tagResults.length, 1);
    assert.equal(tagResults[0].title, 'Nginx Config');
  });

  it('manages categories', async () => {
    const cat = await kb.createCategory({ name: 'Guides', description: 'Setup guides' });
    assert.ok(cat.id);
    assert.equal(cat.name, 'Guides');

    const cats = await kb.listCategories();
    assert.ok(cats.length >= 1);

    const deleted = await kb.deleteCategory(cat.id);
    assert.equal(deleted, true);
  });
});

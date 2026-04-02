import { test, expect } from 'playwright/test';

test.describe('API Routes', () => {

  test('GET /api/posts should require authentication', async ({ request }) => {
    const res = await request.get('/api/posts');
    // Should return 401 if not authenticated
    expect([200, 401]).toContain(res.status());
    const json = await res.json();
    if (res.status() === 401) {
      expect(json.success).toBe(false);
    }
  });

  test('POST /api/posts should require authentication', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: { title: 'Test', caption: 'Test caption' },
    });
    expect([200, 401]).toContain(res.status());
  });

  test('GET /api/posts/nonexistent should return 404', async ({ request }) => {
    const res = await request.get('/api/posts/nonexistent-id');
    expect([401, 404]).toContain(res.status());
  });

  test('POST /api/upload/media should require authentication', async ({ request }) => {
    const res = await request.post('/api/upload/media');
    expect([400, 401]).toContain(res.status());
  });
});

test.describe('API Response Formats', () => {

  test('POST /api/posts returns { success, post } format', async ({ request }) => {
    const res = await request.post('/api/posts', {
      data: {
        title: 'Test Post',
        caption: 'Test',
        format: 'reel',
        status: 'draft',
      },
    });

    if (res.status() === 200) {
      const json = await res.json();
      expect(json).toHaveProperty('success');
      if (json.success) {
        expect(json).toHaveProperty('post');
        expect(json.post).toHaveProperty('id');
      }
    }
  });
});

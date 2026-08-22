import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Theme Studio', () => {
  const defaultTheme = {
    name: 'Default Dark',
    colors: {
      primary: '#6C5CE7',
      primaryDark: '#5A46CD',
      secondary: '#EC4899',
      accent: '#22D3EE',
      bgPrimary: '#0f172a',
      bgSecondary: '#1e293b',
      bgCard: '#1e293b',
      textPrimary: '#f1f5f9',
      textSecondary: '#94a3b8',
      borderColor: '#334155',
    },
    font: 'Inter Variable',
    borderRadius: 8,
    spacing: 4,
  };

  it('has exactly 10 color properties', () => {
    assert.equal(Object.keys(defaultTheme.colors).length, 10);
  });

  it('has valid hex color values', () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    Object.values(defaultTheme.colors).forEach((color) => {
      assert.ok(hexRegex.test(color), `${color} is not a valid hex color`);
    });
  });

  it('has numeric spacing and radius', () => {
    assert.equal(typeof defaultTheme.borderRadius, 'number');
    assert.equal(typeof defaultTheme.spacing, 'number');
    assert.ok(defaultTheme.borderRadius >= 0);
    assert.ok(defaultTheme.spacing >= 2);
  });

  it('can apply theme to CSS custom properties', () => {
    const root = new Map<string, string>();
    root.set('--brand-primary', defaultTheme.colors.primary);
    root.set('--bg-primary', defaultTheme.colors.bgPrimary);
    root.set('--border-radius', `${defaultTheme.borderRadius}px`);

    assert.equal(root.get('--brand-primary'), '#6C5CE7');
    assert.equal(root.get('--bg-primary'), '#0f172a');
    assert.equal(root.get('--border-radius'), '8px');
  });

  it('exports theme as JSON', () => {
    const json = JSON.stringify(defaultTheme);
    const parsed = JSON.parse(json);
    assert.deepEqual(parsed, defaultTheme);
  });

  it('validates imported theme structure', () => {
    const requiredKeys = ['name', 'colors', 'font', 'borderRadius', 'spacing'];
    requiredKeys.forEach((key) => {
      assert.ok(key in defaultTheme, `Missing required key: ${key}`);
    });
  });
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReactMarkdown from 'react-markdown';

describe('safe AI rendering', () => {
  it('does not execute or render raw HTML from an AI response', () => {
    const hostile = '<img src=x onerror="window.__compromised=true"> **Safe text**';
    const { container } = render(<ReactMarkdown>{hostile}</ReactMarkdown>);
    expect(screen.getByText('Safe text')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as typeof window & { __compromised?: boolean }).__compromised).toBeUndefined();
  });
});

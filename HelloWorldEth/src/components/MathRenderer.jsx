import React, { useMemo } from 'react';
import katex from 'katex';

/**
 * MathRenderer: Robust inline & display LaTeX renderer using KaTeX.
 * Parses mixed text with $...$ (inline math) and $$...$$ (display math),
 * or raw LaTeX strings, while preserving non-math plain text.
 */
export default function MathRenderer({ children, text, inline = true, className = '' }) {
  const content = text ?? children ?? '';

  const renderedContent = useMemo(() => {
    if (typeof content !== 'string') return content;
    if (!content.trim()) return '';

    // If string has no math markers, return plain text
    if (!content.includes('$') && !content.includes('\\')) {
      if (content.includes('\n')) {
        return content.split('\n').map((line, idx, arr) => (
          <React.Fragment key={idx}>
            {line}
            {idx < arr.length - 1 && <br />}
          </React.Fragment>
        ));
      }
      return content;
    }

    // Split into display math ($$...$$) or inline math ($...$)
    // Match $$...$$ first, then $...$
    const tokens = [];
    let remainder = content;

    while (remainder.length > 0) {
      // Check for display math $$...$$
      const displayStart = remainder.indexOf('$$');
      // Check for inline math $...$
      const inlineStart = remainder.indexOf('$');

      if (displayStart !== -1 && (inlineStart === -1 || displayStart <= inlineStart)) {
        // Text before $$
        if (displayStart > 0) {
          tokens.push({ type: 'text', value: remainder.slice(0, displayStart) });
        }
        const afterFirst = remainder.slice(displayStart + 2);
        const displayEnd = afterFirst.indexOf('$$');
        if (displayEnd !== -1) {
          tokens.push({ type: 'display', value: afterFirst.slice(0, displayEnd) });
          remainder = afterFirst.slice(displayEnd + 2);
        } else {
          // Unclosed $$ - treat remainder as text
          tokens.push({ type: 'text', value: remainder });
          remainder = '';
        }
      } else if (inlineStart !== -1) {
        // Text before $
        if (inlineStart > 0) {
          tokens.push({ type: 'text', value: remainder.slice(0, inlineStart) });
        }
        const afterFirst = remainder.slice(inlineStart + 1);
        const inlineEnd = afterFirst.indexOf('$');
        if (inlineEnd !== -1) {
          tokens.push({ type: 'inline', value: afterFirst.slice(0, inlineEnd) });
          remainder = afterFirst.slice(inlineEnd + 1);
        } else {
          // Unclosed $ - treat remainder as text
          tokens.push({ type: 'text', value: remainder });
          remainder = '';
        }
      } else {
        tokens.push({ type: 'text', value: remainder });
        remainder = '';
      }
    }

    return tokens.map((token, i) => {
      if (token.type === 'display') {
        try {
          const html = katex.renderToString(token.value.trim(), {
            displayMode: true,
            throwOnError: false,
          });
          return (
            <span
              key={i}
              className="block my-2 text-center"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch (_) {
          return <span key={i}>{`$$${token.value}$$`}</span>;
        }
      } else if (token.type === 'inline') {
        try {
          const html = katex.renderToString(token.value.trim(), {
            displayMode: false,
            throwOnError: false,
          });
          return (
            <span
              key={i}
              className="inline-math inline-block align-baseline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } catch (_) {
          return <span key={i}>{`$${token.value}$`}</span>;
        }
      } else {
        // Plain text token with potential newlines
        if (token.value.includes('\n')) {
          return token.value.split('\n').map((line, lIdx, arr) => (
            <React.Fragment key={`${i}-${lIdx}`}>
              {line}
              {lIdx < arr.length - 1 && <br />}
            </React.Fragment>
          ));
        }
        return <span key={i}>{token.value}</span>;
      }
    });
  }, [content]);

  return <span className={`math-renderer ${className}`}>{renderedContent}</span>;
}


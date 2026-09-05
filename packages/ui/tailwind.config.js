/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './**/*.{js,jsx,ts,tsx,html,astro,vue,svelte}',
    '../web/**/*.{js,jsx,ts,tsx,html,astro,vue,svelte}'
  ],
  theme: {
    screens: {
      // Mobile first approach: default is < 600px
      'foldable': '600px',
      'tablet-p': '820px',
      'tablet-l': '1024px',
      'laptop': '1366px',
      'desktop': '1440px',
      'wide': '1920px',
    },
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        fg: {
          DEFAULT: 'var(--fg)',
          soft: 'var(--fg-soft)',
        },
        muted: 'var(--muted)',
        border: 'var(--border)',
        accent: {
          DEFAULT: 'var(--accent)',
          deep: 'var(--accent-deep)',
          soft: 'var(--accent-soft)',
          tint: 'var(--accent-tint)',
        },
        status: {
          good: {
            tint: 'var(--status-good-tint)',
            deep: 'var(--status-good-deep)',
          },
          warn: {
            tint: 'var(--status-warn-tint)',
            deep: 'var(--status-warn-deep)',
          },
          bad: {
            tint: 'var(--status-bad-tint)',
            deep: 'var(--status-bad-deep)',
          },
        }
      },
      fontFamily: {
        body: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      }
    },
  },
  plugins: [],
}

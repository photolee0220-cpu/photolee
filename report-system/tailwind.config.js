/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        sunken: v('sunken'),
        line: v('line'),
        'line-strong': v('line-strong'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        'ink-3': v('ink-3'),
        brand: v('brand'),
        'on-brand': v('on-brand'),
        'brand-ink': v('brand-ink'),
        'brand-soft': v('brand-soft'),
        note: v('note'),
        'note-ink': v('note-ink'),
        'note-line': v('note-line'),
        ok: v('ok'),
        'ok-soft': v('ok-soft'),
        warn: v('warn'),
        'warn-soft': v('warn-soft'),
        danger: v('danger'),
        'danger-soft': v('danger-soft'),
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.04), 0 2px 8px -4px rgb(var(--shadow) / 0.06)',
        pop: '0 16px 40px -12px rgb(var(--shadow) / 0.2), 0 2px 8px rgb(var(--shadow) / 0.06)',
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      fontSize: { base: ['14.5px', '1.6'] },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(24px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { transform: 'translateY(8px) scale(.98)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
      },
      animation: {
        'slide-in': 'slide-in .28s cubic-bezier(.16,1,.3,1)',
        'fade-in': 'fade-in .2s ease-out',
        'pop-in': 'pop-in .22s cubic-bezier(.16,1,.3,1)',
      },
    },
  },
  plugins: [],
};

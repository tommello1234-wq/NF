/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#0F172A',
        muted: '#94A3B8',
        'muted-dark': '#475569',
        accent: '#3B82F6',
        'accent-hover': '#2563EB',
        light: '#F8FAFC',
        'light-secondary': '#F1F5F9',
        success: '#10B981',
        'success-bg': '#D1FAE5',
        error: '#EF4444',
        'error-bg': '#FEE2E2',
        warning: '#F59E0B',
        'warning-bg': '#FEF3C7',
        info: '#0EA5E9',
        'info-bg': '#E0F2FE',
      },
    },
  },
  plugins: [],
}

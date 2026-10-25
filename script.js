const body = document.body;
const toggleButton = document.querySelector('.theme-toggle');
const themeIcon = document.querySelector('.theme-icon');
const THEME_KEY = 'portfolio-theme';

function applyTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);

  if (toggleButton) {
    toggleButton.setAttribute('aria-pressed', String(isDark));
  }

  if (themeIcon) {
    themeIcon.textContent = isDark ? '☾' : '☀';
  }

  try {
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  } catch (error) {
    // Ignore storage restrictions in private browsing or locked-down situations.
  }
}

function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch (error) {
    // Ignore storage restrictions.
  }

  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

applyTheme(getStoredTheme());

if (toggleButton) {
  toggleButton.addEventListener('click', () => {
    const nextTheme = body.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
}

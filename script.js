const root = document.body;
const toggleButton = document.querySelector('.theme-toggle');
const themeIcon = document.querySelector('.theme-icon');

const savedTheme = localStorage.getItem('portfolio-theme');
if (savedTheme === 'dark') {
  root.classList.add('dark');
  themeIcon.textContent = '☾';
} else {
  themeIcon.textContent = '☀';
}

if (toggleButton) {
  toggleButton.addEventListener('click', () => {
    const isDark = root.classList.toggle('dark');
    localStorage.setItem('portfolio-theme', isDark ? 'dark' : 'light');
    themeIcon.textContent = isDark ? '☾' : '☀';
  });
}

const hero = document.querySelector('.hero');
if (hero) {
  hero.setAttribute('data-ready', 'true');
}

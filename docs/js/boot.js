/* Tema ve dil tercihini ilk boyamadan önce uygular (CSP nedeniyle satır içi betik yok). */
try {
  var t = localStorage.getItem('um.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = t;
  var l = localStorage.getItem('um.lang') || (/^ar/.test(navigator.language) ? 'ar' : /^tr/.test(navigator.language) ? 'tr' : 'en'); document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
} catch (e) { }

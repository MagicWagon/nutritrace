import { register, init, getLocaleFromNavigator } from 'svelte-i18n';

// Languages with a dedicated locale file. As contributors add translations,
// register them here and add an entry to AVAILABLE_LOCALES so the language
// picker in Settings → Appearance shows the new option.
register('en', () => import('./en.json'));

export const AVAILABLE_LOCALES = [
  { code: 'en', label: 'English' },
];

export function initI18n(initialLocale) {
  init({
    fallbackLocale: 'en',
    initialLocale: initialLocale || pickInitialLocale(),
  });
}

function pickInitialLocale() {
  const nav = getLocaleFromNavigator();
  if (!nav) return 'en';
  const short = nav.split('-')[0];
  return AVAILABLE_LOCALES.some(l => l.code === short) ? short : 'en';
}

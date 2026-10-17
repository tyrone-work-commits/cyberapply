'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useWorkspace } from './workspace';
export const themes = [
  { id: 'paper', name: 'Paper', description: 'A warm, clear canvas', colors: ['#f7f8fb', '#ffffff', '#6258df', '#20273e'] },
  { id: 'midnight', name: 'Midnight', description: 'Quiet focus after dark', colors: ['#111622', '#1b2232', '#b0a3ff', '#edf0fa'] },
  { id: 'ocean', name: 'Ocean', description: 'Cool blues, open horizons', colors: ['#eff6f9', '#ffffff', '#126f95', '#19394b'] },
  { id: 'forest', name: 'Forest', description: 'Grounded greens and calm', colors: ['#f1f6f0', '#ffffff', '#347457', '#233e30'] },
  { id: 'ember', name: 'Ember', description: 'Warmth with a little energy', colors: ['#fff6ef', '#fffdfa', '#ac4e2e', '#472f28'] },
];
type Preference = 'system' | string;
type Settings = { theme: string; text_size: 'normal' | 'large'; auto_resume: boolean; initialized?: boolean };
const ThemeContext = createContext({ theme: 'paper', preference: 'paper' as Preference, themes, textSize: 'normal' as 'normal' | 'large', syncStatus: '', autoResume: true,
  setTheme: (_id: string) => {}, setPreference: (_id: Preference) => {}, setTextSize: (_size: 'normal' | 'large') => {}, setAutoResume: (_enabled: boolean) => {} });
export function ThemeProvider({ children, userKey = 'guest' }: { children: React.ReactNode; userKey?: string }) {
  const { user, demo, request, notify } = useWorkspace();
  const [preference, setValue] = useState<Preference>('paper');
  const [textSize, setSize] = useState<'normal' | 'large'>('normal');
  const [autoResume, setAuto] = useState(true);
  const [syncStatus, setSync] = useState('');
  const [dark, setDark] = useState(false);
  const revision = useRef(0);
  const currentAccount = useRef(userKey); currentAccount.current = userKey;
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)'); setDark(media.matches);
    const update = () => setDark(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  function local(theme: string, size: 'normal' | 'large') {
    try { localStorage.setItem(`cyberapply-theme:${userKey}`, theme); localStorage.setItem(`cyberapply-text:${userKey}`, size); } catch {}
  }
  useEffect(() => {
    let active = true; const version = ++revision.current;
    let cached = 'paper'; let size: 'normal' | 'large' = 'normal';
    try { cached = localStorage.getItem(`cyberapply-theme:${userKey}`) || localStorage.getItem('cyberapply-theme:guest') || 'paper'; size = localStorage.getItem(`cyberapply-text:${userKey}`) === 'large' ? 'large' : 'normal'; } catch {}
    if (cached !== 'system' && !themes.some(item => item.id === cached)) cached = 'paper';
    setValue(cached); setSize(size); setSync(user && !demo ? 'Syncing account preferences…' : 'Saved on this browser');
    if (user && !demo) {
      request<Settings>('/account/settings').then(async settings => {
        if (!active || version !== revision.current) return;
        if (!settings.initialized) {
          const initialize = writes.current.catch(() => {}).then(async () => {
            if (!active || version !== revision.current) return settings;
            return request<Settings>('/account/settings', { method: 'PATCH', body: { theme: cached, text_size: size } });
          });
          writes.current = initialize.then(() => {});
          settings = await initialize;
        }
        if (!active || version !== revision.current) return;
        setValue(settings.theme); setSize(settings.text_size); setAuto(settings.auto_resume); local(settings.theme, settings.text_size); setSync('Synced with your account');
      }).catch(() => { if (active) setSync('Using this browser’s saved preferences; account sync is unavailable'); });
    } else if (demo) request<Settings>('/account/settings').then(settings => { if (active) setAuto(settings.auto_resume); }).catch(() => {});
    return () => { active = false; };
  }, [userKey, user?.id, demo, request]);
  function sync(patch: Partial<Settings>) {
    if (!user) return;
    const destination = userKey;
    writes.current = writes.current.catch(() => {}).then(async () => {
      if (currentAccount.current !== destination) return;
      await request('/account/settings', { method: 'PATCH', body: patch });
      if (currentAccount.current === destination) setSync(demo ? 'Saved in your demo workspace' : 'Synced with your account');
    }).catch(() => { if (currentAccount.current === destination) { setSync('Saved on this browser; account sync is unavailable'); notify('Your preference is saved here. Account syncing is temporarily unavailable.', 'info'); } });
  }
  const theme = preference === 'system' ? dark ? 'midnight' : 'paper' : preference;
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme === 'midnight' ? 'dark' : 'light'; document.documentElement.dataset.textSize = textSize; }, [theme, textSize]);
  function setPreference(id: Preference) { if (id !== 'system' && !themes.some(item => item.id === id)) return; revision.current++; setValue(id); local(id, textSize); sync({ theme: id }); }
  function setTextSize(size: 'normal' | 'large') { revision.current++; setSize(size); local(preference, size); sync({ text_size: size }); }
  function setAutoResume(enabled: boolean) { setAuto(enabled); sync({ auto_resume: enabled }); }
  return <ThemeContext.Provider value={{ theme, preference, themes, textSize, syncStatus, autoResume, setTheme: setPreference, setPreference, setTextSize, setAutoResume }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);

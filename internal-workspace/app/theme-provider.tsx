"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { Theme } from '@/lib/cyber-domain';
import { themeCookie } from '@/lib/theme-preference';

type ThemeContextValue={theme:Theme;chooseTheme:(theme:Theme)=>void;adoptWorkspaceTheme:(theme:Theme)=>void};
const ThemeContext=createContext<ThemeContextValue|null>(null);
export default function ThemeProvider({initialTheme,children}:{initialTheme?:Theme;children:ReactNode}){
 const [theme,setTheme]=useState<Theme>(initialTheme||'paper');
 const preference=useRef(initialTheme);
 const apply=useCallback((next:Theme)=>{document.documentElement.dataset.theme=next;setTheme(next);},[]);
 const chooseTheme=useCallback((next:Theme)=>{
  preference.current=next;apply(next);
  // Appearance only: this cookie contains no identity or session information.
  document.cookie=`${themeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
 },[apply]);
 const adoptWorkspaceTheme=useCallback((next:Theme)=>{if(!preference.current)apply(next);},[apply]);
 return <ThemeContext.Provider value={{theme,chooseTheme,adoptWorkspaceTheme}}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const context=useContext(ThemeContext);if(!context)throw new Error('Theme controls require the application theme provider.');return context;}

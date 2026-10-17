import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { parseTheme, themeCookie } from '@/lib/theme-preference';
import ThemeProvider from './theme-provider';
import './globals.css';
export const metadata:Metadata={title:'CyberApply · Covenda',description:'A private Covenda workspace for cybersecurity job discovery, résumé review and application preparation.',icons:{icon:'/favicon.svg'}};
export default async function RootLayout({children}:{children:React.ReactNode}){const initialTheme=parseTheme((await cookies()).get(themeCookie)?.value);return <html lang="en" data-theme={initialTheme||'paper'}><body><ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider></body></html>;}

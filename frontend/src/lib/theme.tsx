'use client';
import { createContext, useContext, useEffect, useState } from 'react';
export const themes=[
 {id:'paper',name:'Paper',description:'A warm, clear canvas',colors:['#f7f8fa','#ffffff','#6258e8','#1c2440']},
 {id:'midnight',name:'Midnight',description:'Quiet focus after dark',colors:['#111622','#1b2233','#a99bff','#eef0f8']},
 {id:'ocean',name:'Ocean',description:'Cool blues, open horizons',colors:['#eef6fa','#ffffff','#167bab','#163b51']},
 {id:'forest',name:'Forest',description:'Grounded greens and calm',colors:['#f0f5ef','#ffffff','#34765a','#233e30']},
 {id:'ember',name:'Ember',description:'Warmth with a little energy',colors:['#fff5ef','#fffdfb','#b85731','#492a22']},
];
type Preference='system'|string;
const ThemeContext=createContext({theme:'paper',preference:'paper' as Preference,themes,setTheme:(_id:string)=>{},setPreference:(_id:Preference)=>{}});
export function ThemeProvider({children,userKey='guest'}:{children:React.ReactNode;userKey?:string}) {
 const [preference,setValue]=useState<Preference>('paper');const [dark,setDark]=useState(false);
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)');setDark(media.matches);const update=()=>setDark(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 useEffect(()=>{try{const value=localStorage.getItem(`cyberapply-theme:${userKey}`)||localStorage.getItem('cyberapply-theme:guest')||'paper';setValue(value==='system'||themes.some(t=>t.id===value)?value:'paper');}catch{setValue('paper');}},[userKey]);
 const theme=preference==='system'?(dark?'midnight':'paper'):preference;
 useEffect(()=>{document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme==='midnight'?'dark':'light';},[theme]);
 const setPreference=(id:Preference)=>{if(id!=='system'&&!themes.some(t=>t.id===id))return;setValue(id);try{localStorage.setItem(`cyberapply-theme:${userKey}`,id);}catch{}};
 return <ThemeContext.Provider value={{theme,preference,themes,setTheme:setPreference,setPreference}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>useContext(ThemeContext);

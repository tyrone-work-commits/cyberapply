"use client";
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {ExploreIconTip} from './explore-icon-tip';
import {countdownSeconds} from '@/lib/search-cooldown';

export function ExploreRefreshButton({busy,loading,readyAt,onRefresh}:{busy:boolean;loading:boolean;readyAt:number;onRefresh:()=>void}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{setNow(Date.now());if(readyAt<=Date.now())return;const timer=setInterval(()=>{const at=Date.now();setNow(at);if(at>=readyAt)clearInterval(timer);},1000);return()=>clearInterval(timer);},[readyAt]);
 const remaining=countdownSeconds(readyAt,now),description=loading?'Refreshing vacancies…':remaining?`Refresh vacancies — available in ${remaining} seconds`:'Refresh vacancies from your saved employer sources';
 return <ExploreIconTip text={description}><button type="button" className="explore-preferences-button explore-refresh-button" aria-label="Refresh vacancies" aria-busy={loading} disabled={busy||loading||remaining>0} onClick={onRefresh}><RefreshCw size={22} className={loading?'spin':undefined}/><span className="explore-sr-only">{description}</span></button></ExploreIconTip>;
}

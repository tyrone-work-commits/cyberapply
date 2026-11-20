'use client';
import {useEffect,useState} from 'react';
type Status={enabled:boolean;provider:string;remaining_today:number};
export function useAiStatus(){const [status,setStatus]=useState<Status|null>(null);useEffect(()=>{let active=true;fetch('/api/ai/status').then(r=>r.ok?r.json():null).then(s=>{const value=s as Partial<Status>|null;if(active&&value&&typeof value.enabled==='boolean'&&typeof value.provider==='string'&&typeof value.remaining_today==='number')setStatus(value as Status);}).catch(()=>{});return()=>{active=false;};},[]);return status;}
export function AiBadge(){const status=useAiStatus();return <span className="badge" title={status?`${status.remaining_today} writing requests available today`:'Checking writing service'}>{status?.enabled?'AI on':'AI offline · basic suggestions'}</span>;}

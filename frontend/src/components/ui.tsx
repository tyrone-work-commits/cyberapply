'use client';
import React, { useEffect, useId, useRef } from 'react';
import { Compass, Search, BriefcaseBusiness, Inbox, UserRound, Settings, Palette, ArrowRight, ArrowLeft, Check, CircleCheck, X, Plus, Minus, Download, Upload, FileText, Menu, ChevronRight, ChevronLeft, ChevronDown, Bell, Sparkles, Shield, ShieldCheck, LogOut, Globe, MapPin, Bookmark, ExternalLink, Mail, Phone, SlidersHorizontal, Eye, EyeOff, Clock, Star, Send, Archive, Trash2, RefreshCw, Building2, CircleAlert, Filter, Sun, Moon, Laptop, CircleHelp, Copy, Pause, Play, LockKeyhole, Circle, MoreHorizontal } from 'lucide-react';
const icons: Record<string, React.ElementType> = {compass:Compass,search:Search,briefcase:BriefcaseBusiness,applications:BriefcaseBusiness,inbox:Inbox,user:UserRound,profile:UserRound,settings:Settings,palette:Palette,'arrow-right':ArrowRight,'arrow-left':ArrowLeft,check:Check,'check-circle':CircleCheck,x:X,plus:Plus,minus:Minus,download:Download,upload:Upload,file:FileText,'file-text':FileText,menu:Menu,'chevron-right':ChevronRight,'chevron-left':ChevronLeft,'chevron-down':ChevronDown,bell:Bell,sparkles:Sparkles,shield:Shield,'shield-check':ShieldCheck,'log-out':LogOut,globe:Globe,'map-pin':MapPin,bookmark:Bookmark,'external-link':ExternalLink,mail:Mail,phone:Phone,sliders:SlidersHorizontal,eye:Eye,'eye-off':EyeOff,clock:Clock,star:Star,send:Send,archive:Archive,trash:Trash2,refresh:RefreshCw,building:Building2,alert:CircleAlert,filter:Filter,sun:Sun,moon:Moon,laptop:Laptop,help:CircleHelp,copy:Copy,pause:Pause,play:Play,lock:LockKeyhole,more:MoreHorizontal};
export function Icon({name,size=20,className=''}:{name:string;size?:number;className?:string}) { const Component=icons[name.toLowerCase().replace(/_/g,'-')] || Circle; return <Component size={size} strokeWidth={1.7} aria-hidden="true" className={className}/>; }
export function Spinner() { return <span className="spinner" role="status" aria-label="Loading"/>; }
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?:'primary'|'secondary'|'ghost'|'danger';loading?:boolean;size?:'sm'|'md'|'lg';fullWidth?:boolean};
export function Button({variant='primary',loading,size='md',fullWidth,className='',children,disabled,...props}:ButtonProps) {return <button type="button" {...props} disabled={disabled||loading} className={`btn btn-${variant} btn-${size} ${fullWidth?'full-width':''} ${className}`}>{loading?<Spinner/>:null}{children}</button>;}
export function Badge({children,tone='neutral',className=''}:{children:React.ReactNode;tone?:'success'|'warning'|'info'|'neutral'|'danger';className?:string}) {return <span className={`badge badge-${tone} ${className}`}>{children}</span>;}
export function Card({children,className='',...props}:React.HTMLAttributes<HTMLDivElement>) {return <div className={`card ${className}`} {...props}>{children}</div>;}
export function Field({label,children,hint,className=''}:{label:React.ReactNode;children:React.ReactNode;hint?:React.ReactNode;className?:string}) {
 const id=useId();let controlId=id;let linked=false;
 const link=(nodes:React.ReactNode):React.ReactNode=>React.Children.map(nodes,node=>{
  if(!React.isValidElement<Record<string,any>>(node))return node;
  if(!linked&&['input','select','textarea'].includes(String(node.type))){linked=true;controlId=node.props.id||id;return React.cloneElement(node,{id:controlId,'aria-labelledby':node.props['aria-label']?undefined:node.props['aria-labelledby']||`${id}-label`,'aria-describedby':[node.props['aria-describedby'],hint?`${id}-hint`:null].filter(Boolean).join(' ')||undefined});}
  return node.props.children?React.cloneElement(node,{},link(node.props.children)):node;
 });
 const content=link(children);
 return <div className={`field ${className}`}><label className="field-label" id={`${id}-label`} htmlFor={linked?controlId:undefined}>{label}</label>{content}{hint?<span className="field-hint" id={`${id}-hint`}>{hint}</span>:null}</div>;
}
export function EmptyState({title,description,action,icon='inbox'}:{title:string;description:string;action?:React.ReactNode;icon?:string}) {return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={28}/></div><h3>{title}</h3><p>{description}</p>{action}</div>;}
let openModals=0;let bodyOverflow='';
export function Modal({open,onClose,title,children,wide=false}:{open:boolean;onClose:()=>void;title:string;children:React.ReactNode;wide?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ const element=ref.current; if(!element)return; if(open&&!element.open)element.showModal(); if(!open&&element.open)element.close(); if(!open)return; if(openModals++===0){bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}return()=>{if(--openModals===0)document.body.style.overflow=bodyOverflow;};},[open]);
  return <dialog ref={ref} className={`modal ${wide?'modal-wide':''}`} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===ref.current)onClose();}} aria-label={title}><div className="modal-panel"><header className="modal-header"><h2>{title}</h2><Button variant="ghost" className="icon-btn" aria-label="Close dialog" onClick={onClose}><Icon name="x"/></Button></header><div className="modal-body">{children}</div></div></dialog>;
}
export function ErrorNotice({error}:{error:string|null|undefined}) {return error?<div className="error-notice" role="alert"><Icon name="alert"/>{error}</div>:null;}

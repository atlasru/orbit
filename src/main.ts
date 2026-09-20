import { invoke } from '@tauri-apps/api/core';
import './style.css';
const nodes = [
  {label:'Файлы', icon:'📁', action:'files'},
  {label:'Браузер', icon:'🌐', action:'browser'},
  {label:'Настройки', icon:'⚙', action:'settings'},
  {label:'Терминал', icon:'⌘', action:'terminal'},
];
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="orbit" aria-label="Orbit launcher"><div class="hub" aria-label="Orbit">◌</div>${nodes.map((n,i)=>`<button class="node" style="--i:${i}" data-action="${n.action}" aria-label="${n.label}"><span>${n.icon}</span><small>${n.label}</small></button>`).join('')}</main><p class="hint">Escape — закрыть · Alt + Space — открыть</p>`;
app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.addEventListener('click',()=>invoke('run_action',{action:button.dataset.action}).catch(console.error)));
window.addEventListener('keydown',e=>{if(e.key==='Escape')invoke('hide_launcher').catch(console.error)});